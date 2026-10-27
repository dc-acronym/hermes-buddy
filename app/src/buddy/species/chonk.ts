// Port of src/buddies/chonk.cpp (claude-desktop-buddy). Kept 1:1 with the firmware:
// pose strings, SEQ tables, frame math, particle positions and colors are unchanged.
import type { Species } from "../common";
import {
  buddyPrint,
  buddyPrintSprite,
  buddySetColor,
  buddySetCursor,
  BUDDY_CYAN,
  BUDDY_DIM,
  BUDDY_GREEN,
  BUDDY_HEART,
  BUDDY_PURPLE,
  BUDDY_RED,
  BUDDY_WHITE,
  BUDDY_X_CENTER,
  BUDDY_YEL,
  BUDDY_Y_BASE,
  BUDDY_Y_OVERLAY,
} from "../common";

// ─── SLEEP ───  ~12s cycle, 6 poses (heavy belly breathing)
function doSleep(t: number): void {
  const CURL = [ "            ", "            ", "  /\\____/\\  ", " ( -    - ) ", " (___zz___) " ];
  const INHALE = [ "            ", "  /\\____/\\  ", " ( -    - ) ", " (   --   ) ", " (________) " ];
  const EXHALE = [ "            ", "  /\\____/\\  ", " ( -    - ) ", "(    --    )", "(__________)" ];
  const SNORE = [ "            ", "  /\\____/\\  ", " ( -    - ) ", "(    OO    )", "(__________)" ];
  const JIGGLE = [ "            ", "  /\\____/\\  ", " ( -    - ) ", "(   ~~~~   )", " ~~~~~~~~~~ " ];
  const DROOL = [ "            ", "  /\\____/\\  ", " ( -    u ) ", " (   __   ) ", " (___..___) " ];

  const P = [CURL, INHALE, EXHALE, SNORE, INHALE, JIGGLE];
  const SEQ = [
    0,0,0,1,2,1,2,
    1,2,1,2,
    3,3,1,2,
    1,2,1,2,
    5,4,5,4,
    0,0,
    1,2,3,2
  ];
  const beat = Math.floor(t / 5) % SEQ.length;
  const pose = SEQ[beat];
  // Belly jiggle on EXHALE/JIGGLE poses
  const yOff = pose === 5 ? ((t & 1) ? 1 : 0) : 0;
  buddyPrintSprite(P[pose], 5, yOff, 0xFD20);

  // Z particles drift up-right, lazy and heavy
  const p1 = t % 12;
  const p2 = (t + 5) % 12;
  const p3 = (t + 9) % 12;
  buddySetColor(BUDDY_DIM);
  buddySetCursor(BUDDY_X_CENTER + 18 + p1, BUDDY_Y_OVERLAY + 20 - p1 * 2);
  buddyPrint("z");
  buddySetColor(BUDDY_WHITE);
  buddySetCursor(BUDDY_X_CENTER + 24 + p2, BUDDY_Y_OVERLAY + 16 - p2);
  buddyPrint("Z");
  buddySetColor(BUDDY_DIM);
  buddySetCursor(BUDDY_X_CENTER + 30 + Math.floor(p3 / 2), BUDDY_Y_OVERLAY + 12 - Math.floor(p3 / 2));
  buddyPrint("z");
}

// ─── IDLE ───  ~16s cycle, 10 poses (round mystery, ears swivel)
function doIdle(t: number): void {
  const REST = [ "            ", "  /\\____/\\  ", " ( o    o ) ", " (   ..   ) ", "  `------'  " ];
  const LOOK_L = [ "            ", "  /\\____/\\  ", " (o     o ) ", " (   ..   ) ", "  `------'  " ];
  const LOOK_R = [ "            ", "  /\\____/\\  ", " ( o     o) ", " (   ..   ) ", "  `------'  " ];
  const LOOK_U = [ "            ", "  /\\____/\\  ", " ( '    ' ) ", " (   ..   ) ", "  `------'  " ];
  const BLINK = [ "            ", "  /\\____/\\  ", " ( -    - ) ", " (   ..   ) ", "  `------'  " ];
  const EAR_L = [ "            ", "  /|____/\\  ", " ( o    o ) ", " (   ..   ) ", "  `------'  " ];
  const EAR_R = [ "            ", "  /\\____|\\  ", " ( o    o ) ", " (   ..   ) ", "  `------'  " ];
  const JIG_A = [ "            ", "  /\\____/\\  ", " ( o    o ) ", "(    ..    )", " (________) " ];
  const JIG_B = [ "            ", "  /\\____/\\  ", " ( o    o ) ", " (   ..   ) ", "(__________)" ];
  const SNIFF = [ "            ", "  /\\____/\\  ", " ( o    o ) ", " (   oo   ) ", "  `------'  " ];

  const P = [REST, LOOK_L, LOOK_R, LOOK_U, BLINK, EAR_L, EAR_R, JIG_A, JIG_B, SNIFF];
  const SEQ = [
    0,0,0,4,0,1,1,0,
    2,2,0,4,
    5,0,6,0,
    0,3,3,0,
    7,8,7,8,
    0,0,4,0,
    9,9,0,0,
    0,5,6,0
  ];
  const beat = Math.floor(t / 5) % SEQ.length;
  buddyPrintSprite(P[SEQ[beat]], 5, 0, 0xFD20);
}

// ─── BUSY ───  ~10s cycle, 6 poses + cog ticker
function doBusy(t: number): void {
  const PONDER = [ "      ?     ", "  /\\____/\\  ", " ( o    o ) ", " (   --   ) ", "  `------'  " ];
  const CALC_A = [ "            ", "  /\\____/\\  ", " ( v    v ) ", " (   ::   ) ", " /`------'\\ " ];
  const CALC_B = [ "            ", "  /\\____/\\  ", " ( v    v ) ", " (   ;;   ) ", " \\`------'/ " ];
  const SCRIBE = [ "    ___     ", "  /\\___/\\/  ", " ( o    o-- ", " (   --   ) ", "  `------'  " ];
  const AHA = [ "      *     ", "  /\\____/\\  ", " ( O    O ) ", " (   ^^   ) ", " /`------'\\ " ];
  const SIGH = [ "    ~~~     ", "  /\\____/\\  ", " ( -    - ) ", " (   __   ) ", "  `------'  " ];

  const P = [PONDER, CALC_A, CALC_B, SCRIBE, AHA, SIGH];
  const SEQ = [
    1,2,1,2,1,2, 0,0, 1,2,1,2, 3,3,3, 4,4, 1,2,1,2, 5,5
  ];
  const beat = Math.floor(t / 5) % SEQ.length;
  buddyPrintSprite(P[SEQ[beat]], 5, 0, 0xFD20);

  // Cog/dot ticker spinning beside head
  const COGS = [ "+  ", "x  ", "*  ", "x  " ];
  buddySetColor(BUDDY_CYAN);
  buddySetCursor(BUDDY_X_CENTER + 24, BUDDY_Y_OVERLAY + 12);
  buddyPrint(COGS[t % 4]);
  buddySetColor(BUDDY_WHITE);
  buddySetCursor(BUDDY_X_CENTER + 30, BUDDY_Y_OVERLAY + 18);
  buddyPrint(COGS[(t + 2) % 4]);
}

// ─── ATTENTION ───  ~8s cycle, 6 poses + ! pulse (heavy alert wobble)
function doAttention(t: number): void {
  const ALERT = [ "    ^  ^    ", "  /^____^\\  ", " ( O    O ) ", " (   o    ) ", "  `------'  " ];
  const SCAN_L = [ "    ^  ^    ", "  /^____^\\  ", " (O     O ) ", " (   o    ) ", "  `------'  " ];
  const SCAN_R = [ "    ^  ^    ", "  /^____^\\  ", " ( O     O) ", " (   o    ) ", "  `------'  " ];
  const PERK = [ "    /\\/\\    ", "  /^____^\\  ", " ( ^    ^ ) ", " (   o    ) ", "  `------'  " ];
  const TENSE = [ "    ^  ^    ", " /^^____^^\\ ", " ( O    O ) ", " (   o    ) ", " /`------'\\ " ];
  const GULP = [ "    ^  ^    ", "  /^____^\\  ", " ( o    o ) ", " (   O    ) ", "  `------'  " ];

  const P = [ALERT, SCAN_L, SCAN_R, PERK, TENSE, GULP];
  const SEQ = [
    0,4,0,1,0,2,0,3, 4,4,0,1,2,0, 5,0
  ];
  const beat = Math.floor(t / 5) % SEQ.length;
  const pose = SEQ[beat];
  const xOff = pose === 4 ? ((t & 1) ? 2 : -2) : 0;
  buddyPrintSprite(P[pose], 5, 0, 0xFD20, xOff);

  if (Math.floor(t / 2) & 1) {
    buddySetColor(BUDDY_YEL);
    buddySetCursor(BUDDY_X_CENTER - 6, BUDDY_Y_OVERLAY);
    buddyPrint("!");
  }
  if (Math.floor(t / 3) & 1) {
    buddySetColor(BUDDY_RED);
    buddySetCursor(BUDDY_X_CENTER + 6, BUDDY_Y_OVERLAY + 4);
    buddyPrint("!");
  }
  if (Math.floor(t / 4) & 1) {
    buddySetColor(BUDDY_YEL);
    buddySetCursor(BUDDY_X_CENTER - 14, BUDDY_Y_OVERLAY + 6);
    buddyPrint("!");
  }
}

// ─── CELEBRATE ───  ~6s cycle, 6 poses + confetti rain (heavy belly bounce)
function doCelebrate(t: number): void {
  const CROUCH = [ "            ", "  /\\____/\\  ", " ( ^    ^ ) ", "(    WW    )", "(__________)" ];
  const JUMP = [ "  \\(    )/  ", "   /____\\   ", " ( ^    ^ ) ", " (   WW   ) ", "  `------'  " ];
  const PEAK = [ "  \\^    ^/  ", "   /____\\   ", " ( ^    ^ ) ", " (   OO   ) ", "  `------'  " ];
  const SPIN_L = [ "            ", "  /\\____/\\  ", "( <    < ) /", " (   ww   ) ", "  `------'  " ];
  const SPIN_R = [ "            ", "  /\\____/\\  ", "\\( >    > )", " (   ww   ) ", "  `------'  " ];
  const POSE = [ "    \\__/    ", "  /\\____/\\  ", " ( ^    ^ ) ", "/(   WW   )\\", "  `------'  " ];

  const P = [CROUCH, JUMP, PEAK, SPIN_L, SPIN_R, POSE];
  const SEQ = [ 0,1,2,1,0, 3,4,3,4, 0,1,2,1,0, 5,5 ];
  const Y_SHIFT = [ 0,-3,-7,-3,0, 0,0,0,0, 0,-3,-7,-3,0, 0,0 ];
  const beat = Math.floor(t / 3) % SEQ.length;
  buddyPrintSprite(P[SEQ[beat]], 5, Y_SHIFT[beat], 0xFD20);

  const cols = [ BUDDY_YEL, BUDDY_HEART, BUDDY_CYAN, BUDDY_WHITE, BUDDY_GREEN, BUDDY_PURPLE ];
  for (let i = 0; i < 7; i++) {
    const phase = (t * 2 + i * 9) % 24;
    const x = BUDDY_X_CENTER - 42 + i * 14;
    const y = BUDDY_Y_OVERLAY - 8 + phase;
    if (y > BUDDY_Y_BASE + 22 || y < 0) continue;
    buddySetColor(cols[i % 6]);
    buddySetCursor(x, y);
    buddyPrint(((i + Math.floor(t / 2)) & 1) ? "*" : "o");
  }
}

// ─── DIZZY ───  ~6s cycle, 5 poses + orbiting stars (big body lurches)
function doDizzy(t: number): void {
  const TILT_L = [ "            ", " /\\____/\\   ", "( @    @ )  ", " (   ~~   ) ", "  `------'  " ];
  const TILT_R = [ "            ", "   /\\____/\\ ", "  ( @    @ )", " (   ~~   ) ", "  `------'  " ];
  const WOOZY = [ "            ", "  /\\____/\\  ", " ( x    @ ) ", " (   ~v   ) ", "  `------'  " ];
  const WOOZY2 = [ "            ", "  /\\____/\\  ", " ( @    x ) ", " (   v~   ) ", "  `------'  " ];
  const TUMBLE = [ "            ", "  /\\____/\\  ", " ( @    @ ) ", "(    --    )", " /`-_---_'\\ " ];

  const P = [TILT_L, TILT_R, WOOZY, WOOZY2, TUMBLE];
  const SEQ = [ 0,1,0,1, 2,3, 0,1,0,1, 4,4, 2,3 ];
  const X_SHIFT = [ -4,4,-4,4, 0,0, -4,4,-4,4, 0,0, 0,0 ];
  const beat = Math.floor(t / 4) % SEQ.length;
  buddyPrintSprite(P[SEQ[beat]], 5, 0, 0xFD20, X_SHIFT[beat]);

  // Stars orbiting in a wider ellipse around the chonk's head
  const OX = [ 0, 6, 9, 6, 0, -6, -9, -6 ];
  const OY = [ -6, -4, 0, 4, 6, 4, 0, -4 ];
  const p1 = t % 8;
  const p2 = (t + 3) % 8;
  const p3 = (t + 5) % 8;
  buddySetColor(BUDDY_CYAN);
  buddySetCursor(BUDDY_X_CENTER + OX[p1] - 2, BUDDY_Y_OVERLAY + 6 + OY[p1]);
  buddyPrint("*");
  buddySetColor(BUDDY_YEL);
  buddySetCursor(BUDDY_X_CENTER + OX[p2] - 2, BUDDY_Y_OVERLAY + 6 + OY[p2]);
  buddyPrint("*");
  buddySetColor(BUDDY_WHITE);
  buddySetCursor(BUDDY_X_CENTER + OX[p3] - 2, BUDDY_Y_OVERLAY + 6 + OY[p3]);
  buddyPrint("+");
}

// ─── HEART ───  ~10s cycle, 6 poses + rising heart stream (blushy chonk)
function doHeart(t: number): void {
  const DREAMY = [ "            ", "  /\\____/\\  ", " ( ^    ^ ) ", " (   ww   ) ", "  `------'  " ];
  const BLUSH = [ "            ", "  /\\____/\\  ", " (#^    ^#) ", " (   ww   ) ", "  `------'  " ];
  const EYES_C = [ "            ", "  /\\____/\\  ", " ( <3  <3 ) ", " (   ww   ) ", "  `------'  " ];
  const TWIRL = [ "            ", "  /\\____/\\  ", " ( @    @ ) ", "(    ww    )", " /`------'\\ " ];
  const SIGH = [ "            ", "  /\\____/\\  ", " ( -    - ) ", " (   ^^   ) ", "  `------'  " ];
  const HUG = [ "  v      v  ", "  /\\____/\\  ", " ( ^    ^ ) ", "/(   ww   )\\", "  `------'  " ];

  const P = [DREAMY, BLUSH, EYES_C, TWIRL, SIGH, HUG];
  const SEQ = [
    0,0,1,0, 2,2,0, 1,0,4, 0,0,3,3, 0,1,0,2, 5,5,0, 1,0
  ];
  const Y_BOB = [ 0,-1,0,-1, 0,-1,0, -1,0,0, -1,0,0,0, -1,0,-1,0, 0,-1,0, -1,0 ];
  const beat = Math.floor(t / 5) % SEQ.length;
  buddyPrintSprite(P[SEQ[beat]], 5, Y_BOB[beat], 0xFD20);

  buddySetColor(BUDDY_HEART);
  for (let i = 0; i < 6; i++) {
    const phase = (t + i * 3) % 18;
    const y = BUDDY_Y_OVERLAY + 16 - phase;
    if (y < -2 || y > BUDDY_Y_BASE) continue;
    const x = BUDDY_X_CENTER - 22 + i * 8 + (Math.floor(phase / 3) & 1) * 2 - 1;
    buddySetCursor(x, y);
    buddyPrint("v");
  }
}

export const CHONK_SPECIES: Species = {
  name: "chonk",
  bodyColor: 0xFD20,
  states: [doSleep, doIdle, doBusy, doAttention, doCelebrate, doDizzy, doHeart],
};
