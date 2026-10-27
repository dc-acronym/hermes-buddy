// Screens — port of main.cpp drawClock/drawInfo/drawPet/drawHUD/drawApproval.
// OWNER: screens agent. Frozen contract: signatures below. All draw into `spr`
// (or `sprLand` for the landscape clock) from ./state.

import { MC_DATUM, TL_DATUM, TFT_GREEN, TFT_RED } from "../hw/tft";
import { STATE_NAMES, type Palette } from "../data/types";
import { millis, deviceInfo } from "../hw/platform";
import { characterPalette, characterRenderTo, characterSetState } from "../character";
import { buddyRenderTo } from "../buddy/buddy";
import {
  stats, settings, statsMoodTier, statsEnergyTier, statsFedProgress, petName, ownerName,
} from "../stats";
import { dataScenarioName } from "../data/source";
import { spr, sprLand, ui, display, W, H, CX, HOT, INFO_PAGES, PET_PAGES } from "./state";
import { wake } from "./loop";

// M5 names for the TFT_eSPI colors the firmware used bare
const GREEN = TFT_GREEN;
const RED = TFT_RED;

const z2 = (n: number): string => String(n).padStart(2, "0");

// Clock orientation: gravity along the in-plane X axis means the stick is
// on its side. The desktop has no IMU, so the Settings → clock rot value picks it.
//   0 = portrait (sprite path, pet sleeps underneath)
//   1 = landscape (composed into sprLand, pushed rotated by drawClock itself)
// ui.clockOrient / ui.orientFrames / ui.paintedOrient live in ./state.
// The wall clock replaces the RTC: always valid, cached once per second so mood
// logic and drawClock both read from the same snapshot.
interface ClockTime { hours: number; minutes: number; seconds: number; weekDay: number; month: number; date: number }
function readClock(): ClockTime {
  const d = new Date();
  return {
    hours: d.getHours(), minutes: d.getMinutes(), seconds: d.getSeconds(),
    weekDay: d.getDay(), month: d.getMonth() + 1, date: d.getDate(),
  };
}
let _clk: ClockTime = readClock();
let _clkLastRead = Number.NEGATIVE_INFINITY;
/** Refresh the cached wall-clock snapshot (1Hz internal throttle). drawClock calls it too. */
export function clockRefreshRtc(): void {
  const now = millis();
  if (now - _clkLastRead < 1000) return;
  _clkLastRead = now;
  _clk = readClock();
}

/** Desktop has no IMU: derive ui.clockOrient from settings().clockRot (auto/portrait → 0, land → 1). */
export function clockUpdateOrient(): void {
  const lock = settings().clockRot;
  // auto never tilts (no IMU), portrait is portrait; only the land lock goes sideways
  ui.clockOrient = (lock === 2) ? 1 : 0;
  // no tilt hysteresis to count; paintedOrient stays drawClock's to set
  ui.orientFrames = 0;
}

// Clock face: shown when nothing else is going on (the desktop is "on USB").
// Portrait paints the upper ~110px to the sprite; pet renders below.
// Landscape composes into sprLand — spr stays untouched.
const MON = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Local time helpers for the clock-mode persona schedule. */
export function clockDow(): number { return new Date().getDay(); }
export function clockHour(): number { return new Date().getHours(); }

let _lastSec = 0xff;      // landscape: second last painted (firmware: static lastSec)
let _lastPetTick = 0;     // landscape: millis of the last pet repaint

/** Portrait clock (pet peeks above) or landscape clock into sprLand when ui.clockOrient != 0. */
export function drawClock(): void {
  clockRefreshRtc();
  const p = characterPalette();
  const hm = `${z2(_clk.hours)}:${z2(_clk.minutes)}`;
  const ss = `:${z2(_clk.seconds)}`;
  const mi = (_clk.month >= 1 && _clk.month <= 12) ? _clk.month - 1 : 0;
  const dl = `${MON[mi]} ${z2(_clk.date)}`;

  if (ui.clockOrient === 0) {
    ui.paintedOrient = 0;
    // Bottom half — buddy naturally lives at y=0..82, GIF peeks at top
    // via peek mode. Clearing from 90 leaves both untouched.
    spr.fillRect(0, 90, W, H - 90, p.bg);
    spr.setTextDatum(MC_DATUM);
    spr.setTextSize(4); spr.setTextColor(p.text, p.bg);    spr.drawString(hm, CX, 140);
    spr.setTextSize(2); spr.setTextColor(p.textDim, p.bg); spr.drawString(ss, CX, 175);
    spr.setTextSize(1);                                     spr.drawString(dl, CX, 200);
    spr.setTextDatum(TL_DATUM);
    return;
  }

  // Landscape: 240×135 into sprLand. Full fill only on entry; after that
  // text glyph bg cells repaint themselves and the pet box (small, ~90×50)
  // gets a fillRect each pet tick. The whole sprite is pushed rotated at the end.
  const lcd = sprLand;
  const repaint = ui.paintedOrient !== ui.clockOrient;
  if (repaint) { lcd.fillScreen(p.bg); ui.paintedOrient = ui.clockOrient; _lastSec = 0xff; }

  // Seconds tick at 1Hz; redrawing 3 strings at 60fps is busywork.
  // Gate on the second changing (or full repaint).
  if (repaint || _clk.seconds !== _lastSec) {
    _lastSec = _clk.seconds;
    const wdl = `${DOW[_clk.weekDay % 7]} ${MON[mi]} ${z2(_clk.date)}`;
    const ssl = z2(_clk.seconds);
    lcd.setTextDatum(MC_DATUM);
    lcd.setTextSize(3); lcd.setTextColor(p.text, p.bg);    lcd.drawString(hm, 170, 42);
    lcd.setTextSize(2); lcd.setTextColor(p.textDim, p.bg); lcd.drawString(ssl, 170, 72);
                                                            lcd.drawString(wdl, 170, 102);
    lcd.setTextDatum(TL_DATUM);
    lcd.setTextSize(1);
  }

  // Pet on left at 5 fps. Clear includes the overlay-particle zone above
  // the body (y<30) — species draw Zzz/hearts there via BUDDY_Y_OVERLAY=6
  // which doesn't go through _yb, so the box has to cover it.
  const now = millis();
  if (now - _lastPetTick >= 200) {
    _lastPetTick = now;
    if (ui.buddyMode) {
      // ASCII glyphs don't self-clear; wipe the box each tick. Species
      // hardcode BUDDY_X_CENTER=67 / BUDDY_Y_OVERLAY=6 for particles so
      // keep portrait coords and just swap the surface — pet lands
      // upper-left of landscape, which is where we want it anyway.
      lcd.fillRect(0, 0, 115, 90, p.bg);
      buddyRenderTo(lcd, ui.activeState);
    } else {
      // Full-frame GIFs paint every pixel (transparent → pal.bg), so a
      // per-tick clear just adds a visible black flash between wipe and
      // last scanline. The entry fillScreen on paintedOrient change
      // already covers the surround.
      characterSetState(ui.activeState);
      characterRenderTo(lcd, 57, 45);
    }
  }
  // The loop only pushes spr; the landscape frame goes out here, turned a quarter.
  display().push(lcd, 1);
}

/** Boot splash ("Hello! / a buddy appears", or "<owner>'s / <pet>"). Draws into spr; setup() pushes it. */
export function drawSplash(): void {
  const p = characterPalette();
  spr.fillSprite(p.bg);
  spr.setTextDatum(MC_DATUM);
  spr.setTextSize(2);
  const owner = ownerName();
  if (owner) {
    const line = `${owner}'s`.slice(0, 39);
    spr.setTextColor(p.text, p.bg);   spr.drawString(line, Math.floor(W / 2), Math.floor(H / 2) - 12);
    spr.setTextColor(p.body, p.bg);   spr.drawString(petName(), Math.floor(W / 2), Math.floor(H / 2) + 12);
  } else {
    // First boot, no owner pushed yet — say hi.
    spr.setTextColor(p.body, p.bg);   spr.drawString("Hello!", Math.floor(W / 2), Math.floor(H / 2) - 12);
    spr.setTextSize(1);
    spr.setTextColor(p.textDim, p.bg);
    spr.drawString("a buddy appears", Math.floor(W / 2), Math.floor(H / 2) + 12);
  }
  spr.setTextDatum(TL_DATUM); spr.setTextSize(1);
}

// Greedy word-wrap into fixed-width rows. Continuation rows get a leading
// space. Returns the rows written (at most maxRows).
export function wrapInto(inp: string, maxRows: number, width: number): string[] {
  const out: string[] = [];
  let row = 0, col = 0;
  let cur = "";                                // out[row] under construction
  let i = 0;
  while (i < inp.length && row < maxRows) {
    while (inp[i] === " ") i++;                // skip leading spaces
    // measure next word
    let w = i;
    while (i < inp.length && inp[i] !== " ") i++;
    let wlen = i - w;
    if (wlen === 0) break;
    const need = (col > 0 ? 1 : 0) + wlen;
    if (col + need > width) {
      out[row] = cur;
      if (++row >= maxRows) return out;
      cur = " "; col = 1;                      // continuation indent
    }
    if (col > 1 || (col === 1 && cur[0] !== " ")) { cur += " "; col++; }
    // hard-break words that still don't fit
    while (wlen > width - col) {
      const take = width - col;
      cur += inp.slice(w, w + take); col += take; w += take; wlen -= take;
      out[row] = cur;
      if (++row >= maxRows) return out;
      cur = " "; col = 1;
    }
    cur += inp.slice(w, w + wlen); col += wlen;
  }
  if (col > 0 && row < maxRows) { out[row] = cur; row++; }
  return out;
}

// Word-wrap for the desktop-only text (db path, error, prompt hint): greedy, no indent on
// continuation rows, words longer than the row are cut at the width. wrapInto above keeps the
// firmware's exact quirks for the transcript; this one doesn't need them.
export function wrapWords(s: string, width: number, maxRows: number): string[] {
  const out: string[] = [];
  let cur = "";
  for (let word of s.split(/\s+/)) {
    if (!word) continue;
    while (word.length > width) {
      if (cur) { out.push(cur); cur = ""; if (out.length >= maxRows) return out; }
      out.push(word.slice(0, width)); word = word.slice(width);
      if (out.length >= maxRows) return out;
    }
    if (cur && cur.length + 1 + word.length > width) {
      out.push(cur); cur = "";
      if (out.length >= maxRows) return out;
    }
    cur = cur ? `${cur} ${word}` : word;
  }
  if (cur && out.length < maxRows) out.push(cur);
  return out;
}

// Token counts as 1.2K / 3.4M (the firmware's tokFmt).
function fmtTok(v: number): string {
  v = Math.floor(v);
  if (v >= 1000000) return `${Math.floor(v / 1000000)}.${Math.floor(v / 100000) % 10}M`;
  if (v >= 1000) return `${Math.floor(v / 1000)}.${Math.floor(v / 100) % 10}K`;
  return `${v}`;
}

// Persistent screen-level title row ("INFO  n/6") matching the PET header,
// then a per-page section label below it. The fixed title is the cue that
// B cycles pages here just like it does on PET. Returns the y below the header.
function _infoHeader(p: Palette, y: number, section: string, page: number): number {
  spr.setTextColor(p.text, p.bg);
  spr.setCursor(4, y); spr.print("Info");
  spr.setTextColor(p.textDim, p.bg);
  spr.setCursor(W - 28, y); spr.print(`${page + 1}/${INFO_PAGES}`);
  y += 12;
  spr.setTextColor(p.body, p.bg);
  spr.setCursor(4, y); spr.print(section);
  y += 12;
  return y;
}

/** Info pages 0..5: ABOUT, BUTTONS(+pet how-to), HERMES, DEVICE, DATABASE, "for v". */
export function drawInfo(): void {
  const p = characterPalette();
  const tama = ui.tama;
  const infoPage = ui.infoPage;
  const TOP = 70;
  spr.fillRect(0, TOP, W, H - TOP, p.bg);
  spr.setTextSize(1);
  let y = TOP + 2;
  // One 21-col row at x=4 (the firmware's ln() formatted into a char[32]).
  const ln = (s: string): void => {
    spr.setCursor(4, y); spr.print(s.slice(0, 31)); y += 8;
  };
  // "  label   value" — when the value won't fit in 21 cols it drops to its own row.
  const kv = (label: string, value: string, col = 12): void => {
    const head = `  ${label}`.padEnd(col);
    if (head.length + value.length <= 21) ln(head + value);
    else { ln(head.trimEnd()); ln(`    ${value.slice(0, 17)}`); }
  };

  if (infoPage === 0) {
    y = _infoHeader(p, y, "ABOUT", infoPage);
    spr.setTextColor(p.textDim, p.bg);
    ln("A desk pet that");
    ln("watches your local");
    ln("Hermes agent.");
    y += 6;
    ln("I sleep when Hermes");
    ln("is away, work when a");
    ln("session runs, dance");
    ln("when it needs you,");
    ln("cheer when one ends.");
    y += 6;
    spr.setTextColor(p.text, p.bg);
    ln("Watch-only: I never");
    ln("talk back to Hermes.");
    y += 6;
    spr.setTextColor(p.textDim, p.bg);
    ln("18 species. Settings");
    ln("> ascii pet to cycle.");

  } else if (infoPage === 1) {
    y = _infoHeader(p, y, "BUTTONS", infoPage);
    spr.setTextColor(p.text, p.bg);    ln("A   Space, click");
    spr.setTextColor(p.textDim, p.bg); ln("    next screen");
    spr.setTextColor(p.text, p.bg);    ln("B   Enter, click");
    spr.setTextColor(p.textDim, p.bg); ln("    page, scroll, pet");
    spr.setTextColor(p.text, p.bg);    spr.setCursor(4, y); spr.print("hold A");
    spr.setTextColor(p.textDim, p.bg); spr.print("  Esc/M: menu"); y += 8;
    spr.setTextColor(p.text, p.bg);    ln("Power  P, click");
    spr.setTextColor(p.textDim, p.bg); ln("    tap = screen off");
    ln("    hold = to tray"); y += 4;

    // the old PET how-to page, folded in here
    spr.setTextColor(p.body, p.bg);    ln("MOOD");
    spr.setTextColor(p.textDim, p.bg);
    ln(" B on PET = pet it");
    ln(" fades 1 heart / 3h");
    spr.setTextColor(p.body, p.bg);    ln("FED");
    spr.setTextColor(p.textDim, p.bg);
    ln(" 50K tokens =");
    ln(" level up + confetti");
    spr.setTextColor(p.body, p.bg);    ln("ENERGY");
    spr.setTextColor(p.textDim, p.bg);
    ln(" minimize to nap");
    ln(" refills to full");

  } else if (infoPage === 2) {
    y = _infoHeader(p, y, "HERMES", infoPage);
    spr.setTextColor(p.textDim, p.bg);
    ln(`  sessions  ${tama.sessionsTotal}`);
    ln(`  running   ${tama.sessionsRunning}`);
    ln(`  waiting   ${tama.sessionsWaiting}`);
    ln(`  state     ${STATE_NAMES[ui.activeState]}`);
    y += 6;
    spr.setTextColor(p.text, p.bg);
    ln("TOKENS");
    spr.setTextColor(p.textDim, p.bg);
    ln(`  today     ${fmtTok(tama.tokensToday)}`);
    ln(`  lifetime  ${fmtTok(tama.tokensLifetime)}`);
    y += 6;
    spr.setTextColor(p.text, p.bg);
    ln("MODEL");
    spr.setTextColor(p.textDim, p.bg);
    ln(`  ${tama.model || "-"}`);
    y += 6;
    spr.setTextColor(p.text, p.bg);
    ln("NOW");
    spr.setTextColor(p.textDim, p.bg);
    for (const row of wrapWords(tama.msg, 19, 3)) ln(`  ${row}`);

  } else if (infoPage === 3) {
    y = _infoHeader(p, y, "DEVICE", infoPage);
    const dev = deviceInfo();

    spr.setTextColor(p.text, p.bg);
    spr.setTextSize(2);
    spr.setCursor(4, y);
    spr.print(`v${dev.version}`.slice(0, 10));
    spr.setTextSize(1);
    y += 20;

    spr.setTextColor(p.textDim, p.bg);
    kv("app", dev.app, 9);
    kv("os", dev.os, 9);
    y += 8;

    spr.setTextColor(p.text, p.bg);
    ln("SYSTEM");
    spr.setTextColor(p.textDim, p.bg);
    if (ownerName()) kv("owner", ownerName(), 9);
    const up = Math.floor(millis() / 1000);
    kv("uptime", `${Math.floor(up / 3600)}h ${z2(Math.floor(up / 60) % 60)}m`, 9);
    kv("bright", `${settings().bright}/4`, 9);
    kv("on top", settings().onTop ? "on" : "off", 9);

  } else if (infoPage === 4) {
    y = _infoHeader(p, y, "DATABASE", infoPage);
    const linked = tama.connected;
    const err = tama.error;

    spr.setTextColor(linked ? GREEN : (err ? HOT : p.textDim), p.bg);
    spr.setTextSize(2);
    spr.setCursor(4, y);
    spr.print(linked ? "connected" : (err ? "error" : "offline"));
    spr.setTextSize(1);
    y += 20;

    spr.setTextColor(p.text, p.bg);
    ln("PATH");
    spr.setTextColor(p.textDim, p.bg);
    for (const row of wrapWords(tama.dbPath || "-", 19, 4)) ln(`  ${row}`);
    y += 6;

    if (err) {
      spr.setTextColor(HOT, p.bg);
      ln("ERROR");
      for (const row of wrapWords(err, 19, 4)) ln(`  ${row}`);
      y += 6;
    }

    spr.setTextColor(p.textDim, p.bg);
    kv("via", dataScenarioName());
    ln(`  schema    ${tama.schemaVersion ?? "-"}`);
    const age = tama.polledAt > 0 ? `${Math.max(0, Math.floor((Date.now() - tama.polledAt) / 1000))}s` : "never";
    ln(`  last poll ${age}`);

  } else {
    // Last page (was CREDITS; the licence lives in the repo): a dedication, centred
    // in the info area under the peeking pet.
    spr.setTextColor(p.text, p.bg);
    spr.setTextSize(2);
    spr.setTextDatum(MC_DATUM);
    spr.drawString("for v", CX, TOP + Math.floor((H - TOP) / 2));
    spr.setTextDatum(TL_DATUM);
    spr.setTextSize(1);
  }
}
function tinyHeart(x: number, y: number, filled: boolean, col: number): void {
  if (filled) {
    spr.fillCircle(x - 2, y, 2, col);
    spr.fillCircle(x + 2, y, 2, col);
    spr.fillTriangle(x - 4, y + 1, x + 4, y + 1, x, y + 5, col);
  } else {
    spr.drawCircle(x - 2, y, 2, col);
    spr.drawCircle(x + 2, y, 2, col);
    spr.drawLine(x - 4, y + 1, x, y + 5, col);
    spr.drawLine(x + 4, y + 1, x, y + 5, col);
  }
}

function drawPetStats(p: Palette): void {
  const TOP = 70;
  spr.fillRect(0, TOP, W, H - TOP, p.bg);
  spr.setTextSize(1);
  let y = TOP + 16;

  spr.setTextColor(p.textDim, p.bg);
  spr.setCursor(6, y - 2); spr.print("mood");
  const mood = statsMoodTier();
  const moodCol = (mood >= 3) ? RED : (mood >= 2) ? HOT : p.textDim;
  for (let i = 0; i < 4; i++) tinyHeart(54 + i * 16, y + 2, i < mood, moodCol);

  y += 20;
  spr.setCursor(6, y - 2); spr.print("fed");
  const fed = statsFedProgress();
  for (let i = 0; i < 10; i++) {
    const px = 38 + i * 9;
    if (i < fed) spr.fillCircle(px, y + 1, 2, p.body);
    else spr.drawCircle(px, y + 1, 2, p.textDim);
  }

  y += 20;
  spr.setCursor(6, y - 2); spr.print("energy");
  const en = statsEnergyTier();
  const enCol = (en >= 4) ? 0x07ff : (en >= 2) ? 0xffe0 : HOT;
  for (let i = 0; i < 5; i++) {
    const px = 54 + i * 13;
    if (i < en) spr.fillRect(px, y - 2, 9, 6, enCol);
    else spr.drawRect(px, y - 2, 9, 6, p.textDim);
  }

  y += 24;
  spr.fillRoundRect(6, y - 2, 42, 14, 3, p.body);
  spr.setTextColor(p.bg, p.body);
  spr.setCursor(11, y + 1); spr.print(`Lv ${stats().level}`);

  y += 20;
  spr.setTextColor(p.textDim, p.bg);
  spr.setCursor(6, y);
  spr.print(`pets     ${stats().pets}`);
  const nap = stats().napSeconds;
  spr.setCursor(6, y + 10);
  spr.print(`napped   ${Math.floor(nap / 3600)}h${z2(Math.floor(nap / 60) % 60)}m`);
  const tokFmt = (label: string, v: number, yPx: number): void => {
    spr.setCursor(6, yPx);
    spr.print(`${label}${fmtTok(v)}`);
  };
  tokFmt("tokens   ", stats().tokens, y + 20);
  tokFmt("today    ", ui.tama.tokensToday, y + 30);

  // B pets the buddy here now (it used to flip to the how-to page)
  spr.setTextColor(p.body, p.bg);
  spr.setCursor(6, H - 14); spr.print("B: pet me");
}

/** Pet screen: stats page (mood, fed, energy, level, pets, naps). */
export function drawPet(): void {
  const p = characterPalette();
  const y = 70;

  drawPetStats(p);

  // Header on top of the page — title left, counter right
  spr.setTextSize(1);
  spr.setTextColor(p.text, p.bg);
  spr.setCursor(4, y + 2);
  const owner = ownerName();
  if (owner) {
    spr.print(`${owner}'s ${petName()}`);
  } else {
    spr.print(petName());
  }
  spr.setTextColor(p.textDim, p.bg);
  spr.setCursor(W - 28, y + 2);
  spr.print(`${ui.petPage + 1}/${PET_PAGES}`);
}

/** Home HUD: transcript lines (B scrolls) or drawAttention() when a prompt is pending. */
export function drawHUD(): void {
  const tama = ui.tama;
  if (tama.promptId) { drawAttention(); return; }
  const p = characterPalette();
  // The firmware showed 3 rows. The 2x pet never draws below y=142 (measured over every
  // species/state), so 11 rows (y 148..240) fit under it; buddyTick's strip clear reaches
  // y=164 but the HUD repaints after it every frame.
  const SHOW = 11, LH = 8, WIDTH = 21;
  const AREA = SHOW * LH + 4;
  spr.fillRect(0, H - AREA, W, AREA, p.bg);
  spr.setTextSize(1);

  if (tama.lineGen !== ui.lastLineGen) { ui.msgScroll = 0; ui.lastLineGen = tama.lineGen; wake(); }

  if (tama.nLines === 0) {
    ui.hudMaxBack = 0;
    spr.setTextColor(p.text, p.bg);
    spr.setCursor(4, H - LH - 2);
    spr.print(tama.msg);
    return;
  }

  // Wrap all transcript lines into a flat display buffer. Track which
  // transcript index each display row came from, so we can dim older ones.
  const disp: string[] = [];
  const srcOf: number[] = [];
  for (let i = 0; i < tama.nLines; i++) {
    for (const r of wrapInto(tama.lines[i] ?? "", 32, WIDTH)) { disp.push(r); srcOf.push(i); }
  }
  // The firmware stopped filling its 32-row buffer once full, which left the *newest* entries
  // out when eight long lines wrapped past 32 rows. Keep the newest 32 rows instead.
  const over = disp.length - 32;
  if (over > 0) { disp.splice(0, over); srcOf.splice(0, over); }
  const nDisp = disp.length;

  const maxBack = (nDisp > SHOW) ? (nDisp - SHOW) : 0;
  ui.hudMaxBack = maxBack;   // loop's B handler wraps to the newest line from here
  if (ui.msgScroll > maxBack) ui.msgScroll = maxBack;

  const end = nDisp - ui.msgScroll;
  let start = end - SHOW; if (start < 0) start = 0;
  const newest = tama.nLines - 1;
  for (let i = 0; start + i < end; i++) {
    const row = start + i;
    const fresh = (srcOf[row] === newest) && (ui.msgScroll === 0);
    spr.setTextColor(fresh ? p.text : p.textDim, p.bg);
    spr.setCursor(4, H - AREA + 2 + i * LH);
    spr.print(disp[row]);
  }
  if (ui.msgScroll > 0) {
    spr.setTextColor(p.body, p.bg);
    spr.setCursor(W - 18, H - LH - 2);
    spr.print(`-${ui.msgScroll}`);
  }
}

/** Watch-only replacement for drawApproval: tool + hint + "answer in Hermes". */
export function drawAttention(): void {
  const p = characterPalette();
  const tama = ui.tama;
  const AREA = 78;
  spr.fillRect(0, H - AREA, W, AREA, p.bg);
  spr.drawFastHLine(0, H - AREA, W, p.textDim);

  spr.setTextSize(1);
  spr.setTextColor(p.textDim, p.bg);
  spr.setCursor(4, H - AREA + 4);
  const waited = Math.max(0, Math.floor((millis() - ui.promptArrivedMs) / 1000));
  if (waited >= 10) spr.setTextColor(HOT, p.bg);
  spr.print(`waiting ${waited}s`);

  // Size 2 only if it fits one line (~10 chars at 12px on 135px screen)
  const toolLen = tama.promptTool.length;
  spr.setTextColor(p.text, p.bg);
  spr.setTextSize(toolLen <= 10 ? 2 : 1);
  spr.setCursor(4, H - AREA + (toolLen <= 10 ? 14 : 18));
  spr.print(tama.promptTool);
  spr.setTextSize(1);

  // Hint wraps at ~21 chars under the tool name (room for three rows above the footer)
  spr.setTextColor(p.textDim, p.bg);
  const hint = wrapWords(tama.promptHint, 21, 3);
  for (let i = 0; i < hint.length; i++) {
    spr.setCursor(4, H - AREA + 34 + i * 8);
    spr.print(hint[i]);
  }

  // Watch-only: nothing to press here, the answer goes to Hermes itself
  spr.setTextColor(p.text, p.bg);
  spr.setCursor(4, H - 12);
  spr.print("answer in Hermes");
}
