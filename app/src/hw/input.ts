// Virtual M5StickC buttons. OWNER: platform+bezel agent.
// Frozen contract: mirrors the M5 Button API so ported loop code reads the same.
// inputUpdate() is called once per frame (like M5.update()); edge flags (wasPressed,
// wasReleased) are true for exactly one frame after the edge.
//
// Edges are queued with the millis() at which they happened, one edge is consumed per
// button per frame. A click that goes down and up between two frames therefore still
// yields wasPressed on one frame and wasReleased on the next, and pressedFor() measures
// from the real press time rather than from the frame that noticed it.

import { millis } from "./platform";

export interface Button {
  isPressed(): boolean;
  wasPressed(): boolean;
  wasReleased(): boolean;
  /** True while held continuously for at least ms. */
  pressedFor(ms: number): boolean;
}

/** Feed edges from the bezel (pointer) and keyboard. id: "A" | "B" | "PWR". */
export type ButtonId = "A" | "B" | "PWR";

/** AXP192 power-key long-press threshold (hold this long -> 0x01). */
export const PWR_LONG_MS = 1500;
/** How long Esc / M holds virtual button A (the firmware opens the menu at 600 ms). */
export const MENU_HOLD_MS = 700;
/** How long the P key holds the power button (a short press). */
export const PWR_TAP_MS = 80;

const MAX_QUEUE = 64;

interface Edge {
  down: boolean;
  t: number;
}

interface BtnState {
  /** Everything currently holding the button down (pointers, keys, "api"). */
  sources: Set<string>;
  /** Edges not yet seen by inputUpdate(). */
  queue: Edge[];
  /** Frame-visible state: what isPressed() reports. */
  down: boolean;
  downAt: number;
  releasedAt: number;
  wasP: boolean;
  wasR: boolean;
}

const DOM_ID: Record<ButtonId, string> = { A: "btnA", B: "btnB", PWR: "btnPwr" };
const IDS: ButtonId[] = ["A", "B", "PWR"];

const states: Record<ButtonId, BtnState> = {
  A: newState(),
  B: newState(),
  PWR: newState(),
};

function newState(): BtnState {
  return { sources: new Set(), queue: [], down: false, downAt: 0, releasedAt: 0, wasP: false, wasR: false };
}

function makeButton(id: ButtonId): Button {
  return {
    isPressed: () => states[id].down,
    wasPressed: () => states[id].wasP,
    wasReleased: () => states[id].wasR,
    pressedFor: (ms: number) => states[id].down && millis() - states[id].downAt >= ms,
  };
}

export const BtnA: Button = makeButton("A");
export const BtnB: Button = makeButton("B");
/** The power key as a plain button (the loop normally uses pwrGetBtnPress()). */
export const BtnPwr: Button = makeButton("PWR");

let pwrPending = 0;
let pwrLongFired = false;

/**
 * Power button, AXP-style: returns 0x02 once after a short press (released before
 * 1500 ms), 0x01 once when a long press crosses 1500 ms, else 0. Read once per frame.
 */
export function pwrGetBtnPress(): number {
  const v = pwrPending;
  pwrPending = 0;
  return v;
}

/** Latch edges for this frame. Call once at the top of each loop iteration. */
export function inputUpdate(): void {
  for (const id of IDS) {
    const b = states[id];
    b.wasP = false;
    b.wasR = false;
    const e = b.queue.shift();
    if (!e) continue;
    if (e.down) {
      b.down = true;
      b.downAt = e.t;
      b.wasP = true;
    } else {
      b.down = false;
      b.releasedAt = e.t;
      b.wasR = true;
    }
  }

  const p = states.PWR;
  if (p.wasP) pwrLongFired = false;
  if (p.wasR) {
    if (!pwrLongFired) pwrPending = p.releasedAt - p.downAt >= PWR_LONG_MS ? 0x01 : 0x02;
  } else if (p.down && !pwrLongFired && millis() - p.downAt >= PWR_LONG_MS) {
    pwrLongFired = true;
    pwrPending = 0x01;
  }
}

/** Press/release from the bezel or keyboard (used by bezel code and tests). */
export function inputSet(id: ButtonId, down: boolean): void {
  setSource(id, "api", down);
}

function setSource(id: ButtonId, source: string, down: boolean): void {
  const b = states[id];
  const had = b.sources.size > 0;
  if (down) b.sources.add(source);
  else b.sources.delete(source);
  const has = b.sources.size > 0;
  if (has === had) return;
  b.queue.push({ down: has, t: millis() });
  if (b.queue.length > MAX_QUEUE) {
    // Nothing is draining the queue (frames stalled): keep only the final state.
    b.queue.length = 0;
    if (has !== b.down) b.queue.push({ down: has, t: millis() });
  }
  markDom(id, has);
}

function markDom(id: ButtonId, down: boolean): void {
  if (typeof document === "undefined") return;
  document.getElementById(DOM_ID[id])?.classList.toggle("down", down);
}

/** Drop every held source, pending edge and timer; buttons read as released. Test helper. */
export function inputReset(): void {
  for (const id of IDS) {
    states[id] = newState();
    markDom(id, false);
  }
  pwrPending = 0;
  pwrLongFired = false;
  for (const t of timers) clearTimeout(t);
  timers.clear();
  menuHoldActive = false;
}

// ── DOM wiring ─────────────────────────────────────────────────────────────

const timers = new Set<ReturnType<typeof setTimeout>>();
let menuHoldActive = false;
let detach: (() => void) | null = null;

function later(fn: () => void, ms: number): void {
  const t = setTimeout(() => {
    timers.delete(t);
    fn();
  }, ms);
  timers.add(t);
}

type KeyAction = ButtonId | "MENU";

const KEY_BY_CODE: Record<string, KeyAction> = {
  Space: "A",
  KeyA: "A",
  Enter: "B",
  NumpadEnter: "B",
  KeyB: "B",
  Escape: "MENU",
  KeyM: "MENU",
  KeyP: "PWR",
};

const KEY_BY_KEY: Record<string, KeyAction> = {
  " ": "A",
  a: "A",
  Enter: "B",
  b: "B",
  Escape: "MENU",
  m: "MENU",
  p: "PWR",
};

function keyTag(e: KeyboardEvent): string {
  return `key:${e.code || e.key.toLowerCase()}`;
}

function keyAction(e: KeyboardEvent): KeyAction | undefined {
  return KEY_BY_CODE[e.code] ?? KEY_BY_KEY[e.key?.length === 1 ? e.key.toLowerCase() : e.key];
}

function isTypingTarget(el: unknown): boolean {
  if (!el || typeof (el as HTMLElement).tagName !== "string") return false;
  const h = el as HTMLElement;
  return h.tagName === "INPUT" || h.tagName === "TEXTAREA" || h.tagName === "SELECT" || h.isContentEditable;
}

function modalOpen(): boolean {
  return document.body.classList.contains("modal-open");
}

function releaseWhere(match: (source: string) => boolean): void {
  for (const id of IDS) {
    for (const s of [...states[id].sources]) if (match(s)) setSource(id, s, false);
  }
}

const isKeySource = (s: string): boolean => s.startsWith("key:");
const isPointerSource = (s: string): boolean => s.startsWith("ptr");

/**
 * Let go of every keyboard-held button. For when a keyup may never arrive (an overlay
 * took focus, the window lost it). The timed Esc/M hold is left to its own timer.
 */
export function inputReleaseKeys(): void {
  releaseWhere((s) => isKeySource(s) && s !== "key:menu");
}

/** Attach pointer + keyboard listeners. Keys: Space/A → A, Enter/B → B, Esc/M → hold A (menu), P → power. */
export function inputAttach(root: HTMLElement): void {
  detach?.();
  const cleanups: Array<() => void> = [];
  const on = <E extends Event>(
    target: EventTarget,
    type: string,
    fn: (e: E) => void,
    opts?: AddEventListenerOptions,
  ): void => {
    target.addEventListener(type, fn as EventListener, opts);
    cleanups.push(() => target.removeEventListener(type, fn as EventListener, opts));
  };

  // Pointer: the three on-screen buttons.
  for (const id of IDS) {
    const el = root.querySelector<HTMLElement>(`#${DOM_ID[id]}`);
    if (!el) continue;
    on<PointerEvent>(el, "pointerdown", (e) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      e.preventDefault();
      try {
        el.setPointerCapture?.(e.pointerId);
      } catch {
        /* pointer already gone */
      }
      setSource(id, `ptr${e.pointerId}`, true);
    });
    on<PointerEvent>(el, "lostpointercapture", (e) => setSource(id, `ptr${e.pointerId}`, false));
  }
  // Releases may land anywhere (capture unsupported, pointer left the webview).
  const pointerUp = (e: PointerEvent): void => {
    const tag = `ptr${e.pointerId}`;
    releaseWhere((s) => s === tag);
  };
  on<PointerEvent>(window, "pointerup", pointerUp, { capture: true });
  on<PointerEvent>(window, "pointercancel", pointerUp, { capture: true });
  on(root, "contextmenu", (e) => e.preventDefault());

  // Keyboard.
  on<KeyboardEvent>(window, "keydown", (e) => {
    const action = keyAction(e);
    if (!action) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (modalOpen() || isTypingTarget(e.target) || isTypingTarget(document.activeElement)) return;
    e.preventDefault(); // no page scroll on Space, no synthetic click on a focused button
    if (e.repeat) return;
    if (action === "MENU") {
      if (menuHoldActive) return;
      menuHoldActive = true;
      setSource("A", "key:menu", true);
      later(() => {
        setSource("A", "key:menu", false);
        menuHoldActive = false;
      }, MENU_HOLD_MS);
    } else if (action === "PWR") {
      const tag = keyTag(e);
      setSource("PWR", tag, true);
      later(() => setSource("PWR", tag, false), PWR_TAP_MS);
    } else {
      setSource(action, keyTag(e), true);
    }
  });
  on<KeyboardEvent>(window, "keyup", (e) => {
    const action = keyAction(e);
    if (action === "A" || action === "B") setSource(action, keyTag(e), false);
  });
  // Never leave a key or pointer stuck if the window loses focus mid-press.
  on(window, "blur", () => {
    inputReleaseKeys();
    releaseWhere(isPointerSource);
  });
  // A hidden window (minimized, hidden to the tray) gets no key/pointer-up and may throttle
  // timers, so drop everything, the timed holds included, or it would come back held.
  on(document, "visibilitychange", () => {
    if (document.visibilityState !== "hidden") return;
    releaseWhere((s) => isKeySource(s) || isPointerSource(s));
    for (const t of timers) clearTimeout(t);
    timers.clear();
    menuHoldActive = false;
  });

  detach = () => {
    for (const c of cleanups) c();
    detach = null;
  };
}

/** Remove the listeners added by inputAttach(). */
export function inputDetach(): void {
  detach?.();
}
