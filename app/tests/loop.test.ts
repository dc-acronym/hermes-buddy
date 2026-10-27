// loop.ts: derive table + scripted frame sequences with input/data/screens/buddy/
// character/platform/tft mocked, so the test only exercises loop.ts, menus.ts and stats.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PersonaState, emptyTama, type TamaState } from "../src/data/types";

// Shared, mutable test controls. vi.hoisted so the vi.mock factories can see them; it
// lives outside the module registry, so vi.resetModules() between tests doesn't touch it.
const h = vi.hoisted(() => {
  interface Btn { down: boolean; p: boolean; r: boolean; downAt: number }
  const btn = (): Btn => ({ down: false, p: false, r: false, downAt: 0 });
  return {
    now: 0,
    a: btn(),
    b: btn(),
    pwr: 0,
    tama: {} as Partial<TamaState>,
    demo: false,
    hour: 14,
    dow: 3,
    onOrient: null as null | (() => void),
    shakeCb: null as null | (() => void),
    napCb: null as null | ((n: boolean) => void),
    nextPetCb: null as null | (() => void),
    installedCb: null as null | ((p: unknown) => void),
    beeps: [] as [number, number][],
    leds: [] as boolean[],
    calls: [] as string[],
    buddyTicks: [] as number[],
    pushes: [] as { rotation: number | undefined }[],
    brightness: [] as number[],
    power: [] as boolean[],
    onTop: [] as boolean[],
    speciesIdx: 0,
    charOk: false,
    feedTokens: null as null | ((n: number) => void),
    reset() {
      this.now = 100000;
      this.a = btn(); this.b = btn(); this.pwr = 0;
      this.tama = {}; this.demo = false; this.hour = 14; this.dow = 3;
      this.onOrient = null; this.shakeCb = null; this.napCb = null; this.nextPetCb = null; this.installedCb = null;
      this.beeps = []; this.leds = []; this.calls = []; this.buddyTicks = [];
      this.pushes = []; this.brightness = []; this.power = []; this.onTop = [];
      this.speciesIdx = 0;
      this.charOk = false;
      this.feedTokens = null;
    },
  };
});

vi.mock("../src/hw/input", () => {
  const mk = (get: () => typeof h.a) => ({
    isPressed: () => get().down,
    wasPressed: () => get().p,
    wasReleased: () => get().r,
    pressedFor: (ms: number) => get().down && h.now - get().downAt >= ms,
  });
  return {
    BtnA: mk(() => h.a),
    BtnB: mk(() => h.b),
    inputUpdate: () => {},
    pwrGetBtnPress: () => { const v = h.pwr; h.pwr = 0; return v; },
  };
});

vi.mock("../src/hw/platform", () => ({
  millis: () => h.now,
  beep: (f: number, d: number) => { h.beeps.push([f, d]); },
  setLed: (on: boolean) => { h.leds.push(on); },
  setAlwaysOnTop: (on: boolean) => { h.onTop.push(on); },
  hideWindow: () => { h.calls.push("hideWindow"); },
  openDbSettings: () => { h.calls.push("openDbSettings"); },
  getCharacter: async () => null,
  deleteCharacter: async () => { h.calls.push("deleteCharacter"); },
  factoryReset: async () => { h.calls.push("factoryReset"); },
  loadJson: async (_n: string, fallback: unknown) => fallback,
  saveJson: () => {},
  onShake: (cb: () => void) => { h.shakeCb = cb; return () => {}; },
  onNapChange: (cb: (n: boolean) => void) => { h.napCb = cb; return () => {}; },
  onNextPet: (cb: () => void) => { h.nextPetCb = cb; return () => {}; },
  onCharacterInstalled: (cb: (p: unknown) => void) => { h.installedCb = cb; return () => {}; },
}));

vi.mock("../src/data/source", async () => {
  const { emptyTama } = await import("../src/data/types");
  return {
    // Each frame starts from an empty state, like a fresh snapshot replacing the last.
    // The real source.ts also feeds lifetime tokens to the pet when a snapshot is applied.
    dataPoll: (out: TamaState) => {
      Object.assign(out, emptyTama(), h.tama);
      if (h.tama.connected && !h.demo) h.feedTokens?.(out.tokensLifetime);
    },
    dataDemo: () => h.demo,
    dataSetDemo: (on: boolean) => { h.demo = on; h.calls.push(`dataSetDemo(${on})`); },
    dataConnected: () => !!h.tama.connected,
  };
});

vi.mock("../src/app/screens", () => {
  const rec = (n: string) => () => { h.calls.push(n); };
  return {
    drawInfo: rec("drawInfo"),
    drawPet: rec("drawPet"),
    drawHUD: rec("drawHUD"),
    drawAttention: rec("drawAttention"),
    drawClock: rec("drawClock"),
    drawSplash: rec("drawSplash"),
    clockUpdateOrient: () => { h.onOrient?.(); },
    clockDow: () => h.dow,
    clockHour: () => h.hour,
  };
});

vi.mock("../src/buddy/buddy", () => ({
  buddyInit: () => { h.calls.push("buddyInit"); },
  buddyTick: (s: number) => { h.buddyTicks.push(s); },
  buddyInvalidate: () => {},
  buddyRenderTo: () => {},
  buddySetSpeciesIdx: (i: number) => { h.speciesIdx = i; },
  buddyNextSpecies: () => { h.speciesIdx = (h.speciesIdx + 1) % 18; },
  buddySetPeek: (p: boolean) => { h.calls.push(`buddyPeek(${p})`); },
  buddySpeciesIdx: () => h.speciesIdx,
  buddySpeciesCount: () => 18,
  buddySpeciesName: () => "x",
}));

vi.mock("../src/character", () => ({
  characterInit: async () => h.charOk,
  characterLoaded: () => false,
  characterSetState: () => {},
  characterTick: () => {},
  characterInvalidate: () => {},
  characterClose: () => {},
  characterSetPeek: (p: boolean) => { h.calls.push(`characterPeek(${p})`); },
  characterRenderTo: () => {},
  characterPalette: () => ({ body: 0xd2c6, bg: 0x0000, text: 0xffff, textDim: 0x8410, ink: 0x0000 }),
}));

// state.ts builds two Sprites at import; the tft agent's real one is irrelevant here.
vi.mock("../src/hw/tft", () => {
  const ctl = h; // Sprite's own `h` (height) shadows the controls inside the class
  class Sprite {
    pixels: Uint16Array;
    constructor(public w: number, public h: number) {
      this.pixels = new Uint16Array(w * h);
      return new Proxy(this, {
        get(t, k, r) {
          if (k in t) return Reflect.get(t, k, r);
          if (k === "then" || typeof k === "symbol") return undefined;
          return () => { ctl.calls.push(`spr.${k}`); return 0; }; // drawing is a no-op, but recorded
        },
      });
    }
  }
  return { Sprite, Display: class {}, TFT_GREEN: 0x07e0 };
});

const fakeDisplay = {
  push: (_s: unknown, rotation?: number) => { h.pushes.push({ rotation }); },
  setBrightness: (v: number) => { h.brightness.push(v); },
  setPower: (on: boolean) => { h.power.push(on); },
};

const T0 = Date.UTC(2026, 5, 7, 12, 0, 0);

async function boot() {
  vi.resetModules();
  const state = await import("../src/app/state");
  const lp = await import("../src/app/loop");
  const stats = await import("../src/stats");
  state.setDisplay(fakeDisplay as never);
  h.feedTokens = stats.statsOnBridgeTokens; // what the real data source does per snapshot
  const done = lp.setup();
  await vi.advanceTimersByTimeAsync(1800);
  await done;
  return { state, lp, stats, ui: state.ui, DisplayMode: state.DisplayMode };
}

type Ev = "down" | "up" | undefined;
/** One loop() frame, `ms` after the previous, with the given button edges. */
function step(lp: { loop(): void }, ms = 16, ev: { a?: Ev; b?: Ev; pwr?: number } = {}) {
  h.now += ms;
  for (const [btn, e] of [[h.a, ev.a], [h.b, ev.b]] as const) {
    btn.p = e === "down";
    btn.r = e === "up";
    if (e === "down") { btn.down = true; btn.downAt = h.now; }
    if (e === "up") btn.down = false;
  }
  h.pwr = ev.pwr ?? 0;
  lp.loop();
}
function tap(lp: { loop(): void }, which: "a" | "b", heldMs = 96) {
  step(lp, 16, { [which]: "down" });
  for (let t = 16; t < heldMs; t += 16) step(lp);
  step(lp, 16, { [which]: "up" });
  step(lp);
}
function holdA(lp: { loop(): void }, ms: number) {
  step(lp, 16, { a: "down" });
  for (let t = 16; t < ms; t += 16) step(lp);
  step(lp, 16, { a: "up" });
  step(lp);
}
const called = (name: string) => h.calls.includes(name);
const count = (name: string) => h.calls.filter((c) => c === name).length;

beforeEach(() => {
  h.reset();
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});
afterEach(() => {
  vi.useRealTimers();
});

describe("derive", () => {
  const mk = (o: Partial<TamaState>): TamaState => ({ ...emptyTama(), ...o });

  it("maps snapshot fields to a persona state in priority order", async () => {
    vi.resetModules();
    const { derive } = await import("../src/app/loop");
    const P = PersonaState;
    const table: [Partial<TamaState>, PersonaState][] = [
      [{ connected: false }, P.Sleep],
      [{ connected: false, sessionsWaiting: 2, sessionsRunning: 3, recentlyCompleted: true }, P.Sleep],
      [{ connected: true }, P.Idle],
      [{ connected: true, sessionsTotal: 5 }, P.Idle],
      [{ connected: true, sessionsRunning: 1 }, P.Busy],
      [{ connected: true, sessionsRunning: 4 }, P.Busy],
      [{ connected: true, recentlyCompleted: true }, P.Celebrate],
      [{ connected: true, recentlyCompleted: true, sessionsRunning: 2 }, P.Celebrate],
      [{ connected: true, sessionsWaiting: 1 }, P.Attention],
      [{ connected: true, sessionsWaiting: 1, recentlyCompleted: true, sessionsRunning: 3 }, P.Attention],
    ];
    for (const [s, want] of table) expect(derive(mk(s)), JSON.stringify(s)).toBe(want);
  });
});

describe("setup", () => {
  it("applies saved settings, draws the splash and registers the platform hooks", async () => {
    const { ui } = await boot();
    expect(h.brightness).toContain(100); // bright 4 -> 20 + 4*20
    expect(h.onTop).toEqual([true]);
    expect(ui.buddyMode).toBe(true); // no GIF installed
    expect(ui.gifAvailable).toBe(false);
    expect(called("drawSplash")).toBe(true);
    expect(called("buddyInit")).toBe(true);
    expect(h.pushes.length).toBeGreaterThan(0);
    expect(h.shakeCb && h.napCb && h.nextPetCb && h.installedCb).toBeTruthy();
  });
});

describe("buttons and display modes", () => {
  it("A tap cycles normal -> pet -> info -> normal and draws each screen", async () => {
    const { lp, ui, DisplayMode } = await boot();
    h.tama = { connected: true, sessionsRunning: 1 };
    step(lp);
    expect(ui.displayMode).toBe(DisplayMode.Normal);
    expect(called("drawHUD")).toBe(true);
    expect(h.pushes.at(-1)).toEqual({ rotation: 0 });

    h.beeps = [];
    tap(lp, "a");
    expect(ui.displayMode).toBe(DisplayMode.Pet);
    expect(h.beeps).toContainEqual([1800, 30]);
    expect(called("drawPet")).toBe(true);
    tap(lp, "a");
    expect(ui.displayMode).toBe(DisplayMode.Info);
    expect(called("drawInfo")).toBe(true);
    tap(lp, "a");
    expect(ui.displayMode).toBe(DisplayMode.Normal);
  });

  it("B on the info screen pages through the six info pages", async () => {
    const { lp, ui } = await boot();
    h.tama = { connected: true, sessionsRunning: 1 };
    tap(lp, "a"); tap(lp, "a");
    expect(ui.infoPage).toBe(0);
    tap(lp, "b");
    expect(ui.infoPage).toBe(1);
    for (let i = 0; i < 5; i++) tap(lp, "b");
    expect(ui.infoPage).toBe(0); // wrapped after 6
  });

  it("B on the home screen scrolls the transcript", async () => {
    const { lp, ui } = await boot();
    h.tama = { connected: true, sessionsRunning: 1 };
    ui.hudMaxBack = 5;   // what drawHUD measured for the transcript (drawHUD is mocked here)
    tap(lp, "b");
    tap(lp, "b");
    expect(ui.msgScroll).toBe(2);
  });

  it("B wraps back to the newest line at the oldest row drawHUD measured, not only at 30", async () => {
    const { lp, ui } = await boot();
    h.tama = { connected: true, sessionsRunning: 1 };
    ui.hudMaxBack = 2;   // a 5-row transcript: three rows show, two more are behind them
    const seen: number[] = [];
    for (let i = 0; i < 5; i++) {
      tap(lp, "b");
      ui.msgScroll = Math.min(ui.msgScroll, ui.hudMaxBack);   // the clamp drawHUD applies each draw
      seen.push(ui.msgScroll);
    }
    expect(seen).toEqual([1, 2, 0, 1, 2]);
  });

  it("hold A opens the menu without cycling the screen; A/B drive it", async () => {
    const { lp, ui, DisplayMode } = await boot();
    h.tama = { connected: true, sessionsRunning: 1 };
    step(lp);
    h.beeps = [];
    h.calls = [];
    holdA(lp, 700);
    expect(ui.menuOpen).toBe(true);
    expect(ui.menuSel).toBe(0);
    expect(ui.displayMode).toBe(DisplayMode.Normal); // the release after a long press is swallowed
    expect(h.beeps).toContainEqual([800, 60]);
    expect(called("drawHUD")).toBe(true);
    step(lp);

    tap(lp, "a");
    tap(lp, "a");
    expect(ui.menuSel).toBe(2); // help
    tap(lp, "b");
    expect(ui.menuOpen).toBe(false);
    expect(ui.displayMode).toBe(DisplayMode.Info);
    expect(ui.infoPage).toBe(1); // INFO_PG_BUTTONS

    holdA(lp, 700);
    expect(ui.menuOpen).toBe(true);
    holdA(lp, 700);
    expect(ui.menuOpen).toBe(false); // hold again closes it
  });

  it("wipes the sprite when a panel closes or is replaced, so no ghost edge is left", async () => {
    const { lp, ui, stats } = await boot();
    h.tama = { connected: true, sessionsRunning: 1 };
    const wiped = (act: () => void) => {
      step(lp);
      h.calls = [];
      act();
      return h.calls.includes("spr.fillSprite");
    };
    holdA(lp, 700); // menu
    expect(wiped(() => holdA(lp, 700))).toBe(true); // hold A closes the menu

    holdA(lp, 700);
    for (let i = 0; i < 5; i++) tap(lp, "a");
    expect(ui.menuSel).toBe(5); // "close"
    expect(wiped(() => tap(lp, "b"))).toBe(true);
    expect(ui.menuOpen).toBe(false);

    holdA(lp, 700);
    tap(lp, "b"); // settings
    for (let i = 0; i < 5; i++) tap(lp, "a");
    expect(ui.settingsSel).toBe(5);
    expect(wiped(() => tap(lp, "b"))).toBe(true); // transcript off
    expect(stats.settings().hud).toBe(false);

    tap(lp, "a"); tap(lp, "a"); tap(lp, "a"); // -> reset
    expect(ui.settingsSel).toBe(8);
    expect(wiped(() => tap(lp, "b"))).toBe(true); // reset panel is shorter than settings
    expect(ui.resetOpen).toBe(true);

    tap(lp, "a"); tap(lp, "a"); // -> back
    tap(lp, "b");
    expect(ui.resetOpen).toBe(false);
    expect(ui.settingsOpen).toBe(true);
    expect(wiped(() => { holdA(lp, 700); })).toBe(true); // hold A leaves settings
    expect(ui.settingsOpen).toBe(false);
  });

  it("menu: turn off blanks the screen, demo toggles the data source", async () => {
    const { lp, ui } = await boot();
    h.tama = { connected: true, sessionsRunning: 1 };
    holdA(lp, 700);
    tap(lp, "a"); // -> turn off
    tap(lp, "b");
    expect(ui.screenOff).toBe(true);
    expect(h.power.at(-1)).toBe(false);
    expect(ui.menuOpen).toBe(false);

    step(lp, 16, { pwr: 0x02 });
    expect(ui.screenOff).toBe(false);
    expect(h.power.at(-1)).toBe(true);

    holdA(lp, 700);
    for (let i = 0; i < 4; i++) tap(lp, "a"); // -> demo
    expect(ui.menuSel).toBe(4);
    tap(lp, "b");
    expect(h.calls).toContain("dataSetDemo(true)");
  });

  it("settings: hermes opens the db overlay, on top toggles, brightness cycles and persists", async () => {
    const { lp, ui, stats } = await boot();
    h.tama = { connected: true, sessionsRunning: 1 };
    holdA(lp, 700);
    tap(lp, "b"); // menu item 0 -> settings
    expect(ui.settingsOpen).toBe(true);
    expect(ui.menuOpen).toBe(false);
    expect(called("drawHUD")).toBe(true);

    // brightness (row 0): 4 -> 0, screen at 20
    tap(lp, "b");
    expect(ui.brightLevel).toBe(0);
    expect(stats.settings().bright).toBe(0);
    expect(h.brightness.at(-1)).toBe(20);
    tap(lp, "b");
    expect(ui.brightLevel).toBe(1);
    expect(h.brightness.at(-1)).toBe(40);

    tap(lp, "a"); // sound
    tap(lp, "b");
    expect(stats.settings().sound).toBe(false);
    h.beeps = [];
    tap(lp, "a"); // hermes
    tap(lp, "b");
    expect(h.calls).toContain("openDbSettings");
    expect(h.beeps).toEqual([]); // sound is off now, nothing beeped

    tap(lp, "a"); // on top
    tap(lp, "b");
    expect(stats.settings().onTop).toBe(false);
    expect(h.onTop.at(-1)).toBe(false);

    // back (row 9)
    for (let i = 0; i < 6; i++) tap(lp, "a");
    expect(ui.settingsSel).toBe(9);
    tap(lp, "b");
    expect(ui.settingsOpen).toBe(false);
  });

  it("reset menu is tap-twice: first B arms, second B within 3 s runs it", async () => {
    const { lp, ui } = await boot();
    h.tama = { connected: true, sessionsRunning: 1 };
    holdA(lp, 700);
    tap(lp, "b"); // settings
    for (let i = 0; i < 8; i++) tap(lp, "a");
    expect(ui.settingsSel).toBe(8);
    tap(lp, "b"); // reset
    expect(ui.resetOpen).toBe(true);

    h.calls = [];
    tap(lp, "b"); // arms "delete char"
    expect(ui.resetConfirmIdx).toBe(0);
    expect(h.calls).not.toContain("deleteCharacter");
    tap(lp, "b"); // confirms
    await vi.advanceTimersByTimeAsync(0);
    expect(h.calls).toContain("deleteCharacter");
    expect(ui.buddyMode).toBe(true);
    expect(ui.gifAvailable).toBe(false);
    expect(ui.resetOpen).toBe(false);
  });

  it("reset menu: scrolling away or waiting out 3 s disarms", async () => {
    const { lp, ui } = await boot();
    h.tama = { connected: true, sessionsRunning: 1 };
    holdA(lp, 700);
    tap(lp, "b");
    for (let i = 0; i < 8; i++) tap(lp, "a");
    tap(lp, "b"); // reset menu
    h.calls = [];
    tap(lp, "b"); // arm delete char
    step(lp, 3200); // the arm times out
    tap(lp, "b"); // so this only re-arms
    await vi.advanceTimersByTimeAsync(0);
    expect(h.calls).not.toContain("deleteCharacter");
    tap(lp, "a"); // scrolling clears the arm
    expect(ui.resetConfirmIdx).toBe(0xff);
  });
});

describe("pet screen: B pets the buddy", () => {
  it("raises mood once per 60 s but hearts and beeps on every press", async () => {
    const { lp, ui, stats } = await boot();
    vi.setSystemTime(T0); // boot() burned 1.8 s of fake time on the splash
    h.tama = { connected: true, sessionsRunning: 1 };
    tap(lp, "a"); // -> pet screen
    expect(ui.displayMode).toBe(1);
    expect(stats.statsMoodTier()).toBe(2);

    h.beeps = [];
    step(lp, 16, { b: "down" });
    expect(ui.activeState).toBe(PersonaState.Heart);
    expect(h.beeps).toContainEqual([2400, 30]);
    expect(stats.stats().pets).toBe(1);
    expect(stats.statsMoodTier()).toBe(3);
    step(lp, 16, { b: "up" });

    // a few seconds later: another pet, another heart, no extra mood
    vi.setSystemTime(T0 + 5000);
    h.beeps = [];
    step(lp, 2500, { b: "down" });
    step(lp, 16, { b: "up" });
    expect(stats.stats().pets).toBe(2);
    expect(stats.statsMoodTier()).toBe(3);
    expect(h.beeps).toContainEqual([2400, 30]);
    expect(ui.activeState).toBe(PersonaState.Heart);

    // heart lasts 2 s, then back to the derived state
    step(lp, 2100);
    expect(ui.activeState).toBe(PersonaState.Busy);

    // past the 60 s window: mood goes up again
    vi.setSystemTime(T0 + 61_000);
    step(lp, 16, { b: "down" });
    step(lp, 16, { b: "up" });
    expect(stats.stats().pets).toBe(3);
    expect(stats.statsMoodTier()).toBe(4);

    // and pressing right after does not
    vi.setSystemTime(T0 + 62_000);
    step(lp, 16, { b: "down" });
    step(lp, 16, { b: "up" });
    expect(stats.stats().pets).toBe(4);
    expect(stats.statsMoodTier()).toBe(4);
    expect(stats.stats().lastMoodAt).toBe(T0 + 61_000);
  });

  it("B does not pet on the home or info screens", async () => {
    const { lp, stats } = await boot();
    h.tama = { connected: true, sessionsRunning: 1 };
    tap(lp, "b"); // home
    tap(lp, "a"); tap(lp, "a"); // info
    tap(lp, "b");
    expect(stats.stats().pets).toBe(0);
  });
});

describe("power button and wake swallow", () => {
  it("short press toggles the screen, long press hides the window", async () => {
    const { lp, ui } = await boot();
    h.tama = { connected: true, sessionsRunning: 1 };
    step(lp, 16, { pwr: 0x02 });
    expect(ui.screenOff).toBe(true);
    expect(h.power.at(-1)).toBe(false);
    const pushes = h.pushes.length;
    step(lp); step(lp);
    expect(h.pushes.length).toBe(pushes); // nothing is drawn while off
    step(lp, 16, { pwr: 0x02 });
    expect(ui.screenOff).toBe(false);
    expect(h.power.at(-1)).toBe(true);

    h.calls = [];
    step(lp, 16, { pwr: 0x01 });
    expect(h.calls).toContain("hideWindow");
  });

  it("the press that wakes a dark screen does not also act (tap or long press)", async () => {
    const { lp, ui, DisplayMode } = await boot();
    h.tama = { connected: true, sessionsRunning: 1 };
    step(lp, 16, { pwr: 0x02 });
    expect(ui.screenOff).toBe(true);

    tap(lp, "a");
    expect(ui.screenOff).toBe(false);
    expect(ui.displayMode).toBe(DisplayMode.Normal);

    step(lp, 16, { pwr: 0x02 });
    holdA(lp, 900);
    expect(ui.screenOff).toBe(false);
    expect(ui.menuOpen).toBe(false);

    // and B wakes without scrolling
    step(lp, 16, { pwr: 0x02 });
    tap(lp, "b");
    expect(ui.screenOff).toBe(false);
    expect(ui.msgScroll).toBe(0);

    // the next A tap works normally again
    tap(lp, "a");
    expect(ui.displayMode).toBe(DisplayMode.Pet);
  });

  it("holds the persona asleep for 12 s after waking, unless something urgent is up", async () => {
    const { lp, ui } = await boot();
    h.tama = { connected: true }; // idle, no sessions
    h.hour = 14;
    step(lp, 16, { pwr: 0x02 }); // off
    step(lp, 16, { pwr: 0x02 }); // on: wake() starts the 12 s window
    step(lp);
    expect(ui.baseState).toBe(PersonaState.Sleep);
    step(lp, 11_000);
    expect(ui.baseState).toBe(PersonaState.Sleep);
    h.tama = { connected: true, sessionsRunning: 1 };
    step(lp);
    expect(ui.baseState).toBe(PersonaState.Busy); // urgent states aren't held back
    h.tama = { connected: true };
    step(lp, 1100);
    expect(ui.baseState).toBe(PersonaState.Idle);
  });
});

describe("shake and nap", () => {
  it("a shake becomes a 2 s dizzy one-shot", async () => {
    const { lp, ui } = await boot();
    h.tama = { connected: true, sessionsRunning: 1 };
    step(lp);
    h.shakeCb!();
    expect(ui.shakePending).toBe(true);
    step(lp, 60);
    expect(ui.shakePending).toBe(false);
    expect(ui.activeState).toBe(PersonaState.Dizzy);
    step(lp, 1900);
    expect(ui.activeState).toBe(PersonaState.Dizzy);
    step(lp, 200);
    expect(ui.activeState).toBe(PersonaState.Busy);
  });

  it("a shake with a menu open is dropped, not saved for later", async () => {
    const { lp, ui } = await boot();
    h.tama = { connected: true, sessionsRunning: 1 };
    holdA(lp, 700);
    expect(ui.menuOpen).toBe(true);
    h.shakeCb!();
    step(lp, 60);
    expect(ui.activeState).toBe(PersonaState.Busy);
    holdA(lp, 700); // close the menu
    step(lp, 200);
    expect(ui.menuOpen).toBe(false);
    expect(ui.activeState).toBe(PersonaState.Busy);
  });

  it("minimizing naps (dim, no drawing); restoring credits sleep time and refills energy", async () => {
    const { lp, ui, stats } = await boot();
    h.tama = { connected: true, sessionsRunning: 1 };
    step(lp);
    expect(stats.statsEnergyTier()).toBe(3);

    h.napCb!(true);
    expect(ui.napping).toBe(true);
    expect(ui.dimmed).toBe(true);
    expect(h.brightness.at(-1)).toBe(8);
    const pushes = h.pushes.length;
    const ticks = h.buddyTicks.length;
    step(lp); step(lp, 60_000);
    expect(h.pushes.length).toBe(pushes);
    expect(h.buddyTicks.length).toBe(ticks);

    step(lp, 64_000); // 125 s asleep in total
    h.napCb!(false);
    expect(ui.napping).toBe(false);
    expect(ui.dimmed).toBe(false);
    expect(h.brightness.at(-1)).toBe(100);
    expect(stats.stats().napSeconds).toBe(124);
    expect(stats.statsEnergyTier()).toBe(5);
    step(lp);
    expect(h.pushes.length).toBeGreaterThan(pushes);
  });

  it("a repeated nap event does not double count", async () => {
    const { ui, stats } = await boot();
    h.napCb!(false); // restore without a minimize first
    expect(stats.stats().napSeconds).toBe(0);
    h.napCb!(true);
    h.napCb!(true);
    expect(ui.napping).toBe(true);
  });
});

describe("prompt arrival (watch-only)", () => {
  it("beeps, jumps home and closes menus; A and B keep their normal jobs", async () => {
    const { lp, ui, DisplayMode } = await boot();
    h.tama = { connected: true, sessionsRunning: 1 };
    tap(lp, "a"); tap(lp, "a");
    expect(ui.displayMode).toBe(DisplayMode.Info);

    h.beeps = [];
    h.tama = {
      connected: true, sessionsRunning: 1, sessionsWaiting: 1,
      promptId: "call_1", promptTool: "terminal", promptHint: "rm -rf build",
    };
    step(lp);
    expect(h.beeps).toContainEqual([1200, 80]);
    expect(ui.displayMode).toBe(DisplayMode.Normal);
    expect(ui.promptArrivedMs).toBe(h.now);
    expect(ui.lastPromptId).toBe("call_1");
    expect(ui.baseState).toBe(PersonaState.Attention);
    expect(ui.activeState).toBe(PersonaState.Attention);
    expect(called("drawHUD")).toBe(true);

    // no second chirp on later frames
    h.beeps = [];
    step(lp); step(lp);
    expect(h.beeps).toEqual([]);

    // A does not approve, it cycles screens; B scrolls instead of denying
    tap(lp, "a");
    expect(ui.displayMode).toBe(DisplayMode.Pet);
    tap(lp, "a"); tap(lp, "a");
    expect(ui.displayMode).toBe(DisplayMode.Normal);
    ui.hudMaxBack = 3;   // left by the last drawHUD pass before the prompt took the strip
    tap(lp, "b");
    expect(ui.msgScroll).toBe(1);
  });

  it("closes an open menu when a prompt arrives", async () => {
    const { lp, ui } = await boot();
    h.tama = { connected: true, sessionsRunning: 1 };
    holdA(lp, 700);
    expect(ui.menuOpen).toBe(true);
    h.tama = { connected: true, sessionsWaiting: 1, promptId: "x", promptTool: "clarify", promptHint: "?" };
    step(lp);
    expect(ui.menuOpen).toBe(false);
  });

  it("wipes the attention panel when the prompt is answered elsewhere", async () => {
    const { lp } = await boot();
    h.tama = { connected: true, sessionsWaiting: 1, promptId: "x", promptTool: "terminal", promptHint: "ls" };
    step(lp);
    step(lp);
    h.calls = [];
    h.tama = { connected: true, sessionsRunning: 1 };
    step(lp);
    expect(h.calls).toContain("spr.fillSprite");
  });

  it("blinks the LED at 400 ms while attention, only if the led setting is on", async () => {
    const { lp, stats } = await boot();
    h.tama = { connected: true, sessionsWaiting: 1, promptId: "x", promptTool: "clarify", promptHint: "?" };
    h.now = 100000;
    h.leds = [];
    step(lp, 0);   // 100000 / 400 = 250 -> off
    step(lp, 400); // 251 -> on
    step(lp, 400); // 252 -> off
    step(lp, 400); // 253 -> on
    expect(h.leds).toEqual([false, true, false, true]);

    stats.settings().led = false;
    h.leds = [];
    step(lp, 400);
    step(lp, 400);
    expect(h.leds).toEqual([false, false]);
  });

  it("LED stays off when nothing needs attention", async () => {
    const { lp } = await boot();
    h.tama = { connected: true, sessionsRunning: 2 };
    h.leds = [];
    for (let i = 0; i < 5; i++) step(lp, 400);
    expect(h.leds.every((l) => l === false)).toBe(true);
  });
});

describe("clock face", () => {
  it("takes over the home screen when idle, and yields to sessions, overlays and other screens", async () => {
    const { lp, ui } = await boot();
    h.tama = { connected: true };
    h.calls = [];
    step(lp);
    expect(called("drawClock")).toBe(true);
    expect(called("drawHUD")).toBe(false);
    expect(h.calls).toContain("characterPeek(true)");
    expect(h.calls).toContain("buddyPeek(true)");
    expect(h.pushes.at(-1)).toEqual({ rotation: 0 });

    h.calls = [];
    h.tama = { connected: true, sessionsRunning: 1 };
    step(lp);
    expect(called("drawClock")).toBe(false);
    expect(called("drawHUD")).toBe(true);

    h.tama = { connected: true };
    step(lp);
    holdA(lp, 700); // menu over the idle screen
    expect(ui.menuOpen).toBe(true);
    h.calls = [];
    step(lp);
    expect(called("drawClock")).toBe(false);
    expect(called("drawHUD")).toBe(true);
    holdA(lp, 700);
    expect(ui.menuOpen).toBe(false);

    tap(lp, "a"); // pet screen
    expect(ui.displayMode).toBe(1);
    h.calls = [];
    step(lp);
    expect(called("drawClock")).toBe(false);
    expect(called("drawPet")).toBe(true);
  });

  it("stays off the clock when Hermes is not connected, so the 'No Hermes' status is visible", async () => {
    const { lp } = await boot();
    h.tama = { connected: false };
    h.calls = [];
    step(lp);
    expect(called("drawClock")).toBe(false);
    expect(called("drawHUD")).toBe(true);

    h.tama = { connected: true };   // connected and idle: the clock is back
    h.calls = [];
    step(lp);
    expect(called("drawClock")).toBe(true);
    expect(called("drawHUD")).toBe(false);

    h.tama = { connected: false };   // the feed drops again: back to the home screen
    h.calls = [];
    step(lp);
    expect(called("drawClock")).toBe(false);
    expect(called("drawHUD")).toBe(true);
  });

  it("picks the persona from the time-of-day schedule", async () => {
    const { lp, ui } = await boot();
    h.tama = { connected: true };
    const at = (now: number, hour: number, dow: number): PersonaState => {
      h.hour = hour; h.dow = dow;
      h.now = now - 16;
      step(lp);
      return ui.activeState;
    };
    const P = PersonaState;
    expect(at(112000, 3, 2)).toBe(P.Sleep); // 1-7am: asleep
    expect(at(144000, 14, 6)).toBe(P.Heart); // weekend: 144000/8000 = 18 -> %6 == 0
    expect(at(152000, 14, 0)).toBe(P.Sleep); // 19 %6 != 0
    expect(at(108000, 8, 2)).toBe(P.Sleep); // early weekday: 108000/6000 = 18 -> %4 = 2
    expect(at(120000, 8, 2)).toBe(P.Idle); // 20 %4 == 0
    expect(at(105000, 12, 2)).toBe(P.Heart); // lunch: 21 %3 == 0
    expect(at(112000, 12, 2)).toBe(P.Idle); // 22 %3 != 0
    expect(at(108000, 16, 5)).toBe(P.Celebrate); // friday after 3pm: 27 %3 == 0
    expect(at(112000, 16, 5)).toBe(P.Idle); // 28 %3 != 0
    expect(at(105000, 23, 2)).toBe(P.Dizzy); // late: 15 %3 == 0
    expect(at(112000, 23, 2)).toBe(P.Sleep); // 16 %3 != 0
    expect(at(150000, 10, 2)).toBe(P.Sleep); // otherwise: 15 %5 == 0 -> a nap
    expect(at(110000, 10, 2)).toBe(P.Idle);
  });

  it("a shake still shows dizzy on the clock face", async () => {
    const { lp, ui } = await boot();
    h.tama = { connected: true };
    h.hour = 10; h.dow = 2;
    h.now = 110000;
    step(lp);
    expect(ui.activeState).toBe(PersonaState.Idle);
    h.shakeCb!();
    step(lp, 60);
    expect(ui.activeState).toBe(PersonaState.Dizzy);
    step(lp, 1000);
    expect(ui.activeState).toBe(PersonaState.Dizzy);
    step(lp, 1100);
    expect(ui.activeState).not.toBe(PersonaState.Dizzy);
  });

  it("landscape clock skips the pet and the portrait push (drawClock pushes its own sprite)", async () => {
    const { lp, ui } = await boot();
    h.tama = { connected: true };
    h.onOrient = () => { ui.clockOrient = 1; };
    step(lp);
    h.calls = [];
    h.buddyTicks = [];
    const pushes = h.pushes.length;
    step(lp);
    expect(called("drawClock")).toBe(true);
    expect(h.buddyTicks).toEqual([]);
    expect(h.pushes.length).toBe(pushes);

    // sessions start running -> orientation resets and the portrait path is back
    h.tama = { connected: true, sessionsRunning: 1 };
    step(lp);
    expect(ui.clockOrient).toBe(0);
    expect(h.buddyTicks.length).toBeGreaterThan(0);
    expect(h.pushes.length).toBe(pushes + 1);
  });

  it("installing a GIF character while the clock is up keeps the pet peeking", async () => {
    const { lp } = await boot();
    h.tama = { connected: true };
    step(lp);
    expect(called("drawClock")).toBe(true);
    h.calls = [];
    h.charOk = true;
    h.installedCb!({ name: "bufo" });
    await vi.advanceTimersByTimeAsync(0);
    step(lp);
    expect(called("drawClock")).toBe(true);
    // applyDisplayMode() cleared peek for the new character; the clock frame must put it back,
    // or the 2x pet draws into the clock's band
    const last = (prefix: string) => h.calls.filter((c) => c.startsWith(prefix)).at(-1);
    expect(last("characterPeek")).toBe("characterPeek(true)");
    expect(last("buddyPeek")).toBe("buddyPeek(true)");
  });
});

describe("render dispatch", () => {
  it("ticks the ASCII buddy with the active state and pushes the portrait sprite each frame", async () => {
    const { lp } = await boot();
    h.tama = { connected: true, sessionsRunning: 1 };
    const before = h.pushes.length;
    step(lp); step(lp); step(lp);
    expect(h.buddyTicks.slice(-3)).toEqual([PersonaState.Busy, PersonaState.Busy, PersonaState.Busy]);
    expect(h.pushes.length).toBe(before + 3);
  });

  it("draws nothing for the transcript when the hud setting is off", async () => {
    const { lp, stats } = await boot();
    h.tama = { connected: true, sessionsRunning: 1 };
    stats.settings().hud = false;
    h.calls = [];
    step(lp);
    expect(called("drawHUD")).toBe(false);
  });

  it("in GIF mode with nothing loaded it does not tick the ASCII pet", async () => {
    const { lp, ui } = await boot();
    h.tama = { connected: true, sessionsRunning: 1 };
    ui.buddyMode = false; // GIF mode, but characterLoaded() is false
    h.buddyTicks = [];
    step(lp);
    expect(h.buddyTicks).toEqual([]);
    expect(h.pushes.at(-1)).toEqual({ rotation: 0 }); // the "no character loaded" text still goes out
  });
});

describe("level-up and pets", () => {
  it("celebrates a level-up for 3 s", async () => {
    const { lp, ui, stats } = await boot();
    h.tama = { connected: true, sessionsRunning: 1, tokensLifetime: 1_000_000 };
    step(lp); // first sight: latched, nothing credited
    expect(stats.stats().tokens).toBe(0);
    h.tama = { connected: true, sessionsRunning: 1, tokensLifetime: 1_020_000 };
    step(lp);
    expect(stats.stats().tokens).toBe(20_000);
    expect(ui.activeState).toBe(PersonaState.Busy);
    h.tama = { connected: true, sessionsRunning: 1, tokensLifetime: 1_055_000 };
    step(lp);
    expect(stats.stats().level).toBe(1);
    expect(ui.activeState).toBe(PersonaState.Celebrate);
    step(lp, 2900);
    expect(ui.activeState).toBe(PersonaState.Celebrate);
    step(lp, 200);
    expect(ui.activeState).toBe(PersonaState.Busy);
  });

  it("tray 'next pet' cycles the ASCII species", async () => {
    const { ui, stats } = await boot();
    h.nextPetCb!();
    expect(h.speciesIdx).toBe(1);
    expect(ui.buddyMode).toBe(true);
    ui.gifAvailable = true;
    h.speciesIdx = 17; // last species with a GIF installed -> GIF
    h.nextPetCb!();
    expect(ui.buddyMode).toBe(false);
    expect(stats.speciesIdxLoad()).toBe(0xff);
    h.nextPetCb!(); // GIF -> species 0
    expect(ui.buddyMode).toBe(true);
    expect(h.speciesIdx).toBe(0);
    expect(stats.speciesIdxLoad()).toBe(0);
  });

  it("a dropped-in character pack switches to the GIF; a bad pack changes nothing", async () => {
    const { lp, ui, stats } = await boot();
    h.tama = { connected: true, sessionsRunning: 1 };
    h.charOk = false;
    h.installedCb!({ name: "bad" });
    await vi.advanceTimersByTimeAsync(0);
    expect(ui.buddyMode).toBe(true);
    expect(ui.gifAvailable).toBe(false);

    h.charOk = true;
    h.installedCb!({ name: "bufo" });
    await vi.advanceTimersByTimeAsync(0);
    expect(ui.gifAvailable).toBe(true);
    expect(ui.buddyMode).toBe(false);
    expect(stats.speciesIdxLoad()).toBe(0xff);
    h.buddyTicks = [];
    step(lp);
    expect(h.buddyTicks).toEqual([]); // GIF path now (characterLoaded mock is still false -> text)
  });
});
