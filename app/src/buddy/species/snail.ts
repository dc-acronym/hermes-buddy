// Port of src/buddies/snail.cpp (claude-desktop-buddy). Kept 1:1 with the firmware:
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

// ─── SLEEP ───  ~12s cycle, 6 poses — tucked in shell, snoring slime bubbles
function doSleep(t: number): void {
  const TUCK = [ "            ", "     .--.   ", "    ( zz )  ", "   `-____-` ", "  ~~~~~~~~  " ];
  const BREATHE = [ "            ", "     .--.   ", "    ( -- )  ", "   `-____-` ", "  ~~~~~~~~  " ];
  const SNORE = [ "      o     ", "     .--.   ", "    ( __ )  ", "   `-____-` ", "  ~~~~~~~~  " ];
  const DEEP = [ "      O     ", "     .--.   ", "    ( __ )  ", "   `-zzzz-` ", "  ~~~~~~~~  " ];
  const DREAM = [ "    . o O   ", "     .--.   ", "    ( UU )  ", "   `-____-` ", "  ~~~~~~~~  " ];
  const TWITCH = [ "            ", "     .--.   ", "    ( ^^ )  ", "   `-____-` ", " ~~~~~~~~~~ " ];

  const P = [TUCK, BREATHE, SNORE, DEEP, DREAM, TWITCH];
  const SEQ = [
    0,1,0,1,0,1,2,1,
    0,1,0,1,
    3,3,3,3,
    4,4,4,4,
    1,5,1,1
  ];
  const beat = Math.floor(t / 5) % SEQ.length;
  buddyPrintSprite(P[SEQ[beat]], 5, 0, 0xD8FE);

  // Z particles drift up-left (snails are slow, gentle Z's)
  const p1 = t % 12;
  const p2 = (t + 5) % 12;
  const p3 = (t + 9) % 12;
  buddySetColor(BUDDY_DIM);
  buddySetCursor(BUDDY_X_CENTER + 8 - p1, BUDDY_Y_OVERLAY + 14 - p1);
  buddyPrint("z");
  buddySetColor(BUDDY_WHITE);
  buddySetCursor(BUDDY_X_CENTER + 14 - p2, BUDDY_Y_OVERLAY + 10 - p2);
  buddyPrint("Z");
  buddySetColor(BUDDY_DIM);
  buddySetCursor(BUDDY_X_CENTER + 4 - Math.floor(p3 / 2), BUDDY_Y_OVERLAY + 6 - Math.floor(p3 / 2));
  buddyPrint("z");
}

// ─── IDLE ───  ~14s cycle, 10 poses — antennae wiggle, eye peeks, slime trail
function doIdle(t: number): void {
  const REST = [ "  \\\\  /     ", "    .--.    ", "  _( oo )_  ", " (___@@___) ", "  ~~~~~~~~  " ];
  const LOOK_L = [ "  \\\\  /     ", "    .--.    ", "  _(<<  )_  ", " (___@@___) ", "  ~~~~~~~~  " ];
  const LOOK_R = [ "  \\\\  /     ", "    .--.    ", "  _(  >>)_  ", " (___@@___) ", "  ~~~~~~~~  " ];
  const LOOK_U = [ "  \\\\  /     ", "    .--.    ", "  _( ^^ )_  ", " (___@@___) ", "  ~~~~~~~~  " ];
  const BLINK = [ "  \\\\  /     ", "    .--.    ", "  _( -- )_  ", " (___@@___) ", "  ~~~~~~~~  " ];
  const WIGGLE_L = [ "  /  //     ", "    .--.    ", "  _( oo )_  ", " (___@@___) ", "  ~~~~~~~~  " ];
  const WIGGLE_R = [ "  \\\\  \\\\    ", "    .--.    ", "  _( oo )_  ", " (___@@___) ", "  ~~~~~~~~  " ];
  const MUNCH_A = [ "  \\\\  /     ", "    .--.    ", "  _( oo )_  ", " (___ww___) ", "  ~~~~~~~~  " ];
  const MUNCH_B = [ "  \\\\  /     ", "    .--.    ", "  _( oo )_  ", " (___WW___) ", "  ~~~~~~~~  " ];
  const STRETCH = [ "   \\  /     ", "    .--.    ", "  _( oo )__ ", " (___@@____)", " ~~~~~~~~~~ " ];

  const P = [REST, LOOK_L, LOOK_R, LOOK_U, BLINK, WIGGLE_L, WIGGLE_R, MUNCH_A, MUNCH_B, STRETCH];
  const SEQ = [
    0,0,0,1,0,2,0,4,
    0,5,6,5,6,0,
    0,0,3,3,0,4,
    7,8,7,8,0,
    9,9,9,0,0
  ];
  const beat = Math.floor(t / 5) % SEQ.length;
  buddyPrintSprite(P[SEQ[beat]], 5, 0, 0xD8FE);

  // Slow slime drip below trail
  if (Math.floor(t / 6) & 1) {
    buddySetColor(BUDDY_CYAN);
    buddySetCursor(BUDDY_X_CENTER - 10, BUDDY_Y_BASE + 32);
    buddyPrint(".");
  }
}

// ─── BUSY ───  ~10s cycle, 6 poses — shell spiral spinning, focused eyes, dot ticker
function doBusy(t: number): void {
  const SPIRAL_A = [ "  \\\\  /     ", "    .o-.    ", "  _( vv )_  ", " (___--___) ", "  ~~~~~~~~  " ];
  const SPIRAL_B = [ "  \\\\  /     ", "    .-o.    ", "  _( vv )_  ", " (___--___) ", "  ~~~~~~~~  " ];
  const SPIRAL_C = [ "  \\\\  /     ", "    .--.    ", "  _( vv )o  ", " (___--___) ", "  ~~~~~~~~  " ];
  const SPIRAL_D = [ "  \\\\  /     ", "    .--.    ", "  o( vv )_  ", " (___--___) ", "  ~~~~~~~~  " ];
  const THINK = [ " ? \\\\  /    ", "    .--.    ", "  _( ^^ )_  ", " (___..___) ", "  ~~~~~~~~  " ];
  const EUREKA = [ " * \\\\  / *  ", "    .--.    ", "  _( OO )_  ", " (___^^___) ", "  ~~~~~~~~  " ];

  const P = [SPIRAL_A, SPIRAL_B, SPIRAL_C, SPIRAL_D, THINK, EUREKA];
  const SEQ = [
    0,1,2,3, 0,1,2,3, 4,4, 0,1,2,3, 4,4, 5,0,1,2,3
  ];
  const beat = Math.floor(t / 5) % SEQ.length;
  buddyPrintSprite(P[SEQ[beat]], 5, 0, 0xD8FE);

  const DOTS = [ ".  ", ".. ", "...", " ..", "  .", "   " ];
  buddySetColor(BUDDY_CYAN);
  buddySetCursor(BUDDY_X_CENTER + 24, BUDDY_Y_OVERLAY + 12);
  buddyPrint(DOTS[t % 6]);
}

// ─── ATTENTION ───  ~8s cycle, 6 poses — antennae periscope up, scanning
function doAttention(t: number): void {
  const ALERT = [ "  ||  ||    ", "    .--.    ", "  _( OO )_  ", " (___OO___) ", "  ~~~~~~~~  " ];
  const SCAN_L = [ "  \\\\  \\\\    ", "    .--.    ", "  _(OO  )_  ", " (___OO___) ", "  ~~~~~~~~  " ];
  const SCAN_R = [ "  //  //    ", "    .--.    ", "  _(  OO)_  ", " (___OO___) ", "  ~~~~~~~~  " ];
  const SCAN_U = [ "  ||  ||    ", "    .--.    ", "  _( ^^ )_  ", " (___OO___) ", "  ~~~~~~~~  " ];
  const TENSE = [ "  ||  ||    ", "   /.--.\\   ", "  _( OO )_  ", "/(___OO___)\\", " /~~~~~~~~\\ " ];
  const HUSH = [ "  \\|  |/    ", "    .--.    ", "  _( oo )_  ", " (___..___) ", "  ~~~~~~~~  " ];

  const P = [ALERT, SCAN_L, SCAN_R, SCAN_U, TENSE, HUSH];
  const SEQ = [
    0,4,0,1,0,2,0,3, 4,4,0,1,2,0, 5,0
  ];
  const beat = Math.floor(t / 5) % SEQ.length;
  const pose = SEQ[beat];
  const xOff = pose === 4 ? ((t & 1) ? 1 : -1) : 0;
  buddyPrintSprite(P[pose], 5, 0, 0xD8FE, xOff);

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

// ─── CELEBRATE ───  ~5.6s cycle, 6 poses — shell hops, antennae fling, confetti rain
function doCelebrate(t: number): void {
  const CROUCH = [ "  \\\\  /     ", "    .--.    ", "  _( ^^ )_  ", " (___ww___) ", " /~~~~~~~~\\ " ];
  const JUMP = [ "  \\^  ^/    ", "   _.--._   ", "  ( ^  ^ )  ", " (___ww___) ", "  ~~~~~~~~  " ];
  const PEAK = [ "  \\(  )/    ", "   _.--._   ", "  ( **  ) ) ", " (___WW___) ", "  ~~~~~~~~  " ];
  const SPIN_L = [ "  /\\        ", "    .--.    ", "  _( <<)_   ", " (___ww___) ", "  ~~~~~~~~  " ];
  const SPIN_R = [ "        /\\  ", "    .--.    ", "   _(>> )_  ", " (___ww___) ", "  ~~~~~~~~  " ];
  const POSE = [ "  \\\\  // *  ", "  * .--.    ", "  _( ^^ )_  ", "/(___WW___)\\", "  ~~~~~~~~  " ];

  const P = [CROUCH, JUMP, PEAK, SPIN_L, SPIN_R, POSE];
  const SEQ = [ 0,1,2,1,0, 3,4,3,4, 0,1,2,1,0, 5,5 ];
  const Y_SHIFT = [ 0,-3,-6,-3,0, 0,0,0,0, 0,-3,-6,-3,0, 0,0 ];
  const beat = Math.floor(t / 3) % SEQ.length;
  buddyPrintSprite(P[SEQ[beat]], 5, Y_SHIFT[beat], 0xD8FE);

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

// ─── DIZZY ───  ~5.6s cycle, 5 poses — shell wobble, antennae droop, orbiting stars
function doDizzy(t: number): void {
  const TILT_L = [ "  \\\\\\       ", "   .--.     ", "  ( @x )    ", " (___~v___) ", "  ~~~~~~~~  " ];
  const TILT_R = [ "       ///  ", "     .--.   ", "    ( x@ )  ", " (___v~___) ", "  ~~~~~~~~  " ];
  const WOOZY = [ "  \\~  ~/    ", "    .--.    ", "  _( @x )_  ", " (___~v___) ", "  ~~~~~~~~  " ];
  const WOOZY2 = [ "  ~\\  /~    ", "    .--.    ", "  _( x@ )_  ", " (___v~___) ", "  ~~~~~~~~  " ];
  const STUMBLE = [ "  \\v  v/    ", "    .--.    ", "  _( @@ )_  ", " (___--___) ", " /~_~~_~~\\  " ];

  const P = [TILT_L, TILT_R, WOOZY, WOOZY2, STUMBLE];
  const SEQ = [ 0,1,0,1, 2,3, 0,1,0,1, 4,4, 2,3 ];
  const X_SHIFT = [ -3,3,-3,3, 0,0, -3,3,-3,3, 0,0, 0,0 ];
  const beat = Math.floor(t / 4) % SEQ.length;
  buddyPrintSprite(P[SEQ[beat]], 5, 0, 0xD8FE, X_SHIFT[beat]);

  const OX = [ 0, 5, 7, 5, 0, -5, -7, -5 ];
  const OY = [ -5, -3, 0, 3, 5, 3, 0, -3 ];
  const p1 = t % 8;
  const p2 = (t + 4) % 8;
  buddySetColor(BUDDY_CYAN);
  buddySetCursor(BUDDY_X_CENTER + OX[p1] - 2, BUDDY_Y_OVERLAY + 4 + OY[p1]);
  buddyPrint("*");
  buddySetColor(BUDDY_YEL);
  buddySetCursor(BUDDY_X_CENTER + OX[p2] - 2, BUDDY_Y_OVERLAY + 4 + OY[p2]);
  buddyPrint("*");
}

// ─── HEART ───  ~10s cycle, 5 poses — twined antennae, heart eyes, rising hearts
function doHeart(t: number): void {
  const DREAMY = [ "  \\\\  /     ", "    .--.    ", "  _( ^^ )_  ", " (___ww___) ", "  ~~~~~~~~  " ];
  const BLUSH = [ "  \\\\  /     ", "    .--.    ", "  _(#^^#)_  ", " (___ww___) ", "  ~~~~~~~~  " ];
  const EYES_C = [ "  \\\\  /     ", "    .--.    ", "  _(<3<3)_  ", " (___ww___) ", "  ~~~~~~~~  " ];
  const TWINE = [ "  \\\\//      ", "    .--.    ", "  _( @@ )_  ", " (___ww___) ", " /~~~~~~~~\\ " ];
  const SIGH = [ "  \\\\  /     ", "    .--.    ", "  _( -- )_  ", " (___^^___) ", "  ~~~~~~~~  " ];

  const P = [DREAMY, BLUSH, EYES_C, TWINE, SIGH];
  const SEQ = [
    0,0,1,0, 2,2,0, 1,0,4, 0,0,3,3, 0,1,0,2, 1,0
  ];
  const Y_BOB = [ 0,-1,0,-1, 0,-1,0, -1,0,0, -1,0,0,0, -1,0,-1,0, -1,0 ];
  const beat = Math.floor(t / 5) % SEQ.length;
  buddyPrintSprite(P[SEQ[beat]], 5, Y_BOB[beat], 0xD8FE);

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

export const SNAIL_SPECIES: Species = {
  name: "snail",
  bodyColor: 0xD8FE,
  states: [doSleep, doIdle, doBusy, doAttention, doCelebrate, doDizzy, doHeart],
};
