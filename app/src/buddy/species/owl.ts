// Port of src/buddies/owl.cpp (claude-desktop-buddy). Kept 1:1 with the firmware:
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

// ─── SLEEP ───  ~12s cycle, 6 poses
function doSleep(t: number): void {
  const TUCK = [ "            ", "   .-..-.   ", "  ( -  - )  ", "  (  __  )  ", "   `----'   " ];
  const PUFF = [ "    .--.    ", "   /-..-\\   ", "  ( -  - )  ", "  (  __  )  ", "   `----'   " ];
  const DEEP = [ "    .--.    ", "   /-..-\\   ", "  ( _  _ )  ", "  (  ZZ  )  ", "   `----'   " ];
  const HEAD_L = [ "            ", "   .-..-.   ", " ( -  -  )  ", "  (  __  )  ", "   `----'   " ];
  const HEAD_R = [ "            ", "   .-..-.   ", "  (  - - -) ", "  (  __  )  ", "   `----'   " ];
  const HOOT = [ "      hoo   ", "   .-..-.   ", "  ( -  - )  ", "  (  oo  )  ", "   `----'   " ];

  const P = [TUCK, PUFF, DEEP, HEAD_L, HEAD_R, HOOT];
  const SEQ = [
    0,1,0,1,2,2,
    1,0,1,0,
    3,3,0,4,4,0,
    1,2,2,1,
    0,5,0,0
  ];
  const beat = Math.floor(t / 5) % SEQ.length;
  buddyPrintSprite(P[SEQ[beat]], 5, 0, 0x8430);

  // Z particles drift up-right (slow, sleepy)
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
  buddySetCursor(BUDDY_X_CENTER + 14 + Math.floor(p3 / 2), BUDDY_Y_OVERLAY + 12 - Math.floor(p3 / 2));
  buddyPrint("z");
}

// ─── IDLE ───  ~14s cycle, 10 poses
function doIdle(t: number): void {
  const REST = [ "            ", "   /\\  /\\   ", "  ((O)(O))  ", "  (  ><  )  ", "   `----'   " ];
  const BLINK = [ "            ", "   /\\  /\\   ", "  ((-)(-))  ", "  (  ><  )  ", "   `----'   " ];
  const LOOK_L = [ "            ", "   /\\  /\\   ", "  ((O)(O))  ", " (  ><   )  ", "   `----'   " ];
  const LOOK_R = [ "            ", "   /\\  /\\   ", "  ((O)(O))  ", "  (   >< ) ", "   `----'   " ];
  const HEAD_L = [ "            ", "  /\\  /\\    ", " ((O)(O))   ", "  (  ><  )  ", "   `----'   " ];
  const HEAD_R = [ "            ", "    /\\  /\\  ", "   ((O)(O)) ", "  (  ><  )  ", "   `----'   " ];
  const WINK = [ "            ", "   /\\  /\\   ", "  ((O)(-))  ", "  (  ><  )  ", "   `----'   " ];
  const PREEN = [ "            ", "   /\\  /\\   ", "  ((o)(o))  ", "  (  v<  )  ", "   `----'   " ];
  const PUFF = [ "            ", "  /^\\  /^\\  ", " (((O)(O))) ", " (  ><  )   ", "  `------'  " ];
  const HOOT = [ "      hoo   ", "   /\\  /\\   ", "  ((O)(O))  ", "  (  oo  )  ", "   `----'   " ];

  const P = [REST, BLINK, LOOK_L, LOOK_R, HEAD_L, HEAD_R, WINK, PREEN, PUFF, HOOT];
  const SEQ = [
    0,0,0,1,0,0,
    2,2,0,3,3,0,
    1,0,
    4,4,0,5,5,0,
    6,0,
    7,7,0,
    8,8,0,
    9,9,0,0
  ];
  const beat = Math.floor(t / 5) % SEQ.length;
  buddyPrintSprite(P[SEQ[beat]], 5, 0, 0x8430);
}

// ─── BUSY ───  ~10s cycle, 6 poses + dot ticker
function doBusy(t: number): void {
  const SCROLL = [ "    [___]   ", "   /\\  /\\   ", "  ((v)(v))  ", "  (  --  )  ", "   `----'   " ];
  const PECK_A = [ "    [___]   ", "   /\\  /\\   ", "  ((v)(v))  ", "  (  >>  )  ", "   `----'   " ];
  const PECK_B = [ "    [___]   ", "   /\\  /\\   ", "  ((v)(v))  ", "  (  <<  )  ", "   `----'   " ];
  const PONDER = [ "      ?     ", "   /\\  /\\   ", "  ((^)(^))  ", "  (  ..  )  ", "   `----'   " ];
  const EUREKA = [ "      *     ", "   /\\  /\\   ", "  ((O)(O))  ", "  (  ^^  )  ", "  /`----'\\  " ];
  const SCROLL2 = [ "   [____]   ", "  /\\   /\\   ", " ((v) (v))  ", "  (  --  )  ", "   `----'   " ];

  const P = [SCROLL, PECK_A, PECK_B, PONDER, EUREKA, SCROLL2];
  const SEQ = [
    0,1,0,2,0,1,0,2, 3,3, 0,1,0,2, 5,5,0,1, 4,4, 0,2,0,1,3
  ];
  const beat = Math.floor(t / 5) % SEQ.length;
  buddyPrintSprite(P[SEQ[beat]], 5, 0, 0x8430);

  const DOTS = [ ".  ", ".. ", "...", " ..", "  .", "   " ];
  buddySetColor(BUDDY_CYAN);
  buddySetCursor(BUDDY_X_CENTER + 22, BUDDY_Y_OVERLAY + 14);
  buddyPrint(DOTS[t % 6]);
}

// ─── ATTENTION ───  ~8s cycle, 6 poses + ! pulse
function doAttention(t: number): void {
  const ALERT = [ "            ", "  /^\\  /^\\  ", " ((O))((O)) ", " (   ><   ) ", "  `------'  " ];
  const SCAN_L = [ "            ", "  /^\\  /^\\  ", "((O))((O))  ", " (   ><   ) ", "  `------'  " ];
  const SCAN_R = [ "            ", "  /^\\  /^\\  ", "  ((O))((O))", " (   ><   ) ", "  `------'  " ];
  const HEAD_T = [ "            ", " //^\\\\//^\\\\ ", " ((O))((O)) ", " (   ><   ) ", "  `------'  " ];
  const TENSE = [ "            ", " /^^\\/^^\\   ", "((O))((O))  ", "((   ><   ))", " /`------'\\ " ];
  const GLARE = [ "            ", "  /^\\  /^\\  ", " ((-))((-)) ", " (   ><   ) ", "  `------'  " ];

  const P = [ALERT, SCAN_L, SCAN_R, HEAD_T, TENSE, GLARE];
  const SEQ = [
    0,4,0,1,0,2,0,3, 4,4,0,1,2,0, 5,0
  ];
  const beat = Math.floor(t / 5) % SEQ.length;
  const pose = SEQ[beat];
  const xOff = pose === 4 ? ((t & 1) ? 1 : -1) : 0;
  buddyPrintSprite(P[pose], 5, 0, 0x8430, xOff);

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

// ─── CELEBRATE ───  ~5.6s cycle, 6 poses + confetti rain
function doCelebrate(t: number): void {
  const CROUCH = [ "            ", "   /\\  /\\   ", "  ((^)(^))  ", "  (  ww  )  ", "  /`----'\\  " ];
  const FLAP_U = [ "  </    \\>  ", "   /\\  /\\   ", "  ((^)(^))  ", "  (  ww  )  ", "   `----'   " ];
  const FLAP_D = [ "            ", " \\_/\\  /\\_/ ", "  ((^)(^))  ", "  (  WW  )  ", "   `----'   " ];
  const SPIN_L = [ "            ", " </\\  /\\    ", "((<)(<))    ", "  (  ww  )  ", "   `----'   " ];
  const SPIN_R = [ "            ", "    /\\  /\\> ", "    ((>)(>))", "  (  ww  )  ", "   `----'   " ];
  const POSE = [ "    \\__/    ", "  </\\  /\\>  ", " ((^)(^))   ", " /(  WW  )\\ ", "   `----'   " ];

  const P = [CROUCH, FLAP_U, FLAP_D, SPIN_L, SPIN_R, POSE];
  const SEQ = [ 0,1,2,1,0, 3,4,3,4, 0,1,2,1,0, 5,5 ];
  const Y_SHIFT = [ 0,-4,-7,-4,0, 0,0,0,0, 0,-4,-7,-4,0, 0,0 ];
  const beat = Math.floor(t / 3) % SEQ.length;
  buddyPrintSprite(P[SEQ[beat]], 5, Y_SHIFT[beat], 0x8430);

  const cols = [ BUDDY_YEL, BUDDY_HEART, BUDDY_CYAN, BUDDY_WHITE, BUDDY_GREEN ];
  for (let i = 0; i < 6; i++) {
    const phase = (t * 2 + i * 11) % 22;
    const x = BUDDY_X_CENTER - 36 + i * 14;
    const y = BUDDY_Y_OVERLAY - 6 + phase;
    if (y > BUDDY_Y_BASE + 20 || y < 0) continue;
    buddySetColor(cols[i % 5]);
    buddySetCursor(x, y);
    buddyPrint(((i + Math.floor(t / 2)) & 1) ? "*" : "o");
  }
}

// ─── DIZZY ───  ~5.6s cycle, 5 poses + orbiting stars
function doDizzy(t: number): void {
  const TILT_L = [ "            ", "  /\\  /\\    ", " ((@)(@))   ", "  (  ~~  )  ", "   `----'   " ];
  const TILT_R = [ "            ", "    /\\  /\\  ", "   ((@)(@)) ", "  (  ~~  )  ", "   `----'   " ];
  const WOOZY = [ "            ", "   /\\  /\\   ", "  ((x)(@))  ", "  (  ~v  )  ", "   `----'   " ];
  const WOOZY2 = [ "            ", "   /\\  /\\   ", "  ((@)(x))  ", "  (  v~  )  ", "   `----'   " ];
  const SPIN360 = [ "            ", "   \\/  \\/   ", "  ((@)(@))  ", "  (  --  )  ", "  /`-_--'\\  " ];

  const P = [TILT_L, TILT_R, WOOZY, WOOZY2, SPIN360];
  const SEQ = [ 0,1,0,1, 2,3, 0,1,0,1, 4,4, 2,3 ];
  const X_SHIFT = [ -3,3,-3,3, 0,0, -3,3,-3,3, 0,0, 0,0 ];
  const beat = Math.floor(t / 4) % SEQ.length;
  buddyPrintSprite(P[SEQ[beat]], 5, 0, 0x8430, X_SHIFT[beat]);

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
  const DREAMY = [ "            ", "   /\\  /\\   ", "  ((^)(^))  ", "  (  ww  )  ", "   `----'   " ];
  const BLUSH = [ "            ", "   /\\  /\\   ", " #((^)(^))# ", "  (  ww  )  ", "   `----'   " ];
  const HEART_E = [ "            ", "   /\\  /\\   ", "  ((<3)(<3))", "  (  ww  )  ", "   `----'   " ];
  const TWIRL = [ "            ", "   /\\  /\\   ", "  ((@)(@))  ", "  (  ww  )  ", "  /`----'\\  " ];
  const SIGH = [ "      hoo   ", "   /\\  /\\   ", "  ((-)(-))  ", "  (  vv  )  ", "   `----'   " ];

  const P = [DREAMY, BLUSH, HEART_E, TWIRL, SIGH];
  const SEQ = [
    0,0,1,0, 2,2,0, 1,0,4, 0,0,3,3, 0,1,0,2, 1,0
  ];
  const Y_BOB = [ 0,-1,0,-1, 0,-1,0, -1,0,0, -1,0,0,0, -1,0,-1,0, -1,0 ];
  const beat = Math.floor(t / 5) % SEQ.length;
  buddyPrintSprite(P[SEQ[beat]], 5, Y_BOB[beat], 0x8430);

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

export const OWL_SPECIES: Species = {
  name: "owl",
  bodyColor: 0x8430,
  states: [doSleep, doIdle, doBusy, doAttention, doCelebrate, doDizzy, doHeart],
};
