// buddy.ts: species registry, tick gating (TICK_MS = 200 on a fake clock), redraw clearing,
// peek scale, persistence hooks and the one-shot buddyRenderTo. The shared sprite is a recording
// fake and stats is mocked; module state (tick counters, scale) is reset per test.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Sprite } from "../src/hw/tft";
import type { Species, StateFn } from "../src/buddy/common";

const h = vi.hoisted(() => {
  type Call = [string, ...unknown[]];
  /** Records every method call; any method name works (species files use a lot of them). */
  function makeFake() {
    const calls: Call[] = [];
    const own: Record<string, unknown> = {
      calls,
      of: (n: string) => calls.filter((c) => c[0] === n),
    };
    return new Proxy(own, {
      get(t, p: string) {
        if (p in t) return t[p];
        return (...a: unknown[]) => {
          calls.push([p, ...a]);
        };
      },
    });
  }
  return { makeFake };
});
vi.mock("../src/app/state", () => ({ spr: h.makeFake() }));
vi.mock("../src/stats", () => ({ speciesIdxLoad: vi.fn(() => 0xff), speciesIdxSave: vi.fn() }));

interface Fake {
  calls: [string, ...unknown[]][];
  of(n: string): [string, ...unknown[]][];
}

async function load() {
  vi.resetModules();
  const platform = await import("../src/hw/platform");
  const state = await import("../src/app/state");
  const stats = await import("../src/stats");
  const common = await import("../src/buddy/common");
  const buddy = await import("../src/buddy/buddy");
  const species = {
    capybara: (await import("../src/buddy/species/capybara")).CAPYBARA_SPECIES,
    duck: (await import("../src/buddy/species/duck")).DUCK_SPECIES,
    goose: (await import("../src/buddy/species/goose")).GOOSE_SPECIES,
    blob: (await import("../src/buddy/species/blob")).BLOB_SPECIES,
    cat: (await import("../src/buddy/species/cat")).CAT_SPECIES,
    dragon: (await import("../src/buddy/species/dragon")).DRAGON_SPECIES,
    octopus: (await import("../src/buddy/species/octopus")).OCTOPUS_SPECIES,
    owl: (await import("../src/buddy/species/owl")).OWL_SPECIES,
    penguin: (await import("../src/buddy/species/penguin")).PENGUIN_SPECIES,
    turtle: (await import("../src/buddy/species/turtle")).TURTLE_SPECIES,
    snail: (await import("../src/buddy/species/snail")).SNAIL_SPECIES,
    ghost: (await import("../src/buddy/species/ghost")).GHOST_SPECIES,
    axolotl: (await import("../src/buddy/species/axolotl")).AXOLOTL_SPECIES,
    cactus: (await import("../src/buddy/species/cactus")).CACTUS_SPECIES,
    robot: (await import("../src/buddy/species/robot")).ROBOT_SPECIES,
    rabbit: (await import("../src/buddy/species/rabbit")).RABBIT_SPECIES,
    mushroom: (await import("../src/buddy/species/mushroom")).MUSHROOM_SPECIES,
    chonk: (await import("../src/buddy/species/chonk")).CHONK_SPECIES,
  };
  // the mock factory's fake is memoized across resetModules: start each test with a clean log
  (state.spr as unknown as Fake).calls.length = 0;
  let clock = 0;
  platform.setMillisSource(() => clock);
  return {
    buddy,
    common,
    species,
    spr: state.spr as unknown as Fake,
    sprite: state.spr as unknown as Sprite,
    stats: vi.mocked(stats),
    setClock: (n: number) => {
      clock = n;
    },
  };
}

/** Replace all 7 state functions of a species with spies; returns them. */
function spy(sp: Species) {
  const fns = Array.from({ length: 7 }, () => vi.fn()) as unknown as ReturnType<typeof vi.fn>[];
  sp.states = fns as unknown as Species["states"];
  return fns as unknown as (StateFn & ReturnType<typeof vi.fn>)[];
}

/** Species strip clear: width 135, (BUDDY_Y_BASE + 5 * BUDDY_CHAR_H + 12) * scale = 82 * scale. */
const clearRect = (scale: number) => ["fillRect", 0, 0, 135, 82 * scale, 0];

describe("species registry", () => {
  it("has the firmware's 18 species in buddy.cpp's table order", async () => {
    const { buddy, species } = await load();
    const order = [
      species.capybara, species.duck, species.goose, species.blob,
      species.cat, species.dragon, species.octopus, species.owl,
      species.penguin, species.turtle, species.snail, species.ghost,
      species.axolotl, species.cactus, species.robot, species.rabbit,
      species.mushroom, species.chonk,
    ];
    expect(buddy.buddySpeciesCount()).toBe(18);
    order.forEach((sp, i) => expect(buddy.buddySpeciesName(i)).toBe(sp.name));
    expect(new Set(order.map((s) => s.name)).size).toBe(18);
    expect(buddy.buddySpeciesName(18)).toBe("?");
    expect(buddy.buddySpeciesName(-1)).toBe("?");
    // no argument = the current species
    buddy.buddySetSpeciesIdx(14);
    expect(buddy.buddySpeciesName()).toBe(species.robot.name);
  });

  it("buddyInit loads the saved index; GIF sentinel / out-of-range keeps the default", async () => {
    let t = await load();
    t.stats.speciesIdxLoad.mockReturnValue(5);
    t.buddy.buddyInit();
    expect(t.buddy.buddySpeciesIdx()).toBe(5);

    for (const saved of [0xff, 18, -1, 2.5]) {
      t = await load();
      t.stats.speciesIdxLoad.mockReturnValue(saved);
      t.buddy.buddyInit();
      expect(t.buddy.buddySpeciesIdx()).toBe(0);
    }
  });

  it("setSpeciesIdx ignores out-of-range; setSpecies selects by name", async () => {
    const { buddy, species } = await load();
    buddy.buddySetSpeciesIdx(7);
    expect(buddy.buddySpeciesIdx()).toBe(7);
    buddy.buddySetSpeciesIdx(18);
    buddy.buddySetSpeciesIdx(255);
    buddy.buddySetSpeciesIdx(-1);
    expect(buddy.buddySpeciesIdx()).toBe(7);
    buddy.buddySetSpecies(species.mushroom.name);
    expect(buddy.buddySpeciesIdx()).toBe(16);
    buddy.buddySetSpecies("no such species");
    expect(buddy.buddySpeciesIdx()).toBe(16);
  });

  it("nextSpecies wraps 17 -> 0 and saves every step", async () => {
    const { buddy, stats } = await load();
    buddy.buddySetSpeciesIdx(16);
    buddy.buddyNextSpecies();
    expect(buddy.buddySpeciesIdx()).toBe(17);
    buddy.buddyNextSpecies();
    expect(buddy.buddySpeciesIdx()).toBe(0);
    buddy.buddyNextSpecies();
    expect(buddy.buddySpeciesIdx()).toBe(1);
    expect(stats.speciesIdxSave.mock.calls).toEqual([[17], [0], [1]]);
    // setSpeciesIdx alone does not persist (only the cycle button does)
    buddy.buddySetSpeciesIdx(4);
    expect(stats.speciesIdxSave).toHaveBeenCalledTimes(3);
  });

  it("walks through all 18 and back", async () => {
    const { buddy } = await load();
    const seen = new Set<number>();
    for (let i = 0; i < 18; i++) {
      seen.add(buddy.buddySpeciesIdx());
      buddy.buddyNextSpecies();
    }
    expect(seen.size).toBe(18);
    expect(buddy.buddySpeciesIdx()).toBe(0);
  });
});

describe("buddyTick gating", () => {
  let t: Awaited<ReturnType<typeof load>>;
  let fns: ReturnType<typeof spy>;
  beforeEach(async () => {
    t = await load();
    fns = spy(t.species.capybara); // default species (idx 0)
    t.buddy.buddyInit();
  });

  it("first call ticks and draws: clears the strip then runs the state fn with t=1", () => {
    t.buddy.buddyTick(1);
    expect(t.spr.of("fillRect")).toEqual([clearRect(1)]);
    expect(fns[1]).toHaveBeenCalledTimes(1);
    expect(fns[1]).toHaveBeenCalledWith(1);
    // clear happens before the species draws
    expect(t.spr.calls[0]).toEqual(clearRect(1));
  });

  it("does not redraw between ticks for the same state and species", () => {
    t.setClock(0);
    t.buddy.buddyTick(1);
    for (const ms of [1, 16, 100, 199]) {
      t.setClock(ms);
      t.buddy.buddyTick(1);
    }
    expect(fns[1]).toHaveBeenCalledTimes(1);
    expect(t.spr.of("fillRect")).toHaveLength(1);
  });

  it("ticks every 200 ms and passes the incrementing tick count", () => {
    t.setClock(0);
    t.buddy.buddyTick(1);
    t.setClock(200);
    t.buddy.buddyTick(1);
    t.setClock(399);
    t.buddy.buddyTick(1);
    t.setClock(400);
    t.buddy.buddyTick(1);
    expect(fns[1].mock.calls).toEqual([[1], [2], [3]]);
    expect(t.spr.of("fillRect")).toHaveLength(3);
  });

  it("next tick is scheduled from 'now', not from the missed deadline", () => {
    t.setClock(0);
    t.buddy.buddyTick(1);
    t.setClock(1000); // stalled for a second: one tick, not five
    t.buddy.buddyTick(1);
    t.setClock(1199);
    t.buddy.buddyTick(1);
    expect(fns[1].mock.calls).toEqual([[1], [2]]);
    t.setClock(1200);
    t.buddy.buddyTick(1);
    expect(fns[1].mock.calls).toEqual([[1], [2], [3]]);
  });

  it("a state change redraws immediately, mid-tick, with the same t", () => {
    t.setClock(0);
    t.buddy.buddyTick(1);
    t.setClock(50);
    t.buddy.buddyTick(2);
    expect(fns[2].mock.calls).toEqual([[1]]);
    expect(t.spr.of("fillRect")).toHaveLength(2);
    t.buddy.buddyTick(2);
    expect(fns[2]).toHaveBeenCalledTimes(1);
  });

  it("dispatches personaState 0..6 to the matching state fn; 7+ falls back to idle", () => {
    for (let s = 0; s < 7; s++) {
      t.buddy.buddyInvalidate();
      t.buddy.buddyTick(s);
      expect(fns[s]).toHaveBeenCalledTimes(1);
    }
    fns.forEach((f) => f.mockClear());
    for (const s of [7, 8, 255]) {
      t.buddy.buddyInvalidate();
      t.buddy.buddyTick(s);
    }
    expect(fns[1]).toHaveBeenCalledTimes(3);
    expect(fns.filter((_, i) => i !== 1).every((f) => f.mock.calls.length === 0)).toBe(true);
    // 7 and idle are the same state for gating purposes
    t.buddy.buddyTick(1);
    expect(fns[1]).toHaveBeenCalledTimes(3);
  });

  it("invalidate forces one redraw on the next call without a tick", () => {
    t.setClock(0);
    t.buddy.buddyTick(1);
    t.setClock(10);
    t.buddy.buddyInvalidate();
    t.buddy.buddyTick(1);
    t.buddy.buddyTick(1);
    expect(fns[1].mock.calls).toEqual([[1], [1]]);
  });

  it("a species change redraws and uses the new species", () => {
    const duck = spy(t.species.duck);
    t.setClock(0);
    t.buddy.buddyTick(1);
    t.setClock(10);
    t.buddy.buddyNextSpecies(); // capybara -> duck
    t.buddy.buddyTick(1);
    expect(duck[1].mock.calls).toEqual([[1]]);
    expect(fns[1]).toHaveBeenCalledTimes(1);
  });

  it("at 60 fps it redraws ~5 times a second, not 60", () => {
    for (let ms = 0; ms < 1000; ms += 16) {
      t.setClock(ms);
      t.buddy.buddyTick(2);
    }
    expect(fns[2].mock.calls.length).toBeGreaterThanOrEqual(5);
    expect(fns[2].mock.calls.length).toBeLessThanOrEqual(6);
  });

  it("buddyInit resets the tick counter and schedule", () => {
    t.setClock(0);
    t.buddy.buddyTick(1);
    t.setClock(200);
    t.buddy.buddyTick(1);
    t.buddy.buddyInit();
    t.setClock(210);
    t.buddy.buddyTick(1); // nextTickAt = 0 again -> due immediately, count restarts
    expect(fns[1].mock.calls.at(-1)).toEqual([1]);
  });

  it("keeps ticking across the signed 32-bit boundary of millis()", () => {
    t.buddy.buddyInit();
    const start = 2 ** 31 - 1000;
    for (let ms = 0; ms < 3000; ms += 100) {
      t.setClock(start + ms);
      t.buddy.buddyTick(1);
    }
    expect(fns[1].mock.calls.length).toBe(15); // 3000 ms / 200 ms
  });
});

describe("peek scale", () => {
  it("1x clears (30 + 5*8 + 12) rows, 2x doubles it; setPeek toggles and invalidates", async () => {
    const t = await load();
    const fns = spy(t.species.capybara);
    const scales: number[] = [];
    fns[1].mockImplementation(() => scales.push(t.common._getScale()));

    t.buddy.buddyTick(1); // default scale is 1x (peek)
    expect(t.spr.of("fillRect").at(-1)).toEqual(clearRect(1));

    t.buddy.buddySetPeek(true); // already 1x: no-op, no redraw
    t.buddy.buddyTick(1);
    expect(fns[1]).toHaveBeenCalledTimes(1);

    t.buddy.buddySetPeek(false); // home screen: 2x
    t.buddy.buddyTick(1);
    expect(t.spr.of("fillRect").at(-1)).toEqual(clearRect(2));
    expect(t.spr.of("fillRect").at(-1)![4]).toBe(164);
    expect(scales).toEqual([1, 2]);

    t.buddy.buddySetPeek(false); // unchanged: no invalidate
    t.buddy.buddyTick(1);
    expect(fns[1]).toHaveBeenCalledTimes(2);

    t.buddy.buddySetPeek(true);
    t.buddy.buddyTick(1);
    expect(t.spr.of("fillRect").at(-1)).toEqual(clearRect(1));
    expect(scales).toEqual([1, 2, 1]);
  });

  it("real species render at both scales into the default sprite target", async () => {
    const t = await load();
    t.buddy.buddyInit();
    for (const peek of [true, false]) {
      t.buddy.buddySetPeek(peek);
      for (let s = 0; s < 7; s++) {
        t.buddy.buddyInvalidate();
        expect(() => t.buddy.buddyTick(s)).not.toThrow();
      }
    }
    expect(t.spr.of("print").length).toBeGreaterThan(0); // the species drew through common.ts
  });
});

describe("buddyRenderTo", () => {
  let t: Awaited<ReturnType<typeof load>>;
  let fns: ReturnType<typeof spy>;
  let tgt: Fake & Sprite;
  beforeEach(async () => {
    t = await load();
    fns = spy(t.species.capybara);
    tgt = h.makeFake() as unknown as Fake & Sprite;
    t.buddy.buddyInit();
  });

  it("draws at 1x onto the given surface, restoring target and scale afterwards", () => {
    t.buddy.buddySetPeek(false); // home 2x
    const seen: unknown[] = [];
    fns[1].mockImplementation(() => seen.push([t.common._getScale(), t.common._getTarget() === tgt]));
    t.buddy.buddyRenderTo(tgt, 1);
    expect(seen).toEqual([[1, true]]);
    expect(t.common._getScale()).toBe(2);
    expect(t.common._getTarget()).toBe(t.sprite);
  });

  it("bypasses redraw gating and never clears (caller owns clearing)", () => {
    t.setClock(0);
    t.buddy.buddyRenderTo(tgt, 1);
    t.buddy.buddyRenderTo(tgt, 1);
    t.buddy.buddyRenderTo(tgt, 1);
    expect(fns[1].mock.calls).toEqual([[1], [1], [1]]); // drawn every call, same tick
    expect(t.spr.of("fillRect")).toHaveLength(0);
    expect(tgt.of("fillRect")).toHaveLength(0);
  });

  it("advances the shared tick counter every 200 ms", () => {
    t.setClock(0);
    t.buddy.buddyRenderTo(tgt, 1);
    t.setClock(199);
    t.buddy.buddyRenderTo(tgt, 1);
    t.setClock(200);
    t.buddy.buddyRenderTo(tgt, 1);
    t.setClock(450);
    t.buddy.buddyRenderTo(tgt, 1);
    expect(fns[1].mock.calls).toEqual([[1], [1], [2], [3]]);
    // buddyTick continues from the same counter
    t.setClock(450);
    t.buddy.buddyTick(1);
    expect(fns[1].mock.calls.at(-1)).toEqual([3]);
  });

  it("personaState >= 7 renders idle", () => {
    t.buddy.buddyRenderTo(tgt, 9);
    expect(fns[1]).toHaveBeenCalledTimes(1);
  });

  it("restores target and scale even if the species throws", () => {
    t.buddy.buddySetPeek(false);
    fns[2].mockImplementation(() => {
      throw new Error("boom");
    });
    expect(() => t.buddy.buddyRenderTo(tgt, 2)).toThrow("boom");
    expect(t.common._getScale()).toBe(2);
    expect(t.common._getTarget()).toBe(t.sprite);
  });

  it("real species draw onto the target, not the home sprite", () => {
    const real = h.makeFake() as unknown as Fake & Sprite;
    t.buddy.buddySetSpeciesIdx(14); // robot (unspied)
    t.buddy.buddyRenderTo(real, 1);
    expect(real.of("print").length).toBeGreaterThan(0);
    expect(t.spr.calls).toHaveLength(0);
  });
});
