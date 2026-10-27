// Port of src/buddies/capybara.cpp (claude-desktop-buddy). Kept 1:1 with the firmware:
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
  const FLAT = [ "            ", "            ", "    .--.    ", "  _( -- )_  ", " (___zz___) " ];
  const BREATHE = [ "            ", "    .--.    ", "  _( -- )_  ", " (___..___) ", "  ~~~~~~~~  " ];
  const SNORE = [ "            ", "    .--.    ", "  _( __ )_  ", " (___oO___) ", "  ~~~~~~~~  " ];
  const SIDE = [ "            ", "            ", "  .---___   ", " (--   --)= ", "  `~~~~~~`  " ];
  const SIDE_Z = [ "            ", "            ", "  .---___   ", " (-- ZZZ-)= ", "  `~~~~~~`  " ];
  const YAWN = [ "            ", "    .--.    ", "  _( ^^ )_  ", " (___O____) ", "  ~~~~~~~~  " ];

  const P = [FLAT, BREATHE, SNORE, SIDE, SIDE_Z, YAWN];
  const SEQ = [
    0,1,0,1,0,1,2,1,
    0,1,0,1,
    3,4,3,4,3,4,
    3,3,
    1,5,1,1
  ];
  const beat = Math.floor(t / 5) % SEQ.length;
  buddyPrintSprite(P[SEQ[beat]], 5, 0, 0xC2A6);

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
  const REST = [ "            ", "  n______n  ", " ( o    o ) ", " (   oo   ) ", "  `------'  " ];
  const LOOK_L = [ "            ", "  n______n  ", " (o     o ) ", " (   oo   ) ", "  `------'  " ];
  const LOOK_R = [ "            ", "  n______n  ", " ( o     o) ", " (   oo   ) ", "  `------'  " ];
  const LOOK_U = [ "            ", "  n______n  ", " ( ^    ^ ) ", " (   oo   ) ", "  `------'  " ];
  const BLINK = [ "            ", "  n______n  ", " ( -    - ) ", " (   oo   ) ", "  `------'  " ];
  const EAR_TW = [ "            ", "  ^______n  ", " ( o    o ) ", " (   oo   ) ", "  `------'  " ];
  const CHEW_A = [ "            ", "  n______n  ", " ( o    o ) ", " (   ww   ) ", "  `------'  " ];
  const CHEW_B = [ "            ", "  n______n  ", " ( o    o ) ", " (   WW   ) ", "  `------'  " ];
  const YAWN = [ "            ", "  n______n  ", " ( -    - ) ", " (   OO   ) ", "  `------'  " ];
  const STRETCH = [ "            ", " /n______n\\ ", "/( o    o )\\", " (   oo   ) ", "  `------'  " ];

  const P = [REST, LOOK_L, LOOK_R, LOOK_U, BLINK, EAR_TW, CHEW_A, CHEW_B, YAWN, STRETCH];
  const SEQ = [
    0,0,0,1,0,2,0,4,
    0,5,0,0,
    6,7,6,7,
    0,0,3,3,0,4,
    8,8,0,0,
    9,9,0,0
  ];
  const beat = Math.floor(t / 5) % SEQ.length;
  buddyPrintSprite(P[SEQ[beat]], 5, 0, 0xC2A6);
}

// ─── BUSY ───  ~10s cycle, 6 poses + dot ticker
function doBusy(t: number): void {
  const TYPE_A = [ "            ", "  n______n  ", " ( v    v ) ", " (   --   ) ", " /`------'\\ " ];
  const TYPE_B = [ "            ", "  n______n  ", " ( v    v ) ", " (   __   ) ", " \\`------'/ " ];
  const THINK = [ "      ?     ", "  n______n  ", " ( ^    ^ ) ", " (   ..   ) ", "  `------'  " ];
  const SIP = [ "    [_]     ", "  n_____|n  ", " ( o    o|) ", " (   --   ) ", "  `------'  " ];
  const EUREKA = [ "      *     ", "  n______n  ", " ( O    O ) ", " (   ^^   ) ", " /`------'\\ " ];
  const RELIEF = [ "    ~~~     ", "  n______n  ", " ( -    - ) ", " (   __   ) ", "  `------'  " ];

  const P = [TYPE_A, TYPE_B, THINK, SIP, EUREKA, RELIEF];
  const SEQ = [
    0,1,0,1,0,1, 2,2, 0,1,0,1, 3,3, 2,4, 0,1,0,1,5
  ];
  const beat = Math.floor(t / 5) % SEQ.length;
  buddyPrintSprite(P[SEQ[beat]], 5, 0, 0xC2A6);

  const DOTS = [ ".  ", ".. ", "...", " ..", "  .", "   " ];
  buddySetColor(BUDDY_WHITE);
  buddySetCursor(BUDDY_X_CENTER + 22, BUDDY_Y_OVERLAY + 14);
  buddyPrint(DOTS[t % 6]);
}

// ─── ATTENTION ───  ~8s cycle, 6 poses + ! pulse
function doAttention(t: number): void {
  const ALERT = [ "    ^  ^    ", " /^_____^\\  ", "( O      O )", " (   O    ) ", "  `------'  " ];
  const SCAN_L = [ "    ^  ^    ", " /^_____^\\  ", "(O       O )", " (   O    ) ", "  `------'  " ];
  const SCAN_R = [ "    ^  ^    ", " /^_____^\\  ", "( O       O)", " (   O    ) ", "  `------'  " ];
  const SCAN_U = [ "    ^  ^    ", " /^_____^\\  ", "( ^      ^ )", " (   O    ) ", "  `------'  " ];
  const TENSE = [ "    ^  ^    ", "/^^_____^^\\ ", "( O      O )", " (   O    ) ", " /`------'\\ " ];
  const HUSH = [ "    ^  ^    ", " /^_____^\\  ", "( o      o )", " (   .    ) ", "  `------'  " ];

  const P = [ALERT, SCAN_L, SCAN_R, SCAN_U, TENSE, HUSH];
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

// ─── CELEBRATE ───  ~5.6s cycle, 6 poses + confetti rain
function doCelebrate(t: number): void {
  const CROUCH = [ "            ", "  n______n  ", " ( ^    ^ ) ", " (   ww   ) ", " /`------'\\ " ];
  const JUMP = [ "  \\(    )/  ", "   n____n   ", " ( ^    ^ ) ", " (   ww   ) ", "  `------'  " ];
  const PEAK = [ "  \\^    ^/  ", "   n____n   ", " ( ^    ^ ) ", " (   WW   ) ", "  `------'  " ];
  const SPIN_L = [ "            ", "  n______n  ", "( <    < ) /", " (   ww   ) ", "  `------'  " ];
  const SPIN_R = [ "            ", "  n______n  ", "\\( >    > )", " (   ww   ) ", "  `------'  " ];
  const POSE = [ "    \\__/    ", "  n______n  ", " ( ^    ^ ) ", "/(   WW   )\\", "  `------'  " ];

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

// ─── DIZZY ───  ~5.6s cycle, 5 poses + orbiting stars
function doDizzy(t: number): void {
  const TILT_L = [ "            ", " n______n   ", "( @    @ )  ", " (   ~~   ) ", "  `------'  " ];
  const TILT_R = [ "            ", "   n______n ", "  ( @    @ )", " (   ~~   ) ", "  `------'  " ];
  const WOOZY = [ "            ", "  n______n  ", " ( x    @ ) ", " (   ~v   ) ", "  `------'  " ];
  const WOOZY2 = [ "            ", "  n______n  ", " ( @    x ) ", " (   v~   ) ", "  `------'  " ];
  const STUMBLE = [ "            ", "  n______n  ", " ( @    @ ) ", " (   --   ) ", " /`-_---_'\\ " ];

  const P = [TILT_L, TILT_R, WOOZY, WOOZY2, STUMBLE];
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

// ─── HEART ───  ~10s cycle, 5 poses + rising heart stream
function doHeart(t: number): void {
  const DREAMY = [ "            ", "  n______n  ", " ( ^    ^ ) ", " (   ww   ) ", "  `------'  " ];
  const BLUSH = [ "            ", "  n______n  ", " (#^    ^#) ", " (   ww   ) ", "  `------'  " ];
  const EYES_C = [ "            ", "  n______n  ", " ( <3  <3 ) ", " (   ww   ) ", "  `------'  " ];
  const TWIRL = [ "            ", "  n______n  ", " ( @    @ ) ", " (   ww   ) ", " /`------'\\ " ];
  const SIGH = [ "            ", "  n______n  ", " ( -    - ) ", " (   ^^   ) ", "  `------'  " ];

  const P = [DREAMY, BLUSH, EYES_C, TWIRL, SIGH];
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

export const CAPYBARA_SPECIES: Species = {
  name: "capybara",
  bodyColor: 0xC2A6,
  states: [doSleep, doIdle, doBusy, doAttention, doCelebrate, doDizzy, doHeart],
};
