// Main loop — port of main.cpp setup()/loop()/derive()/button handling.
// OWNER: loop+menus+stats agent. Frozen contract.
//
// Desktop differences from the stick (PLAN.md): watch-only (A/B never approve or
// deny), always "on USB" (no auto screen-off, RTC always valid), shake and
// face-down come from platform events instead of the IMU, B on the pet screen
// pets the buddy.

import { PersonaState, type CharacterPack, type TamaState } from "../data/types";
import { dataPoll } from "../data/source";
import { BtnA, BtnB, inputUpdate, pwrGetBtnPress } from "../hw/input";
import {
  beep, getCharacter, hideWindow, millis, onCharacterInstalled, onNapChange, onNextPet, onShake,
  setAlwaysOnTop, setLed,
} from "../hw/platform";
import {
  buddyInit, buddyInvalidate, buddySetPeek, buddyTick,
} from "../buddy/buddy";
import {
  characterInit, characterInvalidate, characterLoaded, characterPalette, characterSetPeek,
  characterSetState, characterTick,
} from "../character";
import {
  settings, settingsLoad, speciesIdxLoad, speciesIdxSave, statsLoad, statsOnNapEnd, statsOnPet,
  statsOnWake, statsPollLevelUp,
} from "../stats";
import {
  clockDow, clockHour, clockUpdateOrient, drawClock, drawHUD, drawInfo, drawPet, drawSplash,
} from "./screens";
import {
  RESET_N, MENU_N, SETTINGS_N, applyReset, applySetting, drawMenu, drawReset, drawSettings,
  menuConfirm, nextPet,
} from "./menus";
import {
  DisplayMode, INFO_PAGES, SPECIES_GIF, display, spr, ui,
} from "./state";

// file-scope bits of main.cpp that aren't part of the shared `ui` object
let lastShakeCheck = 0;
let wasClocking = false;
let wasLandscape = false;
let unsubs: (() => void)[] = [];

// The firmware wrote (int32_t)(now - t) >= 0 to survive millis() wrapping at 49 days.
// Here millis() is a plain double that never wraps, and an int32 cast would go wrong
// after 24.8 days of uptime (deadlines still at 0), so compare directly.
function reached(now: number, t: number): boolean {
  return now >= t;
}

export function applyBrightness(): void {
  display().setBrightness(20 + ui.brightLevel * 20);
}

export function wake(): void {
  ui.lastInteractMs = millis();
  if (ui.screenOff) {
    display().setPower(true);
    applyBrightness();
    ui.screenOff = false;
    ui.wakeTransitionUntil = millis() + 12000;
  }
  if (ui.dimmed) { applyBrightness(); ui.dimmed = false; }
}

/** beep() gated on settings().sound. */
export function beepIf(freq: number, dur: number): void {
  if (settings().sound) beep(freq, dur);
}

export function applyDisplayMode(): void {
  const peek = ui.displayMode !== DisplayMode.Normal;
  characterSetPeek(peek);
  buddySetPeek(peek);
  // The clock block below sets peek only on a transition. This just overwrote its peek,
  // so make the next frame treat the clock (if up) as newly shown and set it again.
  wasClocking = false;
  wasLandscape = false;
  // Clear the whole sprite on mode switch. drawInfo/drawPet clear their
  // own regions when they run, but when you switch FROM info/pet TO normal,
  // those functions stop running and their stale pixels stay behind. Full
  // clear is cheap and guarantees no leftovers between modes.
  spr.fillSprite(0x0000);
  characterInvalidate();  // redraws character on next tick (text mode path)
}

// A menu panel can reach below the strip the ASCII pet repaints (the firmware's
// characterInvalidate() is a no-op when no GIF is loaded) and above the HUD strip,
// so closing one leaves a ghost of its lower edge. Wipe the sprite and repaint.
export function clearOverlay(): void {
  spr.fillSprite(0x0000);
  characterInvalidate();
  if (ui.buddyMode) buddyInvalidate();
}

/** !connected → Sleep; waiting → Attention; recentlyCompleted → Celebrate; running ≥ 1 → Busy; else Idle. */
export function derive(s: TamaState): PersonaState {
  if (!s.connected)            return PersonaState.Sleep;
  if (s.sessionsWaiting > 0)   return PersonaState.Attention;
  if (s.recentlyCompleted)     return PersonaState.Celebrate;
  if (s.sessionsRunning >= 1)  return PersonaState.Busy;
  return PersonaState.Idle;   // connected, 0 sessions running, nothing urgent — hang out
}

export function triggerOneShot(s: PersonaState, durMs: number): void {
  ui.activeState = s;
  ui.oneShotUntil = millis() + durMs;
}

// Window minimized/hidden = the stick lying face-down: dim immediately, pause
// animations, accumulate sleep time. Exit refills energy.
function onNap(napping: boolean): void {
  const now = millis();
  if (napping && !ui.napping) {
    ui.napping = true;
    ui.napStartMs = now;
    display().setBrightness(8);
    ui.dimmed = true;
  } else if (!napping && ui.napping) {
    ui.napping = false;
    statsOnNapEnd(Math.floor((now - ui.napStartMs) / 1000));
    statsOnWake();
    wake();
  }
}

async function onInstalled(pack: CharacterPack): Promise<void> {
  const ok = await characterInit(pack);
  ui.gifAvailable = ok;
  if (!ok) return;
  ui.buddyMode = false;
  speciesIdxSave(SPECIES_GIF);
  applyDisplayMode();  // wipes the ASCII pet, invalidates the new character
}

export async function setup(): Promise<void> {
  for (const u of unsubs) u();
  unsubs = [];
  lastShakeCheck = 0;
  wasClocking = false;
  wasLandscape = false;

  await statsLoad();
  await settingsLoad();
  ui.brightLevel = settings().bright;
  applyBrightness();
  setAlwaysOnTop(settings().onTop);
  ui.lastInteractMs = millis();
  buddyInit();

  ui.gifAvailable = await characterInit(await getCharacter());
  // species storage: 0..N-1 = ASCII species, 0xFF = use GIF (also the default,
  // so a fresh install lands on the GIF). With no GIF installed, 0xFF falls
  // through to buddyInit()'s clamped default.
  ui.buddyMode = !(ui.gifAvailable && speciesIdxLoad() === SPECIES_GIF);
  applyDisplayMode();

  unsubs.push(
    onShake(() => { ui.shakePending = true; }),
    onNapChange(onNap),
    onNextPet(nextPet),
    onCharacterInstalled((pack) => { void onInstalled(pack); }),
  );

  drawSplash();
  display().push(spr, 0);
  await new Promise<void>((r) => setTimeout(r, 1800));
}

let wasCompleted = false;

/** One frame. Called ~60 Hz by main.ts. */
export function loop(): void {
  inputUpdate();
  ui.t++;
  const tama = ui.tama;
  const now = millis();

  dataPoll(tama);   // also feeds statsOnBridgeTokens, once per real snapshot
  if (statsPollLevelUp()) triggerOneShot(PersonaState.Celebrate, 3000);
  // The desktop is always "on USB", so the idle clock face's persona schedule would
  // hide derive()'s recentlyCompleted → Celebrate for good. Cheer as a one-shot
  // instead (one-shots outrank the schedule), on the edge so it fires once.
  if (tama.recentlyCompleted && !wasCompleted) triggerOneShot(PersonaState.Celebrate, 3000);
  wasCompleted = tama.recentlyCompleted;
  ui.baseState = derive(tama);

  // After waking the screen, hold sleep for 12s so users see the wake-up
  // animation. Urgent states (attention, celebrate, busy) override this.
  if (ui.baseState === PersonaState.Idle && !reached(now, ui.wakeTransitionUntil)) ui.baseState = PersonaState.Sleep;

  if (reached(now, ui.oneShotUntil)) ui.activeState = ui.baseState;

  // LED: pulse on attention, otherwise off
  if (ui.activeState === PersonaState.Attention && settings().led) {
    setLed(Math.floor(now / 400) % 2 === 1);
  } else {
    setLed(false);
  }

  // shake → dizzy. The platform only raises a flag; consume it at the same 50 ms
  // cadence (and under the same conditions) the firmware polled the IMU at. A shake
  // that lands while a menu is open or the screen is off is dropped, not queued.
  if (now - lastShakeCheck > 50) {
    lastShakeCheck = now;
    const shook = ui.shakePending;
    ui.shakePending = false;
    if (shook && !ui.menuOpen && !ui.screenOff && reached(now, ui.oneShotUntil)) {
      wake();
      triggerOneShot(PersonaState.Dizzy, 2000);
    }
  }

  // Prompt arrival: beep. Watch-only, so there is no response flag to reset.
  if (tama.promptId !== ui.lastPromptId) {
    ui.lastPromptId = tama.promptId;
    if (tama.promptId) {
      ui.promptArrivedMs = millis();
      wake();
      beepIf(1200, 80);   // alert chirp
      // Jump to the attention screen no matter what was open — drawAttention
      // only runs from drawHUD which only runs in DisplayMode.Normal.
      ui.displayMode = DisplayMode.Normal;
      ui.menuOpen = ui.settingsOpen = ui.resetOpen = false;
      applyDisplayMode();
      characterInvalidate();
      if (ui.buddyMode) buddyInvalidate();
    } else {
      // The attention panel is taller than the transcript strip that replaces it,
      // and nothing else repaints that band once the prompt is answered elsewhere.
      clearOverlay();
    }
  }

  const inPrompt = tama.promptId !== "";

  // Button-press wake. Track which button woke the screen so its full
  // press cycle (including long-press) is swallowed — you don't want
  // BtnA-to-wake to also cycle displayMode or open the menu.
  // Keyed on the press edge, not isPressed(): menu "turn off" blanks the screen
  // while B is still held down, and a held button must not wake it straight back.
  if (BtnA.wasPressed() || BtnB.wasPressed()) {
    if (ui.screenOff) {
      if (BtnA.wasPressed()) ui.swallowBtnA = true;
      if (BtnB.wasPressed()) ui.swallowBtnB = true;
    }
    wake();
  }

  // Power button: short press toggles screen off. Long press (~1.5 s) hides the
  // window to the tray (the stick powers off via AXP hardware at 6 s).
  const pwr = pwrGetBtnPress();
  if (pwr === 0x02) {
    if (ui.screenOff) {
      wake();
    } else {
      display().setPower(false);
      ui.screenOff = true;
    }
  } else if (pwr === 0x01) {
    hideWindow();
  }

  if (BtnA.pressedFor(600) && !ui.btnALong && !ui.swallowBtnA) {
    ui.btnALong = true;
    beepIf(800, 60);
    if (ui.resetOpen) { ui.resetOpen = false; }
    else if (ui.settingsOpen) { ui.settingsOpen = false; clearOverlay(); }
    else {
      ui.menuOpen = !ui.menuOpen;
      ui.menuSel = 0;
      if (!ui.menuOpen) clearOverlay();
    }
  }
  if (BtnA.wasReleased()) {
    if (!ui.btnALong && !ui.swallowBtnA) {
      if (ui.resetOpen) {
        beepIf(1800, 30);
        ui.resetSel = (ui.resetSel + 1) % RESET_N;
        ui.resetConfirmIdx = 0xff;
      } else if (ui.settingsOpen) {
        beepIf(1800, 30);
        ui.settingsSel = (ui.settingsSel + 1) % SETTINGS_N;
      } else if (ui.menuOpen) {
        beepIf(1800, 30);
        ui.menuSel = (ui.menuSel + 1) % MENU_N;
      } else {
        beepIf(1800, 30);
        ui.displayMode = ((ui.displayMode + 1) % DisplayMode.Count) as DisplayMode;
        applyDisplayMode();
      }
    }
    ui.btnALong = false;
    ui.swallowBtnA = false;
  }

  // BtnB: pet → heart
  if (BtnB.wasPressed()) {
    if (ui.swallowBtnB) { ui.swallowBtnB = false; }
    else if (ui.resetOpen) {
      beepIf(2400, 30);
      applyReset(ui.resetSel).catch((e) => console.error("reset failed", e));
    } else if (ui.settingsOpen) {
      beepIf(2400, 30);
      applySetting(ui.settingsSel);
    } else if (ui.menuOpen) {
      beepIf(2400, 30);
      menuConfirm();
    } else if (ui.displayMode === DisplayMode.Info) {
      beepIf(2400, 30);
      ui.infoPage = (ui.infoPage + 1) % INFO_PAGES;
    } else if (ui.displayMode === DisplayMode.Pet) {
      // Every press hearts and beeps; statsOnPet() decides whether mood rises.
      statsOnPet();
      triggerOneShot(PersonaState.Heart, 2000);
      beepIf(2400, 30);
    } else {
      beepIf(2400, 30);
      // drawHUD clamps msgScroll to hudMaxBack every draw, so wrap there: the
      // firmware's fixed 30 is only reachable with a transcript that fills its buffer.
      ui.msgScroll = (ui.msgScroll >= ui.hudMaxBack) ? 0 : ui.msgScroll + 1;
    }
  }

  // Clock: takes over the home screen when nothing is happening — no overlays,
  // no prompt, no running or waiting sessions. The desktop is always "on USB" and
  // its clock is always valid, so those two firmware conditions are dropped.
  // Not while Hermes is missing: the home screen's status line is how you find out.
  // Pet sleeps underneath. Exit restores Y via applyDisplayMode() so the next
  // mode-switch isn't visually offset.
  const clocking = ui.displayMode === DisplayMode.Normal
               && !ui.menuOpen && !ui.settingsOpen && !ui.resetOpen && !inPrompt
               && tama.connected
               && tama.sessionsRunning === 0 && tama.sessionsWaiting === 0;
  if (clocking) clockUpdateOrient();
  else { ui.clockOrient = 0; ui.orientFrames = 0; ui.paintedOrient = 0; }
  const landscapeClock = clocking && ui.clockOrient !== 0;

  if (clocking !== wasClocking || landscapeClock !== wasLandscape) {
    if (clocking && !landscapeClock) {
      characterSetPeek(true);
      buddySetPeek(true);   // 1x keeps the ASCII pet above the clock's y=90 band
      spr.fillSprite(0x0000);   // the 2x pet reached y=126; drop its leftovers
    } else applyDisplayMode();
    characterInvalidate();
    if (ui.buddyMode) buddyInvalidate();
    wasClocking = clocking;
    wasLandscape = landscapeClock;
  }
  if (clocking && reached(now, ui.oneShotUntil)) {   // a one-shot (dizzy, heart) outranks the schedule
    const dow = clockDow();
    const weekend = (dow === 0 || dow === 6);
    const friday  = (dow === 5);

    const h = clockHour();
    if (h >= 1 && h < 7)             ui.activeState = PersonaState.Sleep;
    else if (weekend)                ui.activeState = (Math.floor(now / 8000) % 6 === 0) ? PersonaState.Heart : PersonaState.Sleep;
    else if (h < 9)                  ui.activeState = (Math.floor(now / 6000) % 4 === 0) ? PersonaState.Idle  : PersonaState.Sleep;
    else if (h === 12)               ui.activeState = (Math.floor(now / 5000) % 3 === 0) ? PersonaState.Heart : PersonaState.Idle;
    else if (friday && h >= 15)      ui.activeState = (Math.floor(now / 4000) % 3 === 0) ? PersonaState.Celebrate : PersonaState.Idle;
    else if (h >= 22 || h === 0)     ui.activeState = (Math.floor(now / 7000) % 3 === 0) ? PersonaState.Dizzy : PersonaState.Sleep;
    else                             ui.activeState = (Math.floor(now / 10000) % 5 === 0) ? PersonaState.Sleep : PersonaState.Idle;
  }

  if (ui.napping || ui.screenOff || landscapeClock) {
    // skip sprite render — minimized, powered off, or landscape clock
    // (which draws to its own surface below)
  } else if (ui.buddyMode) {
    buddyTick(ui.activeState);
  } else if (characterLoaded()) {
    characterSetState(ui.activeState);
    characterTick();
  } else {
    const p = characterPalette();
    spr.fillSprite(p.bg);
    spr.setTextColor(p.textDim, p.bg);
    spr.setTextSize(1);
    spr.setCursor(8, 100);
    spr.print("no character loaded");
  }
  if (!ui.napping && !ui.screenOff) {
    if (landscapeClock) {
      drawClock();   // pushes sprLand itself
    } else {
      if (clocking) drawClock();
      else if (ui.displayMode === DisplayMode.Info) drawInfo();
      else if (ui.displayMode === DisplayMode.Pet) drawPet();
      else if (settings().hud) drawHUD();
      if (ui.resetOpen) drawReset();
      else if (ui.settingsOpen) drawSettings();
      else if (ui.menuOpen) drawMenu();
      display().push(spr, 0);
    }
  }
}
