// Persistence guards (a failed read must never let defaults overwrite the real file) and
// openDbSettings' error handling. platform.ts reads isTauri at import time, so each test
// imports a fresh copy, with the Tauri bridge mocked where a test needs it.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Platform = typeof import("../src/hw/platform");

const flush = async (): Promise<void> => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.resetModules();
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  warn.mockRestore();
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  vi.doUnmock("@tauri-apps/api/core");
  vi.doUnmock("@tauri-apps/api/event");
  vi.doUnmock("@tauri-apps/api/window");
  vi.doUnmock("@tauri-apps/api/app");
  vi.resetModules();
  localStorage.clear();
  document.body.innerHTML = "";
  document.body.className = "";
});

/** Fresh platform.ts running "under Tauri"; `handler` plays the Rust side, `emit` plays its events. */
async function tauriPlatform(
  handler: (cmd: string, args: { name?: string }) => unknown = () => null,
): Promise<{ plat: Platform; invoke: ReturnType<typeof vi.fn>; emit: (event: string, payload: unknown) => void; win: MockWindow }> {
  const win: MockWindow = {
    size: { width: 330, height: 640 },
    factor: 1,
    pos: { x: 0, y: 0 },
    setSize: vi.fn(async () => {}),
    setPosition: vi.fn(async () => {}),
    innerSize: async () => win.size,
    scaleFactor: async () => win.factor,
    outerPosition: async () => win.pos,
  };
  const invoke = vi.fn(async (cmd: string, args: { name?: string } = {}) => handler(cmd, args));
  const listeners = new Map<string, (e: { payload: unknown }) => void>();
  vi.doMock("@tauri-apps/api/core", () => ({ invoke }));
  vi.doMock("@tauri-apps/api/event", () => ({
    listen: vi.fn(async (name: string, cb: (e: { payload: unknown }) => void) => {
      listeners.set(name, cb);
      return () => listeners.delete(name);
    }),
  }));
  vi.doMock("@tauri-apps/api/app", () => ({ getVersion: async () => "0.0.0" }));
  vi.doMock("@tauri-apps/api/window", () => ({
    LogicalSize: class {
      constructor(readonly width: number, readonly height: number) {}
    },
    PhysicalPosition: class {
      constructor(readonly x: number, readonly y: number) {}
    },
    getCurrentWindow: () => win,
  }));
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  const plat = await import("../src/hw/platform");
  expect(plat.isTauri).toBe(true);
  await flush();
  return { plat, invoke, emit: (event, payload) => listeners.get(event)?.({ payload }), win };
}

interface MockWindow {
  size: { width: number; height: number };
  factor: number;
  pos: { x: number; y: number };
  setSize: ReturnType<typeof vi.fn>;
  setPosition: ReturnType<typeof vi.fn>;
  innerSize(): Promise<{ width: number; height: number }>;
  scaleFactor(): Promise<number>;
  outerPosition(): Promise<{ x: number; y: number }>;
}

const saves = (invoke: ReturnType<typeof vi.fn>): unknown[][] =>
  invoke.mock.calls.filter((c) => c[0] === "save_json");

describe("a failed read never lets defaults overwrite saved data", () => {
  const locked = (cmd: string, args: { name?: string }): unknown => {
    if (cmd === "load_json" && args.name === "stats") throw "read stats.json: Access is denied. (os error 5)";
    return null; // everything else: "not found"
  };

  it("under Tauri: saveJson refuses a name whose load errored, and warns once", async () => {
    const { plat, invoke } = await tauriPlatform(locked);
    expect(await plat.loadJson("stats", { pets: 0 })).toEqual({ pets: 0 }); // fallback, as before
    warn.mockClear();

    plat.saveJson("stats", { pets: 1 });
    plat.saveJson("stats", { pets: 2 });
    await flush();
    expect(saves(invoke)).toHaveLength(0);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("under Tauri: other names, and names that were merely not found, still save", async () => {
    const { plat, invoke } = await tauriPlatform(locked);
    await plat.loadJson("stats", { pets: 0 });
    expect(await plat.loadJson("settings", { sound: true })).toEqual({ sound: true }); // not found -> null
    plat.saveJson("settings", { sound: false });
    plat.saveJson("buddy", { species: 3 }); // never loaded
    await flush();
    expect(saves(invoke).map((c) => (c[1] as { name: string }).name)).toEqual(["settings", "buddy"]);
  });

  it("under Tauri: a factory reset deletes the files, so saving is allowed again", async () => {
    const { plat, invoke } = await tauriPlatform(locked);
    await plat.loadJson("stats", { pets: 0 });
    await plat.factoryReset();
    plat.saveJson("stats", { pets: 0 });
    await flush();
    expect(saves(invoke)).toHaveLength(1);
  });

  it("in the browser: an unparseable stored value counts as a failed read", async () => {
    const plat = await import("../src/hw/platform");
    expect(plat.isTauri).toBe(false);
    localStorage.setItem("hermes-buddy:stats", "{not json");
    expect(await plat.loadJson("stats", { pets: 0 })).toEqual({ pets: 0 });
    warn.mockClear();

    plat.saveJson("stats", { pets: 0 });
    plat.saveJson("stats", { pets: 1 });
    expect(localStorage.getItem("hermes-buddy:stats")).toBe("{not json");
    expect(warn).toHaveBeenCalledTimes(1);

    expect(await plat.loadJson("settings", { sound: true })).toEqual({ sound: true }); // simply absent
    plat.saveJson("settings", { sound: false });
    expect(JSON.parse(localStorage.getItem("hermes-buddy:settings")!)).toEqual({ sound: false });
  });
});

describe("openDbSettings", () => {
  it("survives a failure while building the overlay and can be opened again", async () => {
    const plat = await import("../src/hw/platform");
    const append = vi.spyOn(document.body, "append").mockImplementationOnce(() => {
      throw new Error("detached");
    });
    plat.openDbSettings();
    await flush();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(document.body.classList.contains("modal-open")).toBe(false); // keys must not stay locked out
    append.mockRestore();

    plat.openDbSettings(); // overlayPending was reset
    await flush();
    expect(document.getElementById("dbOverlay")).not.toBeNull();
  });
});

describe("character-error toast", () => {
  const toast = (): HTMLElement | null => document.getElementById("toast");

  it("shows the reason for a rejected pack drop, then dismisses itself after ~4 s", async () => {
    vi.useFakeTimers();
    const { emit } = await tauriPlatform();
    expect(toast()).toBeNull();

    emit("buddy://character-error", "pack has no .gif files");
    expect(toast()).not.toBeNull();
    expect(toast()!.textContent).toContain("pack has no .gif files");
    expect(toast()!.getAttribute("role")).toBe("status");

    vi.advanceTimersByTime(3900);
    expect(toast()).not.toBeNull();
    vi.advanceTimersByTime(200);
    expect(toast()).toBeNull();
  });

  it("a second rejection replaces the first and restarts the timer", async () => {
    vi.useFakeTimers();
    const { emit } = await tauriPlatform();
    emit("buddy://character-error", "first");
    vi.advanceTimersByTime(3000);
    emit("buddy://character-error", "second");
    expect(document.querySelectorAll("#toast")).toHaveLength(1);
    expect(toast()!.textContent).toContain("second");
    vi.advanceTimersByTime(2000); // past the first one's deadline
    expect(toast()!.textContent).toContain("second");
    vi.advanceTimersByTime(2100);
    expect(toast()).toBeNull();
  });

  it("copes with a payload that is not a string", async () => {
    vi.useFakeTimers();
    const { emit } = await tauriPlatform();
    emit("buddy://character-error", { oops: true });
    expect(toast()).not.toBeNull();
    expect(toast()!.textContent).not.toContain("[object");
  });
});

describe("resizable window", () => {
  it("fitScale fits the bezel (330x640, or 640x330 on its side) inside the window", async () => {
    const { fitScale } = await import("../src/hw/platform");
    expect(fitScale(330, 640, false)).toBe(1);
    expect(fitScale(660, 1280, false)).toBe(2);
    expect(fitScale(660, 640, false)).toBe(1); // height-bound
    expect(fitScale(165, 1000, false)).toBe(0.5); // width-bound
    expect(fitScale(640, 330, true)).toBe(1);
    expect(fitScale(330, 640, true)).toBeCloseTo(330 / 640);
  });

  it("stickWindowSize is the window around just the stick, at its current scale", async () => {
    const { stickWindowSize } = await import("../src/hw/platform");
    expect(stickWindowSize(330, 640, false, false)).toEqual({ w: 330, h: 640 });
    // A window dragged wider than the stick: same stick, no room around it.
    expect(stickWindowSize(660, 600, false, false)).toEqual({ w: 309, h: 600 });
    expect(stickWindowSize(330, 640, false, true)).toEqual({ w: 640, h: 330 }); // turned sideways
    expect(stickWindowSize(400, 776, false, true)).toEqual({ w: 776, h: 400 });
    expect(stickWindowSize(776, 400, true, false)).toEqual({ w: 400, h: 776 });
    expect(stickWindowSize(100, 100, false, false)).toEqual({ w: 132, h: 256 }); // never below 0.4x
  });

  it("laying the stick sideways turns the window around the stick's centre, in logical pixels", async () => {
    const { plat, win } = await tauriPlatform();
    win.size = { width: 800, height: 1552 }; // 400x776 logical on a 2x screen
    win.factor = 2;
    win.pos = { x: 1000, y: 500 };
    plat.setLandscape(true);
    await flush();
    expect(win.setSize).toHaveBeenCalledTimes(1);
    expect(win.setSize.mock.calls[0][0]).toMatchObject({ width: 776, height: 400 });
    // (400-776)/2 logical = -188 = -376 physical across, +376 down
    expect(win.setPosition.mock.calls[0][0]).toMatchObject({ x: 624, y: 876 });
    expect(document.body.classList.contains("landscape")).toBe(true);

    win.size = { width: 1552, height: 800 };
    win.pos = { x: 624, y: 876 };
    plat.setLandscape(false);
    await flush();
    expect(win.setSize.mock.calls[1][0]).toMatchObject({ width: 400, height: 776 });
    expect(win.setPosition.mock.calls[1][0]).toMatchObject({ x: 1000, y: 500 });
  });

  it("leaves a window that already fits the stick alone", async () => {
    vi.useFakeTimers();
    const { win } = await tauriPlatform();
    win.size = { width: 331, height: 640 }; // a pixel of rounding is fine
    window.dispatchEvent(new Event("resize"));
    await vi.advanceTimersByTimeAsync(400);
    await flush();
    expect(win.setSize).not.toHaveBeenCalled();
    expect(win.setPosition).not.toHaveBeenCalled();
  });

  it("a sideways clock right at launch turns the window the launch trim left", async () => {
    const { plat, win } = await tauriPlatform();
    win.size = { width: 776, height: 400 }; // remembered sideways
    win.setSize.mockImplementation(async (s: { width: number; height: number }) => {
      await Promise.resolve();
      win.size = { width: s.width, height: s.height };
    });
    plat.attachRotation({} as Parameters<Platform["attachRotation"]>[0]); // stands it up...
    plat.setLandscape(true); // ...while the clock already lies down
    await flush();
    await flush();
    expect(win.setSize.mock.calls.map((c) => [c[0].width, c[0].height])).toEqual([
      [400, 776],
      [776, 400],
    ]);
  });

  it("snaps the window to the stick once a resize has settled", async () => {
    vi.useFakeTimers();
    const { win } = await tauriPlatform();
    win.size = { width: 660, height: 600 };
    win.pos = { x: 200, y: 100 };
    window.dispatchEvent(new Event("resize"));
    await vi.advanceTimersByTimeAsync(200);
    window.dispatchEvent(new Event("resize")); // still dragging: starts the wait over
    await vi.advanceTimersByTimeAsync(300);
    expect(win.setSize).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(100);
    await flush();
    expect(win.setSize).toHaveBeenCalledTimes(1);
    expect(win.setSize.mock.calls[0][0]).toMatchObject({ width: 309, height: 600 });
    expect(win.setPosition.mock.calls[0][0]).toMatchObject({ x: 376, y: 100 }); // stick stays put
  });

  it("at launch, stands a remembered sideways window up and trims an odd-shaped one", async () => {
    const display = {} as Parameters<Platform["attachRotation"]>[0];
    const { plat, win } = await tauriPlatform();
    win.size = { width: 776, height: 400 }; // quit while the clock lay sideways
    plat.attachRotation(display);
    await flush();
    expect(win.setSize.mock.calls[0][0]).toMatchObject({ width: 400, height: 776 });

    win.size = { width: 660, height: 600 }; // the stick stood in a wide window: portrait, trimmed
    plat.attachRotation(display);
    await flush();
    expect(win.setSize.mock.calls[1][0]).toMatchObject({ width: 309, height: 600 });
  });
});

describe("listProfiles", () => {
  it("asks the shell under Tauri", async () => {
    const list = [
      { name: "default", path: "/Users/v/.hermes/state.db" },
      { name: "test-profile", path: "/Users/v/.hermes/profiles/test-profile/state.db" },
    ];
    const { plat, invoke } = await tauriPlatform((cmd) => (cmd === "list_profiles" ? list : null));
    expect(await plat.listProfiles()).toEqual(list);
    expect(invoke).toHaveBeenCalledWith("list_profiles");
  });

  it("falls back to just the default when the shell fails, or in a browser", async () => {
    const { plat } = await tauriPlatform((cmd) => {
      if (cmd === "list_profiles") throw new Error("boom");
      return null;
    });
    expect(await plat.listProfiles()).toEqual([{ name: "default", path: "~/.hermes/state.db" }]);
    expect(warn).toHaveBeenCalled();

    vi.resetModules();
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
    vi.doUnmock("@tauri-apps/api/core");
    const browser = await import("../src/hw/platform");
    expect(browser.isTauri).toBe(false);
    expect(await browser.listProfiles()).toEqual([{ name: "default", path: "~/.hermes/state.db" }]);
  });
});
