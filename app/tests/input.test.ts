// Button edge semantics, keyboard/pointer wiring, power-key codes, and the db-path overlay's
// key isolation. Time comes from setMillisSource so nothing depends on the wall clock.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BtnA,
  BtnB,
  MENU_HOLD_MS,
  PWR_LONG_MS,
  inputAttach,
  inputDetach,
  inputReleaseKeys,
  inputReset,
  inputSet,
  inputUpdate,
  pwrGetBtnPress,
} from "../src/hw/input";
import {
  attachRotation,
  deviceInfo,
  factoryReset,
  getConfig,
  loadJson,
  onNapChange,
  onShake,
  openDbSettings,
  saveJson,
  setLandscape,
  setLed,
  setMillisSource,
} from "../src/hw/platform";
import type { Display } from "../src/hw/tft";

let now = 0;

function frame(advanceMs = 16): void {
  now += advanceMs;
  inputUpdate();
}

function mountBezel(): void {
  document.body.className = "";
  document.body.innerHTML = `
    <div id="stage">
      <button id="btnA"></button><button id="btnB"></button><button id="btnPwr"></button>
      <input id="field" type="text" />
    </div>`;
}

function key(type: "keydown" | "keyup", code: string, init: KeyboardEventInit = {}, target: EventTarget = document.body): void {
  target.dispatchEvent(new KeyboardEvent(type, { code, key: code, bubbles: true, cancelable: true, ...init }));
}

function pointer(type: string, target: EventTarget, pointerId = 1): void {
  const Ctor = (globalThis as { PointerEvent?: typeof MouseEvent }).PointerEvent ?? MouseEvent;
  const ev = new Ctor(type, { bubbles: true, cancelable: true, button: 0 });
  Object.defineProperty(ev, "pointerId", { value: pointerId });
  Object.defineProperty(ev, "pointerType", { value: "mouse" });
  target.dispatchEvent(ev);
}

beforeEach(() => {
  now = 0;
  setMillisSource(() => now);
  inputReset();
  mountBezel();
});

afterEach(() => {
  inputDetach();
  inputReset();
  vi.useRealTimers();
  localStorage.clear();
  document.body.innerHTML = "";
  document.body.className = "";
});

describe("edge semantics", () => {
  it("reports pressed / wasPressed / wasReleased for exactly one frame each", () => {
    expect(BtnA.isPressed()).toBe(false);
    inputSet("A", true);
    frame();
    expect([BtnA.isPressed(), BtnA.wasPressed(), BtnA.wasReleased()]).toEqual([true, true, false]);
    frame();
    expect([BtnA.isPressed(), BtnA.wasPressed(), BtnA.wasReleased()]).toEqual([true, false, false]);
    inputSet("A", false);
    frame();
    expect([BtnA.isPressed(), BtnA.wasPressed(), BtnA.wasReleased()]).toEqual([false, false, true]);
    frame();
    expect([BtnA.isPressed(), BtnA.wasPressed(), BtnA.wasReleased()]).toEqual([false, false, false]);
  });

  it("a click that starts and ends between two frames still yields wasPressed, then wasReleased", () => {
    inputSet("A", true);
    inputSet("A", false); // both before the next inputUpdate()
    frame();
    expect(BtnA.wasPressed()).toBe(true);
    expect(BtnA.wasReleased()).toBe(false);
    expect(BtnA.isPressed()).toBe(true);
    frame();
    expect(BtnA.wasPressed()).toBe(false);
    expect(BtnA.wasReleased()).toBe(true);
    expect(BtnA.isPressed()).toBe(false);
    frame();
    expect(BtnA.wasPressed() || BtnA.wasReleased()).toBe(false);
  });

  it("two fast clicks in one frame come out as two clean press/release pairs", () => {
    for (let i = 0; i < 2; i++) {
      inputSet("B", true);
      inputSet("B", false);
    }
    const seen: string[] = [];
    for (let i = 0; i < 6; i++) {
      frame();
      if (BtnB.wasPressed()) seen.push("P");
      if (BtnB.wasReleased()) seen.push("R");
    }
    expect(seen.join("")).toBe("PRPR");
  });

  it("redundant presses and releases make no edges", () => {
    inputSet("A", false);
    frame();
    expect(BtnA.wasReleased()).toBe(false);
    inputSet("A", true);
    inputSet("A", true);
    frame();
    frame();
    expect(BtnA.wasPressed()).toBe(false);
    expect(BtnA.isPressed()).toBe(true);
  });

  it("pressedFor(ms) is true only while held for at least ms, measured from the real press", () => {
    inputSet("A", true); // t = 0
    frame(100);
    expect(BtnA.pressedFor(600)).toBe(false);
    now = 599;
    inputUpdate();
    expect(BtnA.pressedFor(600)).toBe(false);
    now = 600;
    inputUpdate();
    expect(BtnA.pressedFor(600)).toBe(true);
    expect(BtnA.pressedFor(601)).toBe(false);
    now = 650;
    inputSet("A", false);
    inputUpdate();
    expect(BtnA.pressedFor(600)).toBe(false);
    expect(BtnA.wasReleased()).toBe(true);
  });

  it("a frame that notices the press late still measures the hold from the press itself", () => {
    inputSet("A", true); // t = 0
    now = 650; // the loop stalled
    inputUpdate();
    expect(BtnA.wasPressed()).toBe(true);
    expect(BtnA.pressedFor(600)).toBe(true);
  });

  it("buttons are independent", () => {
    inputSet("B", true);
    frame();
    expect(BtnB.isPressed()).toBe(true);
    expect(BtnA.isPressed()).toBe(false);
  });
});

describe("power key", () => {
  it("short press: 0x02 once, after release", () => {
    inputSet("PWR", true);
    frame();
    expect(pwrGetBtnPress()).toBe(0);
    frame(200);
    inputSet("PWR", false);
    frame();
    expect(pwrGetBtnPress()).toBe(0x02);
    expect(pwrGetBtnPress()).toBe(0);
    frame();
    expect(pwrGetBtnPress()).toBe(0);
  });

  it("a click between two frames is still a short press", () => {
    inputSet("PWR", true);
    inputSet("PWR", false);
    frame();
    frame();
    expect(pwrGetBtnPress()).toBe(0x02);
  });

  it("released just under 1500 ms is short", () => {
    inputSet("PWR", true);
    frame(PWR_LONG_MS - 1);
    expect(pwrGetBtnPress()).toBe(0);
    inputSet("PWR", false);
    frame();
    expect(pwrGetBtnPress()).toBe(0x02);
  });

  it("long press: 0x01 once when the hold crosses 1500 ms, nothing on release", () => {
    inputSet("PWR", true); // t = 0
    frame(1000);
    expect(pwrGetBtnPress()).toBe(0);
    frame(PWR_LONG_MS - 1000 - 1);
    expect(pwrGetBtnPress()).toBe(0);
    frame(1); // t = 1500
    expect(pwrGetBtnPress()).toBe(0x01);
    expect(pwrGetBtnPress()).toBe(0);
    frame(500);
    expect(pwrGetBtnPress()).toBe(0);
    inputSet("PWR", false);
    frame();
    expect(pwrGetBtnPress()).toBe(0);
    frame();
    expect(pwrGetBtnPress()).toBe(0);
  });

  it("a long press released before the loop noticed the crossing is still 0x01, not 0x02", () => {
    inputSet("PWR", true); // t = 0
    now = 1800;
    inputSet("PWR", false);
    inputUpdate(); // press edge
    const first = pwrGetBtnPress();
    inputUpdate(); // release edge
    const second = pwrGetBtnPress();
    expect([first, second].filter((v) => v === 0x01)).toHaveLength(1);
    expect([first, second]).not.toContain(0x02);
  });

  it("each press resets the long-press latch", () => {
    inputSet("PWR", true);
    frame(PWR_LONG_MS);
    expect(pwrGetBtnPress()).toBe(0x01);
    inputSet("PWR", false);
    frame();
    frame(100);
    inputSet("PWR", true);
    frame();
    frame(PWR_LONG_MS);
    expect(pwrGetBtnPress()).toBe(0x01);
  });
});

describe("keyboard", () => {
  beforeEach(() => inputAttach(document.body));

  it("Space and KeyA drive A; Enter and KeyB drive B", () => {
    key("keydown", "Space");
    frame();
    expect(BtnA.wasPressed()).toBe(true);
    key("keyup", "Space");
    frame();
    expect(BtnA.wasReleased()).toBe(true);

    key("keydown", "Enter");
    frame();
    expect(BtnB.wasPressed()).toBe(true);
    key("keyup", "Enter");
    frame();
    expect(BtnB.wasReleased()).toBe(true);

    key("keydown", "KeyA");
    frame();
    expect(BtnA.isPressed()).toBe(true);
    key("keyup", "KeyA");
    key("keydown", "KeyB");
    frame();
    frame();
    expect(BtnB.isPressed()).toBe(true);
    expect(BtnA.isPressed()).toBe(false);
  });

  it("marks the on-screen button as down while a key holds it", () => {
    key("keydown", "Space");
    expect(document.getElementById("btnA")!.classList.contains("down")).toBe(true);
    key("keyup", "Space");
    expect(document.getElementById("btnA")!.classList.contains("down")).toBe(false);
  });

  it("ignores key auto-repeat", () => {
    key("keydown", "Space");
    key("keydown", "Space", { repeat: true });
    key("keydown", "Space", { repeat: true });
    key("keyup", "Space");
    frame();
    expect([BtnA.wasPressed(), BtnA.wasReleased()]).toEqual([true, false]);
    frame();
    expect([BtnA.wasPressed(), BtnA.wasReleased()]).toEqual([false, true]);
    frame();
    expect([BtnA.wasPressed(), BtnA.wasReleased()]).toEqual([false, false]);
  });

  it("prevents the default action (page scroll on Space) for handled keys only", () => {
    const space = new KeyboardEvent("keydown", { code: "Space", key: " ", bubbles: true, cancelable: true });
    document.body.dispatchEvent(space);
    expect(space.defaultPrevented).toBe(true);
    const other = new KeyboardEvent("keydown", { code: "KeyX", key: "x", bubbles: true, cancelable: true });
    document.body.dispatchEvent(other);
    expect(other.defaultPrevented).toBe(false);
  });

  it("Escape and M hold A for 700 ms, then release it (opens the menu)", () => {
    vi.useFakeTimers();
    for (const code of ["Escape", "KeyM"]) {
      now = 0;
      key("keydown", code);
      frame(16);
      expect(BtnA.wasPressed()).toBe(true);
      expect(BtnA.pressedFor(600)).toBe(false);
      now = 600;
      inputUpdate();
      expect(BtnA.pressedFor(600)).toBe(true); // the firmware's long-press threshold
      vi.advanceTimersByTime(MENU_HOLD_MS - 1);
      expect(BtnA.isPressed()).toBe(true);
      now = MENU_HOLD_MS;
      vi.advanceTimersByTime(1);
      inputUpdate();
      expect(BtnA.isPressed()).toBe(false);
      expect(BtnA.wasReleased()).toBe(true);
      inputReset();
    }
  });

  it("key auto-repeat on P or Esc does not retrigger the power key or the menu hold", () => {
    vi.useFakeTimers();
    key("keydown", "KeyP");
    for (let i = 0; i < 3; i++) {
      vi.advanceTimersByTime(30);
      key("keydown", "KeyP", { repeat: true });
    }
    vi.advanceTimersByTime(200);
    const seen: number[] = [];
    for (let i = 0; i < 6; i++) {
      frame();
      seen.push(pwrGetBtnPress());
    }
    expect(seen.filter((v) => v === 0x02)).toHaveLength(1);

    key("keydown", "Escape");
    key("keydown", "Escape", { repeat: true });
    vi.advanceTimersByTime(MENU_HOLD_MS + 10);
    now += MENU_HOLD_MS + 10;
    let presses = 0;
    for (let i = 0; i < 4; i++) {
      inputUpdate();
      if (BtnA.wasPressed()) presses++;
    }
    expect(presses).toBe(1);
    expect(BtnA.isPressed()).toBe(false);
  });

  it("P is a short power press", () => {
    vi.useFakeTimers();
    key("keydown", "KeyP");
    frame();
    vi.advanceTimersByTime(100);
    frame();
    expect(pwrGetBtnPress()).toBe(0x02);
  });

  it("ignores keys typed into an <input> or <textarea>", () => {
    const field = document.getElementById("field") as HTMLInputElement;
    field.focus();
    key("keydown", "Space", {}, field);
    key("keydown", "Enter", {}, field);
    key("keydown", "KeyP", {}, field);
    frame();
    frame();
    expect(BtnA.isPressed() || BtnB.isPressed()).toBe(false);
    expect(pwrGetBtnPress()).toBe(0);

    const area = document.createElement("textarea");
    document.body.append(area);
    area.focus();
    key("keydown", "Space", {}, area);
    frame();
    expect(BtnA.isPressed()).toBe(false);
  });

  it("ignores keys while a modal is open, but still lets go of a held key", () => {
    key("keydown", "Space");
    frame();
    document.body.classList.add("modal-open");
    key("keydown", "Enter");
    frame();
    expect(BtnB.isPressed()).toBe(false);
    key("keyup", "Space");
    frame();
    expect(BtnA.isPressed()).toBe(false);
  });

  it("ignores Ctrl/Cmd/Alt chords", () => {
    key("keydown", "KeyA", { ctrlKey: true });
    key("keydown", "KeyP", { metaKey: true });
    frame();
    expect(BtnA.isPressed()).toBe(false);
    expect(pwrGetBtnPress()).toBe(0);
  });

  it("releases held keys when the window loses focus", () => {
    key("keydown", "Space");
    frame();
    window.dispatchEvent(new Event("blur"));
    frame();
    expect(BtnA.isPressed()).toBe(false);
  });

  it("inputReleaseKeys() lets go of every key-held button but leaves pointers and the api alone", () => {
    key("keydown", "Space");
    key("keydown", "Enter");
    pointer("pointerdown", document.getElementById("btnPwr")!, 8);
    inputSet("A", true);
    frame();
    inputReleaseKeys();
    frame();
    expect(BtnB.isPressed()).toBe(false);
    expect(BtnA.isPressed()).toBe(true); // "api" still holds A
    expect(document.getElementById("btnB")!.classList.contains("down")).toBe(false);
    expect(document.getElementById("btnPwr")!.classList.contains("down")).toBe(true);
    inputSet("A", false);
    frame();
    expect(BtnA.isPressed()).toBe(false);
  });

  it("releases pointer-held buttons when the window loses focus", () => {
    pointer("pointerdown", document.getElementById("btnA")!, 7);
    pointer("pointerdown", document.getElementById("btnPwr")!, 9);
    frame();
    expect(BtnA.isPressed()).toBe(true);
    window.dispatchEvent(new Event("blur"));
    frame();
    expect(BtnA.isPressed()).toBe(false);
    expect(document.getElementById("btnA")!.classList.contains("down")).toBe(false);
    expect(document.getElementById("btnPwr")!.classList.contains("down")).toBe(false);
  });

  it("releases keys, pointers and the timed holds when the page becomes hidden", () => {
    vi.useFakeTimers();
    const vis = vi.spyOn(document, "visibilityState", "get");
    try {
      key("keydown", "Enter");
      key("keydown", "Escape"); // timed menu hold on A
      pointer("pointerdown", document.getElementById("btnPwr")!, 10);
      frame();
      expect(BtnA.isPressed() && BtnB.isPressed()).toBe(true);

      vis.mockReturnValue("visible");
      document.dispatchEvent(new Event("visibilitychange"));
      frame();
      expect(BtnB.isPressed()).toBe(true); // becoming visible changes nothing

      vis.mockReturnValue("hidden");
      document.dispatchEvent(new Event("visibilitychange"));
      frame();
      frame();
      expect([BtnA.isPressed(), BtnB.isPressed()]).toEqual([false, false]);
      expect(document.getElementById("btnPwr")!.classList.contains("down")).toBe(false);

      // The cancelled menu hold must not wedge Esc / M for later.
      vis.mockReturnValue("visible");
      key("keydown", "Escape");
      frame();
      expect(BtnA.wasPressed()).toBe(true);
    } finally {
      vis.mockRestore();
    }
  });

  it("stops listening after inputDetach()", () => {
    inputDetach();
    key("keydown", "Space");
    frame();
    expect(BtnA.isPressed()).toBe(false);
  });

  it("re-attaching replaces the old listeners instead of stacking them", () => {
    inputAttach(document.body);
    inputAttach(document.body);
    inputDetach(); // a single detach must remove everything
    key("keydown", "Space");
    frame();
    expect(BtnA.isPressed()).toBe(false);
  });
});

describe("pointer", () => {
  beforeEach(() => inputAttach(document.body));

  it("pressing the on-screen buttons drives the matching Button", () => {
    const a = document.getElementById("btnA")!;
    const b = document.getElementById("btnB")!;
    pointer("pointerdown", a, 1);
    frame();
    expect(BtnA.wasPressed()).toBe(true);
    expect(a.classList.contains("down")).toBe(true);
    pointer("pointerup", a, 1);
    frame();
    expect(BtnA.wasReleased()).toBe(true);
    expect(a.classList.contains("down")).toBe(false);

    pointer("pointerdown", b, 2);
    pointer("pointerup", b, 2);
    frame();
    frame();
    expect(BtnB.isPressed()).toBe(false);
  });

  it("releases when the pointer comes up somewhere else (or is cancelled)", () => {
    const a = document.getElementById("btnA")!;
    pointer("pointerdown", a, 3);
    frame();
    expect(BtnA.isPressed()).toBe(true);
    pointer("pointerup", document.body, 3);
    frame();
    expect(BtnA.isPressed()).toBe(false);

    pointer("pointerdown", a, 4);
    pointer("pointercancel", document.body, 4);
    frame();
    frame();
    expect(BtnA.isPressed()).toBe(false);
  });

  it("stays down while another source (a key) still holds the button", () => {
    const a = document.getElementById("btnA")!;
    pointer("pointerdown", a, 5);
    key("keydown", "Space");
    pointer("pointerup", a, 5);
    frame();
    frame();
    expect(BtnA.isPressed()).toBe(true);
    expect(BtnA.wasReleased()).toBe(false);
    key("keyup", "Space");
    frame();
    expect(BtnA.wasReleased()).toBe(true);
  });

  it("holding the on-screen power key past 1.5 s is the long press", () => {
    pointer("pointerdown", document.getElementById("btnPwr")!, 6);
    frame();
    frame(PWR_LONG_MS);
    expect(pwrGetBtnPress()).toBe(0x01);
  });
});

describe("db-path overlay", () => {
  const flush = async (): Promise<void> => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };
  const overlay = (): HTMLElement | null => document.getElementById("dbOverlay");
  const field = (): HTMLInputElement => overlay()!.querySelector("input")!;
  const click = (label: string): void => {
    [...overlay()!.querySelectorAll("button")].find((b) => b.textContent === label)!.click();
  };

  beforeEach(() => inputAttach(document.body));

  it("opens with the resolved path as placeholder and swallows keys while up", async () => {
    openDbSettings();
    await flush();
    expect(overlay()).not.toBeNull();
    expect(field().placeholder).toBe("~/.hermes/state.db");
    expect(field().value).toBe("");
    expect(document.body.classList.contains("modal-open")).toBe(true);

    // Typed into the field and dispatched on the body: neither may reach the buttons.
    key("keydown", "Space", {}, field());
    key("keydown", "Enter", {}, document.body);
    key("keydown", "KeyP", {}, document.body);
    frame();
    frame();
    expect(BtnA.isPressed() || BtnB.isPressed()).toBe(false);
    expect(pwrGetBtnPress()).toBe(0);
  });

  it("a second openDbSettings() does not stack overlays", async () => {
    openDbSettings();
    openDbSettings();
    await flush();
    expect(document.querySelectorAll("#dbOverlay")).toHaveLength(1);
  });

  it("Save stores the typed path; Save with an empty field means 'use default'", async () => {
    openDbSettings();
    await flush();
    field().value = "  /srv/hermes/state.db ";
    click("Save");
    await flush();
    expect(overlay()).toBeNull();
    expect(document.body.classList.contains("modal-open")).toBe(false);
    expect(JSON.parse(localStorage.getItem("hermes-buddy:dbPath")!)).toBe("/srv/hermes/state.db");

    openDbSettings();
    await flush();
    expect(field().value).toBe("/srv/hermes/state.db"); // current override pre-filled
    field().value = "   ";
    click("Save");
    await flush();
    expect(localStorage.getItem("hermes-buddy:dbPath")).toBeNull();
  });

  it("Use default clears the override; Cancel and Escape change nothing", async () => {
    localStorage.setItem("hermes-buddy:dbPath", JSON.stringify("/old/state.db"));
    openDbSettings();
    await flush();
    click("Cancel");
    await flush();
    expect(overlay()).toBeNull();
    expect(JSON.parse(localStorage.getItem("hermes-buddy:dbPath")!)).toBe("/old/state.db");

    openDbSettings();
    await flush();
    field().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(overlay()).toBeNull();
    expect(JSON.parse(localStorage.getItem("hermes-buddy:dbPath")!)).toBe("/old/state.db");

    openDbSettings();
    await flush();
    click("Use default");
    await flush();
    expect(overlay()).toBeNull();
    expect(localStorage.getItem("hermes-buddy:dbPath")).toBeNull();
  });

  it("Enter held while the overlay opens does not leave B stuck (its keyup lands in the overlay)", async () => {
    key("keydown", "Enter");
    frame();
    expect(BtnB.isPressed()).toBe(true);
    openDbSettings();
    await flush();
    const seen = vi.fn();
    window.addEventListener("keyup", seen);
    key("keyup", "Enter", {}, field());
    window.removeEventListener("keyup", seen);
    expect(seen).toHaveBeenCalledTimes(1); // the overlay must not swallow keyups the input layer tracks
    click("Cancel");
    await flush();
    (document.activeElement as HTMLElement | null)?.blur();
    frame();
    frame();
    expect(BtnB.isPressed()).toBe(false);

    key("keydown", "Enter");
    frame();
    expect(BtnB.wasPressed()).toBe(true);
    key("keyup", "Enter");
    frame();
    pointer("pointerdown", document.getElementById("btnB")!, 11);
    frame();
    expect(BtnB.wasPressed()).toBe(true); // clicks are not dead either
  });

  it("opening the overlay releases keyboard-held buttons even if no keyup ever arrives", async () => {
    key("keydown", "Space");
    key("keydown", "Enter");
    frame();
    expect(BtnA.isPressed() && BtnB.isPressed()).toBe(true);
    openDbSettings();
    await flush();
    frame();
    frame();
    expect([BtnA.isPressed(), BtnB.isPressed()]).toEqual([false, false]);
    click("Cancel");
    await flush();
    key("keydown", "Enter");
    frame();
    expect(BtnB.wasPressed()).toBe(true);
  });

  it("ignores auto-repeat of Enter and Escape, but still lets the field repeat characters", async () => {
    openDbSettings();
    await flush();
    const input = field();
    input.value = "/typed/state.db";
    const rep = (k: string): KeyboardEvent => {
      const ev = new KeyboardEvent("keydown", { key: k, repeat: true, bubbles: true, cancelable: true });
      input.dispatchEvent(ev);
      return ev;
    };
    rep("Enter");
    rep("Escape");
    expect(overlay()).not.toBeNull();
    expect(localStorage.getItem("hermes-buddy:dbPath")).toBeNull();
    expect(rep("a").defaultPrevented).toBe(false);

    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    await flush();
    expect(overlay()).toBeNull();
    expect(JSON.parse(localStorage.getItem("hermes-buddy:dbPath")!)).toBe("/typed/state.db");
  });

  it("Enter in the field saves; the buttons work again afterwards", async () => {
    openDbSettings();
    await flush();
    field().value = "/data/state.db";
    field().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    await flush();
    expect(overlay()).toBeNull();
    expect(JSON.parse(localStorage.getItem("hermes-buddy:dbPath")!)).toBe("/data/state.db");
    (document.activeElement as HTMLElement | null)?.blur();

    key("keydown", "Space");
    frame();
    expect(BtnA.wasPressed()).toBe(true);
  });
});

describe("deviceInfo", () => {
  it("names the OS from the user agent", () => {
    const ua = vi.spyOn(navigator, "userAgent", "get");
    const cases: Array<[string, string]> = [
      ["Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15", "macOS"],
      ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Edg/126", "Windows"],
      ["Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15", "Linux"],
    ];
    for (const [agent, os] of cases) {
      ua.mockReturnValue(agent);
      expect(deviceInfo().os).toBe(os);
    }
    ua.mockRestore();
    expect(deviceInfo().app).toBe("Hermes Buddy");
  });
});

describe("platform fallbacks (browser, no Tauri)", () => {
  it("setLed toggles the lit class on #led", () => {
    document.body.innerHTML = '<span id="led" class="led"></span>';
    setLed(true);
    expect(document.getElementById("led")!.classList.contains("lit")).toBe(true);
    setLed(false);
    expect(document.getElementById("led")!.classList.contains("lit")).toBe(false);
  });

  it("attachRotation turns the bezel for odd rotations only", () => {
    const display = {} as Display;
    attachRotation(display);
    expect(typeof display.onRotationChange).toBe("function");
    display.onRotationChange!(1);
    expect(document.body.classList.contains("landscape")).toBe(true);
    display.onRotationChange!(0);
    expect(document.body.classList.contains("landscape")).toBe(false);
    display.onRotationChange!(3);
    expect(document.body.classList.contains("landscape")).toBe(true);
    setLandscape(false);
    expect(document.body.classList.contains("landscape")).toBe(false);
  });

  it("saveJson / loadJson round-trip through localStorage under hermes-buddy:<name>", async () => {
    saveJson("stats", { pets: 3, level: 2 });
    expect(JSON.parse(localStorage.getItem("hermes-buddy:stats")!)).toEqual({ pets: 3, level: 2 });
    expect(await loadJson("stats", { pets: 0, level: 0, napSeconds: 5 })).toEqual({ pets: 3, level: 2, napSeconds: 5 });
    expect(await loadJson("nothing-here", { a: 1 })).toEqual({ a: 1 });
    saveJson("list", [1, 2]);
    expect(await loadJson<number[]>("list", [])).toEqual([1, 2]);
    localStorage.setItem("hermes-buddy:broken", "{not json");
    expect(await loadJson("broken", { ok: true })).toEqual({ ok: true });
  });

  it("getConfig gives a placeholder path; factoryReset wipes saved blobs but keeps the db path", async () => {
    expect(await getConfig()).toEqual({ dbPath: null, dbPathResolved: "~/.hermes/state.db" });
    localStorage.setItem("hermes-buddy:dbPath", JSON.stringify("/x/state.db"));
    saveJson("settings", { sound: false });
    expect(await getConfig()).toEqual({ dbPath: "/x/state.db", dbPathResolved: "/x/state.db" });
    await factoryReset();
    expect(localStorage.getItem("hermes-buddy:settings")).toBeNull();
    expect(localStorage.getItem("hermes-buddy:dbPath")).not.toBeNull();
  });

  it("onNapChange follows page visibility, and unsubscribes", () => {
    const cb = vi.fn();
    const off = onNapChange(cb);
    const vis = vi.spyOn(document, "visibilityState", "get");
    vis.mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    vis.mockReturnValue("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(cb.mock.calls).toEqual([[true], [false]]);
    off();
    document.dispatchEvent(new Event("visibilitychange"));
    expect(cb).toHaveBeenCalledTimes(2);
    vis.mockRestore();
  });

  it("onShake: Shift+S in the browser, not while typing, and unsubscribes", () => {
    mountBezel();
    const cb = vi.fn();
    const off = onShake(cb);
    key("keydown", "KeyS", { shiftKey: true });
    expect(cb).toHaveBeenCalledTimes(1);
    key("keydown", "KeyS"); // no shift
    key("keydown", "KeyS", { shiftKey: true, repeat: true });
    expect(cb).toHaveBeenCalledTimes(1);
    const field = document.getElementById("field") as HTMLInputElement;
    field.focus();
    key("keydown", "KeyS", { shiftKey: true }, field);
    expect(cb).toHaveBeenCalledTimes(1);
    field.blur();
    off();
    key("keydown", "KeyS", { shiftKey: true });
    expect(cb).toHaveBeenCalledTimes(1);
  });
});

describe("beep", () => {
  interface FakeNode {
    connect: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
  }
  interface FakeOsc extends FakeNode {
    type: string;
    frequency: { value: number };
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    onended: (() => void) | null;
  }
  interface FakeGain extends FakeNode {
    gain: { setValueAtTime: ReturnType<typeof vi.fn>; linearRampToValueAtTime: ReturnType<typeof vi.fn> };
  }

  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).AudioContext;
  });

  it("stays silent until a user gesture, then plays a quiet square wave and preempts the previous tone", async () => {
    vi.resetModules();
    const contexts: FakeCtx[] = [];
    const oscs: FakeOsc[] = [];
    const gains: FakeGain[] = [];
    class FakeCtx {
      state = "suspended";
      currentTime = 0;
      destination = { id: "dest" };
      resume = vi.fn(async () => {
        this.state = "running";
      });
      constructor() {
        contexts.push(this);
      }
      createOscillator(): FakeOsc {
        const o: FakeOsc = {
          type: "",
          frequency: { value: 0 },
          connect: vi.fn((n: unknown) => n),
          disconnect: vi.fn(),
          start: vi.fn(),
          stop: vi.fn(),
          onended: null,
        };
        oscs.push(o);
        return o;
      }
      createGain(): FakeGain {
        const g: FakeGain = {
          gain: { setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() },
          connect: vi.fn((n: unknown) => n),
          disconnect: vi.fn(),
        };
        gains.push(g);
        return g;
      }
    }
    (window as unknown as Record<string, unknown>).AudioContext = FakeCtx;

    const fresh = await import("../src/hw/platform");
    fresh.beep(1800, 30); // no gesture yet
    expect(contexts).toHaveLength(0);
    expect(oscs).toHaveLength(0);

    window.dispatchEvent(new Event("pointerdown"));
    expect(contexts.length).toBeGreaterThanOrEqual(1);
    expect(contexts.some((c) => c.resume.mock.calls.length > 0)).toBe(true);

    fresh.beep(1800, 30);
    expect(oscs).toHaveLength(1);
    expect(oscs[0].type).toBe("square");
    expect(oscs[0].frequency.value).toBe(1800);
    expect(oscs[0].start).toHaveBeenCalled();
    expect(oscs[0].stop).toHaveBeenCalled();
    const peak = Math.max(...gains[0].gain.linearRampToValueAtTime.mock.calls.map((c) => c[0] as number));
    expect(peak).toBeCloseTo(0.05, 3);

    const firstStops = oscs[0].stop.mock.calls.length;
    fresh.beep(2400, 60); // M5.Beep.tone preempts
    expect(oscs).toHaveLength(2);
    expect(oscs[0].stop.mock.calls.length).toBe(firstStops + 1);
    expect(oscs[1].frequency.value).toBe(2400);

    fresh.beep(0, 50);
    fresh.beep(440, 0);
    expect(oscs).toHaveLength(2);
  });
});
