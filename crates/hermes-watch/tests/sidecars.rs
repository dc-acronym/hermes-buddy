//! The watcher must be invisible to Hermes: no file descriptor held between polls (Hermes
//! treats any process holding `state.db` / `-wal` / `-shm` as a "foreign holder" and then refuses
//! `hermes sessions optimize/prune`, skips startup schema repair and aborts reconcile), and no
//! `-wal` / `-shm` files created next to a database nobody has open.

mod common;

use common::*;
use hermes_watch::Watcher;

/// A WAL-mode database with no writer left: the state of `~/.hermes` when Hermes is not running.
fn quiescent_db(dir: &std::path::Path) -> std::path::PathBuf {
    let path = dir.join("state.db");
    {
        let c = create_at(&path);
        add_session(&c, &Sess::new("s"));
        add_msg(&c, &Msg::new("s", "user", NOW - 20.0).content("hello"));
        c.execute_batch("PRAGMA wal_checkpoint(TRUNCATE)").unwrap();
    }
    path
}

/// Not a test: the "Hermes" process. Re-run by the test below in a child process (the test
/// binary itself, `HW_HELD_DB=<dir>`), it creates a WAL database, keeps its connection open so
/// `state.db`, `-wal` and `-shm` exist and are held, and waits for stdin to close.
///
/// A separate process matters: SQLite will not close a descriptor while another connection *in the
/// same process* holds locks on the same file (POSIX locks are per process), so an in-process
/// writer would make a leaked watcher descriptor invisible to the check.
#[test]
fn hermes_process_helper() {
    use std::io::{Read, Write};
    let Ok(dir) = std::env::var("HW_HELD_DB") else {
        return; // an ordinary run of the suite
    };
    let c = create_at(&std::path::Path::new(&dir).join("state.db"));
    add_session(&c, &Sess::new("s"));
    add_msg(
        &c,
        &Msg::new("s", "user", NOW - 20.0).content("from hermes"),
    );
    println!("HELD");
    std::io::stdout().flush().unwrap();
    let mut sink = Vec::new();
    let _ = std::io::stdin().read_to_end(&mut sink);
    drop(c);
}

/// Start the helper and wait until it holds the database.
fn spawn_hermes(dir: &std::path::Path) -> std::process::Child {
    use std::io::{BufRead, BufReader};
    use std::process::{Command, Stdio};
    let mut child = Command::new(std::env::current_exe().unwrap())
        .args([
            "--exact",
            "hermes_process_helper",
            "--nocapture",
            "--test-threads=1",
        ])
        .env("HW_HELD_DB", dir)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .expect("spawn helper");
    let mut lines = BufReader::new(child.stdout.take().unwrap()).lines();
    loop {
        match lines.next() {
            // (libtest prints "test <name> ... " ahead of the helper's own output.)
            Some(Ok(l)) if l.ends_with("HELD") => break,
            Some(Ok(_)) => continue,
            other => panic!("helper died before holding the database: {other:?}"),
        }
    }
    // Keep draining so the helper never blocks on a full pipe.
    std::thread::spawn(move || for _ in lines {});
    child
}

#[cfg(target_os = "linux")]
#[test]
fn no_descriptor_to_the_database_survives_a_poll() {
    // A separate live "Hermes" process holds state.db, -wal and -shm, as the real one does.
    let dir = tempfile::tempdir().unwrap();
    let mut hermes = spawn_hermes(dir.path());
    assert!(dir.path().join("state.db-wal").exists());
    assert!(dir.path().join("state.db-shm").exists());
    let names = listing(dir.path());
    assert_eq!(
        fds_under(dir.path()),
        vec![],
        "sanity: nothing of ours is open yet"
    );

    let mut w = Watcher::new(Some(dir.path().join("state.db")));
    for i in 0..3 {
        let s = w.poll_at(NOW_MS);
        assert!(s.connected, "{:?}", s.error);
        assert_eq!(s.lines, vec!["> from hermes"]);
        assert_eq!(
            fds_under(dir.path()),
            vec![],
            "poll {i} left a descriptor open on the database"
        );
    }
    assert_eq!(listing(dir.path()), names, "polling added or removed files");
    drop(hermes.stdin.take()); // let the helper exit
    let _ = hermes.wait();
}

#[cfg(target_os = "linux")]
#[test]
fn failed_polls_release_their_descriptors_too() {
    let dir = tempfile::tempdir().unwrap();
    let path = quiescent_db(dir.path());
    // Break the schema so the poll fails after opening.
    {
        let c = rusqlite::Connection::open(&path).unwrap();
        c.execute_batch("ALTER TABLE sessions DROP COLUMN hidden")
            .unwrap();
        c.execute_batch("PRAGMA wal_checkpoint(TRUNCATE)").unwrap();
    }
    let mut w = Watcher::new(Some(path));
    let s = w.poll_at(NOW_MS);
    assert!(!s.connected);
    assert_eq!(
        fds_under(dir.path()),
        vec![],
        "an error path leaked a descriptor"
    );
}

#[cfg(target_os = "linux")]
#[test]
fn a_quiescent_database_is_not_held_open_either() {
    let dir = tempfile::tempdir().unwrap();
    let path = quiescent_db(dir.path());
    let mut w = Watcher::new(Some(path));
    assert!(w.poll_at(NOW_MS).connected);
    assert_eq!(fds_under(dir.path()), vec![]);
}

#[test]
fn polling_a_quiescent_wal_database_creates_no_sidecar_files() {
    let dir = tempfile::tempdir().unwrap();
    let path = quiescent_db(dir.path());
    assert_eq!(
        listing(dir.path()),
        vec!["state.db"],
        "precondition: a cleanly closed WAL database has no sidecars"
    );
    let bytes = std::fs::read(&path).unwrap();

    let mut w = Watcher::new(Some(path.clone()));
    for _ in 0..3 {
        let s = w.poll_at(NOW_MS);
        assert!(s.connected, "{:?}", s.error);
        assert_eq!(s.sessions_total, 1);
        assert_eq!(
            s.lines,
            vec!["> hello"],
            "the data is read, not just the schema"
        );
        assert_eq!(
            listing(dir.path()),
            vec!["state.db"],
            "a poll left files behind"
        );
    }
    drop(w);
    assert_eq!(
        std::fs::read(&path).unwrap(),
        bytes,
        "state.db must be untouched"
    );
}

#[test]
fn polling_works_in_a_read_only_directory_without_sidecars() {
    // Nothing may be created, so a directory we cannot write to must not matter.
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let path = quiescent_db(dir.path());
        let mut perms = std::fs::metadata(dir.path()).unwrap().permissions();
        perms.set_mode(0o555);
        std::fs::set_permissions(dir.path(), perms).unwrap();
        let s = Watcher::new(Some(path)).poll_at(NOW_MS);
        let mut perms = std::fs::metadata(dir.path()).unwrap().permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(dir.path(), perms).unwrap();
        assert!(s.connected, "{:?}", s.error);
        assert_eq!(s.sessions_total, 1);
    }
}

#[test]
fn awkward_paths_survive_the_uri_open() {
    // The sidecar-free open goes through a `file:` URI; `%`, `#`, `?` and spaces must not be
    // read as URI syntax.
    let root = tempfile::tempdir().unwrap();
    for name in [
        "my db",
        "50%25 off",
        "a#b",
        "what?",
        "caf\u{e9} \u{2603}",
        "a&b=c",
    ] {
        let dir = root.path().join(name);
        std::fs::create_dir_all(&dir).unwrap();
        let path = quiescent_db(&dir);
        let s = Watcher::new(Some(path)).poll_at(NOW_MS);
        assert!(s.connected, "{name}: {:?}", s.error);
        assert_eq!(s.sessions_total, 1, "{name}");
        assert_eq!(listing(&dir), vec!["state.db"], "{name}");
    }
}

#[test]
fn with_sidecars_present_fresh_writes_are_still_seen_and_nothing_is_added() {
    let db = Db::new(); // writer open: state.db-wal and state.db-shm exist
    db.session(Sess::new("s"));
    db.user("s", NOW - 30.0, "first");
    assert!(db.dir.path().join("state.db-wal").exists());
    assert!(db.dir.path().join("state.db-shm").exists());
    let names = listing(db.dir.path());

    let mut w = Watcher::new(Some(db.path.clone()));
    let s = w.poll_at(NOW_MS);
    assert_eq!(s.lines, vec!["> first"]);

    // Committed to the WAL only (never checkpointed): an immutable read would miss it.
    db.user("s", NOW - 10.0, "second, only in the WAL");
    let s = w.poll_at(NOW_MS);
    assert_eq!(s.lines, vec!["> first", "> second, only in the WAL"]);
    assert_eq!(listing(db.dir.path()), names);
}

#[test]
fn a_hot_wal_left_by_a_crashed_hermes_is_still_read() {
    // Hermes was killed: -wal holds committed frames that never reached state.db. The watcher
    // must see them (so it must not take the immutable shortcut) and must not clean up.
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("state.db");
    let c = create_at(&path);
    add_session(&c, &Sess::new("s"));
    add_msg(
        &c,
        &Msg::new("s", "user", NOW - 20.0).content("only in the wal"),
    );
    // Snapshot the files as a crash would leave them, then let the connection close normally.
    let crashed = tempfile::tempdir().unwrap();
    for f in ["state.db", "state.db-wal", "state.db-shm"] {
        std::fs::copy(dir.path().join(f), crashed.path().join(f)).unwrap();
    }
    drop(c);
    let s = Watcher::new(Some(crashed.path().join("state.db"))).poll_at(NOW_MS);
    assert!(s.connected, "{:?}", s.error);
    assert_eq!(s.lines, vec!["> only in the wal"]);
}
