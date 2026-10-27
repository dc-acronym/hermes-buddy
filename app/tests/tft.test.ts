import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BC_DATUM,
  BR_DATUM,
  Display,
  MC_DATUM,
  Sprite,
  TC_DATUM,
  TFT_BLACK,
  TFT_BLUE,
  TFT_RED,
  TFT_WHITE,
  color565,
  cssToRgb565,
  rgb565ToCss,
  rgb565ToRgb,
  rotateToRgba,
  spriteToRgba,
  sprintf,
} from "../src/hw/tft";
import { GLCD_FONT, glyphColumn } from "../src/hw/glcdfont";

/** Pixels in [x, x+w) x [y, y+h) that differ from `bg`, as "x,y" strings. */
function lit(s: Sprite, bg = TFT_BLACK, x = 0, y = 0, w = s.w - x, h = s.h - y): Set<string> {
  const out = new Set<string>();
  for (let yy = y; yy < y + h; yy++) {
    for (let xx = x; xx < x + w; xx++) if (s.readPixel(xx, yy) !== bg) out.add(`${xx},${yy}`);
  }
  return out;
}

function bounds(pts: Set<string>): { x0: number; y0: number; x1: number; y1: number } {
  const xs = [...pts].map((p) => +p.split(",")[0]);
  const ys = [...pts].map((p) => +p.split(",")[1]);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

/** Expected lit pixels of glyph `code` placed with its cell origin at (ox, oy). */
function glyphPixels(code: number, ox: number, oy: number, size = 1): Set<string> {
  const out = new Set<string>();
  for (let col = 0; col < 5; col++) {
    for (let row = 0; row < 8; row++) {
      if (!((glyphColumn(code, col) >> row) & 1)) continue;
      for (let dy = 0; dy < size; dy++) {
        for (let dx = 0; dx < size; dx++) out.add(`${ox + col * size + dx},${oy + row * size + dy}`);
      }
    }
  }
  return out;
}

describe("glcdfont", () => {
  it("has 255 glyphs of 5 columns (the M5StickC-Plus table is one short)", () => {
    expect(GLCD_FONT.length).toBe(255 * 5);
  });
  it("glyph 'A' is the Adafruit bytes", () => {
    expect([0, 1, 2, 3, 4].map((c) => glyphColumn(0x41, c))).toEqual([0x7c, 0x12, 0x11, 0x12, 0x7c]);
  });
  it("is blank past the table", () => {
    expect(glyphColumn(255, 0)).toBe(0);
    expect(glyphColumn(0x2026, 3)).toBe(0);
  });
});

describe("text rendering", () => {
  it("defaults to white on an opaque black cell", () => {
    const s = new Sprite(12, 8);
    s.fillSprite(TFT_RED);
    s.print("A");
    expect(s.readPixel(5, 0)).toBe(TFT_BLACK); // spacing column painted with bg
    expect(s.readPixel(0, 2)).toBe(TFT_WHITE); // 'A' column 0 = 0x7C, rows 2..6
    expect(s.readPixel(0, 0)).toBe(TFT_BLACK);
    expect(s.readPixel(6, 0)).toBe(TFT_RED); // next cell untouched
  });

  it("draws glyph 'A' exactly as the font table says (size 1, transparent)", () => {
    const s = new Sprite(20, 12);
    s.setTextColor(TFT_WHITE);
    s.setCursor(3, 2);
    s.print("A");
    expect(lit(s)).toEqual(glyphPixels(0x41, 3, 2));
    // pin a few pixels by hand: column 0 = 0x7C (rows 2-6), column 1 = 0x12 (rows 1 and 4)
    expect(s.readPixel(3, 2 + 2)).toBe(TFT_WHITE);
    expect(s.readPixel(3, 2 + 1)).toBe(TFT_BLACK);
    expect(s.readPixel(4, 2 + 1)).toBe(TFT_WHITE);
    expect(s.readPixel(4, 2 + 4)).toBe(TFT_WHITE);
    expect(s.readPixel(4, 2 + 2)).toBe(TFT_BLACK);
  });

  it("scales glyphs by the text size", () => {
    for (const size of [2, 3]) {
      const s = new Sprite(40, 30);
      s.setTextColor(TFT_WHITE);
      s.setTextSize(size);
      s.setCursor(1, 1);
      s.print("A");
      expect(lit(s)).toEqual(glyphPixels(0x41, 1, 1, size));
    }
  });

  it("fills the whole 6x8 cell with bg when bg != fg, and leaves it alone when transparent", () => {
    const opaque = new Sprite(20, 20);
    opaque.fillSprite(TFT_RED);
    opaque.setTextColor(TFT_WHITE, TFT_BLUE);
    opaque.setCursor(2, 3);
    opaque.print(" "); // space has no lit pixels, so everything painted is background
    expect(lit(opaque, TFT_RED)).toEqual(new Set(
      Array.from({ length: 48 }, (_, i) => `${2 + (i % 6)},${3 + Math.floor(i / 6)}`),
    ));
    expect(opaque.readPixel(2, 3)).toBe(TFT_BLUE);
    expect(opaque.readPixel(7, 10)).toBe(TFT_BLUE);
    expect(opaque.readPixel(8, 3)).toBe(TFT_RED);

    const clear = new Sprite(20, 20);
    clear.fillSprite(TFT_RED);
    clear.setTextColor(TFT_WHITE); // one-argument form: bg == fg => transparent
    clear.setCursor(2, 3);
    clear.print(" ");
    expect(lit(clear, TFT_RED).size).toBe(0);
    clear.print("A");
    expect(lit(clear, TFT_RED)).toEqual(glyphPixels(0x41, 8, 3));
  });

  it("scales the background cell with the text size", () => {
    const s = new Sprite(30, 30);
    s.setTextColor(TFT_WHITE, TFT_BLUE);
    s.setTextSize(2);
    s.print(" ");
    expect(lit(s).size).toBe(12 * 16);
    expect(bounds(lit(s))).toEqual({ x0: 0, y0: 0, x1: 11, y1: 15 });
  });

  it("clamps text size to 1..7", () => {
    const s = new Sprite(100, 100);
    s.setTextSize(0);
    expect(s.fontHeight()).toBe(8);
    s.setTextSize(9);
    expect(s.fontHeight()).toBe(56);
  });

  it("advances the cursor by 6*size and ignores '\\r'", () => {
    const s = new Sprite(100, 40);
    s.print("ab");
    expect(s.getCursorX()).toBe(12);
    s.setTextSize(2);
    s.print("c\r");
    expect(s.getCursorX()).toBe(24);
    expect(s.getCursorY()).toBe(0);
  });

  it("'\\n' goes to column 0 of the next line, not back to where printing started", () => {
    const s = new Sprite(100, 40);
    s.setTextColor(TFT_WHITE);
    s.setCursor(20, 4);
    s.print("A\nB");
    expect(s.getCursorX()).toBe(6);
    expect(s.getCursorY()).toBe(12);
    expect(lit(s)).toEqual(new Set([...glyphPixels(0x41, 20, 4), ...glyphPixels(0x42, 0, 12)]));
    s.println("C");
    expect(s.getCursorX()).toBe(0);
    expect(s.getCursorY()).toBe(20);
  });

  it("'\\n' moves by 8*size", () => {
    const s = new Sprite(100, 100);
    s.setTextSize(3);
    s.print("\n");
    expect(s.getCursorY()).toBe(24);
  });

  it("wraps when the next char would cross the sprite width", () => {
    const s = new Sprite(30, 24); // exactly 5 cells wide
    s.setTextColor(TFT_WHITE);
    s.print("ABCDE");
    expect(s.getCursorX()).toBe(30); // the 5th cell ends exactly on the edge: no wrap yet
    expect(s.getCursorY()).toBe(0);
    s.print("F");
    expect(lit(s, TFT_BLACK, 0, 8, 6, 8)).toEqual(glyphPixels(0x46, 0, 8));
    expect(s.getCursorX()).toBe(6);
    expect(s.getCursorY()).toBe(8);
  });

  it("does not wrap with setTextWrap(false) and clips instead", () => {
    const s = new Sprite(30, 24);
    s.setTextWrap(false);
    s.setTextColor(TFT_WHITE);
    s.print("ABCDEFG");
    expect(s.getCursorX()).toBe(42);
    expect(s.getCursorY()).toBe(0);
    expect(lit(s, TFT_BLACK, 0, 8, 30, 16).size).toBe(0);
  });

  it("wrapY returns to the top when the cursor is below the sprite", () => {
    const s = new Sprite(12, 16);
    s.setTextWrap(true, true);
    s.setCursor(0, 16);
    s.print("A");
    expect(s.getCursorY()).toBe(0);
    s.setTextWrap(true, false);
    s.setCursor(0, 16);
    s.print("A");
    expect(s.getCursorY()).toBe(16);
  });

  it("draws the duck's U+00B4 as a single cell of glyph 0xB4", () => {
    const s = new Sprite(30, 10);
    s.setTextColor(TFT_WHITE);
    s.print("´");
    expect(s.getCursorX()).toBe(6);
    expect(lit(s)).toEqual(glyphPixels(0xb4, 0, 0));
    expect(lit(s).size).toBeGreaterThan(0);
  });

  it("matches the firmware's UTF-8 handling for wider code points", () => {
    const s = new Sprite(60, 10);
    s.setTextColor(TFT_WHITE, TFT_BLUE);
    s.print("…"); // above 0xFF: blank cell (the real thing reads flash garbage)
    expect(s.getCursorX()).toBe(6);
    expect(lit(s, TFT_BLUE, 0, 0, 6, 8).size).toBe(0);
    s.print("\u{1F600}"); // 21-bit code points fall back to one glyph per UTF-8 byte
    expect(s.getCursorX()).toBe(6 + 4 * 6);
    s.setCursor(0, 0);
    s.print("\u0007"); // control codes are dropped
    expect(s.getCursorX()).toBe(0);
  });

  it("print(number) formats like Arduino Print", () => {
    const s = new Sprite(100, 10);
    s.print(42);
    expect(s.getCursorX()).toBe(12);
    s.setCursor(0, 0);
    s.print(1.5); // 2 decimals: "1.50"
    expect(s.getCursorX()).toBe(24);
  });
});

describe("drawString", () => {
  const W = 120;
  const H = 60;

  it("TL datum draws at the point and returns the width without moving the cursor", () => {
    const s = new Sprite(W, H);
    s.setTextColor(TFT_WHITE);
    s.setCursor(7, 9);
    const w = s.drawString("AB", 10, 5);
    expect(w).toBe(12);
    expect(s.getCursorX()).toBe(7);
    expect(s.getCursorY()).toBe(9);
    expect(lit(s)).toEqual(new Set([...glyphPixels(0x41, 10, 5), ...glyphPixels(0x42, 16, 5)]));
  });

  it("MC datum centres the string box on the point", () => {
    const s = new Sprite(W, H);
    s.setTextColor(TFT_WHITE);
    s.setTextDatum(MC_DATUM);
    s.drawString("AB", 60, 30);
    // box is 12x8: origin (60-6, 30-4)
    expect(lit(s)).toEqual(new Set([...glyphPixels(0x41, 54, 26), ...glyphPixels(0x42, 60, 26)]));
  });

  it("uses integer halves for odd sizes", () => {
    const s = new Sprite(W, H);
    s.setTextColor(TFT_WHITE);
    s.setTextDatum(MC_DATUM);
    s.drawString("ABC", 60, 30); // width 18 -> 9; height 8 -> 4
    expect(lit(s)).toEqual(new Set([
      ...glyphPixels(0x41, 51, 26), ...glyphPixels(0x42, 57, 26), ...glyphPixels(0x43, 63, 26),
    ]));
  });

  it("scales the box with the text size (as the clock does)", () => {
    const s = new Sprite(135, 240);
    s.setTextColor(TFT_WHITE, TFT_BLACK);
    s.setTextDatum(MC_DATUM);
    s.setTextSize(4);
    const w = s.drawString("12:34", 67, 140);
    expect(w).toBe(5 * 6 * 4);
    const b = bounds(lit(s));
    expect(b.x0).toBeGreaterThanOrEqual(67 - 60);
    expect(b.x1).toBeLessThan(67 + 60);
    expect(b.y0).toBeGreaterThanOrEqual(140 - 16);
    expect(b.y1).toBeLessThan(140 + 16);
  });

  it("TC / BC / BR datums", () => {
    const tc = new Sprite(W, H);
    tc.setTextColor(TFT_WHITE);
    tc.setTextDatum(TC_DATUM);
    tc.drawString("AB", 60, 10);
    expect(bounds(lit(tc))).toMatchObject({ x0: 54, y0: 10 }); // box top = datum y ('B' lights row 0);

    const bc = new Sprite(W, H);
    bc.setTextColor(TFT_WHITE);
    bc.setTextDatum(BC_DATUM);
    bc.drawString("AB", 60, 40);
    expect(bounds(lit(bc)).y1).toBeLessThanOrEqual(39);
    expect(bounds(lit(bc)).y0).toBeGreaterThanOrEqual(32);

    const br = new Sprite(W, H);
    br.setTextColor(TFT_WHITE, TFT_BLUE);
    br.setTextDatum(BR_DATUM);
    br.drawString("AB", 100, 40);
    expect(bounds(lit(br))).toEqual({ x0: 88, y0: 32, x1: 99, y1: 39 });
  });

  it("clamps a non-TL datum so the box stays inside the sprite", () => {
    const s = new Sprite(W, H);
    s.setTextColor(TFT_WHITE, TFT_BLUE);
    s.setTextDatum(MC_DATUM);
    s.drawString("AB", 2, 2);
    expect(bounds(lit(s))).toEqual({ x0: 0, y0: 0, x1: 11, y1: 7 });
    const t = new Sprite(W, H);
    t.setTextColor(TFT_WHITE, TFT_BLUE);
    t.setTextDatum(MC_DATUM);
    t.drawString("AB", 119, 59);
    expect(bounds(lit(t))).toEqual({ x0: W - 12, y0: H - 8, x1: W - 1, y1: H - 1 });
  });

  it("measures with textWidth/fontHeight", () => {
    const s = new Sprite(W, H);
    expect(s.textWidth("hello")).toBe(30);
    expect(s.fontHeight()).toBe(8);
    s.setTextSize(2);
    expect(s.textWidth("hello")).toBe(60);
    expect(s.fontHeight()).toBe(16);
    expect(s.textWidth("")).toBe(0);
  });

  it("counts UTF-8 bytes in textWidth like strlen, but draws one cell per character", () => {
    const s = new Sprite(W, H);
    s.setTextColor(TFT_WHITE);
    expect(s.textWidth("´")).toBe(12);
    expect(s.drawString("´", 10, 10)).toBe(6);
  });
});

describe("printf", () => {
  it("formats integers", () => {
    expect(sprintf("%d", 42)).toBe("42");
    expect(sprintf("%i", -7)).toBe("-7");
    expect(sprintf("%02d", 5)).toBe("05");
    expect(sprintf("%02d", -5)).toBe("-5");
    expect(sprintf("%03d", -5)).toBe("-05");
    expect(sprintf("%3u", 7)).toBe("  7");
    expect(sprintf("%-4d|", 7)).toBe("7   |");
    expect(sprintf("%+d", 3)).toBe("+3");
    expect(sprintf("% d", 3)).toBe(" 3");
    expect(sprintf("%.3d", 7)).toBe("007");
    expect(sprintf("%ld %lu", 123456, 4000000000)).toBe("123456 4000000000");
    expect(sprintf("%u", -1)).toBe("4294967295");
    expect(sprintf("%d", 3.9)).toBe("3");
  });
  it("formats hex", () => {
    expect(sprintf("%x", 255)).toBe("ff");
    expect(sprintf("%X", 255)).toBe("FF");
    expect(sprintf("%04x", 255)).toBe("00ff");
    expect(sprintf("%#x", 255)).toBe("0xff");
    expect(sprintf("%x", -1)).toBe("ffffffff");
  });
  it("formats floats", () => {
    expect(sprintf("%f", 1.5)).toBe("1.500000");
    expect(sprintf("%5.1f", 3.14159)).toBe("  3.1");
    expect(sprintf("%.2f", 2.005)).toBe("2.00"); // binary 2.005 is below the tie
    expect(sprintf("%.0f", 2.5)).toBe("2"); // exact ties go to even like C
    expect(sprintf("%.0f", 3.5)).toBe("4");
    expect(sprintf("%.2f", 0.125)).toBe("0.12");
    expect(sprintf("%05.1f", -2.5)).toBe("-02.5");
    expect(sprintf("%-6.2f|", 1)).toBe("1.00  |");
    expect(sprintf("%.1f", -0.04)).toBe("-0.0");
  });
  it("formats strings and chars", () => {
    expect(sprintf("%s", "hi")).toBe("hi");
    expect(sprintf("%-8s|", "ab")).toBe("ab      |");
    expect(sprintf("%5s|", "ab")).toBe("   ab|");
    expect(sprintf("%.21s", "x".repeat(30))).toBe("x".repeat(21));
    expect(sprintf("%c%c", 72, "i")).toBe("Hi");
    expect(sprintf("%s's %s", "Dan", "duck")).toBe("Dan's duck");
  });
  it("handles %% and the firmware's own formats", () => {
    expect(sprintf("%d%%", 85)).toBe("85%");
    expect(sprintf("%lu%%", 85)).toBe("85%");
    expect(sprintf("%u/%u", 2, 5)).toBe("2/5");
    expect(sprintf("approve? %lus", 12)).toBe("approve? 12s");
    expect(sprintf("napped   %luh%02lum", 3, 7)).toBe("napped   3h07m");
    expect(sprintf("%s%lu.%luM", "tokens ", 12, 3)).toBe("tokens 12.3M");
    expect(sprintf("Lv %u", 9)).toBe("Lv 9");
    expect(sprintf("%*d|%-*d|", 4, 7, 3, 1)).toBe("   7|1  |");
  });
  it("leaves unknown specs and missing args alone", () => {
    expect(sprintf("%e", 1)).toBe("%e");
    expect(sprintf("%d|%s", 1)).toBe("1|(null)");
    expect(sprintf("100%")).toBe("100%");
  });
  it("Sprite.printf draws what print would for the formatted string", () => {
    const a = new Sprite(100, 10);
    const b = new Sprite(100, 10);
    a.setTextColor(TFT_WHITE);
    b.setTextColor(TFT_WHITE);
    a.printf("Lv %02d %5.1f%%", 3, 12.34);
    b.print("Lv 03  12.3%");
    expect(Array.from(a.pixels)).toEqual(Array.from(b.pixels));
    expect(a.getCursorX()).toBe(b.getCursorX());
  });
});

describe("primitives", () => {
  it("fillCircle is symmetric and has the right extent", () => {
    for (const r of [1, 2, 3, 5, 7, 12]) {
      const s = new Sprite(41, 41);
      s.fillCircle(20, 20, r, TFT_WHITE);
      const pts = lit(s);
      expect(pts.has("20,20")).toBe(true);
      for (const p of pts) {
        const [x, y] = p.split(",").map(Number);
        expect(pts.has(`${40 - x},${y}`)).toBe(true); // left/right mirror about x=20
        expect(pts.has(`${x},${40 - y}`)).toBe(true); // top/bottom mirror
      }
      const b = bounds(pts);
      expect(b).toEqual({ x0: 20 - r, y0: 20 - r, x1: 20 + r, y1: 20 + r });
    }
  });

  it("fillCircle is also symmetric under transpose around its centre", () => {
    const s = new Sprite(41, 41);
    s.fillCircle(20, 20, 9, TFT_WHITE);
    const pts = lit(s);
    for (const p of pts) {
      const [x, y] = p.split(",").map(Number);
      expect(pts.has(`${y},${x}`)).toBe(true);
    }
  });

  it("drawCircle is symmetric, hollow and touches the four extremes", () => {
    const s = new Sprite(41, 41);
    s.drawCircle(20, 20, 10, TFT_WHITE);
    const pts = lit(s);
    for (const p of pts) {
      const [x, y] = p.split(",").map(Number);
      expect(pts.has(`${40 - x},${y}`)).toBe(true);
      expect(pts.has(`${x},${40 - y}`)).toBe(true);
      expect(pts.has(`${y},${x}`)).toBe(true);
    }
    for (const q of ["30,20", "10,20", "20,10", "20,30"]) expect(pts.has(q)).toBe(true);
    expect(pts.has("20,20")).toBe(false);
  });

  it("fillRect / drawRect / lines hit the expected pixels", () => {
    const s = new Sprite(20, 20);
    s.fillRect(2, 3, 4, 2, TFT_RED);
    expect(lit(s).size).toBe(8);
    expect(s.readPixel(2, 3)).toBe(TFT_RED);
    expect(s.readPixel(5, 4)).toBe(TFT_RED);
    expect(s.readPixel(6, 4)).toBe(TFT_BLACK);

    const r = new Sprite(20, 20);
    r.drawRect(1, 1, 5, 4, TFT_WHITE);
    expect(lit(r).size).toBe(2 * 5 + 2 * 2);
    expect(r.readPixel(3, 2)).toBe(TFT_BLACK);

    const l = new Sprite(20, 20);
    l.drawLine(0, 0, 9, 9, TFT_WHITE);
    for (let i = 0; i < 10; i++) expect(l.readPixel(i, i)).toBe(TFT_WHITE);
    expect(lit(l).size).toBe(10);

    const v = new Sprite(20, 20);
    v.drawLine(5, 1, 5, 8, TFT_WHITE);
    expect(lit(v).size).toBe(8);

    const rev = new Sprite(20, 20);
    rev.drawLine(9, 2, 0, 0, TFT_WHITE);
    expect(rev.readPixel(9, 2)).toBe(TFT_WHITE);
    expect(rev.readPixel(0, 0)).toBe(TFT_WHITE);
    expect(lit(rev).size).toBe(10); // one pixel per column of the major axis
  });

  it("drawFastHLine / drawFastVLine", () => {
    const s = new Sprite(10, 10);
    s.drawFastHLine(2, 3, 5, TFT_WHITE);
    s.drawFastVLine(8, 1, 4, TFT_RED);
    expect(lit(s).size).toBe(9);
    expect(s.readPixel(6, 3)).toBe(TFT_WHITE);
    expect(s.readPixel(7, 3)).toBe(TFT_BLACK);
    expect(s.readPixel(8, 4)).toBe(TFT_RED);
  });

  it("fillRoundRect / drawRoundRect cut the corners", () => {
    const f = new Sprite(30, 20);
    f.fillRoundRect(2, 2, 20, 12, 4, TFT_WHITE);
    expect(f.readPixel(2, 2)).toBe(TFT_BLACK); // corner rounded away
    expect(f.readPixel(12, 2)).toBe(TFT_WHITE);
    expect(f.readPixel(2, 8)).toBe(TFT_WHITE);
    expect(f.readPixel(21, 13)).toBe(TFT_BLACK);
    expect(bounds(lit(f))).toEqual({ x0: 2, y0: 2, x1: 21, y1: 13 });

    const d = new Sprite(30, 20);
    d.drawRoundRect(2, 2, 20, 12, 4, TFT_WHITE);
    expect(d.readPixel(2, 2)).toBe(TFT_BLACK);
    expect(d.readPixel(12, 2)).toBe(TFT_WHITE);
    expect(d.readPixel(12, 7)).toBe(TFT_BLACK);
    expect(bounds(lit(d))).toEqual({ x0: 2, y0: 2, x1: 21, y1: 13 });
  });

  it("fillTriangle covers its vertices and is flat-topped/bottomed correctly", () => {
    const s = new Sprite(30, 30);
    s.fillTriangle(5, 5, 15, 5, 10, 15, TFT_WHITE);
    for (const p of ["5,5", "15,5", "10,15"]) expect(lit(s).has(p)).toBe(true);
    expect(s.readPixel(10, 10)).toBe(TFT_WHITE);
    expect(s.readPixel(5, 15)).toBe(TFT_BLACK);
    expect(bounds(lit(s))).toEqual({ x0: 5, y0: 5, x1: 15, y1: 15 });

    // vertex order must not matter
    const t = new Sprite(30, 30);
    t.fillTriangle(10, 15, 5, 5, 15, 5, TFT_WHITE);
    expect(Array.from(t.pixels)).toEqual(Array.from(s.pixels));

    // degenerate: all on one scanline
    const u = new Sprite(30, 30);
    u.fillTriangle(3, 4, 9, 4, 6, 4, TFT_WHITE);
    expect(lit(u).size).toBe(7);

    const side = new Sprite(30, 30); // the menu arrows: fillTriangle(x, y+1, x+6, y+1, x+3, y+6)
    side.fillTriangle(10, 11, 16, 11, 13, 16, TFT_WHITE);
    expect(side.readPixel(10, 11)).toBe(TFT_WHITE);
    expect(side.readPixel(13, 16)).toBe(TFT_WHITE);
  });

  it("drawTriangle outlines", () => {
    const s = new Sprite(30, 30);
    s.drawTriangle(5, 5, 15, 5, 10, 15, TFT_WHITE);
    expect(s.readPixel(10, 5)).toBe(TFT_WHITE);
    expect(s.readPixel(10, 8)).toBe(TFT_BLACK);
  });
});

describe("clipping", () => {
  it("never draws outside the sprite and never throws", () => {
    const s = new Sprite(10, 10);
    s.fillRect(-5, -5, 8, 8, TFT_WHITE);
    expect(bounds(lit(s))).toEqual({ x0: 0, y0: 0, x1: 2, y1: 2 });
    s.fillSprite(TFT_BLACK);
    s.fillRect(8, 8, 50, 50, TFT_WHITE);
    expect(lit(s).size).toBe(4);
    s.fillSprite(TFT_BLACK);
    s.drawFastHLine(-3, 2, 6, TFT_WHITE);
    s.drawFastHLine(7, 4, 99, TFT_WHITE);
    s.drawFastVLine(1, -9, 11, TFT_WHITE);
    s.drawFastVLine(-1, 0, 5, TFT_WHITE);
    s.drawPixel(-1, 0, TFT_WHITE);
    s.drawPixel(10, 0, TFT_WHITE);
    s.drawPixel(0, 10, TFT_WHITE);
    s.drawLine(-20, -20, 40, 40, TFT_WHITE);
    s.fillCircle(-2, 5, 6, TFT_WHITE);
    s.drawCircle(12, 5, 6, TFT_WHITE);
    s.fillTriangle(-10, -10, 30, 0, 5, 30, TFT_WHITE);
    s.setCursor(-3, 8);
    s.print("ABC");
    s.drawString("clipped", 8, 8);
    expect(s.pixels.length).toBe(100);
    // x=0 column must not have received anything wrapped from the right edge
    s.fillSprite(TFT_BLACK);
    s.drawFastHLine(8, 5, 10, TFT_WHITE);
    expect(s.readPixel(0, 5)).toBe(TFT_BLACK);
    expect(s.readPixel(0, 6)).toBe(TFT_BLACK);
    expect(lit(s).size).toBe(2);
  });

  it("readPixel is 0 outside", () => {
    const s = new Sprite(4, 4);
    s.fillSprite(TFT_WHITE);
    expect(s.readPixel(-1, 0)).toBe(0);
    expect(s.readPixel(4, 0)).toBe(0);
    expect(s.readPixel(0, 4)).toBe(0);
    expect(s.readPixel(3, 3)).toBe(TFT_WHITE);
  });

  it("truncates fractional coordinates like C ints", () => {
    const s = new Sprite(10, 10);
    s.drawPixel(2.9, 3.9, TFT_WHITE);
    expect(s.readPixel(2, 3)).toBe(TFT_WHITE);
    s.fillRect(0.7, 5.2, 2.9, 1.9, TFT_RED);
    expect(bounds(lit(s, TFT_BLACK, 0, 5, 10, 5))).toEqual({ x0: 0, y0: 5, x1: 1, y1: 5 });
  });

  it("setClipRect restricts every primitive; clearClipRect lifts it", () => {
    const s = new Sprite(20, 20);
    s.setClipRect(5, 5, 6, 4);
    s.fillSprite(TFT_WHITE);
    expect(bounds(lit(s))).toEqual({ x0: 5, y0: 5, x1: 10, y1: 8 });
    s.clearClipRect();
    s.fillSprite(TFT_BLACK);
    s.setClipRect(5, 5, 6, 4);
    s.drawLine(0, 0, 19, 19, TFT_WHITE);
    s.fillCircle(8, 7, 12, TFT_RED);
    s.setCursor(0, 0);
    s.setTextColor(TFT_WHITE, TFT_BLUE);
    s.print("WIDE TEXT");
    s.drawPixel(2, 2, TFT_WHITE);
    for (const p of lit(s)) {
      const [x, y] = p.split(",").map(Number);
      expect(x >= 5 && x < 11 && y >= 5 && y < 9).toBe(true);
    }
    s.clearClipRect();
    s.drawPixel(2, 2, TFT_WHITE);
    expect(s.readPixel(2, 2)).toBe(TFT_WHITE);
  });

  it("clip rect is intersected with the sprite and can be empty", () => {
    const s = new Sprite(10, 10);
    s.setClipRect(-5, -5, 100, 100);
    s.fillSprite(TFT_WHITE);
    expect(lit(s).size).toBe(100);
    s.fillSprite(TFT_BLACK);
    s.setClipRect(3, 3, 0, 5);
    s.fillSprite(TFT_WHITE);
    expect(lit(s).size).toBe(0);
    s.setClipRect(3, 3, -4, -4);
    s.fillSprite(TFT_WHITE);
    expect(lit(s).size).toBe(0);
  });
});

describe("drawRgba", () => {
  const px = (r: number, g: number, b: number, a: number) => [r, g, b, a];

  it("skips pixels with alpha < 128 and converts to RGB565", () => {
    const rgba = new Uint8ClampedArray([
      ...px(255, 0, 0, 127), // skipped
      ...px(0, 255, 0, 128), // drawn
      ...px(0, 0, 255, 255), // drawn
      ...px(255, 255, 255, 0), // skipped
    ]);
    const s = new Sprite(10, 10);
    s.fillSprite(TFT_RED);
    s.drawRgba(2, 3, 2, 2, rgba);
    expect(s.readPixel(2, 3)).toBe(TFT_RED);
    expect(s.readPixel(3, 3)).toBe(0x07e0);
    expect(s.readPixel(2, 4)).toBe(TFT_BLUE);
    expect(s.readPixel(3, 4)).toBe(TFT_RED);
  });

  it("scales nearest-neighbour", () => {
    const rgba = new Uint8ClampedArray([...px(255, 255, 255, 255), ...px(0, 0, 0, 0), ...px(0, 0, 0, 0), ...px(0, 0, 255, 255)]);
    const s = new Sprite(10, 10);
    s.drawRgba(1, 1, 2, 2, rgba, 3);
    expect(lit(s).size).toBe(18);
    expect(s.readPixel(1, 1)).toBe(TFT_WHITE);
    expect(s.readPixel(3, 3)).toBe(TFT_WHITE);
    expect(s.readPixel(4, 1)).toBe(TFT_BLACK);
    expect(s.readPixel(4, 4)).toBe(TFT_BLUE);
    expect(s.readPixel(6, 6)).toBe(TFT_BLUE);
    expect(s.readPixel(7, 7)).toBe(TFT_BLACK);
  });

  it("clips to the sprite and the clip rect", () => {
    const rgba = new Uint8ClampedArray(4 * 4 * 4).fill(255);
    const s = new Sprite(6, 6);
    s.drawRgba(-2, -2, 4, 4, rgba, 2);
    expect(bounds(lit(s))).toEqual({ x0: 0, y0: 0, x1: 5, y1: 5 });
    s.fillSprite(TFT_BLACK);
    s.setClipRect(1, 1, 2, 2);
    s.drawRgba(0, 0, 4, 4, rgba);
    expect(lit(s).size).toBe(4);
  });
});

describe("color helpers", () => {
  it("color565 packs like TFT_eSPI", () => {
    expect(color565(255, 0, 0)).toBe(TFT_RED);
    expect(color565(0, 255, 0)).toBe(0x07e0);
    expect(color565(0, 0, 255)).toBe(TFT_BLUE);
    expect(color565(255, 255, 255)).toBe(TFT_WHITE);
    expect(color565(0, 0, 0)).toBe(0);
  });
  it("rgb565ToRgb bit-replicates", () => {
    expect(rgb565ToRgb(0xffff)).toEqual([255, 255, 255]);
    expect(rgb565ToRgb(0)).toEqual([0, 0, 0]);
    expect(rgb565ToRgb(TFT_RED)).toEqual([255, 0, 0]);
    expect(rgb565ToRgb(0x07e0)).toEqual([0, 255, 0]);
    expect(rgb565ToRgb(0x0841)).toEqual([8, 8, 8]); // r5=1, g6=2, b5=1
  });
  it("rgb565ToCss formats", () => {
    expect(rgb565ToCss(0xffff)).toBe("#ffffff");
    expect(rgb565ToCss(0)).toBe("#000000");
    expect(rgb565ToCss(TFT_BLUE)).toBe("#0000ff");
    expect(rgb565ToCss(0x7bef)).toBe("#7b7d7b");
  });
  it("cssToRgb565 parses", () => {
    expect(cssToRgb565("#ff0000")).toBe(TFT_RED);
    expect(cssToRgb565("#FFF")).toBe(TFT_WHITE);
    expect(cssToRgb565("00ff00")).toBe(0x07e0);
    expect(cssToRgb565("nonsense")).toBe(0);
  });
  it("round-trips every RGB565 value through CSS", () => {
    for (let c = 0; c < 65536; c++) {
      if (cssToRgb565(rgb565ToCss(c)) !== c) throw new Error(`round trip failed for 0x${c.toString(16)}`);
    }
  });
  it("round-trips every RGB565 value through RGB", () => {
    for (let c = 0; c < 65536; c++) {
      const [r, g, b] = rgb565ToRgb(c);
      if (color565(r, g, b) !== c) throw new Error(`rgb round trip failed for 0x${c.toString(16)}`);
    }
  });
});

describe("rotation mapping", () => {
  /** 3x2 sprite: values 1..6 row-major. */
  function small(): Sprite {
    const s = new Sprite(3, 2);
    for (let i = 0; i < 6; i++) s.pixels[i] = color565(i * 40 + 10, 0, 0);
    return s;
  }
  const grid = (s: Sprite, rot: number): number[][] => {
    const out = new Uint32Array(6);
    const { width, height } = rotateToRgba(s.pixels, s.w, s.h, rot, out);
    const rows: number[][] = [];
    for (let y = 0; y < height; y++) {
      rows.push(Array.from({ length: width }, (_, x) => out[y * width + x] & 0xff)); // red byte (little-endian)
    }
    return rows;
  };

  it("rotation 0 is a straight copy", () => {
    const g = grid(small(), 0);
    expect(g.length).toBe(2);
    expect(g[0].length).toBe(3);
    expect(g[0][0]).toBe(rgb565ToRgb(color565(10, 0, 0))[0]);
  });

  it("rotation 1 turns the landscape image 90 deg counter-clockwise (device turned clockwise)", () => {
    const s = small(); // a b c / d e f
    const g1 = grid(s, 1);
    expect([g1.length, g1[0].length]).toEqual([3, 2]);
    // CCW: first row of the result is the right-most source column top-to-bottom: c f
    const v = (i: number) => rgb565ToRgb(s.pixels[i])[0];
    expect(g1).toEqual([[v(2), v(5)], [v(1), v(4)], [v(0), v(3)]]);
  });

  it("rotation 3 turns it 90 deg clockwise", () => {
    const s = small();
    const g3 = grid(s, 3);
    const v = (i: number) => rgb565ToRgb(s.pixels[i])[0];
    expect(g3).toEqual([[v(3), v(0)], [v(4), v(1)], [v(5), v(2)]]);
  });

  it("rotation 2 is 180 degrees", () => {
    const s = small();
    const g2 = grid(s, 2);
    const v = (i: number) => rgb565ToRgb(s.pixels[i])[0];
    expect(g2).toEqual([[v(5), v(4), v(3)], [v(2), v(1), v(0)]]);
  });

  it("a 240x135 landscape sprite fills the 135x240 frame", () => {
    const s = new Sprite(240, 135);
    s.fillSprite(TFT_RED);
    s.drawPixel(0, 0, TFT_WHITE); // top-left of the landscape image
    const r1 = spriteToRgba(s, 1);
    expect([r1.width, r1.height]).toEqual([135, 240]);
    // rotation 1: top-left of the sprite lands at the bottom-left of the frame
    const at = (img: typeof r1, x: number, y: number) => Array.from(img.data.slice((y * img.width + x) * 4, (y * img.width + x) * 4 + 4));
    expect(at(r1, 0, 239)).toEqual([255, 255, 255, 255]);
    expect(at(r1, 0, 0)).toEqual([255, 0, 0, 255]);
    const r3 = spriteToRgba(s, 3);
    expect([r3.width, r3.height]).toEqual([135, 240]);
    expect(at(r3, 134, 0)).toEqual([255, 255, 255, 255]); // top-right of the frame
  });
});

describe("Display", () => {
  interface FakeCtx {
    imageSmoothingEnabled: boolean;
    fillStyle: string;
    calls: string[];
    imagesMade: number;
    lastImage: { width: number; height: number; data: Uint8ClampedArray } | null;
    createImageData(w: number, h: number): { width: number; height: number; data: Uint8ClampedArray };
    putImageData(img: { width: number; height: number; data: Uint8ClampedArray }): void;
    drawImage(src: unknown, x: number, y: number, w: number, h: number): void;
    fillRect(x: number, y: number, w: number, h: number): void;
  }
  const ctxs = new Map<HTMLCanvasElement, FakeCtx>();

  function installFakeCanvas(): void {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (this: HTMLCanvasElement) {
      let c = ctxs.get(this);
      if (!c) {
        c = {
          imageSmoothingEnabled: true,
          fillStyle: "",
          calls: [],
          imagesMade: 0,
          lastImage: null,
          createImageData(w, h) { this.imagesMade++; return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }; },
          putImageData(img) { this.lastImage = { width: img.width, height: img.height, data: img.data.slice() }; this.calls.push("put"); },
          drawImage(_src, x, y, w, h) { this.calls.push(`draw ${x},${y},${w},${h} smooth=${this.imageSmoothingEnabled}`); },
          fillRect(x, y, w, h) { this.calls.push(`fill ${this.fillStyle} ${x},${y},${w},${h}`); },
        };
        ctxs.set(this, c);
      }
      return c as unknown as RenderingContext;
    } as never);
  }

  afterEach(() => {
    vi.restoreAllMocks();
    ctxs.clear();
  });

  it("constructs without a 2d context (jsdom) and sizes the canvas", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null); // what jsdom gives, minus its log noise
    const canvas = document.createElement("canvas");
    const d = new Display(canvas, 2);
    expect(canvas.width).toBe(270);
    expect(canvas.height).toBe(480);
    const s = new Sprite(135, 240);
    expect(() => d.push(s)).not.toThrow();
    expect(() => d.setPower(false)).not.toThrow();
    expect(() => d.setPower(true)).not.toThrow();
  });

  it("blits scaled with smoothing off and converts RGB565 to RGBA", () => {
    installFakeCanvas();
    const canvas = document.createElement("canvas");
    const d = new Display(canvas, 3);
    expect([canvas.width, canvas.height]).toEqual([405, 720]);
    const s = new Sprite(135, 240);
    s.drawPixel(0, 0, TFT_RED);
    s.drawPixel(134, 239, TFT_BLUE);
    d.push(s);
    const main = ctxs.get(canvas)!;
    expect(main.calls[main.calls.length - 1]).toBe("draw 0,0,405,720 smooth=false");
    const off = [...ctxs.entries()].find(([c]) => c !== canvas)![1];
    const img = off.lastImage!;
    expect([img.width, img.height]).toEqual([135, 240]);
    expect(Array.from(img.data.slice(0, 4))).toEqual([255, 0, 0, 255]);
    expect(Array.from(img.data.slice(-4))).toEqual([0, 0, 255, 255]);
    expect(Array.from(img.data.slice(4, 8))).toEqual([0, 0, 0, 255]);
  });

  it("rotates landscape sprites into the portrait canvas and reports rotation changes", () => {
    installFakeCanvas();
    const canvas = document.createElement("canvas");
    const d = new Display(canvas, 2);
    const seen: number[] = [];
    d.onRotationChange = (r) => seen.push(r);
    const portrait = new Sprite(135, 240);
    const land = new Sprite(240, 135);
    land.drawPixel(0, 0, TFT_WHITE);
    d.push(portrait);
    d.push(portrait, 0);
    expect(seen).toEqual([]);
    d.push(land, 1);
    d.push(land, 1);
    expect(seen).toEqual([1]);
    const off = [...ctxs.entries()].find(([c]) => c !== canvas)![1];
    expect([off.lastImage!.width, off.lastImage!.height]).toEqual([135, 240]);
    expect(Array.from(off.lastImage!.data.slice(239 * 135 * 4, 239 * 135 * 4 + 4))).toEqual([255, 255, 255, 255]);
    d.push(land, 3);
    d.push(portrait, 0);
    expect(seen).toEqual([1, 3, 0]);
    expect([canvas.width, canvas.height]).toEqual([270, 480]); // backing size never changes
  });

  it("setPower(false) paints black and ignores pushes; setPower(true) re-pushes the last frame", () => {
    installFakeCanvas();
    const canvas = document.createElement("canvas");
    const d = new Display(canvas, 1);
    const s = new Sprite(135, 240);
    s.fillSprite(TFT_RED);
    d.push(s);
    const main = ctxs.get(canvas)!;
    const off = [...ctxs.entries()].find(([c]) => c !== canvas)![1];
    d.setPower(false);
    expect(main.calls[main.calls.length - 1]).toBe("fill #000 0,0,135,240");
    const before = main.calls.length;
    s.fillSprite(TFT_BLUE);
    d.push(s); // ignored on screen, but remembered
    expect(main.calls.length).toBe(before);
    d.setPower(true);
    expect(main.calls[main.calls.length - 1]).toBe("draw 0,0,135,240 smooth=false");
    expect(Array.from(off.lastImage!.data.slice(0, 4))).toEqual([0, 0, 255, 255]);
  });

  it("setPower(true) after the sprite changed while off shows the frame from power-off time", () => {
    installFakeCanvas();
    const canvas = document.createElement("canvas");
    const d = new Display(canvas, 1);
    const s = new Sprite(135, 240);
    s.fillSprite(TFT_RED);
    d.push(s);
    d.setPower(false);
    s.fillSprite(TFT_BLUE); // never pushed
    d.setPower(true);
    const off = [...ctxs.entries()].find(([c]) => c !== canvas)![1];
    expect(Array.from(off.lastImage!.data.slice(0, 4))).toEqual([255, 0, 0, 255]);
  });

  // Paints so far: [main-canvas drawImage calls, offscreen putImageData calls].
  const paints = (main: FakeCtx, off: FakeCtx): [number, number] => [
    main.calls.filter((c) => c.startsWith("draw")).length,
    off.calls.filter((c) => c === "put").length,
  ];

  it("push skips the conversion and blit when nothing changed since the last frame", () => {
    installFakeCanvas();
    const canvas = document.createElement("canvas");
    const d = new Display(canvas, 2);
    const s = new Sprite(135, 240);
    s.fillSprite(TFT_RED);
    d.push(s);
    const main = ctxs.get(canvas)!;
    const off = [...ctxs.entries()].find(([c]) => c !== canvas)![1];
    expect(paints(main, off)).toEqual([1, 1]); // the first push always paints
    for (let i = 0; i < 100; i++) d.push(s); // 60 Hz loop, static picture
    d.push(s, 0);
    expect(paints(main, off)).toEqual([1, 1]);
  });

  it("push repaints when a pixel changed, even in the same sprite object, and then goes quiet again", () => {
    installFakeCanvas();
    const canvas = document.createElement("canvas");
    const d = new Display(canvas, 1);
    const s = new Sprite(135, 240);
    d.push(s);
    const main = ctxs.get(canvas)!;
    const off = [...ctxs.entries()].find(([c]) => c !== canvas)![1];
    s.drawPixel(134, 239, TFT_BLUE); // last pixel: the compare must scan the whole buffer
    d.push(s);
    expect(paints(main, off)).toEqual([2, 2]);
    expect(Array.from(off.lastImage!.data.slice(-4))).toEqual([0, 0, 255, 255]);
    d.push(s);
    d.push(s);
    expect(paints(main, off)).toEqual([2, 2]);
    s.drawPixel(134, 239, TFT_BLACK); // changing it back is a change too
    d.push(s);
    expect(paints(main, off)).toEqual([3, 3]);
    expect(Array.from(off.lastImage!.data.slice(-4))).toEqual([0, 0, 0, 255]);
    const other = new Sprite(135, 240); // a different sprite with the same pixels is not a change
    d.push(other);
    expect(paints(main, off)).toEqual([3, 3]);
  });

  it("push repaints when only the rotation or the sprite size changed, and still reports the rotation", () => {
    installFakeCanvas();
    const canvas = document.createElement("canvas");
    const d = new Display(canvas, 1);
    const seen: number[] = [];
    d.onRotationChange = (r) => seen.push(r);
    const land = new Sprite(240, 135); // identical (all black) pixels throughout
    d.push(land, 1);
    const main = ctxs.get(canvas)!;
    const off = [...ctxs.entries()].find(([c]) => c !== canvas)![1];
    d.push(land, 1);
    expect(paints(main, off)).toEqual([1, 1]);
    d.push(land, 3);
    expect(paints(main, off)).toEqual([2, 2]);
    d.push(land, 3);
    expect(paints(main, off)).toEqual([2, 2]);
    d.push(land, 5); // wraps to 1
    expect(paints(main, off)).toEqual([3, 3]);
    const tall = new Sprite(135, 240); // same pixel count, different shape
    d.push(tall, 0);
    expect(paints(main, off)).toEqual([4, 4]);
    d.push(tall, 2);
    expect(paints(main, off)).toEqual([5, 5]);
    expect(seen).toEqual([1, 3, 1, 0, 2]);
  });

  it("push reuses the ImageData and the retained frame instead of allocating per paint", () => {
    installFakeCanvas();
    const canvas = document.createElement("canvas");
    const d = new Display(canvas, 1);
    const s = new Sprite(135, 240);
    for (let i = 0; i < 10; i++) {
      s.drawPixel(i, 0, TFT_WHITE);
      d.push(s);
    }
    const off = [...ctxs.entries()].find(([c]) => c !== canvas)![1];
    expect(off.imagesMade).toBe(1);
    expect(off.calls.filter((c) => c === "put").length).toBe(10);
  });

  it("setPower(true) repaints the last frame once, then identical pushes stay quiet", () => {
    installFakeCanvas();
    const canvas = document.createElement("canvas");
    const d = new Display(canvas, 1);
    const s = new Sprite(135, 240);
    s.fillSprite(TFT_RED);
    d.push(s);
    const main = ctxs.get(canvas)!;
    const off = [...ctxs.entries()].find(([c]) => c !== canvas)![1];
    d.setPower(false);
    d.push(s); // identical to the last frame, but the screen is off
    d.push(s);
    expect(paints(main, off)).toEqual([1, 1]);
    d.setPower(true); // the black fill wiped the picture, so it must come back
    expect(paints(main, off)).toEqual([2, 2]);
    expect(Array.from(off.lastImage!.data.slice(0, 4))).toEqual([255, 0, 0, 255]);
    d.push(s);
    d.push(s);
    expect(paints(main, off)).toEqual([2, 2]);
    d.setPower(true); // already on: no-op
    expect(paints(main, off)).toEqual([2, 2]);
  });

  it("a rotation pushed while off is applied, and reported, when the screen comes back on", () => {
    installFakeCanvas();
    const canvas = document.createElement("canvas");
    const d = new Display(canvas, 1);
    const seen: number[] = [];
    d.onRotationChange = (r) => seen.push(r);
    const land = new Sprite(240, 135);
    d.setPower(false);
    d.push(land, 1); // first ever push, screen off: remembered, nothing drawn
    d.push(land, 1);
    const main = ctxs.get(canvas)!;
    expect(main.calls.some((c) => c.startsWith("draw"))).toBe(false);
    expect(seen).toEqual([]);
    d.setPower(true);
    expect(main.calls[main.calls.length - 1]).toBe("draw 0,0,135,240 smooth=false");
    expect(seen).toEqual([1]);
  });

  it("setBrightness applies immediately while pushes are being skipped", () => {
    installFakeCanvas();
    const canvas = document.createElement("canvas");
    const d = new Display(canvas, 1);
    const s = new Sprite(135, 240);
    d.push(s);
    const main = ctxs.get(canvas)!;
    const off = [...ctxs.entries()].find(([c]) => c !== canvas)![1];
    d.setBrightness(40);
    d.push(s);
    expect(canvas.style.filter).toBe("brightness(0.4)");
    d.setBrightness(100);
    d.push(s);
    expect(canvas.style.filter).toBe("");
    expect(paints(main, off)).toEqual([1, 1]);
  });

  it("setBrightness sets a CSS brightness filter", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    const canvas = document.createElement("canvas");
    const d = new Display(canvas, 1);
    d.setBrightness(60);
    expect(canvas.style.filter).toBe("brightness(0.6)");
    d.setBrightness(100);
    expect(canvas.style.filter).toBe("");
    d.setBrightness(-5);
    expect(canvas.style.filter).toBe("brightness(0)");
  });
});
