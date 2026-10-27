// UI globals shared by loop.ts, menus.ts and screens.ts — the port of main.cpp's
// file-scope variables. Plain mutable object so ported code reads `ui.menuOpen`
// where the firmware read `menuOpen`. Add fields only here (lead owns this file;
// agents may append fields at the end of `ui` if they must, never rename).

import { Sprite, type Display } from "../hw/tft";
import { PersonaState, emptyTama, type TamaState } from "../data/types";

export const W = 135;
export const H = 240;
export const CX = Math.floor(W / 2);
export const CY_BASE = 120;

// Colors used across multiple UI surfaces (RGB565)
export const HOT = 0xfa20; // red-orange: warnings, impatience
export const PANEL = 0x2104; // overlay panel background

/** The main 135x240 framebuffer (firmware: TFT_eSprite spr). */
export const spr = new Sprite(W, H);
/** Landscape clock framebuffer (firmware drew straight to M5.Lcd rotated). */
export const sprLand = new Sprite(H, W);

let _display: Display | null = null;
export function setDisplay(d: Display): void {
  _display = d;
}
export function display(): Display {
  if (!_display) throw new Error("display not initialised");
  return _display;
}

export enum DisplayMode {
  Normal = 0,
  Pet = 1,
  Info = 2,
  Count = 3,
}

export const INFO_PAGES = 6;
export const INFO_PG_BUTTONS = 1;
export const INFO_PG_CREDITS = 5;
export const PET_PAGES = 1; // was 2; how-to moved into Info → BUTTONS (B now pets)
export const SCREEN_OFF_MS = 30000; // unused on desktop (always "on USB")
export const SPECIES_GIF = 0xff;

export const ui = {
  tama: emptyTama() as TamaState,
  baseState: PersonaState.Sleep as PersonaState,
  activeState: PersonaState.Sleep as PersonaState,
  oneShotUntil: 0,
  t: 0, // frame counter (firmware: unsigned long t)

  // menus
  menuOpen: false,
  menuSel: 0,
  settingsOpen: false,
  settingsSel: 0,
  resetOpen: false,
  resetSel: 0,
  resetConfirmUntil: 0,
  resetConfirmIdx: 0xff,
  brightLevel: 4, // 0..4 -> brightness 20..100
  btnALong: false,
  pwrLongHandled: false,

  // display
  displayMode: DisplayMode.Normal as DisplayMode,
  infoPage: 0,
  petPage: 0,
  msgScroll: 0,
  hudMaxBack: 0, // rows of transcript behind the 3 shown, as of the last drawHUD (B wraps here)
  lastLineGen: 0,
  lastPromptId: "",
  lastInteractMs: 0,
  dimmed: false,
  screenOff: false,
  swallowBtnA: false,
  swallowBtnB: false,
  buddyMode: true, // true = ASCII species, false = GIF character
  gifAvailable: false,
  wakeTransitionUntil: 0,

  // nap (window minimized)
  napping: false,
  napStartMs: 0,
  promptArrivedMs: 0,

  // shake (set by platform.onShake, consumed by loop)
  shakePending: false,

  // clock
  clockOrient: 0, // 0 = portrait, 1 = landscape
  orientFrames: 0,
  paintedOrient: 0,
};
