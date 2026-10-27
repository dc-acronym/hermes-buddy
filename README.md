# Hermes Buddy

A little always-on-top desk pet for macOS and Windows that watches your local
[Hermes Agent](https://hermes-agent.nousresearch.com/). It's a desktop recreation of Anthropic's
[claude-desktop-buddy](https://github.com/anthropics/claude-desktop-buddy) M5StickC Plus firmware:
the same 18 ASCII pets, the same seven moods, the same A / B / power buttons, drawn as a tiny
stick floating on your desktop.

It **only watches**. It reads Hermes's own `state.db` read-only every 10 seconds. It needs no API key,
no Hermes config change, and it never sends anything to Hermes.

| The pet… | when Hermes… |
|---|---|
| sleeps | can't be found (no `state.db`) |
| idles, blinks, looks around | is idle |
| works up a sweat | has a session that was active in the last couple of minutes |
| dances, LED blinks | is waiting on you: an approval prompt, a `clarify` question, or a slow `terminal` command |
| celebrates | finishes a session, or every 50K tokens (level up) |
| gets dizzy | you shake the window |
| shows hearts | you pet it (B on the pet screen) |

## Build and run

You need Hermes on the **same machine** (v1 has no network mode), plus:

- [Node.js](https://nodejs.org/) 18+
- [Rust](https://rustup.rs/) (stable)
- Tauri's OS prerequisites: [macOS](https://v2.tauri.app/start/prerequisites/#macos) (Xcode command line tools) or [Windows](https://v2.tauri.app/start/prerequisites/#windows) (MSVC build tools + WebView2, preinstalled on Windows 11)

```bash
cd app
npm install
npm run tauri dev        # run it
npm run tauri build      # make an installer: target/release/bundle/
```

The builds are **unsigned**. On macOS, the first time: right-click the app → Open → Open (or
`xattr -cr "/Applications/Hermes Buddy.app"`). On Windows: SmartScreen → More info → Run anyway.

## Controls

| Stick | Mouse | Keys |
|---|---|---|
| **A** tap: next screen (home → pet → info) | click the big front button | `Space` / `A` |
| **B** tap: scroll transcript / next info page / pick menu item | click the right-edge button | `Enter` / `B` |
| **B** on the pet screen: pet it | | |
| **Hold A**: menu | hold the front button | `Esc` / `M` |
| **Power**: screen off/on | click the left-edge button | `P` |
| **Hold power**: hide to tray | hold the left-edge button | |
| **Shake**: dizzy | drag the window back and forth fast | |
| **Face-down nap** (energy refills) | minimize the window | |

Drag the stick around by its body. The tray icon has Show/Hide, Next pet and Quit.

**Menu → settings:** brightness · sound · **hermes** (point it at a different `state.db`) ·
**on top** (always-on-top) · led · transcript · clock rot · ascii pet · reset.

## Where it looks for Hermes

`$HERMES_HOME/state.db` if `HERMES_HOME` is set, otherwise the same default Hermes uses:
`~/.hermes/state.db` on macOS/Linux, `%LOCALAPPDATA%\hermes\state.db` on Windows. If you use a Hermes
**profile** or run Hermes in **Docker**, open Menu → settings → hermes and paste the path to that
profile's / volume's `state.db`. If it can't find one, the home screen says "No Hermes connected";
Info → DATABASE shows the path in use, the error, and when it last polled.

It opens the database read-only for each poll and closes it again, so it never holds Hermes's files
open (Hermes's own `sessions optimize` / `prune` and startup repair keep working) and never creates
files next to it.

To check what the pet sees without the UI:

```bash
cargo run -p hermes-watch --example snapshot -- ~/.hermes/state.db
```

## Custom GIF pets

Drop a character-pack folder (a `manifest.json` plus GIFs, same format as the
[original](https://github.com/anthropics/claude-desktop-buddy#gif-pets)) onto the window. Menu →
settings → ascii pet cycles between it and the ASCII pets; settings → reset → delete char removes it.
A pack is checked before it replaces the current one (every GIF it names must exist and be a real GIF,
64 GIFs max); if it's rejected, the stick shows why for a few seconds.

## Known limits

- Built and tested on Linux only (release build + scripted run against a fake Hermes db). The macOS and
  Windows builds use the same code but haven't been run yet.
- It polls every 10 s, so a prompt you answer within a few seconds may never make it dance.
- Long-running `terminal` commands look the same as a waiting approval (it dances for those too).
- `state.db` is Hermes's internal format. If a Hermes upgrade changes it, Info → DATABASE will say
  "unrecognised Hermes schema" and the pet sleeps rather than crashing.

## Hacking on it

```bash
cd app
npm run dev                      # then open http://localhost:1420/?demo in a browser (no Tauri needed)
                                 # http://localhost:1420/gallery.html renders every pet, state and screen
npm test                         # 594 vitest tests
node tests/e2e/screenshots.mjs   # Playwright screenshots into tests/out/
cd .. && cargo test --workspace  # 170 Rust tests (watcher replays real Hermes prompt rows)
```

In a browser, Shift+S shakes the stick and Shift+N switches pets; `?mock=<url-encoded JSON>` injects a
fake Hermes snapshot.

## Credits

Original firmware, ASCII pets and UI © 2026 Anthropic, PBC (MIT). Desktop port: see `LICENSE`.
Plan and design notes: [PLAN.md](PLAN.md).
