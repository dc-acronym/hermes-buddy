//! SQLite access: opening read-only, the schema check, and the short read queries.
//!
//! Hermes's `state.db` can be large (sessions x messages, tool output inline), so every query
//! here is driven by an index on the small, recent slice of the data (see the plan notes on each
//! statement); nothing scans `messages` whole.
//!
//! Every read opens its own connection and closes it before returning ([`read`]): Hermes treats
//! any process holding `state.db`, `-wal` or `-shm` open as a "foreign holder" and then refuses
//! its own maintenance, so the watcher must not be one between polls.

use std::collections::HashMap;
use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::time::Duration;

use rusqlite::{named_params, params, types::ValueRef, Connection, ErrorCode, OpenFlags, Row};

use crate::lineage::{self, Facts, Relation};

/// `busy_timeout` for the read-only connection.
const BUSY_TIMEOUT: Duration = Duration::from_secs(1);

/// Columns this crate cannot work without. A Hermes build missing any of them is "unrecognised".
/// (Names from `SCHEMA_SQL` in Hermes's `hermes_state_common.py`, schema_version 32.)
const REQUIRED_COLUMNS: &[(&str, &[&str])] = &[
    (
        "sessions",
        &[
            "id",
            "source",
            "model",
            "started_at",
            "ended_at",
            "last_activity_at",
            "last_activity_description",
            "input_tokens",
            "output_tokens",
            "hidden",
            "parent_session_id",
            "end_reason",
        ],
    ),
    (
        "messages",
        &[
            "id",
            "session_id",
            "role",
            "content",
            "tool_call_id",
            "tool_calls",
            "timestamp",
            "active",
        ],
    ),
];

/// Columns that sharpen the result but that an older Hermes may lack; without them the poll
/// still works, just without that refinement.
#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct Schema {
    /// `sessions.model_config` (carries the fork / subagent markers).
    model_config: bool,
    /// `sessions.session_key` (legacy reset-child detection).
    session_key: bool,
    /// `messages.display_kind` (`'hidden'` rows are never painted by Hermes).
    display_kind: bool,
    /// `messages._compressed_summary` (compaction-summary carrier rows).
    compressed_summary: bool,
}

/// How far back a session still counts for `sessionsTotal`, and the candidate pool for
/// everything else (running, attention, newest session).
pub const ACTIVE_DAY_SECS: f64 = 24.0 * 3600.0;
/// A pending tool call older than this is treated as orphaned (crashed / abandoned).
pub const ATTENTION_MAX_AGE_SECS: f64 = 30.0 * 60.0;
/// Rows fetched for the transcript; each row yields 0..n lines and we keep 8.
const TRANSCRIPT_ROWS: i64 = 40;
/// Content is cut in SQL so a pasted megabyte never crosses into Rust. Bytes, not chars: the cut
/// is done on a BLOB because `substr()` on TEXT stops at an embedded NUL, and Hermes prefixes
/// structured content with `"\0json:"` (see `text::content_text`).
const CONTENT_PREFIX_BYTES: i64 = 4096;
/// Same for a row's `tool_calls` (a `write_file` call can carry megabytes). Complete calls inside
/// the prefix are read normally; a call cut by it still yields its name and first arguments
/// (`text::parse_calls`).
const TOOL_CALLS_PREFIX_BYTES: i64 = 8192;
/// Why a poll produced no data.
#[derive(Debug, Clone, PartialEq)]
pub enum Failure {
    NotFound(PathBuf),
    Schema {
        problem: String,
        version: Option<i64>,
    },
    Sql(String),
}

impl Failure {
    /// The user-facing `error` string.
    pub fn message(&self) -> String {
        match self {
            Failure::NotFound(p) => format!("state.db not found at {}", p.display()),
            Failure::Schema { problem, .. } => format!("unrecognised Hermes schema ({problem})"),
            Failure::Sql(m) => m.clone(),
        }
    }

    pub fn schema_version(&self) -> Option<i64> {
        match self {
            Failure::Schema { version, .. } => *version,
            _ => None,
        }
    }
}

impl From<rusqlite::Error> for Failure {
    fn from(e: rusqlite::Error) -> Self {
        if let rusqlite::Error::SqliteFailure(f, _) = &e {
            if f.code == ErrorCode::NotADatabase {
                return Failure::Schema {
                    problem: "not a SQLite database".into(),
                    version: None,
                };
            }
        }
        Failure::Sql(format!("cannot read state.db: {e}"))
    }
}

/// The files SQLite keeps next to a database while someone has it open (WAL mode) or while a
/// write is in flight (rollback journal).
fn sidecars(path: &Path) -> [PathBuf; 3] {
    let with = |suffix: &str| {
        let mut name = path.as_os_str().to_owned();
        name.push(suffix);
        PathBuf::from(name)
    };
    [with("-wal"), with("-shm"), with("-journal")]
}

/// Is any sidecar present (or not provably absent)?
fn has_sidecars(path: &Path) -> bool {
    sidecars(path)
        .iter()
        .any(|p| !matches!(fs::symlink_metadata(p), Err(e) if e.kind() == ErrorKind::NotFound))
}

/// A `file:` URI that opens `path` read-only and *immutable*: no locks, no WAL handling, and so
/// no `-wal` / `-shm` files created next to the database. `None` when `path` cannot be written
/// as a plain `file:` URI (non-UTF-8, UNC), in which case the caller opens it normally.
fn immutable_uri(path: &Path) -> Option<String> {
    let abs = std::path::absolute(path).unwrap_or_else(|_| path.to_path_buf());
    uri_from(abs.to_str()?, cfg!(windows))
}

/// [`immutable_uri`] on an absolute path string, with the platform made explicit (for tests).
fn uri_from(abs: &str, windows: bool) -> Option<String> {
    let mut path = abs.to_string();
    if windows {
        if path.starts_with("\\\\") || path.starts_with("//") {
            return None; // \\server\share: not worth a hand-rolled URI
        }
        path = path.replace('\\', "/");
        if !path.starts_with('/') {
            path.insert(0, '/'); // C:/x -> /C:/x
        }
    } else if !path.starts_with('/') {
        return None;
    }
    let mut uri = String::from("file://");
    for b in path.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' | b'/' | b':' => {
                uri.push(b as char)
            }
            _ => uri.push_str(&format!("%{b:02X}")),
        }
    }
    uri.push_str("?mode=ro&immutable=1");
    Some(uri)
}

/// Open `path` read-only (never creating it).
///
/// With no sidecar files next to it nobody has the database open (Hermes is not running, and a
/// cleanly closed WAL database keeps all its data in the main file), so it is opened
/// `immutable`: a plain read-only open of a WAL database would create an empty `-wal` and a
/// 32 KB `-shm` beside it. With sidecars present the normal read-only open is the only correct
/// one (committed data may live only in the WAL), and it creates nothing.
fn open(path: &Path, immutable: bool) -> Result<Connection, Failure> {
    let ro = OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX;
    let conn = match immutable.then(|| immutable_uri(path)).flatten() {
        Some(uri) => Connection::open_with_flags(uri, ro | OpenFlags::SQLITE_OPEN_URI)?,
        None => Connection::open_with_flags(path, ro)?,
    };
    conn.busy_timeout(BUSY_TIMEOUT)?;
    Ok(conn)
}

/// One complete poll: open a fresh read-only connection, check the schema, run the queries in one
/// short read transaction, and close the connection again, on every path, before returning. No
/// descriptor on `state.db`, `-wal` or `-shm` outlives the call.
pub fn read(path: &Path, now: f64) -> Result<Data, Failure> {
    let immutable = !has_sidecars(path);
    let first = read_with(path, now, immutable);
    if immutable && has_sidecars(path) {
        // Hermes opened the database while an immutable (unlocked) read was running; whatever
        // that read saw cannot be trusted. Read it again the proper way.
        return read_with(path, now, false);
    }
    first
}

fn read_with(path: &Path, now: f64, immutable: bool) -> Result<Data, Failure> {
    let conn = open(path, immutable)?;
    let data =
        check_schema(&conn).and_then(|schema| collect(&conn, &schema, now).map_err(Failure::from));
    // Closing explicitly (not just dropping) so the descriptors are gone before we return; a
    // failure to close cannot change the data we already hold.
    let _ = conn.close();
    data
}

fn table_columns(conn: &Connection, table: &str) -> rusqlite::Result<Vec<String>> {
    // `table` is one of our own constants, never user input.
    let mut st = conn.prepare(&format!("PRAGMA table_info({table})"))?;
    let rows = st.query_map([], |r| r.get::<_, String>(1))?;
    rows.collect()
}

fn check_schema(conn: &Connection) -> Result<Schema, Failure> {
    let mut columns: HashMap<&str, Vec<String>> = HashMap::new();
    for (table, wanted) in REQUIRED_COLUMNS {
        let have = table_columns(conn, table)?;
        let problem = if have.is_empty() {
            Some(format!("missing table {table}"))
        } else {
            wanted
                .iter()
                .find(|w| !have.iter().any(|h| h.eq_ignore_ascii_case(w)))
                .map(|w| format!("missing {table}.{w}"))
        };
        if let Some(problem) = problem {
            return Err(Failure::Schema {
                problem,
                version: schema_version(conn),
            });
        }
        columns.insert(table, have);
    }
    let has = |table: &str, col: &str| {
        columns
            .get(table)
            .is_some_and(|c| c.iter().any(|h| h.eq_ignore_ascii_case(col)))
    };
    Ok(Schema {
        model_config: has("sessions", "model_config"),
        session_key: has("sessions", "session_key"),
        display_kind: has("messages", "display_kind"),
        compressed_summary: has("messages", "_compressed_summary"),
    })
}

/// `schema_version.version` (Hermes keeps a single row), `None` when absent or unreadable.
pub fn schema_version(conn: &Connection) -> Option<i64> {
    conn.query_row("SELECT version FROM schema_version LIMIT 1", [], |r| {
        r.get::<_, Option<i64>>(0)
    })
    .ok()
    .flatten()
}

/// One session in the last-24h candidate set.
#[derive(Debug, Clone, PartialEq)]
pub struct SessionRow {
    pub id: String,
    pub model: String,
    pub description: String,
    /// `ended_at IS NULL`
    pub open: bool,
    /// Freshest known activity (epoch s): `last_activity_at`, `started_at`, and for open
    /// sessions the newest message timestamp. Hermes rate-limits its activity heartbeat to ~60 s,
    /// so `last_activity_at` alone can lag a newer message (`_sql_freshest_of` in Hermes).
    pub act: f64,
    pub started: f64,
    pub end_reason: Option<String>,
    /// The id of the root row of the job this session belongs to (see [`crate::lineage`]).
    pub root: String,
    /// A subagent run rather than a conversation of its own.
    pub subagent: bool,
}

/// An unanswered `clarify` / `terminal` tool call.
#[derive(Debug, Clone, PartialEq)]
pub struct PendingCall {
    pub session_id: String,
    pub message_id: i64,
    pub timestamp: f64,
    /// Position inside the assistant row's `tool_calls` array.
    pub index: i64,
    pub call_id: String,
    pub tool: String,
    /// `function.arguments` (a JSON string, normally), cut to a prefix in SQL.
    pub arguments: String,
}

/// A stored message, only the columns the transcript needs.
#[derive(Debug, Clone, PartialEq)]
pub struct RawRow {
    pub role: String,
    pub content: Option<String>,
    /// A byte prefix of the `tool_calls` JSON (assistant rows only).
    pub tool_calls: Option<String>,
}

/// The session whose transcript and model the stick shows.
#[derive(Debug, Clone, PartialEq)]
pub struct NewestSession {
    pub id: String,
    pub model: String,
}

/// Everything one poll reads, all from one short read transaction.
#[derive(Debug, Clone, PartialEq)]
pub struct Data {
    pub schema_version: Option<i64>,
    pub sessions: Vec<SessionRow>,
    pub tokens_today: u64,
    pub tokens_lifetime: u64,
    pub pending: Vec<PendingCall>,
    pub newest: Option<NewestSession>,
    /// Newest first.
    pub transcript: Vec<RawRow>,
}

impl Schema {
    /// SQL for the columns [`Facts`] is made of, for a `sessions s LEFT JOIN sessions p ON
    /// p.id = s.parent_session_id` row. Nine columns.
    fn facts_columns(&self) -> String {
        let marker = |key: &str| {
            if self.model_config {
                // json_valid() guards ->> (which raises on malformed JSON).
                format!(
                    "CASE WHEN json_valid(s.model_config) THEN s.model_config ->> '$.{key}' END"
                )
            } else {
                "NULL".to_string()
            }
        };
        let (key, parent_key) = if self.session_key {
            ("s.session_key", "p.session_key")
        } else {
            ("NULL", "NULL")
        };
        format!(
            "s.parent_session_id, p.end_reason, p.ended_at, s.started_at, {key}, {parent_key},
             {}, {}, {}",
            marker("_branched_from"),
            marker("_delegate_from"),
            marker("_reset_from"),
        )
    }

    /// Sessions with activity in the last 24 h. Plan: `idx_sessions_effective_activity` range
    /// scan (Hermes's own "recent sessions" index), then one covering `idx_messages_session`
    /// max() seek per *open* session; the parent join is a primary-key lookup.
    fn sessions_sql(&self) -> String {
        format!(
            "
SELECT s.id, s.model, s.last_activity_description, s.ended_at IS NULL,
       MAX(COALESCE(s.last_activity_at, 0.0), s.started_at,
           CASE WHEN s.ended_at IS NULL
                THEN COALESCE((SELECT MAX(m.timestamp) FROM messages m WHERE m.session_id = s.id), 0.0)
                ELSE 0.0 END),
       s.end_reason,
       {}
FROM sessions s LEFT JOIN sessions p ON p.id = s.parent_session_id
WHERE COALESCE(s.last_activity_at, s.started_at) >= :since
  AND s.source IS NOT 'cron' AND COALESCE(s.hidden, 0) = 0",
            self.facts_columns()
        )
    }

    /// One session's facts by id (to walk up past the 24 h candidate set).
    fn facts_sql(&self) -> String {
        format!(
            "SELECT {} FROM sessions s LEFT JOIN sessions p ON p.id = s.parent_session_id
             WHERE s.id = ?1",
            self.facts_columns()
        )
    }

    /// Plan: `idx_messages_session_id (session_id=?)` walked backwards, no sort. `content` and
    /// `tool_calls` are cut to byte prefixes (as BLOBs; see `CONTENT_PREFIX_BYTES`). Rows Hermes
    /// itself never paints (`display_kind = 'hidden'`, compaction summaries) are skipped.
    fn transcript_sql(&self) -> String {
        let mut filters = String::new();
        if self.display_kind {
            filters.push_str(" AND COALESCE(display_kind, '') <> 'hidden'");
        }
        if self.compressed_summary {
            filters.push_str(" AND COALESCE(_compressed_summary, 0) = 0");
        }
        format!(
            "
SELECT role, substr(CAST(content AS BLOB), 1, :bytes),
       CASE WHEN role = 'assistant' THEN substr(CAST(tool_calls AS BLOB), 1, :call_bytes) END
FROM messages
WHERE session_id = :sid AND active = 1 AND role IN ('user', 'assistant'){filters}
ORDER BY id DESC
LIMIT :n"
        )
    }
}

/// Tokens of sessions started since local midnight. SQLite does the timezone maths:
/// `now` -> local time -> start of day -> back to UTC epoch seconds.
/// Plan: `idx_sessions_started` range scan. `TOTAL()` (a float) rather than `SUM()`, which raises
/// "integer overflow" past 2^63 and would take the whole poll down with it.
const SQL_TOKENS_TODAY: &str = "
SELECT TOTAL(COALESCE(input_tokens, 0) + COALESCE(output_tokens, 0))
FROM sessions
WHERE started_at >= CAST(strftime('%s', :now, 'unixepoch', 'localtime', 'start of day', 'utc') AS REAL)
  AND source IS NOT 'cron' AND COALESCE(hidden, 0) = 0";

const SQL_TOKENS_LIFETIME: &str = "
SELECT TOTAL(COALESCE(input_tokens, 0) + COALESCE(output_tokens, 0))
FROM sessions
WHERE source IS NOT 'cron' AND COALESCE(hidden, 0) = 0";

/// The most a token total is allowed to report: the largest integer a JSON number carries
/// exactly in JavaScript.
const MAX_TOKENS: f64 = 9_007_199_254_740_991.0;

/// The PLAN.md attention query, driven from the 24 h candidate sessions so that the recent-message
/// range comes from `idx_messages_session_active (session_id, active, timestamp)` instead of a
/// scan over every assistant tool-call row (measured: ~1 ms vs ~400 ms on 1M messages).
/// `json_valid` / `type = 'object'` keep one malformed row from failing the whole statement.
/// The arguments are cut to 2048 bytes here (a `terminal` heredoc can be megabytes); the hint
/// only needs the first key, and `text::tool_hint` reads a cut-off value.
pub const SQL_PENDING: &str = "
WITH cand(id) AS MATERIALIZED (
  SELECT id FROM sessions
  WHERE COALESCE(last_activity_at, started_at) >= :since
    AND source IS NOT 'cron' AND COALESCE(hidden, 0) = 0
)
SELECT m.session_id, m.id, m.timestamp, tc.key,
       COALESCE(tc.value ->> '$.id', tc.value ->> '$.call_id'),
       COALESCE(tc.value ->> '$.function.name', tc.value ->> '$.name'),
       substr(CAST(tc.value ->> '$.function.arguments' AS BLOB), 1, 2048)
FROM cand c
JOIN messages m ON m.session_id = c.id AND m.timestamp > :cut
JOIN json_each(m.tool_calls) tc
WHERE m.role = 'assistant' AND m.active = 1
  AND m.tool_calls IS NOT NULL AND json_valid(m.tool_calls)
  AND tc.type = 'object'
  AND COALESCE(tc.value ->> '$.function.name', tc.value ->> '$.name') IN ('clarify', 'terminal')
  AND COALESCE(tc.value ->> '$.id', tc.value ->> '$.call_id') IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM messages r
                  WHERE r.session_id = m.session_id AND r.id > m.id
                    AND r.role = 'tool'
                    AND r.tool_call_id = COALESCE(tc.value ->> '$.id', tc.value ->> '$.call_id'))
ORDER BY m.timestamp, m.id, tc.key";

/// Fallback when nothing was active in the last 24 h: the newest session overall.
const SQL_NEWEST_OVERALL: &str = "
SELECT id, model FROM sessions
WHERE source IS NOT 'cron' AND COALESCE(hidden, 0) = 0
ORDER BY COALESCE(last_activity_at, started_at) DESC, started_at DESC
LIMIT 1";

/// Read a column as text whatever its storage class (Hermes can store content as BLOB).
fn text(row: &Row<'_>, idx: usize) -> rusqlite::Result<Option<String>> {
    Ok(match row.get_ref(idx)? {
        ValueRef::Null => None,
        ValueRef::Integer(i) => Some(i.to_string()),
        ValueRef::Real(f) => Some(f.to_string()),
        ValueRef::Text(b) | ValueRef::Blob(b) => Some(utf8_prefix(b)),
    })
}

/// Bytes -> String, dropping a multi-byte char cut in half at the very end (our byte-prefix
/// `substr`) and replacing any other invalid sequence.
fn utf8_prefix(b: &[u8]) -> String {
    match std::str::from_utf8(b) {
        Ok(s) => s.to_string(),
        Err(e) if e.error_len().is_none() => {
            String::from_utf8_lossy(&b[..e.valid_up_to()]).into_owned()
        }
        Err(_) => String::from_utf8_lossy(b).into_owned(),
    }
}

/// The nine [`Schema::facts_columns`] starting at column `at`.
fn facts_at(r: &Row<'_>, at: usize) -> rusqlite::Result<Facts> {
    Ok(Facts {
        parent: text(r, at)?,
        parent_end_reason: text(r, at + 1)?,
        parent_ended_at: r.get::<_, Option<f64>>(at + 2)?,
        started_at: r.get::<_, Option<f64>>(at + 3)?.unwrap_or(0.0),
        session_key: text(r, at + 4)?,
        parent_session_key: text(r, at + 5)?,
        branched_from: text(r, at + 6)?,
        delegate_from: text(r, at + 7)?,
        reset_from: text(r, at + 8)?,
    })
}

/// The 24 h candidate sessions, each tagged with its job root and whether it is a subagent.
fn sessions(conn: &Connection, schema: &Schema, since: f64) -> rusqlite::Result<Vec<SessionRow>> {
    let mut st = conn.prepare(&schema.sessions_sql())?;
    let candidates: Vec<(SessionRow, Facts)> = st
        .query_map(named_params! { ":since": since }, |r| {
            let row = SessionRow {
                id: text(r, 0)?.unwrap_or_default(),
                model: text(r, 1)?.unwrap_or_default(),
                description: text(r, 2)?.unwrap_or_default(),
                open: r.get::<_, i64>(3)? != 0,
                act: r.get::<_, f64>(4)?,
                started: 0.0,
                end_reason: text(r, 5)?,
                root: String::new(),
                subagent: false,
            };
            Ok((row, facts_at(r, 6)?))
        })?
        .collect::<rusqlite::Result<_>>()?;

    // id -> the parent it is grouped under (None: a root). Seeded from the candidates; ancestors
    // outside the 24 h window are looked up on demand so a job's key never changes just because
    // its first row aged out.
    let mut links: HashMap<String, Option<String>> = candidates
        .iter()
        .map(|(row, facts)| (row.id.clone(), facts.link()))
        .collect();
    let mut facts_stmt = conn.prepare(&schema.facts_sql())?;

    let mut out = Vec::with_capacity(candidates.len());
    for (mut row, facts) in candidates {
        row.started = facts.started_at;
        row.subagent = facts.relation() == Relation::Subagent;
        let mut failure = None;
        row.root = lineage::root_of(&row.id, |id| {
            if let Some(known) = links.get(id) {
                return known.clone();
            }
            let link = match facts_stmt.query_row(params![id], |r| facts_at(r, 0)) {
                Ok(f) => f.link(),
                Err(rusqlite::Error::QueryReturnedNoRows) => None, // dangling parent id
                Err(e) => {
                    failure.get_or_insert(e);
                    None
                }
            };
            links.insert(id.to_string(), link.clone());
            link
        });
        if let Some(e) = failure {
            return Err(e);
        }
        out.push(row);
    }
    Ok(out)
}

/// Newest by freshest activity; ties broken by id so the choice is deterministic.
pub fn newest_session<'a>(
    sessions: impl IntoIterator<Item = &'a SessionRow>,
) -> Option<&'a SessionRow> {
    sessions
        .into_iter()
        .max_by(|a, b| a.act.total_cmp(&b.act).then_with(|| a.id.cmp(&b.id)))
}

fn sum(conn: &Connection, sql: &str, now: Option<f64>) -> rusqlite::Result<u64> {
    let mut st = conn.prepare(sql)?;
    let v: f64 = match now {
        Some(now) => st.query_row(named_params! { ":now": now }, |r| r.get(0))?,
        None => st.query_row([], |r| r.get(0))?,
    };
    Ok(if v.is_nan() {
        0
    } else {
        v.clamp(0.0, MAX_TOKENS) as u64
    })
}

fn pending(conn: &Connection, since: f64, cut: f64) -> rusqlite::Result<Vec<PendingCall>> {
    let mut st = conn.prepare(SQL_PENDING)?;
    let rows = st.query_map(named_params! { ":since": since, ":cut": cut }, |r| {
        Ok(PendingCall {
            session_id: text(r, 0)?.unwrap_or_default(),
            message_id: r.get(1)?,
            timestamp: r.get(2)?,
            index: r.get::<_, Option<i64>>(3)?.unwrap_or(0),
            call_id: text(r, 4)?.unwrap_or_default(),
            tool: text(r, 5)?.unwrap_or_default(),
            arguments: text(r, 6)?.unwrap_or_default(),
        })
    })?;
    rows.collect()
}

fn newest_overall(conn: &Connection) -> rusqlite::Result<Option<NewestSession>> {
    let mut st = conn.prepare(SQL_NEWEST_OVERALL)?;
    let mut rows = st.query([])?;
    match rows.next()? {
        Some(r) => Ok(Some(NewestSession {
            id: text(r, 0)?.unwrap_or_default(),
            model: text(r, 1)?.unwrap_or_default(),
        })),
        None => Ok(None),
    }
}

fn transcript(
    conn: &Connection,
    schema: &Schema,
    session_id: &str,
) -> rusqlite::Result<Vec<RawRow>> {
    let mut st = conn.prepare(&schema.transcript_sql())?;
    let rows = st.query_map(
        named_params! {
            ":bytes": CONTENT_PREFIX_BYTES,
            ":call_bytes": TOOL_CALLS_PREFIX_BYTES,
            ":sid": session_id,
            ":n": TRANSCRIPT_ROWS,
        },
        |r| {
            Ok(RawRow {
                role: text(r, 0)?.unwrap_or_default(),
                content: text(r, 1)?,
                tool_calls: text(r, 2)?,
            })
        },
    )?;
    rows.collect()
}

/// Run every query for one poll inside a single short deferred read transaction, so the
/// numbers agree with each other.
fn collect(conn: &Connection, schema: &Schema, now: f64) -> rusqlite::Result<Data> {
    let tx = conn.unchecked_transaction()?;
    let schema_version = schema_version(&tx);
    let sessions = sessions(&tx, schema, now - ACTIVE_DAY_SECS)?;
    let tokens_today = sum(&tx, SQL_TOKENS_TODAY, Some(now))?;
    let tokens_lifetime = sum(&tx, SQL_TOKENS_LIFETIME, None)?;
    let pending = pending(&tx, now - ACTIVE_DAY_SECS, now - ATTENTION_MAX_AGE_SECS)?;
    // The conversation, not its subagents, supplies the transcript and the model.
    let newest = match newest_session(sessions.iter().filter(|s| !s.subagent))
        .or_else(|| newest_session(&sessions))
    {
        Some(s) => Some(NewestSession {
            id: s.id.clone(),
            model: s.model.clone(),
        }),
        None => newest_overall(&tx)?,
    };
    let transcript = match &newest {
        Some(n) => transcript(&tx, schema, &n.id)?,
        None => Vec::new(),
    };
    tx.commit()?;
    Ok(Data {
        schema_version,
        sessions,
        tokens_today,
        tokens_lifetime,
        pending,
        newest,
        transcript,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const SCHEMA_SQL: &str = include_str!("../tests/fixtures/hermes_schema.sql");

    #[test]
    fn uris() {
        assert_eq!(
            uri_from("/home/u/.hermes/state.db", false).as_deref(),
            Some("file:///home/u/.hermes/state.db?mode=ro&immutable=1")
        );
        assert_eq!(
            uri_from("/tmp/a b/50%/x#y?z&w=1/\u{e9}.db", false).as_deref(),
            Some("file:///tmp/a%20b/50%25/x%23y%3Fz%26w%3D1/%C3%A9.db?mode=ro&immutable=1")
        );
        assert_eq!(
            uri_from("C:\\Users\\Me\\AppData\\Local\\hermes\\state.db", true).as_deref(),
            Some("file:///C:/Users/Me/AppData/Local/hermes/state.db?mode=ro&immutable=1")
        );
        assert_eq!(uri_from("\\\\server\\share\\state.db", true), None);
        assert_eq!(uri_from("relative/state.db", false), None);
    }

    #[test]
    fn sidecar_names_append_to_the_whole_file_name() {
        let names: Vec<String> = sidecars(Path::new("/x/state.db"))
            .iter()
            .map(|p| p.display().to_string())
            .collect();
        assert_eq!(
            names,
            ["/x/state.db-wal", "/x/state.db-shm", "/x/state.db-journal"]
        );
    }

    #[test]
    fn huge_tool_calls_and_arguments_are_cut_before_they_reach_rust() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(SCHEMA_SQL).unwrap();
        conn.execute(
            "INSERT INTO sessions (id, source, started_at) VALUES ('s', 'cli', 1000)",
            [],
        )
        .unwrap();
        let args = serde_json::json!({ "command": "ls", "pad": "x".repeat(3_000_000) }).to_string();
        let calls = serde_json::json!([{ "id": "t1", "function": { "name": "terminal", "arguments": args } }])
            .to_string();
        conn.execute(
            "INSERT INTO messages (session_id, role, tool_calls, timestamp) VALUES ('s', 'assistant', ?1, 1001)",
            [&calls],
        )
        .unwrap();

        let schema = check_schema(&conn).unwrap();
        let rows = transcript(&conn, &schema, "s").unwrap();
        assert_eq!(rows.len(), 1);
        let got = rows[0].tool_calls.as_deref().unwrap();
        assert!(
            got.len() <= TOOL_CALLS_PREFIX_BYTES as usize,
            "{} bytes",
            got.len()
        );
        assert!(got.starts_with(r#"[{"function":{"arguments":"#));

        let pend = pending(&conn, 0.0, 0.0).unwrap();
        assert_eq!(pend.len(), 1);
        assert!(
            pend[0].arguments.len() <= 2048,
            "{} bytes",
            pend[0].arguments.len()
        );
        assert!(pend[0].arguments.starts_with(r#"{"command":"ls""#));
    }
}
