// Multi-species ASCII buddy renderer — port of buddy.cpp. OWNER: buddy+gif agent.
// Frozen contract: signatures below. Each species lives in buddy/species/<name>.ts
// and exports `<NAME>_SPECIES: Species` with 7 state functions in PersonaState order.
//
// The shared render helpers (buddyPrintLine, buddyPrintSprite, buddySetCursor, ...) and the
// _tgt/_scale indirection live in common.ts; this file owns the registry and the tick state.

import type { Sprite } from "../hw/tft";
import { millis } from "../hw/platform";
import { spr } from "../app/state";
import { speciesIdxLoad, speciesIdxSave } from "../stats";
import {
  BUDDY_BG,
  BUDDY_CANVAS_W,
  BUDDY_CHAR_H,
  BUDDY_Y_BASE,
  _getScale,
  _getTarget,
  _setScale,
  _setTarget,
} from "./common";
import type { Species } from "./common";

// Species registry — each exports `<NAME>_SPECIES`.
import { CAPYBARA_SPECIES } from "./species/capybara";
import { DUCK_SPECIES } from "./species/duck";
import { GOOSE_SPECIES } from "./species/goose";
import { BLOB_SPECIES } from "./species/blob";
import { CAT_SPECIES } from "./species/cat";
import { DRAGON_SPECIES } from "./species/dragon";
import { OCTOPUS_SPECIES } from "./species/octopus";
import { OWL_SPECIES } from "./species/owl";
import { PENGUIN_SPECIES } from "./species/penguin";
import { TURTLE_SPECIES } from "./species/turtle";
import { SNAIL_SPECIES } from "./species/snail";
import { GHOST_SPECIES } from "./species/ghost";
import { AXOLOTL_SPECIES } from "./species/axolotl";
import { CACTUS_SPECIES } from "./species/cactus";
import { ROBOT_SPECIES } from "./species/robot";
import { RABBIT_SPECIES } from "./species/rabbit";
import { MUSHROOM_SPECIES } from "./species/mushroom";
import { CHONK_SPECIES } from "./species/chonk";

// Mirrors PersonaState in main.cpp
const B_IDLE = 1;

// Render target indirection: defaults to the sprite, but can retarget to
// the landscape clock surface. Coords stay fixed — species hardcode
// BUDDY_X_CENTER/BUDDY_Y_OVERLAY in their particle calls, so retargeting
// position would only move the body.
_setTarget(spr);

// ──────────────── species registry ────────────────
// Same order as buddy.cpp's SPECIES_TABLE — the persisted index depends on it.
const SPECIES_TABLE: readonly Species[] = [
  CAPYBARA_SPECIES, DUCK_SPECIES, GOOSE_SPECIES, BLOB_SPECIES,
  CAT_SPECIES, DRAGON_SPECIES, OCTOPUS_SPECIES, OWL_SPECIES,
  PENGUIN_SPECIES, TURTLE_SPECIES, SNAIL_SPECIES, GHOST_SPECIES,
  AXOLOTL_SPECIES, CACTUS_SPECIES, ROBOT_SPECIES, RABBIT_SPECIES,
  MUSHROOM_SPECIES, CHONK_SPECIES,
];
const N_SPECIES = SPECIES_TABLE.length;
let currentSpeciesIdx = 0;

// ──────────────── tick state ────────────────
let tickCount = 0;
let nextTickAt = 0;
const TICK_MS = 200;

/** uint8_t view of a persona state: anything out of range (>= 7) falls back to idle. */
function clampState(personaState: number): number {
  const s = personaState & 0xff;
  return s >= 7 ? B_IDLE : s;
}

// The firmware's (int32_t)(now - nextTickAt) >= 0 guards millis() wraparound. Ours comes
// from performance.now() and never wraps, and an int32 cast would instead freeze the
// animation once a gap between ticks passed 2^31 ms (as loop.ts's reached() notes).
function tickDue(now: number): boolean {
  return now >= nextTickAt;
}

export function buddyInit(): void {
  tickCount = 0;
  nextTickAt = 0;
  const saved = speciesIdxLoad();
  if (Number.isInteger(saved) && saved >= 0 && saved < N_SPECIES) currentSpeciesIdx = saved;
}

export function buddySetSpeciesIdx(idx: number): void {
  if (Number.isInteger(idx) && idx >= 0 && idx < N_SPECIES) currentSpeciesIdx = idx;
}

/** Select a species by name (buddy.h's buddySetSpecies). Unknown names are ignored. */
export function buddySetSpecies(name: string): void {
  for (let i = 0; i < N_SPECIES; i++) {
    if (SPECIES_TABLE[i].name === name) {
      currentSpeciesIdx = i;
      return;
    }
  }
}

/** Name of species `idx` (default: the current one); "?" when out of range. */
export function buddySpeciesName(idx: number = currentSpeciesIdx): string {
  return SPECIES_TABLE[idx]?.name ?? "?";
}

export function buddySpeciesCount(): number {
  return N_SPECIES;
}

export function buddySpeciesIdx(): number {
  return currentSpeciesIdx;
}

export function buddyNextSpecies(): void {
  currentSpeciesIdx = (currentSpeciesIdx + 1) % N_SPECIES;
  speciesIdxSave(currentSpeciesIdx);
}

// Only redraw when tickCount actually changes — animations run at TICK_MS
// (5 fps), the loop runs at 60 fps, and the redraw is identical between
// ticks. Gating saves ~12× the fillRect + sprite-print work. State changes
// also need a redraw even mid-tick so transitions appear instantly.
let lastDrawnState = 0xff;
let lastDrawnSpecies = 0xff;
export function buddyInvalidate(): void {
  lastDrawnState = 0xff;
}

export function buddySetPeek(peek: boolean): void {
  const s = peek ? 1 : 2;
  if (s === _getScale()) return;
  _setScale(s);
  buddyInvalidate();
}

// One-shot render to an arbitrary surface (the landscape clock sprite).
// Bypasses tick gating and the sprite fillRect — caller owns
// clearing. Advances the frame counter so animation runs even when
// buddyTick is bypassed.
// Landscape clock callsite — always 1×.
export function buddyRenderTo(tgt: Sprite, personaState: number): void {
  const prevS = _getScale();
  _setScale(1);
  const state = clampState(personaState);
  const now = millis();
  if (tickDue(now)) {
    nextTickAt = now + TICK_MS;
    tickCount = (tickCount + 1) >>> 0;
  }
  const prev = _getTarget();
  _setTarget(tgt);
  try {
    const sp = SPECIES_TABLE[currentSpeciesIdx];
    const fn = sp.states[state];
    if (fn) fn(tickCount);
  } finally {
    _setTarget(prev);
    _setScale(prevS);
  }
}

export function buddyTick(personaState: number): void {
  const now = millis();
  let ticked = false;
  if (tickDue(now)) {
    nextTickAt = now + TICK_MS;
    tickCount = (tickCount + 1) >>> 0;
    ticked = true;
  }

  const state = clampState(personaState);
  if (!ticked && state === lastDrawnState && currentSpeciesIdx === lastDrawnSpecies) {
    return;
  }
  lastDrawnState = state;
  lastDrawnSpecies = currentSpeciesIdx;

  // Clear the whole render strip — at 2× the body reaches y≈126, at 1× ≈82.
  spr.fillRect(0, 0, BUDDY_CANVAS_W,
               (BUDDY_Y_BASE + 5 * BUDDY_CHAR_H + 12) * _getScale(), BUDDY_BG);

  const sp = SPECIES_TABLE[currentSpeciesIdx];
  const fn = sp.states[state];
  if (fn) fn(tickCount);
}
