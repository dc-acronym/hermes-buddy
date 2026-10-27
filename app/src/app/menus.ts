// Menus — port of main.cpp drawMenu/drawSettings/drawReset/menuConfirm/applySetting/
// applyReset/nextPet. OWNER: loop+menus+stats agent. Frozen contract.
//
// Desktop mapping (PLAN.md): settings "bluetooth" → hermes (db-path overlay), "wifi" →
// on top (always-on-top), "turn off" → screen off instead of AXP power-off, and a
// factory reset reloads the page instead of ESP.restart().

import type { Palette } from "../data/types";
import { TFT_GREEN } from "../hw/tft";
import { millis, openDbSettings, setAlwaysOnTop, deleteCharacter, factoryReset } from "../hw/platform";
import { dataDemo, dataSetDemo, dataConnected } from "../data/source";
import { characterPalette, characterInvalidate, characterInit } from "../character";
import {
  buddyInvalidate, buddyNextSpecies, buddySetSpeciesIdx, buddySpeciesCount, buddySpeciesIdx,
} from "../buddy/buddy";
import { settings, settingsSave, speciesIdxSave, statsReset } from "../stats";
import {
  DisplayMode, H, HOT, INFO_PG_BUTTONS, INFO_PG_CREDITS, PANEL, SPECIES_GIF, W, display, spr, ui,
} from "./state";
import { applyBrightness, applyDisplayMode, beepIf, clearOverlay } from "./loop";

export const menuItems = ["settings", "turn off", "help", "about", "demo", "close"] as const;
export const MENU_N = menuItems.length;
export const settingsItems = ["brightness", "sound", "hermes", "on top", "led", "transcript", "clock rot", "ascii pet", "reset", "back"] as const;
export const SETTINGS_N = settingsItems.length;
export const resetItems = ["delete char", "factory reset", "back"] as const;
export const RESET_N = resetItems.length;
export const MENU_HINT_H = 14;

// "t is still in the future". The firmware's (int32_t)(millis() - t) < 0 only guards
// against wrap; millis() here is a non-wrapping double, so compare directly.
function before(t: number): boolean {
  return millis() < t;
}

// Cycle GIF (if installed) → ASCII species 0..N-1 → GIF. Persisted to the
// "species" key in the buddy blob; 0xFF means GIF mode.
export function nextPet(): void {
  const n = buddySpeciesCount();
  if (!ui.buddyMode) {                          // GIF → species 0
    ui.buddyMode = true;
    buddySetSpeciesIdx(0);
    speciesIdxSave(0);
  } else if (buddySpeciesIdx() + 1 >= n && ui.gifAvailable) {  // last species → GIF
    ui.buddyMode = false;
    speciesIdxSave(SPECIES_GIF);
  } else {                                   // species i → species i+1
    buddyNextSpecies();
  }
  characterInvalidate();
  if (ui.buddyMode) buddyInvalidate();
}

export function applySetting(idx: number): void {
  const s = settings();
  switch (idx) {
    case 0:
      ui.brightLevel = (ui.brightLevel + 1) % 5;
      s.bright = ui.brightLevel;
      settingsSave();
      applyBrightness();
      return;
    case 1: s.sound = !s.sound; break;
    case 2:
      // Opens the db-path overlay; nothing to toggle here.
      openDbSettings();
      return;
    case 3:
      s.onTop = !s.onTop;
      setAlwaysOnTop(s.onTop);
      break;
    case 4: s.led = !s.led; break;
    case 5:
      s.hud = !s.hud;
      clearOverlay();   // nothing repaints the transcript strip once it's off
      break;
    case 6: s.clockRot = (s.clockRot + 1) % 3; break;
    case 7: nextPet(); return;
    case 8:
      ui.resetOpen = true; ui.resetSel = 0; ui.resetConfirmIdx = 0xff;
      clearOverlay();   // the reset panel is shorter than the settings panel under it
      return;
    case 9: ui.settingsOpen = false; clearOverlay(); return;
  }
  settingsSave();
}

// Tap-twice confirm: first tap arms (label flips to "really?"), second
// within 3s executes. Scrolling away clears the arm.
export async function applyReset(idx: number): Promise<void> {
  const now = millis();
  const armed = (ui.resetConfirmIdx === idx) && before(ui.resetConfirmUntil);

  if (idx === 2) { ui.resetOpen = false; return; }

  if (!armed) {
    ui.resetConfirmIdx = idx;
    ui.resetConfirmUntil = now + 3000;
    beepIf(1400, 60);
    return;
  }

  beepIf(800, 200);
  if (idx === 0) {
    // delete char: wipe the installed pack, fall back to ASCII mode
    await deleteCharacter();
    await characterInit(null);
    ui.gifAvailable = false;
    ui.buddyMode = true;
    speciesIdxSave(buddySpeciesIdx());
    // The firmware restarts here; land back on the home screen instead.
    ui.resetOpen = false;
    ui.settingsOpen = false;
    applyDisplayMode();
    buddyInvalidate();
  } else {
    // factory reset: stored JSON + installed character wiped, in-memory
    // stats/settings/species back to defaults, then a fresh boot.
    await factoryReset();
    statsReset();
    location.reload();
  }
}

// Footer hint row inside a menu panel: "<downLbl> ↓  <rightLbl> →" with
// pixel triangles. Panels add MENU_HINT_H to height and call this at bottom.
function drawMenuHints(p: Palette, mx: number, mw: number, hy: number,
                       downLbl = "A", rightLbl = "B"): void {
  spr.drawFastHLine(mx + 6, hy - 4, mw - 12, p.textDim);
  spr.setTextColor(p.textDim, PANEL);
  // 6px/glyph at size 1; triangle goes 4px after the label ends
  let x = mx + 8;
  spr.setCursor(x, hy); spr.print(downLbl);
  x += downLbl.length * 6 + 4;
  spr.fillTriangle(x, hy + 1, x + 6, hy + 1, x + 3, hy + 6, p.textDim);
  x = mx + Math.floor(mw / 2) + 4;
  spr.setCursor(x, hy); spr.print(rightLbl);
  x += rightLbl.length * 6 + 4;
  spr.fillTriangle(x, hy, x, hy + 6, x + 5, hy + 3, p.textDim);
}

export function drawSettings(): void {
  const p = characterPalette();
  const mw = 118, mh = 16 + SETTINGS_N * 14 + MENU_HINT_H;
  const mx = Math.floor((W - mw) / 2), my = Math.floor((H - mh) / 2);
  spr.fillRoundRect(mx, my, mw, mh, 4, PANEL);
  spr.drawRoundRect(mx, my, mw, mh, 4, p.textDim);
  spr.setTextSize(1);
  const s = settings();
  // Row 2 (hermes) isn't a toggle; its value shows whether the db is linked.
  const vals = [s.sound, dataConnected(), s.onTop, s.led, s.hud];
  for (let i = 0; i < SETTINGS_N; i++) {
    const sel = (i === ui.settingsSel);
    spr.setTextColor(sel ? p.text : p.textDim, PANEL);
    spr.setCursor(mx + 6, my + 8 + i * 14);
    spr.print(sel ? "> " : "  ");
    spr.print(settingsItems[i]);
    spr.setCursor(mx + mw - 36, my + 8 + i * 14);
    spr.setTextColor(p.textDim, PANEL);
    if (i === 0) {
      spr.printf("%u/4", ui.brightLevel);
    } else if (i >= 1 && i <= 5) {
      spr.setTextColor(vals[i - 1] ? TFT_GREEN : p.textDim, PANEL);
      if (i === 2) spr.print(vals[i - 1] ? "link" : "none");
      else spr.print(vals[i - 1] ? " on" : "off");
    } else if (i === 6) {
      const RN = ["auto", "port", "land"];
      spr.print(RN[s.clockRot]);
    } else if (i === 7) {
      const total = buddySpeciesCount() + (ui.gifAvailable ? 1 : 0);
      const pos = ui.buddyMode ? buddySpeciesIdx() + 1 : total;
      spr.printf("%u/%u", pos, total);
    }
  }
  drawMenuHints(p, mx, mw, my + mh - 12, "Next", "Change");
}

export function drawReset(): void {
  const p = characterPalette();
  const mw = 118, mh = 16 + RESET_N * 14 + MENU_HINT_H;
  const mx = Math.floor((W - mw) / 2), my = Math.floor((H - mh) / 2);
  spr.fillRoundRect(mx, my, mw, mh, 4, PANEL);
  spr.drawRoundRect(mx, my, mw, mh, 4, HOT);
  spr.setTextSize(1);
  for (let i = 0; i < RESET_N; i++) {
    const sel = (i === ui.resetSel);
    spr.setTextColor(sel ? p.text : p.textDim, PANEL);
    spr.setCursor(mx + 6, my + 8 + i * 14);
    spr.print(sel ? "> " : "  ");
    const armed = (i === ui.resetConfirmIdx) && before(ui.resetConfirmUntil);
    if (armed) spr.setTextColor(HOT, PANEL);
    spr.print(armed ? "really?" : resetItems[i]);
  }
  drawMenuHints(p, mx, mw, my + mh - 12);
}

export function menuConfirm(): void {
  switch (ui.menuSel) {
    case 0: ui.settingsOpen = true; ui.menuOpen = false; ui.settingsSel = 0; break;
    case 1:
      // No AXP to cut power: screen off (any button or the power button wakes it).
      ui.menuOpen = false;
      ui.screenOff = true;
      display().setPower(false);
      characterInvalidate();
      break;
    case 2:
    case 3:
      ui.menuOpen = false;
      ui.displayMode = DisplayMode.Info;
      ui.infoPage = (ui.menuSel === 2) ? INFO_PG_BUTTONS : INFO_PG_CREDITS;
      applyDisplayMode();
      characterInvalidate();
      break;
    case 4: dataSetDemo(!dataDemo()); break;
    case 5: ui.menuOpen = false; clearOverlay(); break;
  }
}

export function drawMenu(): void {
  const p = characterPalette();
  const mw = 118, mh = 16 + MENU_N * 14 + MENU_HINT_H;
  const mx = Math.floor((W - mw) / 2), my = Math.floor((H - mh) / 2);
  spr.fillRoundRect(mx, my, mw, mh, 4, PANEL);
  spr.drawRoundRect(mx, my, mw, mh, 4, p.textDim);
  spr.setTextSize(1);
  for (let i = 0; i < MENU_N; i++) {
    const sel = (i === ui.menuSel);
    spr.setTextColor(sel ? p.text : p.textDim, PANEL);
    spr.setCursor(mx + 6, my + 8 + i * 14);
    spr.print(sel ? "> " : "  ");
    spr.print(menuItems[i]);
    if (i === 4) spr.print(dataDemo() ? "  on" : "  off");
  }
  drawMenuHints(p, mx, mw, my + mh - 12);
}
