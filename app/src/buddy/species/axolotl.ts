// Port of src/buddies/axolotl.cpp (claude-desktop-buddy). Pose strings, SEQ arrays, frame
// math, particle positions and colors are 1:1 with the firmware. `t` is the uint32 tick count.

import {
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
  buddyPrint,
  buddyPrintSprite,
  buddySetColor,
  buddySetCursor,
} from "../common";
import type { Species } from "../common";

// Base silhouette: }~ ... ~{ are the feathery gills, ( .--. ) is the smile,
// (_/  \_) are the little feet. Always smiling, always bubbling.

// ─── SLEEP ───  ~12s cycle, 6 poses + bubble stream
function doSleep(t: number): void {
  const FLOAT   = [ "            ", "}~(______)~{", "}~( -  - )~{", "  ( .__. )  ", "  (_/  \\_)  " ];
  const BREATHE = [ "            ", "}~(______)~{", "}~( _  _ )~{", "  ( .__. )  ", "  (_/  \\_)  " ];
  const DEEP    = [ "            ", "~}(______){~", "~}( _  _ ){~", "  ( ____ )  ", "  ~_/  \\_~  " ];
  const CURL    = [ "            ", "            ", "}~(.____.)~{", " }~(- __ -)~{", "  (__//__)  " ];
  const SIDE    = [ "            ", "            ", "  }~~~~~_   ", " }~( -- -)= ", "  (__----)  " ];
  const SNORE   = [ "            ", "}~(______)~{", "}~( o  o )~{", "  ( oOOo )  ", "  (_/  \\_)  " ];

  const P = [ FLOAT, BREATHE, DEEP, CURL, SIDE, SNORE ];
  const SEQ = [
    0,1,0,1,0,1,2,1,
    0,1,0,1,
    3,3,4,4,3,4,
    3,3,
    1,5,1,1
  ];
  const beat = Math.floor(t / 5) % SEQ.length;
  buddyPrintSprite(P[SEQ[beat]], 5, 0, 0xFB1E);

  // Bubbles drift up
  const p1 = t        % 12;
  const p2 = (t + 5)  % 12;
  const p3 = (t + 9)  % 12;
  buddySetColor(BUDDY_CYAN);
  buddySetCursor(BUDDY_X_CENTER + 18 + (p1 % 3), BUDDY_Y_OVERLAY + 20 - p1 * 2);
  buddyPrint("o");
  buddySetColor(BUDDY_WHITE);
  buddySetCursor(BUDDY_X_CENTER + 26 - (p2 % 4), BUDDY_Y_OVERLAY + 18 - p2);
  buddyPrint("O");
  buddySetColor(BUDDY_DIM);
  buddySetCursor(BUDDY_X_CENTER + 14 + (p3 % 5), BUDDY_Y_OVERLAY + 12 - Math.floor(p3 / 2));
  buddyPrint("z");
}

// ─── IDLE ───  ~14s cycle, 10 poses + lazy bubbles
function doIdle(t: number): void {
  const REST    = [ "            ", "}~(______)~{", "}~( o  o )~{", "  ( .--. )  ", "  (_/  \\_)  " ];
  const LOOK_L  = [ "            ", "}~(______)~{", "}~(o   o )~{", "  ( .--. )  ", "  (_/  \\_)  " ];
  const LOOK_R  = [ "            ", "}~(______)~{", "}~( o   o)~{", "  ( .--. )  ", "  (_/  \\_)  " ];
  const LOOK_U  = [ "            ", "}~(______)~{", "}~( ^  ^ )~{", "  ( .--. )  ", "  (_/  \\_)  " ];
  const BLINK   = [ "            ", "}~(______)~{", "}~( -  - )~{", "  ( .--. )  ", "  (_/  \\_)  " ];
  const GILL_L  = [ "            ", "}}~(_____)~{", "}}~(o  o )~{", "  ( .--. )  ", "  (_/  \\_)  " ];
  const GILL_R  = [ "            ", "}~(_____)~{{", "}~(o  o )~{{", "  ( .--. )  ", "  (_/  \\_)  " ];
  const CHEW_A  = [ "            ", "}~(______)~{", "}~( o  o )~{", "  ( wwww )  ", "  (_/  \\_)  " ];
  const CHEW_B  = [ "            ", "}~(______)~{", "}~( o  o )~{", "  ( WWWW )  ", "  (_/  \\_)  " ];
  const WIGGLE  = [ "            ", "~}(______){~", "~}( o  o ){~", "  ( .--. )  ", "  ~_/  \\_~  " ];

  const P = [ REST, LOOK_L, LOOK_R, LOOK_U, BLINK, GILL_L, GILL_R, CHEW_A, CHEW_B, WIGGLE ];
  const SEQ = [
    0,0,0,1,0,2,0,4,
    0,5,0,6,0,
    7,8,7,8,
    0,0,3,3,0,4,
    9,9,0,0,
    1,2,1,2,0
  ];
  const beat = Math.floor(t / 5) % SEQ.length;
  buddyPrintSprite(P[SEQ[beat]], 5, 0, 0xFB1E);

  // single lazy bubble
  const p = Math.floor(t / 2) % 14;
  buddySetColor(BUDDY_CYAN);
  buddySetCursor(BUDDY_X_CENTER + 24, BUDDY_Y_OVERLAY + 16 - p);
  buddyPrint((p & 1) ? "o" : "O");
}

// ─── BUSY ───  ~10s cycle, 6 poses + dot ticker
function doBusy(t: number): void {
  const TYPE_A   = [ "            ", "}~(______)~{", "}~( v  v )~{", "  (  --  )  ", " /(_/  \\_)\\ " ];
  const TYPE_B   = [ "            ", "}~(______)~{", "}~( v  v )~{", "  (  __  )  ", " \\(_/  \\_)/ " ];
  const THINK    = [ "      ?     ", "}~(______)~{", "}~( ^  ^ )~{", "  (  ..  )  ", "  (_/  \\_)  " ];
  const SCRIBBLE = [ "      /     ", "}~(_____)~{ ", "}~( o  o )~{", "  ( .--. ) /", "  (_/  \\_)  " ];
  const EUREKA   = [ "      *     ", "}~(______)~{", "}~( O  O )~{", "  (  ^^  )  ", " /(_/  \\_)\\ " ];
  const RELIEF   = [ "    ~~~     ", "}~(______)~{", "}~( -  - )~{", "  (  __  )  ", "  (_/  \\_)  " ];

  const P = [ TYPE_A, TYPE_B, THINK, SCRIBBLE, EUREKA, RELIEF ];
  const SEQ = [
    0,1,0,1,0,1, 2,2, 0,1,0,1, 3,3, 2,4, 0,1,0,1,5
  ];
  const beat = Math.floor(t / 5) % SEQ.length;
  buddyPrintSprite(P[SEQ[beat]], 5, 0, 0xFB1E);

  const DOTS = [ ".  ", ".. ", "...", " ..", "  .", "   " ];
  buddySetColor(BUDDY_WHITE);
  buddySetCursor(BUDDY_X_CENTER + 22, BUDDY_Y_OVERLAY + 14);
  buddyPrint(DOTS[t % 6]);

  // tiny bubbles
  const b = (t * 2) % 10;
  buddySetColor(BUDDY_CYAN);
  buddySetCursor(BUDDY_X_CENTER - 28, BUDDY_Y_OVERLAY + 18 - b);
  buddyPrint("o");
}

// ─── ATTENTION ───  ~8s cycle, 6 poses + ! pulse
function doAttention(t: number): void {
  const ALERT  = [ "    ^  ^    ", "}}~(______)~{{", "}}~( O  O )~{{", "  (  O   )  ", "  (_/  \\_)  " ];
  const SCAN_L = [ "    ^  ^    ", "}}~(______)~{{", "}}~(O    O)~{{", "  (  O   )  ", "  (_/  \\_)  " ];
  const SCAN_R = [ "    ^  ^    ", "}}~(______)~{{", "}}~(O    O)~{{", "  (   O  )  ", "  (_/  \\_)  " ];
  const SCAN_U = [ "    ^  ^    ", "}}~(______)~{{", "}}~( ^  ^ )~{{", "  (  O   )  ", "  (_/  \\_)  " ];
  const TENSE  = [ "    ^  ^    ", "}}}~(____)~{{{", "}}}~( O  O)~{{{", "  (  O   )  ", " /(_/  \\_)\\ " ];
  const HUSH   = [ "    ^  ^    ", "}~(______)~{", "}~( o  o )~{", "  (  .   )  ", "  (_/  \\_)  " ];

  const P = [ ALERT, SCAN_L, SCAN_R, SCAN_U, TENSE, HUSH ];
  const SEQ = [
    0,4,0,1,0,2,0,3, 4,4,0,1,2,0, 5,0
  ];
  const beat = Math.floor(t / 5) % SEQ.length;
  const pose = SEQ[beat];
  const xOff = (pose === 4) ? ((t & 1) ? 1 : -1) : 0;
  buddyPrintSprite(P[pose], 5, 0, 0xFB1E, xOff);

  if (Math.floor(t / 2) & 1) {
    buddySetColor(BUDDY_YEL);
    buddySetCursor(BUDDY_X_CENTER - 4, BUDDY_Y_OVERLAY);
    buddyPrint("!");
  }
  if (Math.floor(t / 3) & 1) {
    buddySetColor(BUDDY_RED);
    buddySetCursor(BUDDY_X_CENTER + 4, BUDDY_Y_OVERLAY + 4);
    buddyPrint("!");
  }
}

// ─── CELEBRATE ───  ~5.6s cycle, 6 poses + confetti rain
function doCelebrate(t: number): void {
  const CROUCH = [ "            ", "}~(______)~{", "}~( ^  ^ )~{", "  (  ww  )  ", " /(_/  \\_)\\ " ];
  const JUMP   = [ "  \\(    )/  ", "}~(______)~{", "}~( ^  ^ )~{", "  (  ww  )  ", "  (_/  \\_)  " ];
  const PEAK   = [ "  \\^    ^/  ", "}~(______)~{", "}~( ^  ^ )~{", "  (  WW  )  ", "  (_/  \\_)  " ];
  const SPIN_L = [ "            ", "}~(______)~{", "}~(<    <)~{", "  (  ww  ) /", "  (_/  \\_)  " ];
  const SPIN_R = [ "            ", "}~(______)~{", "}~(>    >)~{", "\\ (  ww  )  ", "  (_/  \\_)  " ];
  const POSE   = [ "    \\__/    ", "}~(______)~{", "}~( ^  ^ )~{", "/ (  WW  ) \\", "  (_/  \\_)  " ];

  const P = [ CROUCH, JUMP, PEAK, SPIN_L, SPIN_R, POSE ];
  const SEQ = [ 0,1,2,1,0, 3,4,3,4, 0,1,2,1,0, 5,5 ];
  const Y_SHIFT = [ 0,-3,-6,-3,0, 0,0,0,0, 0,-3,-6,-3,0, 0,0 ];
  const beat = Math.floor(t / 3) % SEQ.length;
  buddyPrintSprite(P[SEQ[beat]], 5, Y_SHIFT[beat], 0xFB1E);

  const cols = [ BUDDY_YEL, BUDDY_HEART, BUDDY_CYAN, BUDDY_WHITE, BUDDY_GREEN, BUDDY_PURPLE ];
  for (let i = 0; i < 7; i++) {
    const phase = (t * 2 + i * 9) % 24;
    const x = BUDDY_X_CENTER - 36 + i * 12;
    const y = BUDDY_Y_OVERLAY - 6 + phase;
    if (y > BUDDY_Y_BASE + 20 || y < 0) continue;
    buddySetColor(cols[i % 6]);
    buddySetCursor(x, y);
    buddyPrint((i + Math.floor(t / 2)) & 1 ? "*" : "o");
  }
}

// ─── DIZZY ───  ~6s cycle, 5 poses + orbiting stars
function doDizzy(t: number): void {
  const TILT_L  = [ "            ", "}~(______)~{ ", "}~( @  @ )~{ ", "  ( ~~~~ )  ", "  (_/  \\_)  " ];
  const TILT_R  = [ "            ", " }~(______)~{", " }~( @  @ )~{", "  ( ~~~~ )  ", "  (_/  \\_)  " ];
  const WOOZY   = [ "            ", "}~(______)~{", "}~( x  @ )~{", "  ( ~vv~ )  ", "  (_/  \\_)  " ];
  const WOOZY2  = [ "            ", "}~(______)~{", "}~( @  x )~{", "  ( vv~~ )  ", "  (_/  \\_)  " ];
  const STUMBLE = [ "            ", "~}(______){~", "~}( @  @ ){~", "  (  --  )  ", " /~_/  \\_~\\ " ];

  const P = [ TILT_L, TILT_R, WOOZY, WOOZY2, STUMBLE ];
  const SEQ = [ 0,1,0,1, 2,3, 0,1,0,1, 4,4, 2,3 ];
  const X_SHIFT = [ -3,3,-3,3, 0,0, -3,3,-3,3, 0,0, 0,0 ];
  const beat = Math.floor(t / 4) % SEQ.length;
  buddyPrintSprite(P[SEQ[beat]], 5, 0, 0xFB1E, X_SHIFT[beat]);

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
  buddySetColor(BUDDY_HEART);
  buddySetCursor(BUDDY_X_CENTER + OX[p3] - 2, BUDDY_Y_OVERLAY + 6 + OY[p3]);
  buddyPrint("o");
}

// ─── HEART ───  ~10s cycle, 6 poses + rising heart stream
function doHeart(t: number): void {
  const DREAMY = [ "            ", "}~(______)~{", "}~( ^  ^ )~{", "  ( .vv. )  ", "  (_/  \\_)  " ];
  const BLUSH  = [ "            ", "}~(______)~{", "}~(#^  ^#)~{", "  ( .vv. )  ", "  (_/  \\_)  " ];
  const EYES_C = [ "            ", "}~(______)~{", "}~(<3  <3)~{", "  ( .vv. )  ", "  (_/  \\_)  " ];
  const TWIRL  = [ "            ", "~}(______){~", "~}( @  @ ){~", "  ( .vv. )  ", " /(_/  \\_)\\ " ];
  const SIGH   = [ "            ", "}~(______)~{", "}~( -  - )~{", "  ( ^^^^ )  ", "  (_/  \\_)  " ];
  const WINK   = [ "            ", "}~(______)~{", "}~( ^  - )~{", "  ( .vv. )  ", "  (_/  \\_)  " ];

  const P = [ DREAMY, BLUSH, EYES_C, TWIRL, SIGH, WINK ];
  const SEQ = [
    0,0,1,0, 2,2,0, 1,0,4, 0,0,3,3, 0,1,0,2, 5,0
  ];
  const Y_BOB = [ 0,-1,0,-1, 0,-1,0, -1,0,0, -1,0,0,0, -1,0,-1,0, -1,0 ];
  const beat = Math.floor(t / 5) % SEQ.length;
  buddyPrintSprite(P[SEQ[beat]], 5, Y_BOB[beat], 0xFB1E);

  buddySetColor(BUDDY_HEART);
  for (let i = 0; i < 5; i++) {
    const phase = (t + i * 4) % 16;
    const y = BUDDY_Y_OVERLAY + 16 - phase;
    if (y < -2 || y > BUDDY_Y_BASE) continue;
    const x = BUDDY_X_CENTER - 20 + i * 8 + (Math.floor(phase / 3) & 1) * 2 - 1;
    buddySetCursor(x, y);
    buddyPrint("v");
  }

  // a couple of pink bubbles too
  const b = (t + 3) % 14;
  buddySetColor(BUDDY_HEART);
  buddySetCursor(BUDDY_X_CENTER + 26, BUDDY_Y_OVERLAY + 16 - b);
  buddyPrint((b & 1) ? "o" : "O");
}

export const AXOLOTL_SPECIES: Species = {
  name: "axolotl",
  bodyColor: 0xFB1E,
  states: [ doSleep, doIdle, doBusy, doAttention, doCelebrate, doDizzy, doHeart ]
};
