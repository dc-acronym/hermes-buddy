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
    setSize: vi.fn(async () => {}),
    innerSize: async () => win.size,
    scaleFactor: async () => win.factor,
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
  setSize: ReturnType<typeof vi.fn>;
  innerSize(): Promise<{ width: number; height: number }>;
  scaleFactor(): Promise<number>;
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

  it("orientedSize keeps the user's long and short sides, turned the wanted way", async () => {
    const { orientedSize } = await import("../src/hw/platform");
    expect(orientedSize(400, 776, true)).toEqual({ w: 776, h: 400 });
    expect(orientedSize(776, 400, true)).toEqual({ w: 776, h: 400 });
    expect(orientedSize(776, 400, false)).toEqual({ w: 400, h: 776 });
  });

  it("laying the stick sideways turns a resized window, in logical pixels", async () => {
    const { plat, win } = await tauriPlatform();
    win.size = { width: 800, height: 1552 }; // 400x776 logical on a 2x screen
    win.factor = 2;
    plat.setLandscape(true);
    await flush();
    expect(win.setSize).toHaveBeenCalledTimes(1);
    expect(win.setSize.mock.calls[0][0]).toMatchObject({ width: 776, height: 400 });
    expect(document.body.classList.contains("landscape")).toBe(true);

    win.size = { width: 1552, height: 800 };
    plat.setLandscape(false);
    await flush();
    expect(win.setSize.mock.calls[1][0]).toMatchObject({ width: 400, height: 776 });
  });

  it("does not touch a window that already has the right orientation", async () => {
    const { plat, win } = await tauriPlatform();
    win.size = { width: 900, height: 500 };
    plat.setLandscape(true);
    await flush();
    expect(win.setSize).not.toHaveBeenCalled();
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
