//! Which `sessions` rows are one piece of *work*, and when work counts as *finished*.
//!
//! Hermes stores one row per session, but a single job can span several rows:
//!
//! * **Context compression** ends the parent with `end_reason = 'compression'` and publishes a
//!   child row (`parent_session_id` = the parent) that carries on the same conversation
//!   (`hermes_state_compression.py`, `publish_compression_child`).
//! * **Subagents** (`delegate_task`) are rows whose `parent_session_id` is the live parent
//!   (`tools/delegate_tool.py`); Hermes calls them "ephemeral children" and keeps them out of
//!   its own session lists (`_ephemeral_child_sql`).
//! * **Branch** (`/branch`) and **reset** (`/new`, idle/daily) children also carry a
//!   `parent_session_id`, but start a *separate* conversation, so they are their own job.
//!
//! The classification below mirrors Hermes's `_ephemeral_child_sql` / `_non_continuation_child_sql`
//! (`hermes_state_common.py`), including the legacy heuristics for rows written before the
//! `model_config` markers existed. A "job" is a root row plus everything linked to it by a
//! compression-continuation or subagent edge.

use std::collections::{HashMap, HashSet};

/// Hops followed when walking up to a job's root (guards against a corrupt `parent_session_id`
/// cycle; real chains are a handful of rows).
pub const MAX_DEPTH: usize = 64;

/// What the pet needs to know about a session's parent link. Read straight from `state.db`.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Facts {
    pub parent: Option<String>,
    pub parent_end_reason: Option<String>,
    pub parent_ended_at: Option<f64>,
    pub started_at: f64,
    pub session_key: Option<String>,
    pub parent_session_key: Option<String>,
    /// `model_config._branched_from` / `._delegate_from` / `._reset_from`: the row a fork or
    /// subagent was made from. A marker only counts when it names *this* row's parent
    /// (compression continuations inherit `model_config`, so an older marker is inherited, not a
    /// fork).
    pub branched_from: Option<String>,
    pub delegate_from: Option<String>,
    pub reset_from: Option<String>,
}

/// How a session relates to its parent row.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Relation {
    /// No parent, or a branch/reset fork: its own conversation.
    Root,
    /// The compression child of its parent: the same conversation, continued.
    Continuation,
    /// A subagent of its parent: part of the parent's job, but not a conversation of its own.
    Subagent,
}

/// `p.end_reason` values after which a child with the same `session_key` is a reset child
/// (`_RESET_END_REASONS` in `hermes_state_common.py`).
const RESET_END_REASONS: &[&str] = &[
    "session_reset",
    "session_switch",
    "idle",
    "daily",
    "suspended",
    "resume_pending_expired",
];

impl Facts {
    pub fn relation(&self) -> Relation {
        let Some(parent) = self.parent.as_deref() else {
            return Relation::Root;
        };
        // Forks made on purpose are conversations of their own.
        if self.branched_from.as_deref() == Some(parent)
            || self.reset_from.as_deref() == Some(parent)
        {
            return Relation::Root;
        }
        if self.delegate_from.as_deref() == Some(parent) {
            return Relation::Subagent;
        }
        let parent_end = self.parent_end_reason.as_deref();
        // Rows from before the markers: a branch child starts after its parent was ended
        // 'branched'; a reset child shares the parent's non-empty routing key.
        if parent_end == Some("branched")
            && self
                .parent_ended_at
                .is_some_and(|ended| self.started_at >= ended)
        {
            return Relation::Root;
        }
        let key = self.session_key.as_deref().filter(|k| !k.is_empty());
        if key.is_some()
            && key == self.parent_session_key.as_deref()
            && parent_end.is_some_and(|r| RESET_END_REASONS.contains(&r))
        {
            return Relation::Root;
        }
        if parent_end == Some("compression") {
            return Relation::Continuation;
        }
        // Everything else with a parent is an ephemeral child (a subagent run).
        Relation::Subagent
    }

    /// The parent this row belongs to for the purpose of grouping, if any.
    pub fn link(&self) -> Option<String> {
        match self.relation() {
            Relation::Root => None,
            Relation::Continuation | Relation::Subagent => self.parent.clone(),
        }
    }
}

/// Follow links from `id` up to its job's root. `link_of(x)` is `x`'s parent when `x` is a
/// continuation or subagent, `None` for a root (or an unknown row).
pub fn root_of(id: &str, mut link_of: impl FnMut(&str) -> Option<String>) -> String {
    let mut cur = id.to_string();
    let mut seen = HashSet::new();
    for _ in 0..MAX_DEPTH {
        if !seen.insert(cur.clone()) {
            break; // a cycle in corrupt data
        }
        match link_of(&cur) {
            Some(parent) => cur = parent,
            None => break,
        }
    }
    cur
}

/// Does a session that ended with `reason` count as work that *finished*?
///
/// * `None`: it went quiet (or was ended without a reason): finished.
/// * `compression`, `branched`: handed over to a child row, the work goes on.
/// * `ws_disconnect`, `ws_orphan_reap`, `startup_orphan_reap`, `superseded_by_resume`,
///   `tui_shutdown`, `idle_timeout`, `lru_evict` (Hermes's "automatic cleanup" set,
///   `is_automatic_end_reason`) and `adopted_by_profile`: the runtime went away or the row was
///   moved; nothing finished.
/// * `agent_close` is in Hermes's automatic set too, but it is also how every one-shot agent run
///   (`hermes -q ...`, a gateway turn) closes its row, so it counts as finished.
/// * Everything else (`cli_close`, `user_exit`, `new_session`, `session_reset`, ...) is a
///   deliberate end: finished.
pub fn end_means_finished(reason: Option<&str>) -> bool {
    !matches!(
        reason,
        Some(
            "compression"
                | "branched"
                | "ws_disconnect"
                | "ws_orphan_reap"
                | "startup_orphan_reap"
                | "superseded_by_resume"
                | "tui_shutdown"
                | "idle_timeout"
                | "lru_evict"
                | "adopted_by_profile"
        )
    )
}

/// The slice of a session row that job accounting needs.
#[derive(Debug, Clone, PartialEq)]
pub struct Member {
    pub id: String,
    /// The job's root row id (see [`root_of`]).
    pub root: String,
    pub subagent: bool,
    /// Currently running: open, with activity inside the running window.
    pub running: bool,
    pub started: f64,
    pub end_reason: Option<String>,
}

/// Per-job memory carried between polls: `true` once a top-level (non-subagent) session has been
/// part of the job's current stretch of activity.
pub type Memory = HashMap<String, bool>;

#[derive(Debug, Default, PartialEq)]
pub struct Tally {
    /// Distinct jobs seen in the candidate set.
    pub total: usize,
    /// Distinct jobs with at least one running member.
    pub running: usize,
    /// A job that was running at the previous poll has finished.
    pub completed: bool,
    pub next: Memory,
}

/// Count jobs and detect a completion.
///
/// A job is running while any of its sessions is. It has *completed* when it was running at the
/// previous poll, is not now, a top-level session took part in it (a lone subagent going quiet
/// while its parent waits is not the end of anything), and the job's last top-level session
/// ended in a way that means "finished" ([`end_means_finished`]).
pub fn tally(members: &[Member], prev: &Memory) -> Tally {
    let mut roots: HashSet<&str> = HashSet::new();
    let mut running: HashMap<&str, bool> = HashMap::new();
    for m in members {
        roots.insert(m.root.as_str());
        if m.running {
            let top = running.entry(m.root.as_str()).or_insert(false);
            *top |= !m.subagent;
        }
    }

    let mut next = Memory::new();
    for (root, top_now) in &running {
        let top = *top_now || prev.get(*root).copied().unwrap_or(false);
        next.insert((*root).to_string(), top);
    }

    let completed = prev
        .iter()
        .filter(|(root, top)| **top && !running.contains_key(root.as_str()))
        .any(|(root, _)| job_finished(members, root));

    Tally {
        total: roots.len(),
        running: running.len(),
        completed,
        next,
    }
}

/// The job's last top-level session (latest start) ended in a finishing way. A job with no
/// top-level row in view (deleted, or aged out of the window) cannot be judged: not finished.
fn job_finished(members: &[Member], root: &str) -> bool {
    members
        .iter()
        .filter(|m| m.root == root && !m.subagent)
        .max_by(|a, b| {
            a.started
                .total_cmp(&b.started)
                .then_with(|| a.id.cmp(&b.id))
        })
        .is_some_and(|tip| end_means_finished(tip.end_reason.as_deref()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn facts(parent: Option<&str>) -> Facts {
        Facts {
            parent: parent.map(str::to_string),
            started_at: 100.0,
            ..Facts::default()
        }
    }

    #[test]
    fn relations() {
        assert_eq!(facts(None).relation(), Relation::Root);
        // A bare child of a live parent is a subagent.
        assert_eq!(facts(Some("p")).relation(), Relation::Subagent);
        // Compression continuation.
        let c = Facts {
            parent_end_reason: Some("compression".into()),
            ..facts(Some("p"))
        };
        assert_eq!(c.relation(), Relation::Continuation);
        // A delegate marker naming the parent wins over a parent that later compressed.
        let d = Facts {
            delegate_from: Some("p".into()),
            ..c.clone()
        };
        assert_eq!(d.relation(), Relation::Subagent);
        // ...but one naming some other (older) row is inherited, not a fork.
        let inherited = Facts {
            delegate_from: Some("someone-else".into()),
            ..c.clone()
        };
        assert_eq!(inherited.relation(), Relation::Continuation);
        // Forks.
        for fork in [
            Facts {
                branched_from: Some("p".into()),
                ..facts(Some("p"))
            },
            Facts {
                reset_from: Some("p".into()),
                ..facts(Some("p"))
            },
        ] {
            assert_eq!(fork.relation(), Relation::Root);
        }
        // Pre-marker branch child.
        let legacy_branch = Facts {
            parent_end_reason: Some("branched".into()),
            parent_ended_at: Some(99.0),
            ..facts(Some("p"))
        };
        assert_eq!(legacy_branch.relation(), Relation::Root);
        let before_the_branch = Facts {
            parent_ended_at: Some(101.0),
            ..legacy_branch
        };
        assert_eq!(before_the_branch.relation(), Relation::Subagent);
        // Pre-marker reset child: same non-empty routing key under a reset-class end_reason.
        let legacy_reset = Facts {
            parent_end_reason: Some("idle".into()),
            session_key: Some("agent:tg:42".into()),
            parent_session_key: Some("agent:tg:42".into()),
            ..facts(Some("p"))
        };
        assert_eq!(legacy_reset.relation(), Relation::Root);
        let empty_key = Facts {
            session_key: Some(String::new()),
            parent_session_key: Some(String::new()),
            ..legacy_reset
        };
        assert_eq!(empty_key.relation(), Relation::Subagent);
    }

    #[test]
    fn links() {
        assert_eq!(facts(None).link(), None);
        assert_eq!(facts(Some("p")).link().as_deref(), Some("p"));
        let fork = Facts {
            branched_from: Some("p".into()),
            ..facts(Some("p"))
        };
        assert_eq!(fork.link(), None);
    }

    #[test]
    fn roots_follow_links_and_stop_at_cycles() {
        let links: HashMap<&str, &str> = HashMap::from([("c", "b"), ("b", "a")]);
        let lookup = |id: &str| links.get(id).map(|p| (*p).to_string());
        assert_eq!(root_of("c", lookup), "a");
        assert_eq!(root_of("a", lookup), "a");
        assert_eq!(root_of("zzz", lookup), "zzz");
        let cyc: HashMap<&str, &str> = HashMap::from([("x", "y"), ("y", "x")]);
        let r = root_of("x", |id| cyc.get(id).map(|p| (*p).to_string()));
        assert!(r == "x" || r == "y");
    }

    #[test]
    fn end_reasons() {
        for finished in [
            None,
            Some("cli_close"),
            Some("agent_close"),
            Some("user_exit"),
            Some("???"),
        ] {
            assert!(end_means_finished(finished), "{finished:?}");
        }
        for not in [
            "compression",
            "branched",
            "ws_disconnect",
            "tui_shutdown",
            "lru_evict",
        ] {
            assert!(!end_means_finished(Some(not)), "{not}");
        }
    }

    fn m(id: &str, root: &str, subagent: bool, running: bool, reason: Option<&str>) -> Member {
        Member {
            id: id.into(),
            root: root.into(),
            subagent,
            running,
            started: 0.0,
            end_reason: reason.map(str::to_string),
        }
    }

    #[test]
    fn tally_counts_jobs_not_rows() {
        let members = [
            m("a", "a", false, false, Some("compression")),
            m("b", "a", false, true, None),
            m("s", "a", true, true, None),
            m("z", "z", false, false, Some("cli_close")),
        ];
        let t = tally(&members, &Memory::new());
        assert_eq!((t.total, t.running, t.completed), (2, 1, false));
        assert_eq!(t.next, Memory::from([("a".to_string(), true)]));
    }

    #[test]
    fn tally_completion_needs_a_top_level_member_and_a_finishing_end() {
        let prev = Memory::from([("a".to_string(), true)]);
        let done = [m("a", "a", false, false, Some("cli_close"))];
        assert!(tally(&done, &prev).completed);
        let vanished = [m("a", "a", false, false, Some("ws_disconnect"))];
        assert!(!tally(&vanished, &prev).completed);
        assert!(!tally(&[], &prev).completed, "gone from view");
        let sub_only = Memory::from([("a".to_string(), false)]);
        assert!(!tally(&done, &sub_only).completed);
        // Still running somewhere in the job: not done.
        let more = [
            m("a", "a", false, false, Some("cli_close")),
            m("s", "a", true, true, None),
        ];
        assert!(!tally(&more, &prev).completed);
        // ...and the top-level flag sticks while the job stays active.
        let t = tally(&more, &prev);
        assert_eq!(t.next, Memory::from([("a".to_string(), true)]));
    }
}
