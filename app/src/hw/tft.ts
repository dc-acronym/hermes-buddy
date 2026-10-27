// Canvas-backed stand-in for the TFT_eSPI / TFT_eSprite API the firmware draws with.
// OWNER: tft agent. The exported names and signatures below are a frozen contract;
// other modules are written against them.
//
// Model: a sprite is an RGB565 framebuffer (Uint16Array, w*h). All drawing writes
// into it. Display.push() converts to RGBA and blits to the visible <canvas>.
//
// Ported from the TFT_eSPI fork bundled in the M5StickC-Plus library
// (src/utility/In_eSPI.cpp + Sprite.cpp), which is what the firmware is built against,
// not from upstream TFT_eSPI. Differences that matter are called out inline.

import { GLCD_CELL_H, GLCD_CELL_W, glyphColumn } from "./glcdfont";

export const TL_DATUM = 0;
export const TC_DATUM = 1;
export const TR_DATUM = 2;
export const ML_DATUM = 3;
export const MC_DATUM = 4;
export const MR_DATUM = 5;
export const BL_DATUM = 6;
export const BC_DATUM = 7;
export const BR_DATUM = 8;

// Common TFT_eSPI color constants (RGB565).
export const TFT_BLACK = 0x0000;
export const TFT_WHITE = 0xffff;
export const TFT_RED = 0xf800;
export const TFT_GREEN = 0x07e0;
export const TFT_BLUE = 0x001f;
export const TFT_YELLOW = 0xffe0;
export const TFT_CYAN = 0x07ff;
export const TFT_MAGENTA = 0xf81f;
export const TFT_ORANGE = 0xfda0;
export const TFT_DARKGREY = 0x7bef;

/** The M5StickC Plus panel (ST7789) in portrait: 135 wide, 240 tall. */
export const DISPLAY_W = 135;
export const DISPLAY_H = 240;

export function color565(r: number, g: number, b: number): number {
  return ((r & 0xf8) << 8) | ((g & 0xfc) << 3) | ((b & 0xff) >> 3);
}

/** RGB565 -> [r, g, b] 0..255 (bit-replicated, like a real panel). */
export function rgb565ToRgb(c: number): [number, number, number] {
  const r5 = (c >> 11) & 0x1f;
  const g6 = (c >> 5) & 0x3f;
  const b5 = c & 0x1f;
  return [(r5 << 3) | (r5 >> 2), (g6 << 2) | (g6 >> 4), (b5 << 3) | (b5 >> 2)];
}

/** RGB565 -> "#rrggbb". */
export function rgb565ToCss(c: number): string {
  const [r, g, b] = rgb565ToRgb(c);
  return "#" + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
}

/** "#rrggbb" (or "#rgb", leading # optional) -> RGB565. Unparseable input gives black. */
export function cssToRgb565(css: string): number {
  let h = css.trim().replace(/^#/, "");
  if (/^[0-9a-f]{3}$/i.test(h)) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  if (!/^[0-9a-f]{6}$/i.test(h)) return 0;
  const n = parseInt(h, 16);
  return color565((n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff);
}

// ─────────────────────────── text decoding helpers ───────────────────────────
//
// The firmware hands TFT_eSPI UTF-8 bytes; its write()/drawString() decode them (the
// decoder has no 21-bit support). JS strings are already decoded, so we only need to
// reproduce what comes out of that decoder as a list of "glyph codes".

/** UTF-8 byte length of a string (what the firmware's strlen()/textWidth() sees). */
function utf8Length(s: string): number {
  let n = 0;
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    n += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
  }
  return n;
}

/**
 * Glyph codes TFT_eSPI would draw for `s`. A code point above 0xFFFF can't be decoded
 * (21-bit unsupported), so its four UTF-8 bytes each fall through as an extended-ASCII
 * glyph. `buffered` selects the string decoder used by drawString(); it has a quirk for
 * 3-byte sequences (the intermediate lives in a uint8_t), leaving only the low 8 bits of
 * the code point. print()/write() decode byte by byte and keep the full code point.
 */
function glyphCodes(s: string, buffered: boolean): number[] {
  const out: number[] = [];
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (cp < 0x10000) {
      out.push(buffered && cp >= 0x800 ? cp & 0xff : cp);
    } else {
      out.push(
        0xf0 | (cp >> 18),
        0x80 | ((cp >> 12) & 0x3f),
        0x80 | ((cp >> 6) & 0x3f),
        0x80 | (cp & 0x3f),
      );
    }
  }
  return out;
}

// ─────────────────────────────── printf ───────────────────────────────

/** Exact "%.<prec>f" for finite x >= 0, rounding ties to even like C's printf. */
function toFixedC(x: number, prec: number): string {
  if (x >= 1e21) return BigInt(x).toString() + (prec > 0 ? "." + "0".repeat(prec) : "");
  prec = Math.min(prec, 100); // Number.prototype.toFixed limit
  const s = x.toFixed(prec);
  // toFixed breaks exact ties upward (away from zero); C breaks them to even. A tie
  // needs x*10^prec to end in exactly .5, so a few extra exact digits show it.
  const extra = Math.min(100, prec + 30) - prec;
  if (extra >= 2) {
    const ext = x.toFixed(prec + extra);
    const tail = ext.slice(ext.length - extra);
    if (tail[0] === "5" && /^0*$/.test(tail.slice(1))) {
      const kept = ext.slice(0, ext.length - extra).replace(/\.$/, "");
      if ((kept.charCodeAt(kept.length - 1) - 48) % 2 === 0) return kept;
    }
  }
  return s;
}

/**
 * C-style sprintf subset: %d %i %u %x %X %o %c %s %f %% with flags (- 0 space + #),
 * width, .precision, '*' for either, and h/hh/l/ll/z length modifiers (long is 32-bit
 * like on the ESP32; ll is 64-bit). Missing arguments read as 0 / "". %e %g are not
 * supported and are left in the output as written.
 */
export function sprintf(fmt: string, ...args: (string | number)[]): string {
  let ai = 0;
  const next = (): string | number | undefined => args[ai++];
  const num = (v: string | number | undefined): number => {
    const n = typeof v === "number" ? v : v === undefined ? 0 : parseFloat(v);
    return Number.isNaN(n) ? 0 : n;
  };
  // truncated integer argument; non-finite values read as 0 (BigInt() would throw)
  const int = (v: string | number | undefined): number => {
    const n = Math.trunc(num(v));
    return Number.isFinite(n) ? n : 0;
  };
  const re = /%([-+ 0#]*)(\*|\d+)?(?:\.(\*|\d*))?(hh|h|ll|l|z|j|t)?([diuxXofFcs%])/g;
  return fmt.replace(re, (_m, flags: string, wStr: string | undefined, pStr: string | undefined, len: string | undefined, conv: string) => {
    if (conv === "%") return "%";
    let left = flags.includes("-");
    const zero = flags.includes("0");
    const plus = flags.includes("+");
    const space = flags.includes(" ");
    const alt = flags.includes("#");

    let width = 0;
    if (wStr === "*") {
      width = int(next());
      if (width < 0) { left = true; width = -width; }
    } else if (wStr !== undefined) width = parseInt(wStr, 10);

    let prec: number | undefined;
    if (pStr === "*") {
      const p = int(next());
      prec = p < 0 ? undefined : p;
    } else if (pStr !== undefined) prec = pStr === "" ? 0 : parseInt(pStr, 10);

    // Pad `body` (sign/prefix already split off) out to `width`.
    const pad = (sign: string, body: string, zeroOk: boolean): string => {
      const total = sign.length + body.length;
      if (total >= width) return sign + body;
      if (left) return sign + body + " ".repeat(width - total);
      if (zero && zeroOk) return sign + "0".repeat(width - total) + body;
      return " ".repeat(width - total) + sign + body;
    };

    switch (conv) {
      case "d":
      case "i": {
        const arg = int(next());
        let neg: boolean;
        let digits: string;
        if (len === "ll" || len === "j") {
          const v = BigInt.asIntN(64, BigInt(arg));
          neg = v < 0n;
          digits = (neg ? -v : v).toString();
        } else {
          let v = arg | 0;
          if (len === "h") v = (v << 16) >> 16;
          else if (len === "hh") v = (v << 24) >> 24;
          neg = v < 0;
          digits = Math.abs(v).toString();
        }
        if (prec !== undefined) {
          if (prec === 0 && digits === "0") digits = "";
          digits = digits.padStart(prec, "0");
        }
        const sign = neg ? "-" : plus ? "+" : space ? " " : "";
        return pad(sign, digits, prec === undefined);
      }
      case "u":
      case "x":
      case "X":
      case "o": {
        const arg = int(next());
        let digits: string;
        const radix = conv === "u" ? 10 : conv === "o" ? 8 : 16;
        let isZero: boolean;
        if (len === "ll" || len === "j") {
          const v = BigInt.asUintN(64, BigInt(arg));
          isZero = v === 0n;
          digits = v.toString(radix);
        } else {
          let v = arg >>> 0;
          if (len === "h") v &= 0xffff;
          else if (len === "hh") v &= 0xff;
          isZero = v === 0;
          digits = v.toString(radix);
        }
        if (conv === "X") digits = digits.toUpperCase();
        if (prec !== undefined) {
          if (prec === 0 && isZero) digits = "";
          digits = digits.padStart(prec, "0");
        }
        let prefix = "";
        if (alt && !isZero) {
          if (conv === "x") prefix = "0x";
          else if (conv === "X") prefix = "0X";
          else if (conv === "o" && digits[0] !== "0") digits = "0" + digits;
        }
        return pad(prefix, digits, prec === undefined);
      }
      case "f":
      case "F": {
        const v = num(next());
        const neg = v < 0 || Object.is(v, -0);
        const sign = neg ? "-" : plus ? "+" : space ? " " : "";
        if (!Number.isFinite(v)) {
          const word = Number.isNaN(v) ? "nan" : "inf";
          return pad(Number.isNaN(v) ? "" : sign, conv === "F" ? word.toUpperCase() : word, false);
        }
        let body = toFixedC(Math.abs(v), prec === undefined ? 6 : prec);
        if (alt && !body.includes(".")) body += ".";
        return pad(sign, body, true);
      }
      case "c": {
        const a = next();
        const ch = typeof a === "string" ? (a === "" ? "" : String.fromCodePoint(a.codePointAt(0)!)) : String.fromCharCode(int(a) & 0xff);
        return pad("", ch, false);
      }
      case "s": {
        const a = next();
        let str = a === undefined ? "(null)" : String(a);
        if (prec !== undefined) str = str.slice(0, prec);
        return pad("", str, false);
      }
    }
    return _m;
  });
}

// ───────────────────────────────── Sprite ─────────────────────────────────

/**
 * TFT_eSprite-alike. Text uses the classic GLCD 5x7 font in a 6x8 cell, scaled by
 * setTextSize(). Defaults are the ones TFT_eSPI's constructor sets: textcolor white,
 * textbgcolor BLACK (so the cell background is painted until you call the one-argument
 * setTextColor(fg), which makes bg == fg and the background transparent), size 1,
 * datum TL, wrapX ON / wrapY OFF, cursor (0,0).
 *
 * Every drawing call truncates its coordinates to integers (C int32_t parameters) and
 * clips to the sprite and to the clip rect, if one is set.
 */
export class Sprite {
  readonly pixels: Uint16Array;

  // clip rect, half-open [x0,x1) x [y0,y1); always inside the sprite
  private clipX0 = 0;
  private clipY0 = 0;
  private clipX1: number;
  private clipY1: number;

  // text state
  private curX = 0;
  private curY = 0;
  private textFg = 0xffff;
  private textBg = 0x0000;
  private textSize = 1;
  private textDatum = TL_DATUM;
  private wrapX = true;
  private wrapY = false;

  constructor(readonly w: number, readonly h: number) {
    this.pixels = new Uint16Array(w * h);
    this.clipX1 = w;
    this.clipY1 = h;
  }
  width(): number { return this.w; }
  height(): number { return this.h; }

  // ── primitives ──

  drawPixel(x: number, y: number, c: number): void {
    x |= 0; y |= 0;
    if (x < this.clipX0 || x >= this.clipX1 || y < this.clipY0 || y >= this.clipY1) return;
    this.pixels[y * this.w + x] = c;
  }

  /** Color at (x,y); 0 outside the sprite (TFT_eSprite::readPixel). Ignores the clip rect. */
  readPixel(x: number, y: number): number {
    x |= 0; y |= 0;
    if (x < 0 || x >= this.w || y < 0 || y >= this.h) return 0;
    return this.pixels[y * this.w + x];
  }

  fillSprite(c: number): void { this.fillRect(0, 0, this.w, this.h, c); }
  fillScreen(c: number): void { this.fillRect(0, 0, this.w, this.h, c); }

  fillRect(x: number, y: number, w: number, h: number, c: number): void {
    x |= 0; y |= 0; w |= 0; h |= 0;
    let x0 = x, y0 = y, x1 = x + w, y1 = y + h;
    if (x0 < this.clipX0) x0 = this.clipX0;
    if (y0 < this.clipY0) y0 = this.clipY0;
    if (x1 > this.clipX1) x1 = this.clipX1;
    if (y1 > this.clipY1) y1 = this.clipY1;
    if (x1 <= x0 || y1 <= y0) return;
    for (let yy = y0; yy < y1; yy++) {
      const row = yy * this.w;
      this.pixels.fill(c, row + x0, row + x1);
    }
  }

  drawRect(x: number, y: number, w: number, h: number, c: number): void {
    x |= 0; y |= 0; w |= 0; h |= 0;
    this.drawFastHLine(x, y, w, c);
    this.drawFastHLine(x, y + h - 1, w, c);
    // Avoid drawing corner pixels twice
    this.drawFastVLine(x, y + 1, h - 2, c);
    this.drawFastVLine(x + w - 1, y + 1, h - 2, c);
  }

  drawFastHLine(x: number, y: number, w: number, c: number): void {
    this.fillRect(x, y, w, 1, c);
  }

  drawFastVLine(x: number, y: number, h: number, c: number): void {
    this.fillRect(x, y, 1, h, c);
  }

  /** Bresenham, split into fast runs like TFT_eSprite::drawLine (same pixels as plain Bresenham). */
  drawLine(x0: number, y0: number, x1: number, y1: number, c: number): void {
    x0 |= 0; y0 |= 0; x1 |= 0; y1 |= 0;
    const steep = Math.abs(y1 - y0) > Math.abs(x1 - x0);
    if (steep) {
      [x0, y0] = [y0, x0];
      [x1, y1] = [y1, x1];
    }
    if (x0 > x1) {
      [x0, x1] = [x1, x0];
      [y0, y1] = [y1, y0];
    }
    const dx = x1 - x0;
    const dy = Math.abs(y1 - y0);
    let err = dx >> 1;
    const ystep = y0 < y1 ? 1 : -1;
    let xs = x0;
    let dlen = 0;

    // Split into steep and not steep for FastH/V separation
    if (steep) {
      for (; x0 <= x1; x0++) {
        dlen++;
        err -= dy;
        if (err < 0) {
          err += dx;
          if (dlen === 1) this.drawPixel(y0, xs, c);
          else this.drawFastVLine(y0, xs, dlen, c);
          dlen = 0;
          y0 += ystep;
          xs = x0 + 1;
        }
      }
      if (dlen) this.drawFastVLine(y0, xs, dlen, c);
    } else {
      for (; x0 <= x1; x0++) {
        dlen++;
        err -= dy;
        if (err < 0) {
          err += dx;
          if (dlen === 1) this.drawPixel(xs, y0, c);
          else this.drawFastHLine(xs, y0, dlen, c);
          dlen = 0;
          y0 += ystep;
          xs = x0 + 1;
        }
      }
      if (dlen) this.drawFastHLine(xs, y0, dlen, c);
    }
  }

  drawRoundRect(x: number, y: number, w: number, h: number, r: number, c: number): void {
    x |= 0; y |= 0; w |= 0; h |= 0; r |= 0;
    this.drawFastHLine(x + r, y, w - r - r, c); // Top
    this.drawFastHLine(x + r, y + h - 1, w - r - r, c); // Bottom
    this.drawFastVLine(x, y + r, h - r - r, c); // Left
    this.drawFastVLine(x + w - 1, y + r, h - r - r, c); // Right
    // draw four corners
    this.drawCircleHelper(x + r, y + r, r, 1, c);
    this.drawCircleHelper(x + w - r - 1, y + r, r, 2, c);
    this.drawCircleHelper(x + w - r - 1, y + h - r - 1, r, 4, c);
    this.drawCircleHelper(x + r, y + h - r - 1, r, 8, c);
  }

  fillRoundRect(x: number, y: number, w: number, h: number, r: number, c: number): void {
    x |= 0; y |= 0; w |= 0; h |= 0; r |= 0;
    this.fillRect(x, y + r, w, h - r - r, c);
    // draw four corners
    this.fillCircleHelper(x + r, y + h - r - 1, r, 1, w - r - r - 1, c);
    this.fillCircleHelper(x + r, y + r, r, 2, w - r - r - 1, c);
  }

  /** Optimised midpoint circle algorithm (TFT_eSPI). */
  drawCircle(x0: number, y0: number, r: number, c: number): void {
    x0 |= 0; y0 |= 0; r |= 0;
    let x = 0;
    let dx = 1;
    let dy = r + r;
    let p = -(r >> 1);

    this.drawPixel(x0 + r, y0, c);
    this.drawPixel(x0 - r, y0, c);
    this.drawPixel(x0, y0 - r, c);
    this.drawPixel(x0, y0 + r, c);

    while (x < r) {
      if (p >= 0) {
        dy -= 2;
        p -= dy;
        r--;
      }
      dx += 2;
      p += dx;
      x++;

      this.drawPixel(x0 + x, y0 + r, c);
      this.drawPixel(x0 - x, y0 + r, c);
      this.drawPixel(x0 - x, y0 - r, c);
      this.drawPixel(x0 + x, y0 - r, c);

      this.drawPixel(x0 + r, y0 + x, c);
      this.drawPixel(x0 - r, y0 + x, c);
      this.drawPixel(x0 - r, y0 - x, c);
      this.drawPixel(x0 + r, y0 - x, c);
    }
  }

  /** Quarter-circle arcs for rounded rects; cornername bits: 1 top-left, 2 top-right, 4 bottom-right, 8 bottom-left. */
  drawCircleHelper(x0: number, y0: number, r: number, cornername: number, c: number): void {
    x0 |= 0; y0 |= 0; r |= 0;
    let f = 1 - r;
    let ddFx = 1;
    let ddFy = -2 * r;
    let x = 0;

    while (x < r) {
      if (f >= 0) {
        r--;
        ddFy += 2;
        f += ddFy;
      }
      x++;
      ddFx += 2;
      f += ddFx;
      if (cornername & 0x4) {
        this.drawPixel(x0 + x, y0 + r, c);
        this.drawPixel(x0 + r, y0 + x, c);
      }
      if (cornername & 0x2) {
        this.drawPixel(x0 + x, y0 - r, c);
        this.drawPixel(x0 + r, y0 - x, c);
      }
      if (cornername & 0x8) {
        this.drawPixel(x0 - r, y0 + x, c);
        this.drawPixel(x0 - x, y0 + r, c);
      }
      if (cornername & 0x1) {
        this.drawPixel(x0 - r, y0 - x, c);
        this.drawPixel(x0 - x, y0 - r, c);
      }
    }
  }

  /** Midpoint circle changed to horizontal lines (TFT_eSPI). */
  fillCircle(x0: number, y0: number, r: number, c: number): void {
    x0 |= 0; y0 |= 0; r |= 0;
    let x = 0;
    let dx = 1;
    let dy = r + r;
    let p = -(r >> 1);

    this.drawFastHLine(x0 - r, y0, dy + 1, c);

    while (x < r) {
      if (p >= 0) {
        dy -= 2;
        p -= dy;
        r--;
      }
      dx += 2;
      p += dx;
      x++;

      this.drawFastHLine(x0 - r, y0 + x, 2 * r + 1, c);
      this.drawFastHLine(x0 - r, y0 - x, 2 * r + 1, c);
      this.drawFastHLine(x0 - x, y0 + r, 2 * x + 1, c);
      this.drawFastHLine(x0 - x, y0 - r, 2 * x + 1, c);
    }
  }

  /** Filled half-discs for fillRoundRect; cornername bit 1 = lower half, 2 = upper half; delta widens the span. */
  fillCircleHelper(x0: number, y0: number, r: number, cornername: number, delta: number, c: number): void {
    x0 |= 0; y0 |= 0; r |= 0; delta |= 0;
    let f = 1 - r;
    let ddFx = 1;
    let ddFy = -r - r;
    let y = 0;

    delta++;
    while (y < r) {
      if (f >= 0) {
        r--;
        ddFy += 2;
        f += ddFy;
      }
      y++;
      ddFx += 2;
      f += ddFx;

      if (cornername & 0x1) {
        this.drawFastHLine(x0 - r, y0 + y, r + r + delta, c);
        this.drawFastHLine(x0 - y, y0 + r, y + y + delta, c);
      }
      if (cornername & 0x2) {
        this.drawFastHLine(x0 - r, y0 - y, r + r + delta, c);
        this.drawFastHLine(x0 - y, y0 - r, y + y + delta, c);
      }
    }
  }

  drawTriangle(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, c: number): void {
    this.drawLine(x0, y0, x1, y1, c);
    this.drawLine(x1, y1, x2, y2, c);
    this.drawLine(x2, y2, x0, y0, c);
  }

  /** The original Adafruit scanline fill, as in TFT_eSPI (integer division truncates toward zero). */
  fillTriangle(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, c: number): void {
    x0 |= 0; y0 |= 0; x1 |= 0; y1 |= 0; x2 |= 0; y2 |= 0;
    let a: number, b: number, y: number, last: number;

    // Sort coordinates by Y order (y2 >= y1 >= y0)
    if (y0 > y1) { [y0, y1] = [y1, y0]; [x0, x1] = [x1, x0]; }
    if (y1 > y2) { [y2, y1] = [y1, y2]; [x2, x1] = [x1, x2]; }
    if (y0 > y1) { [y0, y1] = [y1, y0]; [x0, x1] = [x1, x0]; }

    if (y0 === y2) { // Handle awkward all-on-same-line case as its own thing
      a = b = x0;
      if (x1 < a) a = x1;
      else if (x1 > b) b = x1;
      if (x2 < a) a = x2;
      else if (x2 > b) b = x2;
      this.drawFastHLine(a, y0, b - a + 1, c);
      return;
    }

    const dx01 = x1 - x0, dy01 = y1 - y0, dx02 = x2 - x0, dy02 = y2 - y0,
      dx12 = x2 - x1, dy12 = y2 - y1;
    let sa = 0, sb = 0;

    // For upper part of triangle, find scanline crossings for segments 0-1 and 0-2.
    // If y1=y2 (flat-bottomed triangle), the scanline y1 is included here (and the
    // second loop is skipped, avoiding a /0 error there), otherwise scanline y1 is
    // skipped here and handled in the second loop...which also avoids a /0 error
    // here if y0=y1 (flat-topped triangle).
    if (y1 === y2) last = y1; // Include y1 scanline
    else last = y1 - 1; // Skip it

    for (y = y0; y <= last; y++) {
      a = x0 + Math.trunc(sa / dy01);
      b = x0 + Math.trunc(sb / dy02);
      sa += dx01;
      sb += dx02;
      if (a > b) [a, b] = [b, a];
      this.drawFastHLine(a, y, b - a + 1, c);
    }

    // For lower part of triangle, find scanline crossings for segments 0-2 and 1-2.
    // This loop is skipped if y1=y2.
    sa = dx12 * (y - y1);
    sb = dx02 * (y - y0);
    for (; y <= y2; y++) {
      a = x1 + Math.trunc(sa / dy12);
      b = x0 + Math.trunc(sb / dy02);
      sa += dx12;
      sb += dx02;
      if (a > b) [a, b] = [b, a];
      this.drawFastHLine(a, y, b - a + 1, c);
    }
  }

  /**
   * Copy an RGBA image (e.g. a decoded GIF frame) into the sprite; pixels with alpha < 128 are skipped.
   * Nearest-neighbour: each source pixel becomes a scale x scale block. (x,y) is the top-left corner.
   */
  drawRgba(x: number, y: number, w: number, h: number, rgba: Uint8ClampedArray, scale = 1): void {
    x |= 0; y |= 0; w |= 0; h |= 0;
    scale = Math.max(1, scale | 0);
    for (let sy = 0; sy < h; sy++) {
      const dy0 = y + sy * scale;
      if (dy0 >= this.clipY1 || dy0 + scale <= this.clipY0) continue;
      for (let sx = 0; sx < w; sx++) {
        const i = (sy * w + sx) * 4;
        if (rgba[i + 3] < 128) continue;
        const c = color565(rgba[i], rgba[i + 1], rgba[i + 2]);
        if (scale === 1) this.drawPixel(x + sx, dy0, c);
        else this.fillRect(x + sx * scale, dy0, scale, scale, c);
      }
    }
  }

  /** Restrict all further drawing to this rectangle (intersected with the sprite). */
  setClipRect(x: number, y: number, w: number, h: number): void {
    x |= 0; y |= 0; w |= 0; h |= 0;
    this.clipX0 = Math.max(0, x);
    this.clipY0 = Math.max(0, y);
    this.clipX1 = Math.min(this.w, x + w);
    this.clipY1 = Math.min(this.h, y + h);
    if (this.clipX1 < this.clipX0) this.clipX1 = this.clipX0;
    if (this.clipY1 < this.clipY0) this.clipY1 = this.clipY0;
  }
  clearClipRect(): void {
    this.clipX0 = 0;
    this.clipY0 = 0;
    this.clipX1 = this.w;
    this.clipY1 = this.h;
  }

  // ── text ──

  /** setTextColor(fg) makes the background transparent (bg = fg); setTextColor(fg, bg) fills the cell with bg. */
  setTextColor(fg: number, bg?: number): void {
    this.textFg = fg;
    this.textBg = bg === undefined ? fg : bg;
  }
  /** Size multiplier, clamped to 1..7 like TFT_eSPI (0 becomes 1). */
  setTextSize(s: number): void {
    s = s & 0xff; // uint8_t
    if (s > 7) s = 7;
    this.textSize = s > 0 ? s : 1;
  }
  setTextDatum(d: number): void { this.textDatum = d; }
  setTextWrap(wrapX: boolean, wrapY = false): void {
    this.wrapX = wrapX;
    this.wrapY = wrapY;
  }
  setCursor(x: number, y: number): void {
    this.curX = x | 0;
    this.curY = y | 0;
  }
  getCursorX(): number { return this.curX; }
  getCursorY(): number { return this.curY; }

  /**
   * Draw one 6x8 font-1 cell at (x,y) (TFT_eSprite::drawChar). When bg != color the whole
   * cell (x size) is painted, otherwise only the lit pixels. Codes below 32 draw nothing.
   */
  drawChar(x: number, y: number, code: number, color: number, bg: number, size: number): void {
    x |= 0; y |= 0; size |= 0;
    if (x >= this.w || y >= this.h || x + GLCD_CELL_W * size - 1 < 0 || y + GLCD_CELL_H * size - 1 < 0) return;
    if (code < 32) return;
    const fillbg = bg !== color;
    for (let i = 0; i < GLCD_CELL_W; i++) {
      let line = i === 5 ? 0 : glyphColumn(code, i); // 6th column is always blank spacing
      for (let j = 0; j < GLCD_CELL_H; j++) {
        if (line & 1) {
          if (size === 1) this.drawPixel(x + i, y + j, color);
          else this.fillRect(x + i * size, y + j * size, size, size, color);
        } else if (fillbg) {
          if (size === 1) this.drawPixel(x + i, y + j, bg);
          else this.fillRect(x + i * size, y + j * size, size, size, bg);
        }
        line >>= 1;
      }
    }
  }

  /** TFT_eSprite::drawChar(uniCode,...): draws one glyph, returns the advance (0 for code 0). */
  private drawGlyph(code: number, x: number, y: number): number {
    if (!code) return 0;
    this.drawChar(x, y, code, this.textFg, this.textBg, this.textSize);
    return GLCD_CELL_W * this.textSize;
  }

  /** TFT_eSprite::write() for one decoded character: '\n' and wrapping, '\r' and control codes ignored. */
  private writeCode(code: number): void {
    if (code === 0 || code === 13) return;
    const height = GLCD_CELL_H * this.textSize;
    if (code === 10) {
      this.curY += height;
      this.curX = 0; // newline returns to column 0, not to where the print started
      return;
    }
    if (code < 32) return;
    if (this.wrapX && this.curX + GLCD_CELL_W * this.textSize > this.w) {
      this.curY += height;
      this.curX = 0;
    }
    if (this.wrapY && this.curY >= this.h) this.curY = 0;
    this.curX += this.drawGlyph(code, this.curX, this.curY);
  }

  /** Prints at the cursor (datum ignored, like TFT_eSPI print). Handles \n. */
  print(v: string | number): void {
    // Arduino Print: integers as decimal, floats with 2 decimals
    const s = typeof v === "number" ? (Number.isInteger(v) ? String(v) : v.toFixed(2)) : v;
    for (const code of glyphCodes(s, false)) this.writeCode(code);
  }
  println(v?: string | number): void {
    if (v !== undefined) this.print(v);
    this.print("\r\n");
  }
  /** C-style printf: %d %i %u %ld %lu %s %c %x %X %f with flags/width/precision (e.g. %02d %5.1f %-8s %%). */
  printf(fmt: string, ...args: (string | number)[]): void {
    this.print(sprintf(fmt, ...args));
  }

  /**
   * Draws at (x,y) honoring the datum; returns width in px. Does not move the cursor.
   * Mirrors TFT_eSPI::drawString: the string is measured first (UTF-8 bytes, see
   * textWidth), the datum shifts the origin, and for any non-TL datum the origin is then
   * clamped so the measured box stays inside the sprite.
   */
  drawString(s: string, x: number, y: number): number {
    x |= 0; y |= 0;
    const nul = s.indexOf("\0"); // C string ends at NUL
    if (nul >= 0) s = s.slice(0, nul);
    const cwidth = this.textWidth(s);
    const cheight = GLCD_CELL_H * this.textSize;
    let poX = x;
    let poY = y;

    if (this.textDatum) {
      switch (this.textDatum) {
        case TC_DATUM: poX -= cwidth >> 1; break;
        case TR_DATUM: poX -= cwidth; break;
        case ML_DATUM: poY -= cheight >> 1; break;
        case MC_DATUM: poX -= cwidth >> 1; poY -= cheight >> 1; break;
        case MR_DATUM: poX -= cwidth; poY -= cheight >> 1; break;
        case BL_DATUM: poY -= cheight; break;
        case BC_DATUM: poX -= cwidth >> 1; poY -= cheight; break;
        case BR_DATUM: poX -= cwidth; poY -= cheight; break;
      }
      // Check coordinates are OK, adjust if not
      if (poX < 0) poX = 0;
      if (poX + cwidth > this.w) poX = this.w - cwidth;
      if (poY < 0) poY = 0;
      if (poY + cheight > this.h) poY = this.h - cheight;
    }

    let sumX = 0;
    for (const code of glyphCodes(s, true)) sumX += this.drawGlyph(code, poX + sumX, poY);
    return sumX;
  }

  /**
   * Font 1 width: 6 * textSize per UTF-8 *byte* (TFT_eSPI's `while (*string++) w += 6`),
   * so a multi-byte character such as U+00B4 counts twice here although it draws as one
   * cell. For ASCII this is simply 6 * size * length.
   */
  textWidth(s: string): number {
    const nul = s.indexOf("\0");
    if (nul >= 0) s = s.slice(0, nul);
    return utf8Length(s) * GLCD_CELL_W * this.textSize;
  }
  fontHeight(): number { return GLCD_CELL_H * this.textSize; }
}

// ───────────────────────────────── Display ─────────────────────────────────

let rgbaLut: Uint32Array | null = null;
/** RGB565 -> packed RGBA word whose bytes in memory are r,g,b,0xff (so it can be stored through a Uint32Array view). */
function getRgbaLut(): Uint32Array {
  if (rgbaLut) return rgbaLut;
  const little = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;
  const lut = new Uint32Array(65536);
  for (let c = 0; c < 65536; c++) {
    const [r, g, b] = rgb565ToRgb(c);
    lut[c] = little
      ? ((0xff << 24) | (b << 16) | (g << 8) | r) >>> 0
      : ((r << 24) | (g << 16) | (b << 8) | 0xff) >>> 0;
  }
  return (rgbaLut = lut);
}

/**
 * Convert a w*h RGB565 buffer into RGBA words, turned `rotation` quarter turns.
 *
 * Rotation convention (shared with Display.push and the bezel): `rotation` is how many
 * quarter turns CLOCKWISE the *device* has been physically turned from portrait. The image
 * is counter-rotated inside the device's own portrait frame so that, once the bezel
 * (canvas included) is rotated by rotation*90deg clockwise, the text reads upright:
 *   0  portrait, copied as is                   (w x h  ->  w x h)
 *   1  device turned 90 deg CW: a 240x135 landscape sprite is rotated 90 deg CCW into the
 *      135x240 frame, so sprite (sx,sy) -> frame (sy, w-1-sx); the sprite's left edge ends
 *      up at the frame's bottom, its top edge at the frame's left
 *   2  upside down: rotated 180 deg
 *   3  device turned 90 deg CCW (270 CW): the sprite is rotated 90 deg CW,
 *      sprite (sx,sy) -> frame (h-1-sy, sx); its left edge ends up at the frame's top
 * Returns the destination size; `dst` must hold at least w*h words.
 */
export function rotateToRgba(
  src: Uint16Array, w: number, h: number, rotation: number, dst: Uint32Array,
): { width: number; height: number } {
  const lut = getRgbaLut();
  const rot = ((rotation % 4) + 4) % 4;
  const dw = rot & 1 ? h : w;
  const dh = rot & 1 ? w : h;
  for (let sy = 0; sy < h; sy++) {
    const row = sy * w;
    for (let sx = 0; sx < w; sx++) {
      let di: number;
      switch (rot) {
        case 1: di = (w - 1 - sx) * dw + sy; break;
        case 2: di = (h - 1 - sy) * dw + (w - 1 - sx); break;
        case 3: di = sx * dw + (h - 1 - sy); break;
        default: di = row + sx;
      }
      dst[di] = lut[src[row + sx]];
    }
  }
  return { width: dw, height: dh };
}

/** A sprite as RGBA bytes (alpha 255), rotated per rotateToRgba(). Handy for tests and screenshots. */
export function spriteToRgba(s: Sprite, rotation = 0): { width: number; height: number; data: Uint8ClampedArray } {
  const words = new Uint32Array(s.w * s.h);
  const { width, height } = rotateToRgba(s.pixels, s.w, s.h, rotation, words);
  return { width, height, data: new Uint8ClampedArray(words.buffer) };
}

interface Frame {
  w: number;
  h: number;
  pixels: Uint16Array;
  rotation: number;
}

/** True when two RGB565 buffers hold the same pixels. A plain scan is far cheaper than convert + blit. */
function samePixels(a: Uint16Array, b: Uint16Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** The visible screen: owns the <canvas>, blits sprites at an integer scale. */
export class Display {
  /** Called when a push() uses a different rotation than the previous one (bezel turns sideways). */
  onRotationChange?: (rotation: number) => void;

  private readonly ctx: CanvasRenderingContext2D | null = null;
  private off: HTMLCanvasElement | null = null;
  private offCtx: CanvasRenderingContext2D | null = null;
  private image: ImageData | null = null;
  private words: Uint32Array | null = null;
  private powered = true;
  // The last frame pushed, kept as a private copy (sprites are edited in place) so the next
  // push can tell whether anything changed. `shown` is whether the canvas holds it right now.
  private frame: Frame | null = null;
  private shown = false;
  private lastRotation = 0;

  constructor(readonly canvas: HTMLCanvasElement, readonly scale: number) {
    canvas.width = DISPLAY_W * scale;
    canvas.height = DISPLAY_H * scale;
    try {
      this.ctx = canvas.getContext("2d");
    } catch {
      this.ctx = null; // no canvas support (jsdom): bookkeeping still works, nothing is drawn
    }
    if (this.ctx) this.ctx.imageSmoothingEnabled = false;
  }

  /**
   * Blit `s` to the canvas. rotation is in quarter turns clockwise (0 = portrait as
   * the firmware's sprite; 1 = the sprite is a 240x135 landscape image shown rotated
   * so the device reads correctly when turned). Nearest-neighbour, no smoothing.
   * See rotateToRgba() for the exact mapping of 1, 2 and 3.
   */
  push(s: Sprite, rotation = 0): void {
    const rot = (((rotation | 0) % 4) + 4) % 4;
    const f = this.frame;
    // push() runs at 60 Hz but the picture changes at ~5 fps (pet) or 1 fps (clock), so most
    // calls find the same pixels already on screen and skip the RGBA conversion and canvas calls.
    if (!(f && f.w === s.w && f.h === s.h && f.rotation === rot && samePixels(f.pixels, s.pixels))) {
      // A new frame. With the screen off the panel still keeps it in GRAM, so remember it unseen.
      this.remember(s, rot);
      this.shown = false;
    }
    if (this.powered && !this.shown) {
      this.present(this.frame!);
      this.shown = true;
    }
  }

  /** CSS brightness 0..100 (the firmware's ScreenBreath). */
  setBrightness(pct: number): void {
    const p = Math.max(0, Math.min(100, Number.isFinite(pct) ? pct : 100));
    this.canvas.style.filter = p >= 100 ? "" : `brightness(${p / 100})`;
  }

  /** Screen power: off shows black regardless of pushes. */
  setPower(on: boolean): void {
    if (on === this.powered) return;
    this.powered = on;
    this.shown = false; // black replaces the image going off; coming on, nothing is painted yet
    if (!on) {
      this.paintBlack();
    } else if (this.frame) {
      this.present(this.frame);
      this.shown = true;
    }
  }

  /** Copy `s` into the retained frame, reusing its buffer unless the sprite size changed. */
  private remember(s: Sprite, rot: number): void {
    const f = this.frame;
    if (f && f.pixels.length === s.pixels.length) {
      f.w = s.w;
      f.h = s.h;
      f.rotation = rot;
      f.pixels.set(s.pixels);
    } else {
      this.frame = { w: s.w, h: s.h, pixels: s.pixels.slice(), rotation: rot };
    }
  }

  private paintBlack(): void {
    if (!this.ctx) return;
    this.ctx.fillStyle = "#000";
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }

  private present(f: Frame): void {
    const rot = f.rotation;
    const dw = rot & 1 ? f.h : f.w;
    const dh = rot & 1 ? f.w : f.h;
    if (this.ctx && typeof document !== "undefined") {
      if (!this.off) {
        this.off = document.createElement("canvas");
        this.offCtx = this.off.getContext("2d");
      }
      const offCtx = this.offCtx;
      if (offCtx && this.off) {
        if (!this.image || this.image.width !== dw || this.image.height !== dh) {
          this.off.width = dw;
          this.off.height = dh;
          this.image = offCtx.createImageData(dw, dh);
          this.words = new Uint32Array(this.image.data.buffer);
        }
        rotateToRgba(f.pixels, f.w, f.h, rot, this.words!);
        offCtx.putImageData(this.image, 0, 0);
        this.ctx.imageSmoothingEnabled = false;
        this.ctx.drawImage(this.off, 0, 0, this.canvas.width, this.canvas.height);
      }
    }
    if (rot !== this.lastRotation) {
      this.lastRotation = rot;
      this.onRotationChange?.(rot);
    }
  }
}
