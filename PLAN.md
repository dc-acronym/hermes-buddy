# Hermes Buddy — plan

A desktop recreation of Anthropic's [claude-desktop-buddy](https://github.com/anthropics/claude-desktop-buddy)
M5StickC Plus desk pet, as a small always-on-top Tauri app for macOS and Windows. Instead of a BLE
bridge to Claude Desktop, it **watches a local Hermes Agent** by reading Hermes's own SQLite store.
Watch-only: it never talks back to Hermes.

Built for a friend who runs their own Hermes. Remote access (their tailnet) comes later as a
settings change; v1 is same-machine only.

## Decisions (locked)

| Topic | Decision |
|---|---|
| Base | Port the **original** `anthropics/claude-desktop-buddy` UI (1,265-line `main.cpp`), not the Hermes fork (2,727 lines, voice, Wi-Fi). Same 18 ASCII pets, same 7 states, same screens and menus. |
| Shell | Tauri v2. Frameless, opaque, always-on-top window drawn as an M5StickC Plus: 135×240 screen at 2× inside a bezel with clickable **A**, **B**, **Power** buttons and the red **LED**. |
| Rendering | A TypeScript canvas shim that mimics the `TFT_eSPI` sprite API (RGB565 framebuffer, classic 6×8 GLCD font, same datums, text wrap on), so firmware drawing code ports line by line. |
| Hermes data | Read `~/.hermes/state.db` (SQLite, WAL) **read-only** from Rust. **Poll every 10 s.** No Hermes config changes, no API key, no API server. |
| Attention | An assistant `clarify` or `terminal` tool call with **no matching `tool` result row** = Hermes is waiting (approval, question, or a slow command — we don't care which; the pet dances). Hermes persists the tool-call row *before* running the tool (`agent/turn_tool_round.py`). |
| Approvals | Dropped. Watch-only. The approval screen becomes an "attention" screen showing the tool + hint and "answer in Hermes". |
| Mood | **Press B on the pet screen to pet it.** Heart animation + beep every press; mood +1 heart at most once per 60 s; decays 1 heart per 3 h without petting. Replaces approval-speed mood. The pet screen's second page (how-to) moves into Info → BUTTONS. |
| Power | Desktop is treated as "always on USB power": no 30 s auto screen-off, clock face shows when idle (as the stick does while charging). |
| Out of scope (v1) | Remote/tailnet access, approvals, voice/Groq, transparency/click-through, macOS above-fullscreen, code signing/notarization, auto-update. |

## Controls

| Original stick | Hermes Buddy |
|---|---|
| **A** tap: next screen (normal → pet → info) | Click A, or `Space` / `A` |
| **B** tap: scroll transcript / next info page / menu confirm | Click B, or `Enter` / `B` |
| **B** on pet screen: next page | **Pet the buddy** (mood) |
| **Hold A** 600 ms: menu | Hold A, or `Esc` / `M` |
| **Power** short: screen off/on | Click power, or `P` |
| **Power** ~6 s: hard power off | Hold power ~1.5 s → hide to tray (tray has Show / Quit) |
| **Shake**: dizzy | Grab the window and shake it (≥3 direction reversals in 700 ms) |
| **Face-down**: nap, energy refills | Minimize / hide the window (page visibility hidden) |
| Approval: A approve / B deny | Removed (watch-only) |
| LED blinks on attention | Red LED on the bezel blinks (if `led` setting on) |
| Screen wakes on any button | Same |

Menus port as-is with desktop analogues:

- **Menu:** settings · turn off (screen off) · help (Info → BUTTONS) · about (Info → CREDITS) · demo · close
- **Settings:** brightness (screen brightness filter) · sound (WebAudio beeps) · **hermes** (was bluetooth: opens the db-path overlay) · **on top** (was wifi: always-on-top toggle) · led · transcript · clock rot (auto/port/land; auto = portrait, no IMU) · ascii pet · reset · back
- **Reset:** delete char · factory reset · back (tap-twice confirm, as original)
- **Info pages:** ABOUT · BUTTONS (+ old pet how-to) · HERMES (was CLAUDE) · DEVICE (app/OS/uptime) · DATABASE (was BLUETOOTH: db path, last poll, schema) · CREDITS
- **Pet page:** stats only (mood, fed, energy, level, pets, naps)

## Hermes data contract

Rust (`crates/hermes-watch`) produces a `HermesSnapshot` every 10 s, emitted to the UI as event
`hermes://snapshot` (camelCase JSON):

```ts
interface HermesSnapshot {
  connected: boolean;          // db opened + schema recognised
  error: string | null;        // "state.db not found at …", "unknown schema", …
  dbPath: string;
  schemaVersion: number | null;
  sessionsTotal: number;       // sessions with activity in the last 24 h (excl. source = 'cron')
  sessionsRunning: number;     // ended_at IS NULL and last_activity_at within the running window
  sessionsWaiting: number;     // unanswered clarify/terminal tool calls (attention)
  recentlyCompleted: boolean;  // a session left "running" since the previous poll
  tokensToday: number;         // input+output for sessions started since local midnight
  tokensLifetime: number;      // input+output across all sessions (drives level-ups)
  msg: string;                 // ≤23 chars: last_activity_description of newest running session, else "idle"
  lines: string[];             // ≤8 transcript entries of newest session, each ≤91 chars, oldest first
  lineGen: number;             // bumps when lines change
  prompt: { id: string; tool: string; hint: string } | null;  // first pending call
  model: string;               // newest session's model, ≤15 chars
  polledAt: number;            // epoch ms
}
```

Attention query (one statement, uses the existing `(session_id, id)` index):

```sql
SELECT m.session_id, tc.value ->> '$.id', tc.value ->> '$.function.name', tc.value ->> '$.function.arguments'
FROM messages m, json_each(m.tool_calls) tc
WHERE m.role = 'assistant' AND m.active = 1
  AND m.timestamp > unixepoch() - 1800
  AND tc.value ->> '$.function.name' IN ('clarify', 'terminal')
  AND NOT EXISTS (SELECT 1 FROM messages r
                  WHERE r.session_id = m.session_id AND r.id > m.id
                    AND r.role = 'tool' AND r.tool_call_id = tc.value ->> '$.id');
```

Known limits: prompts answered in under ~10 s may never be seen; orphaned calls (crash) age out
after 30 min; long `terminal` commands also trigger attention.

Db path: `$HERMES_HOME/state.db`, else `~/.hermes/state.db`; overridable in settings. Open with
`SQLITE_OPEN_READ_ONLY`, short queries, 1 s busy timeout, reopen on error. Query only named columns;
treat unknown schema as `connected: false` with an error, never crash.

## Rust ↔ UI contract

Events (Rust → UI): `hermes://snapshot` (HermesSnapshot) · `buddy://shake` · `buddy://next-pet` (tray) · `buddy://character-installed` (CharacterPack; Rust handles the window drag-drop of a pack folder)

Commands (UI → Rust):

| Command | Args → Result |
|---|---|
| `load_json` | `{ name }` → `Value \| null` (app config dir `<name>.json`; name `[a-z0-9_-]+`) |
| `save_json` | `{ name, value }` → `()` |
| `get_config` | → `{ dbPath: string \| null, dbPathResolved: string }` |
| `set_db_path` | `{ path: string \| null }` → `()` then polls immediately |
| `poll_now` | → `()` (emits a snapshot) |
| `set_always_on_top` | `{ on }` → `()` |
| `hide_window` / `quit_app` | → `()` |
| `install_character` | `{ dir }` → `CharacterPack` (copies a dropped folder with `manifest.json` into app data) |
| `get_character` | → `CharacterPack \| null` |
| `delete_character` | → `()` |
| `factory_reset` | → `()` (deletes stored JSON + character) |

`CharacterPack = { name: string, manifest: Value, files: Record<string, string /* base64 */> }`

The UI must also run in a plain browser (no Tauri) with mocks — `?demo` cycles fake scenarios,
`?mock=<json>` injects a snapshot — so it can be screenshot-tested with Playwright.

## Layout

```
hermes-buddy/
  PLAN.md  README.md  .tome.yaml  LICENSE  Cargo.toml (workspace)
  crates/hermes-watch/      pure Rust: state.db → HermesSnapshot (+ fixture-db tests)
  app/
    index.html  package.json  vite.config.ts
    src/hw/       tft.ts (canvas TFT_eSPI shim) · glcdfont.ts · input.ts (A/B/PWR) · platform.ts (Tauri/browser)
    src/data/     types.ts · source.ts (snapshot → TamaState, demo, mocks)
    src/buddy/    common.ts (helpers) · buddy.ts (registry/tick) · species/*.ts (18)
    src/character.ts   GIF packs (gifuct-js)
    src/stats.ts       port of stats.h (+ petting mood) and settings
    src/app/      state.ts · loop.ts (setup/loop/derive/buttons) · menus.ts · screens.ts
    src-tauri/    Tauri v2 shell: window, tray, commands, poller thread, shake detection
    tests/        vitest units + Playwright screenshot harness (gallery.html)
```

## Team plan (parallel)

Phase 0 (lead): plan, scaffold, shared contracts (`types.ts`, `common.ts`, `state.ts`, `platform.ts`/`input.ts` signatures).

Phase 1 (parallel Sonnet agents, disjoint file ownership):

| # | Agent | Owns |
|---|---|---|
| 1 | tft | `hw/tft.ts`, `hw/glcdfont.ts`, tft unit tests |
| 2 | buddy+gif | `buddy/buddy.ts`, `character.ts` |
| 3–5 | species ×3 | 6 species each in `buddy/species/` |
| 6 | screens | `app/screens.ts` (info, pet, HUD transcript, attention, clock, splash) |
| 7 | loop+menus+stats | `app/loop.ts`, `app/menus.ts`, `stats.ts`, `main.ts` |
| 8 | hermes-watch | `crates/hermes-watch` + fixture tests |
| 9 | tauri shell | `app/src-tauri/**` |
| 10 | platform+bezel | `index.html`, `src/style.css`, `hw/input.ts`, `hw/platform.ts`, `data/source.ts` |
| 11 | qa harness | `tests/**`, `gallery.html`, screenshot scripts |

Phase 2 (lead + agents): integrate, `tsc` + `vitest` + `cargo test` + `tauri build` (Linux, in the
cloud env), Playwright contact sheets of all 18 species × 7 states and every screen, fix-up agents,
independent review agent, README for the friend.

## Verification

- `cargo test -p hermes-watch` against a fixture db built from Hermes's real schema, including the
  pending-clarify / pending-terminal / answered / denied rows from a real session dump.
- `vitest`: font glyph rendering, datum math, printf, input tap-vs-hold, mood decay/rate-limit.
- Playwright: gallery screenshots compared by eye against the firmware's art.
- `npm run tauri build` on Linux in the cloud env; Mac/Windows builds are local
  (`npm run tauri build` on each machine, unsigned).

## Risks

- Hermes's `state.db` schema is internal and changes between versions → query named columns only, check `schema_version`, fail soft.
- 10 s poll misses quickly answered prompts → accepted.
- Shake detection depends on OS window-move event cadence → tunable thresholds.
- `bufo` GIFs are third-party art → not bundled; users drop a pack folder on the window.

## As built (2026-10-27)

Changes made during implementation and review, on top of the decisions above:

- **Persona:** `derive()` is Hermes-shaped: disconnected → sleep (firmware: idle), busy at ≥ 1 running
  session (firmware: ≥ 3; Hermes usually runs one). A finished session cheers as a 3 s one-shot, because
  the always-on-USB clock schedule would otherwise hide the firmware's "completed → celebrate" for good.
  No clock face while disconnected, so "No Hermes connected" is visible on the home screen.
- **Running window:** 135 s (2 × Hermes's 60 s activity heartbeat + 15 s), using the freshest of
  `last_activity_at` and the newest message. Subagent sessions count with their parent; compression
  rollovers and subagent exits don't count as "completed".
- **Attention query:** scoped to sessions active in the last 24 h (the verbatim query scanned every
  assistant row: 0.43 s vs 1 ms on a 2.5 GB db).
- **No file handles held:** the watcher opens a fresh read-only connection per poll and drops it, so
  Hermes's own maintenance (optimize/prune/repair, which refuse while a "foreign holder" has the db open)
  is unaffected; with no sidecars present it opens `immutable=1` so it never creates `-wal`/`-shm`.
- **Windows default db:** `%LOCALAPPDATA%\hermes\state.db`, matching `hermes_constants.py`.
- **Firmware quirks fixed** where the desktop exposed them: transcript scroll couldn't wrap back,
  HUD dropped the newest rows once its buffer filled, menu "turn off" woke itself, closed panels left
  ghost edges, attention panel lingered after the prompt was answered elsewhere.
- **Rendering:** `Display.push()` skips frames identical to the last one painted (the 60 Hz loop mostly
  idles between the pet's 5 fps ticks).
- **Verification actually run:** 594 vitest + Rust workspace tests; 576-cell visual gallery; Linux release
  build (`.deb`, 4.2 MB) driven under Xvfb against a fake `state.db` built from Hermes's real schema
  (busy → attention → answered → idle clock, keyboard-driven menus, landscape clock). macOS and Windows
  builds are untested.
