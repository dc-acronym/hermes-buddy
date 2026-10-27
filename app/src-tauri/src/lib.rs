//! Hermes Buddy desktop shell (Tauri v2): the window, tray, Hermes poller thread, shake
//! detection and the UI command surface. See PLAN.md "Rust <-> UI contract".

mod character;
mod commands;
mod poller;
mod shake;
mod state;
mod storage;
mod tray;

use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Instant;

use tauri::{DragDropEvent, Emitter, Manager, Window, WindowEvent};

use crate::state::{lock, AppState};

pub const SHAKE_EVENT: &str = "buddy://shake";
pub const CHARACTER_INSTALLED_EVENT: &str = "buddy://character-installed";
/// Extra (not in the frozen contract): the message when a dropped pack folder was rejected.
pub const CHARACTER_ERROR_EVENT: &str = "buddy://character-error";

pub fn run() {
    tauri::Builder::default()
        // Registered first, as the plugin requires. A second launch hands over to this instance
        // (which shows itself again) instead of opening a second pet on the desktop.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            tray::reveal_main_window(app);
        }))
        .setup(|app| {
            let handle = app.handle().clone();
            let config = storage::read_config(&state::config_dir(&handle)?);
            let poller = poller::spawn(
                handle.clone(),
                config.db_path.as_deref().map(storage::expand_tilde),
            );
            app.manage(AppState {
                poller,
                db_override: Mutex::new(config.db_path),
                shake: Mutex::new(shake::ShakeDetector::new()),
                fs_lock: Mutex::new(()),
                tray_ok: AtomicBool::new(false),
            });

            // The tray is best-effort: a missing AppIndicator library (some Linux desktops)
            // panics inside the tray crate, and the buddy must still start without it.
            match catch_unwind(AssertUnwindSafe(|| tray::build(&handle))) {
                Ok(Ok(())) => handle
                    .state::<AppState>()
                    .tray_ok
                    .store(true, Ordering::Relaxed),
                Ok(Err(e)) => eprintln!("[hermes-buddy] tray unavailable: {e}"),
                Err(_) => {
                    eprintln!("[hermes-buddy] tray unavailable (system tray library missing?)")
                }
            }
            Ok(())
        })
        .on_window_event(on_window_event)
        .invoke_handler(tauri::generate_handler![
            commands::load_json,
            commands::save_json,
            commands::get_config,
            commands::set_db_path,
            commands::poll_now,
            commands::set_always_on_top,
            commands::hide_window,
            commands::quit_app,
            commands::install_character,
            commands::get_character,
            commands::delete_character,
            commands::factory_reset,
        ])
        .run(tauri::generate_context!())
        .expect("error while running hermes-buddy");
}

fn on_window_event(window: &Window, event: &WindowEvent) {
    if window.label() != "main" {
        return;
    }
    match event {
        // Frameless window, no close button: if the OS asks us to close, tuck into the tray.
        // Without a tray to bring it back from, minimise instead of hiding.
        WindowEvent::CloseRequested { api, .. } => {
            api.prevent_close();
            let tray_ok = window
                .app_handle()
                .try_state::<AppState>()
                .is_some_and(|state| state.tray_ok.load(Ordering::Relaxed));
            let _ = tray::tuck_away(tray_ok, || window.hide(), || window.minimize());
        }
        WindowEvent::Moved(pos) => {
            // Windows parks minimised windows at (-32000, -32000); that is not a shake.
            if pos.x <= -30_000 || pos.y <= -30_000 {
                return;
            }
            let app = window.app_handle();
            let Some(state) = app.try_state::<AppState>() else {
                return;
            };
            let scale = window.scale_factor().unwrap_or(1.0);
            let shook = lock(&state.shake).feed(
                Instant::now(),
                shake::to_logical(pos.x, scale),
                shake::to_logical(pos.y, scale),
            );
            if shook {
                let _ = app.emit(SHAKE_EVENT, ());
            }
        }
        WindowEvent::DragDrop(DragDropEvent::Drop { paths, .. }) => {
            // Anything that is not a pack folder is ignored. Installing copies up to 4 MB, so
            // keep it off the event-loop thread.
            if let Some(dir) = character::pick_pack_dir(paths) {
                let dir = dir.to_path_buf();
                let app = window.app_handle().clone();
                std::thread::spawn(move || match commands::install_from(&app, &dir) {
                    Ok(pack) => {
                        let _ = app.emit(CHARACTER_INSTALLED_EVENT, &pack);
                    }
                    Err(e) => {
                        eprintln!("[hermes-buddy] character install failed: {e}");
                        let _ = app.emit(CHARACTER_ERROR_EVENT, e);
                    }
                });
            }
        }
        _ => {}
    }
}
