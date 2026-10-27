//! `#[tauri::command]` handlers: the UI -> Rust half of the contract in PLAN.md.
//! Argument names are camelCase on the JS side (Tauri converts `snake_case` params).
//!
//! Commands that touch the disk are `async` so they run off the main thread.

use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Manager, State, WebviewWindow};

use crate::character::{self, CharacterPack};
use crate::state::{character_dir, config_dir, lock, AppState};
use crate::storage::{self, AppConfig};
use crate::tray;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigInfo {
    /// The user's override exactly as stored, `None` when using the default location.
    pub db_path: Option<String>,
    /// The path the watcher actually reads.
    pub db_path_resolved: String,
}

#[tauri::command(async)]
pub fn load_json(
    app: AppHandle,
    state: State<'_, AppState>,
    name: String,
) -> Result<Option<Value>, String> {
    let _fs = lock(&state.fs_lock);
    storage::load_json(&config_dir(&app)?, &name)
}

#[tauri::command(async)]
pub fn save_json(
    app: AppHandle,
    state: State<'_, AppState>,
    name: String,
    value: Value,
) -> Result<(), String> {
    let _fs = lock(&state.fs_lock);
    storage::save_json(&config_dir(&app)?, &name, &value)
}

#[tauri::command(async)]
pub fn get_config(state: State<'_, AppState>) -> Result<ConfigInfo, String> {
    let db_path = lock(&state.db_override).clone();
    let db_path_resolved = resolve_db_path(db_path.as_deref());
    Ok(ConfigInfo {
        db_path,
        db_path_resolved,
    })
}

/// Ask the watcher crate where it would read for this override, so there is one source of truth.
fn resolve_db_path(db_override: Option<&str>) -> String {
    hermes_watch::Watcher::new(db_override.map(storage::expand_tilde))
        .resolved_path()
        .to_string_lossy()
        .into_owned()
}

#[tauri::command(async)]
pub fn set_db_path(
    app: AppHandle,
    state: State<'_, AppState>,
    path: Option<String>,
) -> Result<(), String> {
    let path = storage::normalize_db_path(path);
    // Apply first so the change takes effect even if persisting fails.
    *lock(&state.db_override) = path.clone();
    state
        .poller
        .set_path(path.as_deref().map(storage::expand_tilde));

    let _fs = lock(&state.fs_lock);
    storage::write_config(&config_dir(&app)?, &AppConfig { db_path: path })
}

#[tauri::command]
pub fn poll_now(state: State<'_, AppState>) {
    state.poller.poll_now();
}

#[tauri::command]
pub fn set_always_on_top(window: WebviewWindow, on: bool) -> Result<(), String> {
    window.set_always_on_top(on).map_err(|e| e.to_string())
}

/// Tuck the window away: into the tray, or (no tray) minimised so it can't be lost.
#[tauri::command]
pub fn hide_window(window: WebviewWindow, state: State<'_, AppState>) -> Result<(), String> {
    let tray_ok = state.tray_ok.load(Ordering::Relaxed);
    tray::tuck_away(tray_ok, || window.hide(), || window.minimize()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn quit_app(app: AppHandle) {
    app.exit(0);
}

#[tauri::command(async)]
pub fn install_character(app: AppHandle, dir: String) -> Result<CharacterPack, String> {
    install_from(&app, Path::new(&dir))
}

/// Shared by the `install_character` command and the window drag-drop handler.
pub fn install_from(app: &AppHandle, dir: &Path) -> Result<CharacterPack, String> {
    let state = app.state::<AppState>();
    let _fs = lock(&state.fs_lock);
    character::install(dir, &character_dir(app)?)
}

#[tauri::command(async)]
pub fn get_character(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Option<CharacterPack>, String> {
    let _fs = lock(&state.fs_lock);
    character::read_pack(&character_dir(&app)?)
}

#[tauri::command(async)]
pub fn delete_character(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let _fs = lock(&state.fs_lock);
    character::delete(&character_dir(&app)?).map_err(|e| format!("delete character: {e}"))
}

/// Wipe everything we stored: UI json blobs, `config.json`, the character pack; the watcher goes
/// back to the default db location. Keeps going after a failure so as much as possible is
/// removed, then reports the first error.
#[tauri::command(async)]
pub fn factory_reset(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    *lock(&state.db_override) = None;
    state.poller.set_path(None);

    let _fs = lock(&state.fs_lock);
    let results: [Result<(), String>; 2] = [
        config_dir(&app)
            .and_then(|d| storage::clear_json(&d).map_err(|e| format!("clear settings: {e}"))),
        character_dir(&app).and_then(|d: PathBuf| {
            character::delete(&d).map_err(|e| format!("delete character: {e}"))
        }),
    ];
    results.into_iter().collect()
}
