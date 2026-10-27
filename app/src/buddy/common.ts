// Shared constants and helpers for species files — port of buddy_common.h plus the
// render helpers from buddy.cpp. Each species file (buddy/species/<name>.ts) imports
// these and exports one `Species`. Frozen contract (lead-owned).

import type { Sprite } from "../hw/tft";

// Geometry — shared layout for all species (1x coordinates)
export const BUDDY_X_CENTER = 67;
export const BUDDY_CANVAS_W = 135;
export const BUDDY_Y_BASE = 30;
export const BUDDY_Y_OVERLAY = 6;
export const BUDDY_CHAR_W = 6;
export const BUDDY_CHAR_H = 8;

// Common colors species can use freely (RGB565)
export const BUDDY_BG = 0x0000;
export const BUDDY_HEART = 0xf810;
export const BUDDY_DIM = 0x8410;
export const BUDDY_YEL = 0xffe0;
export const BUDDY_WHITE = 0xffff;
export const BUDDY_CYAN = 0x07ff;
export const BUDDY_GREEN = 0x07e0;
export const BUDDY_PURPLE = 0xa01f;
export const BUDDY_RED = 0xf800;
export const BUDDY_BLUE = 0x041f;

/** Per-state render function; t is the global tick count (uint32, 5 ticks/s). */
export type StateFn = (t: number) => void;

export interface Species {
  name: string;
  bodyColor: number;
  /** Indexed by PersonaState: sleep, idle, busy, attention, celebrate, dizzy, heart. */
  states: [StateFn, StateFn, StateFn, StateFn, StateFn, StateFn, StateFn];
}

// ── render target indirection (set by buddy.ts) ──
let _tgt: Sprite | null = null;
let _scale = 1;

export function _setTarget(s: Sprite): void {
  _tgt = s;
}
export function _getTarget(): Sprite {
  if (!_tgt) throw new Error("buddy render target not set");
  return _tgt;
}
export function _setScale(s: number): void {
  _scale = s;
}
export function _getScale(): number {
  return _scale;
}

// The firmware measures lines with strlen() (UTF-8 bytes) while TFT_eSPI's write()
// decodes UTF-8 and draws one glyph per code point. duck's "´" (C2 B4) therefore
// counts as two cells for centering but draws as one; keep that so the art lines up.
const _utf8 = new TextEncoder();

// 2x on home screen, 1x in peek (PET/INFO) and landscape clock. Species art is
// space-padded to a fixed width for alignment at 1x; at 2x we trim and re-center
// per line so the padding doesn't push ink off-screen.
export function buddyPrintLine(line: string, yPx: number, color: number, xOff = 0): void {
  const tgt = _getTarget();
  let s = line;
  if (_scale > 1) s = s.replace(/^ +/, "").replace(/ +$/, "");
  const w = _utf8.encode(s).length * BUDDY_CHAR_W * _scale;
  const x = BUDDY_X_CENTER - Math.trunc(w / 2) + xOff * _scale;
  tgt.setTextColor(color, BUDDY_BG);
  tgt.setCursor(x, yPx);
  for (let i = 0; i < s.length; i++) tgt.print(s[i]);
}

/** Print an N-line sprite block. yOffset is added to BUDDY_Y_BASE for the top row. */
export function buddyPrintSprite(
  lines: readonly string[],
  nLines: number,
  yOffset: number,
  color: number,
  xOff = 0,
): void {
  const tgt = _getTarget();
  tgt.setTextSize(_scale);
  const yBase = BUDDY_Y_BASE * _scale - (_scale - 1) * 14;
  for (let i = 0; i < nLines; i++) {
    buddyPrintLine(lines[i], yBase + (yOffset + i * BUDDY_CHAR_H) * _scale, color, xOff);
  }
}

// Species pass 1x coords (relative to BUDDY_X_CENTER / BUDDY_Y_OVERLAY);
// transform here so all species files stay scale-agnostic.
export function buddySetCursor(x: number, y: number): void {
  _getTarget().setCursor(BUDDY_X_CENTER + (x - BUDDY_X_CENTER) * _scale, y * _scale);
}
export function buddySetColor(fg: number): void {
  _getTarget().setTextColor(fg, BUDDY_BG);
}
export function buddyPrint(s: string): void {
  const tgt = _getTarget();
  tgt.setTextSize(_scale);
  tgt.print(s);
}
