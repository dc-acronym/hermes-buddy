// Platform services: time, sound, LED, persistence, window control, Tauri bridge.
// OWNER: platform+bezel agent. Frozen contract — every function must work in a
// plain browser (no Tauri) with sensible fallbacks, so the UI can be screenshot-tested.
//
// Tauri command / event names are exactly the ones in PLAN.md ("Rust ↔ UI contract").

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { LogicalSize, PhysicalPosition, getCurrentWindow } from "@tauri-apps/api/window";
import type { CharacterPack } from "../data/types";
import { inputReleaseKeys } from "./input";
import type { Display } from "./tft";

export const isTauri: boolean =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const t0 = typeof performance !== "undefined" ? performance.now() : 0;

/** Milliseconds since app start (Arduino millis()). Tests may override via setMillisSource. */
export function millis(): number {
  return Math.floor(_millisSource());
}
let _millisSource: () => number = () => performance.now() - t0;
export function setMillisSource(fn: () => number): void {
  _millisSource = fn;
}

const hasDom = typeof window !== "undefined" && typeof document !== "undefined";

function warn(what: string, err: unknown): void {
  console.warn(`[platform] ${what}:`, err);
}

// ── Browser fallbacks: localStorage under "hermes-buddy:<name>" ──────────────

const LS_PREFIX = "hermes-buddy:";

function lsGet(name: string): unknown {
  try {
    const raw = localStorage.getItem(LS_PREFIX + name);
    return raw === null ? null : JSON.parse(raw);
  } catch {
    // Something is stored but unreadable: saveJson must not overwrite it with defaults.
    noteLoadFailed(name);
    return null;
  }
}

function lsSet(name: string, value: unknown): void {
  try {
    localStorage.setItem(LS_PREFIX + name, JSON.stringify(value));
  } catch (e) {
    warn(`localStorage ${name}`, e);
  }
}

function lsRemove(name: string): void {
  try {
    localStorage.removeItem(LS_PREFIX + name);
  } catch {
    /* storage unavailable */
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// ── Sound ───────────────────────────────────────────────────────────────────

const BEEP_GAIN = 0.05;

let audioCtx: AudioContext | null = null;
let audioUnlocked = false;
let curOsc: OscillatorNode | null = null;

function ensureAudio(): AudioContext | null {
  if (audioCtx) return audioCtx;
  if (!audioUnlocked || !hasDom) return null; // autoplay policy: wait for a user gesture
  const w = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
  const Ctor = w.AudioContext ?? w.webkitAudioContext;
  if (!Ctor) return null;
  try {
    audioCtx = new Ctor();
  } catch (e) {
    warn("AudioContext", e);
  }
  return audioCtx;
}

function unlockAudio(): void {
  audioUnlocked = true;
  const ctx = ensureAudio();
  if (ctx && ctx.state === "suspended") ctx.resume().catch(() => {});
}

/** Square-wave tone like M5.Beep.tone(freq, dur). No-op if audio unavailable. */
export function beep(freq: number, durMs: number): void {
  if (!(freq > 0) || !(durMs > 0)) return;
  const ctx = ensureAudio();
  if (!ctx) return;
  try {
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    // M5.Beep.tone() preempts whatever is sounding.
    if (curOsc) {
      try {
        curOsc.stop();
      } catch {
        /* already stopped */
      }
    }
    const t = ctx.currentTime;
    const dur = durMs / 1000;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "square";
    osc.frequency.value = freq;
    // Short ramps so the edges don't click.
    const ramp = Math.min(0.004, dur / 4);
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(BEEP_GAIN, t + ramp);
    gain.gain.setValueAtTime(BEEP_GAIN, t + dur - ramp);
    gain.gain.linearRampToValueAtTime(0, t + dur);
    osc.connect(gain).connect(ctx.destination);
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
      if (curOsc === osc) curOsc = null;
    };
    curOsc = osc;
    osc.start(t);
    osc.stop(t + dur + 0.01);
  } catch (e) {
    warn("beep", e);
  }
}

// ── LED ─────────────────────────────────────────────────────────────────────

/** Red LED on the bezel. */
export function setLed(on: boolean): void {
  if (!hasDom) return;
  document.getElementById("led")?.classList.toggle("lit", on);
}

// ── Persistence ─────────────────────────────────────────────────────────────

// Names whose read errored (not "not found", which loads as null). Their file may still
// hold real data, so saveJson leaves them alone for the session instead of writing the
// fallback over it. Value: whether the refusal has been warned about yet.
const loadFailed = new Map<string, boolean>();

function noteLoadFailed(name: string): void {
  if (!loadFailed.has(name)) loadFailed.set(name, false);
}

/**
 * Persist a small JSON blob (Tauri: app config dir; browser: localStorage).
 * A stored plain object is shallow-merged over `fallback`, so settings added in a
 * later version pick up their defaults instead of coming back undefined.
 */
export async function loadJson<T>(name: string, fallback: T): Promise<T> {
  let stored: unknown = null;
  if (isTauri) {
    try {
      stored = await invoke<unknown>("load_json", { name });
    } catch (e) {
      warn(`load_json ${name}`, e);
      noteLoadFailed(name);
    }
  } else {
    stored = lsGet(name);
  }
  if (stored === null || stored === undefined) return fallback;
  if (isPlainObject(fallback) && isPlainObject(stored)) return { ...fallback, ...stored } as T;
  return stored as T;
}

// Writes for one name are serialised and coalesced: while one is in flight, only the
// newest value waits, so rapid saves can never land out of order.
const saveBusy = new Set<string>();
const saveNext = new Map<string, unknown>();

export function saveJson(name: string, value: unknown): void {
  if (loadFailed.has(name)) {
    if (!loadFailed.get(name)) {
      loadFailed.set(name, true);
      warn(`not saving ${name}`, "its last read failed, so the stored copy is left untouched");
    }
    return;
  }
  if (!isTauri) {
    lsSet(name, value);
    return;
  }
  if (saveBusy.has(name)) {
    saveNext.set(name, value);
    return;
  }
  saveBusy.add(name);
  void (async () => {
    let next: unknown = value;
    let have = true;
    while (have) {
      try {
        await invoke("save_json", { name, value: next });
      } catch (e) {
        warn(`save_json ${name}`, e);
      }
      have = saveNext.has(name);
      if (have) {
        next = saveNext.get(name);
        saveNext.delete(name);
      }
    }
    saveBusy.delete(name);
  })();
}

// ── Window control (no-ops in the browser) ──────────────────────────────────

export function setAlwaysOnTop(on: boolean): void {
  if (!isTauri) return;
  invoke("set_always_on_top", { on }).catch((e) => warn("set_always_on_top", e));
}
export function hideWindow(): void {
  if (!isTauri) return;
  invoke("hide_window").catch((e) => warn("hide_window", e));
}
export function quitApp(): void {
  if (!isTauri) return;
  invoke("quit_app").catch((e) => warn("quit_app", e));
}

/** The bezel's design size; the window is resizable and the frame is scaled to fit it. */
export const PORTRAIT = { w: 330, h: 640 };
/** Smallest stick: 132px across, so portrait (132x256) and sideways (256x132) both fit the window minimum. */
const MIN_SCALE = 0.4;
/** A resize that has been still this long is over; then the window snaps to the stick. */
const SNAP_MS = 350;
let landscape = false;

/** Scale factor that fits the (possibly rotated) bezel inside a w x h viewport. */
export function fitScale(w: number, h: number, isLandscape: boolean): number {
  const fw = isLandscape ? PORTRAIT.h : PORTRAIT.w;
  const fh = isLandscape ? PORTRAIT.w : PORTRAIT.h;
  return Math.max(0.1, Math.min(w / fw, h / fh));
}

/** Re-fit the bezel to the window (style.css scales .frame by --fit). */
export function applyFit(): void {
  if (!hasDom) return;
  document.documentElement.style.setProperty("--fit", String(fitScale(window.innerWidth, window.innerHeight, landscape)));
}

/**
 * The window size that holds just the stick, with nothing around it: the stick at the scale it
 * has in a w x h window (lying sideways if fromLandscape), turned to toLandscape. The window is
 * transparent on macOS and Windows, so any room around the stick is invisible but still
 * catches clicks and holds the resize edges; snapping to this size removes it.
 */
export function stickWindowSize(
  w: number,
  h: number,
  fromLandscape: boolean,
  toLandscape: boolean,
): { w: number; h: number } {
  const scale = Math.max(MIN_SCALE, fitScale(w, h, fromLandscape));
  const fw = toLandscape ? PORTRAIT.h : PORTRAIT.w;
  const fh = toLandscape ? PORTRAIT.w : PORTRAIT.h;
  return { w: Math.round(fw * scale), h: Math.round(fh * scale) };
}

let shaping: Promise<void> = Promise.resolve();

/**
 * Size the window to the stick (see stickWindowSize), keeping the stick where it is on screen:
 * the window shrinks or turns around the stick's centre. Calls run one at a time, so a turn
 * reads the size the previous one left (the launch-time trim and the first sideways clock can
 * land together). Within a pixel counts as done, so the resize this causes doesn't set off another.
 */
function shapeWindow(fromLandscape: boolean | null, toLandscape: boolean): Promise<void> {
  shaping = shaping
    .then(() => reshape(fromLandscape, toLandscape))
    .catch((e) => warn("shape window", e));
  return shaping;
}

async function reshape(fromLandscape: boolean | null, toLandscape: boolean): Promise<void> {
  const win = getCurrentWindow();
  const [size, factor, pos] = await Promise.all([win.innerSize(), win.scaleFactor(), win.outerPosition()]);
  const cur = { w: size.width / factor, h: size.height / factor };
  // null: unknown (a remembered window at launch); only a clearly wide window was lying sideways.
  const from = fromLandscape ?? cur.w > cur.h * 1.5;
  const next = stickWindowSize(cur.w, cur.h, from, toLandscape);
  if (Math.abs(next.w - cur.w) <= 1 && Math.abs(next.h - cur.h) <= 1) return;
  await win.setSize(new LogicalSize(next.w, next.h));
  const dx = Math.round(((cur.w - next.w) / 2) * factor);
  const dy = Math.round(((cur.h - next.h) / 2) * factor);
  if (dx !== 0 || dy !== 0) await win.setPosition(new PhysicalPosition(pos.x + dx, pos.y + dy));
}

let snapTimer: ReturnType<typeof setTimeout> | null = null;

/** Window resized: re-fit the bezel now, and once the resize settles, snap the window to it. */
function onResize(): void {
  applyFit();
  if (!isTauri) return;
  if (snapTimer !== null) clearTimeout(snapTimer);
  snapTimer = setTimeout(() => {
    snapTimer = null;
    void shapeWindow(landscape, landscape);
  }, SNAP_MS);
}

if (hasDom) {
  // In a browser (dev, gallery, QA) the page paints the dark backdrop the window would show.
  if (!isTauri) document.documentElement.classList.add("web");
  window.addEventListener("resize", onResize);
  applyFit();
}

/** Lay the bezel on its side (see attachRotation for direction) and turn the Tauri window to match. */
export function setLandscape(on: boolean): void {
  if (on === landscape) return;
  landscape = on;
  if (hasDom) document.body.classList.toggle("landscape", on);
  applyFit();
  if (!isTauri) return;
  void shapeWindow(!on, on);
}

export function isLandscape(): boolean {
  return landscape;
}

/**
 * Wire the display's rotation callback to the bezel: an odd rotation (landscape clock)
 * turns the device on its side and the window with it. main.ts calls this at boot, which
 * is also when a window remembered in landscape (quit while the clock lay sideways) is
 * stood back up, since the app always starts in portrait.
 */
export function attachRotation(display: Display): void {
  display.onRotationChange = (rotation: number) => {
    if (hasDom) document.body.classList.toggle("ccw", (rotation & 3) === 3);
    setLandscape((rotation & 1) === 1);
  };
  if (isTauri) void shapeWindow(null, false);
}

// ── Hermes db path config ───────────────────────────────────────────────────

const DEFAULT_DB_PATH = "~/.hermes/state.db";

export async function getConfig(): Promise<{ dbPath: string | null; dbPathResolved: string }> {
  if (isTauri) {
    try {
      return await invoke<{ dbPath: string | null; dbPathResolved: string }>("get_config");
    } catch (e) {
      warn("get_config", e);
    }
  } else {
    const stored = lsGet("dbPath");
    if (typeof stored === "string" && stored) return { dbPath: stored, dbPathResolved: stored };
  }
  return { dbPath: null, dbPathResolved: DEFAULT_DB_PATH };
}

export async function setDbPath(path: string | null): Promise<void> {
  if (isTauri) {
    try {
      await invoke("set_db_path", { path });
    } catch (e) {
      warn("set_db_path", e);
    }
    return;
  }
  if (path) lsSet("dbPath", path);
  else lsRemove("dbPath");
}

/** A Hermes profile: "default" (the home's own state.db) or a named one under profiles/. */
export interface HermesProfile {
  name: string;
  path: string;
}

/** Default first, then each named profile that has a state.db (Settings → profile). */
export async function listProfiles(): Promise<HermesProfile[]> {
  if (isTauri) {
    try {
      return await invoke<HermesProfile[]>("list_profiles");
    } catch (e) {
      warn("list_profiles", e);
    }
  }
  return [{ name: "default", path: DEFAULT_DB_PATH }];
}

export function pollNow(): void {
  if (!isTauri) return;
  invoke("poll_now").catch((e) => warn("poll_now", e));
}

// ── db-path overlay (Settings → hermes) ─────────────────────────────────────

let overlayPending = false;

/** Opens the HTML overlay for editing the Hermes db path (Settings → hermes). */
export function openDbSettings(): void {
  if (!hasDom || overlayPending || document.getElementById("dbOverlay")) return;
  overlayPending = true;
  getConfig()
    .then((cfg) => {
      if (!document.getElementById("dbOverlay")) buildDbOverlay(cfg.dbPath, cfg.dbPathResolved);
    })
    .catch((e) => warn("openDbSettings", e))
    .finally(() => {
      overlayPending = false;
    });
}

function buildDbOverlay(current: string | null, resolved: string): void {
  const root = document.createElement("div");
  root.id = "dbOverlay";
  root.className = "overlay";
  root.setAttribute("data-tauri-drag-region", "");
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  root.setAttribute("aria-label", "Hermes database");

  const card = document.createElement("div");
  card.className = "overlay-card";

  const title = document.createElement("h2");
  title.textContent = "Hermes database";

  const blurb = document.createElement("p");
  blurb.textContent = "Where to find Hermes's state.db. It is only ever opened read-only.";

  const input = document.createElement("input");
  input.type = "text";
  input.spellcheck = false;
  input.autocomplete = "off";
  input.placeholder = resolved;
  input.value = current ?? "";
  input.setAttribute("aria-label", "Path to state.db");

  const hint = document.createElement("p");
  hint.className = "hint";
  hint.textContent = "Leave empty to use the default ($HERMES_HOME or ~/.hermes).";

  const row = document.createElement("div");
  row.className = "overlay-row";
  const mk = (label: string, cls: string): HTMLButtonElement => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    b.className = cls;
    return b;
  };
  const save = mk("Save", "primary");
  const useDefault = mk("Use default", "");
  const cancel = mk("Cancel", "");
  row.append(save, useDefault, cancel);

  card.append(title, blurb, input, hint, row);
  root.append(card);

  const close = (): void => {
    root.remove();
    document.body.classList.remove("modal-open");
  };
  const commit = (path: string | null): void => {
    close();
    void setDbPath(path);
  };

  save.addEventListener("click", () => commit(input.value.trim() || null));
  useDefault.addEventListener("click", () => commit(null));
  cancel.addEventListener("click", close);
  root.addEventListener("keydown", (e) => {
    e.stopPropagation(); // keys never reach the button handler while the overlay is up
    if (e.key === "Enter" || e.key === "Escape") {
      e.preventDefault();
      if (e.repeat) return; // the B press that opened this may still be held: don't auto-commit
      if (e.key === "Enter") commit(input.value.trim() || null);
      else close();
    }
  });
  // keyup is not swallowed: the button handler only ever uses it to let go of a held key.

  document.body.append(root);
  document.body.classList.add("modal-open");
  inputReleaseKeys(); // whatever opened this (the B press) won't see its keyup in here
  input.focus();
  input.select();
}

// ── Toast ───────────────────────────────────────────────────────────────────

const TOAST_MS = 4000;
const TOAST_MAX_CHARS = 120;
let toastTimer: ReturnType<typeof setTimeout> | null = null;

/** Small self-dismissing notice over the bezel. One at a time: a new one replaces the old. */
export function showToast(text: string): void {
  if (!hasDom) return;
  if (toastTimer !== null) clearTimeout(toastTimer);
  document.getElementById("toast")?.remove();
  const el = document.createElement("div");
  el.id = "toast";
  el.className = "toast";
  el.setAttribute("role", "status");
  el.textContent = text.length > TOAST_MAX_CHARS ? `${text.slice(0, TOAST_MAX_CHARS - 1)}…` : text;
  // Inside the frame, so it scales and turns with the bezel when the window is resized.
  (document.getElementById("frame") ?? document.body).append(el);
  toastTimer = setTimeout(() => {
    el.remove();
    toastTimer = null;
  }, TOAST_MS);
}

// ── GIF character packs ─────────────────────────────────────────────────────

export async function getCharacter(): Promise<CharacterPack | null> {
  if (isTauri) {
    try {
      return await invoke<CharacterPack | null>("get_character");
    } catch (e) {
      warn("get_character", e);
      return null;
    }
  }
  // Browser: a pack JSON stored under "hermes-buddy:character" (handy for screenshot tests).
  const stored = lsGet("character");
  return isPlainObject(stored) && typeof stored.name === "string" ? (stored as unknown as CharacterPack) : null;
}

export async function deleteCharacter(): Promise<void> {
  if (!isTauri) {
    lsRemove("character");
    return;
  }
  try {
    await invoke("delete_character");
  } catch (e) {
    warn("delete_character", e);
  }
}

export async function factoryReset(): Promise<void> {
  if (isTauri) {
    try {
      await invoke("factory_reset");
      loadFailed.clear(); // the files are gone: nothing left to protect
    } catch (e) {
      warn("factory_reset", e);
    }
    return;
  }
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(LS_PREFIX) && k !== LS_PREFIX + "dbPath") keys.push(k);
    }
    for (const k of keys) localStorage.removeItem(k);
    loadFailed.clear();
  } catch {
    /* storage unavailable */
  }
}

// ── Events ──────────────────────────────────────────────────────────────────

function subscribe<T>(event: string, cb: (payload: T) => void): () => void {
  if (!isTauri) return () => {};
  let off: (() => void) | null = null;
  let dead = false;
  listen<T>(event, (e) => {
    if (!dead) cb(e.payload);
  })
    .then((un) => {
      if (dead) un();
      else off = un;
    })
    .catch((e) => warn(`listen ${event}`, e));
  return () => {
    dead = true;
    off?.();
    off = null;
  };
}

function isTyping(el: unknown): boolean {
  const h = el as HTMLElement | null;
  if (!h || typeof h.tagName !== "string") return false;
  return h.tagName === "INPUT" || h.tagName === "TEXTAREA" || h.tagName === "SELECT" || h.isContentEditable;
}

/** Browser-only developer shortcut: Shift+<key> fires cb. */
function devKey(code: string, cb: () => void): () => void {
  if (!hasDom) return () => {};
  const h = (e: KeyboardEvent): void => {
    if (!e.shiftKey || e.code !== code || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    if (document.body.classList.contains("modal-open") || isTyping(e.target) || isTyping(document.activeElement)) return;
    cb();
  };
  window.addEventListener("keydown", h);
  return () => window.removeEventListener("keydown", h);
}

/** Window shaken ("buddy://shake"). Browser: Shift+S. */
export function onShake(cb: () => void): () => void {
  return isTauri ? subscribe<unknown>("buddy://shake", () => cb()) : devKey("KeyS", cb);
}

const NAP_POLL_MS = 1500;

/**
 * Nap = window minimized/hidden (true) or restored (false). Fires only on change.
 * Under Tauri the page-visibility event isn't reliable for minimize/hide-to-tray in
 * every webview (WKWebView, WebView2, WebKitGTK), so the window state is also polled.
 */
export function onNapChange(cb: (napping: boolean) => void): () => void {
  if (!hasDom) return () => {};
  let napping = document.visibilityState === "hidden";
  let winHidden = false;
  const update = (): void => {
    const now = document.visibilityState === "hidden" || winHidden;
    if (now !== napping) {
      napping = now;
      cb(now);
    }
  };
  document.addEventListener("visibilitychange", update);
  let timer: ReturnType<typeof setInterval> | null = null;
  if (isTauri) {
    timer = setInterval(() => {
      const w = getCurrentWindow();
      Promise.all([w.isMinimized(), w.isVisible()])
        .then(([min, vis]) => {
          winHidden = min || !vis;
          update();
        })
        .catch(() => {});
    }, NAP_POLL_MS);
  }
  return () => {
    document.removeEventListener("visibilitychange", update);
    if (timer) clearInterval(timer);
  };
}

/** Tray "Next pet" ("buddy://next-pet"). Browser: Shift+N. */
export function onNextPet(cb: () => void): () => void {
  return isTauri ? subscribe<unknown>("buddy://next-pet", () => cb()) : devKey("KeyN", cb);
}

/** A character pack was installed by drag-and-drop ("buddy://character-installed"). */
export function onCharacterInstalled(cb: (pack: CharacterPack) => void): () => void {
  return subscribe<CharacterPack>("buddy://character-installed", cb);
}

/** A dropped pack folder was rejected ("buddy://character-error"); the payload is a short reason. */
export function onCharacterError(cb: (reason: string) => void): () => void {
  return subscribe<unknown>("buddy://character-error", (p) =>
    cb(typeof p === "string" && p.trim() ? p.trim() : "unknown error"),
  );
}

// ── Device info ─────────────────────────────────────────────────────────────

let appVersion = "0.1.0";
if (isTauri) {
  import("@tauri-apps/api/app")
    .then((m) => m.getVersion())
    .then((v) => {
      if (v) appVersion = v;
    })
    .catch(() => {});
}

/** App/OS info for the DEVICE info page. */
export function deviceInfo(): { app: string; version: string; os: string } {
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  let os = isTauri ? "desktop" : "browser";
  if (/Windows/i.test(ua)) os = "Windows";
  else if (/Mac OS X|Macintosh|macOS/i.test(ua)) os = "macOS";
  else if (/Linux|X11/i.test(ua)) os = "Linux";
  return { app: "Hermes Buddy", version: appVersion, os };
}

// Rust rejects a bad pack drop on its own thread; without this it would fail silently.
if (isTauri && hasDom) onCharacterError((reason) => showToast(`Pet pack rejected: ${reason}`));

// ── Global guards (browser + Tauri) ─────────────────────────────────────────

if (hasDom) {
  // WebAudio may only start after a user gesture.
  for (const type of ["pointerdown", "pointerup", "keydown"]) {
    window.addEventListener(type, unlockAudio, { capture: true, passive: true });
  }
  // The device is not a web page: no context menu, and a double-click on the body must
  // not reach Tauri's drag script (it toggles maximize on mousedown, or on mouseup on macOS).
  window.addEventListener("contextmenu", (e) => {
    if (!(e.target as HTMLElement | null)?.closest?.("input")) e.preventDefault();
  });
  const swallowDoubleClick = (e: MouseEvent): void => {
    if (e.detail >= 2 && !(e.target as HTMLElement | null)?.closest?.("button, input")) e.stopPropagation();
  };
  window.addEventListener("mousedown", swallowDoubleClick, { capture: true });
  window.addEventListener("mouseup", swallowDoubleClick, { capture: true });
}
