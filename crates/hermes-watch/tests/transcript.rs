//! Transcript lines, ASCII sanitising, truncation, lineGen, newest-session choice.

mod common;

use common::*;
use hermes_watch::{HermesSnapshot, Watcher, MAX_LINE_CHARS};

fn poll_db(db: &Db) -> HermesSnapshot {
    Watcher::new(Some(db.path.clone())).poll_at(NOW_MS)
}

fn assert_stick_safe(s: &HermesSnapshot) {
    assert!(s.lines.len() <= 8);
    for l in &s.lines {
        assert!(l.is_ascii(), "non-ascii line {l:?}");
        assert!(
            l.chars().count() <= MAX_LINE_CHARS,
            "line too long ({}): {l:?}",
            l.chars().count()
        );
        assert!(!l.is_empty());
        assert!(!l.contains('\n'));
    }
    assert!(
        s.msg.is_ascii() && s.msg.chars().count() <= 23,
        "{:?}",
        s.msg
    );
    assert!(
        s.model.is_ascii() && s.model.chars().count() <= 15,
        "{:?}",
        s.model
    );
    if let Some(p) = &s.prompt {
        assert!(p.hint.is_ascii() && p.tool.is_ascii());
    }
}

#[test]
fn real_dump_transcript() {
    let db = Db::new();
    insert_dump(&db, 341);
    let s = poll_db(&db);
    assert!(s.connected, "{:?}", s.error);

    // Row 337 is long and has an em dash: transliterated, first paragraph line only (shorter than the cap).
    let r337 = "There's your prompt - you denied the `curl | sh`, and that came back as a hard block (no retry, workflow stops).";
    let r337: String = r337.chars().take(MAX_LINE_CHARS).collect();
    assert!(r337.len() < MAX_LINE_CHARS);

    assert_eq!(
        s.lines,
        vec![
            // 335: assistant text, then its tool call
            "Also sailed through. Let me probe a few other patterns.".to_string(),
            format!("terminal: {CURL_COMMAND}"),
            // 336 (tool) skipped
            r337,
            // 338: user
            "> perfect thanks - and can you trigger a mutiple choice question as well (arbitrary)"
                .to_string(),
            // 339: empty content, clarify call -> "<tool>: <first question>"
            format!("clarify: {CLARIFY_Q1}"),
            // 340 (tool) skipped; 341: first non-empty line only
            "Both rendered and came back. Results:".to_string(),
        ]
    );
    assert_stick_safe(&s);
}

#[test]
fn reasoning_tool_rows_and_empty_rows_are_skipped() {
    let db = Db::new();
    db.session(Sess::new("s"));
    db.user("s", NOW - 50.0, "hi");
    // reasoning is never read; give the row reasoning-only content to prove it
    db.conn
        .execute(
            "INSERT INTO messages (session_id, role, content, reasoning, reasoning_content, timestamp)
             VALUES ('s', 'assistant', '', 'secret chain of thought', 'secret chain of thought', ?1)",
            [NOW - 40.0],
        )
        .unwrap();
    db.tool_result(
        "s",
        NOW - 30.0,
        "x",
        "terminal",
        "{\"output\": \"tool output\"}",
    );
    db.assistant("s", NOW - 20.0, "   \n  \n");
    db.msg(Msg::new("s", "system", NOW - 10.0).content("system prompt here"));
    let s = poll_db(&db);
    assert_eq!(s.lines, vec!["> hi"]);
}

#[test]
fn at_most_eight_lines_oldest_first() {
    let db = Db::new();
    db.session(Sess::new("s"));
    for i in 1..=12 {
        db.user("s", NOW - 100.0 + i as f64, &format!("m{i}"));
    }
    let s = poll_db(&db);
    let want: Vec<String> = (5..=12).map(|i| format!("> m{i}")).collect();
    assert_eq!(s.lines, want);
}

#[test]
fn a_multi_line_row_fills_from_the_newest_end() {
    let db = Db::new();
    db.session(Sess::new("s"));
    for i in 1..=4 {
        db.user("s", NOW - 100.0 + i as f64, &format!("u{i}"));
    }
    // One assistant row with text + 6 calls = 7 lines; only the newest 8 overall survive.
    let calls: Vec<(String, String, String)> = (1..=6)
        .map(|i| {
            (
                format!("c{i}"),
                "read_file".to_string(),
                format!(r#"{{"path": "/f{i}"}}"#),
            )
        })
        .collect();
    let refs: Vec<(&str, &str, &str)> = calls
        .iter()
        .map(|(a, b, c)| (a.as_str(), b.as_str(), c.as_str()))
        .collect();
    db.msg(
        Msg::new("s", "assistant", NOW - 50.0)
            .content("reading files")
            .tool_calls(&tool_calls_json(&refs)),
    );
    let s = poll_db(&db);
    assert_eq!(
        s.lines,
        vec![
            "> u4",
            "reading files",
            "read_file: /f1",
            "read_file: /f2",
            "read_file: /f3",
            "read_file: /f4",
            "read_file: /f5",
            "read_file: /f6",
        ]
    );
}

#[test]
fn ascii_sanitising() {
    let db = Db::new();
    db.session(Sess::new("s"));
    db.user(
        "s",
        NOW - 30.0,
        "caf\u{e9} \u{2014} \u{201C}quoted\u{201D} \u{2018}single\u{2019} \u{2026} \u{1F600} \u{2022} item \u{2192} next \u{2013} done\tTabbed",
    );
    db.assistant("s", NOW - 20.0, "\u{4F60}\u{597D} world \u{2713}");
    let s = poll_db(&db);
    assert_eq!(
        s.lines,
        vec![
            "> caf? - \"quoted\" 'single' ... ? * item -> next - done Tabbed",
            "?? world ?",
        ]
    );
    assert_stick_safe(&s);
}

#[test]
fn long_lines_are_cut_to_the_cap_on_char_boundaries() {
    let db = Db::new();
    db.session(Sess::new("s"));
    let long = "\u{e9}".repeat(300); // 300 two-byte chars -> 300 '?'
    db.user("s", NOW - 30.0, &long);
    db.assistant("s", NOW - 20.0, &"abcdefghij".repeat(30));
    // the 168th char (24 x "abcdef ") lands on a separator: the trailing space is trimmed
    db.assistant("s", NOW - 10.0, &"abcdef ".repeat(100));
    let s = poll_db(&db);
    assert_eq!(s.lines[0], format!("> {}", "?".repeat(MAX_LINE_CHARS - 2)));
    assert_eq!(s.lines[0].len(), MAX_LINE_CHARS);
    assert_eq!(s.lines[1].len(), MAX_LINE_CHARS);
    assert_eq!(s.lines[2].len(), MAX_LINE_CHARS - 1, "{:?}", s.lines[2]);
    assert!(s.lines[2].ends_with('f'));
    assert_stick_safe(&s);
}

#[test]
fn first_meaningful_line_only() {
    let db = Db::new();
    db.session(Sess::new("s"));
    db.user(
        "s",
        NOW - 40.0,
        "\n\n   leading blanks, then text\nsecond line",
    );
    db.assistant("s", NOW - 30.0, "```python\nprint('x')\n```");
    db.assistant("s", NOW - 20.0, "---\n\n**Heading**\nbody");
    db.user("s", NOW - 10.0, "   \t \n");
    let s = poll_db(&db);
    assert_eq!(
        s.lines,
        vec!["> leading blanks, then text", "print('x')", "**Heading**"]
    );
}

#[test]
fn huge_content_is_cut_in_sql() {
    let db = Db::new();
    db.session(Sess::new("s"));
    let big = format!("first line\n{}", "x".repeat(5_000_000));
    db.user("s", NOW - 10.0, &big);
    let s = poll_db(&db);
    assert_eq!(s.lines, vec!["> first line"]);
    // A single giant line is also fine.
    let db = Db::new();
    db.session(Sess::new("s"));
    db.user("s", NOW - 10.0, &"y".repeat(3_000_000));
    let s = poll_db(&db);
    assert_eq!(s.lines[0].len(), MAX_LINE_CHARS);
}

#[test]
fn structured_multimodal_content() {
    let db = Db::new();
    db.session(Sess::new("s"));
    let parts = serde_json::json!([
        {"type": "text", "text": "what is in this picture?\nplease be brief"},
        {"type": "image_url", "image_url": {"url": format!("data:image/png;base64,{}", "A".repeat(20_000))}},
    ]);
    // Hermes stores structured content as "\0json:" + json (`SessionDB._encode_content`).
    db.user("s", NOW - 10.0, &format!("\u{0}json:{parts}"));
    let s = poll_db(&db);
    assert_eq!(s.lines, vec!["> what is in this picture?"]);
}

#[test]
fn text_and_tool_calls_from_one_row() {
    let db = Db::new();
    db.session(Sess::new("s"));
    db.assistant_call(
        "s",
        NOW - 10.0,
        "I'll check the logs.",
        "t1",
        "terminal",
        &terminal_args("tail -n 50 app.log"),
    );
    db.msg(
        Msg::new("s", "assistant", NOW - 5.0).tool_calls(&tool_calls_json(&[("t2", "todo", "{}")])),
    );
    let s = poll_db(&db);
    assert_eq!(
        s.lines,
        vec![
            "I'll check the logs.",
            "terminal: tail -n 50 app.log",
            "todo"
        ]
    );
    assert_eq!(
        s.sessions_waiting, 1,
        "`todo` is not an attention tool; the `terminal` call is"
    );
}

#[test]
fn inactive_messages_are_not_in_the_transcript() {
    let db = Db::new();
    db.session(Sess::new("s"));
    db.user("s", NOW - 30.0, "kept");
    db.msg(
        Msg::new("s", "assistant", NOW - 20.0)
            .content("rewound reply")
            .inactive(),
    );
    let s = poll_db(&db);
    assert_eq!(s.lines, vec!["> kept"]);
}

#[test]
fn newest_session_by_activity_supplies_lines_and_model() {
    let db = Db::new();
    db.session(Sess {
        model: Some("model-a".into()),
        last_activity_at: Some(NOW - 50.0),
        ..Sess::new("a")
    });
    db.session(Sess {
        model: Some("model-b".into()),
        last_activity_at: Some(NOW - 5.0),
        ..Sess::new("b")
    });
    db.user("a", NOW - 50.0, "from a");
    db.user("b", NOW - 5.0, "from b");
    let s = poll_db(&db);
    assert_eq!(
        (s.model.as_str(), s.lines.clone()),
        ("model-b", vec!["> from b".to_string()])
    );

    // A finished session that is the most recently active one still wins (nothing else is newer).
    let db = Db::new();
    db.session(Sess {
        model: Some("model-a".into()),
        last_activity_at: Some(NOW - 100.0),
        ..Sess::new("a")
    });
    db.session(Sess {
        model: Some("model-b".into()),
        ended_at: Some(NOW - 2.0),
        last_activity_at: Some(NOW - 2.0),
        ..Sess::new("b")
    });
    db.user("a", NOW - 100.0, "from a");
    db.user("b", NOW - 2.0, "from b");
    let s = poll_db(&db);
    assert_eq!(s.model, "model-b");
    assert_eq!(s.lines, vec!["> from b"]);
    assert_eq!(s.sessions_running, 1, "only `a` is still open");
}

#[test]
fn a_newer_message_beats_a_lagging_heartbeat_when_picking_the_session() {
    let db = Db::new();
    // `a` heartbeat is fresher on paper; `b` has the newest message (heartbeats lag by ~60 s).
    db.session(Sess {
        model: Some("model-a".into()),
        last_activity_at: Some(NOW - 30.0),
        ..Sess::new("a")
    });
    db.session(Sess {
        model: Some("model-b".into()),
        last_activity_at: Some(NOW - 100.0),
        ..Sess::new("b")
    });
    db.user("a", NOW - 30.0, "from a");
    db.user("b", NOW - 3.0, "from b");
    let s = poll_db(&db);
    assert_eq!(s.model, "model-b");
    assert_eq!(s.lines, vec!["> from b"]);
}

#[test]
fn line_gen_bumps_only_when_lines_change() {
    let db = Db::new();
    db.session(Sess::new("s"));
    let mut w = Watcher::new(Some(db.path.clone()));
    let s = w.poll_at(NOW_MS);
    assert_eq!((s.line_gen, s.lines.len()), (0, 0), "nothing to show yet");
    assert_eq!(w.poll_at(NOW_MS).line_gen, 0);

    db.user("s", NOW - 20.0, "one");
    let s = w.poll_at(NOW_MS);
    assert_eq!(s.line_gen, 1);
    assert_eq!(
        w.poll_at(NOW_MS).line_gen,
        1,
        "unchanged lines keep the generation"
    );
    assert_eq!(w.poll_at(NOW_MS + 10_000).line_gen, 1);

    // A row that adds no line (tool result) does not bump.
    db.tool_result("s", NOW - 15.0, "x", "terminal", "{}");
    assert_eq!(w.poll_at(NOW_MS).line_gen, 1);

    db.assistant("s", NOW - 10.0, "two");
    let s = w.poll_at(NOW_MS);
    assert_eq!(s.line_gen, 2);
    assert_eq!(s.lines, vec!["> one", "two"]);

    // The session changes under the pet: lines differ again.
    db.session(Sess {
        last_activity_at: Some(NOW - 1.0),
        ..Sess::new("t")
    });
    db.user("t", NOW - 1.0, "other");
    let s = w.poll_at(NOW_MS);
    assert_eq!((s.line_gen, s.lines), (3, vec!["> other".to_string()]));
}

#[test]
fn line_gen_survives_an_outage() {
    let db = Db::new();
    db.session(Sess::new("s"));
    db.user("s", NOW - 20.0, "one");
    let mut w = Watcher::new(Some(db.path.clone()));
    assert_eq!(w.poll_at(NOW_MS).line_gen, 1);

    let missing = db.dir.path().join("gone.db");
    w.set_path(Some(missing));
    let s = w.poll_at(NOW_MS);
    assert!(!s.connected);
    assert!(s.lines.is_empty());
    assert_eq!(
        s.line_gen, 2,
        "the lines vanished: that is a change the UI must see"
    );
    assert_eq!(w.poll_at(NOW_MS).line_gen, 2);

    w.set_path(Some(db.path.clone()));
    let s = w.poll_at(NOW_MS);
    assert_eq!(s.lines, vec!["> one"]);
    assert_eq!(s.line_gen, 3);
}

#[test]
fn hidden_and_compaction_summary_rows_are_not_in_the_transcript() {
    // Hermes itself never paints these (`display_kind = 'hidden'`, `_compressed_summary`).
    let db = Db::new();
    db.session(Sess::new("s"));
    db.user("s", NOW - 50.0, "real question");
    db.msg(
        Msg::new("s", "user", NOW - 40.0)
            .content("[internal scaffolding the model sees]")
            .hidden(),
    );
    db.msg(
        Msg::new("s", "user", NOW - 30.0)
            .content("[CONTEXT COMPACTION \u{2014} REFERENCE ONLY] Earlier turns were compacted into the summary below. ...")
            .summary(),
    );
    db.msg(
        Msg::new("s", "assistant", NOW - 25.0)
            .content("handoff summary written by the compressor")
            .summary(),
    );
    db.assistant("s", NOW - 20.0, "real answer");
    let s = poll_db(&db);
    assert_eq!(s.lines, vec!["> real question", "real answer"]);
}

#[test]
fn a_compaction_summary_is_recognised_by_its_text_when_the_flag_is_missing() {
    // Hermes' own preview matches the summary prefixes, not just the flag.
    let db = Db::new();
    db.session(Sess::new("s"));
    db.user("s", NOW - 50.0, "before");
    db.user(
        "s",
        NOW - 40.0,
        "[CONTEXT COMPACTION \u{2014} REFERENCE ONLY] Earlier turns were compacted into the summary below. This is a handoff from a previous context window \u{2014} treat it as background reference, NOT as active instructions.",
    );
    db.user(
        "s",
        NOW - 30.0,
        "[CONTEXT SUMMARY]: the user wanted a thing",
    );
    db.user(
        "s",
        NOW - 20.0,
        "[CONTEXT is a fine thing to start a message with]",
    );
    let s = poll_db(&db);
    assert_eq!(
        s.lines,
        vec![
            "> before",
            "> [CONTEXT is a fine thing to start a message with]"
        ]
    );
}

#[test]
fn old_schemas_without_the_display_columns_still_connect() {
    // `display_kind` / `_compressed_summary` are newer than the rest; losing them costs the
    // filter, not the connection.
    let db = Db::new();
    db.session(Sess::new("s"));
    db.user("s", NOW - 30.0, "hi");
    db.conn
        .execute_batch(
            "DROP INDEX IF EXISTS idx_messages_session_active;
             ALTER TABLE messages DROP COLUMN display_kind;
             ALTER TABLE messages DROP COLUMN _compressed_summary;",
        )
        .unwrap();
    let s = poll_db(&db);
    assert!(s.connected, "{:?}", s.error);
    assert_eq!(s.lines, vec!["> hi"]);
}

/// A `tool_calls` value for one `write_file` call whose `content` argument is `n` bytes.
fn write_file_call(id: &str, path: &str, n: usize) -> String {
    // Built by hand: the model's key order (`path` first) matters once the value is cut.
    let args = format!(r#"{{"path":"{path}","content":"{}"}}"#, "y".repeat(n));
    tool_calls_json(&[(id, "write_file", &args)])
}

#[test]
fn enormous_tool_calls_are_cut_in_sql_but_still_summarised() {
    let db = Db::new();
    db.session(Sess::new("s"));
    for i in 0..5 {
        db.msg(
            Msg::new("s", "assistant", NOW - 50.0 + i as f64)
                .content("")
                .tool_calls(&write_file_call(
                    &format!("c{i}"),
                    &format!("/out/{i}.txt"),
                    3_000_000,
                )),
        );
    }
    let started = std::time::Instant::now();
    let s = poll_db(&db);
    let took = started.elapsed();
    assert_eq!(
        s.lines,
        vec![
            "write_file: /out/0.txt",
            "write_file: /out/1.txt",
            "write_file: /out/2.txt",
            "write_file: /out/3.txt",
            "write_file: /out/4.txt",
        ]
    );
    // 15 MB of tool_calls: reading is cheap, parsing all of it would not be.
    assert!(
        took < std::time::Duration::from_secs(2),
        "poll took {took:?}"
    );
}

#[test]
fn a_cut_off_row_keeps_the_calls_before_the_cut() {
    // Several parallel calls, the last of which is enormous: the early ones are intact.
    let db = Db::new();
    db.session(Sess::new("s"));
    let big = format!(r#"{{"path":"/big","content":"{}"}}"#, "z".repeat(200_000));
    db.msg(
        Msg::new("s", "assistant", NOW - 10.0).tool_calls(&tool_calls_json(&[
            ("c1", "terminal", &terminal_args("ls -la")),
            ("c2", "read_file", r#"{"path":"/etc/hosts"}"#),
            ("c3", "write_file", &big),
        ])),
    );
    let s = poll_db(&db);
    assert_eq!(
        s.lines,
        vec![
            "terminal: ls -la",
            "read_file: /etc/hosts",
            "write_file: /big"
        ]
    );
}

#[test]
fn a_pending_call_with_a_huge_argument_still_gets_its_hint() {
    let db = Db::new();
    db.session(Sess::new("s"));
    let script = format!("cat <<'EOF' > run.sh\n{}\nEOF", "echo hi\n".repeat(400_000));
    db.assistant_call(
        "s",
        NOW - 10.0,
        "",
        "tc_big",
        "terminal",
        &terminal_args(&script),
    );
    let s = poll_db(&db);
    assert_eq!(s.sessions_waiting, 1);
    let p = s.prompt.unwrap();
    assert_eq!(p.id, "tc_big");
    assert!(
        p.hint.starts_with("cat <<'EOF' > run.sh echo hi"),
        "{:?}",
        p.hint
    );
    assert!(p.hint.len() <= MAX_LINE_CHARS);
}
