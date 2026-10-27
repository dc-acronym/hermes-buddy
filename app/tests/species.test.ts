// Smoke tests for all 18 ported species. Each state function is driven for t = 0..600 at
// both render scales against a recording fake of the TFT sprite. Lexical parity with the
// firmware sources is checked separately (scratch verify script); this guards runtime behaviour:
// no throws, every tick draws something, and every cursor position is an integer (a bare `/`
// where the firmware does integer division would show up as a fractional coordinate).
import { afterEach, describe, expect, it } from "vitest";
import type { Sprite } from "../src/hw/tft";
import { _setScale, _setTarget } from "../src/buddy/common";
import type { Species } from "../src/buddy/common";
import { AXOLOTL_SPECIES } from "../src/buddy/species/axolotl";
import { BLOB_SPECIES } from "../src/buddy/species/blob";
import { CACTUS_SPECIES } from "../src/buddy/species/cactus";
import { CAPYBARA_SPECIES } from "../src/buddy/species/capybara";
import { CAT_SPECIES } from "../src/buddy/species/cat";
import { CHONK_SPECIES } from "../src/buddy/species/chonk";
import { DRAGON_SPECIES } from "../src/buddy/species/dragon";
import { DUCK_SPECIES } from "../src/buddy/species/duck";
import { GHOST_SPECIES } from "../src/buddy/species/ghost";
import { GOOSE_SPECIES } from "../src/buddy/species/goose";
import { MUSHROOM_SPECIES } from "../src/buddy/species/mushroom";
import { OCTOPUS_SPECIES } from "../src/buddy/species/octopus";
import { OWL_SPECIES } from "../src/buddy/species/owl";
import { PENGUIN_SPECIES } from "../src/buddy/species/penguin";
import { RABBIT_SPECIES } from "../src/buddy/species/rabbit";
import { ROBOT_SPECIES } from "../src/buddy/species/robot";
import { SNAIL_SPECIES } from "../src/buddy/species/snail";
import { TURTLE_SPECIES } from "../src/buddy/species/turtle";

const ALL: Species[] = [
  AXOLOTL_SPECIES,
  BLOB_SPECIES,
  CACTUS_SPECIES,
  CAPYBARA_SPECIES,
  CAT_SPECIES,
  CHONK_SPECIES,
  DRAGON_SPECIES,
  DUCK_SPECIES,
  GHOST_SPECIES,
  GOOSE_SPECIES,
  MUSHROOM_SPECIES,
  OCTOPUS_SPECIES,
  OWL_SPECIES,
  PENGUIN_SPECIES,
  RABBIT_SPECIES,
  ROBOT_SPECIES,
  SNAIL_SPECIES,
  TURTLE_SPECIES,
];

const STATE_NAMES = ["sleep", "idle", "busy", "attention", "celebrate", "dizzy", "heart"] as const;
const T_MAX = 600;
const ASCII_ONLY = /^[\x20-\x7e]*$/;
// duck.cpp is UTF-8 and its feet are "`--\u00b4" (acute accent) on 24 pose lines; this is a firmware quirk we keep byte-identical.
const DUCK_ACUTE = /^[\x20-\x7e\u00b4]*$/;

/** Recording fake: implements only the Sprite methods the species helpers call. */
class FakeSprite {
  prints = 0;
  printed = "";
  colors: number[] = [];
  textSizes: number[] = [];
  cursors: Array<[number, number]> = [];
  setTextColor(fg: number, _bg?: number): void {
    this.colors.push(fg);
  }
  setTextSize(s: number): void {
    this.textSizes.push(s);
  }
  setCursor(x: number, y: number): void {
    this.cursors.push([x, y]);
  }
  print(v: string | number): void {
    this.prints++;
    this.printed += String(v);
  }
  /** Forget everything recorded so far (per-tick checks). */
  reset(): void {
    this.prints = 0;
    this.printed = "";
    this.colors = [];
    this.textSizes = [];
    this.cursors = [];
  }
}

afterEach(() => {
  _setScale(1);
});

describe("species registry", () => {
  it("has 18 species", () => {
    expect(ALL).toHaveLength(18);
  });

  it("has 18 unique names", () => {
    const names = ALL.map((s) => s.name);
    expect(new Set(names).size).toBe(18);
    for (const n of names) expect(n).toMatch(/^[a-z]+$/);
  });

  it.each(ALL.map((s) => [s.name, s] as const))("%s has exactly 7 state functions and a 16-bit color", (_name, sp) => {
    expect(sp.states).toHaveLength(7);
    for (const fn of sp.states) expect(typeof fn).toBe("function");
    // the 7 slots are distinct functions (PersonaState order: sleep, idle, busy, attention, celebrate, dizzy, heart)
    expect(new Set(sp.states).size).toBe(7);
    expect(Number.isInteger(sp.bodyColor)).toBe(true);
    expect(sp.bodyColor).toBeGreaterThanOrEqual(0);
    expect(sp.bodyColor).toBeLessThanOrEqual(0xffff);
  });
});

for (const scale of [1, 2]) {
  describe(`species render at scale ${scale}`, () => {
    for (const sp of ALL) {
      describe(sp.name, () => {
        STATE_NAMES.forEach((stateName, idx) => {
          it(`${stateName} draws for t=0..${T_MAX}`, () => {
            const fake = new FakeSprite();
            _setTarget(fake as unknown as Sprite);
            _setScale(scale);
            const fn = sp.states[idx];

            let totalPrints = 0;
            for (let t = 0; t <= T_MAX; t++) {
              fake.reset();
              expect(() => fn(t), `${sp.name}.${stateName}(${t})`).not.toThrow();
              // every state draws its sprite block each tick
              expect(fake.prints, `${sp.name}.${stateName}(${t}) printed nothing`).toBeGreaterThan(0);
              totalPrints += fake.prints;

              // only printable ASCII ever reaches the display (the firmware's duck feet use U+00B4, see DUCK_ACUTE)
              expect(fake.printed, `${sp.name}.${stateName}(${t}) printed unexpected glyphs`).toMatch(
                sp.name === "duck" ? DUCK_ACUTE : ASCII_ONLY,
              );
              // integer-division fidelity: cursor coordinates must be whole pixels
              for (const [x, y] of fake.cursors) {
                expect(Number.isInteger(x) && Number.isInteger(y), `${sp.name}.${stateName}(${t}) cursor (${x},${y})`).toBe(true);
              }
              // text size is only ever the active scale
              for (const s of fake.textSizes) expect(s).toBe(scale);
              // colors are RGB565
              for (const c of fake.colors) {
                expect(Number.isInteger(c) && c >= 0 && c <= 0xffff, `${sp.name}.${stateName}(${t}) color ${c}`).toBe(true);
              }
            }
            expect(totalPrints).toBeGreaterThan(0);
          });
        });
      });
    }
  });
}
