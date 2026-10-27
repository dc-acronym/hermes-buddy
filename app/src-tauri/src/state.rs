//! Shared application state (managed by Tauri) and the on-disk locations.

use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::Mutex;

use tauri::{AppHandle, Manager};

use crate::poller::PollerHandle;
use crate::shake::ShakeDetector;

pub struct AppState {
    pub poller: PollerHandle,
    /// The user's db-path override exactly as typed (what `config.json` holds). `None` = default.
    pub db_override: Mutex<Option<String>>,
    pub shake: Mutex<ShakeDetector>,
    /// Serialises everything that touches the config dir / character dir (commands run on a
    /// thread pool and drag-drop installs run on their own thread).
    pub fs_lock: Mutex<()>,
    /// The tray icon was built, so a hidden window can be brought back from it. Without a tray
    /// (a missing AppIndicator library on some Linux desktops) hiding would strand the window,
    /// so "hide" minimizes instead (see `tray::tuck_away`).
    pub tray_ok: AtomicBool,
}

/// `<app config dir>`: `config.json` plus the UI's `<name>.json` blobs.
pub fn config_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map_err(|e| format!("no config dir: {e}"))
}

/// `<app data dir>/character`: the installed GIF pack.
pub fn character_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|d| d.join("character"))
        .map_err(|e| format!("no data dir: {e}"))
}

/// Lock helper that shrugs off poisoning (a panicked command must not brick the others).
pub fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
}
