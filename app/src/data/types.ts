// Shared data shapes. Mirrors TamaState in the firmware's data.h plus the
// HermesSnapshot the Rust poller emits (see PLAN.md, "Hermes data contract").

export enum PersonaState {
  Sleep = 0,
  Idle = 1,
  Busy = 2,
  Attention = 3,
  Celebrate = 4,
  Dizzy = 5,
  Heart = 6,
}

export const STATE_NAMES = ["sleep", "idle", "busy", "attention", "celebrate", "dizzy", "heart"] as const;

// RGB565 colors, exactly as the firmware stores them.
export interface Palette {
  body: number;
  bg: number;
  text: number;
  textDim: number;
  ink: number;
}

export interface PendingPrompt {
  id: string;
  tool: string;
  hint: string;
}

// Emitted by Rust as event "hermes://snapshot" every 10 s.
export interface HermesSnapshot {
  connected: boolean;
  error: string | null;
  dbPath: string;
  schemaVersion: number | null;
  sessionsTotal: number;
  sessionsRunning: number;
  sessionsWaiting: number;
  recentlyCompleted: boolean;
  tokensToday: number;
  tokensLifetime: number;
  msg: string;
  lines: string[];
  lineGen: number;
  prompt: PendingPrompt | null;
  model: string;
  polledAt: number;
}

// What the UI reads every frame. Field names follow data.h so ported code
// reads the same (tama.sessionsRunning, tama.promptId, ...).
export interface TamaState {
  sessionsTotal: number;
  sessionsRunning: number;
  sessionsWaiting: number;
  recentlyCompleted: boolean;
  tokensToday: number;
  tokensLifetime: number;
  lastUpdated: number; // millis() of last snapshot applied
  msg: string; // <= 23 chars
  connected: boolean;
  lines: string[]; // <= 8 entries, each <= 168 chars (8 transcript rows)
  nLines: number;
  lineGen: number;
  promptId: string; // "" = no pending prompt
  promptTool: string; // <= 19 chars
  promptHint: string; // <= 43 chars
  model: string;
  error: string | null;
  dbPath: string;
  schemaVersion: number | null;
  polledAt: number; // epoch ms of last poll, 0 = never
}

export function emptyTama(): TamaState {
  return {
    sessionsTotal: 0,
    sessionsRunning: 0,
    sessionsWaiting: 0,
    recentlyCompleted: false,
    tokensToday: 0,
    tokensLifetime: 0,
    lastUpdated: 0,
    msg: "No Hermes connected",
    connected: false,
    lines: [],
    nLines: 0,
    lineGen: 0,
    promptId: "",
    promptTool: "",
    promptHint: "",
    model: "",
    error: null,
    dbPath: "",
    schemaVersion: null,
    polledAt: 0,
  };
}

// GIF character pack, as returned by the install_character / get_character commands.
export interface CharacterPack {
  name: string;
  manifest: CharacterManifest;
  files: Record<string, string>; // filename -> base64 bytes
}

export interface CharacterManifest {
  name: string;
  /** "text" packs only recolor the ASCII pet (character.cpp supports both). */
  mode?: "text";
  colors?: Partial<Record<"body" | "bg" | "text" | "textDim" | "ink", string>>; // "#RRGGBB"
  states: Partial<Record<(typeof STATE_NAMES)[number], string | string[]>>;
}
