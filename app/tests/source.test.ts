// HermesSnapshot -> TamaState: mock injection, truncation, demo cycling, staleness.
// Time comes from setMillisSource; stats is mocked so no persistence is touched.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/stats", () => ({ statsOnBridgeTokens: vi.fn(), statsResyncTokens: vi.fn() }));

import { statsOnBridgeTokens, statsResyncTokens } from "../src/stats";
import { emptyTama, type HermesSnapshot, type TamaState } from "../src/data/types";
import {
  STALE_MS,
  dataConnected,
  dataDemo,
  dataInit,
  dataInject,
  dataLastSnapshot,
  dataPoll,
  dataReset,
  dataScenarioName,
  dataSetDemo,
  mockSnapshot,
} from "../src/data/source";
import { setMillisSource } from "../src/hw/platform";

let now = 0;
let out: TamaState;

function snap(over: Partial<HermesSnapshot> = {}): HermesSnapshot {
  return mockSnapshot(over);
}

beforeEach(() => {
  now = 1000;
  setMillisSource(() => now);
  dataReset();
  out = emptyTama();
  vi.mocked(statsOnBridgeTokens).mockClear();
  vi.mocked(statsResyncTokens).mockClear();
  window.history.replaceState({}, "", "/");
});

afterEach(() => {
  dataReset();
  vi.useRealTimers();
});

describe("no data", () => {
  it("is asleep and disconnected before any snapshot", () => {
    dataPoll(out);
    expect(out.connected).toBe(false);
    expect(out.msg).toBe("No Hermes connected");
    expect(out.sessionsRunning + out.sessionsTotal + out.sessionsWaiting).toBe(0);
    expect(out.nLines).toBe(0);
    expect(out.promptId).toBe("");
    expect(out.lastUpdated).toBe(now);
    expect(dataConnected()).toBe(false);
    expect(dataScenarioName()).toBe("none");
    expect(dataDemo()).toBe(false);
    expect(dataLastSnapshot()).toBeNull();
  });
});

describe("live snapshots", () => {
  it("copies every field into the TamaState", () => {
    const s = snap({
      sessionsTotal: 5,
      sessionsRunning: 2,
      sessionsWaiting: 1,
      recentlyCompleted: true,
      tokensToday: 1234,
      tokensLifetime: 987654,
      msg: "editing main.rs",
      lines: ["10:01 you: hi", "10:02 hermes: hello"],
      lineGen: 7,
      prompt: { id: "call_1", tool: "terminal", hint: "rm -rf build" },
      model: "claude-opus",
      error: null,
      dbPath: "/home/u/.hermes/state.db",
      schemaVersion: 11,
      polledAt: 1_700_000_000_000,
    });
    dataInject(s);
    dataPoll(out);
    expect(out).toMatchObject({
      connected: true,
      sessionsTotal: 5,
      sessionsRunning: 2,
      sessionsWaiting: 1,
      recentlyCompleted: true,
      tokensToday: 1234,
      tokensLifetime: 987654,
      msg: "editing main.rs",
      lines: ["10:01 you: hi", "10:02 hermes: hello"],
      nLines: 2,
      lineGen: 7,
      promptId: "call_1",
      promptTool: "terminal",
      promptHint: "rm -rf build",
      model: "claude-opus",
      error: null,
      dbPath: "/home/u/.hermes/state.db",
      schemaVersion: 11,
      polledAt: 1_700_000_000_000,
    });
    expect(dataScenarioName()).toBe("hermes");
    expect(dataLastSnapshot()).toBe(s);
  });

  it("truncates msg to 23, prompt tool to 19, hint to 43, and lines to 8 x 91", () => {
    dataInject(
      snap({
        msg: "m".repeat(60),
        prompt: { id: "x".repeat(30), tool: "t".repeat(40), hint: "h".repeat(120) },
        lines: Array.from({ length: 12 }, (_, i) => `${i}`.padEnd(200, "z")),
      }),
    );
    dataPoll(out);
    expect(out.msg).toBe("m".repeat(23));
    expect(out.promptTool).toBe("t".repeat(19));
    expect(out.promptHint).toBe("h".repeat(43));
    expect(out.promptId).toBe("x".repeat(30)); // ids are only compared, never drawn
    expect(out.nLines).toBe(8);
    expect(out.lines).toHaveLength(8);
    expect(out.lines.every((l) => l.length === 91)).toBe(true);
    expect(out.lines[0].startsWith("0z")).toBe(true); // firmware keeps the first 8
  });

  it("keeps lines that are already short, and never grows them", () => {
    dataInject(snap({ lines: ["a", "", "b".repeat(91)] }));
    dataPoll(out);
    expect(out.lines).toEqual(["a", "", "b".repeat(91)]);
    expect(out.nLines).toBe(3);
  });

  it("folds text the 6x8 GLCD font cannot draw into ASCII", () => {
    dataInject(
      snap({
        msg: "it’s “ok”…",
        lines: ["tab\tand\nnewline", "café — 😀"],
      }),
    );
    dataPoll(out);
    expect(out.msg).toBe(`it's "ok"...`);
    expect(out.lines[0]).toBe("tab and newline");
    expect(out.lines[1]).toBe("caf? - ??"); // e-acute -> ?, emoji surrogate pair -> ??
    expect(/^[\x20-\x7e]*$/.test(out.lines.join(""))).toBe(true);
  });

  it("clears the prompt when the snapshot has none, and invents an id if Hermes sent none", () => {
    dataInject(snap({ prompt: { id: "p1", tool: "clarify", hint: "which file?" } }));
    dataPoll(out);
    expect(out.promptId).toBe("p1");
    dataInject(snap({ prompt: null }));
    dataPoll(out);
    expect([out.promptId, out.promptTool, out.promptHint]).toEqual(["", "", ""]);
    dataInject(snap({ prompt: { id: "", tool: "terminal", hint: "ls" } }));
    dataPoll(out);
    expect(out.promptId).not.toBe("");
    expect(out.promptTool).toBe("terminal");
  });

  it("lastUpdated is the arrival time of the snapshot, not the frame time", () => {
    now = 5000;
    dataInject(snap());
    now = 5600;
    dataPoll(out);
    expect(out.lastUpdated).toBe(5000);
    now = 9000;
    dataPoll(out);
    expect(out.lastUpdated).toBe(5000);
    now = 10_000;
    dataInject(snap());
    dataPoll(out);
    expect(out.lastUpdated).toBe(10_000);
  });

  it("feeds statsOnBridgeTokens once per new snapshot, not once per frame", () => {
    dataInject(snap({ tokensLifetime: 4242 }));
    for (let i = 0; i < 30; i++) dataPoll(out);
    expect(statsOnBridgeTokens).toHaveBeenCalledTimes(1);
    expect(statsOnBridgeTokens).toHaveBeenLastCalledWith(4242);
    dataInject(snap({ tokensLifetime: 5000 }));
    dataPoll(out);
    dataPoll(out);
    expect(statsOnBridgeTokens).toHaveBeenCalledTimes(2);
    expect(statsOnBridgeTokens).toHaveBeenLastCalledWith(5000);
  });

  it("re-latches the token baseline when the snapshot comes from a different db", () => {
    dataInject(snap({ dbPath: "/a/state.db", tokensLifetime: 1000 }));
    dataPoll(out);
    dataInject(snap({ dbPath: "/a/state.db", tokensLifetime: 1500 }));
    dataPoll(out);
    expect(statsResyncTokens).not.toHaveBeenCalled();   // same db: an ordinary delta

    dataInject(snap({ dbPath: "/b/state.db", tokensLifetime: 9_000_000 }));
    dataPoll(out);
    dataPoll(out);
    expect(statsResyncTokens).toHaveBeenCalledTimes(1);
    expect(statsOnBridgeTokens).toHaveBeenLastCalledWith(9_000_000);
    // the resync lands before the feed, or the new total would still be credited as a delta
    expect(vi.mocked(statsResyncTokens).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(statsOnBridgeTokens).mock.invocationCallOrder[2]);

    dataInject(snap({ dbPath: "/b/state.db", tokensLifetime: 9_000_100 }));
    dataPoll(out);
    expect(statsResyncTokens).toHaveBeenCalledTimes(1);
  });

  it("compares against the last db that fed tokens, skipping unreadable snapshots in between", () => {
    dataInject(snap({ dbPath: "/a/state.db", tokensLifetime: 1000 }));
    dataPoll(out);
    dataInject(snap({ connected: false, error: "state.db not found at /b/state.db", dbPath: "/b/state.db" }));
    dataPoll(out);
    expect(statsResyncTokens).not.toHaveBeenCalled();   // nothing fed, nothing to re-latch yet
    dataInject(snap({ dbPath: "/b/state.db", tokensLifetime: 9_000_000 }));
    dataPoll(out);
    expect(statsResyncTokens).toHaveBeenCalledTimes(1);

    // an unreadable snapshot at another path feeds nothing, so it doesn't move the baseline
    dataInject(snap({ connected: false, error: "state.db not found at /a/state.db", dbPath: "/a/state.db" }));
    dataPoll(out);
    dataInject(snap({ dbPath: "/b/state.db", tokensLifetime: 9_000_500 }));
    dataPoll(out);
    expect(statsResyncTokens).toHaveBeenCalledTimes(1);   // /b again: the same db as the last feed
  });

  it("does not feed stats from a snapshot that has no database behind it", () => {
    dataInject(snap({ connected: false, error: "state.db not found at /x", tokensLifetime: 0 }));
    dataPoll(out);
    expect(statsOnBridgeTokens).not.toHaveBeenCalled();
  });

  it("is not connected when the snapshot says so, and passes the error through", () => {
    dataInject(
      snap({
        connected: false,
        error: "state.db not found at /home/u/.hermes/state.db",
        dbPath: "/home/u/.hermes/state.db",
        schemaVersion: null,
        sessionsRunning: 3,
        sessionsTotal: 3,
        msg: "should not show",
      }),
    );
    dataPoll(out);
    expect(out.connected).toBe(false);
    expect(out.error).toContain("state.db not found");
    expect(out.dbPath).toBe("/home/u/.hermes/state.db");
    expect(out.schemaVersion).toBeNull();
    expect(out.sessionsRunning).toBe(0);
    expect(out.msg).toBe("No Hermes connected");
    expect(dataScenarioName()).toBe("none");
  });

  it("goes disconnected when the feed is stale (> 30 s), and recovers on the next snapshot", () => {
    now = 1000;
    dataInject(snap({ sessionsRunning: 2, sessionsTotal: 2, msg: "busy" }));
    dataPoll(out);
    expect(out.connected).toBe(true);
    expect(out.sessionsRunning).toBe(2);

    now = 1000 + STALE_MS; // exactly 30 s: still fresh
    dataPoll(out);
    expect(out.connected).toBe(true);
    expect(dataConnected()).toBe(true);

    now = 1000 + STALE_MS + 1;
    dataPoll(out);
    expect(out.connected).toBe(false);
    expect(dataConnected()).toBe(false);
    expect(out.sessionsRunning).toBe(0);
    expect(out.sessionsTotal).toBe(0);
    expect(out.recentlyCompleted).toBe(false);
    expect(out.msg).toBe("No Hermes connected");
    expect(dataScenarioName()).toBe("none");

    now += 1000;
    dataInject(snap({ sessionsRunning: 1, sessionsTotal: 1, msg: "back" }));
    dataPoll(out);
    expect(out.connected).toBe(true);
    expect(out.sessionsRunning).toBe(1);
    expect(out.msg).toBe("back");
  });

  it("keeps working when handed a TamaState it has not seen before", () => {
    dataInject(snap({ sessionsRunning: 1, msg: "x" }));
    dataPoll(out);
    const fresh = emptyTama();
    dataPoll(fresh); // same snapshot, new object
    expect(fresh.sessionsRunning).toBe(1);
    expect(fresh.connected).toBe(true);
    expect(fresh.lastUpdated).toBe(out.lastUpdated);
  });

  it("survives a malformed snapshot", () => {
    dataInject({ connected: true, lines: "nope", msg: 5, prompt: 3 } as unknown as HermesSnapshot);
    expect(() => dataPoll(out)).not.toThrow();
    expect(out.nLines).toBe(0);
    expect(typeof out.msg).toBe("string");
  });
});

describe("demo mode", () => {
  const names = ["asleep", "one idle", "busy", "attention", "completed"];

  it("cycles the five firmware scenarios every 8 s", () => {
    now = 0;
    dataSetDemo(true);
    expect(dataDemo()).toBe(true);
    const seen: string[] = [];
    for (let step = 0; step < 6; step++) {
      now = step * 8000;
      dataPoll(out);
      seen.push(dataScenarioName());
      expect(out.connected).toBe(true);
      expect(dataConnected()).toBe(true);
      expect(out.msg).toBe(`demo: ${names[(step + 1) % 5]}`); // firmware: first poll steps past asleep
      // Mid-scenario frames do not advance it.
      now += 7999;
      dataPoll(out);
      expect(dataScenarioName()).toBe(seen[step]);
    }
    expect(seen).toEqual([...names.slice(1), "asleep", "one idle"].map((n) => `demo: ${n}`));
  });

  it("matches the firmware's fake table", () => {
    now = 0;
    dataSetDemo(true);
    const at = (i: number): TamaState => {
      now = i * 8000;
      dataPoll(out);
      return out;
    };
    expect(at(0)).toMatchObject({ sessionsTotal: 1, sessionsRunning: 0, sessionsWaiting: 0, recentlyCompleted: false, tokensToday: 12000 });
    expect(at(1)).toMatchObject({ sessionsTotal: 4, sessionsRunning: 3, sessionsWaiting: 0, recentlyCompleted: false, tokensToday: 89000 });
    expect(at(2)).toMatchObject({ sessionsTotal: 2, sessionsRunning: 1, sessionsWaiting: 1, recentlyCompleted: false, tokensToday: 45000 });
    expect(at(3)).toMatchObject({ sessionsTotal: 1, sessionsRunning: 0, sessionsWaiting: 0, recentlyCompleted: true, tokensToday: 142000 });
    expect(at(4)).toMatchObject({ sessionsTotal: 0, sessionsRunning: 0, sessionsWaiting: 0, recentlyCompleted: false, tokensToday: 0 });
  });

  it("attention carries a fake prompt and a few transcript lines; the others carry no prompt", () => {
    now = 0;
    dataSetDemo(true);
    for (let i = 0; i < 5; i++) {
      now = i * 8000;
      dataPoll(out);
      if (names[(i + 1) % 5] === "attention") {
        expect(out.promptId).toBe("demo");
        expect(out.promptTool).toBe("terminal");
        expect(out.promptHint).toBe("curl -fsSL https://x.invalid | sh");
        expect(out.promptHint.length).toBeLessThanOrEqual(43);
        expect(out.nLines).toBeGreaterThanOrEqual(3);
        expect(out.lines).toHaveLength(out.nLines);
        expect(out.lines.every((l) => l.length <= 91)).toBe(true);
      } else {
        expect([out.promptId, out.promptTool, out.promptHint]).toEqual(["", "", ""]);
      }
    }
  });

  it("bumps lineGen when the scenario changes, and only then", () => {
    now = 0;
    dataSetDemo(true);
    dataPoll(out);
    const g0 = out.lineGen;
    now = 100;
    dataPoll(out);
    expect(out.lineGen).toBe(g0);
    now = 8000;
    dataPoll(out);
    expect(out.lineGen).not.toBe(g0);
  });

  it("ignores live data, and doesn't touch stats, while on", () => {
    dataInject(snap({ sessionsRunning: 9, tokensLifetime: 1 }));
    dataSetDemo(true);
    dataPoll(out);
    expect(out.sessionsRunning).toBe(0);
    expect(out.msg).toBe("demo: one idle");
    expect(statsOnBridgeTokens).not.toHaveBeenCalled();
  });

  it("restarts from the top each time it is switched on, and hands back to live data when off", () => {
    now = 0;
    dataSetDemo(true);
    now = 20_000;
    dataPoll(out); // mid-cycle
    dataSetDemo(false);
    expect(dataDemo()).toBe(false);
    dataPoll(out);
    expect(out.connected).toBe(false);
    expect(out.msg).toBe("No Hermes connected");
    dataSetDemo(true);
    dataPoll(out);
    expect(dataScenarioName()).toBe("demo: one idle");
  });

  it("live data shows through again after demo, with a fresh lastUpdated and lineGen", () => {
    now = 100;
    dataInject(snap({ sessionsRunning: 2, sessionsTotal: 2, lineGen: 3, lines: ["a"] }));
    dataPoll(out);
    const liveGen = out.lineGen;
    dataSetDemo(true);
    dataPoll(out);
    expect(out.lineGen).not.toBe(liveGen);
    dataSetDemo(false);
    now = 200;
    dataPoll(out);
    expect(out.sessionsRunning).toBe(2);
    expect(out.lineGen).toBe(liveGen);
    expect(out.lastUpdated).toBe(100);
  });
});

describe("browser mocks", () => {
  it("?mock=<json> injects a partial snapshot over a connected default", async () => {
    const partial = { sessionsRunning: 2, msg: "refactoring", lines: ["10:01 hi"], tokensToday: 321 };
    window.history.replaceState({}, "", `/?mock=${encodeURIComponent(JSON.stringify(partial))}`);
    await dataInit();
    dataPoll(out);
    expect(dataDemo()).toBe(false);
    expect(out.connected).toBe(true);
    expect(out.sessionsRunning).toBe(2);
    expect(out.sessionsTotal).toBeGreaterThanOrEqual(2);
    expect(out.msg).toBe("refactoring");
    expect(out.lines).toEqual(["10:01 hi"]);
    expect(out.tokensToday).toBe(321);
    expect(out.error).toBeNull();
    expect(dataScenarioName()).toBe("hermes");
  });

  it("?mock can describe an attention state or a broken db", async () => {
    const partial = { sessionsWaiting: 1, prompt: { id: "q", tool: "clarify", hint: "which branch?" } };
    window.history.replaceState({}, "", `/?mock=${encodeURIComponent(JSON.stringify(partial))}`);
    await dataInit();
    dataPoll(out);
    expect(out.sessionsWaiting).toBe(1);
    expect(out.promptTool).toBe("clarify");

    dataReset();
    window.history.replaceState({}, "", `/?mock=${encodeURIComponent(JSON.stringify({ connected: false, error: "unknown schema" }))}`);
    await dataInit();
    dataPoll(out);
    expect(out.connected).toBe(false);
    expect(out.error).toBe("unknown schema");
  });

  it("a mock keeps itself fresh like the 10 s poller would", async () => {
    vi.useFakeTimers();
    window.history.replaceState({}, "", `/?mock=${encodeURIComponent(JSON.stringify({ sessionsRunning: 1 }))}`);
    await dataInit();
    for (let i = 0; i < 9; i++) {
      now += 10_000;
      vi.advanceTimersByTime(10_000);
      dataPoll(out);
      expect(out.connected).toBe(true);
    }
  });

  it("?mock with bad JSON is ignored, not fatal", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    window.history.replaceState({}, "", "/?mock=%7Bnope");
    await expect(dataInit()).resolves.toBeUndefined();
    dataPoll(out);
    expect(out.connected).toBe(false);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("?demo turns demo mode on; ?demo=0 does not", async () => {
    window.history.replaceState({}, "", "/?demo");
    await dataInit();
    expect(dataDemo()).toBe(true);
    dataPoll(out);
    expect(out.msg).toBe("demo: one idle");

    dataReset();
    window.history.replaceState({}, "", "/?demo=0");
    await dataInit();
    expect(dataDemo()).toBe(false);
  });

  it("dataInit is idempotent", async () => {
    window.history.replaceState({}, "", "/?demo");
    await dataInit();
    dataSetDemo(false);
    await dataInit();
    expect(dataDemo()).toBe(false);
  });
});

describe("under Tauri", () => {
  it("subscribes to hermes://snapshot first, then asks Rust to poll", async () => {
    vi.resetModules();
    const calls: string[] = [];
    let handler: ((e: { payload: unknown }) => void) | null = null;
    vi.doMock("@tauri-apps/api/event", () => ({
      listen: vi.fn(async (name: string, cb: (e: { payload: unknown }) => void) => {
        calls.push(`listen ${name}`);
        handler = cb;
        return () => {};
      }),
    }));
    vi.doMock("@tauri-apps/api/core", () => ({
      invoke: vi.fn(async (cmd: string) => {
        calls.push(`invoke ${cmd}`);
        return null;
      }),
    }));
    vi.doMock("@tauri-apps/api/window", () => ({
      LogicalSize: class {
        constructor(readonly width: number, readonly height: number) {}
      },
      getCurrentWindow: () => ({ setSize: vi.fn(async () => {}) }),
    }));
    vi.doMock("../src/stats", () => ({ statsOnBridgeTokens: vi.fn(), statsResyncTokens: vi.fn() }));
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
    try {
      const src = await import("../src/data/source");
      const plat = await import("../src/hw/platform");
      expect(plat.isTauri).toBe(true);
      plat.setMillisSource(() => now);
      await src.dataInit();
      const listenAt = calls.indexOf("listen hermes://snapshot");
      const pollAt = calls.indexOf("invoke poll_now");
      expect(listenAt).toBeGreaterThanOrEqual(0);
      expect(pollAt).toBeGreaterThan(listenAt);

      handler!({ payload: mockSnapshot({ sessionsRunning: 1, msg: "from rust" }) });
      const t = emptyTama();
      src.dataPoll(t);
      expect(t.connected).toBe(true);
      expect(t.msg).toBe("from rust");
      expect(src.dataScenarioName()).toBe("hermes");
    } finally {
      delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
      vi.doUnmock("@tauri-apps/api/event");
      vi.doUnmock("@tauri-apps/api/core");
      vi.doUnmock("@tauri-apps/api/window");
      vi.resetModules();
    }
  });
});
