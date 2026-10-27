// GIF character packs — port of character.cpp. OWNER: buddy+gif agent.
// Frozen contract: signatures below. Decodes GIFs with gifuct-js into RGBA frames
// and draws them into the shared sprite (spr) via Sprite.drawRgba.
//
// Firmware: LittleFS files + AnimatedGIF scanline callbacks. Here: a pack is
// { name, manifest, files: filename -> base64 }, each GIF is decoded lazily (one
// frame per call, composited into a full-canvas RGBA frame) and blitted whole.

import { parseGIF, decompressFrame } from "gifuct-js";
import type { ParsedFrame, ParsedGif } from "gifuct-js";
import { cssToRgb565 } from "./hw/tft";
import type { Sprite } from "./hw/tft";
import { millis } from "./hw/platform";
import { spr } from "./app/state";
import { STATE_NAMES } from "./data/types";
import type { CharacterPack, Palette } from "./data/types";

const N_STATES = 7;

// Text mode: manifest has "mode":"text", states contain {frames:[...],delay:N}.
// Frames are short strings rendered at text size 2, centered. No GIF pipeline.
interface TextState {
  frames: string[]; // up to 8, each up to 19 chars
  delayMs: number;
}
const textStates: TextState[] = [];
let textMode = false;
let textFrame = 0;
let textNext = 0;

let loaded = false;
const DEFAULT_PALETTE: Palette = Object.freeze({
  body: 0xc2a6,
  bg: 0x0000,
  text: 0xffff,
  textDim: 0x8410,
  ink: 0x0000,
});
let pal: Palette = DEFAULT_PALETTE;
let files: Record<string, string> = {};
const MAX_GIFS = 32;
let gifPaths: string[] = [];
const stateStart: number[] = new Array(N_STATES).fill(0);
const stateCount: number[] = new Array(N_STATES).fill(0);
const stateRot: number[] = new Array(N_STATES).fill(0);
let curState = 0xff;

let gifX = 0, gifY = 0, gifW = 0, gifH = 0;
// Peek mode pins the GIF bottom to the info-panel top (y=70) so the pet
// sits on the panel edge regardless of canvas height. Home mode centers
// in the upper 140px. No padding assumed in the source art.
const PEEK_TOP = 70;
let peekMode = false;
// Peek mode renders at half scale (2:1 nearest-neighbor in blit) so
// the whole pet fits the 70px window instead of cropping the top.
function gifPlace(): void {
  const outW = peekMode ? gifW >> 1 : gifW;
  const outH = peekMode ? gifH >> 1 : gifH;
  gifX = Math.trunc((spr.width() - outW) / 2);
  gifY = peekMode ? Math.trunc((PEEK_TOP - outH) / 2) : Math.trunc((140 - outH) / 2);
}
let nextFrameAt = 0;
let animPauseUntil = 0;
let variantStartedMs = 0;
const VARIANT_DWELL_MS = 5000;
const ANIM_PAUSE_MS = 800;
let gifOpen = false;

function parseHexColor(s: unknown, fallback: number): number {
  if (typeof s !== "string") return fallback;
  let h = s.trim();
  if (h.startsWith("#")) h = h.slice(1);
  if (/^[0-9a-fA-F]{3}$/.test(h)) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return fallback;
  return cssToRgb565("#" + h) & 0xffff;
}

// --- GIF decode: gifuct-js patches -> composited full-canvas RGBA frames --------
// Frames are decoded one at a time, in order, the first time they are played (so a
// big GIF never blocks the UI for its whole length) and cached for later loops.

type RawFrame = Extract<ParsedGif["frames"][number], { image: unknown }>;

interface GifFrame {
  rgba: Uint8ClampedArray; // gifW*gifH*4, alpha 0 where nothing is painted
  half: Uint8ClampedArray | null; // lazily built 2:1 nearest-neighbor copy for peek
  delay: number; // ms, 0 = unspecified
}

interface DecodedGif {
  w: number;
  h: number;
  raw: RawFrame[];
  gct: [number, number, number][];
  frames: GifFrame[]; // decoded so far
  total: number; // frames available (shrinks if one fails to decode)
  // running compositor state
  canvas: Uint8ClampedArray;
  restore: Uint8ClampedArray | null; // snapshot for disposal 3
  prevDisposal: number;
  prevRect: { x: number; y: number; w: number; h: number };
  bytes: number;
}

const decoded = new Map<string, DecodedGif>(); // insertion order = LRU order
const MAX_CACHE_BYTES = 48 * 1024 * 1024;
let cur: DecodedGif | null = null; // the GIF being played (firmware: `gif`)
let curIdx = 0; // next frame to play

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64.replace(/\s+/g, ""));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function findFile(name: string): string | undefined {
  if (name in files) return files[name];
  const norm = name.replace(/^\.?\//, "");
  return norm in files ? files[norm] : undefined;
}

function parseGifFile(name: string): DecodedGif | null {
  const b64 = findFile(name);
  if (b64 === undefined) return null;
  const bytes = b64ToBytes(b64);
  const gif = parseGIF(bytes.buffer as ArrayBuffer);
  const raw = gif.frames.filter((f): f is RawFrame => "image" in f && !!f.image);
  let w = gif.lsd.width;
  let h = gif.lsd.height;
  if (!(w > 0 && h > 0)) {
    // Logical screen missing: fall back to the extent of the frames.
    for (const f of raw) {
      const d = f.image.descriptor;
      w = Math.max(w, d.left + d.width);
      h = Math.max(h, d.top + d.height);
    }
  }
  if (!(w > 0 && h > 0) || raw.length === 0) return null;
  return {
    w, h, raw,
    gct: gif.gct ?? [],
    frames: [],
    total: raw.length,
    canvas: new Uint8ClampedArray(w * h * 4),
    restore: null,
    prevDisposal: 0,
    prevRect: { x: 0, y: 0, w: 0, h: 0 },
    bytes: 0,
  };
}

/** Decode + composite the next frame of g. False when it can't (truncated/corrupt GIF). */
function decodeNext(g: DecodedGif): boolean {
  const n = g.frames.length;
  if (n >= g.total) return false;
  let f: ParsedFrame | undefined;
  try {
    f = decompressFrame(g.raw[n], g.gct, true);
  } catch {
    f = undefined;
  }
  if (!f || !f.patch) {
    g.total = n;
    return false;
  }

  // Dispose of the previous frame before painting this one.
  if (n > 0) {
    if (g.prevDisposal === 2) {
      const r = g.prevRect;
      for (let y = Math.max(r.y, 0); y < Math.min(r.y + r.h, g.h); y++) {
        const a = (y * g.w + Math.max(r.x, 0)) * 4;
        const b = (y * g.w + Math.min(r.x + r.w, g.w)) * 4;
        if (b > a) g.canvas.fill(0, a, b);
      }
    } else if (g.prevDisposal === 3 && g.restore) {
      g.canvas.set(g.restore);
    }
  }
  const disposal = f.disposalType ?? 0;
  g.restore = disposal === 3 ? g.canvas.slice() : null;

  // Paint the patch; transparent patch pixels leave what's beneath.
  const { left, top, width, height } = f.dims;
  const patch = f.patch;
  for (let y = 0; y < height; y++) {
    const cy = top + y;
    if (cy < 0 || cy >= g.h) continue;
    for (let x = 0; x < width; x++) {
      const cx = left + x;
      if (cx < 0 || cx >= g.w) continue;
      const si = (y * width + x) * 4;
      if (si + 3 >= patch.length) break;
      if (patch[si + 3] === 0) continue;
      const di = (cy * g.w + cx) * 4;
      g.canvas[di] = patch[si];
      g.canvas[di + 1] = patch[si + 1];
      g.canvas[di + 2] = patch[si + 2];
      g.canvas[di + 3] = 255;
    }
  }
  g.prevDisposal = disposal;
  g.prevRect = { x: left, y: top, w: width, h: height };

  g.frames.push({ rgba: g.canvas.slice(), half: null, delay: f.delay ?? 0 });
  g.bytes += g.canvas.length;
  return true;
}

function frameAt(g: DecodedGif, i: number): GifFrame | null {
  while (g.frames.length <= i) {
    if (!decodeNext(g)) return null;
  }
  return g.frames[i];
}

/** Keep the cache under MAX_CACHE_BYTES by dropping least-recently-opened GIFs. */
function trimCache(keep: DecodedGif): void {
  let total = 0;
  for (const g of decoded.values()) total += g.bytes;
  for (const [k, g] of decoded) {
    if (total <= MAX_CACHE_BYTES) break;
    if (g === keep) continue;
    decoded.delete(k);
    total -= g.bytes;
  }
}

// 2:1 nearest-neighbor, even source rows/cols only (rows round up like the
// firmware's `if (srcY & 1) return`).
function halfOf(g: DecodedGif, f: GifFrame): Uint8ClampedArray {
  if (f.half) return f.half;
  const hw = g.w >> 1;
  const hh = (g.h + 1) >> 1;
  const out = new Uint8ClampedArray(hw * hh * 4);
  for (let j = 0; j < hh; j++) {
    for (let i = 0; i < hw; i++) {
      const si = (j * 2 * g.w + i * 2) * 4;
      const di = (j * hw + i) * 4;
      out[di] = f.rgba[si];
      out[di + 1] = f.rgba[si + 1];
      out[di + 2] = f.rgba[si + 2];
      out[di + 3] = f.rgba[si + 3];
    }
  }
  f.half = out;
  return out;
}

// --- Blit: one decoded frame -> draw target ----------------------------------
// Transparent pixels get the character's bg color so each frame fully
// paints its region — no ghosting from prior frames.

function blit(tgt: Sprite, g: DecodedGif, f: GifFrame, peek: boolean, gx: number, gy: number): void {
  let img = f.rgba;
  let iw = g.w;
  let ih = g.h;
  if (peek) {
    img = halfOf(g, f);
    iw = g.w >> 1;
    ih = (g.h + 1) >> 1;
  }
  const maxY = peek ? Math.min(tgt.height(), PEEK_TOP) : tgt.height();
  const x0 = Math.max(gx, 0);
  const y0 = Math.max(gy, 0);
  const w = Math.min(gx + iw, tgt.width()) - x0;
  const h = Math.min(gy + ih, maxY) - y0;
  if (w <= 0 || h <= 0) return;
  tgt.fillRect(x0, y0, w, h, pal.bg);
  if (x0 === gx && y0 === gy && w === iw && h === ih) {
    tgt.drawRgba(gx, gy, iw, ih, img);
    return;
  }
  const out = new Uint8ClampedArray(w * h * 4);
  for (let r = 0; r < h; r++) {
    const s = ((y0 - gy + r) * iw + (x0 - gx)) * 4;
    out.set(img.subarray(s, s + w * 4), r * w * 4);
  }
  tgt.drawRgba(x0, y0, w, h, out);
}

/** Play the next frame (firmware: gif.playFrame). Returns its delay in ms, or -1 at the end. */
function playFrame(tgt: Sprite, peek: boolean, gx: number, gy: number): number {
  if (!cur) return -1;
  const f = frameAt(cur, curIdx);
  if (!f) return -1;
  curIdx++;
  blit(tgt, cur, f, peek, gx, gy);
  return f.delay;
}

function gifClose(): void {
  cur = null;
  curIdx = 0;
  gifOpen = false;
}

// --- Public -------------------------------------------------------------

/** Load a pack (or null to clear). Resolves true if a character is loaded. */
export async function characterInit(pack: CharacterPack | null): Promise<boolean> {
  characterClose();
  decoded.clear();
  files = {};
  gifPaths = [];
  textStates.length = 0;
  stateStart.fill(0);
  stateCount.fill(0);
  stateRot.fill(0);
  textFrame = 0;
  textNext = 0;
  animPauseUntil = 0;
  if (!pack) return false;

  const doc = pack.manifest as unknown;
  if (typeof doc !== "object" || doc === null || Array.isArray(doc)) {
    console.warn("[char] manifest parse: not an object");
    return false;
  }
  const m = doc as Record<string, unknown>;

  const colors = (typeof m.colors === "object" && m.colors !== null ? m.colors : {}) as Record<string, unknown>;
  pal = Object.freeze({
    body: parseHexColor(colors.body, DEFAULT_PALETTE.body),
    bg: parseHexColor(colors.bg, DEFAULT_PALETTE.bg),
    text: parseHexColor(colors.text, DEFAULT_PALETTE.text),
    textDim: parseHexColor(colors.textDim, DEFAULT_PALETTE.textDim),
    ink: parseHexColor(colors.ink, DEFAULT_PALETTE.ink),
  });

  textMode = m.mode === "text";

  const states = (typeof m.states === "object" && m.states !== null ? m.states : {}) as Record<string, unknown>;

  if (textMode) {
    for (let i = 0; i < N_STATES; i++) {
      const ts: TextState = { frames: [], delayMs: 200 };
      textStates.push(ts);
      const st = states[STATE_NAMES[i]];
      if (typeof st !== "object" || st === null) continue;
      const s = st as Record<string, unknown>;
      if (typeof s.delay === "number") ts.delayMs = s.delay & 0xffff;
      if (Array.isArray(s.frames)) {
        for (const v of s.frames) {
          if (ts.frames.length >= 8) break;
          ts.frames.push(typeof v === "string" ? v.slice(0, 19) : "");
        }
      }
    }
    loaded = true;
    return true;
  }

  files = pack.files ?? {};
  for (let i = 0; i < N_STATES; i++) {
    stateStart[i] = gifPaths.length;
    stateCount[i] = 0;
    stateRot[i] = 0;
    const v = states[STATE_NAMES[i]];
    const list = Array.isArray(v) ? v : [v];
    for (const e of list) {
      if (gifPaths.length >= MAX_GIFS) break;
      if (typeof e === "string" && e) {
        gifPaths.push(e);
        stateCount[i]++;
      }
    }
  }

  // A pack none of whose listed GIFs are present can never draw anything.
  if (!gifPaths.some((p) => findFile(p) !== undefined)) {
    console.warn("[char] no gif files found for any state");
    pal = DEFAULT_PALETTE;
    return false;
  }

  loaded = true;
  return true;
}

export function characterLoaded(): boolean {
  return loaded;
}

// One-shot half-scale render to an arbitrary surface (the landscape clock
// sprite). Caller owns clearing. Advances frame timing so
// animation runs even when characterTick() is bypassed.
export function characterRenderTo(tgt: Sprite, cx: number, cy: number): void {
  if (!gifOpen) return; // caller opens via characterSetState(activeState)
  const px = Math.trunc(gifW / 4);
  const py = Math.trunc(gifH / 4);
  const now = millis();
  if (now >= nextFrameAt) {
    let delayMs = playFrame(tgt, true, cx - px, cy - py);
    if (delayMs < 0) {
      curIdx = 0; // gif.reset()
      delayMs = playFrame(tgt, true, cx - px, cy - py);
    }
    nextFrameAt = now + (delayMs > 0 ? delayMs : 100);
  }
}

export function characterSetPeek(peek: boolean): void {
  if (peekMode === peek) return;
  peekMode = peek;
  characterInvalidate();
}

export function characterClose(): void {
  if (gifOpen) gifClose();
  cur = null;
  decoded.clear();
  files = {};
  loaded = false;
  textMode = false;
  curState = 0xff;
  pal = DEFAULT_PALETTE;
}

export function characterInvalidate(): void {
  if (!loaded) return;
  if (textMode) {
    spr.fillSprite(pal.bg);
    const s = curState;
    curState = 0xff;
    characterSetState(s);
    return;
  }
  if (gifOpen) gifClose();
  animPauseUntil = 0;
  const s = curState;
  curState = 0xff;
  characterSetState(s);
}

/** 0..6: sleep, idle, busy, attention, celebrate, dizzy, heart. No-op if same state. */
export function characterSetState(s: number): void {
  if (!loaded || !(s >= 0 && s < N_STATES) || s === curState) return;

  if (textMode) {
    curState = s;
    textFrame = 0;
    textNext = 0;
    spr.fillSprite(pal.bg);
    return;
  }

  if (gifOpen) gifClose();
  animPauseUntil = 0;
  curState = s;

  if (stateCount[s] === 0) {
    console.warn(`[char] no gif for state ${s}`);
    return;
  }

  const name = gifPaths[stateStart[s] + stateRot[s]];
  let g = decoded.get(name) ?? null;
  if (!g) {
    try {
      g = parseGifFile(name);
    } catch {
      g = null;
    }
  }
  if (g) {
    decoded.delete(name); // move to the most-recent end
    decoded.set(name, g);
    trimCache(g);
    cur = g;
    curIdx = 0;
    gifOpen = true;
    gifW = g.w;
    gifH = g.h;
    gifPlace();
    spr.fillSprite(pal.bg); // bias upward, leave room for HUD
    nextFrameAt = 0;
    variantStartedMs = millis();
  } else {
    console.warn(`[char] open failed: ${name}`);
    // A broken variant must not wedge a rotation: skip to the next one.
    if (stateCount[s] > 1) {
      stateRot[s] = (stateRot[s] + 1) % stateCount[s];
      animPauseUntil = millis() + ANIM_PAUSE_MS;
    }
  }
}

/** Advance timing; draw the next frame into spr when due. Call every loop iteration. */
export function characterTick(): void {
  if (!loaded) return;

  if (textMode) {
    if (curState >= N_STATES) return;
    const ts = textStates[curState];
    if (ts.frames.length === 0) return;
    const now = millis();
    if (now < textNext) return;
    textNext = now + ts.delayMs;

    // Clear a band around the text, not the whole sprite — keeps overlays
    // like the approval panel and the HUD untouched.
    const cy = peekMode ? 35 : 60;
    spr.fillRect(0, cy - 14, spr.width(), 28, pal.bg);

    const line = ts.frames[textFrame];
    const tw = line.length * 12; // size-2 glyph width
    spr.setTextColor(pal.body, pal.bg);
    spr.setTextSize(2);
    spr.setCursor(Math.trunc((spr.width() - tw) / 2), cy - 8);
    spr.print(line);

    textFrame = (textFrame + 1) % ts.frames.length;
    return;
  }

  const now = millis();

  if (!gifOpen) {
    // Between animations in a rotation: hold the last frame, then open
    // the next gif when the pause elapses.
    if (animPauseUntil && now >= animPauseUntil) {
      animPauseUntil = 0;
      const s = curState;
      curState = 0xff;
      characterSetState(s);
    }
    return;
  }
  if (now < nextFrameAt) return;

  const delayMs = playFrame(spr, peekMode, gifX, gifY);
  if (delayMs < 0) {
    // End of animation. Single-gif states freeze on the last frame instead
    // of reopening (the sprite already holds the last frame; just stop
    // ticking). Multi-gif states (idle rotation) still advance after a
    // brief pause.
    if (stateCount[curState] === 1) {
      gifClose();
      return;
    }
    // Multi-variant: loop the same GIF until the dwell window elapses, then
    // rotate. Short bufo idles (~0.5s/loop) get ~10 plays instead of one
    // flash + 3s freeze.
    if (now - variantStartedMs < VARIANT_DWELL_MS) {
      curIdx = 0; // gif.reset()
      nextFrameAt = now;
      return;
    }
    gifClose();
    stateRot[curState] = (stateRot[curState] + 1) % stateCount[curState];
    animPauseUntil = now + ANIM_PAUSE_MS;
    return;
  }
  nextFrameAt = now + (delayMs > 0 ? delayMs : 100);
}

/** Pack colors if loaded, else the default ASCII palette. */
export function characterPalette(): Palette {
  return pal;
}
