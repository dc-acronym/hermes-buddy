// Port of src/buddies/turtle.cpp (claude-desktop-buddy). Kept 1:1 with the firmware:
// pose strings, SEQ tables, frame math, particle positions and colors are unchanged.
import type { Species } from "../common";
import {
  buddyPrint,
  buddyPrintSprite,
  buddySetColor,
  buddySetCursor,
  BUDDY_CYAN,
  BUDDY_DIM,
  BUDDY_HEART,
  BUDDY_PURPLE,
  BUDDY_WHITE,
  BUDDY_X_CENTER,
  BUDDY_YEL,
  BUDDY_Y_BASE,
  BUDDY_Y_OVERLAY,
} from "../common";

// ─── SLEEP ───  ~12s cycle, 6 poses (turtle retracts into shell)
function doSleep(t: number): void {
  const TUCKED = [ "            ", "   _,--._   ", "  /      \\  ", " /[______]\\ ", "  ``    ``  " ];
  const PEEK = [ "            ", "   _,--._   ", "  (-_    -) ", " /[______]\\ ", "  ``    ``  " ];
  const SNORE_A = [ "            ", "   _,--._   ", "  ( -    -) ", " /[__zz__]\\ ", "  ``    ``  " ];
  const SNORE_B = [ "            ", "   _,--._   ", "  ( -    -) ", " /[__ZZ__]\\ ", "  ``    ``  " ];
  const CURL = [ "            ", "            ", "   _,--._   ", "  ( ____  ) ", " /[______]\\ " ];
  const DREAM = [ "            ", "   _,--._   ", "  ( o    o) ", " /[__~~__]\\ ", "  ``    ``  " ];

  const P = [TUCKED, PEEK, SNORE_A, SNORE_B, CURL, DREAM];
  const SEQ = [
    0,0,0,0, 1,0,
    2,3,2,3, 2,3,2,3,
    0,0, 4,4,4,
    2,3,2,3,
    1,5,1,0
  ];
  const beat = Math.floor(t / 5) % SEQ.length;
  buddyPrintSprite(P[SEQ[beat]], 5, 0, 0x07E0);

  // Z particles drift up-right from shell
  const p1 = t % 12;
  const p2 = (t + 5) % 12;
  const p3 = (t + 9) % 12;
  buddySetColor(BUDDY_DIM);
  buddySetCursor(BUDDY_X_CENTER + 18 + p1, BUDDY_Y_OVERLAY + 16 - p1 * 2);
  buddyPrint("z");
  buddySetColor(BUDDY_WHITE);
  buddySetCursor(BUDDY_X_CENTER + 24 + Math.floor(p2 / 2), BUDDY_Y_OVERLAY + 12 - p2);
  buddyPrint("Z");
  buddySetColor(BUDDY_DIM);
  buddySetCursor(BUDDY_X_CENTER + 14 + Math.floor(p3 / 2), BUDDY_Y_OVERLAY + 8 - Math.floor(p3 / 2));
  buddyPrint("z");
}

// ─── IDLE ───  ~14s cycle, 10 poses (slow & steady micro-actions)
function doIdle(t: number): void {
  const REST = [ "            ", "   _,--._   ", "  ( o    o) ", " /[______]\\ ", "  ``    ``  " ];
  const LOOK_L = [ "            ", "   _,--._   ", "  (o     o) ", " /[______]\\ ", "  ``    ``  " ];
  const LOOK_R = [ "            ", "   _,--._   ", "  ( o     o)", " /[______]\\ ", "  ``    ``  " ];
  const BLINK = [ "            ", "   _,--._   ", "  ( -    -) ", " /[______]\\ ", "  ``    ``  " ];
  const PEEK_L = [ "            ", "   _,--._   ", " <( o    o) ", " /[______]\\ ", "  ``    ``  " ];
  const PEEK_R = [ "            ", "   _,--._   ", "  ( o    o)>", " /[______]\\ ", "  ``    ``  " ];
  const CHEW = [ "            ", "   _,--._   ", "  ( o    o) ", " /[______]\\ ", "  `'    `'  " ];
  const STEP_A = [ "            ", "   _,--._   ", "  ( o    o) ", " /[______]\\ ", "  ,'    ``  " ];
  const STEP_B = [ "            ", "   _,--._   ", "  ( o    o) ", " /[______]\\ ", "  ``    ',  " ];
  const STRETCH = [ "            ", "   _,--._   ", " _( o    o)_", "/-[______]-\\", "  ``    ``  " ];

  const P = [REST, LOOK_L, LOOK_R, BLINK, PEEK_L, PEEK_R, CHEW, STEP_A, STEP_B, STRETCH];
  const SEQ = [
    0,0,0,1,0,2,0,3,
    0,0,4,4,0,5,5,0,
    0,3,0,0,
    7,8,7,8,7,8,
    0,0,6,6,0,
    0,3,0,0,
    9,9,9,0,0
  ];
  const beat = Math.floor(t / 5) % SEQ.length;
  buddyPrintSprite(P[SEQ[beat]], 5, 0, 0x07E0);
}

// ─── BUSY ───  ~10s cycle, 6 poses + dot ticker (deliberate plodding)
function doBusy(t: number): void {
  const PUSH_A = [ "            ", "   _,--._   ", "  ( v    v) ", " /[______]\\ ", "  >`    >`  " ];
  const PUSH_B = [ "            ", "   _,--._   ", "  ( v    v) ", " /[______]\\ ", "  `>    `>  " ];
  const THINK = [ "      ?     ", "   _,--._   ", "  ( ^    ^) ", " /[__..__]\\ ", "  ``    ``  " ];
  const CARRY = [ "    [#]     ", "   _,-#-._  ", "  ( o    o) ", " /[______]\\ ", "  ``    ``  " ];
  const EUREKA = [ "      *     ", "   _,--._   ", "  ( O    O) ", " /[__^^__]\\ ", "  >`    >`  " ];
  const PUFF = [ "    ~~~     ", "   _,--._   ", "  ( -    -) ", " /[______]\\ ", "  ``    ``  " ];

  const P = [PUSH_A, PUSH_B, THINK, CARRY, EUREKA, PUFF];
  const SEQ = [
    0,1,0,1,0,1, 2,2, 0,1,0,1, 3,3,3, 2,4, 0,1,0,1, 5
  ];
  const beat = Math.floor(t / 5) % SEQ.length;
  buddyPrintSprite(P[SEQ[beat]], 5, 0, 0x07E0);

  const DOTS = [ ".  ", ".. ", "...", " ..", "  .", "   " ];
  buddySetColor(BUDDY_WHITE);
  buddySetCursor(BUDDY_X_CENTER + 22, BUDDY_Y_OVERLAY + 14);
  buddyPrint(DOTS[t % 6]);
}

// ─── ATTENTION ───  ~8s cycle, 6 poses + ! pulse (head fully extended, scanning)
function doAttention(t: number): void {
  const ALERT = [ "            ", "   _,--._   ", "  ( O    O) ", " /[__||__]\\ ", "  ``    ``  " ];
  const SCAN_L = [ "            ", "   _,--._   ", " <(O     O) ", " /[__||__]\\ ", "  ``    ``  " ];
  const SCAN_R = [ "            ", "   _,--._   ", "  ( O     O)>", " /[__||__]\\ ", "  ``    ``  " ];
  const SCAN_U = [ "    ^  ^    ", "   _,--._   ", "  ( ^    ^) ", " /[__||__]\\ ", "  ``    ``  " ];
  const TENSE = [ "            ", "  /^_,--._^\\", "  ( O    O) ", " /[__||__]\\ ", " /``    ``\\ " ];
  const HISS = [ "            ", "   _,--._   ", "  ( o    o) ", " /[__><__]\\ ", "  ``    ``  " ];

  const P = [ALERT, SCAN_L, SCAN_R, SCAN_U, TENSE, HISS];
  const SEQ = [
    0,4,0,1,0,2,0,3, 4,4,0,1,2,0, 5,0
  ];
  const beat = Math.floor(t / 5) % SEQ.length;
  const pose = SEQ[beat];
  const xOff = pose === 4 ? ((t & 1) ? 1 : -1) : 0;
  buddyPrintSprite(P[pose], 5, 0, 0x07E0, xOff);

  if (Math.floor(t / 2) & 1) {
    buddySetColor(BUDDY_YEL);
    buddySetCursor(BUDDY_X_CENTER - 4, BUDDY_Y_OVERLAY);
    buddyPrint("!");
  }
  if (Math.floor(t / 3) & 1) {
    buddySetColor(BUDDY_YEL);
    buddySetCursor(BUDDY_X_CENTER + 6, BUDDY_Y_OVERLAY + 4);
    buddyPrint("!");
  }
}

// ─── CELEBRATE ───  ~5.6s cycle, 6 poses + confetti rain (tiny but determined hops)
function doCelebrate(t: number): void {
  const CROUCH = [ "            ", "   _,--._   ", "  ( ^    ^) ", " /[__ww__]\\ ", " /``    ``\\ " ];
  const HOP = [ "  \\(    )/  ", "   _,--._   ", "  ( ^    ^) ", " /[__ww__]\\ ", "  ``    ``  " ];
  const PEAK = [ "  \\^    ^/  ", "   _,--._   ", "  ( ^    ^) ", " /[__WW__]\\ ", "  ``    ``  " ];
  const FLIP_L = [ "            ", "   .--._    ", "  ( ^    ^) ", "/[==_v_==]\\ ", "  ``    ``  " ];
  const FLIP_R = [ "            ", "    _,--.   ", "  ( ^    ^) ", " /[==_v_==]\\", "  ``    ``  " ];
  const POSE = [ "    \\__/    ", "   _,--._   ", "  ( ^    ^) ", "/[__WW__]\\  ", " /``    ``\\ " ];

  const P = [CROUCH, HOP, PEAK, FLIP_L, FLIP_R, POSE];
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
    buddyPrint(((i + Math.floor(t / 2)) & 1) ? "*" : ".");
  }
}

// ─── DIZZY ───  ~5.6s cycle, 5 poses + orbiting stars (shell wobble)
function doDizzy(t: number): void {
  const TILT_L = [ "            ", "  _,--._    ", " ( @    @)  ", "/[__~~__]\\  ", " ``    ``   " ];
  const TILT_R = [ "            ", "    _,--._  ", "  ( @    @) ", "  /[__~~__]\\", "   ``    `` " ];
  const WOOZY = [ "            ", "   _,--._   ", "  ( x    @) ", " /[__~v__]\\ ", "  ``    ``  " ];
  const WOOZY2 = [ "            ", "   _,--._   ", "  ( @    x) ", " /[__v~__]\\ ", "  ``    ``  " ];
  const FLIP = [ "            ", "  ``    ``  ", " \\[__~~__]/ ", "  ( @    @) ", "   `--''   " ];

  const P = [TILT_L, TILT_R, WOOZY, WOOZY2, FLIP];
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

// ─── HEART ───  ~10s cycle, 5 poses + rising heart stream (dreamy turtle blush)
function doHeart(t: number): void {
  const DREAMY = [ "            ", "   _,--._   ", "  ( ^    ^) ", " /[__ww__]\\ ", "  ``    ``  " ];
  const BLUSH = [ "            ", "   _,--._   ", "  (#^    ^#)", " /[__ww__]\\ ", "  ``    ``  " ];
  const EYES_C = [ "            ", "   _,--._   ", "  (<3    <3)", " /[__ww__]\\ ", "  ``    ``  " ];
  const SWAY = [ "            ", "   _,--._   ", "  ( @    @) ", " /[__ww__]\\ ", " /``    ``\\ " ];
  const SIGH = [ "            ", "   _,--._   ", "  ( -    -) ", " /[__^^__]\\ ", "  ``    ``  " ];

  const P = [DREAMY, BLUSH, EYES_C, SWAY, SIGH];
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

export const TURTLE_SPECIES: Species = {
  name: "turtle",
  bodyColor: 0x07E0,
  states: [doSleep, doIdle, doBusy, doAttention, doCelebrate, doDizzy, doHeart],
};
