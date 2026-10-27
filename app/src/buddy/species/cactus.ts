// Port of src/buddies/cactus.cpp (claude-desktop-buddy). Pose strings, SEQ arrays, frame
// math, particle positions and colors are 1:1 with the firmware. `t` is the uint32 tick count.

import {
  BUDDY_CYAN,
  BUDDY_DIM,
  BUDDY_GREEN,
  BUDDY_HEART,
  BUDDY_PURPLE,
  BUDDY_WHITE,
  BUDDY_X_CENTER,
  BUDDY_YEL,
  BUDDY_Y_BASE,
  BUDDY_Y_OVERLAY,
  buddyPrint,
  buddyPrintSprite,
  buddySetColor,
  buddySetCursor,
} from "../common";
import type { Species } from "../common";

// ─── SLEEP ───  ~12s cycle, 6 poses
function doSleep(t: number): void {
  const DROOP   = [ "            ", "    ____    ", "   |--  |   ", "   |_  _|   ", "    |  |    " ];
  const BREATHE = [ "            ", "    ____    ", " . |--  |.  ", "   |_  _|   ", "    |  |    " ];
  const SAG_L   = [ "            ", "    ____    ", " \\ |--  |   ", "  \\|_  _|   ", "    |  |    " ];
  const SAG_R   = [ "            ", "    ____    ", "   |--  | / ", "   |_  _|/  ", "    |  |    " ];
  const SNORE   = [ "            ", "    ____    ", "   |~~  |   ", "   |_  _|   ", "   ~|  |~   " ];
  const DEEP    = [ "            ", "            ", "    ____    ", "   |--  |   ", "   |_  _|   " ];

  const P = [ DROOP, BREATHE, SNORE, SAG_L, SAG_R, DEEP ];
  const SEQ = [
    0,1,0,1,0,1,2,1,
    0,1,0,1,
    3,3,4,4,3,4,
    0,0,
    1,5,1,1
  ];
  const beat = Math.floor(t / 5) % SEQ.length;
  buddyPrintSprite(P[SEQ[beat]], 5, 0, 0x07E0);

  // Z particles drift up-right
  const p1 = t % 10;
  const p2 = (t + 4) % 10;
  const p3 = (t + 7) % 10;
  buddySetColor(BUDDY_DIM);
  buddySetCursor(BUDDY_X_CENTER + 20 + p1, BUDDY_Y_OVERLAY + 18 - p1 * 2);
  buddyPrint("z");
  buddySetColor(BUDDY_WHITE);
  buddySetCursor(BUDDY_X_CENTER + 26 + p2, BUDDY_Y_OVERLAY + 14 - p2);
  buddyPrint("Z");
  buddySetColor(BUDDY_DIM);
  buddySetCursor(BUDDY_X_CENTER + 16 + Math.floor(p3 / 2), BUDDY_Y_OVERLAY + 10 - Math.floor(p3 / 2));
  buddyPrint("z");
}

// ─── IDLE ───  ~14s cycle, 10 poses
function doIdle(t: number): void {
  const REST   = [ "            ", " n  ____  n ", " | |o  o| | ", " |_|    |_| ", "   |    |   " ];
  const LOOK_L = [ "            ", " n  ____  n ", " | |o   o| ", " |_|    |_| ", "   |    |   " ];
  const LOOK_R = [ "            ", " n  ____  n ", " | | o  o| ", " |_|    |_| ", "   |    |   " ];
  const LOOK_U = [ "            ", " n  ____  n ", " | |^  ^| | ", " |_|    |_| ", "   |    |   " ];
  const BLINK  = [ "            ", " n  ____  n ", " | |-  -| | ", " |_|    |_| ", "   |    |   " ];
  const WAVE_L = [ "  \\         ", "   \\____  n ", " n |o  o| | ", " |_|    |_| ", "   |    |   " ];
  const WAVE_R = [ "         /  ", " n  ____/   ", " | |o  o| n ", " |_|    |_| ", "   |    |   " ];
  const SWAY_L = [ "            ", "n   ____  n ", "| |o  o| |  ", " |_|    |_| ", "   |    |   " ];
  const SWAY_R = [ "            ", " n  ____   n", " | |o  o| | ", " |_|    |_|", "    |    |  " ];
  const HUM    = [ "      o     ", " n  ____  n ", " | |- -| | ", " |_|  o |_| ", "   |    |   " ];

  const P = [ REST, LOOK_L, LOOK_R, LOOK_U, BLINK, WAVE_L, WAVE_R, SWAY_L, SWAY_R, HUM ];
  const SEQ = [
    0,0,0,1,0,2,0,4,
    0,3,0,0,
    5,5,0,6,6,
    0,0,7,8,7,8,0,
    9,9,0,4,
    0,0,1,2,0
  ];
  const beat = Math.floor(t / 5) % SEQ.length;
  buddyPrintSprite(P[SEQ[beat]], 5, 0, 0x07E0);
}

// ─── BUSY ───  ~10s cycle, 6 poses + sap-drip ticker
function doBusy(t: number): void {
  const FOCUS   = [ "            ", " n  ____  n ", " | |v  v| | ", " |_|  --|_| ", "   |    |   " ];
  const SQUINT  = [ "            ", " n  ____  n ", " | |- -| | ", " |_|  __|_| ", "   |    |   " ];
  const THINK   = [ "      ?     ", " n  ____  n ", " | |^  ^| | ", " |_|  ..|_| ", "   |    |   " ];
  const SCRIBE  = [ "            ", " n  ____  /=", " | |o  o|/  ", " |_|  --|_| ", "   |    |   " ];
  const EUREKA  = [ "      *     ", " n  ____  n ", " | |O  O| | ", " |_|  ^^|_| ", "   |    |   " ];
  const RECHECK = [ "      .     ", " n  ____  n ", " | |o  o| | ", " |_|  --|_| ", "   |    |   " ];

  const P = [ FOCUS, SQUINT, THINK, SCRIBE, EUREKA, RECHECK ];
  const SEQ = [
    0,1,0,1,0,1, 2,2, 0,1,0,1, 3,3, 2,4, 0,1,0,1,5
  ];
  const beat = Math.floor(t / 5) % SEQ.length;
  buddyPrintSprite(P[SEQ[beat]], 5, 0, 0x07E0);

  const DOTS = [ ".  ", ".. ", "...", " ..", "  .", "   " ];
  buddySetColor(BUDDY_GREEN);
  buddySetCursor(BUDDY_X_CENTER + 22, BUDDY_Y_OVERLAY + 14);
  buddyPrint(DOTS[t % 6]);
}

// ─── ATTENTION ───  ~8s cycle, 6 poses + ! pulse + bristling spines
function doAttention(t: number): void {
  const BRISTLE = [ " *  ____  * ", " n *|O  O|* n", " |*|    |*| ", " |_|    |_| ", "  *|    |*  " ];
  const SCAN_L  = [ " *  ____  * ", " n *|O  O|* n", " |*|O    | ", " |_|    |_| ", "  *|    |*  " ];
  const SCAN_R  = [ " *  ____  * ", " n *|O  O|* n", " |*|    O|*|", " |_|    |_| ", "  *|    |*  " ];
  const TALL    = [ " *  ^^^^  * ", " n *|O  O|* n", " |*|    |*| ", " |_|    |_| ", "  *|    |*  " ];
  const SHARP   = [ "*** **** ***", "*n*|O  O|*n*", "*|*|    |*|*", "*|_|    |_|*", " *|    |* " ];
  const HUSH    = [ " *  ____  * ", " n *|o  o|* n", " |*|    |*| ", " |_|  . |_| ", "  *|    |*  " ];

  const P = [ BRISTLE, SCAN_L, SCAN_R, TALL, SHARP, HUSH ];
  const SEQ = [
    0,4,0,1,0,2,0,3, 4,4,0,1,2,0, 5,0
  ];
  const beat = Math.floor(t / 5) % SEQ.length;
  const pose = SEQ[beat];
  const xOff = (pose === 4) ? ((t & 1) ? 1 : -1) : 0;
  buddyPrintSprite(P[pose], 5, 0, 0x07E0, xOff);

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

// ─── CELEBRATE ───  ~5.6s cycle, 6 poses + flower bloom + confetti
function doCelebrate(t: number): void {
  const CROUCH = [ "            ", " n  ____  n ", " | |^  ^| | ", " |_|  ww|_| ", "  /|    |\\  " ];
  const HOP    = [ "    .--.    ", " \\  ____  / ", "  \\|^  ^|/  ", " |_|  ww|_| ", "   |    |   " ];
  const PEAK   = [ "    (**)    ", "  \\ ____ /  ", " \\ |^  ^| / ", "  ||  ww||  ", "   |    |   " ];
  const SPIN_L = [ "            ", "<n  ____  n ", " | |<  <| | ", " |_|    |_| ", "  /|    |   " ];
  const SPIN_R = [ "            ", " n  ____  n>", " | |>  >| | ", " |_|    |_| ", "   |    |\\  " ];
  const BLOOM  = [ "    @--@    ", " n  \\__/  n ", " | |^  ^| | ", " |_|  WW|_| ", "  /|    |\\  " ];

  const P = [ CROUCH, HOP, PEAK, SPIN_L, SPIN_R, BLOOM ];
  const SEQ = [ 0,1,2,1,0, 3,4,3,4, 0,1,2,1,0, 5,5 ];
  const Y_SHIFT = [ 0,-3,-6,-3,0, 0,0,0,0, 0,-3,-6,-3,0, 0,0 ];
  const beat = Math.floor(t / 3) % SEQ.length;
  buddyPrintSprite(P[SEQ[beat]], 5, Y_SHIFT[beat], 0x07E0);

  const cols = [ BUDDY_YEL, BUDDY_HEART, BUDDY_CYAN, BUDDY_WHITE, BUDDY_PURPLE ];
  for (let i = 0; i < 6; i++) {
    const phase = (t * 2 + i * 11) % 22;
    const x = BUDDY_X_CENTER - 36 + i * 14;
    const y = BUDDY_Y_OVERLAY - 6 + phase;
    if (y > BUDDY_Y_BASE + 20 || y < 0) continue;
    buddySetColor(cols[i % 5]);
    buddySetCursor(x, y);
    buddyPrint((i + Math.floor(t / 2)) & 1 ? "*" : "o");
  }
}

// ─── DIZZY ───  ~5.6s cycle, 5 poses + orbiting stars + spine wobble
function doDizzy(t: number): void {
  const TILT_L  = [ "            ", "n  ____   n ", "| |@  @|  | ", " |_|~~  |_| ", "   |    |   " ];
  const TILT_R  = [ "            ", " n   ____  n", " |  |@  @| |", " |_|  ~~|_| ", "   |    |   " ];
  const WOOZY   = [ "            ", " n  ____  n ", " | |x  @| | ", " |_|  ~v|_| ", "   /    \\   " ];
  const WOOZY2  = [ "            ", " n  ____  n ", " | |@  x| | ", " |_|  v~|_| ", "   \\    /   " ];
  const STUMBLE = [ "            ", " n  ____  n ", " | |@  @| | ", " |_|  --|_| ", "  /-|  |-\\  " ];

  const P = [ TILT_L, TILT_R, WOOZY, WOOZY2, STUMBLE ];
  const SEQ = [ 0,1,0,1, 2,3, 0,1,0,1, 4,4, 2,3 ];
  const X_SHIFT = [ -3,3,-3,3, 0,0, -3,3,-3,3, 0,0, 0,0 ];
  const beat = Math.floor(t / 4) % SEQ.length;
  buddyPrintSprite(P[SEQ[beat]], 5, 0, 0x07E0, X_SHIFT[beat]);

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

// ─── HEART ───  ~10s cycle, 5 poses + rising heart stream + flower
function doHeart(t: number): void {
  const DREAMY = [ "    @       ", " n  ____  n ", " | |^  ^| | ", " |_|  ww|_| ", "   |    |   " ];
  const BLUSH  = [ "    @       ", " n  ____  n ", " |#|^  ^|#| ", " |_|  ww|_| ", "   |    |   " ];
  const EYES_C = [ "    @--@    ", " n  \\__/  n ", " | |<3<3| | ", " |_|  ww|_| ", "   |    |   " ];
  const TWIRL  = [ "       @    ", " n  ____  n ", " | |@  @| | ", " |_|  ww|_| ", "  /|    |\\  " ];
  const SIGH   = [ "    @       ", " n  ____  n ", " | |- -| | ", " |_|  ^^|_| ", "   |    |   " ];

  const P = [ DREAMY, BLUSH, EYES_C, TWIRL, SIGH ];
  const SEQ = [
    0,0,1,0, 2,2,0, 1,0,4, 0,0,3,3, 0,1,0,2, 1,0
  ];
  const Y_BOB = [ 0,-1,0,-1, 0,-1,0, -1,0,0, -1,0,0,0, -1,0,-1,0, -1,0 ];
  const beat = Math.floor(t / 5) % SEQ.length;
  buddyPrintSprite(P[SEQ[beat]], 5, Y_BOB[beat], 0x07E0);

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

export const CACTUS_SPECIES: Species = {
  name: "cactus",
  bodyColor: 0x07E0,
  states: [ doSleep, doIdle, doBusy, doAttention, doCelebrate, doDizzy, doHeart ]
};
