// Port of src/buddies/duck.cpp (anthropics/claude-desktop-buddy), 1:1.
import {
  buddyPrintSprite,
  buddySetCursor,
  buddySetColor,
  buddyPrint,
  BUDDY_BLUE,
  BUDDY_CYAN,
  BUDDY_DIM,
  BUDDY_HEART,
  BUDDY_WHITE,
  BUDDY_X_CENTER,
  BUDDY_YEL,
  BUDDY_Y_BASE,
  BUDDY_Y_OVERLAY,
  type Species,
} from "../common";

// ─── SLEEP ───  ~12s cycle, head tucked, gentle bobs on water
function doSleep(t: number): void {
  const TUCK = [ "            ", "            ", "    __      ", "  <(-_)_)   ", " ~~~~~~~~~~ " ];
  const BREATHE = [ "            ", "    __      ", "  <(-_)_)   ", "  ~~~~~~~~  ", "   ~~~~~~   " ];
  const SNORE = [ "            ", "    __      ", "  <(o.)_)   ", "  ~~~~~~~~  ", "   ~~~~~~   " ];
  const DRIFT_L = [ "            ", "   __       ", " <(-_)_)    ", " ~~~~~~~~~~ ", "  ~~~~~~~~  " ];
  const DRIFT_R = [ "            ", "     __     ", "   <(-_)_)  ", " ~~~~~~~~~~ ", "  ~~~~~~~~  " ];
  const DREAM = [ "            ", "    __      ", "  <(uu)_)   ", " ~~~~~~~~~~ ", "  ~~~~~~~~  " ];

  const P = [ TUCK, BREATHE, SNORE, DRIFT_L, DRIFT_R, DREAM ];
  const SEQ = [
    0,0,1,0,1,2,1,
    0,1,0,1,
    3,3,4,4,3,4,
    0,0,
    1,5,1,1
  ];
  const beat = Math.floor(t / 5) % SEQ.length;
  buddyPrintSprite(P[SEQ[beat]], 5, 0, 0xFFE0);

  // Z particles drift up-right
  const p1 = t % 10;
  const p2 = (t + 4) % 10;
  const p3 = (t + 7) % 10;
  buddySetColor(BUDDY_DIM);
  buddySetCursor(BUDDY_X_CENTER + 18 + p1, BUDDY_Y_OVERLAY + 18 - p1 * 2);
  buddyPrint("z");
  buddySetColor(BUDDY_WHITE);
  buddySetCursor(BUDDY_X_CENTER + 24 + p2, BUDDY_Y_OVERLAY + 14 - p2);
  buddyPrint("Z");
  buddySetColor(BUDDY_DIM);
  buddySetCursor(BUDDY_X_CENTER + 14 + Math.floor(p3 / 2), BUDDY_Y_OVERLAY + 10 - Math.floor(p3 / 2));
  buddyPrint("z");
}

// ─── IDLE ───  ~14s cycle, 10 micro-actions
function doIdle(t: number): void {
  const REST = [ "            ", "    __      ", "  <(o )___  ", "   (  ._>   ", "    `--´    " ];
  const LOOK_L = [ "            ", "    __      ", " <<(o )___  ", "   (  ._>   ", "    `--´    " ];
  const LOOK_R = [ "            ", "    __      ", "  <( o)___  ", "   (  ._>   ", "    `--´    " ];
  const LOOK_U = [ "    __      ", "  <(^ )     ", "  (    )___ ", "   (  ._>   ", "    `--´    " ];
  const BLINK = [ "            ", "    __      ", "  <(- )___  ", "   (  ._>   ", "    `--´    " ];
  const QUACK = [ "            ", "    __      ", "  <O(o)___  ", "   (  ._>   ", "    `--´    " ];
  const PREEN_A = [ "            ", "    __      ", "  <(o )___  ", "   ( v.->   ", "    `--´    " ];
  const PREEN_B = [ "            ", "    __      ", "  <(o )___  ", "   ( ^.->   ", "    `--´    " ];
  const WAG_L = [ "            ", "    __      ", "  <(o )___  ", "   (  ._<   ", "    `--´    " ];
  const SHAKE = [ "            ", "    __      ", "  <(o )___  ", "  ~(  ._>~  ", "   ~`--´~   " ];

  const P = [ REST, LOOK_L, LOOK_R, LOOK_U, BLINK, QUACK, PREEN_A, PREEN_B, WAG_L, SHAKE ];
  const SEQ = [
    0,0,0,1,0,2,0,4,
    0,5,0,0,
    6,7,6,7,
    0,0,3,3,0,4,
    8,0,8,0,
    9,9,0,0
  ];
  const beat = Math.floor(t / 5) % SEQ.length;
  buddyPrintSprite(P[SEQ[beat]], 5, 0, 0xFFE0);
}

// ─── BUSY ───  ~10s cycle, focused waddle/work + bubble ticker
function doBusy(t: number): void {
  const PADDLE_A = [ "            ", "    __      ", "  <(o )___  ", "   (  ._>   ", "  ~ `--´    " ];
  const PADDLE_B = [ "            ", "    __      ", "  <(o )___  ", "   (  ._>   ", "    `--´ ~  " ];
  const DIVE_A = [ "            ", "            ", "    __      ", "  <(v )_O_  ", "   ( ._>~~~ " ];
  const DIVE_B = [ "            ", "            ", "      _o_   ", "    ^>>     ", "  ~~~~~~~~  " ];
  const SURFACE = [ "            ", "    __      ", "  <(O )___  ", "  *(  ._>*  ", "  ~~~~~~~~  " ];
  const THINK = [ "      ?     ", "    __      ", "  <(o )___  ", "   (  ._>   ", "    `--´    " ];

  const P = [ PADDLE_A, PADDLE_B, DIVE_A, DIVE_B, SURFACE, THINK ];
  const SEQ = [
    0,1,0,1,0,1, 5,5, 0,1,0,1, 2,3,3,2, 4,4, 0,1,0,1,5
  ];
  const beat = Math.floor(t / 5) % SEQ.length;
  buddyPrintSprite(P[SEQ[beat]], 5, 0, 0xFFE0);

  // Bubble stream rising
  const BUBBLES = [ "o  ", "oO ", "oOo", " Oo", "  o", "   " ];
  buddySetColor(BUDDY_CYAN);
  buddySetCursor(BUDDY_X_CENTER + 22, BUDDY_Y_OVERLAY + 14);
  buddyPrint(BUBBLES[t % 6]);
}

// ─── ATTENTION ───  ~8s cycle, head up alert + ! pulse
function doAttention(t: number): void {
  const ALERT = [ "    __      ", "  <(O )     ", "  (    )___ ", "   (  ._>   ", "    `--´    " ];
  const SCAN_L = [ "    __      ", " <<(O )     ", "  (    )___ ", "   (  ._>   ", "    `--´    " ];
  const SCAN_R = [ "    __      ", "  <( O)     ", "  (    )___ ", "   (  ._>   ", "    `--´    " ];
  const CRANE = [ "  <(O )     ", "    ||      ", "    ||      ", "   (  ._>   ", "    `--´    " ];
  const TENSE = [ "    __      ", " /<(O )\\    ", " /(    )___ ", "  /(  ._>\\  ", "   /`--´\\   " ];
  const HONK = [ "    __      ", "  <O(O )    ", "  (    )___ ", "   (  ._>   ", "    `--´    " ];

  const P = [ ALERT, SCAN_L, SCAN_R, CRANE, TENSE, HONK ];
  const SEQ = [
    0,5,0,1,0,2,0,3, 4,4,0,1,2,0, 5,0
  ];
  const beat = Math.floor(t / 5) % SEQ.length;
  const pose = SEQ[beat];
  const xOff = (pose === 4) ? ((t & 1) ? 1 : -1) : 0;
  buddyPrintSprite(P[pose], 5, 0, 0xFFE0, xOff);

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

// ─── CELEBRATE ───  ~5.6s cycle, splash jump + confetti
function doCelebrate(t: number): void {
  const CROUCH = [ "            ", "    __      ", "  <(^ )___  ", "   (  ._>   ", " /`--´\\     " ];
  const JUMP = [ "  \\(    )/  ", "    __      ", "  <(^ )___  ", "   (  ._>   ", "    `--´    " ];
  const PEAK = [ "  \\^ __ ^/  ", "   <(^ )___ ", "   (  ._>   ", "    `--´    ", "  ~~~~~~~~  " ];
  const SPLASH_L = [ "            ", "    __      ", "  <(^ )___  ", " ~~( ._> )~ ", "  ~~`--´~~  " ];
  const SPLASH_R = [ "            ", "    __      ", "  <(^ )___  ", "  ~~( ._>~~ ", "   ~`--´~   " ];
  const POSE = [ "    \\__/    ", "    __      ", "  <(^ )___  ", " /(  ._>\\   ", "    `--´    " ];

  const P = [ CROUCH, JUMP, PEAK, SPLASH_L, SPLASH_R, POSE ];
  const SEQ = [ 0,1,2,1,0, 3,4,3,4, 0,1,2,1,0, 5,5 ];
  const Y_SHIFT = [ 0,-3,-6,-3,0, 0,0,0,0, 0,-3,-6,-3,0, 0,0 ];
  const beat = Math.floor(t / 3) % SEQ.length;
  buddyPrintSprite(P[SEQ[beat]], 5, Y_SHIFT[beat], 0xFFE0);

  const cols = [ BUDDY_YEL, BUDDY_HEART, BUDDY_CYAN, BUDDY_WHITE, BUDDY_BLUE ];
  for (let i = 0; i < 6; i++) {
    const phase = (t * 2 + i * 11) % 22;
    const x = BUDDY_X_CENTER - 36 + i * 14;
    const y = BUDDY_Y_OVERLAY - 6 + phase;
    if (y > BUDDY_Y_BASE + 20 || y < 0) continue;
    buddySetColor(cols[i % 5]);
    buddySetCursor(x, y);
    buddyPrint((i + Math.floor(t / 2)) & 1 ? "*" : "~");
  }
}

// ─── DIZZY ───  ~5.6s cycle, woozy waddle + orbiting stars
function doDizzy(t: number): void {
  const TILT_L = [ "            ", "   __       ", " <(@ )___   ", "  (  .~>    ", "   `--´     " ];
  const TILT_R = [ "            ", "     __     ", "   <(@ )___ ", "    (  .~>  ", "     `--´   " ];
  const WOOZY = [ "            ", "    __      ", "  <(x@)___  ", "   ( ~~>    ", "    `--´    " ];
  const WOOZY2 = [ "            ", "    __      ", "  <(@x)___  ", "   ( ~~>    ", "    `--´    " ];
  const STUMBLE = [ "            ", "    __      ", "  <(@ )___  ", "   (  ~~>   ", " /`-_---_'\\ " ];

  const P = [ TILT_L, TILT_R, WOOZY, WOOZY2, STUMBLE ];
  const SEQ = [ 0,1,0,1, 2,3, 0,1,0,1, 4,4, 2,3 ];
  const X_SHIFT = [ -3,3,-3,3, 0,0, -3,3,-3,3, 0,0, 0,0 ];
  const beat = Math.floor(t / 4) % SEQ.length;
  buddyPrintSprite(P[SEQ[beat]], 5, 0, 0xFFE0, X_SHIFT[beat]);

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

// ─── HEART ───  ~10s cycle, dreamy float + heart stream
function doHeart(t: number): void {
  const DREAMY = [ "            ", "    __      ", "  <(^ )___  ", "   (  ._>   ", "    `--´    " ];
  const BLUSH = [ "            ", "    __      ", "  <(^#)___  ", "   (  ._>   ", "    `--´    " ];
  const EYES_C = [ "            ", "    __      ", "  <(<3)___  ", "   (  ._>   ", "    `--´    " ];
  const TWIRL = [ "            ", "    __      ", "  <(@ )___  ", "   (  ._>   ", " /`--´\\     " ];
  const SIGH = [ "            ", "    __      ", "  <(- )___  ", "   (  ^_>   ", "    `--´    " ];

  const P = [ DREAMY, BLUSH, EYES_C, TWIRL, SIGH ];
  const SEQ = [
    0,0,1,0, 2,2,0, 1,0,4, 0,0,3,3, 0,1,0,2, 1,0
  ];
  const Y_BOB = [ 0,-1,0,-1, 0,-1,0, -1,0,0, -1,0,0,0, -1,0,-1,0, -1,0 ];
  const beat = Math.floor(t / 5) % SEQ.length;
  buddyPrintSprite(P[SEQ[beat]], 5, Y_BOB[beat], 0xFFE0);

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

export const DUCK_SPECIES: Species = {
  name: "duck",
  bodyColor: 0xFFE0,
  states: [
    doSleep, doIdle, doBusy, doAttention,
    doCelebrate, doDizzy, doHeart,
  ],
};
