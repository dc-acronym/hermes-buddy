// Port of src/buddies/octopus.cpp (anthropics/claude-desktop-buddy), 1:1.
import {
  buddyPrintSprite,
  buddySetCursor,
  buddySetColor,
  buddyPrint,
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
  type Species,
} from "../common";

// ─── SLEEP ───  ~12s cycle, 6 poses
function doSleep(t: number): void {
  const CURL = [ "            ", "            ", "   .----.   ", "  ( -- -- ) ", "  (~~zz~~)  " ];
  const BREATHE = [ "            ", "   .----.   ", "  ( -- -- ) ", "  (______)  ", "  ~~~~~~~~  " ];
  const DEEP = [ "            ", "   .----.   ", "  ( __ __ ) ", "  (______)  ", "  ~~~~~~~~  " ];
  const DRIFT_L = [ "            ", "  .----.    ", " ( -- -- )  ", " (______)   ", " ~/~/~/~/   " ];
  const DRIFT_R = [ "            ", "    .----.  ", "   ( -- -- )", "   (______) ", "   /~/~/~/~ " ];
  const SNORE = [ "            ", "   .----.   ", "  ( oO oO ) ", "  (__o___)  ", "  ~~~~~~~~  " ];

  const P = [ CURL, BREATHE, DEEP, DRIFT_L, DRIFT_R, SNORE ];
  const SEQ = [
    0,0,1,1,0,0,2,2,
    1,1,0,0,
    3,3,4,4,3,4,
    1,1,2,2,
    0,5,1,1
  ];
  const beat = Math.floor(t / 5) % SEQ.length;
  buddyPrintSprite(P[SEQ[beat]], 5, 0, 0xA01F);

  // Z particles drift up
  const p1 = t % 10;
  const p2 = (t + 4) % 10;
  const p3 = (t + 7) % 10;
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

// ─── IDLE ───  ~14s cycle, 10 poses
function doIdle(t: number): void {
  const REST = [ "            ", "   .----.   ", "  ( o  o )  ", "  (______)  ", "  /\\/\\/\\/\\  " ];
  const WAVE_A = [ "            ", "   .----.   ", "  ( o  o )  ", "  (______)  ", "  \\/\\/\\/\\/  " ];
  const LOOK_L = [ "            ", "   .----.   ", "  (o   o )  ", "  (______)  ", "  /\\/\\/\\/\\  " ];
  const LOOK_R = [ "            ", "   .----.   ", "  ( o   o)  ", "  (______)  ", "  \\/\\/\\/\\/  " ];
  const BLINK = [ "            ", "   .----.   ", "  ( -  - )  ", "  (______)  ", "  /\\/\\/\\/\\  " ];
  const CURL_T = [ "            ", "   .----.   ", "  ( o  o )  ", "  (______)  ", "  /)/\\/\\(\\  " ];
  const WIGGLE = [ "            ", "   .----.   ", "  ( ^  ^ )  ", "  (______)  ", "  )(/\\/\\)(  " ];
  const FLOAT_U = [ "   .----.   ", "  ( o  o )  ", "  (______)  ", "  /\\/\\/\\/\\  ", "            " ];
  const GRIN = [ "            ", "   .----.   ", "  ( ^  ^ )  ", "  (\\__/\\)  ", "  /\\/\\/\\/\\  " ];
  const STRETCH = [ "            ", "  /.----.\\  ", " /( o  o )\\ ", " \\(______)/ ", " //\\/\\/\\/\\\\" ];

  const P = [ REST, WAVE_A, LOOK_L, LOOK_R, BLINK, CURL_T, WIGGLE, FLOAT_U, GRIN, STRETCH ];
  const SEQ = [
    0,1,0,1,0,2,1,3,
    0,1,4,0,
    5,6,5,6,
    0,1,0,4,1,0,
    7,7,0,1,
    8,8,0,1,
    9,9,0,1
  ];
  const beat = Math.floor(t / 5) % SEQ.length;
  buddyPrintSprite(P[SEQ[beat]], 5, 0, 0xA01F);
}

// ─── BUSY ───  ~10s cycle, 6 poses + bubble ticker
function doBusy(t: number): void {
  const TYPE_A = [ "            ", "   .----.   ", "  ( v  v )  ", "  (__--__)  ", "  /)\\/\\/(\\  " ];
  const TYPE_B = [ "            ", "   .----.   ", "  ( v  v )  ", "  (__==__)  ", "  (\\/\\/\\/)  " ];
  const THINK = [ "      ?     ", "   .----.   ", "  ( ^  ^ )  ", "  (__..__)  ", "  /\\/\\/\\/\\  " ];
  const SCRIBE = [ "    [_]     ", "   .---|.   ", "  ( o  o|)  ", "  (__--__)  ", "  /\\(\\/\\/\\  " ];
  const EUREKA = [ "      *     ", "   .----.   ", "  ( O  O )  ", "  (__^^__)  ", " //\\/\\/\\\\\\ " ];
  const RELIEF = [ "    ~~~     ", "   .----.   ", "  ( -  - )  ", "  (__--__)  ", "  /\\/\\/\\/\\  " ];

  const P = [ TYPE_A, TYPE_B, THINK, SCRIBE, EUREKA, RELIEF ];
  const SEQ = [
    0,1,0,1,0,1, 2,2, 0,1,0,1, 3,3, 2,4, 0,1,0,1,5
  ];
  const beat = Math.floor(t / 5) % SEQ.length;
  buddyPrintSprite(P[SEQ[beat]], 5, 0, 0xA01F);

  const DOTS = [ ".  ", ".. ", "...", " ..", "  .", "   " ];
  buddySetColor(BUDDY_CYAN);
  buddySetCursor(BUDDY_X_CENTER + 22, BUDDY_Y_OVERLAY + 14);
  buddyPrint(DOTS[t % 6]);

  // Tiny bubbles drift up
  const b = (t * 2) % 18;
  buddySetColor(BUDDY_WHITE);
  buddySetCursor(BUDDY_X_CENTER - 30, BUDDY_Y_OVERLAY + 18 - b);
  buddyPrint("o");
}

// ─── ATTENTION ───  ~8s cycle, 6 poses + ! pulse
function doAttention(t: number): void {
  const ALERT = [ "    ^  ^    ", "   .----.   ", "  ( O  O )  ", "  (__O___)  ", "  /\\/\\/\\/\\  " ];
  const SCAN_L = [ "    ^  ^    ", "   .----.   ", "  (O   O )  ", "  (__O___)  ", "  /\\/\\/\\/\\  " ];
  const SCAN_R = [ "    ^  ^    ", "   .----.   ", "  ( O   O)  ", "  (__O___)  ", "  \\/\\/\\/\\/  " ];
  const SCAN_U = [ "    ^  ^    ", "   .----.   ", "  ( ^  ^ )  ", "  (__O___)  ", "  /\\/\\/\\/\\  " ];
  const TENSE = [ "    ^  ^    ", "  /.----.\\  ", " ( O    O ) ", "  (__O___)  ", " //\\/\\/\\\\\\ " ];
  const HUSH = [ "    ^  ^    ", "   .----.   ", "  ( o  o )  ", "  (__.___)  ", "  /\\/\\/\\/\\  " ];

  const P = [ ALERT, SCAN_L, SCAN_R, SCAN_U, TENSE, HUSH ];
  const SEQ = [
    0,4,0,1,0,2,0,3, 4,4,0,1,2,0, 5,0
  ];
  const beat = Math.floor(t / 5) % SEQ.length;
  const pose = SEQ[beat];
  const xOff = (pose === 4) ? ((t & 1) ? 1 : -1) : 0;
  buddyPrintSprite(P[pose], 5, 0, 0xA01F, xOff);

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
  const CROUCH = [ "            ", "   .----.   ", "  ( ^  ^ )  ", "  (__ww__)  ", " //\\/\\/\\\\\\ " ];
  const JUMP = [ "  \\/    \\/  ", "   .----.   ", "  ( ^  ^ )  ", "  (__ww__)  ", "  )(\\/\\/)( " ];
  const PEAK = [ "  \\^    ^/  ", "   .----.   ", "  ( ^  ^ )  ", "  (__WW__)  ", "  ((    ))  " ];
  const SPIN_L = [ "            ", "   .----.   ", " (( <  < )) ", "  (__ww__)  ", " /)/\\/\\(\\  " ];
  const SPIN_R = [ "            ", "   .----.   ", " (( >  > )) ", "  (__ww__)  ", " (\\/\\/\\/)/ " ];
  const POSE = [ "    \\__/    ", "   .----.   ", " /( ^  ^ )\\ ", " \\(__WW__)/ ", " //\\/\\/\\\\\\ " ];

  const P = [ CROUCH, JUMP, PEAK, SPIN_L, SPIN_R, POSE ];
  const SEQ = [ 0,1,2,1,0, 3,4,3,4, 0,1,2,1,0, 5,5 ];
  const Y_SHIFT = [ 0,-3,-6,-3,0, 0,0,0,0, 0,-3,-6,-3,0, 0,0 ];
  const beat = Math.floor(t / 3) % SEQ.length;
  buddyPrintSprite(P[SEQ[beat]], 5, Y_SHIFT[beat], 0xA01F);

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

// ─── DIZZY ───  ~5.6s cycle, 5 poses + orbiting stars + ink cloud
function doDizzy(t: number): void {
  const TILT_L = [ "            ", "  .----.    ", " ( @  @ )   ", " (__~~__)   ", " /\\/\\/\\/\\   " ];
  const TILT_R = [ "            ", "    .----.  ", "   ( @  @ ) ", "   (__~~__) ", "   \\/\\/\\/\\/ " ];
  const WOOZY = [ "            ", "   .----.   ", "  ( x  @ )  ", "  (__~v__)  ", "  /\\)/\\(\\  " ];
  const WOOZY2 = [ "            ", "   .----.   ", "  ( @  x )  ", "  (__v~__)  ", "  (\\/\\(/\\/  " ];
  const STUMBLE = [ "            ", "   .----.   ", "  ( @  @ )  ", "  (__--__)  ", " /)\\_/\\_(\\ " ];

  const P = [ TILT_L, TILT_R, WOOZY, WOOZY2, STUMBLE ];
  const SEQ = [ 0,1,0,1, 2,3, 0,1,0,1, 4,4, 2,3 ];
  const X_SHIFT = [ -3,3,-3,3, 0,0, -3,3,-3,3, 0,0, 0,0 ];
  const beat = Math.floor(t / 4) % SEQ.length;
  buddyPrintSprite(P[SEQ[beat]], 5, 0, 0xA01F, X_SHIFT[beat]);

  // Orbiting stars
  const OX = [ 0, 5, 7, 5, 0, -5, -7, -5 ];
  const OY = [ -5, -3, 0, 3, 5, 3, 0, -3 ];
  const p1 = t % 8;
  const p2 = (t + 4) % 8;
  buddySetColor(BUDDY_CYAN);
  buddySetCursor(BUDDY_X_CENTER + OX[p1] - 2, BUDDY_Y_OVERLAY + 4 + OY[p1]);
  buddyPrint("*");
  buddySetColor(BUDDY_PURPLE);
  buddySetCursor(BUDDY_X_CENTER + OX[p2] - 2, BUDDY_Y_OVERLAY + 4 + OY[p2]);
  buddyPrint("*");

  // Ink cloud puff drifts down occasionally
  if (Math.floor(t / 8) & 1) {
    const puff = (t % 8);
    buddySetColor(BUDDY_DIM);
    buddySetCursor(BUDDY_X_CENTER - 24 - puff, BUDDY_Y_OVERLAY + 10 + puff);
    buddyPrint("o");
    buddySetCursor(BUDDY_X_CENTER + 24 + puff, BUDDY_Y_OVERLAY + 10 + puff);
    buddyPrint("o");
  }
}

// ─── HEART ───  ~10s cycle, 6 poses + rising heart stream
function doHeart(t: number): void {
  const DREAMY = [ "            ", "   .----.   ", "  ( ^  ^ )  ", "  (__ww__)  ", "  /\\/\\/\\/\\  " ];
  const BLUSH = [ "            ", "   .----.   ", "  (#^  ^#)  ", "  (__ww__)  ", "  /\\/\\/\\/\\  " ];
  const EYES_C = [ "            ", "   .----.   ", "  (<3  <3)  ", "  (__ww__)  ", "  \\/\\/\\/\\/  " ];
  const TWIRL = [ "            ", "   .----.   ", "  ( @  @ )  ", "  (__ww__)  ", " //\\/\\/\\\\\\ " ];
  const SIGH = [ "    ~~~     ", "   .----.   ", "  ( -  - )  ", "  (__^^__)  ", "  /\\/\\/\\/\\  " ];
  const HUG = [ "            ", "  /.----.\\  ", " /(#^  ^#)\\ ", " \\(__ww__)/ ", "  )(\\/\\/)(  " ];

  const P = [ DREAMY, BLUSH, EYES_C, TWIRL, SIGH, HUG ];
  const SEQ = [
    0,0,1,0, 2,2,0, 1,0,4, 0,0,3,3, 0,1,0,2, 5,5,1,0
  ];
  const Y_BOB = [ 0,-1,0,-1, 0,-1,0, -1,0,0, -1,0,0,0, -1,0,-1,0, 0,-1,0,-1 ];
  const beat = Math.floor(t / 5) % SEQ.length;
  buddyPrintSprite(P[SEQ[beat]], 5, Y_BOB[beat], 0xA01F);

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

export const OCTOPUS_SPECIES: Species = {
  name: "octopus",
  bodyColor: 0xA01F,
  states: [
    doSleep, doIdle, doBusy, doAttention,
    doCelebrate, doDizzy, doHeart,
  ],
};
