// Port of src/buddies/cat.cpp (claude-desktop-buddy). Kept 1:1 with the firmware:
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
  BUDDY_WHITE,
  BUDDY_X_CENTER,
  BUDDY_YEL,
  BUDDY_Y_BASE,
  BUDDY_Y_OVERLAY,
} from "../common";

// ─── SLEEP ───  ~12s cycle, 6 poses (curled loaf, breathing, twitching tail)
function doSleep(t: number): void {
  const LOAF = [ "            ", "            ", "   .-..-.   ", "  ( -.- )   ", "  `------`~ " ];
  const BREATHE = [ "            ", "            ", "   .-..-.   ", "  ( -.- )_  ", " `~------'~ " ];
  const CURL = [ "            ", "            ", "   .-/\\.    ", "  (  ..  )) ", "  `~~~~~~`  " ];
  const CURL_TW = [ "            ", "            ", "   .-/\\.    ", "  (  ..  )) ", "  `~~~~~~`~ " ];
  const PURR = [ "            ", "            ", "   .-..-.   ", "  ( u.u )   ", " `~------'~ " ];
  const DREAM = [ "            ", "            ", "   .-..-.   ", "  ( o.o )   ", "  `------`  " ];

  const P = [LOAF, BREATHE, LOAF, PURR, CURL, CURL_TW];
  const SEQ = [
    0,1,0,1,0,1,
    3,3,0,1,
    4,5,4,5,4,5,
    2,2,
    0,1,0,1,
    5,5,4,4
  ];
  const beat = Math.floor(t / 5) % SEQ.length;
  buddyPrintSprite(P[SEQ[beat]], 5, 0, 0xC2A6);

  // Z particles drift up-right (3 staggered streams)
  const p1 = t % 12;
  const p2 = (t + 5) % 12;
  const p3 = (t + 9) % 12;
  buddySetColor(BUDDY_DIM);
  buddySetCursor(BUDDY_X_CENTER + 18 + p1, BUDDY_Y_OVERLAY + 18 - p1 * 2);
  buddyPrint("z");
  buddySetColor(BUDDY_WHITE);
  buddySetCursor(BUDDY_X_CENTER + 24 + p2, BUDDY_Y_OVERLAY + 14 - p2);
  buddyPrint("Z");
  buddySetColor(BUDDY_DIM);
  buddySetCursor(BUDDY_X_CENTER + 14 + Math.floor(p3 / 2), BUDDY_Y_OVERLAY + 8 - Math.floor(p3 / 2));
  buddyPrint("z");
}

// ─── IDLE ───  ~16s cycle, 10 poses (sassy micro-actions)
function doIdle(t: number): void {
  const REST = [ "            ", "   /\\_/\\    ", "  ( o   o ) ", "  (  w   )  ", "  (\")_(\")   " ];
  const LOOK_L = [ "            ", "   /\\_/\\    ", "  (o    o ) ", "  (  w   )  ", "  (\")_(\")   " ];
  const LOOK_R = [ "            ", "   /\\_/\\    ", "  ( o    o) ", "  (  w   )  ", "  (\")_(\")   " ];
  const BLINK = [ "            ", "   /\\_/\\    ", "  ( -   - ) ", "  (  w   )  ", "  (\")_(\")   " ];
  const SLOW_BL = [ "            ", "   /\\-/\\    ", "  ( _   _ ) ", "  (  w   )  ", "  (\")_(\")   " ];
  const EAR_L = [ "            ", "   <\\_/\\    ", "  ( o   o ) ", "  (  w   )  ", "  (\")_(\")   " ];
  const EAR_R = [ "            ", "   /\\_/>    ", "  ( o   o ) ", "  (  w   )  ", "  (\")_(\")   " ];
  const TAIL_L = [ "            ", "   /\\_/\\    ", "  ( o   o ) ", "  (  w   )  ", "  (\")_(\")~  " ];
  const TAIL_R = [ "            ", "   /\\_/\\    ", "  ( o   o ) ", "  (  w   )  ", " ~(\")_(\")   " ];
  const GROOM = [ "            ", "   /\\_/\\    ", "  ( ^   ^ ) ", "  (  P   )  ", "  (\")_(\")   " ];

  const P = [REST, LOOK_L, LOOK_R, BLINK, SLOW_BL, EAR_L, EAR_R, TAIL_L, TAIL_R, GROOM];
  const SEQ = [
    0,0,0,3,0,1,0,2,0,
    7,8,7,8,7,
    0,5,0,6,0,
    4,4,0,
    9,9,9,0,
    0,3,0,
    8,7,8,7,
    0,0,4,0
  ];
  const beat = Math.floor(t / 5) % SEQ.length;
  buddyPrintSprite(P[SEQ[beat]], 5, 0, 0xC2A6);
}

// ─── BUSY ───  ~10s cycle, 6 poses + dot ticker (knocking-things-off-table energy)
function doBusy(t: number): void {
  const PAW_UP = [ "      .     ", "   /\\_/\\    ", "  ( o   o ) ", "  (  w   )/ ", "  (\")_(\")   " ];
  const PAW_TAP = [ "    .       ", "   /\\_/\\    ", "  ( o   o ) ", "  (  w   )_ ", "  (\")_(\")   " ];
  const STARE = [ "            ", "   /\\_/\\    ", "  ( O   O ) ", "  (  w   )  ", "  (\")_(\")   " ];
  const NUDGE = [ "    o       ", "   /\\_/\\    ", "  ( o   o ) ", "  ( -w   )  ", "  (\")_(\")   " ];
  const SHOVE = [ "  o         ", "   /\\_/\\    ", "  ( o   o ) ", "  (-w    )  ", "  (\")_(\")   " ];
  const SMUG = [ "            ", "   /\\_/\\    ", "  ( -   - ) ", "  (  w   )  ", "  (\")_(\")   " ];

  const P = [PAW_UP, PAW_TAP, STARE, NUDGE, SHOVE, SMUG];
  const SEQ = [
    2,2,2, 0,1,0,1, 3,4,3,4, 5,5, 2,2, 0,1,0,1, 5,2
  ];
  const beat = Math.floor(t / 5) % SEQ.length;
  buddyPrintSprite(P[SEQ[beat]], 5, 0, 0xC2A6);

  const DOTS = [ ".  ", ".. ", "...", " ..", "  .", "   " ];
  buddySetColor(BUDDY_WHITE);
  buddySetCursor(BUDDY_X_CENTER + 22, BUDDY_Y_OVERLAY + 14);
  buddyPrint(DOTS[t % 6]);
}

// ─── ATTENTION ───  ~8s cycle, 6 poses + ! pulse (ears up, dilated pupils)
function doAttention(t: number): void {
  const ALERT = [ "            ", "   /^_^\\    ", "  ( O   O ) ", "  (  v   )  ", "  (\")_(\")   " ];
  const SCAN_L = [ "            ", "   /^_^\\    ", "  (O    O ) ", "  (  v   )  ", "  (\")_(\")   " ];
  const SCAN_R = [ "            ", "   /^_^\\    ", "  ( O    O) ", "  (  v   )  ", "  (\")_(\")   " ];
  const SCAN_U = [ "            ", "   /^_^\\    ", "  ( ^   ^ ) ", "  (  v   )  ", "  (\")_(\")   " ];
  const CROUCH = [ "            ", "   /^_^\\    ", " /( O   O )\\", " (   v    ) ", " /(\")_(\")\\  " ];
  const HISS = [ "            ", "   /^_^\\    ", "  ( O   O ) ", "  (  >   )  ", "  (\")_(\")   " ];

  const P = [ALERT, SCAN_L, SCAN_R, SCAN_U, CROUCH, HISS];
  const SEQ = [
    0,4,0,1,0,2,0,3, 4,4,0,1,2,0, 5,0
  ];
  const beat = Math.floor(t / 5) % SEQ.length;
  const pose = SEQ[beat];
  const xOff = pose === 4 ? ((t & 1) ? 1 : -1) : 0;
  buddyPrintSprite(P[pose], 5, 0, 0xC2A6, xOff);

  if (Math.floor(t / 2) & 1) {
    buddySetColor(BUDDY_YEL);
    buddySetCursor(BUDDY_X_CENTER - 4, BUDDY_Y_OVERLAY);
    buddyPrint("!");
  }
  if (Math.floor(t / 3) & 1) {
    buddySetColor(BUDDY_YEL);
    buddySetCursor(BUDDY_X_CENTER + 4, BUDDY_Y_OVERLAY + 4);
    buddyPrint("!");
  }
}

// ─── CELEBRATE ───  ~5s cycle, 6 poses + confetti rain (zoomies)
function doCelebrate(t: number): void {
  const CROUCH = [ "            ", "   /\\_/\\    ", "  ( ^   ^ ) ", "  (  W   )  ", " /(\")_(\")\\  " ];
  const JUMP = [ "  \\^   ^/   ", "    /\\_/\\   ", "  ( ^   ^ ) ", "  (  W   )  ", "  (\")_(\")   " ];
  const PEAK = [ "  \\^   ^/   ", "    /\\_/\\   ", "  ( * * * ) ", "  (  W   )  ", "  (\")_(\")~  " ];
  const SPIN_L = [ "            ", "   /\\_/\\    ", "  ( <   < ) ", "  (  W   ) /", " ~(\")_(\")   " ];
  const SPIN_R = [ "            ", "   /\\_/\\    ", "  ( >   > ) ", " \\(  W   )  ", "  (\")_(\")~  " ];
  const POSE = [ "    \\o/     ", "   /\\_/\\    ", "  ( ^   ^ ) ", " /(  W   )\\ ", "  (\")_(\")   " ];

  const P = [CROUCH, JUMP, PEAK, SPIN_L, SPIN_R, POSE];
  const SEQ = [ 0,1,2,1,0, 3,4,3,4, 0,1,2,1,0, 5,5 ];
  const Y_SHIFT = [ 0,-3,-6,-3,0, 0,0,0,0, 0,-3,-6,-3,0, 0,0 ];
  const beat = Math.floor(t / 3) % SEQ.length;
  buddyPrintSprite(P[SEQ[beat]], 5, Y_SHIFT[beat], 0xC2A6);

  const cols = [ BUDDY_YEL, BUDDY_HEART, BUDDY_CYAN, BUDDY_WHITE, BUDDY_GREEN ];
  for (let i = 0; i < 6; i++) {
    const phase = (t * 2 + i * 11) % 22;
    const x = BUDDY_X_CENTER - 36 + i * 14;
    const y = BUDDY_Y_OVERLAY - 6 + phase;
    if (y > BUDDY_Y_BASE + 20 || y < 0) continue;
    buddySetColor(cols[i % 5]);
    buddySetCursor(x, y);
    buddyPrint(((i + Math.floor(t / 2)) & 1) ? "*" : ".");
  }
}

// ─── DIZZY ───  ~6s cycle, 5 poses + orbiting stars (chasing own tail)
function doDizzy(t: number): void {
  const TILT_L = [ "            ", "  /\\_/\\     ", " ( @   @ )  ", " (   ~~  )  ", " (\")_(\")    " ];
  const TILT_R = [ "            ", "    /\\_/\\   ", "  ( @   @ ) ", "  (  ~~  )  ", "    (\")_(\") " ];
  const WOOZY = [ "            ", "   /\\_/\\    ", "  ( x   @ ) ", "  (  v   )  ", "  (\")_(\")~  " ];
  const WOOZY2 = [ "            ", "   /\\_/\\    ", "  ( @   x ) ", "  (  v   )  ", " ~(\")_(\")   " ];
  const SPLAT = [ "            ", "   /\\_/\\    ", "  ( @   @ ) ", "  (  -   )  ", " /(\")_(\")\\~ " ];

  const P = [TILT_L, TILT_R, WOOZY, WOOZY2, SPLAT];
  const SEQ = [ 0,1,0,1, 2,3, 0,1,0,1, 4,4, 2,3 ];
  const X_SHIFT = [ -3,3,-3,3, 0,0, -3,3,-3,3, 0,0, 0,0 ];
  const beat = Math.floor(t / 4) % SEQ.length;
  buddyPrintSprite(P[SEQ[beat]], 5, 0, 0xC2A6, X_SHIFT[beat]);

  const OX = [ 0, 5, 7, 5, 0, -5, -7, -5 ];
  const OY = [ -5, -3, 0, 3, 5, 3, 0, -3 ];
  const p1 = t % 8;
  const p2 = (t + 4) % 8;
  buddySetColor(BUDDY_CYAN);
  buddySetCursor(BUDDY_X_CENTER + OX[p1] - 2, BUDDY_Y_OVERLAY + 6 + OY[p1]);
  buddyPrint("*");
  buddySetColor(BUDDY_YEL);
  buddySetCursor(BUDDY_X_CENTER + OX[p2] - 2, BUDDY_Y_OVERLAY + 6 + OY[p2]);
  buddyPrint("*");
}

// ─── HEART ───  ~10s cycle, 5 poses + rising hearts (smitten purr-monster)
function doHeart(t: number): void {
  const DREAMY = [ "            ", "   /\\_/\\    ", "  ( ^   ^ ) ", "  (  u   )  ", "  (\")_(\")~  " ];
  const BLUSH = [ "            ", "   /\\_/\\    ", "  (#^   ^#) ", "  (  u   )  ", "  (\")_(\")   " ];
  const HEART_E = [ "            ", "   /\\_/\\    ", "  ( <3 <3 ) ", "  (  u   )  ", "  (\")_(\")~  " ];
  const PURR = [ "            ", "   /\\-/\\    ", "  ( ~   ~ ) ", "  (  u   )  ", " ~(\")_(\")~  " ];
  const HEAD_T = [ "            ", "   /\\_/\\    ", "  ( ^   - ) ", "  (  u   )  ", "  (\")_(\")   " ];

  const P = [DREAMY, BLUSH, HEART_E, PURR, HEAD_T];
  const SEQ = [
    0,0,1,0, 2,2,0, 1,0,4, 0,0,3,3, 0,1,0,2, 1,0
  ];
  const Y_BOB = [ 0,-1,0,-1, 0,-1,0, -1,0,0, -1,0,0,0, -1,0,-1,0, -1,0 ];
  const beat = Math.floor(t / 5) % SEQ.length;
  buddyPrintSprite(P[SEQ[beat]], 5, Y_BOB[beat], 0xC2A6);

  buddySetColor(BUDDY_HEART);
  for (let i = 0; i < 5; i++) {
    const phase = (t + i * 4) % 16;
    const y = BUDDY_Y_OVERLAY + 16 - phase;
    if (y < -2 || y > BUDDY_Y_BASE) continue;
    const x = BUDDY_X_CENTER - 20 + i * 8 + (Math.floor(phase / 3) & 1) * 2 - 1;
    buddySetCursor(x, y);
    buddyPrint("v");
  }
}

export const CAT_SPECIES: Species = {
  name: "cat",
  bodyColor: 0xC2A6,
  states: [doSleep, doIdle, doBusy, doAttention, doCelebrate, doDizzy, doHeart],
};
