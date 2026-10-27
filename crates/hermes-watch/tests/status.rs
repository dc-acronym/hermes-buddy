//! Connection, schema check, session counts, running window, tokens, exclusions.

mod common;

use common::*;
use hermes_watch::{running_window_secs, HermesSnapshot, Watcher};
use rusqlite::Connection;

fn watcher(db: &Db) -> Watcher {
    Watcher::new(Some(db.path.clone()))
}

fn poll(w: &mut Watcher) -> HermesSnapshot {
    w.poll_at(NOW_MS)
}

fn assert_disconnected(s: &HermesSnapshot) {
    assert!(!s.connected);
    assert_eq!(s.sessions_total, 0);
    assert_eq!(s.sessions_running, 0);
    assert_eq!(s.sessions_waiting, 0);
    assert!(!s.recently_completed);
    assert_eq!((s.tokens_today, s.tokens_lifetime), (0, 0));
    assert!(s.lines.is_empty());
    assert!(s.prompt.is_none());
    assert_eq!(s.model, "");
    assert_eq!(s.polled_at, NOW_MS);
}

#[test]
fn missing_db_is_reported_and_never_created() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("nope").join("state.db");
    let mut w = Watcher::new(Some(path.clone()));
    let s = poll(&mut w);
    assert_disconnected(&s);
    assert_eq!(
        s.error,
        Some(format!("state.db not found at {}", path.display()))
    );
    assert_eq!(s.db_path, path.display().to_string());
    assert_eq!(s.schema_version, None);
    assert!(
        !path.exists() && !path.parent().unwrap().exists(),
        "watcher must not create anything"
    );
    // Same directory but no file: still nothing is created.
    let path2 = dir.path().join("state.db");
    w.set_path(Some(path2.clone()));
    let s = poll(&mut w);
    assert_eq!(
        s.error,
        Some(format!("state.db not found at {}", path2.display()))
    );
    assert!(!path2.exists());
    assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 0);
}

#[test]
fn a_directory_is_not_a_db() {
    let dir = tempfile::tempdir().unwrap();
    let mut w = Watcher::new(Some(dir.path().to_path_buf()));
    let s = poll(&mut w);
    assert!(!s.connected);
    assert!(s.error.unwrap().starts_with("state.db not found at "));
}

#[test]
fn unknown_schema_no_tables() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("state.db");
    let c = Connection::open(&path).unwrap();
    c.execute_batch("CREATE TABLE something_else (a INTEGER); CREATE TABLE schema_version (version INTEGER NOT NULL); INSERT INTO schema_version VALUES (7);")
        .unwrap();
    let mut w = Watcher::new(Some(path));
    let s = poll(&mut w);
    assert_disconnected(&s);
    assert_eq!(
        s.error.as_deref(),
        Some("unrecognised Hermes schema (missing table sessions)")
    );
    assert_eq!(
        s.schema_version,
        Some(7),
        "the version is still reported to help diagnose"
    );
}

#[test]
fn unknown_schema_missing_column() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("state.db");
    let c = Connection::open(&path).unwrap();
    // A plausible older Hermes: no `hidden`, no `last_activity_*`.
    c.execute_batch(
        "CREATE TABLE sessions (id TEXT PRIMARY KEY, source TEXT NOT NULL, model TEXT, started_at REAL NOT NULL, ended_at REAL, input_tokens INTEGER, output_tokens INTEGER);
         CREATE TABLE messages (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT, role TEXT, content TEXT, tool_calls TEXT, timestamp REAL);",
    )
    .unwrap();
    let mut w = Watcher::new(Some(path));
    let s = poll(&mut w);
    assert_disconnected(&s);
    assert_eq!(
        s.error.as_deref(),
        Some("unrecognised Hermes schema (missing sessions.last_activity_at)")
    );
}

#[test]
fn unknown_schema_missing_messages_column() {
    let db = Db::new();
    db.conn
        .execute_batch("ALTER TABLE messages DROP COLUMN tool_call_id")
        .unwrap();
    let mut w = watcher(&db);
    let s = poll(&mut w);
    assert_eq!(
        s.error.as_deref(),
        Some("unrecognised Hermes schema (missing messages.tool_call_id)")
    );
    assert!(!s.connected);
}

#[test]
fn not_a_sqlite_file() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("state.db");
    std::fs::write(
        &path,
        "this is definitely not a sqlite database. ".repeat(40),
    )
    .unwrap();
    let mut w = Watcher::new(Some(path));
    let s = poll(&mut w);
    assert_disconnected(&s);
    assert_eq!(
        s.error.as_deref(),
        Some("unrecognised Hermes schema (not a SQLite database)")
    );
}

#[test]
fn empty_file_is_an_unrecognised_schema_not_a_crash() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("state.db");
    std::fs::write(&path, b"").unwrap();
    let mut w = Watcher::new(Some(path));
    let s = poll(&mut w);
    assert_eq!(
        s.error.as_deref(),
        Some("unrecognised Hermes schema (missing table sessions)")
    );
}

#[test]
fn recovers_when_the_db_appears_later() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("state.db");
    let mut w = Watcher::new(Some(path.clone()));
    assert!(!poll(&mut w).connected);
    let _c = create_at(&path);
    let s = poll(&mut w);
    assert!(s.connected, "{:?}", s.error);
    assert_eq!(s.error, None);
}

#[test]
fn idle() {
    let db = Db::new();
    let mut w = watcher(&db);
    let s = poll(&mut w);
    assert!(s.connected, "{:?}", s.error);
    assert_eq!(s.error, None);
    assert_eq!(s.db_path, db.path.display().to_string());
    assert_eq!(s.schema_version, Some(32));
    assert_eq!(s.sessions_total, 0);
    assert_eq!(s.sessions_running, 0);
    assert_eq!(s.sessions_waiting, 0);
    assert!(!s.recently_completed);
    assert_eq!((s.tokens_today, s.tokens_lifetime), (0, 0));
    assert_eq!(s.msg, "idle");
    assert!(s.lines.is_empty());
    assert_eq!(s.line_gen, 0);
    assert_eq!(s.prompt, None);
    assert_eq!(s.model, "");
    assert_eq!(s.polled_at, NOW_MS);
}

#[test]
fn schema_version_absent_or_empty_is_none() {
    let db = Db::new();
    db.conn.execute("DELETE FROM schema_version", []).unwrap();
    let mut w = watcher(&db);
    let s = poll(&mut w);
    assert!(s.connected);
    assert_eq!(s.schema_version, None);

    db.conn.execute_batch("DROP TABLE schema_version").unwrap();
    let mut w = watcher(&db);
    let s = poll(&mut w);
    assert!(s.connected);
    assert_eq!(s.schema_version, None);
}

#[test]
fn running_window_edges() {
    assert_eq!(running_window_secs(), 135.0);
    let db = Db::new();
    // Exactly at the window: still running. One millisecond-ish past: not.
    db.session(Sess {
        last_activity_at: Some(NOW - 135.0),
        description: Some("at the edge".into()),
        ..Sess::new("edge")
    });
    db.session(Sess {
        last_activity_at: Some(NOW - 135.5),
        ..Sess::new("past")
    });
    db.session(Sess {
        last_activity_at: Some(NOW - 1.0),
        ended_at: Some(NOW - 0.5),
        ..Sess::new("ended")
    });
    db.session(Sess {
        last_activity_at: Some(NOW - 3600.0),
        ..Sess::new("hour_old_open")
    });
    let mut w = watcher(&db);
    let s = poll(&mut w);
    assert!(s.connected, "{:?}", s.error);
    assert_eq!(s.sessions_running, 1, "only `edge` is open within 135 s");
    assert_eq!(
        s.sessions_total, 4,
        "all four had activity in the last 24 h"
    );
    assert_eq!(s.msg, "at the edge");
}

#[test]
fn running_uses_the_newer_of_heartbeat_and_message_time() {
    // Hermes only writes last_activity_at about once a minute, so a message can be newer.
    let db = Db::new();
    db.session(Sess {
        last_activity_at: Some(NOW - 400.0),
        ..Sess::new("lagging")
    });
    let mut w = watcher(&db);
    assert_eq!(poll(&mut w).sessions_running, 0);
    db.user("lagging", NOW - 20.0, "still here");
    assert_eq!(poll(&mut w).sessions_running, 1);
    // A message that is itself stale does not resurrect it.
    let db2 = Db::new();
    db2.session(Sess {
        last_activity_at: Some(NOW - 400.0),
        ..Sess::new("quiet")
    });
    db2.user("quiet", NOW - 300.0, "old");
    let mut w2 = watcher(&db2);
    assert_eq!(poll(&mut w2).sessions_running, 0);
}

#[test]
fn session_without_heartbeat_falls_back_to_started_at() {
    let db = Db::new();
    db.session(Sess {
        started_at: NOW - 30.0,
        last_activity_at: None,
        ..Sess::new("fresh")
    });
    db.session(Sess {
        started_at: NOW - 200_000.0,
        last_activity_at: None,
        ..Sess::new("ancient")
    });
    let mut w = watcher(&db);
    let s = poll(&mut w);
    assert_eq!(s.sessions_running, 1);
    assert_eq!(
        s.sessions_total, 1,
        "the ancient one has no activity in 24 h"
    );
}

#[test]
fn sessions_total_is_a_24h_window() {
    let db = Db::new();
    let day = 24.0 * 3600.0;
    db.session(Sess {
        last_activity_at: Some(NOW - day + 5.0),
        ended_at: Some(NOW - day + 5.0),
        ..Sess::new("just_inside")
    });
    db.session(Sess {
        last_activity_at: Some(NOW - day - 5.0),
        ended_at: Some(NOW - day - 5.0),
        ..Sess::new("just_outside")
    });
    let mut w = watcher(&db);
    let s = poll(&mut w);
    assert_eq!(s.sessions_total, 1);
    assert_eq!(s.sessions_running, 0);
}

#[test]
fn msg_follows_the_newest_running_session_and_is_short_ascii() {
    let db = Db::new();
    db.session(Sess {
        last_activity_at: Some(NOW - 50.0),
        description: Some("older thing".into()),
        ..Sess::new("a")
    });
    db.session(Sess {
        last_activity_at: Some(NOW - 5.0),
        description: Some("executing tool: terminal \u{2014} with a very long description".into()),
        ..Sess::new("b")
    });
    let mut w = watcher(&db);
    let s = poll(&mut w);
    assert_eq!(s.sessions_running, 2);
    assert!(s.msg.len() <= 23, "{:?}", s.msg);
    assert_eq!(s.msg, "executing tool: termina");
    assert!(s.msg.is_ascii());

    // The em dash is transliterated, not left in.
    let db = Db::new();
    db.session(Sess {
        description: Some("a \u{2014} b".into()),
        ..Sess::new("a")
    });
    let mut w = watcher(&db);
    assert_eq!(poll(&mut w).msg, "a - b");
}

#[test]
fn running_session_with_no_description_says_working() {
    // Hermes clears the description when a turn ends, while the session stays open for a while.
    let db = Db::new();
    db.session(Sess {
        description: Some(String::new()),
        ..Sess::new("a")
    });
    let mut w = watcher(&db);
    let s = poll(&mut w);
    assert_eq!(s.sessions_running, 1);
    assert_eq!(s.msg, "working");
}

#[test]
fn cron_and_hidden_sessions_are_excluded_everywhere() {
    let db = Db::new();
    let sec_ago = |n: f64| Some(NOW - n);
    db.session(Sess {
        source: "cron".into(),
        last_activity_at: sec_ago(2.0),
        description: Some("cron job".into()),
        input_tokens: 1_000,
        output_tokens: 1_000,
        ..Sess::new("cron1")
    });
    db.session(Sess {
        hidden: 1,
        last_activity_at: sec_ago(1.0),
        description: Some("hidden chat".into()),
        input_tokens: 500,
        output_tokens: 500,
        ..Sess::new("hid1")
    });
    db.assistant_call(
        "cron1",
        NOW - 20.0,
        "",
        "tc_cron",
        "terminal",
        &terminal_args("echo cron"),
    );
    db.assistant_call(
        "hid1",
        NOW - 20.0,
        "",
        "tc_hid",
        "clarify",
        r#"{"question":"hidden?"}"#,
    );
    db.user("cron1", NOW - 30.0, "cron prompt");
    db.session(Sess {
        last_activity_at: sec_ago(100.0),
        description: Some("real work".into()),
        input_tokens: 7,
        output_tokens: 3,
        ..Sess::new("real")
    });
    db.user("real", NOW - 100.0, "do the real thing");
    let mut w = watcher(&db);
    let s = poll(&mut w);
    assert!(s.connected, "{:?}", s.error);
    assert_eq!(s.sessions_total, 1);
    assert_eq!(s.sessions_running, 1);
    assert_eq!(s.sessions_waiting, 0);
    assert_eq!(s.prompt, None);
    assert_eq!(s.tokens_today, 10);
    assert_eq!(s.tokens_lifetime, 10);
    assert_eq!(s.msg, "real work");
    assert_eq!(
        s.lines,
        vec!["> do the real thing"],
        "the newest session is `real`, not the fresher cron/hidden ones"
    );
    // Case matters for neither: only the exact source 'cron' is excluded.
    db.session(Sess {
        source: "telegram".into(),
        input_tokens: 4,
        ..Sess::new("tg")
    });
    assert_eq!(poll(&mut w).tokens_lifetime, 14);
}

/// Local midnight (epoch s) for `NOW`, from SQLite itself, i.e. the same calendar the watcher uses.
fn local_midnight(conn: &Connection) -> f64 {
    conn.query_row(
        "SELECT CAST(strftime('%s', ?1, 'unixepoch', 'localtime', 'start of day', 'utc') AS REAL)",
        [NOW],
        |r| r.get(0),
    )
    .unwrap()
}

#[test]
fn tokens_today_vs_lifetime() {
    let db = Db::new();
    let midnight = local_midnight(&db.conn);
    assert!(
        midnight <= NOW && NOW - midnight < 25.0 * 3600.0,
        "sanity: {midnight}"
    );
    let ended = |t: f64| Some(t);
    // started the minute after midnight: today
    db.session(Sess {
        started_at: midnight + 60.0,
        ended_at: ended(midnight + 120.0),
        last_activity_at: ended(midnight + 120.0),
        input_tokens: 100,
        output_tokens: 23,
        ..Sess::new("today_a")
    });
    // started exactly at midnight: today (inclusive)
    db.session(Sess {
        started_at: midnight,
        ended_at: ended(midnight + 10.0),
        last_activity_at: ended(midnight + 10.0),
        input_tokens: 1,
        output_tokens: 1,
        ..Sess::new("today_b")
    });
    // started a minute before midnight, still active now: lifetime only
    db.session(Sess {
        started_at: midnight - 60.0,
        last_activity_at: ended(NOW - 5.0),
        input_tokens: 1_000,
        output_tokens: 2_000,
        ..Sess::new("yesterday")
    });
    // a month ago: lifetime only
    db.session(Sess {
        started_at: NOW - 30.0 * 86400.0,
        ended_at: ended(NOW - 29.0 * 86400.0),
        last_activity_at: ended(NOW - 29.0 * 86400.0),
        input_tokens: 40_000,
        output_tokens: 10_000,
        ..Sess::new("old")
    });
    // NULL token columns count as zero
    db.conn
        .execute(
            "INSERT INTO sessions (id, source, started_at, input_tokens, output_tokens) VALUES ('nulls', 'cli', ?1, NULL, NULL)",
            [NOW - 50.0],
        )
        .unwrap();
    let mut w = watcher(&db);
    let s = poll(&mut w);
    assert!(s.connected, "{:?}", s.error);
    assert_eq!(
        s.tokens_today, 125,
        "100+23 + 1+1; yesterday's session started before midnight"
    );
    assert_eq!(s.tokens_lifetime, 125 + 3_000 + 50_000);
}

#[test]
fn recently_completed_is_a_one_poll_pulse() {
    let db = Db::new();
    db.session(Sess::new("a"));
    db.session(Sess::new("b"));
    let mut w = watcher(&db);
    let s = poll(&mut w);
    assert_eq!(s.sessions_running, 2);
    assert!(!s.recently_completed, "nothing has left yet");
    assert!(!poll(&mut w).recently_completed);

    // `a` ends: it was running last poll and is not now.
    db.conn
        .execute(
            "UPDATE sessions SET ended_at = ?1 WHERE id = 'a'",
            [NOW - 1.0],
        )
        .unwrap();
    let s = poll(&mut w);
    assert_eq!(s.sessions_running, 1);
    assert!(s.recently_completed);
    let s = poll(&mut w);
    assert!(!s.recently_completed, "the pulse lasts one poll");

    // `b` goes quiet past the window (no end stamp): also a completion.
    let later = NOW_MS + 200_000;
    let s = w.poll_at(later);
    assert_eq!(s.sessions_running, 0);
    assert!(s.recently_completed);
    assert!(!w.poll_at(later).recently_completed);

    // A brand-new session is not a completion.
    db.session(Sess {
        last_activity_at: Some(NOW + 199.0),
        ..Sess::new("c")
    });
    let s = w.poll_at(later);
    assert_eq!(s.sessions_running, 1);
    assert!(!s.recently_completed);
}

#[test]
fn switching_path_does_not_fake_a_completion() {
    let a = Db::new();
    a.session(Sess::new("a"));
    let b = Db::new();
    let mut w = watcher(&a);
    assert_eq!(poll(&mut w).sessions_running, 1);
    w.set_path(Some(b.path.clone()));
    assert_eq!(w.resolved_path(), b.path);
    let s = poll(&mut w);
    assert_eq!(s.db_path, b.path.display().to_string());
    assert_eq!(s.sessions_running, 0);
    assert!(!s.recently_completed);
    // And back.
    w.set_path(Some(a.path.clone()));
    let s = poll(&mut w);
    assert_eq!(s.sessions_running, 1);
    assert!(!s.recently_completed);
}

#[test]
fn set_path_none_returns_to_the_default() {
    let mut w = Watcher::new(Some("/definitely/not/here/state.db".into()));
    assert_eq!(
        w.resolved_path(),
        std::path::PathBuf::from("/definitely/not/here/state.db")
    );
    w.set_path(None);
    assert_eq!(w.resolved_path(), hermes_watch::default_db_path());
    assert_eq!(
        Watcher::new(None).resolved_path(),
        hermes_watch::default_db_path()
    );
}

#[test]
fn model_is_the_newest_sessions_and_short_ascii() {
    let db = Db::new();
    db.session(Sess {
        model: Some("old-model".into()),
        last_activity_at: Some(NOW - 90.0),
        ..Sess::new("old")
    });
    db.session(Sess {
        model: Some("anthropic/claude-sonnet-4.5-20260101".into()),
        last_activity_at: Some(NOW - 3.0),
        ..Sess::new("new")
    });
    let mut w = watcher(&db);
    let s = poll(&mut w);
    assert_eq!(
        s.model, "claude-sonnet-4",
        "provider prefix dropped, then cut to 15"
    );
    assert!(s.model.chars().count() <= 15, "{:?}", s.model);

    let db = Db::new();
    db.session(Sess {
        model: Some("m\u{f6}del-\u{2014}-x".into()),
        ..Sess::new("x")
    });
    let mut w = watcher(&db);
    assert_eq!(poll(&mut w).model, "m?del---x");

    let db = Db::new();
    db.session(Sess {
        model: None,
        ..Sess::new("x")
    });
    let mut w = watcher(&db);
    assert_eq!(poll(&mut w).model, "");
}

#[test]
fn nothing_in_24h_still_shows_the_latest_session() {
    let db = Db::new();
    let old = NOW - 5.0 * 86400.0;
    db.session(Sess {
        model: Some("claude-old".into()),
        started_at: old - 100.0,
        ended_at: Some(old),
        last_activity_at: Some(old),
        ..Sess::new("last_week")
    });
    db.user("last_week", old - 50.0, "hello from last week");
    let mut w = watcher(&db);
    let s = poll(&mut w);
    assert_eq!(s.sessions_total, 0);
    assert_eq!(s.sessions_running, 0);
    assert_eq!(s.msg, "idle");
    assert_eq!(s.model, "claude-old");
    assert_eq!(s.lines, vec!["> hello from last week"]);
}

#[test]
fn a_garbage_row_does_not_take_the_watcher_down() {
    // Malformed tool_calls JSON, BLOB content, NULL everything: still connected.
    let db = Db::new();
    db.session(Sess::new("s"));
    db.msg(Msg::new("s", "assistant", NOW - 5.0).tool_calls("this is { not json"));
    db.conn
        .execute(
            "INSERT INTO messages (session_id, role, content, timestamp) VALUES ('s', 'user', X'68656c6c6f20626c6f62', ?1)",
            [NOW - 4.0],
        )
        .unwrap();
    db.conn
        .execute(
            "INSERT INTO messages (session_id, role, timestamp) VALUES ('s', 'assistant', ?1)",
            [NOW - 3.0],
        )
        .unwrap();
    db.msg(
        Msg::new("s", "assistant", NOW - 2.0)
            .tool_calls(r#"["a string", 5, null, {"function": {"name": "terminal"}}]"#),
    );
    db.msg(Msg::new("s", "assistant", NOW - 1.0).tool_calls(r#"{"not": "an array"}"#));
    let mut w = watcher(&db);
    let s = poll(&mut w);
    assert!(s.connected, "{:?}", s.error);
    assert_eq!(s.sessions_waiting, 0, "no usable id, so nothing to wait on");
    // The id-less call is still shown in the transcript, as a bare tool name.
    assert_eq!(s.lines, vec!["> hello blob", "terminal"]);
}

#[test]
fn token_sums_past_i64_do_not_take_the_watcher_offline() {
    // SQLite's SUM() raises "integer overflow" past 2^63; one absurd counter must not turn every
    // poll into `connected: false`.
    let db = Db::new();
    let huge = 1i64 << 62;
    for id in ["a", "b", "c"] {
        db.session(Sess {
            input_tokens: huge,
            output_tokens: huge,
            ..Sess::new(id)
        });
    }
    let mut w = watcher(&db);
    let s = poll(&mut w);
    assert!(s.connected, "{:?}", s.error);
    assert_eq!(s.sessions_total, 3);
    // Clamped to what a JSON number / JS double can carry exactly.
    assert_eq!(s.tokens_lifetime, 9_007_199_254_740_991);
    assert_eq!(s.tokens_today, 9_007_199_254_740_991);
    // Garbage in the counters (TEXT / negative) is tolerated too.
    let db = Db::new();
    db.session(Sess::new("neg"));
    db.conn
        .execute(
            "UPDATE sessions SET input_tokens = -50, output_tokens = 'lots'",
            [],
        )
        .unwrap();
    let s = poll(&mut watcher(&db));
    assert!(s.connected, "{:?}", s.error);
    assert_eq!(s.tokens_lifetime, 0);
}
