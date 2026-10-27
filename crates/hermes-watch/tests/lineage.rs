//! `sessionsRunning`, `sessionsTotal` and `recentlyCompleted` count *work*, not rows:
//! context compression rolls one conversation over into a child row, and subagents are rows with
//! a `parent_session_id`. Neither is a session finishing.

mod common;

use common::*;
use hermes_watch::{HermesSnapshot, Watcher};

fn poll(w: &mut Watcher) -> HermesSnapshot {
    let s = w.poll_at(NOW_MS);
    assert!(s.connected, "{:?}", s.error);
    s
}

fn end(db: &Db, id: &str, reason: Option<&str>) {
    db.conn
        .execute(
            "UPDATE sessions SET ended_at = ?1, end_reason = ?2 WHERE id = ?3",
            rusqlite::params![NOW - 1.0, reason, id],
        )
        .unwrap();
}

#[test]
fn compression_rollover_is_not_a_completion() {
    let db = Db::new();
    db.session(Sess::new("parent"));
    let mut w = Watcher::new(Some(db.path.clone()));
    assert_eq!(poll(&mut w).sessions_running, 1);

    // Hermes publishes the child and ends the parent with end_reason = 'compression', together.
    db.session(Sess::compression_child_of("child", "parent"));
    end(&db, "parent", Some("compression"));

    let s = poll(&mut w);
    assert!(
        !s.recently_completed,
        "a rollover is the same job continuing"
    );
    assert_eq!(
        s.sessions_running, 1,
        "parent + continuation is one running job"
    );
    assert_eq!(s.sessions_total, 1, "...and one session today");
    assert!(!poll(&mut w).recently_completed);

    // The continuation really finishing is a completion.
    end(&db, "child", Some("cli_close"));
    let s = poll(&mut w);
    assert!(s.recently_completed, "the conversation ended");
    assert_eq!(s.sessions_running, 0);
    assert!(!poll(&mut w).recently_completed, "one-poll pulse");
}

#[test]
fn a_compression_end_reason_alone_is_never_a_completion() {
    // Even when the continuation row is out of the watcher's sight (here: hidden), "compression"
    // says "handed over", not "finished".
    let db = Db::new();
    db.session(Sess::new("parent"));
    let mut w = Watcher::new(Some(db.path.clone()));
    assert_eq!(poll(&mut w).sessions_running, 1);
    db.session(Sess {
        hidden: 1,
        ..Sess::compression_child_of("child", "parent")
    });
    end(&db, "parent", Some("compression"));
    let s = poll(&mut w);
    assert!(!s.recently_completed);
    assert_eq!(s.sessions_running, 0);
}

#[test]
fn a_continuation_that_goes_quiet_is_a_completion_like_any_quiet_session() {
    let db = Db::new();
    db.session(Sess::new("parent"));
    let mut w = Watcher::new(Some(db.path.clone()));
    assert_eq!(poll(&mut w).sessions_running, 1);
    db.session(Sess::compression_child_of("child", "parent"));
    end(&db, "parent", Some("compression"));
    assert!(!poll(&mut w).recently_completed);
    // Five minutes later nothing has happened in the child.
    let s = w.poll_at(NOW_MS + 300_000);
    assert_eq!(s.sessions_running, 0);
    assert!(s.recently_completed);
}

#[test]
fn a_chain_of_compressions_counts_once() {
    let db = Db::new();
    for (id, parent) in [("a", None), ("b", Some("a")), ("c", Some("b"))] {
        let sess = match parent {
            None => Sess::new(id).ended(NOW - 100.0, Some("compression")),
            Some(p) if id == "c" => Sess::compression_child_of(id, p),
            Some(p) => Sess {
                started_at: NOW - 300.0,
                last_activity_at: Some(NOW - 100.0),
                ..Sess::compression_child_of(id, p).ended(NOW - 100.0, Some("compression"))
            },
        };
        db.session(sess);
    }
    let mut w = Watcher::new(Some(db.path.clone()));
    let s = poll(&mut w);
    assert_eq!(s.sessions_total, 1, "a -> b -> c is one conversation");
    assert_eq!(s.sessions_running, 1);
}

#[test]
fn a_subagent_and_its_parent_are_one_running_job() {
    let db = Db::new();
    db.session(Sess::new("parent"));
    db.session(Sess::subagent_of("sub", "parent"));
    let mut w = Watcher::new(Some(db.path.clone()));
    let s = poll(&mut w);
    assert_eq!(s.sessions_running, 1, "parent + subagent = 1");
    assert_eq!(s.sessions_total, 1);
}

#[test]
fn a_subagent_ending_mid_task_is_not_a_completion() {
    let db = Db::new();
    db.session(Sess::new("parent"));
    db.session(Sess::subagent_of("sub", "parent"));
    let mut w = Watcher::new(Some(db.path.clone()));
    assert_eq!(poll(&mut w).sessions_running, 1);

    end(&db, "sub", Some("agent_close"));
    let s = poll(&mut w);
    assert!(!s.recently_completed, "the parent is still working");
    assert_eq!(s.sessions_running, 1);

    // The parent finishing is.
    end(&db, "parent", Some("cli_close"));
    let s = poll(&mut w);
    assert!(s.recently_completed);
    assert_eq!(s.sessions_running, 0);
}

#[test]
fn a_subagent_without_the_marker_is_still_a_subagent() {
    // Older rows / other spawners: just a parent_session_id on a live parent.
    let db = Db::new();
    db.session(Sess::new("parent"));
    db.session(Sess {
        parent: Some("parent".into()),
        ..Sess::new("sub")
    });
    let mut w = Watcher::new(Some(db.path.clone()));
    assert_eq!(poll(&mut w).sessions_running, 1);
    end(&db, "sub", None);
    let s = poll(&mut w);
    assert!(!s.recently_completed);
    assert_eq!(s.sessions_running, 1);
}

#[test]
fn a_parent_finishing_before_its_straggling_subagent_still_celebrates_once() {
    let db = Db::new();
    db.session(Sess::new("parent"));
    db.session(Sess::subagent_of("sub", "parent"));
    let mut w = Watcher::new(Some(db.path.clone()));
    assert_eq!(poll(&mut w).sessions_running, 1);

    end(&db, "parent", Some("cli_close"));
    let s = poll(&mut w);
    assert!(!s.recently_completed, "the subagent is still running");
    assert_eq!(s.sessions_running, 1);

    end(&db, "sub", Some("agent_close"));
    let s = poll(&mut w);
    assert!(s.recently_completed, "now the whole job is done");
    assert_eq!(s.sessions_running, 0);
    assert!(!poll(&mut w).recently_completed);
}

#[test]
fn a_lone_subagent_going_quiet_is_not_a_completion() {
    // The parent is waiting (stale heartbeat), only the subagent was ever seen running.
    let db = Db::new();
    db.session(Sess {
        last_activity_at: Some(NOW - 600.0),
        ..Sess::new("parent")
    });
    db.session(Sess::subagent_of("sub", "parent"));
    let mut w = Watcher::new(Some(db.path.clone()));
    let s = poll(&mut w);
    assert_eq!(s.sessions_running, 1, "the subagent is work in progress");
    end(&db, "sub", Some("agent_close"));
    let s = poll(&mut w);
    assert!(
        !s.recently_completed,
        "the parent will continue with the result"
    );
    assert_eq!(s.sessions_running, 0);
}

#[test]
fn independent_sessions_count_separately() {
    let db = Db::new();
    db.session(Sess::new("a"));
    db.session(Sess::new("b"));
    let mut w = Watcher::new(Some(db.path.clone()));
    let s = poll(&mut w);
    assert_eq!((s.sessions_running, s.sessions_total), (2, 2));
    end(&db, "a", Some("cli_close"));
    let s = poll(&mut w);
    assert!(s.recently_completed);
    assert_eq!(s.sessions_running, 1);
}

#[test]
fn a_branch_fork_is_its_own_conversation_and_the_original_ending_is_not_a_completion() {
    let db = Db::new();
    db.session(Sess::new("orig"));
    let mut w = Watcher::new(Some(db.path.clone()));
    assert_eq!(poll(&mut w).sessions_running, 1);
    db.session(Sess {
        parent: Some("orig".into()),
        model_config: Some(r#"{"_branched_from":"orig"}"#.into()),
        ..Sess::new("fork")
    });
    end(&db, "orig", Some("branched"));
    let s = poll(&mut w);
    assert!(!s.recently_completed, "'branched' hands over to the fork");
    assert_eq!(s.sessions_running, 1);
    assert_eq!(s.sessions_total, 2, "a fork is a separate conversation");
}

#[test]
fn only_finished_end_reasons_celebrate() {
    // What each end_reason Hermes writes means (see `lineage::end_means_finished`).
    let cases: &[(Option<&str>, bool)] = &[
        (None, true), // went quiet / ended without a reason
        (Some("cli_close"), true),
        (Some("agent_close"), true), // how every one-shot agent run ends
        (Some("user_exit"), true),
        (Some("new_session"), true),
        (Some("session_reset"), true),
        (Some("session_switch"), true),
        (Some("something_new"), true), // unknown: assume the best
        (Some("compression"), false),
        (Some("branched"), false),
        (Some("ws_disconnect"), false), // the runtime went away; the work did not finish
        (Some("ws_orphan_reap"), false),
        (Some("startup_orphan_reap"), false),
        (Some("superseded_by_resume"), false),
        (Some("tui_shutdown"), false),
        (Some("idle_timeout"), false),
        (Some("lru_evict"), false),
        (Some("adopted_by_profile"), false),
    ];
    for (reason, celebrates) in cases {
        let db = Db::new();
        db.session(Sess::new("s"));
        let mut w = Watcher::new(Some(db.path.clone()));
        assert_eq!(poll(&mut w).sessions_running, 1);
        end(&db, "s", *reason);
        let s = poll(&mut w);
        assert_eq!(s.recently_completed, *celebrates, "end_reason = {reason:?}");
        assert_eq!(s.sessions_running, 0, "end_reason = {reason:?}");
    }
}

#[test]
fn a_session_that_goes_quiet_without_an_end_stamp_still_counts_as_done() {
    let db = Db::new();
    db.session(Sess::new("s"));
    let mut w = Watcher::new(Some(db.path.clone()));
    assert_eq!(poll(&mut w).sessions_running, 1);
    let s = w.poll_at(NOW_MS + 300_000);
    assert!(s.recently_completed);
}

#[test]
fn a_deleted_session_is_not_a_completion() {
    let db = Db::new();
    db.session(Sess::new("s"));
    let mut w = Watcher::new(Some(db.path.clone()));
    assert_eq!(poll(&mut w).sessions_running, 1);
    db.conn
        .execute("DELETE FROM sessions WHERE id = 's'", [])
        .unwrap();
    assert!(!poll(&mut w).recently_completed);
}

#[test]
fn the_transcript_follows_the_conversation_not_its_subagent() {
    let db = Db::new();
    db.session(Sess::new("parent"));
    db.user("parent", NOW - 60.0, "research the thing");
    db.session(Sess {
        model: Some("small-sub-model".into()),
        last_activity_at: Some(NOW - 1.0), // fresher than the parent
        ..Sess::subagent_of("sub", "parent")
    });
    db.user("sub", NOW - 2.0, "subagent goal text");
    let mut w = Watcher::new(Some(db.path.clone()));
    let s = poll(&mut w);
    assert_eq!(s.lines, vec!["> research the thing"]);
    assert_eq!(s.model, "claude-opus-4-5");
    assert_eq!(s.sessions_running, 1);
}

#[test]
fn a_dangling_parent_id_is_harmless() {
    let db = Db::new();
    db.conn.execute_batch("PRAGMA foreign_keys = OFF").unwrap();
    db.session(Sess {
        parent: Some("long-gone".into()),
        ..Sess::new("orphan")
    });
    let mut w = Watcher::new(Some(db.path.clone()));
    let s = poll(&mut w);
    assert_eq!((s.sessions_running, s.sessions_total), (1, 1));
}

#[test]
fn a_parent_cycle_cannot_hang_the_poll() {
    let db = Db::new();
    db.conn.execute_batch("PRAGMA foreign_keys = OFF").unwrap();
    db.session(Sess {
        parent: Some("b".into()),
        ..Sess::new("a")
    });
    db.session(Sess {
        parent: Some("a".into()),
        ..Sess::new("b")
    });
    let mut w = Watcher::new(Some(db.path.clone()));
    let s = poll(&mut w);
    assert!(s.sessions_running >= 1);
}

#[test]
fn a_long_ago_parent_outside_the_24h_window_still_groups_its_continuation() {
    // The compression parent's last activity is old, but the child it handed over to is live:
    // the key for "this job" must not change when the parent ages out of the 24 h candidate set.
    let db = Db::new();
    let day = 24.0 * 3600.0;
    db.session(Sess {
        started_at: NOW - 3.0 * day,
        last_activity_at: Some(NOW - 2.0 * day),
        ..Sess::new("ancient").ended(NOW - 2.0 * day, Some("compression"))
    });
    db.session(Sess {
        started_at: NOW - 2.0 * day,
        ..Sess::compression_child_of("current", "ancient")
    });
    let mut w = Watcher::new(Some(db.path.clone()));
    assert_eq!(poll(&mut w).sessions_running, 1);
    assert!(!poll(&mut w).recently_completed);
    // ...and stays steady: the key doesn't flip between polls.
    for _ in 0..3 {
        let s = poll(&mut w);
        assert!(!s.recently_completed);
        assert_eq!(s.sessions_running, 1);
    }
}
