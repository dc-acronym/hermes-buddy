// Tests for app/screens.ts: every draw function against a recording fake of the TFT sprite.
// The fake records each print/drawString with the cursor, size and colors in effect and each
// drawing primitive with its arguments, so the tests can assert on what was drawn and where
// (and that no 21-col row spills past the right edge, where the real sprite would wrap).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  interface Call { op: string; args: number[] }
  interface Text { op: "print" | "drawString"; text: string; x: number; y: number; size: number; fg: number; bg: number; datum: number }
  class FakeSprite {
    calls: Call[] = [];
    texts: Text[] = [];
    readonly pixels = new Uint16Array(0);
    private cx = 0;
    private cy = 0;
    private size = 1;
    private fg = 0xffff;
    private bg = 0xffff;
    private datum = 0;
    constructor(readonly w: number, readonly h: number) {}
    width(): number { return this.w; }
    height(): number { return this.h; }
    reset(): void { this.calls = []; this.texts = []; }
    private rec(op: string, ...args: number[]): void { this.calls.push({ op, args }); }
    // primitives
    drawPixel(...a: number[]): void { this.rec("drawPixel", ...a); }
    fillSprite(c: number): void { this.rec("fillSprite", c); }
    fillScreen(c: number): void { this.rec("fillScreen", c); }
    fillRect(...a: number[]): void { this.rec("fillRect", ...a); }
    drawRect(...a: number[]): void { this.rec("drawRect", ...a); }
    drawFastHLine(...a: number[]): void { this.rec("drawFastHLine", ...a); }
    drawFastVLine(...a: number[]): void { this.rec("drawFastVLine", ...a); }
    drawLine(...a: number[]): void { this.rec("drawLine", ...a); }
    drawRoundRect(...a: number[]): void { this.rec("drawRoundRect", ...a); }
    fillRoundRect(...a: number[]): void { this.rec("fillRoundRect", ...a); }
    drawCircle(...a: number[]): void { this.rec("drawCircle", ...a); }
    fillCircle(...a: number[]): void { this.rec("fillCircle", ...a); }
    drawTriangle(...a: number[]): void { this.rec("drawTriangle", ...a); }
    fillTriangle(...a: number[]): void { this.rec("fillTriangle", ...a); }
    // text state
    setTextColor(fg: number, bg?: number): void { this.fg = fg; this.bg = bg ?? fg; }
    setTextSize(s: number): void { this.size = s; }
    setTextDatum(d: number): void { this.datum = d; }
    setTextWrap(): void {}
    setCursor(x: number, y: number): void { this.cx = x; this.cy = y; }
    getCursorX(): number { return this.cx; }
    getCursorY(): number { return this.cy; }
    print(v: string | number): void {
      const text = String(v);
      this.texts.push({ op: "print", text, x: this.cx, y: this.cy, size: this.size, fg: this.fg, bg: this.bg, datum: 0 });
      this.cx += text.length * 6 * this.size;
    }
    println(v: string | number = ""): void { this.print(v); this.cx = 0; this.cy += 8 * this.size; }
    drawString(text: string, x: number, y: number): number {
      this.texts.push({ op: "drawString", text, x, y, size: this.size, fg: this.fg, bg: this.bg, datum: this.datum });
      return text.length * 6 * this.size;
    }
    textWidth(s: string): number { return s.length * 6 * this.size; }
    fontHeight(): number { return 8 * this.size; }
  }
  return { FakeSprite };
});

const plat = vi.hoisted(() => ({
  now: 0,
  dev: { app: "Hermes Buddy", version: "0.1.0", os: "macos" },
}));
const st = vi.hoisted(() => ({
  stats: { napSeconds: 3900, pets: 12, level: 3, tokens: 123456, moodPoints: 3, lastMoodAt: 0 },
  settings: { sound: true, onTop: true, led: true, hud: true, clockRot: 0, bright: 4 },
  mood: 3,
  energy: 4,
  fed: 6,
  owner: "",
  pet: "Buddy",
}));
const PAL = vi.hoisted(() => ({ body: 0xd2c6, bg: 0x0000, text: 0xffff, textDim: 0x8410, ink: 0x0000 }));
const spies = vi.hoisted(() => ({
  wake: vi.fn(),
  buddyRenderTo: vi.fn(),
  characterRenderTo: vi.fn(),
  characterSetState: vi.fn(),
  push: vi.fn(),
  scenario: "hermes",
}));

vi.mock("../src/hw/tft", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/hw/tft")>();
  return { ...actual, Sprite: h.FakeSprite };
});
vi.mock("../src/hw/platform", () => ({
  millis: () => plat.now,
  deviceInfo: () => plat.dev,
}));
vi.mock("../src/stats", () => ({
  stats: () => st.stats,
  settings: () => st.settings,
  statsMoodTier: () => st.mood,
  statsEnergyTier: () => st.energy,
  statsFedProgress: () => st.fed,
  petName: () => st.pet,
  ownerName: () => st.owner,
}));
vi.mock("../src/character", () => ({
  characterPalette: () => PAL,
  characterLoaded: () => false,
  characterRenderTo: spies.characterRenderTo,
  characterSetState: spies.characterSetState,
}));
vi.mock("../src/buddy/buddy", () => ({ buddyRenderTo: spies.buddyRenderTo }));
vi.mock("../src/data/source", () => ({ dataScenarioName: () => spies.scenario }));
vi.mock("../src/app/loop", () => ({ wake: spies.wake }));

import { emptyTama, PersonaState, type TamaState } from "../src/data/types";
import type { Display } from "../src/hw/tft";
import { H, HOT, W, setDisplay, spr, sprLand, ui } from "../src/app/state";
import {
  clockDow, clockHour, clockUpdateOrient, drawAttention, drawClock, drawHUD, drawInfo, drawPet,
  drawSplash, wrapInto, wrapWords,
} from "../src/app/screens";

type Fake = InstanceType<typeof h.FakeSprite>;
const fake = spr as unknown as Fake;
const land = sprLand as unknown as Fake;

const GREEN = 0x07e0;
const RED = 0xf800;

const strs = (s: Fake): string[] => s.texts.map((t) => t.text);
const find = (s: Fake, text: string) => s.texts.find((t) => t.text === text);
const count = (s: Fake, op: string, pred: (a: number[]) => boolean = () => true): number =>
  s.calls.filter((c) => c.op === op && pred(c.args)).length;

// Every print() row must fit on the panel: a row that runs past the right edge would wrap in
// TFT_eSPI (cursor back to x=0, next line) and trash the layout.
function expectOnPanel(s: Fake, width = W, height = H): void {
  for (const t of s.texts) {
    if (t.op !== "print") continue;
    expect(t.x, `x of "${t.text}"`).toBeGreaterThanOrEqual(0);
    expect(t.x + t.text.length * 6 * t.size, `right edge of "${t.text}"`).toBeLessThanOrEqual(width);
    expect(t.y + 8 * t.size, `bottom edge of "${t.text}"`).toBeLessThanOrEqual(height);
  }
}

function setTama(over: Partial<TamaState>): void {
  ui.tama = { ...emptyTama(), ...over };
}

const LONG = "The quick brown fox jumps over the lazy dog while reading a very long Hermes transcript line today";
const eight = Array.from({ length: 8 }, (_, i) => `${i + 1}. ${LONG}`.slice(0, 91));

beforeEach(() => {
  plat.now += 100000;   // module-level clock/pet-tick throttles survive between tests
  plat.dev = { app: "Hermes Buddy", version: "0.1.0", os: "macos" };
  st.stats = { napSeconds: 3900, pets: 12, level: 3, tokens: 123456, moodPoints: 3, lastMoodAt: 0 };
  st.settings = { sound: true, onTop: true, led: true, hud: true, clockRot: 0, bright: 4 };
  st.mood = 3; st.energy = 4; st.fed = 6; st.owner = ""; st.pet = "Buddy";
  spies.scenario = "hermes";
  vi.clearAllMocks();
  setDisplay({ push: spies.push } as unknown as Display);
  setTama({ msg: "No Hermes connected" });
  ui.activeState = PersonaState.Idle;
  ui.buddyMode = true;
  ui.infoPage = 0;
  ui.petPage = 0;
  ui.msgScroll = 0;
  ui.hudMaxBack = 0;
  ui.lastLineGen = 0;
  ui.promptArrivedMs = 0;
  ui.clockOrient = 0;
  ui.paintedOrient = 0;
  ui.orientFrames = 0;
  fake.reset();
  land.reset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("wrapInto", () => {
  it("keeps a short line on one row", () => {
    expect(wrapInto("hello world", 32, 21)).toEqual(["hello world"]);
  });

  it("word-wraps with a leading space on continuation rows", () => {
    expect(wrapInto("one two three four five six seven", 32, 14)).toEqual([
      "one two three",
      " four five six",
      " seven",
    ]);
  });

  it("hard-breaks a long word; a long first word leaves an empty first row (firmware quirk)", () => {
    expect(wrapInto("a".repeat(30), 32, 21)).toEqual(["", ` ${"a".repeat(20)}`, ` ${"a".repeat(10)}`]);
    expect(wrapInto("hi " + "b".repeat(30), 32, 21)).toEqual(["hi", ` ${"b".repeat(20)}`, ` ${"b".repeat(10)}`]);
  });

  it("stops at maxRows and handles empty / blank input", () => {
    expect(wrapInto("aaa bbb ccc ddd", 2, 7)).toEqual(["aaa bbb", " ccc"]);
    expect(wrapInto("", 32, 21)).toEqual([]);
    expect(wrapInto("   ", 32, 21)).toEqual([]);
  });

  it("never emits a row wider than the width", () => {
    for (const row of wrapInto(LONG.repeat(4), 32, 21)) expect(row.length).toBeLessThanOrEqual(21);
  });
});

describe("wrapWords", () => {
  it("wraps greedily without a continuation indent", () => {
    expect(wrapWords("rm -rf node_modules && npm install --force", 21, 3)).toEqual(["rm -rf node_modules", "&& npm install", "--force"]);
    expect(wrapWords("Which database should I use?", 21, 2)).toEqual(["Which database should", "I use?"]);
  });

  it("cuts words longer than the row, from the first row on", () => {
    expect(wrapWords("/Users/someone/.hermes/state.db", 19, 4)).toEqual(["/Users/someone/.her", "mes/state.db"]);
    expect(wrapWords("ab " + "c".repeat(25), 10, 4)).toEqual(["ab", "cccccccccc", "cccccccccc", "ccccc"]);
  });

  it("honours maxRows and empty input", () => {
    expect(wrapWords("a b c d e f", 3, 2)).toEqual(["a b", "c d"]);
    expect(wrapWords("x".repeat(100), 10, 2)).toEqual(["x".repeat(10), "x".repeat(10)]);
    expect(wrapWords("", 21, 3)).toEqual([]);
    expect(wrapWords("   ", 21, 3)).toEqual([]);
  });
});

describe("clock", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 5, 7, 9, 5, 3));   // local: Sun Jun 07 09:05:03
  });

  it("clockUpdateOrient maps the setting: auto/portrait → 0, land → 1", () => {
    ui.orientFrames = 9;
    for (const [rot, want] of [[0, 0], [1, 0], [2, 1]] as const) {
      st.settings.clockRot = rot;
      clockUpdateOrient();
      expect(ui.clockOrient).toBe(want);
      expect(ui.orientFrames).toBe(0);
    }
    st.settings.clockRot = 1;
    clockUpdateOrient();
    expect(ui.clockOrient).toBe(0);
  });

  it("clockDow / clockHour read local time", () => {
    expect(clockDow()).toBe(new Date(2026, 5, 7).getDay());
    expect(clockHour()).toBe(9);
    vi.setSystemTime(new Date(2026, 5, 12, 23, 59, 0));
    expect(clockDow()).toBe(5);
    expect(clockHour()).toBe(23);
  });

  it("portrait clock draws time, seconds and date into spr, below the pet", () => {
    ui.clockOrient = 0;
    ui.paintedOrient = 1;
    drawClock();
    expect(ui.paintedOrient).toBe(0);
    expect(fake.calls[0]).toEqual({ op: "fillRect", args: [0, 90, W, H - 90, PAL.bg] });
    expect(find(fake, "09:05")).toMatchObject({ op: "drawString", x: 67, y: 140, size: 4, fg: PAL.text, bg: PAL.bg, datum: 4 });
    expect(find(fake, ":03")).toMatchObject({ x: 67, y: 175, size: 2, fg: PAL.textDim });
    expect(find(fake, "Jun 07")).toMatchObject({ x: 67, y: 200, size: 1 });
    expect(land.texts).toHaveLength(0);
    expect(spies.push).not.toHaveBeenCalled();
  });

  it("portrait clock follows the wall clock once a second has passed", () => {
    drawClock();
    vi.setSystemTime(new Date(2026, 5, 7, 9, 6, 4));
    plat.now += 400;
    fake.reset();
    drawClock();
    expect(find(fake, "09:05")).toBeDefined();   // 1Hz cache: still the old snapshot
    plat.now += 700;
    fake.reset();
    drawClock();
    expect(find(fake, "09:06")).toBeDefined();
    expect(find(fake, ":04")).toBeDefined();
  });

  it("landscape clock composes into sprLand and pushes it rotated", () => {
    ui.clockOrient = 1;
    ui.paintedOrient = 0;
    drawClock();
    expect(ui.paintedOrient).toBe(1);
    expect(land.calls[0]).toEqual({ op: "fillScreen", args: [PAL.bg] });
    expect(find(land, "09:05")).toMatchObject({ op: "drawString", x: 170, y: 42, size: 3, fg: PAL.text, bg: PAL.bg });
    expect(find(land, "03")).toMatchObject({ x: 170, y: 72, size: 2, fg: PAL.textDim });
    const wdl = `${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][new Date(2026, 5, 7).getDay()]} Jun 07`;
    expect(find(land, wdl)).toMatchObject({ x: 170, y: 102, size: 2 });
    // pet box cleared, then drawn onto the landscape surface
    expect(land.calls).toContainEqual({ op: "fillRect", args: [0, 0, 115, 90, PAL.bg] });
    expect(spies.buddyRenderTo).toHaveBeenCalledTimes(1);
    expect(spies.buddyRenderTo).toHaveBeenCalledWith(sprLand, PersonaState.Idle);
    expect(spies.push).toHaveBeenCalledTimes(1);
    expect(spies.push).toHaveBeenCalledWith(sprLand, 1);
    expect(fake.calls).toHaveLength(0);   // portrait sprite untouched
  });

  it("landscape repaints text once per second and the pet at 5 fps, but pushes every frame", () => {
    ui.clockOrient = 1;
    drawClock();
    land.reset();
    spies.buddyRenderTo.mockClear();
    plat.now += 50;                       // same second, pet not due
    drawClock();
    expect(land.texts).toHaveLength(0);
    expect(land.calls).toHaveLength(0);
    expect(spies.buddyRenderTo).not.toHaveBeenCalled();
    expect(spies.push).toHaveBeenCalledTimes(2);
    plat.now += 200;                      // pet due, still the same wall second
    drawClock();
    expect(land.texts).toHaveLength(0);
    expect(spies.buddyRenderTo).toHaveBeenCalledTimes(1);
    vi.setSystemTime(new Date(2026, 5, 7, 9, 5, 4));
    plat.now += 800;                      // cache refreshed, second changed
    drawClock();
    expect(find(land, "04")).toBeDefined();
    expect(land.calls.some((c) => c.op === "fillScreen")).toBe(false);   // no full repaint
  });

  it("re-entering landscape does a full repaint", () => {
    ui.clockOrient = 1;
    drawClock();
    ui.clockOrient = 0; ui.paintedOrient = 0;   // loop resets these when the clock closes
    drawClock();
    land.reset();
    ui.clockOrient = 1;
    drawClock();
    expect(land.calls[0]).toEqual({ op: "fillScreen", args: [PAL.bg] });
    expect(find(land, "09:05")).toBeDefined();
  });

  it("GIF characters render onto sprLand at (57,45)", () => {
    ui.clockOrient = 1;
    ui.buddyMode = false;
    ui.activeState = PersonaState.Heart;
    drawClock();
    expect(spies.characterSetState).toHaveBeenCalledWith(PersonaState.Heart);
    expect(spies.characterRenderTo).toHaveBeenCalledWith(sprLand, 57, 45);
    expect(spies.buddyRenderTo).not.toHaveBeenCalled();
    expect(land.calls.some((c) => c.op === "fillRect" && c.args[2] === 115)).toBe(false);
  });

  it("pads single-digit hours, minutes and day", () => {
    vi.setSystemTime(new Date(2026, 0, 2, 0, 0, 0));
    plat.now += 5000;
    drawClock();
    expect(find(fake, "00:00")).toBeDefined();
    expect(find(fake, ":00")).toBeDefined();
    expect(find(fake, "Jan 02")).toBeDefined();
  });
});

describe("splash", () => {
  it("says hello on first boot", () => {
    st.owner = "";
    drawSplash();
    expect(fake.calls[0]).toEqual({ op: "fillSprite", args: [PAL.bg] });
    expect(find(fake, "Hello!")).toMatchObject({ x: 67, y: 108, size: 2, fg: PAL.body, datum: 4 });
    expect(find(fake, "a buddy appears")).toMatchObject({ x: 67, y: 132, size: 1, fg: PAL.textDim });
  });

  it("greets the owner's pet by name", () => {
    st.owner = "Dan";
    st.pet = "Biscuit";
    drawSplash();
    expect(find(fake, "Dan's")).toMatchObject({ x: 67, y: 108, size: 2, fg: PAL.text });
    expect(find(fake, "Biscuit")).toMatchObject({ x: 67, y: 132, size: 2, fg: PAL.body });
    expect(find(fake, "Hello!")).toBeUndefined();
  });
});

describe("drawInfo", () => {
  const SECTIONS = ["ABOUT", "BUTTONS", "HERMES", "DEVICE", "DATABASE"];

  beforeEach(() => {
    plat.now = 3720000 + 500;   // 1h 02m uptime
    setTama({
      connected: true, sessionsTotal: 12, sessionsRunning: 2, sessionsWaiting: 1,
      tokensToday: 1234, tokensLifetime: 3_450_000, model: "claude-sonnet-4", msg: "editing screens.ts",
      dbPath: "/Users/someone/.hermes/state.db", schemaVersion: 13, polledAt: Date.now() - 5000,
    });
  });

  it.each(SECTIONS.map((s, i) => [i, s] as const))("page %i (%s): header, indicator, text, on panel", (page, section) => {
    ui.infoPage = page;
    drawInfo();
    expect(fake.calls[0]).toEqual({ op: "fillRect", args: [0, 70, W, H - 70, PAL.bg] });
    expect(fake.texts[0]).toMatchObject({ text: "Info", x: 4, y: 72, fg: PAL.text, bg: PAL.bg });
    expect(fake.texts[1]).toMatchObject({ text: `${page + 1}/6`, x: W - 28, y: 72, fg: PAL.textDim });
    expect(fake.texts[2]).toMatchObject({ text: section, x: 4, y: 84, fg: PAL.body });
    expect(fake.texts.length).toBeGreaterThan(8);
    expectOnPanel(fake);
  });

  it("ABOUT explains the pet and is watch-only", () => {
    ui.infoPage = 0;
    drawInfo();
    const all = strs(fake).join("\n");
    expect(all).toContain("Hermes");
    expect(all).toContain("sleep");
    expect(all).toContain("dance");
    expect(all).not.toMatch(/approve|deny/i);
  });

  it("BUTTONS lists the desktop controls and the old pet how-to", () => {
    ui.infoPage = 1;
    drawInfo();
    const all = strs(fake).join("\n");
    for (const w of ["Space", "Enter", "Esc/M", "P, click", "pet it", "MOOD", "FED", "50K tokens", "ENERGY", "minimize to nap"]) {
      expect(all).toContain(w);
    }
    expect(all).not.toMatch(/approve|deny/i);
  });

  it("HERMES shows sessions, state, tokens, model and the current message", () => {
    ui.infoPage = 2;
    ui.activeState = PersonaState.Attention;
    drawInfo();
    const t = strs(fake);
    expect(t).toContain("  sessions  12");
    expect(t).toContain("  running   2");
    expect(t).toContain("  waiting   1");
    expect(t).toContain("  state     attention");
    expect(t).toContain("  today     1.2K");
    expect(t).toContain("  lifetime  3.4M");
    expect(t).toContain("  claude-sonnet-4");
    expect(t).toContain("  editing screens.ts");
  });

  it("HERMES wraps a long message and survives no model", () => {
    ui.infoPage = 2;
    setTama({ model: "", msg: "a long running tool call output here" });
    drawInfo();
    expect(strs(fake)).toContain("  -");
    expect(strs(fake).filter((s) => s.startsWith("  a long") || s.startsWith("   ")).length).toBeGreaterThan(0);
    expectOnPanel(fake);
  });

  it("DEVICE shows app, version, os, uptime, brightness and always-on-top", () => {
    ui.infoPage = 3;
    st.owner = "Dan";
    drawInfo();
    const t = strs(fake);
    expect(find(fake, "v0.1.0")).toMatchObject({ size: 2, x: 4, fg: PAL.text });
    expect(t).toContain("  app    Hermes Buddy");
    expect(t).toContain("  os     macos");
    expect(t).toContain("  owner  Dan");
    expect(t).toContain("  uptime 1h 02m");
    expect(t).toContain("  bright 4/4");
    expect(t).toContain("  on top on");
    expectOnPanel(fake);
    st.settings.onTop = false;
    st.settings.bright = 1;
    fake.reset();
    drawInfo();
    expect(strs(fake)).toContain("  on top off");
    expect(strs(fake)).toContain("  bright 1/4");
  });

  it("DEVICE keeps long os/app strings on the panel", () => {
    ui.infoPage = 3;
    plat.dev = { app: "Hermes Buddy Pre-release", version: "10.22.333-beta.4", os: "Microsoft Windows 11 Pro 23H2" };
    drawInfo();
    expectOnPanel(fake);
  });

  it("DATABASE shows connection, wrapped path, schema, last poll and data source", () => {
    ui.infoPage = 4;
    const path = "/Users/someone/.hermes/state.db";
    drawInfo();
    expect(find(fake, "connected")).toMatchObject({ size: 2, fg: GREEN });
    const t = strs(fake);
    const rows = t.slice(t.indexOf("PATH") + 1, t.indexOf("  via       hermes"));
    expect(rows.length).toBe(2);
    expect(rows.map((r) => r.slice(2)).join("")).toBe(path);
    expect(t).toContain("  via       hermes");
    expect(t).toContain("  schema    13");
    expect(t).toContain("  last poll 5s");
    expect(t).not.toContain("ERROR");
  });

  it("DATABASE reports an error in red and offline when nothing has arrived", () => {
    ui.infoPage = 4;
    setTama({ connected: false, error: "state.db not found at /home/x/.hermes/state.db", dbPath: "", schemaVersion: null, polledAt: 0 });
    drawInfo();
    expect(find(fake, "error")).toMatchObject({ size: 2, fg: HOT });
    expect(find(fake, "ERROR")).toMatchObject({ fg: HOT });
    expect(strs(fake).join(" ")).toContain("state.db not found");
    expect(strs(fake).filter((x) => x.startsWith("  ")).join("")).toContain("te.db");   // 4 error rows: nothing cut
    expect(strs(fake)).toContain("  -");
    expect(strs(fake)).toContain("  schema    -");
    expect(strs(fake)).toContain("  last poll never");
    expectOnPanel(fake);

    fake.reset();
    setTama({ connected: false, error: null });
    drawInfo();
    expect(find(fake, "offline")).toMatchObject({ size: 2, fg: PAL.textDim });
  });

  it("DATABASE keeps a huge path, error and demo scenario on the panel", () => {
    ui.infoPage = 4;
    spies.scenario = "demo: celebrate (long name)";
    setTama({ connected: false, error: "unknown schema ".repeat(12), dbPath: "C:\\Users\\friend\\AppData\\Roaming\\hermes\\".repeat(4), schemaVersion: 99, polledAt: Date.now() });
    drawInfo();
    expectOnPanel(fake);
  });

  it("page 6 is just 'for v', centred in the info area", () => {
    ui.infoPage = 5;
    drawInfo();
    expect(fake.calls[0]).toEqual({ op: "fillRect", args: [0, 70, W, H - 70, PAL.bg] });
    expect(fake.texts).toEqual([
      expect.objectContaining({ text: "for v", x: Math.floor(W / 2), y: 70 + Math.floor((H - 70) / 2), fg: PAL.text }),
    ]);
    expectOnPanel(fake);
  });
});

describe("drawPet", () => {
  beforeEach(() => {
    setTama({ tokensToday: 1234 });
  });

  it("draws the stats page with pets, naps, tokens and the B hint", () => {
    drawPet();
    const t = strs(fake);
    expect(t).toContain("Buddy");
    expect(t).toContain("1/1");
    for (const w of ["mood", "fed", "energy", "Lv 3", "pets     12", "napped   1h05m", "tokens   123.4K", "today    1.2K", "B: pet me"]) {
      expect(t).toContain(w);
    }
    expect(t.join("\n")).not.toMatch(/approved|denied/);
    expect(find(fake, "Buddy")).toMatchObject({ x: 4, y: 72, fg: PAL.text });
    expect(find(fake, "1/1")).toMatchObject({ x: W - 28, y: 72, fg: PAL.textDim });
    expectOnPanel(fake);
  });

  it("shows the owner's pet and a later page counter", () => {
    st.owner = "Dan";
    st.pet = "Biscuit";
    drawPet();
    expect(strs(fake)).toContain("Dan's Biscuit");
  });

  it("draws the right number of hearts, pips and energy cells", () => {
    st.mood = 3; st.fed = 6; st.energy = 4;
    drawPet();
    expect(count(fake, "fillTriangle")).toBe(3);                          // filled hearts
    expect(count(fake, "drawLine")).toBe(2);                              // the one empty heart outline
    expect(count(fake, "fillCircle", (a) => a[3] === PAL.body)).toBe(6);  // fed pips
    expect(count(fake, "drawCircle", (a) => a[3] === PAL.textDim)).toBe(4);
    expect(count(fake, "fillRect", (a) => a[4] === 0x07ff)).toBe(4);      // energy ≥ 4 is cyan
    expect(count(fake, "drawRect", (a) => a[4] === PAL.textDim)).toBe(1);
    expect(fake.calls).toContainEqual({ op: "fillRoundRect", args: [6, 148, 42, 14, 3, PAL.body] });
  });

  it("picks heart and energy colors by tier", () => {
    st.mood = 2; st.energy = 1;
    drawPet();
    expect(count(fake, "fillTriangle", (a) => a[6] === HOT)).toBe(2);
    expect(count(fake, "fillRect", (a) => a[4] === HOT)).toBe(1);
    fake.reset();
    st.mood = 4; st.energy = 3;
    drawPet();
    expect(count(fake, "fillTriangle", (a) => a[6] === RED)).toBe(4);
    expect(count(fake, "fillRect", (a) => a[4] === 0xffe0)).toBe(3);
    fake.reset();
    st.mood = 0; st.fed = 0; st.energy = 0;
    drawPet();
    expect(count(fake, "fillTriangle")).toBe(0);
    expect(count(fake, "drawCircle", (a) => a[3] === PAL.textDim)).toBe(10 + 8);   // 10 fed + 8 heart circles
  });

  it("formats naps and token counts like the firmware", () => {
    st.stats = { ...st.stats, napSeconds: 7 * 3600 + 9 * 60 + 59, tokens: 999 };
    setTama({ tokensToday: 2_500_000 });
    drawPet();
    expect(strs(fake)).toContain("napped   7h09m");
    expect(strs(fake)).toContain("tokens   999");
    expect(strs(fake)).toContain("today    2.5M");
  });
});

describe("drawHUD", () => {
  const SHOW = 11;
  const AREA = SHOW * 8 + 4;
  const LINE_Y = (i: number) => H - AREA + 2 + i * 8;
  // 8 entries that wrap to 2 rows each: 16 rows, so 5 sit behind the 11-row window.
  const sixteen = Array.from({ length: 8 }, (_, i) => `${i} aaaa bbbb cccc dddd eeee`);

  it("prints the status message when the transcript is empty", () => {
    setTama({ msg: "No Hermes connected", nLines: 0, lines: [] });
    drawHUD();
    expect(fake.calls[0]).toEqual({ op: "fillRect", args: [0, H - AREA, W, AREA, PAL.bg] });
    expect(fake.texts).toEqual([
      expect.objectContaining({ text: "No Hermes connected", x: 4, y: H - 10, fg: PAL.text, bg: PAL.bg }),
    ]);
  });

  it("shows the newest eleven wrapped rows, newest bright and older dim", () => {
    setTama({ lines: eight, nLines: 8, lineGen: 0 });
    drawHUD();
    expect(fake.texts).toHaveLength(SHOW);
    fake.texts.forEach((t, i) => {
      expect(t.y).toBe(LINE_Y(i));
      expect(t.x).toBe(4);
      expect(t.text.length).toBeLessThanOrEqual(21);
    });
    // the newest entry's rows are bright and at the bottom; rows from older entries are dim
    const newestRows = wrapInto(eight[7], 32, 21).length;
    expect(fake.texts.slice(-newestRows).every((t) => t.fg === PAL.text)).toBe(true);
    expect(fake.texts.slice(0, SHOW - newestRows).every((t) => t.fg === PAL.textDim)).toBe(true);
    expect(fake.texts[SHOW - 1].text).toBe(wrapInto(eight[7], 32, 21).at(-1));
    expect(LINE_Y(0)).toBeGreaterThanOrEqual(144);   // clear of the 2x pet (lowest pixel y=142)
    expectOnPanel(fake);
  });

  it("dims rows from older entries when a short newest entry shares the window", () => {
    setTama({ lines: ["an older one", "the newest"], nLines: 2, lineGen: 0 });
    drawHUD();
    expect(fake.texts.map((t) => [t.text, t.fg])).toEqual([
      ["an older one", PAL.textDim],
      ["the newest", PAL.text],
    ]);
    expect(fake.texts[0].y).toBe(LINE_Y(0));
  });

  it("scrolls back through the transcript, dims everything and shows the offset", () => {
    setTama({ lines: eight, nLines: 8, lineGen: 0 });
    ui.msgScroll = 2;
    drawHUD();
    const rows = fake.texts.filter((t) => t.x === 4);   // the "-2" marker shares the last row's y
    expect(rows).toHaveLength(SHOW);
    expect(rows.every((t) => t.fg === PAL.textDim)).toBe(true);
    expect(find(fake, "-2")).toMatchObject({ x: W - 18, y: H - 10, fg: PAL.body });
    const bottom = fake.texts.map((t) => t.text);
    fake.reset();
    ui.msgScroll = 0;
    drawHUD();
    expect(fake.texts.map((t) => t.text)).not.toEqual(bottom.slice(0, SHOW));
  });

  it("clamps an over-scrolled offset to the oldest rows", () => {
    setTama({ lines: sixteen, nLines: 8, lineGen: 0 });
    ui.msgScroll = 30;
    drawHUD();
    expect(ui.msgScroll).toBe(5);
    const rows = fake.texts.filter((t) => t.x === 4).map((t) => t.text);
    expect(rows).toHaveLength(SHOW);
    expect(rows[0]).toBe(wrapInto(sixteen[0], 32, 21)[0]);
    expect(find(fake, "-5")).toBeDefined();
  });

  it("records how far back the transcript can scroll, so B can wrap at the oldest row", () => {
    setTama({ lines: sixteen, nLines: 8, lineGen: 0 });
    drawHUD();
    expect(ui.hudMaxBack).toBe(5);   // 16 rows, 11 shown
    setTama({ lines: ["a", "b"], nLines: 2, lineGen: 0 });
    drawHUD();
    expect(ui.hudMaxBack).toBe(0);   // everything fits: nothing behind the window
    setTama({ lines: eight, nLines: 8, lineGen: 0 });
    drawHUD();
    expect(ui.hudMaxBack).toBe(32 - SHOW);   // the 32-row buffer is full
    setTama({ msg: "No Hermes connected", nLines: 0, lines: [], lineGen: 0 });
    drawHUD();
    expect(ui.hudMaxBack).toBe(0);   // status line only
  });

  it("keeps the newest rows when the wrapped transcript is longer than the 32-row buffer", () => {
    const many = Array.from({ length: 8 }, (_, i) => `${i + 1} ${"word ".repeat(18)}`.trim().slice(0, 91));   // 5 rows each → 40
    setTama({ lines: many, nLines: 8, lineGen: 0 });
    drawHUD();
    expect(fake.texts).toHaveLength(SHOW);
    expect(fake.texts.slice(-5).every((t) => t.fg === PAL.text)).toBe(true);   // the newest entry's 5 rows
    expect(fake.texts[SHOW - 1].text).toBe(wrapInto(many[7], 32, 21).at(-1));
    fake.reset();
    ui.msgScroll = 99;
    drawHUD();
    expect(ui.msgScroll).toBe(32 - SHOW);
  });

  it("resets scroll and wakes the screen when the transcript changes", () => {
    setTama({ lines: eight, nLines: 8, lineGen: 5 });
    ui.msgScroll = 3;
    ui.lastLineGen = 4;
    drawHUD();
    expect(ui.msgScroll).toBe(0);
    expect(ui.lastLineGen).toBe(5);
    expect(spies.wake).toHaveBeenCalledTimes(1);
    ui.msgScroll = 2;
    drawHUD();
    expect(ui.msgScroll).toBe(2);
    expect(spies.wake).toHaveBeenCalledTimes(1);
  });

  it("hands over to the attention screen while a prompt is pending", () => {
    setTama({ lines: eight, nLines: 8, lineGen: 0, promptId: "call_1", promptTool: "terminal", promptHint: "rm -rf build" });
    ui.promptArrivedMs = plat.now - 13000;
    drawHUD();
    expect(strs(fake)).toContain("waiting 13s");
    expect(strs(fake)).toContain("terminal");
    expect(strs(fake)).toContain("answer in Hermes");
    expect(fake.texts.some((t) => t.text.includes("quick brown"))).toBe(false);
  });
});

describe("drawAttention", () => {
  beforeEach(() => {
    setTama({ promptId: "call_1", promptTool: "clarify", promptHint: "Which database should I use?" });
    ui.promptArrivedMs = plat.now - 3000;
  });

  it("draws the framed attention panel: wait time, tool, hint, footer", () => {
    drawAttention();
    expect(fake.calls[0]).toEqual({ op: "fillRect", args: [0, H - 78, W, 78, PAL.bg] });
    expect(fake.calls[1]).toEqual({ op: "drawFastHLine", args: [0, H - 78, W, PAL.textDim] });
    expect(find(fake, "waiting 3s")).toMatchObject({ x: 4, y: H - 74, size: 1, fg: PAL.textDim });
    expect(find(fake, "clarify")).toMatchObject({ x: 4, y: H - 64, size: 2, fg: PAL.text });
    expect(find(fake, "Which database should")).toMatchObject({ x: 4, y: H - 44, fg: PAL.textDim });
    expect(find(fake, "I use?")).toMatchObject({ x: 4, y: H - 36, fg: PAL.textDim });
    expect(find(fake, "answer in Hermes")).toMatchObject({ x: 4, y: H - 12 });
    expectOnPanel(fake);
  });

  it("is watch-only: no approve / deny hints", () => {
    drawAttention();
    expect(strs(fake).join("\n")).not.toMatch(/approve|deny|A:|B:/i);
  });

  it("turns the wait counter red after 10 s and floors it", () => {
    ui.promptArrivedMs = plat.now - 9999;
    drawAttention();
    expect(find(fake, "waiting 9s")).toMatchObject({ fg: PAL.textDim });
    fake.reset();
    ui.promptArrivedMs = plat.now - 65500;
    drawAttention();
    expect(find(fake, "waiting 65s")).toMatchObject({ fg: HOT });
  });

  it("never shows a negative wait", () => {
    ui.promptArrivedMs = plat.now + 5000;
    drawAttention();
    expect(find(fake, "waiting 0s")).toBeDefined();
  });

  it("uses a small tool name when it is longer than 10 chars", () => {
    setTama({ promptId: "x", promptTool: "browser_navigate", promptHint: "" });
    drawAttention();
    expect(find(fake, "browser_navigate")).toMatchObject({ size: 1, y: H - 60 });
    expect(fake.texts.filter((t) => t.y >= H - 44 && t.y < H - 12)).toHaveLength(0);   // empty hint draws nothing
    expectOnPanel(fake);
  });

  it("wraps a long hint over up to three 21-char rows above the footer", () => {
    setTama({ promptId: "x", promptTool: "terminal", promptHint: "rm -rf node_modules && npm install --force" });
    drawAttention();
    expect(find(fake, "rm -rf node_modules")).toMatchObject({ x: 4, y: H - 44 });
    expect(find(fake, "&& npm install")).toMatchObject({ x: 4, y: H - 36 });
    expect(find(fake, "--force")).toMatchObject({ x: 4, y: H - 28 });
    expectOnPanel(fake);
  });
});

describe("every screen draws without throwing", () => {
  it("covers the full matrix of states", () => {
    const states: Array<Partial<TamaState>> = [
      {},
      { connected: true, lines: eight, nLines: 8, lineGen: 3, sessionsRunning: 2, sessionsTotal: 5, tokensToday: 12_345_678, tokensLifetime: 4_000_000_000 },
      { connected: false, error: "unknown schema", dbPath: "x".repeat(200) },
      { promptId: "p", promptTool: "t".repeat(19), promptHint: "h".repeat(43) },
    ];
    for (const s of states) {
      setTama({ msg: "m".repeat(23), ...s });
      for (let page = 0; page < 6; page++) {
        ui.infoPage = page;
        for (const f of [drawInfo, drawPet, drawHUD, drawAttention, drawSplash, drawClock]) {
          fake.reset(); land.reset();
          expect(() => f()).not.toThrow();
          expect(fake.texts.length + land.texts.length).toBeGreaterThan(0);
        }
      }
    }
  });
});
