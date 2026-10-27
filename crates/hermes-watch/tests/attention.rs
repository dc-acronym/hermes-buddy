//! Attention: unanswered clarify/terminal tool calls, modeled on the real prompt-test dump.

mod common;

use common::*;
use hermes_watch::{HermesSnapshot, PendingPrompt, Watcher};

fn poll_db(db: &Db) -> HermesSnapshot {
    Watcher::new(Some(db.path.clone())).poll_at(NOW_MS)
}

// Dump rows: 334 sudo result, 335 curl|sh call, 336 denial, 337 reply, 338 user, 339 clarify
// call, 340 answers, 341 reply.

#[test]
fn pending_terminal_call_means_waiting() {
    let db = Db::new();
    insert_dump(&db, 335); // the curl | sh call has been persisted, nothing answered it yet
    let s = poll_db(&db);
    assert!(s.connected, "{:?}", s.error);
    assert_eq!(s.sessions_waiting, 1);
    assert_eq!(
        s.prompt,
        Some(PendingPrompt {
            id: CURL_CALL_ID.to_string(),
            tool: "terminal".to_string(),
            hint: CURL_COMMAND.to_string(),
        })
    );
    assert_eq!(
        s.msg, "waiting: terminal",
        "waiting wins over the activity description"
    );
}

#[test]
fn denial_tool_row_answers_the_call() {
    let db = Db::new();
    insert_dump(&db, 336); // + the "User denied this command" tool result
    let s = poll_db(&db);
    assert_eq!(s.sessions_waiting, 0);
    assert_eq!(s.prompt, None);
    assert_ne!(s.msg, "waiting: terminal");
}

#[test]
fn pending_clarify_hint_is_the_first_question() {
    let db = Db::new();
    insert_dump(&db, 339);
    let s = poll_db(&db);
    assert_eq!(
        s.sessions_waiting, 1,
        "the curl call was denied (336); only the clarify is open"
    );
    let p = s.prompt.expect("prompt");
    assert_eq!(p.id, CLARIFY_CALL_ID);
    assert_eq!(p.tool, "clarify");
    assert_eq!(p.hint, CLARIFY_Q1, "first question, not the second one");
    assert_eq!(s.msg, "waiting: clarify");
}

#[test]
fn answered_clarify_is_not_waiting() {
    let db = Db::new();
    insert_dump(&db, 341);
    let s = poll_db(&db);
    assert_eq!(s.sessions_waiting, 0);
    assert_eq!(s.prompt, None);
}

#[test]
fn clarify_with_a_top_level_question() {
    let db = Db::new();
    db.session(Sess::new("s"));
    db.assistant_call(
        "s",
        NOW - 20.0,
        "",
        "tc1",
        "clarify",
        r#"{"question": "Proceed with the migration?", "choices": ["y", "n"]}"#,
    );
    let s = poll_db(&db);
    assert_eq!(s.prompt.unwrap().hint, "Proceed with the migration?");
}

#[test]
fn clarify_hint_is_ascii_and_bounded() {
    let db = Db::new();
    db.session(Sess::new("s"));
    let q = format!(
        "Shall we {} proceed \u{2014} \u{201C}really\u{201D}?",
        "very ".repeat(40)
    );
    let args = serde_json::json!({ "questions": [{ "question": q }] }).to_string();
    db.assistant_call("s", NOW - 20.0, "", "tc1", "clarify", &args);
    let p = poll_db(&db).prompt.unwrap();
    assert!(p.hint.is_ascii(), "{:?}", p.hint);
    assert!(p.hint.chars().count() <= 91);
    assert!(p.hint.starts_with("Shall we very very"));
    let db = Db::new();
    db.session(Sess::new("s"));
    db.assistant_call(
        "s",
        NOW - 20.0,
        "",
        "tc1",
        "clarify",
        r#"{"questions": [{"question": "Use — or –?"}]}"#,
    );
    assert_eq!(poll_db(&db).prompt.unwrap().hint, "Use - or -?");
}

#[test]
fn terminal_hint_uses_the_command_and_survives_odd_arguments() {
    let db = Db::new();
    db.session(Sess::new("s"));
    db.assistant_call(
        "s",
        NOW - 20.0,
        "",
        "tc1",
        "terminal",
        r#"{"command": "echo   hi\nthere", "timeout": 30}"#,
    );
    assert_eq!(poll_db(&db).prompt.unwrap().hint, "echo hi there");

    let db = Db::new();
    db.session(Sess::new("s"));
    db.assistant_call("s", NOW - 20.0, "", "tc1", "terminal", "not json at all");
    let s = poll_db(&db);
    assert_eq!(s.sessions_waiting, 1);
    assert_eq!(s.prompt.unwrap().hint, "not json at all");

    let db = Db::new();
    db.session(Sess::new("s"));
    db.assistant_call("s", NOW - 20.0, "", "tc1", "terminal", "");
    let s = poll_db(&db);
    assert_eq!(s.sessions_waiting, 1);
    assert_eq!(s.prompt.unwrap().hint, "");

    // `arguments` stored as an object rather than a string.
    let db = Db::new();
    db.session(Sess::new("s"));
    db.msg(Msg::new("s", "assistant", NOW - 20.0).tool_calls(
        r#"[{"id": "tc9", "type": "function", "function": {"name": "terminal", "arguments": {"command": "ls /tmp"}}}]"#,
    ));
    assert_eq!(poll_db(&db).prompt.unwrap().hint, "ls /tmp");
}

#[test]
fn stale_calls_are_ignored_after_30_minutes() {
    let db = Db::new();
    db.session(Sess::new("s"));
    db.assistant_call(
        "s",
        NOW - 1801.0,
        "",
        "orphan",
        "terminal",
        &terminal_args("sleep 1000"),
    );
    let s = poll_db(&db);
    assert_eq!(s.sessions_waiting, 0, "an orphaned call (crash) ages out");
    assert_eq!(s.prompt, None);

    db.assistant_call(
        "s",
        NOW - 1799.0,
        "",
        "recent",
        "terminal",
        &terminal_args("make all"),
    );
    let s = poll_db(&db);
    assert_eq!(s.sessions_waiting, 1);
    assert_eq!(s.prompt.unwrap().id, "recent");
}

#[test]
fn only_clarify_and_terminal_count() {
    let db = Db::new();
    db.session(Sess::new("s"));
    db.assistant_call(
        "s",
        NOW - 20.0,
        "",
        "t1",
        "read_file",
        r#"{"path": "/etc/hosts"}"#,
    );
    db.assistant_call(
        "s",
        NOW - 19.0,
        "",
        "t2",
        "web_search",
        r#"{"query": "rust"}"#,
    );
    db.assistant_call(
        "s",
        NOW - 18.0,
        "",
        "t3",
        "Terminal",
        r#"{"command": "ls"}"#,
    );
    let s = poll_db(&db);
    assert_eq!(s.sessions_waiting, 0);
    assert_eq!(s.prompt, None);
}

#[test]
fn a_tool_row_before_the_call_or_in_another_session_does_not_answer_it() {
    let db = Db::new();
    db.session(Sess::new("s"));
    db.session(Sess::new("other"));
    // Same id, but earlier in the same session (id < the call's row id)...
    db.tool_result("s", NOW - 40.0, "tc1", "terminal", "{}");
    db.assistant_call("s", NOW - 20.0, "", "tc1", "terminal", &terminal_args("ls"));
    // ...and a later row with that id in a different session.
    db.tool_result("other", NOW - 10.0, "tc1", "terminal", "{}");
    // A later row in the same session with another call id, and a non-tool row mentioning it.
    db.tool_result("s", NOW - 15.0, "someone_else", "terminal", "{}");
    db.msg(
        Msg::new("s", "user", NOW - 14.0)
            .content("tc1")
            .answers("tc1", "terminal"),
    );
    let s = poll_db(&db);
    assert_eq!(s.sessions_waiting, 1);
    assert_eq!(s.prompt.unwrap().id, "tc1");

    db.tool_result("s", NOW - 5.0, "tc1", "terminal", "{}");
    assert_eq!(poll_db(&db).sessions_waiting, 0);
}

#[test]
fn inactive_rows_are_ignored() {
    let db = Db::new();
    db.session(Sess::new("s"));
    db.msg(
        Msg::new("s", "assistant", NOW - 20.0)
            .tool_calls(&tool_calls_json(&[(
                "rewound",
                "terminal",
                &terminal_args("ls"),
            )]))
            .inactive(),
    );
    assert_eq!(
        poll_db(&db).sessions_waiting,
        0,
        "a rewound/compacted assistant row is history"
    );
    db.assistant_call(
        "s",
        NOW - 20.0,
        "",
        "live",
        "terminal",
        &terminal_args("ls"),
    );
    let s = poll_db(&db);
    assert_eq!(s.sessions_waiting, 1);
    assert_eq!(s.prompt.unwrap().id, "live");
}

#[test]
fn several_pending_calls_count_individually_and_the_oldest_is_the_prompt() {
    let db = Db::new();
    db.session(Sess::new("a"));
    db.session(Sess::new("b"));
    // Insert out of timestamp order on purpose.
    db.assistant_call(
        "b",
        NOW - 30.0,
        "",
        "newer",
        "clarify",
        r#"{"question": "newer?"}"#,
    );
    db.assistant_call(
        "a",
        NOW - 90.0,
        "",
        "oldest",
        "terminal",
        &terminal_args("make test"),
    );
    // Two parallel calls in one assistant row: both pending, array order breaks the tie.
    db.msg(
        Msg::new("a", "assistant", NOW - 60.0).tool_calls(&tool_calls_json(&[
            ("par1", "terminal", &terminal_args("one")),
            ("par2", "terminal", &terminal_args("two")),
        ])),
    );
    let s = poll_db(&db);
    assert_eq!(s.sessions_waiting, 4);
    assert_eq!(s.prompt.as_ref().unwrap().id, "oldest");
    assert_eq!(s.prompt.unwrap().hint, "make test");

    // One of the parallel calls gets its result.
    db.tool_result("a", NOW - 50.0, "par1", "terminal", "{}");
    db.tool_result("a", NOW - 49.0, "oldest", "terminal", "{}");
    let s = poll_db(&db);
    assert_eq!(s.sessions_waiting, 2);
    assert_eq!(s.prompt.unwrap().id, "par2");
}

#[test]
fn the_same_call_on_two_active_rows_counts_once() {
    // Context compression can clone recent rows as fresh live rows.
    let db = Db::new();
    db.session(Sess::new("s"));
    let calls = tool_calls_json(&[("dup", "terminal", &terminal_args("ls"))]);
    db.msg(Msg::new("s", "assistant", NOW - 30.0).tool_calls(&calls));
    db.msg(Msg::new("s", "assistant", NOW - 29.0).tool_calls(&calls));
    assert_eq!(poll_db(&db).sessions_waiting, 1);
}

#[test]
fn waiting_in_a_session_not_active_for_a_day_is_not_seen() {
    // The watcher only looks at sessions with activity in the last 24 h (that is what keeps the
    // query indexed); a call this fresh in such a session cannot happen in practice.
    let db = Db::new();
    db.session(Sess {
        started_at: NOW - 3.0 * 86400.0,
        ended_at: Some(NOW - 2.0 * 86400.0),
        last_activity_at: Some(NOW - 2.0 * 86400.0),
        ..Sess::new("old")
    });
    db.assistant_call("old", NOW - 20.0, "", "x", "terminal", &terminal_args("ls"));
    assert_eq!(poll_db(&db).sessions_waiting, 0);
}

#[test]
fn a_waiting_session_in_the_dump_is_also_running() {
    let db = Db::new();
    insert_dump(&db, 335);
    // the dump's heartbeat is 70 s old at NOW; the call is 70 s old
    let s = poll_db(&db);
    assert_eq!(s.sessions_running, 1);
    assert_eq!(s.sessions_total, 1);
    assert_eq!(s.model, "claude-opus-4-5");
}

/// The statement must be driven from the candidate sessions and use the
/// (session_id, active, timestamp) index, never a scan of every message row.
#[test]
fn attention_query_never_scans_all_messages() {
    let db = Db::new();
    let plan: Vec<String> = {
        let mut st = db
            .conn
            .prepare(&format!(
                "EXPLAIN QUERY PLAN {}",
                hermes_watch::__SQL_PENDING
            ))
            .unwrap();
        let rows = st
            .query_map(
                rusqlite::named_params! { ":since": NOW - 86400.0, ":cut": NOW - 1800.0 },
                |r| r.get::<_, String>(3),
            )
            .unwrap();
        rows.map(Result::unwrap).collect()
    };
    let joined = plan.join("\n");
    assert!(
        plan.iter()
            .any(|d| d.contains("SEARCH m USING INDEX idx_messages_session_active")),
        "unexpected plan:\n{joined}"
    );
    assert!(
        !plan.iter().any(|d| d.starts_with("SCAN m")),
        "full scan of messages:\n{joined}"
    );
    assert!(
        plan.iter()
            .any(|d| d.contains("SEARCH r USING INDEX idx_messages_session_id")),
        "answer lookup should be indexed:\n{joined}"
    );
}
