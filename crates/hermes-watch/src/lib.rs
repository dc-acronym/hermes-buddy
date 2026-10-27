//! Read-only watcher for a Hermes Agent `state.db`. OWNER: hermes-watch agent.
//! Contract: see PLAN.md "Hermes data contract". `Watcher::poll()` -> `HermesSnapshot`.
//!
//! The watcher never writes and never lingers. Each poll opens a fresh `SQLITE_OPEN_READ_ONLY`
//! connection, runs one short read transaction, and closes the connection before `poll()`
//! returns, so no file descriptor on `state.db`, `-wal` or `-shm` is held between polls (Hermes
//! treats any process holding them as a "foreign holder" and refuses its own maintenance, e.g.
//! `hermes sessions optimize/prune`, startup schema repair and reconcile). A missing file is
//! reported rather than created, and when no `-wal` / `-shm` exists next to the database (Hermes
//! is not running) it is opened `immutable`, so the poll does not create them either.

mod db;
mod lineage;
mod snapshot;
mod text;
mod watcher;

pub use snapshot::{HermesSnapshot, PendingPrompt};
pub use watcher::{default_db_path, running_window_secs, Watcher};

/// The attention statement, exposed so the test-suite can check its query plan.
#[doc(hidden)]
pub use db::SQL_PENDING as __SQL_PENDING;
