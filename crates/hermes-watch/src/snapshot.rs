//! The snapshot shape handed to the UI (`hermes://snapshot`, camelCase JSON).
//!
//! Mirrors `HermesSnapshot` / `PendingPrompt` in `app/src/data/types.ts`.

use serde::{Deserialize, Serialize};

/// The first unanswered `clarify` / `terminal` tool call (the thing Hermes is waiting on).
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PendingPrompt {
    /// Tool call id (`toolu_...`); ties the prompt to its eventual `tool` result row.
    pub id: String,
    /// Function name: `clarify` or `terminal`.
    pub tool: String,
    /// Short human text: the first question (clarify) or the command (terminal). ASCII.
    pub hint: String,
}

/// Everything the desk pet needs from one poll of `state.db`.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HermesSnapshot {
    /// db opened + schema recognised.
    pub connected: bool,
    /// Why not connected ("state.db not found at ...", "unrecognised Hermes schema (...)", ...).
    pub error: Option<String>,
    /// The resolved path that was (or would be) opened.
    pub db_path: String,
    /// `schema_version.version` when that table exists and has a row.
    pub schema_version: Option<i64>,
    /// Pieces of work with activity in the last 24 h (excluding cron / hidden). A conversation
    /// that context compression rolled over into new session rows, and its subagents, count once.
    pub sessions_total: u32,
    /// Pieces of work with an open session that has activity inside the running window; a parent
    /// and its running subagent are one.
    pub sessions_running: u32,
    /// Unanswered clarify/terminal tool calls (attention).
    pub sessions_waiting: u32,
    /// A piece of work that was running at the previous poll has finished: its last top-level
    /// session went quiet or ended deliberately. Not set by a compression rollover, a subagent
    /// ending mid-task, a fork, or a session cut off by a disconnect (see `lineage`).
    pub recently_completed: bool,
    /// input + output tokens of sessions started since local midnight.
    pub tokens_today: u64,
    /// input + output tokens across all (non-excluded) sessions.
    pub tokens_lifetime: u64,
    /// At most 23 ASCII chars: "waiting: <tool>", the newest running session's activity, or "idle".
    pub msg: String,
    /// At most 8 transcript entries of the newest session, oldest first, each at most 91 ASCII chars.
    pub lines: Vec<String>,
    /// Bumps whenever `lines` differs from the previous poll.
    pub line_gen: u64,
    /// The oldest pending call, if any.
    pub prompt: Option<PendingPrompt>,
    /// Newest session's model, at most 15 ASCII chars.
    pub model: String,
    /// Epoch milliseconds of this poll.
    pub polled_at: u64,
}
