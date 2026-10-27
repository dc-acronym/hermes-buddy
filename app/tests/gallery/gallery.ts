// QA gallery — OWNER: qa agent.
//
// Renders every ASCII species x 7 states (at several tick counts, 1x and the 2x home
// path) and every screen / menu into its own labelled <canvas>, using the real
// Display + Sprite from src/hw/tft. Every cell is isolated: if a cell throws (e.g. a
// module that is still a "TODO" stub) the error text is drawn into that cell and the
// run carries on. Sets window.__galleryReady = true when done; per-cell outcomes are in
// window.__galleryResults for tests/e2e/screenshots.mjs.
//
// URL params (all optional):
//   ?only=species,screens,menus,gif   restrict to section groups
//   ?species=cat,3                restrict species (names or indexes)
//   ?ticks=10,37,80               tick counts for the 1x species rows
//   ?realtime                     do not freeze Date (default: frozen Wed 3 Jun 2026 14:07:42)

import type { Display, Sprite } from "../../src/hw/tft";
import type { TamaState } from "../../src/data/types";

// ── lazy module loading ────────────────────────────────────────────────────
// Dynamic imports so one module with a syntax error / throwing top level only
// breaks the cells that need it, not the whole gallery.
const loaders = {
  tft: () => import("../../src/hw/tft"),
  platform: () => import("../../src/hw/platform"),
  types: () => import("../../src/data/types"),
  state: () => import("../../src/app/state"),
  stats: () => import("../../src/stats"),
  buddy: () => import("../../src/buddy/buddy"),
  character: () => import("../../src/character"),
  screens: () => import("../../src/app/screens"),
  menus: () => import("../../src/app/menus"),
};
type Loaded = { [K in keyof typeof loaders]?: Awaited<ReturnType<(typeof loaders)[K]>> };
const M: Loaded = {};
const importErrors: Record<string, string> = {};

function msgOf(e: unknown): string {
  if (e instanceof Error) {
    const frame = (e.stack ?? "")
      .split("\n")
      .slice(1)
      .map((l) => l.trim())
      .find((l) => l.startsWith("at ") && !l.includes("gallery.ts"));
    const where = frame ? "  " + frame.replace(/https?:\/\/[^/]+/g, "").replace(/\?t=\d+/g, "") : "";
    return `${e.name}: ${e.message}${where}`;
  }
  return String(e);
}

function need<K extends keyof Loaded>(k: K): NonNullable<Loaded[K]> {
  const m = M[k];
  if (!m) throw new Error(`module '${k}' failed to import: ${importErrors[k] ?? "?"}`);
  return m as NonNullable<Loaded[K]>;
}

// ── page model ─────────────────────────────────────────────────────────────
const SCALE = 2;
const qs = new URLSearchParams(location.search);
const only = qs.get("only")?.split(",").filter(Boolean) ?? null;
const speciesFilter = qs.get("species")?.split(",").filter(Boolean) ?? null;
const TICKS = (qs.get("ticks") ?? "10,37,80").split(",").map(Number).filter((n) => n > 0).sort((a, b) => a - b);
const wantGroup = (g: string): boolean => only === null || only.includes(g);

export interface CellResult {
  section: string;
  label: string;
  status: "ok" | "blank" | "error";
  error?: string;
  nonzero?: number;
  hash?: number;
  animated?: boolean;
  /** distinct frames over ticks 1..max (species rows only) */
  distinct?: number;
  /** non-zero pixels below the rows the cell shows (my crop would hide them) */
  inkBelowCrop?: number;
  /** ink touches the left / right screen edge (art wider than 135px -> clipped) */
  edgeClip?: "L" | "R" | "LR";
}
const results: CellResult[] = [];
const sectionsMeta: { id: string; title: string }[] = [];

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

interface Sec {
  id: string;
  grid: HTMLElement;
}

function addSection(id: string, title: string, note: string, cols: number): Sec {
  const root = document.getElementById("root")!;
  const s = el("section");
  s.id = `sec-${id}`;
  s.dataset.section = id;
  s.append(el("h2", "", title));
  if (note) s.append(el("p", "note", note));
  const grid = el("div", "grid");
  grid.style.gridTemplateColumns = `repeat(${cols}, max-content)`;
  s.append(grid);
  root.append(s);
  sectionsMeta.push({ id, title });
  return { id, grid };
}

function fnv(px: Uint16Array): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < px.length; i++) {
    h = Math.imul(h ^ (px[i] & 0xff), 0x01000193);
    h = Math.imul(h ^ (px[i] >> 8), 0x01000193);
  }
  return h >>> 0;
}
function countNonZero(px: Uint16Array): number {
  let n = 0;
  for (let i = 0; i < px.length; i++) if (px[i] !== 0) n++;
  return n;
}

function analyse(sp: Sprite, shownRows: number): { below: number; edge: "" | "L" | "R" | "LR" } {
  let below = 0;
  for (let i = sp.w * shownRows; i < sp.pixels.length; i++) if (sp.pixels[i] !== 0) below++;
  let l = false;
  let r = false;
  for (let y = 0; y < Math.min(shownRows, sp.h); y++) {
    if (sp.pixels[y * sp.w] !== 0) l = true;
    if (sp.pixels[y * sp.w + sp.w - 1] !== 0) r = true;
  }
  return { below, edge: l && r ? "LR" : l ? "L" : r ? "R" : "" };
}

function errorCanvas(w: number, h: number, msg: string): HTMLCanvasElement {
  const c = el("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d")!;
  g.fillStyle = "#2a0d0d";
  g.fillRect(0, 0, w, h);
  g.font = "11px ui-monospace, Menlo, Consolas, monospace";
  g.fillStyle = "#ff8a8a";
  g.textBaseline = "top";
  const cols = Math.max(10, Math.floor((w - 12) / 6.6));
  const lines: string[] = [];
  for (const raw of msg.split("\n")) {
    let s = raw;
    while (s.length > cols) {
      lines.push(s.slice(0, cols));
      s = s.slice(cols);
    }
    lines.push(s);
  }
  lines.slice(0, Math.floor((h - 8) / 13)).forEach((l, i) => g.fillText(l, 6, 6 + i * 13));
  return c;
}

/** show(sprite, rotation, "derotate"): push through the real Display; "derotate" turns the Display canvas the way body.landscape does (90deg CW) so a rotation-1 frame reads upright. */
type Show = (s: Sprite, rotation?: number, mode?: "derotate") => void;

// The real Display always owns a full 270x480 canvas (it stretches whatever sprite it is
// given onto it), so ONE shared Display + scratch canvas does the blit and each cell then
// copies the region it wants (the full frame, the top N rows, or the frame turned back
// upright) into its own canvas. screens.drawClock() (landscape) pushes through display(),
// which the gallery points at the same shared Display via setDisplay().
let sharedDisp: Display | null = null;
let sharedCanvas: HTMLCanvasElement | null = null;
function shared(): { disp: Display; canvas: HTMLCanvasElement } {
  if (!sharedDisp || !sharedCanvas) {
    const { Display } = need("tft");
    sharedCanvas = document.createElement("canvas");
    sharedDisp = new Display(sharedCanvas, SCALE);
    try {
      need("state").setDisplay(sharedDisp);
    } catch {
      /* state failed to import: cells needing it will report that themselves */
    }
  }
  return { disp: sharedDisp, canvas: sharedCanvas };
}

function addCell(
  sec: Sec,
  label: string,
  w: number,
  h: number,
  fn: (show: Show) => void,
): { fig: HTMLElement; res: CellResult; sprite: Sprite | null } {
  const fig = el("figure", "cell");
  fig.append(el("figcaption", "", label));
  fig.title = label;
  let canvas = el("canvas");
  canvas.width = w * SCALE;
  canvas.height = h * SCALE;
  fig.append(canvas);
  sec.grid.append(fig);

  const res: CellResult = { section: sec.id, label, status: "ok" };
  let pushed = null as Sprite | null;
  let rows = 0; // sprite rows covered by this cell (for the blank check)
  try {
    const sh = shared();
    fn((s, rot = 0, mode) => {
      sh.disp.push(s, rot);
      pushed = s;
      const g = canvas.getContext("2d")!;
      g.imageSmoothingEnabled = false;
      if (mode === "derotate") {
        g.save();
        g.translate(canvas.width, 0);
        g.rotate(Math.PI / 2); // body.landscape turns the bezel (and canvas) 90deg clockwise
        g.drawImage(sh.canvas, 0, 0);
        g.restore();
        rows = s.h;
      } else {
        g.drawImage(sh.canvas, 0, 0, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);
        rows = Math.min(s.h, h);
      }
    });
    if (!pushed) throw new Error("cell never pushed a sprite");
    const p = pushed as Sprite;
    const px = p.pixels.subarray(0, p.w * rows);
    res.nonzero = countNonZero(px);
    res.hash = fnv(px);
    if (res.nonzero === 0) {
      res.status = "blank";
      fig.classList.add("blank");
    }
  } catch (e) {
    res.status = "error";
    res.error = msgOf(e);
    fig.classList.add("error");
    const bad = errorCanvas(canvas.width, canvas.height, res.error);
    canvas.replaceWith(bad);
    canvas = bad;
  }
  results.push(res);
  return { fig, res, sprite: pushed };
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

// ── time control ───────────────────────────────────────────────────────────
let clock = 0;
const SCREEN_CLOCK = 3_725_000; // 1h02m05s of "uptime" while drawing screens
const FIXED_NOW = new Date(2026, 5, 3, 14, 7, 42).getTime(); // Wed 3 Jun 2026 14:07:42 local

function freezeDate(): void {
  const RealDate = Date;
  class FrozenDate extends RealDate {
    constructor(...a: unknown[]) {
      if (a.length === 0) super(FIXED_NOW);
      else super(...(a as [number]));
    }
    static override now(): number {
      return FIXED_NOW;
    }
  }
  (globalThis as unknown as { Date: DateConstructor }).Date = FrozenDate as unknown as DateConstructor;
}

// ── sprite helpers ─────────────────────────────────────────────────────────
function copySprite(src: Sprite): Sprite {
  const { Sprite } = need("tft");
  const out = new Sprite(src.w, src.h);
  out.pixels.set(src.pixels);
  return out;
}

const W = 135;
const H = 240;
const CROP_1X = 88; // 1x body reaches y~82
const CROP_2X = 140; // 2x body reaches y~126
const PET_FOR_SCREENS = 0; // capybara, the firmware default

// ── species capture (memoised) ─────────────────────────────────────────────
const memo1x = new Map<string, Sprite[] | Error>();
const varietyMap = new Map<string, number>(); // "idx:state" -> distinct frames over ticks 1..max
function frames1x(idx: number, state: number): Sprite[] {
  const key = `${idx}:${state}`;
  let hit = memo1x.get(key);
  if (!hit) {
    try {
      const { Sprite } = need("tft");
      const buddy = need("buddy");
      const platform = need("platform");
      platform.setMillisSource(() => clock);
      buddy.buddyInit();
      buddy.buddySetSpeciesIdx(idx);
      clock = 0;
      const maxT = TICKS[TICKS.length - 1];
      const scratch = new Sprite(W, H);
      const out: Sprite[] = [];
      const seen = new Set<number>();
      for (let k = 1; k <= maxT; k++) {
        clock += 200;
        const want = TICKS.includes(k);
        const tgt = want ? new Sprite(W, H) : scratch;
        if (!want) scratch.pixels.fill(0);
        buddy.buddyRenderTo(tgt, state);
        seen.add(fnv(tgt.pixels));
        if (want) out.push(tgt);
      }
      varietyMap.set(key, seen.size);
      hit = out;
    } catch (e) {
      hit = e instanceof Error ? e : new Error(String(e));
    }
    memo1x.set(key, hit);
  }
  if (hit instanceof Error) throw hit;
  return hit;
}

const memoHome = new Map<string, Sprite | Error>();
function frameHome(idx: number, state: number, atTick: number): Sprite {
  const key = `${idx}:${state}:${atTick}`;
  let hit = memoHome.get(key);
  if (!hit) {
    try {
      const buddy = need("buddy");
      const platform = need("platform");
      const { spr } = need("state");
      platform.setMillisSource(() => clock);
      buddy.buddyInit();
      buddy.buddySetSpeciesIdx(idx);
      buddy.buddySetPeek(false);
      buddy.buddyInvalidate();
      spr.fillSprite(0);
      clock = 0;
      for (let k = 1; k <= atTick; k++) {
        clock += 200;
        buddy.buddyTick(state);
      }
      hit = copySprite(spr);
    } catch (e) {
      hit = e instanceof Error ? e : new Error(String(e));
    }
    memoHome.set(key, hit);
  }
  if (hit instanceof Error) throw hit;
  return hit;
}

const SPECIES_FALLBACK = [
  "capybara", "duck", "goose", "blob", "cat", "dragon", "octopus", "owl", "penguin",
  "turtle", "snail", "ghost", "axolotl", "cactus", "robot", "rabbit", "mushroom", "chonk",
];

function speciesName(idx: number): string {
  try {
    const n = need("buddy").buddySpeciesName(idx);
    if (n && n !== "?") return n;
  } catch {
    /* fall through */
  }
  return SPECIES_FALLBACK[idx] ?? `#${idx}`;
}

async function speciesSections(): Promise<void> {
  let count = 18;
  try {
    count = need("buddy").buddySpeciesCount();
  } catch {
    /* keep 18 */
  }
  const { STATE_NAMES } = M.types ?? { STATE_NAMES: ["sleep", "idle", "busy", "attention", "celebrate", "dizzy", "heart"] as const };
  const homeTick = TICKS.includes(37) ? 37 : TICKS[Math.floor(TICKS.length / 2)];

  // Overview sheets: every species, one row each, 1x frame at ~t=37, all 7 states (compact to eyeball).
  const ovTickIdx = Math.max(0, TICKS.indexOf(37));
  const wanted: number[] = [];
  for (let idx = 0; idx < count; idx++) {
    const name = speciesName(idx);
    if (speciesFilter && !speciesFilter.includes(name) && !speciesFilter.includes(String(idx))) continue;
    wanted.push(idx);
  }
  const half = Math.ceil(wanted.length / 2);
  [wanted.slice(0, half), wanted.slice(half)].forEach((group, gi) => {
    if (!group.length) return;
    const ov = addSection(
      `species-overview-${gi + 1}`,
      `Species overview ${gi + 1}/2 (1x frame at t=${TICKS[ovTickIdx]}, columns ${STATE_NAMES.join(" / ")})`,
      "Same frames as the per-species sections, one row per species.",
      7,
    );
    for (const idx of group) {
      for (let st = 0; st < 7; st++) {
        addCell(ov, `${speciesName(idx)} ${STATE_NAMES[st]}`, W, CROP_1X, (show) => {
          show(frames1x(idx, st)[ovTickIdx]);
        });
      }
    }
  });
  await tick();

  for (const idx of wanted) {
    const name = speciesName(idx);
    const sec = addSection(
      `species-${name}`,
      `${idx}: ${name}`,
      `columns = ${STATE_NAMES.join(" / ")}. Rows: 1x buddyRenderTo into a fresh 135x240 Sprite after ${TICKS.join(" / ")} ticks (top ${CROP_1X}px shown), then the 2x home-screen path (buddyTick into spr, peek off) after ${homeTick} ticks (top ${CROP_2X}px shown). Everything is pushed through the real Display at 2x.`,
      7,
    );
    // 1x rows by tick, then the 2x home row.
    for (let r = 0; r < TICKS.length; r++) {
      for (let st = 0; st < 7; st++) {
        const lbl = `${name} ${STATE_NAMES[st]} 1x t=${TICKS[r]}`;
        const c = addCell(sec, lbl, W, CROP_1X, (show) => {
          show(frames1x(idx, st)[r]);
        });
        if (c.res.status === "error") continue;
        const a = analyse(c.sprite!, CROP_1X);
        if (a.below) c.res.inkBelowCrop = a.below;
        if (a.edge) c.res.edgeClip = a.edge;
        if (r === 0) {
          c.res.distinct = varietyMap.get(`${idx}:${st}`);
          // animation check: do the tick frames differ at all?
          const hashes = new Set(frames1x(idx, st).map((s) => fnv(s.pixels)));
          if (hashes.size === 1) {
            c.fig.classList.add("static");
            c.res.animated = false;
          } else c.res.animated = true;
        }
      }
    }
    for (let st = 0; st < 7; st++) {
      const c = addCell(sec, `${name} ${STATE_NAMES[st]} 2x home t=${homeTick}`, W, CROP_2X, (show) => {
        show(frameHome(idx, st, homeTick));
      });
      if (c.res.status === "error") continue;
      const a = analyse(c.sprite!, CROP_2X);
      if (a.below) c.res.inkBelowCrop = a.below;
      if (a.edge) c.res.edgeClip = a.edge;
    }
    await tick();
  }
  try {
    need("buddy").buddySetPeek(false);
  } catch {
    /* ignore */
  }
}

// ── screens ────────────────────────────────────────────────────────────────
const LINES8 = [
  "you: the poller drops rows when WAL checkpoints mid-read, can you take a look",
  "hermes: reading crates/hermes-watch/src/lib.rs",
  "tool read_file crates/hermes-watch/src/lib.rs (412 lines)",
  "hermes: the query opens read-write; switching to SQLITE_OPEN_READ_ONLY with a 1s busy timeout",
  "tool patch crates/hermes-watch/src/lib.rs +14 -6",
  "tool terminal cargo test -p hermes-watch",
  "hermes: 11 passed, 0 failed. Want me to run clippy before committing?",
  "you: yes please, then squash the fixup commits into one",
];

function mkTama(over: Partial<TamaState> = {}): TamaState {
  const { emptyTama } = need("types");
  const t = emptyTama();
  Object.assign(
    t,
    {
      connected: true,
      sessionsTotal: 3,
      sessionsRunning: 1,
      sessionsWaiting: 0,
      tokensToday: 128_400,
      tokensLifetime: 4_820_000,
      lastUpdated: SCREEN_CLOCK - 4000,
      msg: "editing lib.rs",
      model: "hermes-3-70b",
      dbPath: "/Users/friend/.hermes/state.db",
      schemaVersion: 7,
      polledAt: FIXED_NOW - 4000,
      lineGen: 1,
    },
    over,
  );
  t.nLines = t.lines.length;
  return t;
}

function baseUi(tama: TamaState): void {
  const { ui, DisplayMode } = need("state");
  const { PersonaState } = need("types");
  Object.assign(ui, {
    tama,
    baseState: PersonaState.Idle,
    activeState: PersonaState.Idle,
    oneShotUntil: 0,
    menuOpen: false,
    menuSel: 0,
    settingsOpen: false,
    settingsSel: 0,
    resetOpen: false,
    resetSel: 0,
    resetConfirmUntil: 0,
    resetConfirmIdx: 0xff,
    brightLevel: 4,
    btnALong: false,
    displayMode: DisplayMode.Normal,
    infoPage: 0,
    petPage: 0,
    msgScroll: 0,
    lastLineGen: tama.lineGen, // keeps drawHUD from calling wake()
    lastPromptId: tama.promptId,
    dimmed: false,
    screenOff: false,
    napping: false,
    promptArrivedMs: SCREEN_CLOCK - 3000,
    clockOrient: 0,
    orientFrames: 0,
    paintedOrient: 0,
    buddyMode: true,
    gifAvailable: false,
  });
}

interface Compose {
  tama?: TamaState;
  state: number; // PersonaState for the pet
  peek: boolean; // 1x pet (PET/INFO/clock) vs 2x home
  ticks?: number;
  species?: number;
  noPet?: boolean;
  setup?: () => void; // mutate ui / settings / stats before drawing
  draw: () => void; // screen draw calls
}

/** Mirrors one iteration of the firmware loop: buddyTick, then the screen draw. Returns spr. */
function compose(o: Compose): Sprite {
  const { spr } = need("state");
  const buddy = need("buddy");
  const platform = need("platform");
  platform.setMillisSource(() => clock);
  baseUi(o.tama ?? mkTama());
  o.setup?.();
  spr.setTextDatum(0);
  spr.setTextSize(1);
  spr.setTextColor(0xffff);
  spr.fillSprite(0);
  if (!o.noPet) {
    buddy.buddyInit();
    buddy.buddySetSpeciesIdx(o.species ?? PET_FOR_SCREENS);
    buddy.buddySetPeek(o.peek);
    buddy.buddyInvalidate();
    clock = 0;
    for (let k = 1; k <= (o.ticks ?? 37); k++) {
      clock += 200;
      buddy.buddyTick(o.state);
    }
  }
  clock = SCREEN_CLOCK;
  o.draw();
  return spr;
}

function screenCell(sec: Sec, label: string, o: Compose): void {
  addCell(sec, label, W, H, (show) => show(compose(o)));
}

async function screenSections(): Promise<void> {
  const { ui, DisplayMode } = need("state");
  const { PersonaState } = need("types");
  const screens = need("screens");
  const SP = PersonaState;

  // ── home / HUD ──
  const home = addSection(
    "screens-home",
    "Home screen: splash, HUD transcript, attention",
    "Pet at 2x on top (buddyTick, peek off), HUD drawn over the bottom strip by drawHUD(); attention screen is drawAttention() via drawHUD() with a pending prompt.",
    6,
  );
  const L = M.stats;
  screenCell(home, "splash (no owner)", {
    noPet: true,
    state: SP.Idle,
    peek: false,
    draw: () => screens.drawSplash(),
  });
  screenCell(home, "splash (owner 'Dan', pet 'Hermes')", {
    noPet: true,
    state: SP.Idle,
    peek: false,
    setup: () => {
      L?.ownerSet?.("Dan");
      L?.petNameSet?.("Hermes");
    },
    draw: () => {
      try {
        screens.drawSplash();
      } finally {
        L?.ownerSet?.("");
        L?.petNameSet?.("Buddy");
      }
    },
  });
  screenCell(home, "HUD empty (connected, 0 lines, msg 'idle')", {
    tama: mkTama({ sessionsRunning: 0, msg: "idle", lines: [] }),
    state: SP.Idle,
    peek: false,
    draw: () => screens.drawHUD(),
  });
  screenCell(home, "HUD disconnected (msg 'No Hermes connected')", {
    tama: mkTama({ connected: false, sessionsTotal: 0, sessionsRunning: 0, msg: "No Hermes connected", lines: [] }),
    state: SP.Sleep,
    peek: false,
    draw: () => screens.drawHUD(),
  });
  screenCell(home, "HUD 8 long transcript lines (busy)", {
    tama: mkTama({ sessionsRunning: 3, lines: LINES8 }),
    state: SP.Busy,
    peek: false,
    draw: () => screens.drawHUD(),
  });
  screenCell(home, "HUD scrolled back 2 (msgScroll=2)", {
    tama: mkTama({ sessionsRunning: 3, lines: LINES8 }),
    state: SP.Busy,
    peek: false,
    setup: () => {
      ui.msgScroll = 2;
    },
    draw: () => screens.drawHUD(),
  });
  screenCell(home, "HUD scrolled to oldest (msgScroll=30, clamps)", {
    tama: mkTama({ sessionsRunning: 3, lines: LINES8 }),
    state: SP.Busy,
    peek: false,
    setup: () => {
      ui.msgScroll = 30;
    },
    draw: () => screens.drawHUD(),
  });
  screenCell(home, "HUD short lines (3 lines)", {
    tama: mkTama({ lines: ["you: ls", "tool terminal ls -la", "hermes: 14 files"] }),
    state: SP.Busy,
    peek: false,
    draw: () => screens.drawHUD(),
  });
  screenCell(home, "ATTENTION terminal, waiting 3s", {
    tama: mkTama({
      sessionsWaiting: 1,
      lines: LINES8.slice(0, 3),
      promptId: "call_9fK2xq",
      promptTool: "terminal",
      promptHint: "git push --force-with-lease origin main",
    }),
    state: SP.Attention,
    peek: false,
    setup: () => {
      ui.promptArrivedMs = SCREEN_CLOCK - 3000;
    },
    draw: () => screens.drawHUD(),
  });
  screenCell(home, "ATTENTION clarify, waiting 47s (hot)", {
    tama: mkTama({
      sessionsWaiting: 1,
      promptId: "call_a1b2c3",
      promptTool: "clarify",
      promptHint: "Deploy to staging or production?",
    }),
    state: SP.Attention,
    peek: false,
    setup: () => {
      ui.promptArrivedMs = SCREEN_CLOCK - 47_000;
    },
    draw: () => screens.drawHUD(),
  });
  screenCell(home, "ATTENTION long tool name (19) + 43-char hint", {
    tama: mkTama({
      sessionsWaiting: 2,
      promptId: "call_zz",
      promptTool: "delegate_task_async",
      promptHint: "summarise the last 3 PRs and open follow-ups",
    }),
    state: SP.Attention,
    peek: false,
    setup: () => {
      ui.promptArrivedMs = SCREEN_CLOCK - 12_000;
    },
    draw: () => screens.drawAttention(),
  });
  await tick();

  // ── info pages ──
  const info = addSection(
    "screens-info",
    "Info pages 0-5 (ABOUT, BUTTONS, HERMES, DEVICE, DATABASE, CREDITS)",
    "Pet at 1x in peek mode on top; drawInfo() paints from y=70.",
    6,
  );
  const pageNames = ["ABOUT", "BUTTONS", "HERMES", "DEVICE", "DATABASE", "CREDITS"];
  for (let p = 0; p < 6; p++) {
    screenCell(info, `info page ${p} ${pageNames[p]}`, {
      state: p % 2 ? SP.Idle : SP.Sleep,
      peek: true,
      setup: () => {
        ui.displayMode = DisplayMode.Info;
        ui.infoPage = p;
      },
      draw: () => screens.drawInfo(),
    });
  }
  screenCell(info, "info page 4 DATABASE, disconnected + error", {
    tama: mkTama({
      connected: false,
      error: "state.db not found at /Users/friend/.hermes/state.db",
      schemaVersion: null,
      polledAt: 0,
      sessionsTotal: 0,
      sessionsRunning: 0,
    }),
    state: SP.Sleep,
    peek: true,
    setup: () => {
      ui.displayMode = DisplayMode.Info;
      ui.infoPage = 4;
    },
    draw: () => screens.drawInfo(),
  });
  screenCell(info, "info page 2 HERMES, disconnected", {
    tama: mkTama({ connected: false, sessionsTotal: 0, sessionsRunning: 0, lastUpdated: 0 }),
    state: SP.Sleep,
    peek: true,
    setup: () => {
      ui.displayMode = DisplayMode.Info;
      ui.infoPage = 2;
    },
    draw: () => screens.drawInfo(),
  });
  await tick();

  // ── pet stats ──
  const pet = addSection(
    "screens-pet",
    "Pet stats page",
    "drawPet(): mood hearts, fed pips, energy bar, level badge, pets / napped / tokens lines. Variants set stats() fields directly (live object, not persisted).",
    6,
  );
  const st0 = M.stats ? { ...M.stats.stats() } : null;
  const setStats = (patch: Record<string, number>): void => {
    if (!M.stats) return;
    Object.assign(M.stats.stats() as unknown as Record<string, number>, st0 ?? {}, patch);
  };
  screenCell(pet, "pet stats (defaults)", {
    state: SP.Idle,
    peek: true,
    setup: () => {
      setStats({});
      ui.displayMode = DisplayMode.Pet;
    },
    draw: () => screens.drawPet(),
  });
  screenCell(pet, "pet stats (Lv 7, 4 hearts, fed 6/10, 42 pets)", {
    state: SP.Heart,
    peek: true,
    setup: () => {
      setStats({ level: 7, tokens: 7 * 50_000 + 31_000, pets: 42, napSeconds: 3 * 3600 + 25 * 60, moodPoints: 4, lastMoodAt: FIXED_NOW - 1000 });
      ui.displayMode = DisplayMode.Pet;
    },
    draw: () => screens.drawPet(),
  });
  screenCell(pet, "pet stats (0 hearts, tokens in M)", {
    state: SP.Sleep,
    peek: true,
    tama: mkTama({ tokensToday: 1_250_000 }),
    setup: () => {
      setStats({ level: 99, tokens: 4_950_000, pets: 1234, napSeconds: 123 * 3600 + 5 * 60, moodPoints: 0, lastMoodAt: FIXED_NOW - 1000 });
      ui.displayMode = DisplayMode.Pet;
    },
    draw: () => screens.drawPet(),
  });
  screenCell(pet, "pet stats (owner 'Dan', pet 'Hermes')", {
    state: SP.Idle,
    peek: true,
    setup: () => {
      setStats({ level: 2, tokens: 112_000, pets: 5 });
      L?.ownerSet?.("Dan");
      L?.petNameSet?.("Hermes");
      ui.displayMode = DisplayMode.Pet;
    },
    draw: () => {
      try {
        screens.drawPet();
      } finally {
        L?.ownerSet?.("");
        L?.petNameSet?.("Buddy");
      }
    },
  });
  if (st0) setStats({});
  await tick();

  // ── clocks ──
  const clk = addSection(
    "screens-clock",
    "Clock faces",
    "Date frozen at Wed 3 Jun 2026 14:07:42. Portrait: pet (peek) above, drawClock() paints from y=90. Landscape: drawClock() with ui.clockOrient=1 draws into sprLand (240x135) and pushes it with rotation 1; shown first as the bezel presents it (the 270x480 canvas turned 90deg clockwise, which is what body.landscape does in CSS; text should read upright) and then as the canvas itself looks.",
    4,
  );
  screenCell(clk, "portrait clock (pet peek 1x, idle)", {
    state: SP.Idle,
    peek: true,
    setup: () => {
      ui.clockOrient = 0;
    },
    draw: () => screens.drawClock(),
  });
  screenCell(clk, "portrait clock (pet peek 1x, sleep)", {
    state: SP.Sleep,
    peek: true,
    species: 4,
    setup: () => {
      ui.clockOrient = 0;
    },
    draw: () => screens.drawClock(),
  });
  screenCell(clk, "portrait clock (pet at 2x, as firmware does)", {
    state: SP.Sleep,
    peek: false,
    setup: () => {
      ui.clockOrient = 0;
    },
    draw: () => screens.drawClock(),
  });
  await tick();
  const { sprLand } = need("state");
  let landN = 0;
  const landDraw = (show: Show, mode?: "derotate"): void => {
    const buddy = need("buddy");
    const platform = need("platform");
    platform.setMillisSource(() => clock);
    baseUi(mkTama({ sessionsRunning: 0 }));
    ui.clockOrient = 1;
    ui.activeState = SP.Sleep;
    // warm the pet's tick counter (drawClock only advances it once per call)
    buddy.buddyInit();
    buddy.buddySetSpeciesIdx(PET_FOR_SCREENS);
    clock = 0;
    for (let k = 1; k <= 12; k++) {
      clock += 200;
      buddy.buddyRenderTo(sprLand, SP.Sleep);
    }
    sprLand.fillSprite(0);
    clock = SCREEN_CLOCK + 1000 * ++landN; // drawClock repaints the pet at most every 200 ms
    shared(); // make sure display() is wired before drawClock pushes
    screens.drawClock(); // landscape: composes into sprLand and pushes it (rotation 1) itself
    show(sprLand, 1, mode);
  };
  // sprLand is 240x135. Rotation 1 is what the device receives (canvas 270x480, image turned a quarter).
  addCell(clk, "landscape clock as the bezel shows it (rotation-1 frame, canvas turned 90deg CW like body.landscape)", 240, 135, (show) => landDraw(show, "derotate"));
  addCell(clk, "landscape clock as pushed to the device (rotation 1)", 135, 240, (show) => landDraw(show));
  await tick();
}

// ── menus ──────────────────────────────────────────────────────────────────
async function menuSections(): Promise<void> {
  const { ui } = need("state");
  const { PersonaState } = need("types");
  const menus = need("menus");
  const screens = need("screens");
  const SP = PersonaState;
  const sets = M.stats?.settings();
  const origSettings = sets ? { ...sets } : null;

  const baseHud = (): void => screens.drawHUD();
  const onMenus = addSection("menus-main", "Main menu (hold A), each selection", "menu overlay drawn over the home HUD (pet 2x, 8 lines).", 6);
  for (let i = 0; i < menus.MENU_N; i++) {
    screenCell(onMenus, `menu sel=${i} '${menus.menuItems[i]}'`, {
      tama: mkTama({ sessionsRunning: 2, lines: LINES8 }),
      state: SP.Idle,
      peek: false,
      setup: () => {
        ui.menuOpen = true;
        ui.menuSel = i;
      },
      draw: () => {
        baseHud();
        menus.drawMenu();
      },
    });
  }
  await tick();

  const onSet = addSection("menus-settings", "Settings, each selection", "settings: sound on, on top on, led off, transcript on, clock rot port, brightness 3/4, ascii pet 1/18.", 5);
  for (let i = 0; i < menus.SETTINGS_N; i++) {
    screenCell(onSet, `settings sel=${i} '${menus.settingsItems[i]}'`, {
      tama: mkTama({ sessionsRunning: 2, lines: LINES8 }),
      state: SP.Idle,
      peek: false,
      setup: () => {
        if (sets) Object.assign(sets, { sound: true, onTop: true, led: false, hud: true, clockRot: 1, bright: 3 });
        ui.settingsOpen = true;
        ui.settingsSel = i;
        ui.brightLevel = 3;
      },
      draw: () => {
        baseHud();
        menus.drawSettings();
      },
    });
  }
  screenCell(onSet, "settings sel=0, everything off, clock rot land", {
    tama: mkTama({ sessionsRunning: 2, lines: LINES8 }),
    state: SP.Idle,
    peek: false,
    setup: () => {
      if (sets) Object.assign(sets, { sound: false, onTop: false, led: false, hud: false, clockRot: 2, bright: 0 });
      ui.settingsOpen = true;
      ui.settingsSel = 0;
      ui.brightLevel = 0;
    },
    draw: () => {
      baseHud();
      menus.drawSettings();
    },
  });
  screenCell(onSet, "settings sel=6 'clock rot', all on, clock rot auto", {
    tama: mkTama({ sessionsRunning: 2, lines: LINES8 }),
    state: SP.Idle,
    peek: false,
    setup: () => {
      if (sets) Object.assign(sets, { sound: true, onTop: true, led: true, hud: true, clockRot: 0, bright: 4 });
      ui.settingsOpen = true;
      ui.settingsSel = 6;
      ui.brightLevel = 4;
    },
    draw: () => {
      baseHud();
      menus.drawSettings();
    },
  });
  await tick();

  const onReset = addSection("menus-reset", "Reset menu, normal and armed ('really?')", "Armed = resetConfirmIdx matches and resetConfirmUntil is in the future (fake clock).", 5);
  for (let i = 0; i < menus.RESET_N; i++) {
    screenCell(onReset, `reset sel=${i} '${menus.resetItems[i]}' (normal)`, {
      state: SP.Idle,
      peek: false,
      setup: () => {
        ui.resetOpen = true;
        ui.resetSel = i;
      },
      draw: () => {
        baseHud();
        menus.drawReset();
      },
    });
  }
  for (const i of [0, 1]) {
    screenCell(onReset, `reset sel=${i} ARMED 'really?'`, {
      state: SP.Idle,
      peek: false,
      setup: () => {
        ui.resetOpen = true;
        ui.resetSel = i;
        ui.resetConfirmIdx = i;
        ui.resetConfirmUntil = SCREEN_CLOCK + 2500;
      },
      draw: () => {
        baseHud();
        menus.drawReset();
      },
    });
  }
  await tick();

  if (sets && origSettings) Object.assign(sets, origSettings);
}

// ── GIF character packs ────────────────────────────────────────────────────
// A synthetic pack (tests/gallery/gifpack.ts) pushed through characterInit/characterTick, home and peek,
// plus a text-mode pack. Run last: characterInit() swaps the shared palette, restored by characterClose().
async function gifSections(): Promise<void> {
  const ch = need("character");
  const { spr } = need("state");
  const platform = need("platform");
  const { STATE_NAMES } = need("types");
  const { GIF_FILES, GIF_MANIFEST } = await import("./gifpack");
  try {
    const sec = addSection(
      "gif-character",
      "GIF character pack (synthetic 96x96 3-frame GIFs, one per state)",
      "characterInit(pack) -> characterSetState -> 30 x characterTick at 100 ms (fake clock) into spr. Top row: home (full size, centred in the upper 140px). Bottom row: peek (half size above the info panel).",
      7,
    );
    const ok = await ch.characterInit({ name: GIF_MANIFEST.name, manifest: GIF_MANIFEST as never, files: GIF_FILES });
    if (!ok) throw new Error("characterInit returned false for the synthetic pack");
    for (const peek of [false, true]) {
      for (let st = 0; st < 7; st++) {
        addCell(sec, `gif ${STATE_NAMES[st]} ${peek ? "peek" : "home"}`, W, H, (show) => {
          platform.setMillisSource(() => clock);
          ch.characterSetPeek(peek);
          ch.characterInvalidate();
          ch.characterSetState(st);
          spr.fillSprite(ch.characterPalette().bg);
          clock = 0;
          for (let k = 0; k < 30; k++) {
            clock += 100;
            ch.characterTick();
          }
          show(spr);
        });
      }
    }
    await tick();

    const text = addSection("gif-text", "Text-mode character pack", "manifest mode=text: frames are short strings drawn at size 2.", 7);
    const textPack = {
      name: "qa-text",
      mode: "text",
      colors: { body: "#ffb454", bg: "#000000", text: "#ffffff", textDim: "#808080", ink: "#000000" },
      states: Object.fromEntries(
        STATE_NAMES.map((n, i) => [n, { delay: 300, frames: [`(${n[0]}_${n[0]})`, `(${n[0]}-${n[0]})`, `\\(${i})/`] }]),
      ),
    };
    const ok2 = await ch.characterInit({ name: "qa-text", manifest: textPack as never, files: {} });
    if (!ok2) throw new Error("characterInit returned false for the text pack");
    for (let st = 0; st < 7; st++) {
      addCell(text, `text ${STATE_NAMES[st]} home`, W, H, (show) => {
        platform.setMillisSource(() => clock);
        ch.characterSetPeek(false);
        ch.characterInvalidate();
        ch.characterSetState(st);
        spr.fillSprite(ch.characterPalette().bg);
        clock = 0;
        for (let k = 0; k < 8; k++) {
          clock += 150;
          ch.characterTick();
        }
        show(spr);
      });
    }
  } finally {
    ch.characterClose();
    ch.characterSetPeek(false);
  }
  await tick();
}

// ── main ───────────────────────────────────────────────────────────────────
function updateSummary(done: boolean): void {
  const ok = results.filter((r) => r.status === "ok").length;
  const blank = results.filter((r) => r.status === "blank").length;
  const err = results.filter((r) => r.status === "error").length;
  const s = document.getElementById("summary")!;
  s.innerHTML = `${done ? "done" : "rendering..."} &mdash; ${results.length} cells: <b class="ok">${ok} ok</b>, <b class="blank">${blank} blank</b>, <b class="err">${err} error</b>`;
}

async function main(): Promise<void> {
  const w = window as unknown as Record<string, unknown>;
  w.__galleryReady = false;
  w.__galleryResults = results;
  w.__gallerySections = sectionsMeta;
  w.__galleryImportErrors = importErrors;

  for (const k of Object.keys(loaders) as (keyof typeof loaders)[]) {
    try {
      (M as Record<string, unknown>)[k] = await loaders[k]();
    } catch (e) {
      importErrors[k] = msgOf(e);
    }
  }
  const ie = document.getElementById("importErrors")!;
  ie.textContent = Object.entries(importErrors)
    .map(([k, v]) => `IMPORT FAILED ${k}: ${v}`)
    .join("\n");

  if (!qs.has("realtime")) freezeDate();

  try {
    const stats = M.stats;
    if (stats) {
      await stats.statsLoad();
      await stats.settingsLoad();
    }
  } catch (e) {
    ie.textContent += `\nstatsLoad/settingsLoad failed: ${msgOf(e)}`;
  }

  const groups: [string, () => Promise<void>][] = [
    ["screens", screenSections],
    ["menus", menuSections],
    ["species", speciesSections],
    ["gif", gifSections],
  ];
  for (const [g, fn] of groups) {
    if (!wantGroup(g)) continue;
    try {
      await fn();
    } catch (e) {
      // Section-level failure (e.g. module missing so even addSection inputs fail): report as a cell.
      const root = document.getElementById("root")!;
      const pre = el("pre", "", `GROUP '${g}' aborted: ${msgOf(e)}`);
      pre.style.color = "#ff6b6b";
      root.append(pre);
      results.push({ section: g, label: `group ${g}`, status: "error", error: msgOf(e) });
    }
    updateSummary(false);
    await tick();
  }

  updateSummary(true);
  w.__galleryReady = true;
}

void main();
