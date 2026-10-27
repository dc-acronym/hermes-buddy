// Port of src/buddies/blob.cpp (claude-desktop-buddy). Pose strings, SEQ arrays, frame
// math, particle positions and colors are 1:1 with the firmware. `t` is the uint32 tick count.

import {
  BUDDY_CYAN,
  BUDDY_DIM,
  BUDDY_GREEN,
  BUDDY_HEART,
  BUDDY_RED,
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
  const PUDDLE = [ "            ", "            ", "   .----.   ", "  ( -- -- ) ", "  `~------~`" ];
  const BREATH = [ "            ", "   .----.   ", "  ( -- -- ) ", "  (        )", "   `------` " ];
  const DEEP   = [ "            ", "  .------.  ", " ( -- -- ) ", " (         )", "  `~------~`" ];
  const DRIP   = [ "            ", "            ", "   .----.   ", "  ( -- -- ) ", "  `--.----` " ];
  const MELT   = [ "            ", "            ", "   .----.   ", "  ( __ __ ) ", " `~~~~~~~~~`" ];
  const SNORE  = [ "            ", "  .------.  ", " ( __ __ )  ", " (    o    )", "  `~------~`" ];

  const P = [ PUDDLE, BREATH, DEEP, DRIP, MELT, SNORE ];
  const SEQ = [
    0,1,2,1,0,1,2,1,
    0,4,4,0,
    1,2,5,2,1,
    3,3,0,0,
    1,2,1,0
  ];
  const beat = Math.floor(t / 5) % SEQ.length;
  buddyPrintSprite(P[SEQ[beat]], 5, 0, 0x07F0);

  // Z particles drift up-right + a slow drip falling
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

  // slow droplet falling under the puddle
  const dphase = Math.floor(t / 2) % 12;
  buddySetColor(0x07F0);
  buddySetCursor(BUDDY_X_CENTER - 6, BUDDY_Y_BASE + 26 + dphase);
  buddyPrint(dphase < 8 ? "." : " ");
}

// ─── IDLE ───  ~14s cycle, 10 poses
function doIdle(t: number): void {
  const SMALL    = [ "            ", "    .--.    ", "   (o  o)   ", "   (    )   ", "    `--`    " ];
  const MED      = [ "            ", "   .----.   ", "  ( o  o )  ", "  (      )  ", "   `----`   " ];
  const BIG      = [ "            ", "  .------.  ", " ( o    o ) ", " (        ) ", "  `------`  " ];
  const LOOK_L   = [ "            ", "   .----.   ", "  (o   o )  ", "  (      )  ", "   `----`   " ];
  const LOOK_R   = [ "            ", "   .----.   ", "  ( o   o)  ", "  (      )  ", "   `----`   " ];
  const BLINK    = [ "            ", "   .----.   ", "  ( -  - )  ", "  (      )  ", "   `----`   " ];
  const WIGGLE_L = [ "            ", "  .----.    ", " ( o  o )   ", " (      )   ", "  `----`    " ];
  const WIGGLE_R = [ "            ", "    .----.  ", "   ( o  o ) ", "   (      ) ", "    `----`  " ];
  const JIGGLE   = [ "            ", "  .~~~~~~.  ", " ( o    o ) ", " (        ) ", "  `~~~~~~`  " ];
  const DRIP_S   = [ "            ", "   .----.   ", "  ( o  o )  ", "  (      )  ", "  `--.--.`  " ];

  const P = [ SMALL, MED, BIG, LOOK_L, LOOK_R, BLINK, WIGGLE_L, WIGGLE_R, JIGGLE, DRIP_S ];
  const SEQ = [
    1,2,1,0,1,2, 1,3,1,4,1,5,
    2,2,8,8,2,
    6,7,6,7, 1,1,
    2,9,9,1,
    1,3,4,3,4,1,5,1,
    0,0,2,2
  ];
  const beat = Math.floor(t / 5) % SEQ.length;
  buddyPrintSprite(P[SEQ[beat]], 5, 0, 0x07F0);
}

// ─── BUSY ───  ~10s cycle, 6 poses + dot ticker
function doBusy(t: number): void {
  const FOCUS_A = [ "            ", "   .----.   ", "  ( v  v )  ", "  (   --  ) ", "   `----`   " ];
  const FOCUS_B = [ "            ", "   .----.   ", "  ( v  v )  ", "  (   __  ) ", "   `----`   " ];
  const CHURN   = [ "            ", "  .~----~.  ", " ( v    v ) ", " (   oo   )", "  `~----~`  " ];
  const THINK   = [ "      ?     ", "   .----.   ", "  ( ^  ^ )  ", "  (   ..  ) ", "   `----`   " ];
  const PROCESS = [ "      *     ", "  .------.  ", " ( O    O ) ", " (   ==   )", "  `------`  " ];
  const DRIP_W  = [ "            ", "   .----.   ", "  ( v  v )  ", "  (   --  ) ", "  `--.----` " ];

  const P = [ FOCUS_A, FOCUS_B, CHURN, THINK, PROCESS, DRIP_W ];
  const SEQ = [
    0,1,0,1,0,1, 2,2, 0,1,0,1, 3,3, 4,4, 0,1,5,5,2
  ];
  const beat = Math.floor(t / 5) % SEQ.length;
  buddyPrintSprite(P[SEQ[beat]], 5, 0, 0x07F0);

  const DOTS = [ ".  ", ".. ", "...", " ..", "  .", "   " ];
  buddySetColor(BUDDY_WHITE);
  buddySetCursor(BUDDY_X_CENTER + 22, BUDDY_Y_OVERLAY + 14);
  buddyPrint(DOTS[t % 6]);

  // tiny bubble rising inside the slime
  const b = Math.floor(t / 2) % 8;
  buddySetColor(BUDDY_CYAN);
  buddySetCursor(BUDDY_X_CENTER - 2, BUDDY_Y_OVERLAY + 18 - b);
  buddyPrint(b < 6 ? "o" : " ");
}

// ─── ATTENTION ───  ~8s cycle, 6 poses + ! pulse
function doAttention(t: number): void {
  const TALL    = [ "    .--.    ", "   (    )   ", "  ( O  O )  ", "  (   !   ) ", "  `------`  " ];
  const PEEK_L  = [ "    .--.    ", "   (    )   ", " ( O  O  )  ", " (   !    ) ", " `------`   " ];
  const PEEK_R  = [ "    .--.    ", "   (    )   ", "  ( O  O )  ", "   (   !  ) ", "   `------` " ];
  const STRETCH = [ "     ||     ", "    /  \\    ", "  ( O  O )  ", "  (   !   ) ", "  `------`  " ];
  const TENSE   = [ "    .--.    ", "  /(    )\\  ", " /( O  O )\\ ", " (   !!   ) ", " /`------`\\ " ];
  const SHRINK  = [ "            ", "    .--.    ", "   (O  O)   ", "   (  !  )  ", "    `--`    " ];

  const P = [ TALL, PEEK_L, TALL, PEEK_R, STRETCH, TENSE, SHRINK ];
  const SEQ = [
    0,4,0,1,0,2,0,3, 4,4,0,1,2,0, 5,3, 0,0,6,0
  ];
  const beat = Math.floor(t / 5) % SEQ.length;
  const pose = SEQ[beat];
  const xOff = (pose === 4) ? ((t & 1) ? 1 : -1) : 0;
  buddyPrintSprite(P[pose], 5, 0, 0x07F0, xOff);

  if (Math.floor(t / 2) & 1) {
    buddySetColor(BUDDY_YEL);
    buddySetCursor(BUDDY_X_CENTER - 8, BUDDY_Y_OVERLAY - 4);
    buddyPrint("!");
  }
  if (Math.floor(t / 3) & 1) {
    buddySetColor(BUDDY_RED);
    buddySetCursor(BUDDY_X_CENTER + 8, BUDDY_Y_OVERLAY);
    buddyPrint("!");
  }
  if (Math.floor(t / 4) & 1) {
    buddySetColor(BUDDY_YEL);
    buddySetCursor(BUDDY_X_CENTER, BUDDY_Y_OVERLAY - 8);
    buddyPrint("!");
  }
}

// ─── CELEBRATE ───  ~5.6s cycle, 6 poses + droplet/confetti rain
function doCelebrate(t: number): void {
  const SQUASH   = [ "            ", "            ", "  .--------.", " ( ^      ^)", " `~~------~`" ];
  const LAUNCH   = [ "            ", "   .----.   ", "  ( ^  ^ )  ", " /(  ww  )\\ ", "  `------`  " ];
  const AIRBORNE = [ "    .--.    ", "   ( ^^ )   ", "   (  WW)   ", "    `--`    ", "    : :     " ];
  const SPLAT_L  = [ "            ", "            ", " .---------.", "( ^      ^ )", " `~~~------`" ];
  const SPLAT_R  = [ "            ", "            ", ".---------. ", "( ^      ^ )", "`------~~~` " ];
  const POSE     = [ "    \\__/    ", "   .----.   ", "  ( *  * )  ", " /(  WW  )\\ ", "  `------`  " ];

  const P = [ SQUASH, LAUNCH, AIRBORNE, SPLAT_L, SPLAT_R, POSE ];
  const SEQ = [ 0,1,2,1,0, 3,4,3,4, 0,1,2,1,0, 5,5 ];
  const Y_SHIFT = [ 0,-2,-7,-2,0, 0,0,0,0, 0,-2,-7,-2,0, 0,0 ];
  const beat = Math.floor(t / 3) % SEQ.length;
  buddyPrintSprite(P[SEQ[beat]], 5, Y_SHIFT[beat], 0x07F0);

  const cols = [ BUDDY_YEL, BUDDY_HEART, BUDDY_CYAN, 0x07F0, BUDDY_GREEN ];
  for (let i = 0; i < 6; i++) {
    const phase = (t * 2 + i * 11) % 22;
    const x = BUDDY_X_CENTER - 36 + i * 14;
    const y = BUDDY_Y_OVERLAY - 6 + phase;
    if (y > BUDDY_Y_BASE + 20 || y < 0) continue;
    buddySetColor(cols[i % 5]);
    buddySetCursor(x, y);
    // alternating splat-droplets and stars
    const glyph = (i + Math.floor(t / 2)) & 1 ? "*" : "o";
    buddyPrint(glyph);
  }
}

// ─── DIZZY ───  ~5.6s cycle, 5 poses + orbiting stars
function doDizzy(t: number): void {
  const LEAN_L = [ "            ", "  .----.    ", " ( @  @ )   ", " (  ~~  )   ", "  `----`    " ];
  const LEAN_R = [ "            ", "    .----.  ", "   ( @  @ ) ", "   (  ~~  ) ", "    `----`  " ];
  const WOBBLE  = [ "            ", "  .~----~.  ", " ( x    @ ) ", " (   vv   )", "  `~----~`  " ];
  const WOBBLE2 = [ "            ", "  .~----~.  ", " ( @    x ) ", " (   vv   )", "  `~----~`  " ];
  const SPLAT   = [ "            ", "            ", " .---------.", "( @      @ )", " `--._.--._`" ];

  const P = [ LEAN_L, LEAN_R, WOBBLE, WOBBLE2, SPLAT ];
  const SEQ = [ 0,1,0,1, 2,3, 0,1,0,1, 4,4, 2,3 ];
  const X_SHIFT = [ -3,3,-3,3, 0,0, -3,3,-3,3, 0,0, 0,0 ];
  const beat = Math.floor(t / 4) % SEQ.length;
  buddyPrintSprite(P[SEQ[beat]], 5, 0, 0x07F0, X_SHIFT[beat]);

  const OX = [ 0, 5, 7, 5, 0, -5, -7, -5 ];
  const OY = [ -5, -3, 0, 3, 5, 3, 0, -3 ];
  const p1 = t % 8;
  const p2 = (t + 4) % 8;
  const p3 = (t + 2) % 8;
  buddySetColor(BUDDY_CYAN);
  buddySetCursor(BUDDY_X_CENTER + OX[p1] - 2, BUDDY_Y_OVERLAY + 6 + OY[p1]);
  buddyPrint("*");
  buddySetColor(BUDDY_YEL);
  buddySetCursor(BUDDY_X_CENTER + OX[p2] - 2, BUDDY_Y_OVERLAY + 6 + OY[p2]);
  buddyPrint("*");
  buddySetColor(BUDDY_WHITE);
  buddySetCursor(BUDDY_X_CENTER + OX[p3] - 2, BUDDY_Y_OVERLAY + 6 + OY[p3]);
  buddyPrint("o");
}

// ─── HEART ───  ~10s cycle, 5 poses + rising heart stream
function doHeart(t: number): void {
  const DREAMY  = [ "            ", "   .----.   ", "  ( ^  ^ )  ", "  (   ww  ) ", "   `----`   " ];
  const BLUSH   = [ "            ", "   .----.   ", "  (#^  ^#)  ", "  (   ww  ) ", "   `----`   " ];
  const HEART_E = [ "            ", "  .------.  ", " ( <3  <3 ) ", " (    v   ) ", "  `------`  " ];
  const MELT_H  = [ "            ", "  .~~~~~~.  ", " ( @    @ ) ", " (   ww   )", "  `~------`" ];
  const SIGH    = [ "            ", "   .----.   ", "  ( -  - )  ", "  (   ^^  ) ", "   `----`   " ];

  const P = [ DREAMY, BLUSH, HEART_E, MELT_H, SIGH ];
  const SEQ = [
    0,0,1,0, 2,2,0, 1,0,4, 0,0,3,3, 0,1,0,2, 1,0
  ];
  const Y_BOB = [ 0,-1,0,-1, 0,-1,0, -1,0,0, -1,0,0,0, -1,0,-1,0, -1,0 ];
  const beat = Math.floor(t / 5) % SEQ.length;
  buddyPrintSprite(P[SEQ[beat]], 5, Y_BOB[beat], 0x07F0);

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

export const BLOB_SPECIES: Species = {
  name: "blob",
  bodyColor: 0x07F0,
  states: [ doSleep, doIdle, doBusy, doAttention, doCelebrate, doDizzy, doHeart ]
};
