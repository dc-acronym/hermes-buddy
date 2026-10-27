//! A live Hermes: concurrent writers, WAL checkpoints, replaced files, read-only guarantees,
//! and the JSON shape the UI consumes.

mod common;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::Duration;

use common::*;
use hermes_watch::{HermesSnapshot, PendingPrompt, Watcher};
use rusqlite::Connection;

#[test]
fn a_writer_adding_rows_between_polls_is_seen_by_the_next_poll() {
    let db = Db::new(); // the writer connection stays open, WAL live
    db.session(Sess::new("s"));
    let mut w = Watcher::new(Some(db.path.clone()));

    let s = w.poll_at(NOW_MS);
    assert!(s.connected, "{:?}", s.error);
    assert_eq!((s.sessions_waiting, s.line_gen), (0, 0));

    // Hermes persists a tool call before running it.
    db.user("s", NOW - 30.0, "run the build");
    db.assistant_call(
        "s",
        NOW - 20.0,
        "On it.",
        "tc_live",
        "terminal",
        &terminal_args("make"),
    );
    let s = w.poll_at(NOW_MS);
    assert_eq!(s.sessions_waiting, 1);
    assert_eq!(
        s.prompt,
        Some(PendingPrompt {
            id: "tc_live".into(),
            tool: "terminal".into(),
            hint: "make".into()
        })
    );
    assert_eq!(s.lines, vec!["> run the build", "On it.", "terminal: make"]);
    assert_eq!(s.line_gen, 1);

    // A second writer connection (e.g. a gateway process) answers it.
    let other = db.second_writer();
    add_msg(
        &other,
        &Msg::new("s", "tool", NOW - 5.0)
            .content("{}")
            .answers("tc_live", "terminal"),
    );
    let s = w.poll_at(NOW_MS);
    assert_eq!(s.sessions_waiting, 0);
    assert_eq!(s.prompt, None);
    assert_eq!(s.line_gen, 1, "a tool result adds no transcript line");

    // New session rows and token counts show up too.
    add_session(
        &other,
        &Sess {
            input_tokens: 70,
            output_tokens: 30,
            ..Sess::new("s2")
        },
    );
    let s = w.poll_at(NOW_MS);
    assert_eq!(s.sessions_total, 2);
    assert_eq!(s.tokens_lifetime, 100);
}

#[test]
fn polling_does_not_block_wal_checkpoints() {
    let db = Db::new();
    db.session(Sess::new("s"));
    for i in 0..200 {
        db.user("s", NOW - 300.0 + i as f64, &format!("message {i}"));
    }
    let mut w = Watcher::new(Some(db.path.clone()));
    assert!(w.poll_at(NOW_MS).connected);
    // If the watcher still held a read transaction, TRUNCATE could not complete (busy = 1).
    let (busy, _log, _checkpointed): (i64, i64, i64) = db
        .conn
        .query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?))
        })
        .unwrap();
    assert_eq!(busy, 0, "the watcher must not pin the WAL between polls");

    // And it keeps working across the checkpoint.
    db.user("s", NOW - 1.0, "after the checkpoint");
    let s = w.poll_at(NOW_MS);
    assert!(s.connected, "{:?}", s.error);
    assert_eq!(
        s.lines.last().map(String::as_str),
        Some("> after the checkpoint")
    );
}

#[test]
fn works_while_hermes_is_not_running_and_never_writes_the_database() {
    // No Hermes process: the writer connection is gone and the WAL has been checkpointed away.
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("state.db");
    {
        let c = create_at(&path);
        add_session(
            &c,
            &Sess {
                ended_at: Some(NOW - 50.0),
                input_tokens: 5,
                output_tokens: 6,
                ..Sess::new("s")
            },
        );
        add_msg(&c, &Msg::new("s", "user", NOW - 60.0).content("hello"));
        c.execute_batch("PRAGMA wal_checkpoint(TRUNCATE)").unwrap();
    }
    let before = std::fs::read(&path).unwrap();
    let mtime = std::fs::metadata(&path).unwrap().modified().unwrap();

    let mut w = Watcher::new(Some(path.clone()));
    for _ in 0..3 {
        let s = w.poll_at(NOW_MS);
        assert!(s.connected, "{:?}", s.error);
        assert_eq!(s.lines, vec!["> hello"]);
        assert_eq!(s.tokens_lifetime, 11);
    }
    drop(w);
    assert_eq!(
        std::fs::read(&path).unwrap(),
        before,
        "state.db bytes must be untouched"
    );
    assert_eq!(std::fs::metadata(&path).unwrap().modified().unwrap(), mtime);
}

#[test]
fn a_read_only_file_is_fine() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("state.db");
    {
        let c = create_at(&path);
        add_session(&c, &Sess::new("s"));
        c.execute_batch("PRAGMA wal_checkpoint(TRUNCATE)").unwrap();
    }
    let mut perms = std::fs::metadata(&path).unwrap().permissions();
    perms.set_readonly(true);
    std::fs::set_permissions(&path, perms).unwrap();
    let mut w = Watcher::new(Some(path.clone()));
    let s = w.poll_at(NOW_MS);
    assert!(s.connected, "{:?}", s.error);
    assert_eq!(s.sessions_total, 1);
    // let the tempdir clean up
    let mut perms = std::fs::metadata(&path).unwrap().permissions();
    #[allow(clippy::permissions_set_readonly_false)]
    perms.set_readonly(false);
    std::fs::set_permissions(&path, perms).unwrap();
}

#[cfg(unix)]
#[test]
fn a_replaced_file_is_read_afresh() {
    let db = Db::new();
    db.session(Sess::new("one"));
    let mut w = Watcher::new(Some(db.path.clone()));
    assert_eq!(w.poll_at(NOW_MS).sessions_total, 1);

    // Build a replacement next to it and move it over state.db (the old inode stays alive via
    // the writer's open connection, so the new file gets a different inode).
    let staged = db.dir.path().join("staged.db");
    {
        let c = create_at(&staged);
        add_session(&c, &Sess::new("a"));
        add_session(&c, &Sess::new("b"));
        add_session(&c, &Sess::new("c"));
        c.execute_batch("PRAGMA wal_checkpoint(TRUNCATE)").unwrap();
    }
    std::fs::rename(&staged, &db.path).unwrap();
    // The stale -wal / -shm of the old db are also gone from the new db's point of view.
    let _ = std::fs::remove_file(db.dir.path().join("state.db-wal"));
    let _ = std::fs::remove_file(db.dir.path().join("state.db-shm"));
    let s = w.poll_at(NOW_MS);
    assert!(s.connected, "{:?}", s.error);
    assert_eq!(
        s.sessions_total, 3,
        "must read the new file, not the unlinked old one"
    );
}

#[test]
fn deleted_file_then_recreated() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("state.db");
    {
        let c = create_at(&path);
        add_session(&c, &Sess::new("a"));
    }
    let mut w = Watcher::new(Some(path.clone()));
    assert!(w.poll_at(NOW_MS).connected);
    for f in ["state.db", "state.db-wal", "state.db-shm"] {
        let _ = std::fs::remove_file(dir.path().join(f));
    }
    let s = w.poll_at(NOW_MS);
    assert!(!s.connected);
    assert_eq!(
        s.error,
        Some(format!("state.db not found at {}", path.display()))
    );
    {
        let c = create_at(&path);
        add_session(&c, &Sess::new("x"));
        add_session(&c, &Sess::new("y"));
    }
    let s = w.poll_at(NOW_MS);
    assert!(s.connected, "{:?}", s.error);
    assert_eq!(s.sessions_total, 2);
}

#[test]
fn polling_through_a_busy_writer_never_errors() {
    let db = Db::new();
    db.session(Sess::new("s"));
    let path = db.path.clone();
    let done = Arc::new(AtomicBool::new(false));
    let done_w = done.clone();
    let writer = thread::spawn(move || {
        let c = Connection::open(&path).unwrap();
        c.busy_timeout(Duration::from_secs(5)).unwrap();
        for i in 0..400 {
            let t = NOW - 100.0 + i as f64 * 0.01;
            add_msg(&c, &Msg::new("s", "user", t).content(&format!("q{i}")));
            if i % 20 == 0 {
                let id = format!("tc{i}");
                add_msg(
                    &c,
                    &Msg::new("s", "assistant", t + 0.001).tool_calls(&tool_calls_json(&[(
                        &id,
                        "terminal",
                        &terminal_args("sleep 1"),
                    )])),
                );
                thread::sleep(Duration::from_millis(2));
                add_msg(
                    &c,
                    &Msg::new("s", "tool", t + 0.002)
                        .content("{}")
                        .answers(&id, "terminal"),
                );
            }
            if i % 100 == 99 {
                c.execute_batch("PRAGMA wal_checkpoint(PASSIVE)").unwrap();
            }
            thread::sleep(Duration::from_millis(1));
        }
        done_w.store(true, Ordering::SeqCst);
    });

    let mut w = Watcher::new(Some(db.path.clone()));
    let mut polls = 0;
    let mut saw_pending = false;
    while !done.load(Ordering::SeqCst) {
        let s = w.poll_at(NOW_MS);
        assert!(s.connected, "poll {polls} failed: {:?}", s.error);
        assert!(s.sessions_waiting <= 1);
        saw_pending |= s.sessions_waiting == 1;
        assert!(s.lines.len() <= 8);
        polls += 1;
    }
    writer.join().unwrap();
    let s = w.poll_at(NOW_MS);
    assert!(s.connected, "{:?}", s.error);
    assert_eq!(s.sessions_waiting, 0);
    assert_eq!(s.lines.last().map(String::as_str), Some("> q399"));
    assert!(polls > 5, "only {polls} polls ran");
    // Informational: the window in which a call is pending is ~2 ms, so catching it is luck.
    eprintln!("polls={polls} saw_pending={saw_pending}");
}

#[test]
fn snapshot_json_matches_the_ui_contract() {
    let db = Db::new();
    insert_dump(&db, 335);
    let mut w = Watcher::new(Some(db.path.clone()));
    let s = w.poll_at(NOW_MS);
    let v = serde_json::to_value(&s).unwrap();

    let mut keys: Vec<&str> = v.as_object().unwrap().keys().map(String::as_str).collect();
    keys.sort_unstable();
    let mut want = vec![
        "connected",
        "error",
        "dbPath",
        "schemaVersion",
        "sessionsTotal",
        "sessionsRunning",
        "sessionsWaiting",
        "recentlyCompleted",
        "tokensToday",
        "tokensLifetime",
        "msg",
        "lines",
        "lineGen",
        "prompt",
        "model",
        "polledAt",
    ];
    want.sort_unstable();
    assert_eq!(keys, want);

    assert_eq!(v["connected"], true);
    assert!(v["error"].is_null());
    assert_eq!(v["schemaVersion"], 32);
    assert_eq!(v["sessionsWaiting"], 1);
    assert_eq!(v["polledAt"], NOW_MS);
    assert_eq!(v["prompt"]["id"], CURL_CALL_ID);
    assert_eq!(v["prompt"]["tool"], "terminal");
    assert_eq!(v["prompt"]["hint"], CURL_COMMAND);
    assert!(v["lines"].is_array());
    // Numbers, not strings.
    for k in [
        "sessionsTotal",
        "sessionsRunning",
        "tokensToday",
        "tokensLifetime",
        "lineGen",
    ] {
        assert!(v[k].is_u64(), "{k} should be a JSON integer: {}", v[k]);
    }

    // Idle snapshot: prompt is null, error is null.
    let idle = Db::new();
    let s = Watcher::new(Some(idle.path.clone())).poll_at(NOW_MS);
    let v = serde_json::to_value(&s).unwrap();
    assert!(v["prompt"].is_null());
    assert_eq!(v["msg"], "idle");

    // Round-trips (so the Tauri side can also mock/replay snapshots).
    let back: HermesSnapshot = serde_json::from_value(v).unwrap();
    assert_eq!(back, s);
}

/// Guard against drift from the TypeScript side: the Rust JSON keys must be exactly the fields of
/// `HermesSnapshot` / `PendingPrompt` in app/src/data/types.ts (skipped if the app is not there).
#[test]
fn snapshot_fields_match_types_ts() {
    let ts = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../app/src/data/types.ts");
    let Ok(src) = std::fs::read_to_string(&ts) else {
        eprintln!("types.ts not found, skipping");
        return;
    };
    fn fields(src: &str, name: &str) -> Vec<String> {
        let start = src
            .find(&format!("export interface {name} {{"))
            .expect(name);
        let body = &src[start..];
        let body = &body[..body.find("\n}").expect("end of interface")];
        let mut out: Vec<String> = body
            .lines()
            .skip(1)
            .filter_map(|l| {
                let l = l.trim();
                if l.starts_with("//") || l.is_empty() {
                    return None;
                }
                l.split(':')
                    .next()
                    .map(|k| k.trim().trim_end_matches('?').to_string())
            })
            .collect();
        out.sort();
        out
    }
    let db = Db::new();
    insert_dump(&db, 335);
    let s = Watcher::new(Some(db.path.clone())).poll_at(NOW_MS);
    let v = serde_json::to_value(&s).unwrap();
    let mut got: Vec<String> = v.as_object().unwrap().keys().cloned().collect();
    got.sort();
    assert_eq!(got, fields(&src, "HermesSnapshot"));
    let mut got: Vec<String> = v["prompt"].as_object().unwrap().keys().cloned().collect();
    got.sort();
    assert_eq!(got, fields(&src, "PendingPrompt"));
}

#[test]
fn default_path_is_a_state_db() {
    let p = hermes_watch::default_db_path();
    assert_eq!(p.file_name().unwrap(), "state.db");
    assert_eq!(Watcher::new(None).resolved_path(), p);
}

#[test]
fn poll_with_the_real_clock_works() {
    // `poll()` (system clock) against rows stamped "now".
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("state.db");
    let c = create_at(&path);
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs_f64();
    add_session(
        &c,
        &Sess {
            started_at: now - 5.0,
            last_activity_at: Some(now - 1.0),
            description: Some("thinking".into()),
            ..Sess::new("live")
        },
    );
    add_msg(&c, &Msg::new("live", "user", now - 4.0).content("hi"));
    add_msg(
        &c,
        &Msg::new("live", "assistant", now - 2.0).tool_calls(&tool_calls_json(&[(
            "tcx",
            "clarify",
            r#"{"question":"ok?"}"#,
        )])),
    );
    let mut w = Watcher::new(Some(path));
    let s = w.poll();
    assert!(s.connected, "{:?}", s.error);
    assert_eq!(
        (s.sessions_running, s.sessions_waiting, s.sessions_total),
        (1, 1, 1)
    );
    assert_eq!(s.prompt.unwrap().hint, "ok?");
    let drift = (s.polled_at as f64 / 1000.0 - now).abs();
    assert!(
        drift < 5.0,
        "polled_at should be the current epoch ms (drift {drift}s)"
    );
}

#[test]
fn watcher_can_move_to_a_poller_thread() {
    fn assert_send<T: Send>() {}
    fn assert_send_sync_clone<T: Send + Sync + Clone>() {}
    assert_send::<Watcher>();
    assert_send_sync_clone::<HermesSnapshot>();
    // ...and actually does: poll from another thread behind a Mutex, as the app will.
    let db = Db::new();
    db.session(Sess::new("s"));
    let w = std::sync::Arc::new(std::sync::Mutex::new(Watcher::new(Some(db.path.clone()))));
    let w2 = w.clone();
    let s = thread::spawn(move || w2.lock().unwrap().poll_at(NOW_MS))
        .join()
        .unwrap();
    assert!(s.connected, "{:?}", s.error);
    assert_eq!(s.sessions_total, 1);
}

#[test]
fn a_schema_change_between_polls_is_reported_as_such_and_recovers() {
    // Hermes upgraded/downgraded while the pet was running.
    let db = Db::new();
    db.session(Sess::new("s"));
    let mut w = Watcher::new(Some(db.path.clone()));
    assert!(w.poll_at(NOW_MS).connected);

    db.conn
        .execute_batch("ALTER TABLE sessions DROP COLUMN hidden")
        .unwrap();
    let s = w.poll_at(NOW_MS);
    assert!(!s.connected);
    assert_eq!(
        s.error.as_deref(),
        Some("unrecognised Hermes schema (missing sessions.hidden)")
    );
    assert_eq!(s.schema_version, Some(32));

    db.conn
        .execute_batch("ALTER TABLE sessions ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0")
        .unwrap();
    let s = w.poll_at(NOW_MS);
    assert!(s.connected, "{:?}", s.error);
    assert_eq!(s.sessions_total, 1);
}
