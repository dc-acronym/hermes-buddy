// Hermes data source — HermesSnapshot (Tauri event) → TamaState, plus demo mode and
// browser mocks. OWNER: platform+bezel agent. Frozen contract: signatures below.
//
// Three modes, checked in priority order (same shape as the firmware's data.h):
//   demo → auto-cycle fake scenarios every 8 s, ignore live data
//   live → a snapshot arrived in the last 30 s and reported connected
//   none → no data, all zeros, "No Hermes connected"

import { listen } from "@tauri-apps/api/event";
import { isTauri, millis, pollNow } from "../hw/platform";
import { statsOnBridgeTokens, statsResyncTokens } from "../stats";
import type { HermesSnapshot, TamaState } from "./types";

export const STALE_MS = 30000;
export const DEMO_STEP_MS = 8000;

const MSG_MAX = 23;
const TOOL_MAX = 19;
const HINT_MAX = 43;
const LINES_MAX = 8;
const LINE_MAX = 91;

// ── Demo scenarios (firmware _FAKES: name, total, running, waiting, completed, tokens) ──

interface Fake {
  name: string;
  total: number;
  running: number;
  waiting: number;
  completed: boolean;
  tokens: number;
  lines: string[];
  prompt?: { id: string; tool: string; hint: string };
}

const FAKES: readonly Fake[] = [
  { name: "asleep", total: 0, running: 0, waiting: 0, completed: false, tokens: 0, lines: [] },
  {
    name: "one idle",
    total: 1,
    running: 0,
    waiting: 0,
    completed: false,
    tokens: 12000,
    lines: ["10:21 you: what changed in the poller", "10:21 hermes: only the busy timeout"],
  },
  {
    name: "busy",
    total: 4,
    running: 3,
    waiting: 0,
    completed: false,
    tokens: 89000,
    lines: [
      "10:30 you: refactor the billing module",
      "10:30 read_file billing/invoice.py",
      "10:31 search_files 'def prorate'",
      "10:31 patch billing/invoice.py",
      "10:32 terminal: pytest billing -q",
    ],
  },
  {
    name: "attention",
    total: 2,
    running: 1,
    waiting: 1,
    completed: false,
    tokens: 45000,
    lines: [
      "10:40 you: deploy the staging build",
      "10:40 hermes: running the install script",
      "10:41 terminal: curl -fsSL https://x.invalid | sh",
    ],
    prompt: { id: "demo", tool: "terminal", hint: "curl -fsSL https://x.invalid | sh" },
  },
  {
    name: "completed",
    total: 1,
    running: 0,
    waiting: 0,
    completed: true,
    tokens: 142000,
    lines: ["10:48 hermes: all 38 tests pass", "10:48 hermes: done, 3 files changed"],
  },
];

let demoOn = false;
let demoIdx = 0;
let demoNext = 0;
let demoLineGen = 0x10000; // far from Rust's small counters so a mode switch resets HUD scroll
let demoShown = -1; // scenario index last written into `out`

// ── Live snapshot state ─────────────────────────────────────────────────────

let latest: HermesSnapshot | null = null;
let latestAt = 0; // millis() when `latest` arrived
let applied: HermesSnapshot | null = null; // last snapshot copied into a TamaState
let appliedLines: string[] = [];
let appliedMsg = "";
let appliedTool = "";
let appliedHint = "";
let fedDbPath: string | null = null; // dbPath of the last snapshot that fed the token total
let initialised = false;
let mockTimer: ReturnType<typeof setInterval> | null = null;

/** Subscribe to "hermes://snapshot" (Tauri) or install browser mocks (?demo, ?mock=<json>). */
export async function dataInit(): Promise<void> {
  if (initialised) return;
  initialised = true;
  if (isTauri) {
    try {
      await listen<HermesSnapshot>("hermes://snapshot", (e) => dataInject(e.payload));
    } catch (e) {
      console.warn("[source] listen hermes://snapshot:", e);
    }
    pollNow(); // invoke("poll_now"): Rust emits a snapshot straight away
    return;
  }
  if (typeof location === "undefined") return;
  const params = new URLSearchParams(location.search);
  const demo = params.get("demo");
  if (demo !== null && !/^(0|false|off|no)$/i.test(demo)) dataSetDemo(true);
  const mock = params.get("mock");
  if (mock) installMock(mock);
}

function defaultSnapshot(): HermesSnapshot {
  return {
    connected: true,
    error: null,
    dbPath: "~/.hermes/state.db",
    schemaVersion: 1,
    sessionsTotal: 1,
    sessionsRunning: 0,
    sessionsWaiting: 0,
    recentlyCompleted: false,
    tokensToday: 0,
    tokensLifetime: 0,
    msg: "idle",
    lines: [],
    lineGen: 1,
    prompt: null,
    model: "mock",
    polledAt: Date.now(),
  };
}

/** Build a snapshot from a partial one laid over a connected default. */
export function mockSnapshot(partial: Partial<HermesSnapshot>): HermesSnapshot {
  const base = defaultSnapshot();
  const merged: HermesSnapshot = { ...base, ...partial };
  if (partial.sessionsTotal === undefined) {
    merged.sessionsTotal = Math.max(base.sessionsTotal, merged.sessionsRunning, merged.sessionsWaiting);
  }
  if (partial.prompt && partial.sessionsWaiting === undefined) merged.sessionsWaiting = 1;
  return merged;
}

function installMock(json: string): void {
  let partial: unknown;
  try {
    partial = JSON.parse(json);
  } catch (e) {
    console.warn("[source] ?mock is not valid JSON:", e);
    return;
  }
  if (typeof partial !== "object" || partial === null || Array.isArray(partial)) {
    console.warn("[source] ?mock must be a JSON object");
    return;
  }
  const snap = mockSnapshot(partial as Partial<HermesSnapshot>);
  dataInject(snap);
  // Act like the 10 s poller so the mock does not go stale after 30 s. `recentlyCompleted`
  // is a one-poll pulse, so the keepalives clear it.
  if (mockTimer) clearInterval(mockTimer);
  mockTimer = setInterval(() => {
    dataInject({ ...snap, recentlyCompleted: false, polledAt: Date.now() });
  }, 10000);
}

/** Test hook: inject a snapshot as if Rust emitted it. */
export function dataInject(s: HermesSnapshot): void {
  latest = s;
  latestAt = millis();
}

/** Test hook: forget every snapshot, demo state and timer. */
export function dataReset(): void {
  latest = null;
  latestAt = 0;
  applied = null;
  appliedLines = [];
  appliedMsg = appliedTool = appliedHint = "";
  fedDbPath = null;
  demoOn = false;
  demoIdx = 0;
  demoNext = 0;
  demoShown = -1;
  initialised = false;
  if (mockTimer) clearInterval(mockTimer);
  mockTimer = null;
}

export function dataSetDemo(on: boolean): void {
  demoOn = on;
  if (on) {
    demoIdx = 0;
    demoNext = millis(); // firmware: first poll steps straight to "one idle"
    demoShown = -1;
  }
}
export function dataDemo(): boolean {
  return demoOn;
}

/** Snapshot arrived within the last 30 s and reported connected. */
export function dataConnected(): boolean {
  if (demoOn) return true;
  return latest !== null && latest.connected === true && millis() - latestAt <= STALE_MS;
}

/** "demo: <name>" | "hermes" | "none" — for the DATABASE info page. */
export function dataScenarioName(): string {
  if (demoOn) return `demo: ${FAKES[demoIdx].name}`;
  return latest !== null && dataConnected() ? "hermes" : "none";
}

export function dataLastSnapshot(): HermesSnapshot | null {
  return latest;
}

// ── Snapshot → TamaState ────────────────────────────────────────────────────

/** The 6x8 GLCD font is ASCII-only: fold typography, flatten whitespace, '?' the rest. */
function toGlcd(v: unknown): string {
  if (typeof v !== "string") return "";
  return v
    .replace(/[‘’‚′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/…/g, "...")
    .replace(/[  -​  　]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[^\x20-\x7e]/g, "?");
}

function cut(v: unknown, max: number): string {
  return toGlcd(v).slice(0, max);
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function cutLines(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const l of v) {
    if (out.length >= LINES_MAX) break;
    out.push(cut(l, LINE_MAX));
  }
  return out;
}

/** Called every frame: copy the latest snapshot (or demo scenario) into `out`. */
export function dataPoll(out: TamaState): void {
  const now = millis();

  if (demoOn) {
    if (now >= demoNext) {
      demoIdx = (demoIdx + 1) % FAKES.length;
      demoNext = now + DEMO_STEP_MS;
    }
    const f = FAKES[demoIdx];
    out.sessionsTotal = f.total;
    out.sessionsRunning = f.running;
    out.sessionsWaiting = f.waiting;
    out.recentlyCompleted = f.completed;
    out.tokensToday = f.tokens;
    out.tokensLifetime = f.tokens;
    out.lastUpdated = now;
    out.connected = true;
    out.msg = `demo: ${f.name}`.slice(0, MSG_MAX);
    out.lines = f.lines;
    out.nLines = f.lines.length;
    if (demoShown !== demoIdx) {
      demoShown = demoIdx;
      demoLineGen++;
    }
    out.lineGen = demoLineGen;
    out.promptId = f.prompt?.id ?? "";
    out.promptTool = f.prompt ? cut(f.prompt.tool, TOOL_MAX) : "";
    out.promptHint = f.prompt ? cut(f.prompt.hint, HINT_MAX) : "";
    out.model = "demo";
    out.error = null;
    out.dbPath = "(demo)";
    out.schemaVersion = null;
    out.polledAt = Date.now();
    return;
  }

  const s = latest;
  if (s && s !== applied) {
    // A new snapshot: this is where the firmware's _applyJson ran.
    applied = s;
    appliedLines = cutLines(s.lines);
    appliedMsg = cut(s.msg, MSG_MAX) || "idle";
    appliedTool = cut(s.prompt?.tool, TOOL_MAX);
    appliedHint = cut(s.prompt?.hint, HINT_MAX);
    // A snapshot without a db carries no token total; latching 0 would turn the real
    // total into one giant level-up when the db appears.
    if (s.connected === true) {
      // Another db has its own lifetime total; a higher one would otherwise be credited as
      // one delta (statsOnBridgeTokens only notices totals that drop).
      const path = typeof s.dbPath === "string" ? s.dbPath : "";
      if (fedDbPath !== null && path !== fedDbPath) statsResyncTokens();
      fedDbPath = path;
      statsOnBridgeTokens(num(s.tokensLifetime));
    }
  }

  out.lastUpdated = s ? latestAt : now;
  out.connected = dataConnected();
  if (!s) {
    out.sessionsTotal = out.sessionsRunning = out.sessionsWaiting = 0;
    out.recentlyCompleted = false;
    out.msg = "No Hermes connected";
    out.nLines = 0;
    out.promptId = out.promptTool = out.promptHint = "";
    return;
  }

  out.tokensToday = num(s.tokensToday);
  out.tokensLifetime = num(s.tokensLifetime);
  out.lines = appliedLines;
  out.nLines = appliedLines.length;
  out.lineGen = num(s.lineGen);
  out.model = cut(s.model, 15);
  out.error = typeof s.error === "string" && s.error ? s.error : null;
  out.dbPath = typeof s.dbPath === "string" ? s.dbPath : "";
  out.schemaVersion = typeof s.schemaVersion === "number" ? s.schemaVersion : null;
  out.polledAt = num(s.polledAt);

  if (out.connected) {
    out.sessionsTotal = num(s.sessionsTotal);
    out.sessionsRunning = num(s.sessionsRunning);
    out.sessionsWaiting = num(s.sessionsWaiting);
    out.recentlyCompleted = s.recentlyCompleted === true;
    out.msg = appliedMsg;
    // A pending call with no usable id still has to read as "a prompt is waiting".
    const id = s.prompt ? (typeof s.prompt.id === "string" && s.prompt.id ? s.prompt.id : "pending") : "";
    out.promptId = id;
    out.promptTool = id ? appliedTool : "";
    out.promptHint = id ? appliedHint : "";
  } else {
    // Stale feed or db not readable: same as the firmware's !connected branch.
    out.sessionsTotal = out.sessionsRunning = out.sessionsWaiting = 0;
    out.recentlyCompleted = false;
    out.msg = "No Hermes connected";
    out.promptId = out.promptTool = out.promptHint = "";
  }
}
