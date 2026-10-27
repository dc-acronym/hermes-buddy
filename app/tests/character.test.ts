// character.ts: manifest parsing, state-array rotation, GIF decode + compositing, placement.
// The sprite is a recording fake (tft.ts Sprite methods may still be TODO stubs); GIFs are
// assembled byte-by-byte below so the whole pack -> base64 -> gifuct-js -> RGBA path runs.
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as gifuct from "gifuct-js";
import { setMillisSource } from "../src/hw/platform";
import type { Sprite } from "../src/hw/tft";
import type { CharacterPack } from "../src/data/types";
import {
  characterClose,
  characterInit,
  characterInvalidate,
  characterLoaded,
  characterPalette,
  characterRenderTo,
  characterSetPeek,
  characterSetState,
  characterTick,
} from "../src/character";

const h = vi.hoisted(() => {
  type Call = [string, ...unknown[]];
  class FakeSprite {
    calls: Call[] = [];
    constructor(readonly w: number, readonly hh: number) {}
    width(): number { return this.w; }
    height(): number { return this.hh; }
    fillRect(...a: unknown[]): void { this.calls.push(["fillRect", ...a]); }
    fillSprite(...a: unknown[]): void { this.calls.push(["fillSprite", ...a]); }
    drawRgba(x: number, y: number, w: number, hh: number, rgba: Uint8ClampedArray): void {
      this.calls.push(["drawRgba", x, y, w, hh, Uint8ClampedArray.from(rgba)]);
    }
    setTextColor(...a: unknown[]): void { this.calls.push(["setTextColor", ...a]); }
    setTextSize(...a: unknown[]): void { this.calls.push(["setTextSize", ...a]); }
    setCursor(...a: unknown[]): void { this.calls.push(["setCursor", ...a]); }
    print(...a: unknown[]): void { this.calls.push(["print", ...a]); }
    of(name: string): Call[] { return this.calls.filter((c) => c[0] === name); }
    clear(): void { this.calls.length = 0; }
  }
  return { FakeSprite, spr: new FakeSprite(135, 240) };
});
vi.mock("../src/app/state", () => ({ spr: h.spr }));

// tft.ts is being written by another agent; cssToRgb565 may still be its TODO stub. Use the
// real one when it works, else the firmware formula, so these tests don't depend on timing.
vi.mock("../src/hw/tft", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../src/hw/tft")>();
  const ref = (css: string): number => {
    const v = parseInt(css.replace("#", ""), 16);
    return ((((v >> 19) & 0x1f) << 11) | (((v >> 10) & 0x3f) << 5) | ((v >> 3) & 0x1f)) & 0xffff;
  };
  return {
    ...orig,
    cssToRgb565: (css: string): number => {
      try {
        return orig.cssToRgb565(css);
      } catch {
        return ref(css);
      }
    },
  };
});

// Count real decompressFrame calls to check decoding is lazy and cached.
vi.mock("gifuct-js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("gifuct-js")>();
  return { ...orig, decompressFrame: vi.fn(orig.decompressFrame) };
});

const spr = h.spr;
const asSprite = (s: unknown): Sprite => s as Sprite;

// ── clock ──
let clock = 0;
beforeEach(async () => {
  clock = 0;
  setMillisSource(() => clock);
  await characterInit(null);
  characterSetPeek(false);
  spr.clear();
  vi.mocked(gifuct.decompressFrame).mockClear();
});

// ── GIF89a builder ──
type RGB = [number, number, number];
interface FrameSpec {
  left?: number;
  top?: number;
  w: number;
  h: number;
  pixels: number[]; // palette indices, row-major
  delayCs?: number;
  disposal?: number;
  transparent?: number; // transparent palette index
}

/** LZW with literals only: a clear code before every pair keeps the code width constant. */
function lzw(minCode: number, pixels: number[]): number[] {
  const clear = 1 << minCode;
  const end = clear + 1;
  const width = minCode + 1;
  const codes: number[] = [];
  for (let i = 0; i < pixels.length; i += 2) {
    codes.push(clear, pixels[i]);
    if (i + 1 < pixels.length) codes.push(pixels[i + 1]);
  }
  codes.push(end);
  const out: number[] = [];
  let acc = 0;
  let nbits = 0;
  for (const c of codes) {
    acc |= c << nbits;
    nbits += width;
    while (nbits >= 8) {
      out.push(acc & 0xff);
      acc >>= 8;
      nbits -= 8;
    }
  }
  if (nbits > 0) out.push(acc & 0xff);
  return out;
}

function buildGif(w: number, hgt: number, palette: RGB[], frames: FrameSpec[]): Uint8Array {
  let n = 4;
  while (n < palette.length) n *= 2;
  const bits = Math.log2(n);
  const b: number[] = [];
  const u16 = (v: number) => b.push(v & 0xff, (v >> 8) & 0xff);
  b.push(...Array.from("GIF89a", (c) => c.charCodeAt(0)));
  u16(w);
  u16(hgt);
  b.push(0x80 | 0x70 | (bits - 1), 0, 0); // global table, 8-bit color res, size, bg index, aspect
  for (let i = 0; i < n; i++) b.push(...(palette[i] ?? [0, 0, 0]));
  for (const f of frames) {
    const t = f.transparent !== undefined;
    b.push(0x21, 0xf9, 4, ((f.disposal ?? 1) << 2) | (t ? 1 : 0));
    u16(f.delayCs ?? 10);
    b.push(t ? f.transparent! : 0, 0);
    b.push(0x2c);
    u16(f.left ?? 0);
    u16(f.top ?? 0);
    u16(f.w);
    u16(f.h);
    b.push(0);
    const minCode = Math.max(2, bits);
    b.push(minCode);
    const data = lzw(minCode, f.pixels);
    for (let i = 0; i < data.length; i += 255) {
      const chunk = data.slice(i, i + 255);
      b.push(chunk.length, ...chunk);
    }
    b.push(0);
  }
  b.push(0x3b);
  return Uint8Array.from(b);
}

const RED: RGB = [255, 0, 0];
const GREEN: RGB = [0, 255, 0];
const BLUE: RGB = [0, 0, 255];
const WHITE: RGB = [255, 255, 255];
const PAL4: RGB[] = [[0, 0, 0], RED, GREEN, BLUE];

/** 1-frame w x h GIF filled with palette index `idx`. */
function solid(w: number, hgt: number, idx: number, delayCs = 10): Uint8Array {
  return buildGif(w, hgt, PAL4, [{ w, h: hgt, pixels: new Array(w * hgt).fill(idx), delayCs }]);
}

const b64 = (u: Uint8Array) => {
  let bin = "";
  for (const x of u) bin += String.fromCharCode(x);
  return btoa(bin);
};

function pack(
  states: Record<string, unknown>,
  gifs: Record<string, Uint8Array>,
  colors?: Record<string, string>,
  extra: Record<string, unknown> = {},
): CharacterPack {
  return {
    name: "t",
    manifest: { name: "t", colors, states, ...extra } as unknown as CharacterPack["manifest"],
    files: Object.fromEntries(Object.entries(gifs).map(([k, v]) => [k, b64(v)])),
  };
}

/** [r,g,b,a] of pixel i of an RGBA buffer. */
const px = (d: unknown, i: number) => Array.from((d as Uint8ClampedArray).slice(i * 4, i * 4 + 4));

function run(ms: number, step = 10): void {
  const end = clock + ms;
  while (clock < end) {
    clock += step;
    characterTick();
  }
}

describe("manifest + palette", () => {
  it("palette is the exact firmware fallback until a pack with colors is loaded", async () => {
    await characterInit(null);
    const dflt = { body: 0xc2a6, bg: 0x0000, text: 0xffff, textDim: 0x8410, ink: 0x0000 };
    expect(characterPalette()).toEqual(dflt);

    expect(await characterInit(pack({ idle: "a.gif" }, { "a.gif": solid(2, 2, 1) }, {
      body: "#6B8E23", bg: "#000000", text: "#FFFFFF", textDim: "#808080", ink: "#102030",
    }))).toBe(true);
    expect(characterPalette()).toEqual({ body: 0x6c64, bg: 0, text: 0xffff, textDim: 0x8410, ink: 0x1106 });

    characterClose();
    expect(characterPalette()).toEqual(dflt);
  });

  it("unspecified, malformed, shorthand and #-less colors", async () => {
    await characterInit(pack({ idle: "a.gif" }, { "a.gif": solid(2, 2, 1) }, {
      body: "FF0000", text: "#f00", textDim: "nonsense",
    }));
    const p = characterPalette();
    expect(p.body).toBe(0xf800);
    expect(p.text).toBe(0xf800);
    expect(p.textDim).toBe(0x8410); // bad value -> default
    expect(p.bg).toBe(0); // missing -> default
    expect(p.ink).toBe(0);
  });

  it("init(null) clears; bad manifests and packs with no usable gif are not loaded", async () => {
    expect(await characterInit(pack({ idle: "a.gif" }, { "a.gif": solid(2, 2, 1) }))).toBe(true);
    expect(characterLoaded()).toBe(true);
    expect(await characterInit(null)).toBe(false);
    expect(characterLoaded()).toBe(false);

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const bad = { name: "x", manifest: 5, files: {} } as unknown as CharacterPack;
    expect(await characterInit(bad)).toBe(false);
    expect(await characterInit(pack({ idle: "missing.gif" }, {}))).toBe(false);
    expect(await characterInit(pack({}, { "a.gif": solid(2, 2, 1) }))).toBe(false);
    expect(characterLoaded()).toBe(false);
    warn.mockRestore();
  });

  it("does nothing while unloaded", async () => {
    await characterInit(null);
    characterSetState(1);
    characterTick();
    characterRenderTo(asSprite(new h.FakeSprite(240, 135)), 57, 45);
    expect(spr.calls).toEqual([]);
  });
});

describe("decode", () => {
  it("decodes a hand-assembled 2x2, 2-frame GIF89a to RGBA and respects frame delays", async () => {
    const gif = buildGif(2, 2, [[0, 0, 0], RED, GREEN, BLUE, WHITE], [
      { w: 2, h: 2, pixels: [1, 2, 3, 4], delayCs: 5 },
      { w: 2, h: 2, pixels: [4, 3, 2, 1], delayCs: 8 },
    ]);
    // sanity: the bytes really are a 2-frame GIF
    expect(gifuct.decompressFrames(gifuct.parseGIF(gif.buffer as ArrayBuffer), true)).toHaveLength(2);
    vi.mocked(gifuct.decompressFrame).mockClear();

    expect(await characterInit(pack({ idle: "g.gif" }, { "g.gif": gif }))).toBe(true);
    expect(gifuct.decompressFrame).not.toHaveBeenCalled(); // nothing decoded at init

    characterSetState(1);
    expect(spr.of("fillSprite")).toEqual([["fillSprite", 0]]); // clears to pal.bg on open
    expect(gifuct.decompressFrame).not.toHaveBeenCalled(); // still lazy

    characterTick(); // t=0: frame 0
    let draws = spr.of("drawRgba");
    expect(draws).toHaveLength(1);
    // centered in the upper 140px: x=(135-2)/2=66, y=(140-2)/2=69
    expect(draws[0].slice(1, 5)).toEqual([66, 69, 2, 2]);
    expect(Array.from(draws[0][5] as Uint8ClampedArray)).toEqual([
      255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255,
    ]);
    // each frame first paints its region with the bg color so nothing ghosts
    expect(spr.of("fillRect")).toEqual([["fillRect", 66, 69, 2, 2, 0]]);
    expect(gifuct.decompressFrame).toHaveBeenCalledTimes(1);

    clock = 49;
    characterTick();
    expect(spr.of("drawRgba")).toHaveLength(1); // frame 0 holds for its 50 ms
    clock = 50;
    characterTick();
    draws = spr.of("drawRgba");
    expect(draws).toHaveLength(2);
    expect(px(draws[1][5], 0)).toEqual([255, 255, 255, 255]);
    expect(px(draws[1][5], 3)).toEqual([255, 0, 0, 255]);
    expect(gifuct.decompressFrame).toHaveBeenCalledTimes(2);

    // frame 1 holds 80 ms, then the single-gif state freezes on its last frame
    clock = 129;
    characterTick();
    clock = 130;
    characterTick();
    run(1000);
    expect(spr.of("drawRgba")).toHaveLength(2);
  });

  it("transparent pixels are left unpainted (bg shows through)", async () => {
    const gif = buildGif(2, 2, PAL4.concat([[9, 9, 9]]), [
      { w: 2, h: 2, pixels: [1, 4, 4, 2], transparent: 4 },
    ]);
    await characterInit(pack({ sleep: "g.gif" }, { "g.gif": gif }, { bg: "#FF0000" }));
    characterSetState(0);
    characterTick();
    const d = spr.of("drawRgba")[0][5];
    expect(px(d, 0)).toEqual([255, 0, 0, 255]);
    expect(px(d, 1)[3]).toBe(0);
    expect(px(d, 2)[3]).toBe(0);
    expect(px(d, 3)).toEqual([0, 255, 0, 255]);
    expect(spr.of("fillRect")[0]).toEqual(["fillRect", 66, 69, 2, 2, 0xf800]); // pal.bg
    expect(spr.of("fillSprite")[0]).toEqual(["fillSprite", 0xf800]);
  });

  it("composites sub-rect patches over the previous frame (disposal 1 keeps)", async () => {
    const gif = buildGif(2, 2, PAL4, [
      { w: 2, h: 2, pixels: [1, 1, 1, 1], disposal: 1 },
      { left: 1, top: 1, w: 1, h: 1, pixels: [3], disposal: 0 },
    ]);
    await characterInit(pack({ idle: "g.gif" }, { "g.gif": gif }));
    characterSetState(1);
    run(200);
    const d = spr.of("drawRgba");
    expect(d.length).toBeGreaterThanOrEqual(2);
    expect([0, 1, 2, 3].map((i) => px(d[1][5], i))).toEqual([
      [255, 0, 0, 255], [255, 0, 0, 255], [255, 0, 0, 255], [0, 0, 255, 255],
    ]);
  });

  it("disposal 2 clears the previous frame's rect to transparent", async () => {
    const gif = buildGif(2, 2, PAL4, [
      { w: 2, h: 2, pixels: [1, 1, 1, 1], disposal: 2 },
      { left: 0, top: 0, w: 1, h: 1, pixels: [2], disposal: 1 },
    ]);
    await characterInit(pack({ idle: "g.gif" }, { "g.gif": gif }));
    characterSetState(1);
    run(200);
    const f1 = spr.of("drawRgba")[1][5];
    expect(px(f1, 0)).toEqual([0, 255, 0, 255]);
    expect([1, 2, 3].map((i) => px(f1, i)[3])).toEqual([0, 0, 0]);
  });

  it("disposal 3 restores the canvas from before the frame", async () => {
    const gif = buildGif(2, 2, PAL4, [
      { w: 2, h: 2, pixels: [1, 1, 1, 1], disposal: 1 },
      { left: 1, top: 1, w: 1, h: 1, pixels: [3], disposal: 3 },
      { left: 0, top: 0, w: 1, h: 1, pixels: [2], disposal: 1 },
    ]);
    await characterInit(pack({ idle: "g.gif" }, { "g.gif": gif }));
    characterSetState(1);
    run(400);
    const d = spr.of("drawRgba");
    expect([0, 1, 2, 3].map((i) => px(d[1][5], i))).toEqual([
      [255, 0, 0, 255], [255, 0, 0, 255], [255, 0, 0, 255], [0, 0, 255, 255],
    ]);
    // frame 2: frame 1's blue pixel is gone again, only the new green pixel on the red
    expect([0, 1, 2, 3].map((i) => px(d[2][5], i))).toEqual([
      [0, 255, 0, 255], [255, 0, 0, 255], [255, 0, 0, 255], [255, 0, 0, 255],
    ]);
  });

  it("decodes each GIF once: loops and state switches reuse the cache", async () => {
    const gif2 = buildGif(2, 2, PAL4, [
      { w: 2, h: 2, pixels: [1, 1, 1, 1], delayCs: 5 },
      { w: 2, h: 2, pixels: [2, 2, 2, 2], delayCs: 5 },
    ]);
    await characterInit(pack({ idle: "two.gif", busy: "two.gif", sleep: "other.gif" },
      { "two.gif": gif2, "other.gif": solid(2, 2, 3) }));
    characterSetState(1);
    run(300); // a few loops (2-frame GIF, 50 ms each)
    expect(gifuct.decompressFrame).toHaveBeenCalledTimes(2);
    characterSetState(2); // same file under another state: cached
    run(300);
    expect(gifuct.decompressFrame).toHaveBeenCalledTimes(2);
    characterSetState(0); // different file: only now decoded
    run(100);
    expect(gifuct.decompressFrame).toHaveBeenCalledTimes(3);
  });

  it("a corrupt gif does not throw and leaves the state blank", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const bad = pack({ idle: "bad.gif" }, {});
    bad.files["bad.gif"] = btoa("this is not a gif at all");
    expect(await characterInit(bad)).toBe(true);
    characterSetState(1);
    run(100);
    expect(spr.of("drawRgba")).toHaveLength(0);
    warn.mockRestore();
  });
});

describe("state arrays rotate", () => {
  const colorOf = (c: unknown[]) => px(c[5], 0).join(",");

  it("each loop-end past the dwell window advances to the next gif, with a pause between", async () => {
    await characterInit(pack(
      { idle: ["a.gif", "b.gif", "c.gif"] },
      { "a.gif": solid(2, 2, 1), "b.gif": solid(2, 2, 2), "c.gif": solid(2, 2, 3) },
    ));
    characterSetState(1);
    const seq: { t: number; c: string }[] = [];
    let seen = 0;
    while (clock < 20000) {
      clock += 10;
      characterTick();
      const d = spr.of("drawRgba");
      for (; seen < d.length; seen++) seq.push({ t: clock, c: colorOf(d[seen]) });
    }
    const R = "255,0,0,255", G = "0,255,0,255", B = "0,0,255,255";
    const order = seq.map((s) => s.c).filter((c, i, a) => i === 0 || c !== a[i - 1]);
    expect(order).toEqual([R, G, B, R]);

    // the first variant loops (dwells) for the full 5 s, then a ~800 ms hold before the next
    const lastRed = seq.filter((s) => s.c === R && s.t < 9000).pop()!;
    const firstGreen = seq.find((s) => s.c === G)!;
    expect(lastRed.t).toBeGreaterThanOrEqual(4900);
    expect(firstGreen.t - lastRed.t).toBeGreaterThanOrEqual(800);
    expect(firstGreen.t).toBeGreaterThanOrEqual(5800);
    expect(seq.filter((s) => s.c === R && s.t < 5000).length).toBeGreaterThan(10); // looped, not frozen
  });

  it("a one-element array behaves like a plain string (freezes after one play)", async () => {
    await characterInit(pack({ idle: ["a.gif"] }, { "a.gif": solid(2, 2, 1) }));
    characterSetState(1);
    run(8000);
    expect(spr.of("drawRgba")).toHaveLength(1);
  });

  it("rotation survives invalidate (same variant reopened) and re-entering the state", async () => {
    await characterInit(pack(
      { idle: ["a.gif", "b.gif"], busy: "a.gif" },
      { "a.gif": solid(2, 2, 1), "b.gif": solid(2, 2, 2) },
    ));
    characterSetState(1);
    run(6000);
    const last = () => colorOf(spr.of("drawRgba").pop()!);
    expect(last()).toBe("0,255,0,255"); // advanced to b
    spr.clear();
    characterInvalidate();
    expect(spr.of("fillSprite")).toHaveLength(1); // full clear + reopen of the current state
    characterTick();
    expect(colorOf(spr.of("drawRgba")[0])).toBe("0,255,0,255"); // still b, restarted at frame 0
  });

  it("a missing gif in a rotation is skipped instead of wedging", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const p = pack({ idle: ["a.gif", "gone.gif", "c.gif"] }, { "a.gif": solid(2, 2, 1), "c.gif": solid(2, 2, 3) });
    await characterInit(p);
    characterSetState(1);
    run(20000);
    const order = spr.of("drawRgba").map(colorOf).filter((c, i, a) => i === 0 || c !== a[i - 1]);
    expect(order.slice(0, 3)).toEqual(["255,0,0,255", "0,0,255,255", "255,0,0,255"]);
    warn.mockRestore();
  });

  it("setState is a no-op for the same state and ignores out-of-range states", async () => {
    await characterInit(pack({ idle: "a.gif", busy: "b.gif" }, { "a.gif": solid(2, 2, 1), "b.gif": solid(2, 2, 2) }));
    characterSetState(1);
    characterTick();
    characterSetState(1);
    expect(spr.of("fillSprite")).toHaveLength(1);
    characterSetState(7);
    characterSetState(-1);
    expect(spr.of("fillSprite")).toHaveLength(1);
    characterSetState(2);
    expect(spr.of("fillSprite")).toHaveLength(2);
  });
});

describe("placement and scaling", () => {
  /** w x h gif, pixel (x,y) = palette index 1 + (x+y)%3 -> checkerboard-ish pattern. */
  const pattern = (w: number, hgt: number) =>
    buildGif(w, hgt, PAL4, [{ w, h: hgt, pixels: Array.from({ length: w * hgt }, (_, i) => 1 + (((i % w) + Math.floor(i / w)) % 3)) }]);

  it("96x100: full size at (19,20); peek half scale at (43,10)", async () => {
    await characterInit(pack({ idle: "g.gif" }, { "g.gif": pattern(96, 100) }));
    characterSetState(1);
    characterTick();
    let d = spr.of("drawRgba")[0];
    expect(d.slice(1, 5)).toEqual([19, 20, 96, 100]); // x=(135-96)/2, y=(140-100)/2

    characterSetPeek(true);
    spr.clear();
    characterSetState(1); // invalidate reopened it; same state is a no-op
    characterTick();
    d = spr.of("drawRgba")[0];
    expect(d.slice(1, 5)).toEqual([43, 10, 48, 50]); // x=(135-48)/2, y=(70-50)/2
    expect((d[5] as Uint8ClampedArray).length).toBe(48 * 50 * 4);
  });

  it("peek samples every other source pixel (even rows and columns)", async () => {
    const pal16: RGB[] = Array.from({ length: 16 }, (_, i) => [i * 16, 0, 0]);
    const gif = buildGif(4, 4, pal16, [{ w: 4, h: 4, pixels: Array.from({ length: 16 }, (_, i) => i) }]);
    await characterInit(pack({ idle: "g.gif" }, { "g.gif": gif }));
    characterSetPeek(true);
    characterSetState(1);
    characterTick();
    const d = spr.of("drawRgba")[0];
    expect(d.slice(1, 5)).toEqual([66, 34, 2, 2]);
    // source indices 0,2 / 8,10 -> red channel idx*16
    expect([0, 1, 2, 3].map((i) => px(d[5], i)[0])).toEqual([0, 32, 128, 160]);
  });

  it("adapts to frame height: a tall gif is centered with the top cropped by the screen edge", async () => {
    const rows = Array.from({ length: 200 }, (_, y) => new Array(4).fill(1 + (y % 3))).flat();
    await characterInit(pack({ idle: "g.gif" }, { "g.gif": buildGif(4, 200, PAL4, [{ w: 4, h: 200, pixels: rows }]) }));
    characterSetState(1);
    characterTick();
    const d = spr.of("drawRgba")[0];
    // gifY = (140-200)/2 = -30 -> first 30 source rows are off-screen, the rest (170) fit in 240
    expect(d.slice(1, 5)).toEqual([65, 0, 4, 170]);
    expect(px(d[5], 0)).toEqual([255, 0, 0, 255]); // source row 30 -> palette index 1 + 30 % 3 = red
    expect(px(d[5], 4)).toEqual([0, 255, 0, 255]); // next row is source row 31
  });

  it("peek clips at the info-panel top (y=70)", async () => {
    const rows = new Array(4 * 200).fill(1);
    await characterInit(pack({ idle: "g.gif" }, { "g.gif": buildGif(4, 200, PAL4, [{ w: 4, h: 200, pixels: rows }]) }));
    characterSetPeek(true);
    characterSetState(1);
    characterTick();
    const d = spr.of("drawRgba")[0];
    // half height 100 -> gifY = (70-100)/2 = -15; rows 0..69 visible
    expect(d.slice(1, 5)).toEqual([66, 0, 2, 70]);
  });
});

describe("characterRenderTo (landscape clock)", () => {
  it("draws half scale around the given center on the target and advances on its own timing", async () => {
    const gif = buildGif(8, 8, PAL4, [
      { w: 8, h: 8, pixels: new Array(64).fill(1), delayCs: 10 },
      { w: 8, h: 8, pixels: new Array(64).fill(2), delayCs: 10 },
    ]);
    await characterInit(pack({ idle: "g.gif" }, { "g.gif": gif }));
    const land = new h.FakeSprite(240, 135);
    characterRenderTo(asSprite(land), 57, 45); // not opened yet: nothing
    expect(land.calls).toEqual([]);

    characterSetState(1);
    characterRenderTo(asSprite(land), 57, 45);
    let d = land.of("drawRgba");
    expect(d).toHaveLength(1);
    expect(d[0].slice(1, 5)).toEqual([57 - 2, 45 - 2, 4, 4]); // cx - w/4, cy - h/4, 8x8 -> 4x4
    expect(px(d[0][5], 0)).toEqual([255, 0, 0, 255]);
    expect(spr.of("drawRgba")).toHaveLength(0); // the home sprite is untouched

    clock = 99;
    characterRenderTo(asSprite(land), 57, 45);
    expect(land.of("drawRgba")).toHaveLength(1);
    clock = 100;
    characterRenderTo(asSprite(land), 57, 45);
    d = land.of("drawRgba");
    expect(d).toHaveLength(2);
    expect(px(d[1][5], 0)).toEqual([0, 255, 0, 255]);

    clock = 200; // past the last frame: wraps to frame 0 in the same call
    characterRenderTo(asSprite(land), 57, 45);
    d = land.of("drawRgba");
    expect(d).toHaveLength(3);
    expect(px(d[2][5], 0)).toEqual([255, 0, 0, 255]);
  });
});

describe("text mode", () => {
  it("renders frames at size 2, centered, cycling at the state's delay", async () => {
    const p = pack(
      { idle: { frames: ["hi", "a-very-long-frame-text-that-is-cut"], delay: 300 }, busy: { frames: [] } },
      {}, undefined, { mode: "text" },
    );
    expect(await characterInit(p)).toBe(true);
    characterSetState(1);
    expect(spr.of("fillSprite")).toEqual([["fillSprite", 0]]);
    characterTick();
    expect(spr.of("fillRect")[0]).toEqual(["fillRect", 0, 46, 135, 28, 0]);
    expect(spr.of("setTextSize")[0]).toEqual(["setTextSize", 2]);
    expect(spr.of("setCursor")[0]).toEqual(["setCursor", 55, 52]); // (135-24)/2, 60-8
    expect(spr.of("print")[0]).toEqual(["print", "hi"]);

    clock = 299;
    characterTick();
    expect(spr.of("print")).toHaveLength(1);
    clock = 300;
    characterTick();
    expect(spr.of("print")[1]).toEqual(["print", "a-very-long-frame-t"]); // clipped to 19 chars
    expect(spr.of("setCursor")[1]).toEqual(["setCursor", Math.trunc((135 - 19 * 12) / 2), 52]);

    characterSetPeek(true);
    spr.clear();
    characterSetState(1);
    clock = 600;
    characterTick();
    expect(spr.of("fillRect")[0]).toEqual(["fillRect", 0, 21, 135, 28, 0]); // peek band at cy=35
  });
});
