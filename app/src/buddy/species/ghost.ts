// Port of src/buddies/ghost.cpp (anthropics/claude-desktop-buddy), 1:1.
import {
  buddyPrintSprite,
  buddySetCursor,
  buddySetColor,
  buddyPrint,
  BUDDY_CYAN,
  BUDDY_DIM,
  BUDDY_GREEN,
  BUDDY_HEART,
  BUDDY_WHITE,
  BUDDY_X_CENTER,
  BUDDY_YEL,
  BUDDY_Y_BASE,
  BUDDY_Y_OVERLAY,
  type Species,
} from "../common";

// ─── SLEEP ───  ~12s cycle, drifting + fading
function doSleep(t: number): void {
  const DRIFT_A = [ "            ", "   .----.   ", "  ( -    - )", "  |        |", "  ~`~``~`~  " ];
  const DRIFT_B = [ "            ", "   .----.   ", "  ( -    - )", "  |        |", "  `~`~~`~`  " ];
  const FADE = [ "            ", "   . -- .   ", "  ( -    - )", "  .        .", "  . . . . . " ];
  const GONE = [ "            ", "            ", "   .    .   ", "            ", "  . .  . .  " ];
  const RETURN = [ "            ", "   .    .   ", "  ( -    - )", "  .        .", "  . `~`  .  " ];
  const SNORE = [ "            ", "   .----.   ", "  ( z    z )", "  |   o    |", "  ~~`~~`~~  " ];

  const P = [ DRIFT_A, DRIFT_B, FADE, GONE, RETURN, SNORE ];
  const SEQ = [
    0,1,0,1,0,1, 5,5, 0,1,0,1,
    2,2, 3,3, 4,4, 0,1,
    0,1,5,5, 2,3,4,0,1
  ];
  const Y_BOB = [
    0,-1,0,-1,0,-1, 0,-1, -1,-2,-1,-2,
    -2,-3, -3,-3, -2,-1, -1,0,
    0,-1,0,-1, -1,-2,-1,0,-1
  ];
  const beat = Math.floor(t / 5) % SEQ.length;
  buddyPrintSprite(P[SEQ[beat]], 5, Y_BOB[beat], 0xFFFF);

  // Z particles drift up-right
  const p1 = t % 12;
  const p2 = (t + 4) % 12;
  const p3 = (t + 8) % 12;
  buddySetColor(BUDDY_DIM);
  buddySetCursor(BUDDY_X_CENTER + 18 + p1, BUDDY_Y_OVERLAY + 16 - p1 * 2);
  buddyPrint("z");
  buddySetColor(BUDDY_WHITE);
  buddySetCursor(BUDDY_X_CENTER + 24 + p2, BUDDY_Y_OVERLAY + 12 - p2);
  buddyPrint("Z");
  buddySetColor(BUDDY_DIM);
  buddySetCursor(BUDDY_X_CENTER + 14 + Math.floor(p3 / 2), BUDDY_Y_OVERLAY + 8 - Math.floor(p3 / 2));
  buddyPrint("z");
}

// ─── IDLE ───  ~14s cycle, 10 micro-poses
function doIdle(t: number): void {
  const HOVER = [ "            ", "   .----.   ", "  ( o    o )", "  |   __   |", "  ~`~``~`~  " ];
  const LOOK_L = [ "            ", "   .----.   ", "  (o    o  )", "  |   __   |", "  ~`~``~`~  " ];
  const LOOK_R = [ "            ", "   .----.   ", "  (  o    o)", "  |   __   |", "  ~`~``~`~  " ];
  const LOOK_U = [ "            ", "   .----.   ", "  ( ^    ^ )", "  |   __   |", "  ~`~``~`~  " ];
  const BLINK = [ "            ", "   .----.   ", "  ( -    - )", "  |   __   |", "  ~`~``~`~  " ];
  const SMILE = [ "            ", "   .----.   ", "  ( o    o )", "  |   uu   |", "  ~`~``~`~  " ];
  const WIGGLE = [ "            ", "   .----.   ", "  ( o    o )", "  |   __   |", "  `~`~~`~`  " ];
  const WIGGLE2 = [ "            ", "   .----.   ", "  ( o    o )", "  |   __   |", "  ~~`~~`~~  " ];
  const TRANS = [ "            ", "   . -- .   ", "  . o    o .", "  .   __   .", "  . `~``~ . " ];
  const PHASE = [ "            ", "   .----.   ", "  ( O    O )", "  |   oo   |", "  ~`~``~`~  " ];

  const P = [ HOVER, LOOK_L, LOOK_R, LOOK_U, BLINK, SMILE, WIGGLE, WIGGLE2, TRANS, PHASE ];
  const SEQ = [
    0,0,6,7,0,1,0,2,
    0,4,0,6,
    5,5,0,0,
    7,6,0,3,0,4,
    8,8,0,0,
    9,9,0,6,7,0
  ];
  const Y_BOB = [
    0,-1,-1,0,-1,0,-1,0,
    -1,0,-1,-1,
    -1,0,-1,0,
    0,-1,0,-1,0,-1,
    -2,-1,-1,0,
    -1,0,-1,0,-1,0
  ];
  const beat = Math.floor(t / 5) % SEQ.length;
  buddyPrintSprite(P[SEQ[beat]], 5, Y_BOB[beat], 0xFFFF);
}

// ─── BUSY ───  ~10s cycle, 6 poses + boo ticker
function doBusy(t: number): void {
  const WORK_A = [ "            ", "   .----.   ", "  ( v    v )", "  |   --   |", " /~`~``~`~\\ " ];
  const WORK_B = [ "            ", "   .----.   ", "  ( v    v )", "  |   __   |", " \\~`~``~`~/ " ];
  const THINK = [ "      ?     ", "   .----.   ", "  ( ^    ^ )", "  |   ..   |", "  ~`~``~`~  " ];
  const CONJURE = [ "    * . *   ", "   .----.   ", "  ( O    O )", "  |   oo   |", "  ~`~``~`~  " ];
  const EUREKA = [ "      !     ", "   .----.   ", "  ( O    O )", "  |   ^^   |", " /~`~``~`~\\ " ];
  const RELIEF = [ "    ~ ~ ~   ", "   .----.   ", "  ( -    - )", "  |   __   |", "  `~`~~`~`  " ];

  const P = [ WORK_A, WORK_B, THINK, CONJURE, EUREKA, RELIEF ];
  const SEQ = [
    0,1,0,1,0,1, 2,2, 0,1,0,1, 3,3, 2,4, 0,1,0,1,5
  ];
  const beat = Math.floor(t / 5) % SEQ.length;
  buddyPrintSprite(P[SEQ[beat]], 5, 0, 0xFFFF);

  const DOTS = [ "o  ", "oO ", "oOo", " Oo", "  o", "   " ];
  buddySetColor(BUDDY_CYAN);
  buddySetCursor(BUDDY_X_CENTER + 22, BUDDY_Y_OVERLAY + 14);
  buddyPrint(DOTS[t % 6]);
}

// ─── ATTENTION ───  ~8s cycle, 6 poses + BOO! pulse
function doAttention(t: number): void {
  const SPOOK = [ "    ! !!    ", "   .----.   ", "  ( O    O )", "  |   OO   |", " /~`~``~`~\\ " ];
  const SCAN_L = [ "    ! !!    ", "   .----.   ", "  (O      O)", "  |   O    |", "  ~`~``~`~  " ];
  const SCAN_R = [ "    ! !!    ", "   .----.   ", "  ( O    O )", "  |    O   |", "  ~`~``~`~  " ];
  const SCAN_U = [ "    ! !!    ", "   .----.   ", "  ( ^    ^ )", "  |   O    |", "  ~`~``~`~  " ];
  const TENSE = [ "    ! !!    ", "  /.----.\\  ", "  ( O    O )", "  |   O    |", " /~`~``~`~\\ " ];
  const HUSH = [ "    .  .    ", "   .----.   ", "  ( o    o )", "  |   .    |", "  ~`~``~`~  " ];

  const P = [ SPOOK, SCAN_L, SCAN_R, SCAN_U, TENSE, HUSH ];
  const SEQ = [
    0,4,0,1,0,2,0,3, 4,4,0,1,2,0, 5,0
  ];
  const beat = Math.floor(t / 5) % SEQ.length;
  const pose = SEQ[beat];
  const xOff = (pose === 4) ? ((t & 1) ? 1 : -1) : 0;
  buddyPrintSprite(P[pose], 5, 0, 0xFFFF, xOff);

  if (Math.floor(t / 2) & 1) {
    buddySetColor(BUDDY_YEL);
    buddySetCursor(BUDDY_X_CENTER - 6, BUDDY_Y_OVERLAY);
    buddyPrint("!");
  }
  if (Math.floor(t / 3) & 1) {
    buddySetColor(BUDDY_YEL);
    buddySetCursor(BUDDY_X_CENTER + 6, BUDDY_Y_OVERLAY + 4);
    buddyPrint("!");
  }
}

// ─── CELEBRATE ───  ~5.6s cycle, 6 poses + confetti rain
function doCelebrate(t: number): void {
  const CROUCH = [ "            ", "   .----.   ", "  ( ^    ^ )", "  |   ww   |", " /~`~``~`~\\ " ];
  const JUMP = [ "  \\(    )/  ", "   .----.   ", "  ( ^    ^ )", "  |   ww   |", "  ~`~``~`~  " ];
  const PEAK = [ "  \\^    ^/  ", "   .----.   ", "  ( ^    ^ )", "  |   WW   |", "  ~`~``~`~  " ];
  const SPIN_L = [ "            ", "   .----.   ", "  ( <    < )", "  |   ww   |", "  ~`~``~`~/ " ];
  const SPIN_R = [ "            ", "   .----.   ", "  ( >    > )", "  |   ww   |", " \\~`~``~`~  " ];
  const POSE = [ "    \\__/    ", "   .----.   ", "  ( ^    ^ )", "  |   WW   |", "/~`~``~`~\\ " ];

  const P = [ CROUCH, JUMP, PEAK, SPIN_L, SPIN_R, POSE ];
  const SEQ = [ 0,1,2,1,0, 3,4,3,4, 0,1,2,1,0, 5,5 ];
  const Y_SHIFT = [ 0,-3,-6,-3,0, 0,0,0,0, 0,-3,-6,-3,0, 0,0 ];
  const beat = Math.floor(t / 3) % SEQ.length;
  buddyPrintSprite(P[SEQ[beat]], 5, Y_SHIFT[beat], 0xFFFF);

  const cols = [ BUDDY_YEL, BUDDY_HEART, BUDDY_CYAN, BUDDY_WHITE, BUDDY_GREEN ];
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

// ─── DIZZY ───  ~5.6s cycle, 5 poses + orbiting stars
function doDizzy(t: number): void {
  const TILT_L = [ "            ", "  .----.    ", " ( @    @ ) ", " |   ~~   | ", "  ~`~``~`~  " ];
  const TILT_R = [ "            ", "    .----.  ", "  ( @    @ )", "   |   ~~   |", "  ~`~``~`~  " ];
  const WOOZY = [ "            ", "   .----.   ", "  ( x    @ )", "  |   ~v   |", "  ~`~``~`~  " ];
  const WOOZY2 = [ "            ", "   .----.   ", "  ( @    x )", "  |   v~   |", "  ~`~``~`~  " ];
  const WOBBLE = [ "            ", "   .----.   ", "  ( @    @ )", "  |   --   |", " /~_~``_~\\  " ];

  const P = [ TILT_L, TILT_R, WOOZY, WOOZY2, WOBBLE ];
  const SEQ = [ 0,1,0,1, 2,3, 0,1,0,1, 4,4, 2,3 ];
  const X_SHIFT = [ -3,3,-3,3, 0,0, -3,3,-3,3, 0,0, 0,0 ];
  const beat = Math.floor(t / 4) % SEQ.length;
  buddyPrintSprite(P[SEQ[beat]], 5, 0, 0xFFFF, X_SHIFT[beat]);

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

// ─── HEART ───  ~10s cycle, 5 poses + rising heart stream
function doHeart(t: number): void {
  const DREAMY = [ "            ", "   .----.   ", "  ( ^    ^ )", "  |   ww   |", "  ~`~``~`~  " ];
  const BLUSH = [ "            ", "   .----.   ", "  (#^    ^#)", "  |   ww   |", "  ~`~``~`~  " ];
  const EYES_C = [ "            ", "   .----.   ", "  ( <3  <3 )", "  |   ww   |", "  ~`~``~`~  " ];
  const TWIRL = [ "            ", "   .----.   ", "  ( @    @ )", "  |   ww   |", " /~`~``~`~\\ " ];
  const SIGH = [ "            ", "   .----.   ", "  ( -    - )", "  |   ^^   |", "  `~`~~`~`  " ];

  const P = [ DREAMY, BLUSH, EYES_C, TWIRL, SIGH ];
  const SEQ = [
    0,0,1,0, 2,2,0, 1,0,4, 0,0,3,3, 0,1,0,2, 1,0
  ];
  const Y_BOB = [ -1,-2,-1,-2, -1,-2,-1, -2,-1,-1, -2,-1,-1,-1, -2,-1,-2,-1, -2,-1 ];
  const beat = Math.floor(t / 5) % SEQ.length;
  buddyPrintSprite(P[SEQ[beat]], 5, Y_BOB[beat], 0xFFFF);

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

export const GHOST_SPECIES: Species = {
  name: "ghost",
  bodyColor: 0xFFFF,
  states: [
    doSleep, doIdle, doBusy, doAttention,
    doCelebrate, doDizzy, doHeart,
  ],
};
