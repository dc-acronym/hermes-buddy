// Stats + settings — port of stats.h with petting-based mood. OWNER: loop+menus+stats agent.
// Frozen contract: signatures below. Persisted via platform loadJson/saveJson.
//
// Firmware: header-only file-static state backed by NVS. Here: module-level state
// backed by three JSON blobs ("stats", "settings", "buddy"). Load once at boot;
// writes are coalesced so a burst of pets or setting taps hits the disk at most
// once a second (and once more on pagehide so nothing is lost on quit).

import { loadJson, saveJson, millis } from "./hw/platform";

export const TOKENS_PER_LEVEL = 50000;

export interface Stats {
  napSeconds: number; // cumulative nap (window minimized) time
  pets: number; // total B presses on the pet screen
  level: number;
  tokens: number; // cumulative tokens seen, drives level
  moodPoints: number; // 0..4 at lastMoodAt
  lastMoodAt: number; // epoch ms of last counted pet (mood +1), 0 = never
}

export interface Settings {
  sound: boolean;
  onTop: boolean; // was "wifi" slot: always-on-top
  led: boolean;
  hud: boolean; // transcript
  clockRot: number; // 0 auto, 1 portrait, 2 landscape
  bright: number; // 0..4
}

// What lives under the "buddy" key: species choice + the names the bridge used to push.
interface BuddyPrefs {
  species: number; // 0..N-1 ASCII species, 0xFF = GIF character
  petName: string;
  owner: string;
}

const SPECIES_GIF = 0xff; // species sentinel: use the installed GIF (also the unset default)
const MOOD_COOLDOWN_MS = 60000; // a pet raises mood at most once per minute
const MOOD_DECAY_MS_PER_POINT = 3 * 3600000; // mood drops 1 heart per 3 h without petting
const SAVE_DEBOUNCE_MS = 1000;

function defaultStats(): Stats {
  return { napSeconds: 0, pets: 0, level: 0, tokens: 0, moodPoints: 2, lastMoodAt: 0 };
}
function defaultSettings(): Settings {
  return { sound: true, onTop: true, led: true, hud: true, clockRot: 0, bright: 4 };
}
function defaultBuddy(): BuddyPrefs {
  return { species: SPECIES_GIF, petName: "Buddy", owner: "" };
}

let _stats: Stats = defaultStats();
let _settings: Settings = defaultSettings();
let _buddy: BuddyPrefs = defaultBuddy();

// --- Persistence -----------------------------------------------------------

type Key = "stats" | "settings" | "buddy";
const _dirty = new Set<Key>();
let _saveTimer: ReturnType<typeof setTimeout> | null = null;

function flushSaves(): void {
  if (_saveTimer !== null) { clearTimeout(_saveTimer); _saveTimer = null; }
  for (const k of _dirty) {
    saveJson(k, k === "stats" ? _stats : k === "settings" ? _settings : _buddy);
  }
  _dirty.clear();
}

function markDirty(k: Key): void {
  _dirty.add(k);
  if (_saveTimer === null) _saveTimer = setTimeout(flushSaves, SAVE_DEBOUNCE_MS);
}

/** Write anything pending right now (tests, pagehide). */
export function statsFlush(): void { flushSaves(); }

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", flushSaves);
}

// Stored JSON is hand-editable and survives version changes, so every field is
// type-checked and clamped on the way in.
function num(v: unknown, def: number, lo = 0, hi = Number.MAX_SAFE_INTEGER): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return def;
  return Math.min(hi, Math.max(lo, v));
}
function bool(v: unknown, def: boolean): boolean { return typeof v === "boolean" ? v : def; }
// Integer in 0..max, else the default (the firmware resets a bad clockRot to 0, not to the nearest end).
function oneOf(v: unknown, max: number, def: number): number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= max ? v : def;
}

// --- Stats -----------------------------------------------------------------

export function stats(): Readonly<Stats> { return _stats; }

export async function statsLoad(): Promise<void> {
  const s = await loadJson<Partial<Stats> | null>("stats", null);
  const d = defaultStats();
  _stats = {
    napSeconds: Math.floor(num(s?.napSeconds, d.napSeconds)),
    pets: Math.floor(num(s?.pets, d.pets)),
    level: Math.floor(num(s?.level, d.level)),
    tokens: Math.floor(num(s?.tokens, d.tokens)),
    moodPoints: Math.floor(num(s?.moodPoints, d.moodPoints, 0, 4)),
    lastMoodAt: Math.floor(num(s?.lastMoodAt, d.lastMoodAt)),
  };
  // Level is derived from tokens; if storage has level set but tokens at 0,
  // backfill so the derivation holds.
  if (_stats.tokens === 0 && _stats.level > 0) {
    _stats.tokens = _stats.level * TOKENS_PER_LEVEL;
  }

  // Species + names live in their own blob; stats and buddy load together.
  const b = await loadJson<Partial<BuddyPrefs> | null>("buddy", null);
  const bd = defaultBuddy();
  _buddy = {
    species: Math.floor(num(b?.species, bd.species, 0, 0xff)),
    petName: typeof b?.petName === "string" ? safeCopy(b.petName, 24) : bd.petName,
    owner: typeof b?.owner === "string" ? safeCopy(b.owner, 32) : bd.owner,
  };
  if (_buddy.petName === "") _buddy.petName = bd.petName;
}

/** Debounced (≥ 1 s) write of the stats blob. */
export function statsSave(): void { markDirty("stats"); }

// Tokens feed the pet. 50K per level, 5K per pip on the fed bar.
// Hermes reports lifetime totals; we add the delta. A drop means the db was
// swapped or reset — resync without adding, don't lose saved progress.
let _lastBridgeTokens = 0;
let _tokensSynced = false; // first-sight latch — see below
let _levelUpPending = false;

/** Cumulative token total from Hermes; first sight latches, later deltas feed level. */
export function statsOnBridgeTokens(bridgeTotal: number): void {
  // Hermes sends its lifetime total. We track deltas.
  // Db swap → number drops → resync. But on app restart, _lastBridgeTokens is
  // back to 0 while Hermes's total isn't — first snapshot would re-credit the
  // entire history. Latch on first sight instead.
  if (!_tokensSynced) {
    _lastBridgeTokens = bridgeTotal;
    _tokensSynced = true;
    return;
  }
  if (bridgeTotal < _lastBridgeTokens) {
    _lastBridgeTokens = bridgeTotal; // db restarted
    return;
  }
  const delta = bridgeTotal - _lastBridgeTokens;
  _lastBridgeTokens = bridgeTotal;
  if (delta === 0) return;

  const lvlBefore = Math.floor(_stats.tokens / TOKENS_PER_LEVEL);
  _stats.tokens += delta;
  const lvlAfter = Math.floor(_stats.tokens / TOKENS_PER_LEVEL);

  // No flash wear on the desktop and saves are debounced, so persist every delta,
  // not just the level-up milestone.
  if (lvlAfter > lvlBefore) {
    _stats.level = lvlAfter;
    _levelUpPending = true;
  }
  markDirty("stats");
}

/**
 * The totals now coming in belong to a different db (Settings → hermes). Forget the
 * baseline so the next total is latched, not credited as one huge delta. Unlike a
 * drop, a higher total can't be told apart from real work on its own.
 */
export function statsResyncTokens(): void { _tokensSynced = false; }

/** True once after a level-up (celebrate). */
export function statsPollLevelUp(): boolean {
  const r = _levelUpPending;
  _levelUpPending = false;
  return r;
}

export function statsOnNapEnd(seconds: number): void {
  _stats.napSeconds += seconds;
  markDirty("stats");
}

/**
 * B on the pet screen. Always counts the pet. Mood goes up one heart if the last
 * counted pet was at least a minute ago (so mashing B can't max it out).
 * Returns true if it raised mood.
 */
export function statsOnPet(): boolean {
  _stats.pets++;
  const now = Date.now();
  const since = now - _stats.lastMoodAt;
  // since < 0: wall clock stepped backwards; don't lock mood out until it catches up.
  const raised = since >= MOOD_COOLDOWN_MS || since < 0;
  if (raised) {
    _stats.moodPoints = Math.min(4, statsMoodTier() + 1);
    _stats.lastMoodAt = now;
  }
  markDirty("stats");
  return raised;
}

// 0..4 tier. Petting sets the base; it decays 1 heart per 3 h of neglect.
// Wall clock (not millis()) so it keeps decaying while the app is closed.
/** 0..4 hearts: moodPoints minus 1 per 3 h since lastMoodAt; 2 if never petted. */
export function statsMoodTier(): number {
  if (_stats.lastMoodAt === 0) return 2; // no data: neutral
  const hoursSince = Math.max(0, Math.floor((Date.now() - _stats.lastMoodAt) / MOOD_DECAY_MS_PER_POINT));
  return Math.min(4, Math.max(0, _stats.moodPoints - hoursSince));
}

// Energy: starts at 3/5 on boot, tops up to full on nap end, drains 1 tier per 2h.
let _lastNapEndMs = 0;
let _energyAtNap = 3;

/** Nap ended: energy refills to 5. */
export function statsOnWake(): void { _lastNapEndMs = millis(); _energyAtNap = 5; }

/** 0..5: starts 3 on boot, 5 after a nap, drains 1 per 2 h. */
export function statsEnergyTier(): number {
  const hoursSince = Math.max(0, Math.floor((millis() - _lastNapEndMs) / 3600000));
  const e = _energyAtNap - Math.floor(hoursSince / 2);
  return Math.min(5, Math.max(0, e));
}

/** 0..10 pips toward the next level. */
export function statsFedProgress(): number {
  return Math.floor((_stats.tokens % TOKENS_PER_LEVEL) / (TOKENS_PER_LEVEL / 10));
}

// --- Settings --------------------------------------------------------------

export function settings(): Settings { return _settings; }

export async function settingsLoad(): Promise<void> {
  const s = await loadJson<Partial<Settings> | null>("settings", null);
  const d = defaultSettings();
  _settings = {
    sound: bool(s?.sound, d.sound),
    onTop: bool(s?.onTop, d.onTop),
    led: bool(s?.led, d.led),
    hud: bool(s?.hud, d.hud),
    clockRot: oneOf(s?.clockRot, 2, d.clockRot),
    bright: oneOf(s?.bright, 4, d.bright),
  };
}

/** Debounced (≥ 1 s) write of the settings blob. */
export function settingsSave(): void { markDirty("settings"); }

// Strip JSON-breaking chars and control codes from names; clamp to the firmware's
// buffer sizes (24 / 32 bytes incl. terminator).
function safeCopy(src: string, dstLen: number): string {
  let out = "";
  for (const ch of src) {
    if (out.length >= dstLen - 1) break;
    if (ch !== '"' && ch !== "\\" && ch >= " ") out += ch;
  }
  return out;
}

export function petNameSet(name: string): void {
  _buddy.petName = safeCopy(name, 24);
  markDirty("buddy");
}
export function petName(): string { return _buddy.petName; }

export function ownerSet(name: string): void {
  _buddy.owner = safeCopy(name, 32);
  markDirty("buddy");
}
export function ownerName(): string { return _buddy.owner; }

/** Species choice: 0..N-1 ASCII species, 0xFF = GIF character. */
export function speciesIdxLoad(): number { return _buddy.species; }
export function speciesIdxSave(idx: number): void {
  _buddy.species = idx & 0xff;
  markDirty("buddy");
}

/** Wipe stats/settings/species to defaults (factory reset). */
export function statsReset(): void {
  _stats = defaultStats();
  _settings = defaultSettings();
  _buddy = defaultBuddy();
  _levelUpPending = false;
  _dirty.add("stats"); _dirty.add("settings"); _dirty.add("buddy");
  flushSaves(); // the page reloads right after; don't leave this to the debounce
}
