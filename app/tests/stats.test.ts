// stats.ts: token latch + level-up, petting mood (rate limit, wall-clock decay),
// energy on millis(), settings defaults, debounced persistence.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Keep the real millis()/setMillisSource, replace persistence with an in-memory store.
const store: Record<string, unknown> = {};
vi.mock("../src/hw/platform", async (orig) => {
  const actual = await orig<typeof import("../src/hw/platform")>();
  return {
    ...actual,
    loadJson: vi.fn(async (name: string, fallback: unknown) => (name in store ? structuredClone(store[name]) : fallback)),
    saveJson: vi.fn((name: string, value: unknown) => { store[name] = structuredClone(value); }),
  };
});

const HOUR = 3600000;
const T0 = Date.UTC(2026, 5, 7, 12, 0, 0);

async function fresh() {
  vi.resetModules();
  const platform = await import("../src/hw/platform");
  const st = await import("../src/stats");
  return { platform, st };
}

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});
afterEach(() => {
  vi.useRealTimers();
});

describe("defaults before load", () => {
  it("stats() and settings() work without loading", async () => {
    const { st } = await fresh();
    expect(st.stats()).toEqual({ napSeconds: 0, pets: 0, level: 0, tokens: 0, moodPoints: 2, lastMoodAt: 0 });
    expect(st.settings()).toEqual({ sound: true, onTop: true, led: true, hud: true, clockRot: 0, bright: 4 });
    expect(st.statsMoodTier()).toBe(2);
    expect(st.statsEnergyTier()).toBe(3);
    expect(st.statsFedProgress()).toBe(0);
    expect(st.petName()).toBe("Buddy");
    expect(st.ownerName()).toBe("");
    expect(st.speciesIdxLoad()).toBe(0xff);
  });
});

describe("bridge tokens", () => {
  it("latches on first sight, then credits only deltas", async () => {
    const { st } = await fresh();
    st.statsOnBridgeTokens(9_000_000); // Hermes already has a long history
    expect(st.stats().tokens).toBe(0);
    expect(st.stats().level).toBe(0);
    st.statsOnBridgeTokens(9_000_000); // no change
    expect(st.stats().tokens).toBe(0);
    st.statsOnBridgeTokens(9_012_000);
    expect(st.stats().tokens).toBe(12_000);
    expect(st.statsPollLevelUp()).toBe(false);
  });

  it("level-up fires once at 50K and feeds the fed bar", async () => {
    const { st } = await fresh();
    st.statsOnBridgeTokens(1000);
    st.statsOnBridgeTokens(1000 + 49_999);
    expect(st.stats().level).toBe(0);
    expect(st.statsFedProgress()).toBe(9);
    expect(st.statsPollLevelUp()).toBe(false);

    st.statsOnBridgeTokens(1000 + 50_000);
    expect(st.stats().level).toBe(1);
    expect(st.stats().tokens).toBe(50_000);
    expect(st.statsFedProgress()).toBe(0);
    expect(st.statsPollLevelUp()).toBe(true);
    expect(st.statsPollLevelUp()).toBe(false); // pending flag is consumed

    st.statsOnBridgeTokens(1000 + 80_000);
    expect(st.statsFedProgress()).toBe(6); // 30K into the level, 5K per pip
    expect(st.statsPollLevelUp()).toBe(false);
  });

  it("a jump over several levels reports one level-up and the right level", async () => {
    const { st } = await fresh();
    st.statsOnBridgeTokens(0);
    st.statsOnBridgeTokens(160_000);
    expect(st.stats().level).toBe(3);
    expect(st.statsPollLevelUp()).toBe(true);
    expect(st.statsPollLevelUp()).toBe(false);
  });

  it("a drop in the total resyncs without crediting or losing progress", async () => {
    const { st } = await fresh();
    st.statsOnBridgeTokens(100_000);
    st.statsOnBridgeTokens(130_000);
    expect(st.stats().tokens).toBe(30_000);
    st.statsOnBridgeTokens(500); // db swapped
    expect(st.stats().tokens).toBe(30_000);
    st.statsOnBridgeTokens(2_500);
    expect(st.stats().tokens).toBe(32_000);
  });

  it("statsResyncTokens re-latches: the next total is a new baseline, not a delta", async () => {
    const { st } = await fresh();
    st.statsOnBridgeTokens(100_000);
    st.statsOnBridgeTokens(110_000);
    expect(st.stats().tokens).toBe(10_000);
    st.statsResyncTokens(); // Settings -> hermes pointed at another db
    st.statsOnBridgeTokens(9_000_000); // its lifetime total is far higher
    expect(st.stats().tokens).toBe(10_000);
    expect(st.stats().level).toBe(0);
    expect(st.statsPollLevelUp()).toBe(false);
    st.statsOnBridgeTokens(9_003_000);
    expect(st.stats().tokens).toBe(13_000);
  });

  it("backfills tokens from a stored level when tokens are 0", async () => {
    store.stats = { level: 3, tokens: 0 };
    const { st } = await fresh();
    await st.statsLoad();
    expect(st.stats().tokens).toBe(150_000);
    expect(st.stats().level).toBe(3);
  });
});

describe("petting mood", () => {
  it("first pet from neutral raises mood to 3 hearts", async () => {
    const { st } = await fresh();
    expect(st.statsMoodTier()).toBe(2);
    expect(st.statsOnPet()).toBe(true);
    expect(st.stats().moodPoints).toBe(3);
    expect(st.stats().lastMoodAt).toBe(T0);
    expect(st.statsMoodTier()).toBe(3);
    expect(st.stats().pets).toBe(1);
  });

  it("always counts the pet but raises mood at most once per 60 s", async () => {
    const { st } = await fresh();
    expect(st.statsOnPet()).toBe(true); // 3
    vi.setSystemTime(T0 + 1000);
    expect(st.statsOnPet()).toBe(false);
    vi.setSystemTime(T0 + 59_999);
    expect(st.statsOnPet()).toBe(false);
    expect(st.stats().pets).toBe(3);
    expect(st.statsMoodTier()).toBe(3);

    vi.setSystemTime(T0 + 60_000);
    expect(st.statsOnPet()).toBe(true); // 4
    expect(st.statsMoodTier()).toBe(4);
    expect(st.stats().pets).toBe(4);
    expect(st.stats().lastMoodAt).toBe(T0 + 60_000);

    vi.setSystemTime(T0 + 120_000);
    expect(st.statsOnPet()).toBe(true); // capped at 4
    expect(st.statsMoodTier()).toBe(4);
    expect(st.stats().moodPoints).toBe(4);
  });

  it("decays one heart per 3 hours of wall clock, clamped to 0", async () => {
    const { st } = await fresh();
    st.statsOnPet();
    vi.setSystemTime(T0 + 60_000);
    st.statsOnPet(); // 4 hearts at T0+60s
    const at = T0 + 60_000;
    vi.setSystemTime(at + 3 * HOUR - 1);
    expect(st.statsMoodTier()).toBe(4);
    vi.setSystemTime(at + 3 * HOUR);
    expect(st.statsMoodTier()).toBe(3);
    vi.setSystemTime(at + 6 * HOUR);
    expect(st.statsMoodTier()).toBe(2);
    vi.setSystemTime(at + 12 * HOUR);
    expect(st.statsMoodTier()).toBe(0);
    vi.setSystemTime(at + 100 * HOUR);
    expect(st.statsMoodTier()).toBe(0);
  });

  it("a pet after decay builds on the decayed tier, not the stored one", async () => {
    const { st } = await fresh();
    st.statsOnPet();
    vi.setSystemTime(T0 + 60_000);
    st.statsOnPet(); // 4
    vi.setSystemTime(T0 + 60_000 + 7 * HOUR); // decayed to 2
    expect(st.statsMoodTier()).toBe(2);
    expect(st.statsOnPet()).toBe(true);
    expect(st.stats().moodPoints).toBe(3);
  });

  it("survives a restart: mood decays across the gap while closed", async () => {
    store.stats = { moodPoints: 4, lastMoodAt: T0 - 4 * HOUR, pets: 7 };
    const { st } = await fresh();
    await st.statsLoad();
    expect(st.stats().pets).toBe(7);
    expect(st.statsMoodTier()).toBe(3);
  });

  it("a wall clock that steps backwards does not lock petting out", async () => {
    const { st } = await fresh();
    st.statsOnPet();
    vi.setSystemTime(T0 - 5 * HOUR);
    expect(st.statsOnPet()).toBe(true);
  });
});

describe("energy", () => {
  it("starts at 3 and drains one per 2 hours of millis()", async () => {
    const { st, platform } = await fresh();
    let ms = 0;
    platform.setMillisSource(() => ms);
    expect(st.statsEnergyTier()).toBe(3);
    ms = 2 * HOUR - 1;
    expect(st.statsEnergyTier()).toBe(3);
    ms = 2 * HOUR;
    expect(st.statsEnergyTier()).toBe(2);
    ms = 4 * HOUR;
    expect(st.statsEnergyTier()).toBe(1);
    ms = 6 * HOUR;
    expect(st.statsEnergyTier()).toBe(0);
    ms = 30 * HOUR;
    expect(st.statsEnergyTier()).toBe(0);
  });

  it("refills to 5 on wake and drains from there", async () => {
    const { st, platform } = await fresh();
    let ms = 5 * HOUR;
    platform.setMillisSource(() => ms);
    expect(st.statsEnergyTier()).toBe(1);
    st.statsOnWake();
    expect(st.statsEnergyTier()).toBe(5);
    ms += 2 * HOUR;
    expect(st.statsEnergyTier()).toBe(4);
    ms += 6 * HOUR;
    expect(st.statsEnergyTier()).toBe(1);
    ms += 20 * HOUR;
    expect(st.statsEnergyTier()).toBe(0);
  });

  it("nap time accumulates", async () => {
    const { st } = await fresh();
    st.statsOnNapEnd(600);
    st.statsOnNapEnd(30);
    expect(st.stats().napSeconds).toBe(630);
  });
});

describe("settings", () => {
  it("loads stored values and rejects garbage", async () => {
    store.settings = { sound: false, onTop: "yes", led: false, hud: true, clockRot: 7, bright: 2 };
    const { st } = await fresh();
    await st.settingsLoad();
    expect(st.settings()).toEqual({ sound: false, onTop: true, led: false, hud: true, clockRot: 0, bright: 2 });
  });

  it("missing blob gives defaults", async () => {
    const { st } = await fresh();
    await st.settingsLoad();
    expect(st.settings()).toEqual({ sound: true, onTop: true, led: true, hud: true, clockRot: 0, bright: 4 });
  });
});

describe("persistence", () => {
  it("debounces saves to at most one write per second per blob", async () => {
    const { st, platform } = await fresh();
    const save = vi.mocked(platform.saveJson);
    save.mockClear();
    st.statsOnPet();
    vi.advanceTimersByTime(400);
    st.statsOnPet();
    st.settings().sound = false;
    st.settingsSave();
    st.statsOnNapEnd(5);
    expect(save).not.toHaveBeenCalled();
    vi.advanceTimersByTime(599);
    expect(save).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(save).toHaveBeenCalledTimes(2);
    expect(store.stats).toMatchObject({ pets: 2, napSeconds: 5 });
    expect(store.settings).toMatchObject({ sound: false });

    // quiet period: nothing more is written
    vi.advanceTimersByTime(5000);
    expect(save).toHaveBeenCalledTimes(2);

    // a later change starts a new window
    st.statsOnPet();
    expect(save).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(1000);
    expect(save).toHaveBeenCalledTimes(3);
  });

  it("round-trips stats through a restart", async () => {
    const a = await fresh();
    a.st.statsOnBridgeTokens(0);
    a.st.statsOnBridgeTokens(60_000);
    a.st.statsOnPet();
    a.st.statsOnNapEnd(90);
    a.st.statsFlush();

    const b = await fresh();
    await b.st.statsLoad();
    expect(b.st.stats()).toEqual(a.st.stats());
    expect(b.st.stats().level).toBe(1);
    expect(b.st.statsMoodTier()).toBe(3);
  });

  it("keeps species and names in the buddy blob and strips JSON-breaking chars", async () => {
    const a = await fresh();
    a.st.speciesIdxSave(5);
    a.st.petNameSet('Mo"chi\\\n');
    a.st.ownerSet("Dan");
    a.st.statsFlush();
    expect(store.buddy).toEqual({ species: 5, petName: "Mochi", owner: "Dan" });

    const b = await fresh();
    await b.st.statsLoad();
    expect(b.st.speciesIdxLoad()).toBe(5);
    expect(b.st.petName()).toBe("Mochi");
    expect(b.st.ownerName()).toBe("Dan");
  });

  it("clamps names to the firmware buffer sizes", async () => {
    const { st } = await fresh();
    st.petNameSet("x".repeat(40));
    st.ownerSet("y".repeat(60));
    expect(st.petName()).toHaveLength(23);
    expect(st.ownerName()).toHaveLength(31);
  });

  it("statsReset restores defaults and writes them immediately", async () => {
    const { st, platform } = await fresh();
    st.statsOnPet();
    st.settings().sound = false;
    st.settings().bright = 1;
    st.speciesIdxSave(9);
    st.petNameSet("Zed");
    st.statsOnBridgeTokens(0);
    st.statsOnBridgeTokens(70_000);
    st.statsFlush();
    expect(store.stats).toMatchObject({ pets: 1, level: 1 });

    const save = vi.mocked(platform.saveJson);
    save.mockClear();
    st.statsReset();
    expect(save).toHaveBeenCalledTimes(3); // no waiting for the debounce
    expect(st.stats()).toEqual({ napSeconds: 0, pets: 0, level: 0, tokens: 0, moodPoints: 2, lastMoodAt: 0 });
    expect(st.settings()).toEqual({ sound: true, onTop: true, led: true, hud: true, clockRot: 0, bright: 4 });
    expect(st.speciesIdxLoad()).toBe(0xff);
    expect(st.petName()).toBe("Buddy");
    expect(st.statsPollLevelUp()).toBe(false);
    expect(store.stats).toMatchObject({ pets: 0, level: 0, tokens: 0 });
    expect(store.settings).toMatchObject({ sound: true, bright: 4 });
    expect(store.buddy).toEqual({ species: 0xff, petName: "Buddy", owner: "" });
  });
});
