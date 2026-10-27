//! System tray: Show/Hide, Next pet, Quit. Left click toggles the window.
//!
//! Note: on Linux the tray is an AppIndicator, which reports menu activations but not plain
//! clicks, so there the menu is the way in.

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager};

pub const NEXT_PET_EVENT: &str = "buddy://next-pet";
const TOGGLE: &str = "toggle";
const NEXT_PET: &str = "next-pet";
const QUIT: &str = "quit";

pub fn build(app: &AppHandle) -> tauri::Result<()> {
    let toggle = MenuItem::with_id(app, TOGGLE, "Show / Hide", true, None::<&str>)?;
    let next_pet = MenuItem::with_id(app, NEXT_PET, "Next pet", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, QUIT, "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&toggle, &next_pet, &separator, &quit])?;

    let mut tray = TrayIconBuilder::with_id("main")
        .tooltip("Hermes Buddy")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            TOGGLE => toggle_main_window(app),
            NEXT_PET => {
                let _ = app.emit(NEXT_PET_EVENT, ());
            }
            QUIT => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                toggle_main_window(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

/// Visible and not minimised -> hide; otherwise bring it back to the front.
pub fn toggle_main_window(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let showing = window.is_visible().unwrap_or(false) && !window.is_minimized().unwrap_or(false);
    if showing {
        let _ = window.hide();
    } else {
        reveal_main_window(app);
    }
}

/// Bring the main window back to the front: unminimise, show, focus. (Also what a second launch
/// of the app does, via the single-instance plugin.)
pub fn reveal_main_window(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();
}

/// Get the window out of the way: tuck it into the tray, or, when there is no tray to bring it
/// back from, minimise it to the taskbar / dock so it can still be found.
pub fn tuck_away<E>(
    tray_ok: bool,
    hide: impl FnOnce() -> Result<(), E>,
    minimize: impl FnOnce() -> Result<(), E>,
) -> Result<(), E> {
    if tray_ok {
        hide()
    } else {
        minimize()
    }
}

#[cfg(test)]
mod tests {
    use super::tuck_away;
    use std::cell::RefCell;

    #[test]
    fn hides_into_the_tray_only_when_there_is_one() {
        for (tray_ok, expected) in [(true, "hide"), (false, "minimize")] {
            let calls = RefCell::new(Vec::new());
            let result: Result<(), ()> = tuck_away(
                tray_ok,
                || {
                    calls.borrow_mut().push("hide");
                    Ok(())
                },
                || {
                    calls.borrow_mut().push("minimize");
                    Ok(())
                },
            );
            assert_eq!(result, Ok(()));
            assert_eq!(*calls.borrow(), vec![expected], "tray_ok = {tray_ok}");
        }
        // The chosen action's error is passed through.
        assert_eq!(tuck_away(false, || Ok(()), || Err("no wm")), Err("no wm"));
    }
}
