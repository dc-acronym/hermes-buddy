//! `Watcher`: owns the cross-poll state (which jobs were running, the previous transcript, the
//! line generation) and turns a [`db::Data`] read into a [`HermesSnapshot`]. It holds no
//! database connection: each poll opens its own and closes it again (see [`db::read`]).

use std::collections::HashSet;
use std::fs;
use std::io::ErrorKind;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::db::{self, Data, Failure, PendingCall};
use crate::lineage::{self, Member};
use crate::snapshot::{HermesSnapshot, PendingPrompt};
use crate::text::{
    clean, row_lines, tool_hint, truncate_chars, MAX_LINES, MAX_LINE_CHARS, MAX_MODEL_CHARS,
    MAX_MSG_CHARS, MAX_TOOL_CHARS,
};

/// `SESSION_ACTIVITY_HEARTBEAT_MIN_INTERVAL_SECONDS` in Hermes `agent/session_activity.py`
/// (line 21): the minimum gap between durable `sessions.last_activity_at` writes by a live agent.
const HERMES_ACTIVITY_HEARTBEAT_SECS: f64 = 60.0;

/// A session counts as running while it is open and its last durable activity is at most this
/// old: `max(60, 2 x heartbeat + 15)` = 135 s. Two missed heartbeats plus slack, so a live agent
/// that writes every >= 60 s never flickers out of "running" between heartbeats.
pub fn running_window_secs() -> f64 {
    f64::max(60.0, 2.0 * HERMES_ACTIVITY_HEARTBEAT_SECS + 15.0)
}

/// Shown when there is no connection (matches the UI's initial `emptyTama().msg`).
const MSG_DISCONNECTED: &str = "No Hermes connected";

/// Where Hermes keeps `state.db` by default, mirroring `hermes_constants.get_hermes_home()`:
///
/// 1. `$HERMES_HOME/state.db` when `HERMES_HOME` is set and non-empty (a leading `~` expands);
/// 2. else the platform default: `%LOCALAPPDATA%\hermes` on Windows, `~/.hermes` elsewhere,
///    with `$HERMES_DATA_DIR_SUFFIX` appended to the directory name when set.
pub fn default_db_path() -> PathBuf {
    resolve_default(
        std::env::var("HERMES_HOME").ok().as_deref(),
        std::env::var("HERMES_DATA_DIR_SUFFIX").ok().as_deref(),
        dirs::home_dir(),
        dirs::data_local_dir(),
        cfg!(windows),
    )
}

/// [`default_db_path`] with its inputs made explicit (for tests).
pub(crate) fn resolve_default(
    hermes_home: Option<&str>,
    dir_suffix: Option<&str>,
    home: Option<PathBuf>,
    local_appdata: Option<PathBuf>,
    windows: bool,
) -> PathBuf {
    let home_dir = || home.clone().unwrap_or_else(|| PathBuf::from("."));
    if let Some(h) = hermes_home.map(str::trim).filter(|h| !h.is_empty()) {
        let expanded = if h == "~" {
            home_dir()
        } else if let Some(rest) = h.strip_prefix("~/").or_else(|| h.strip_prefix("~\\")) {
            home_dir().join(rest)
        } else {
            PathBuf::from(h)
        };
        return expanded.join("state.db");
    }
    let suffix = dir_suffix.unwrap_or("");
    let dir = if windows {
        let base = local_appdata.unwrap_or_else(|| home_dir().join("AppData").join("Local"));
        base.join(format!("hermes{suffix}"))
    } else {
        home_dir().join(format!(".hermes{suffix}"))
    };
    dir.join("state.db")
}

/// Polls a Hermes `state.db` and produces [`HermesSnapshot`]s.
///
/// Read-only and watch-only: the file is opened `SQLITE_OPEN_READ_ONLY`, never created, nothing
/// is created next to it, and no connection (so no descriptor on `state.db`, `-wal` or `-shm`) is
/// kept between polls, so Hermes never sees the watcher as a holder of its database.
pub struct Watcher {
    override_path: Option<PathBuf>,
    /// Jobs that were running at the previous successful poll (see [`lineage::Memory`]).
    prev_running: lineage::Memory,
    prev_lines: Vec<String>,
    line_gen: u64,
}

impl Watcher {
    pub fn new(override_path: Option<PathBuf>) -> Self {
        Self {
            override_path,
            prev_running: lineage::Memory::new(),
            prev_lines: Vec::new(),
            line_gen: 0,
        }
    }

    /// Change (or clear, with `None`) the db path override. A different resolved path drops the
    /// running-set memory so a switch never reads as "a session completed".
    pub fn set_path(&mut self, p: Option<PathBuf>) {
        let before = self.resolved_path();
        self.override_path = p;
        if self.resolved_path() != before {
            self.prev_running.clear();
        }
    }

    /// The override if set, else [`default_db_path`].
    pub fn resolved_path(&self) -> PathBuf {
        self.override_path.clone().unwrap_or_else(default_db_path)
    }

    /// Read the database once. Never panics: every failure becomes `connected: false` plus an
    /// `error` string.
    pub fn poll(&mut self) -> HermesSnapshot {
        let now_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        self.poll_at(now_ms)
    }

    /// [`poll`](Self::poll) against an explicit clock (epoch ms). Public for deterministic tests
    /// of the time-window rules; not part of the app-facing API.
    #[doc(hidden)]
    pub fn poll_at(&mut self, now_ms: u64) -> HermesSnapshot {
        let path = self.resolved_path();
        let now = now_ms as f64 / 1000.0;
        let base = HermesSnapshot {
            db_path: path.display().to_string(),
            polled_at: now_ms,
            msg: MSG_DISCONNECTED.to_string(),
            ..HermesSnapshot::default()
        };

        // `poll` promises never to panic (the app calls it from a background thread), so even an
        // unexpected bug degrades to "not connected" instead of taking the poller down.
        let outcome = catch_unwind(AssertUnwindSafe(|| {
            let data = read(&path, now)?;
            let mut snap = base.clone();
            self.fill(&mut snap, data, now);
            Ok::<_, Failure>(snap)
        }));
        let mut snap = match outcome {
            Ok(Ok(snap)) => snap,
            Ok(Err(failure)) => HermesSnapshot {
                error: Some(failure.message()),
                schema_version: failure.schema_version(),
                ..base
            },
            Err(_) => HermesSnapshot {
                error: Some("internal error while reading state.db".to_string()),
                ..base
            },
        };

        // `lines` is empty on failure; the same compare-and-bump keeps lineGen honest across
        // an outage (the UI sees the lines vanish and come back as changes).
        if snap.lines != self.prev_lines {
            self.line_gen += 1;
            self.prev_lines = snap.lines.clone();
        }
        snap.line_gen = self.line_gen;
        snap
    }

    /// Turn one successful read into the snapshot, updating the cross-poll memory.
    fn fill(&mut self, snap: &mut HermesSnapshot, data: Data, now: f64) {
        let window = running_window_secs();
        let is_running = |s: &db::SessionRow| s.open && s.act >= now - window;
        let members: Vec<Member> = data
            .sessions
            .iter()
            .map(|s| Member {
                id: s.id.clone(),
                root: s.root.clone(),
                subagent: s.subagent,
                running: is_running(s),
                started: s.started,
                end_reason: s.end_reason.clone(),
            })
            .collect();
        // Jobs, not rows: a compression rollover is one conversation, a subagent is part of its
        // parent's work, and neither ending is a session finishing.
        let tally = lineage::tally(&members, &self.prev_running);
        let running = data.sessions.iter().filter(|s| is_running(s));

        snap.connected = true;
        snap.schema_version = data.schema_version;
        snap.sessions_total = clamp_u32(tally.total);
        snap.sessions_running = clamp_u32(tally.running);
        snap.recently_completed = tally.completed;
        snap.tokens_today = data.tokens_today;
        snap.tokens_lifetime = data.tokens_lifetime;

        let pending = dedupe_pending(&data.pending);
        snap.sessions_waiting = clamp_u32(pending.len());
        snap.prompt = pending.first().copied().map(prompt_of);

        snap.msg = match (&snap.prompt, db::newest_session(running)) {
            (Some(p), _) => clean(&format!("waiting: {}", p.tool), MAX_MSG_CHARS),
            (None, Some(s)) => {
                let d = clean(&s.description, MAX_MSG_CHARS);
                if d.is_empty() {
                    "working".to_string()
                } else {
                    d
                }
            }
            (None, None) => "idle".to_string(),
        };

        snap.model = data
            .newest
            .as_ref()
            .map(|n| short_model(&n.model))
            .unwrap_or_default();
        snap.lines = transcript_lines(&data);

        self.prev_running = tally.next;
    }
}

/// Check the file is there, then read it with a fresh connection that is gone again on return.
fn read(path: &Path, now: f64) -> Result<Data, Failure> {
    match fs::metadata(path) {
        Ok(md) if md.is_file() => {}
        Ok(_) => return Err(Failure::NotFound(path.to_path_buf())),
        Err(e) if e.kind() == ErrorKind::NotFound => {
            return Err(Failure::NotFound(path.to_path_buf()))
        }
        Err(e) => return Err(Failure::Sql(format!("cannot read state.db: {e}"))),
    }
    db::read(path, now)
}

fn clamp_u32(n: usize) -> u32 {
    u32::try_from(n).unwrap_or(u32::MAX)
}

/// Pending calls in oldest-first order, one per `(session, tool call id)`. (Context compression
/// can clone recent rows, so the same call id may appear on two active rows.)
fn dedupe_pending(calls: &[PendingCall]) -> Vec<&PendingCall> {
    let mut sorted: Vec<&PendingCall> = calls.iter().collect();
    sorted.sort_by(|a, b| {
        a.timestamp
            .total_cmp(&b.timestamp)
            .then(a.message_id.cmp(&b.message_id))
            .then(a.index.cmp(&b.index))
    });
    let mut seen = HashSet::new();
    sorted.retain(|c| seen.insert((c.session_id.as_str(), c.call_id.as_str())));
    sorted
}

fn prompt_of(c: &PendingCall) -> PendingPrompt {
    PendingPrompt {
        id: c.call_id.clone(),
        tool: clean(&c.tool, MAX_TOOL_CHARS),
        hint: clean(&tool_hint(&c.tool, &c.arguments), MAX_LINE_CHARS),
    }
}

/// `model` for the stick: at most 15 ASCII chars. A provider prefix (`anthropic/claude-...`) is
/// dropped first, but only when the name would not otherwise fit.
fn short_model(model: &str) -> String {
    let m = clean(model, 200);
    if m.chars().count() > MAX_MODEL_CHARS {
        if let Some((_, tail)) = m.rsplit_once('/') {
            if !tail.is_empty() {
                return clean(tail, MAX_MODEL_CHARS);
            }
        }
    }
    clean(&m, MAX_MODEL_CHARS)
}

/// Up to 8 lines from the newest-first transcript rows, oldest first.
fn transcript_lines(data: &Data) -> Vec<String> {
    let mut newest_first: Vec<String> = Vec::with_capacity(MAX_LINES);
    'rows: for row in &data.transcript {
        let mut lines = row_lines(&row.role, row.content.as_deref(), row.tool_calls.as_deref());
        lines.reverse();
        for l in lines {
            newest_first.push(truncate_chars(&l, MAX_LINE_CHARS).to_string());
            if newest_first.len() == MAX_LINES {
                break 'rows;
            }
        }
    }
    newest_first.reverse();
    newest_first
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn window_is_135s() {
        assert_eq!(running_window_secs(), 135.0);
    }

    #[test]
    fn default_path_matrix() {
        let home = Some(PathBuf::from("/home/u"));
        let lad = Some(PathBuf::from("/lad"));
        let p = |h, s, w| resolve_default(h, s, home.clone(), lad.clone(), w);
        assert_eq!(
            p(Some("/x/hh"), None, false),
            PathBuf::from("/x/hh/state.db")
        );
        assert_eq!(
            p(Some("  /x/hh "), None, true),
            PathBuf::from("/x/hh/state.db")
        );
        assert_eq!(
            p(Some("~/prof"), None, false),
            PathBuf::from("/home/u/prof/state.db")
        );
        assert_eq!(p(Some("~"), None, false), PathBuf::from("/home/u/state.db"));
        assert_eq!(
            p(Some(""), None, false),
            PathBuf::from("/home/u/.hermes/state.db")
        );
        assert_eq!(
            p(None, None, false),
            PathBuf::from("/home/u/.hermes/state.db")
        );
        assert_eq!(
            p(None, Some("-dev"), false),
            PathBuf::from("/home/u/.hermes-dev/state.db")
        );
        assert_eq!(p(None, None, true), PathBuf::from("/lad/hermes/state.db"));
        assert_eq!(
            p(None, Some("-dev"), true),
            PathBuf::from("/lad/hermes-dev/state.db")
        );
        assert_eq!(
            resolve_default(None, None, home.clone(), None, true),
            PathBuf::from("/home/u/AppData/Local/hermes/state.db")
        );
    }

    #[test]
    fn model_shortening() {
        assert_eq!(short_model("claude-opus-4-5"), "claude-opus-4-5");
        assert_eq!(short_model("anthropic/claude-opus-4.5"), "claude-opus-4.5");
        assert_eq!(
            short_model("a-very-long-model-name-without-slash"),
            "a-very-long-mod"
        );
        assert_eq!(short_model("ge\u{e9}ma"), "ge?ma");
        assert_eq!(short_model(""), "");
    }
}
