// Port of src/buddies/robot.cpp (claude-desktop-buddy). Kept 1:1 with the firmware:
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
  BUDDY_PURPLE,
  BUDDY_RED,
  BUDDY_WHITE,
  BUDDY_X_CENTER,
  BUDDY_YEL,
  BUDDY_Y_BASE,
  BUDDY_Y_OVERLAY,
} from "../common";

// ─── SLEEP ───  ~12s cycle, 6 poses, robot in low-power mode
function doSleep(t: number): void {
  const PWR_DN = [ "            ", "   .[__].   ", "  [ -    - ]", "  [ ____ ]  ", "  `------'  " ];
  const DIM_A = [ "            ", "   .[..].   ", "  [ .    . ]", "  [ ____ ]  ", "  `------'  " ];
  const DIM_B = [ "            ", "   .[  ].   ", "  [        ]", "  [ ____ ]  ", "  `------'  " ];
  const PING = [ "            ", "   .[||].   ", "  [ -    - ]", "  [ z__z ]  ", "  `------'  " ];
  const DREAM = [ "    .[*].   ", "   .[||].   ", "  [ -    - ]", "  [ zzzz ]  ", "  `------'  " ];
  const REBOOT = [ "            ", "   .[..].   ", "  [ o    - ]", "  [ ____ ]  ", "  `------'  " ];

  const P = [PWR_DN, DIM_A, DIM_B, PING, DREAM, REBOOT];
  const SEQ = [
    0,1,2,1,0,1,2,1,
    0,0,3,3,
    4,4,4,3,
    0,1,2,1,0,
    5,0,1,0
  ];
  const beat = Math.floor(t / 5) % SEQ.length;
  buddyPrintSprite(P[SEQ[beat]], 5, 0, 0xC618);

  // Z particles drift up-right (low power beeps)
  const p1 = t % 10;
  const p2 = (t + 4) % 10;
  const p3 = (t + 7) % 10;
  buddySetColor(BUDDY_DIM);
  buddySetCursor(BUDDY_X_CENTER + 20 + p1, BUDDY_Y_OVERLAY + 18 - p1 * 2);
  buddyPrint("z");
  buddySetColor(BUDDY_CYAN);
  buddySetCursor(BUDDY_X_CENTER + 26 + p2, BUDDY_Y_OVERLAY + 14 - p2);
  buddyPrint("Z");
  buddySetColor(BUDDY_DIM);
  buddySetCursor(BUDDY_X_CENTER + 16 + Math.floor(p3 / 2), BUDDY_Y_OVERLAY + 10 - Math.floor(p3 / 2));
  buddyPrint("z");
}

// ─── IDLE ───  ~14s cycle, 10 poses with stiff mechanical motion
function doIdle(t: number): void {
  const REST = [ "            ", "   .[||].   ", "  [ o    o ]", "  [ ==== ]  ", "  `------'  " ];
  const SCAN_L = [ "            ", "   .[||].   ", "  [o     o ]", "  [ ==== ]  ", "  `------'  " ];
  const SCAN_R = [ "            ", "   .[||].   ", "  [ o     o]", "  [ ==== ]  ", "  `------'  " ];
  const BLINK = [ "            ", "   .[||].   ", "  [ -    - ]", "  [ ==== ]  ", "  `------'  " ];
  const ANT_L = [ "            ", "   .[\\\\].   ", "  [ o    o ]", "  [ ==== ]  ", "  `------'  " ];
  const ANT_R = [ "            ", "   .[//].   ", "  [ o    o ]", "  [ ==== ]  ", "  `------'  " ];
  const BEEP_A = [ "            ", "   .[||].   ", "  [ o    o ]", "  [ -==- ]  ", "  `------'  " ];
  const BEEP_B = [ "            ", "   .[||].   ", "  [ o    o ]", "  [ =--= ]  ", "  `------'  " ];
  const PING = [ "    .[*].   ", "   .[||].   ", "  [ ^    ^ ]", "  [ ==== ]  ", "  `------'  " ];
  const CLICK = [ "            ", "   .[||].   ", "  [ o    o ]", "  [ ==== ]  ", " /`------'\\ " ];

  const P = [REST, SCAN_L, SCAN_R, BLINK, ANT_L, ANT_R, BEEP_A, BEEP_B, PING, CLICK];
  const SEQ = [
    0,0,1,1,0,2,2,0,
    3,0,0,
    4,5,4,5,0,
    6,7,6,7,0,
    0,8,8,0,
    9,9,0,3,0
  ];
  const beat = Math.floor(t / 5) % SEQ.length;
  buddyPrintSprite(P[SEQ[beat]], 5, 0, 0xC618);

  // Antenna LED blink
  if (Math.floor(t / 4) & 1) {
    buddySetColor(BUDDY_RED);
    buddySetCursor(BUDDY_X_CENTER - 1, BUDDY_Y_BASE - 4);
    buddyPrint(".");
  }
}

// ─── BUSY ───  ~10s cycle, 6 poses + binary stream
function doBusy(t: number): void {
  const CALC_A = [ "    01010   ", "   .[||].   ", "  [ #    # ]", "  [ ==== ]  ", " /`------'\\ " ];
  const CALC_B = [ "    10101   ", "   .[||].   ", "  [ #    # ]", "  [ -==- ]  ", " \\`------'/ " ];
  const PROC = [ "     ?      ", "   .[||].   ", "  [ ^    ^ ]", "  [ .... ]  ", "  `------'  " ];
  const WHIRR = [ "    [@@]    ", "   .[||].   ", "  [ o    o ]", "  [ ==== ]  ", "  `------'  " ];
  const DING = [ "     !      ", "   .[||].   ", "  [ O    O ]", "  [ ^^^^ ]  ", " /`------'\\ " ];
  const COOL = [ "    ~~~     ", "   .[||].   ", "  [ -    - ]", "  [ ____ ]  ", "  `------'  " ];

  const P = [CALC_A, CALC_B, PROC, WHIRR, DING, COOL];
  const SEQ = [
    0,1,0,1,0,1, 2,2, 0,1,0,1, 3,3, 2,4, 0,1,0,1, 5
  ];
  const beat = Math.floor(t / 5) % SEQ.length;
  buddyPrintSprite(P[SEQ[beat]], 5, 0, 0xC618);

  // Binary stream cycling next to body
  const BITS = [ "1  ", "10 ", "101", "010", "10 ", "1  " ];
  buddySetColor(BUDDY_GREEN);
  buddySetCursor(BUDDY_X_CENTER + 22, BUDDY_Y_OVERLAY + 14);
  buddyPrint(BITS[t % 6]);
}

// ─── ATTENTION ───  ~8s cycle, 6 poses + ! pulse
function doAttention(t: number): void {
  const ALERT = [ "    [!]     ", "   .[||].   ", "  [ O    O ]", "  [ #### ]  ", " /`------'\\ " ];
  const SCAN_L = [ "    [!]     ", "   .[\\\\].   ", "  [O     O ]", "  [ #### ]  ", " /`------'\\ " ];
  const SCAN_R = [ "    [!]     ", "   .[//].   ", "  [ O     O]", "  [ #### ]  ", " /`------'\\ " ];
  const SCAN_U = [ "    [!]     ", "   .[||].   ", "  [ ^    ^ ]", "  [ #### ]  ", " /`------'\\ " ];
  const SIREN = [ "    {!!}    ", "   .[||].   ", "  [ X    X ]", "  [ #### ]  ", "//`------'\\\\" ];
  const HUSH = [ "    [.]     ", "   .[||].   ", "  [ o    o ]", "  [ .... ]  ", "  `------'  " ];

  const P = [ALERT, SCAN_L, SCAN_R, SCAN_U, SIREN, HUSH];
  const SEQ = [
    0,4,0,1,0,2,0,3, 4,4,0,1,2,0, 5,0
  ];
  const beat = Math.floor(t / 5) % SEQ.length;
  const pose = SEQ[beat];
  const xOff = pose === 4 ? ((t & 1) ? 1 : -1) : 0;
  buddyPrintSprite(P[pose], 5, 0, 0xC618, xOff);

  // Pulsing exclamations and warning lights
  if (Math.floor(t / 2) & 1) {
    buddySetColor(BUDDY_YEL);
    buddySetCursor(BUDDY_X_CENTER - 6, BUDDY_Y_OVERLAY);
    buddyPrint("!");
  }
  if (Math.floor(t / 3) & 1) {
    buddySetColor(BUDDY_RED);
    buddySetCursor(BUDDY_X_CENTER + 6, BUDDY_Y_OVERLAY + 4);
    buddyPrint("!");
  }
  if (Math.floor(t / 2) & 1) {
    buddySetColor(BUDDY_RED);
    buddySetCursor(BUDDY_X_CENTER - 1, BUDDY_Y_BASE - 4);
    buddyPrint("*");
  }
}

// ─── CELEBRATE ───  ~5.6s cycle, 6 poses + sparks/confetti
function doCelebrate(t: number): void {
  const CROUCH = [ "            ", "   .[||].   ", "  [ ^    ^ ]", "  [ ==== ]  ", " /`------'\\ " ];
  const JUMP = [ "  \\[||]/    ", "   .----.   ", "  [ ^    ^ ]", "  [ ==== ]  ", "  `------'  " ];
  const PEAK = [ "  \\[**]/    ", "   .----.   ", "  [ O    O ]", "  [ ^^^^ ]  ", "  `------'  " ];
  const SPIN_L = [ "            ", "   .[\\\\].   ", "  [ <    < ]", "  [ ==== ] /", "  `------'  " ];
  const SPIN_R = [ "            ", "   .[//].   ", "  [ >    > ]", " \\[ ==== ]  ", "  `------'  " ];
  const POSE = [ "    [**]    ", "   .[||].   ", "  [ ^    ^ ]", " /[ #### ]\\ ", "  `------'  " ];

  const P = [CROUCH, JUMP, PEAK, SPIN_L, SPIN_R, POSE];
  const SEQ = [ 0,1,2,1,0, 3,4,3,4, 0,1,2,1,0, 5,5 ];
  const Y_SHIFT = [ 0,-3,-6,-3,0, 0,0,0,0, 0,-3,-6,-3,0, 0,0 ];
  const beat = Math.floor(t / 3) % SEQ.length;
  buddyPrintSprite(P[SEQ[beat]], 5, Y_SHIFT[beat], 0xC618);

  // Sparks and bolts shooting out
  const cols = [ BUDDY_YEL, BUDDY_CYAN, BUDDY_GREEN, BUDDY_WHITE, BUDDY_PURPLE ];
  for (let i = 0; i < 6; i++) {
    const phase = (t * 2 + i * 11) % 22;
    const x = BUDDY_X_CENTER - 36 + i * 14;
    const y = BUDDY_Y_OVERLAY - 6 + phase;
    if (y > BUDDY_Y_BASE + 20 || y < 0) continue;
    buddySetColor(cols[i % 5]);
    buddySetCursor(x, y);
    buddyPrint(((i + Math.floor(t / 2)) & 1) ? "+" : "*");
  }
}

// ─── DIZZY ───  ~5.6s cycle, 5 poses + orbiting bolts (system glitch)
function doDizzy(t: number): void {
  const TILT_L = [ "            ", "  .[||].    ", " [ x    x ] ", " [ ~~~~ ]   ", "  `------'  " ];
  const TILT_R = [ "            ", "    .[||].  ", "  [ x    x ]", "   [ ~~~~ ] ", "  `------'  " ];
  const GLITCH = [ "            ", "   .[/\\].   ", "  [ X    @ ]", "  [ #v#v ]  ", "  `--__--'  " ];
  const GLITCH2 = [ "            ", "   .[\\/].   ", "  [ @    X ]", "  [ v#v# ]  ", "  `--__--'  " ];
  const CRASH = [ "            ", "   .[??].   ", "  [ x    x ]", "  [ ____ ]  ", " /`-_--_-'\\ " ];

  const P = [TILT_L, TILT_R, GLITCH, GLITCH2, CRASH];
  const SEQ = [ 0,1,0,1, 2,3, 0,1,0,1, 4,4, 2,3 ];
  const X_SHIFT = [ -3,3,-3,3, 0,0, -3,3,-3,3, 0,0, 0,0 ];
  const beat = Math.floor(t / 4) % SEQ.length;
  buddyPrintSprite(P[SEQ[beat]], 5, 0, 0xC618, X_SHIFT[beat]);

  // Orbiting error symbols
  const OX = [ 0, 5, 7, 5, 0, -5, -7, -5 ];
  const OY = [ -5, -3, 0, 3, 5, 3, 0, -3 ];
  const p1 = t % 8;
  const p2 = (t + 4) % 8;
  buddySetColor(BUDDY_YEL);
  buddySetCursor(BUDDY_X_CENTER + OX[p1] - 2, BUDDY_Y_OVERLAY + 6 + OY[p1]);
  buddyPrint("?");
  buddySetColor(BUDDY_RED);
  buddySetCursor(BUDDY_X_CENTER + OX[p2] - 2, BUDDY_Y_OVERLAY + 6 + OY[p2]);
  buddyPrint("x");
}

// ─── HEART ───  ~10s cycle, 5 poses + rising heart stream
function doHeart(t: number): void {
  const DREAMY = [ "    [<3]    ", "   .[||].   ", "  [ ^    ^ ]", "  [ ==== ]  ", "  `------'  " ];
  const BLUSH = [ "    [<3]    ", "   .[||].   ", "  [#^    ^#]", "  [ ==== ]  ", "  `------'  " ];
  const EYES_C = [ "    [<3]    ", "   .[||].   ", "  [ <3  <3 ]", "  [ ==== ]  ", "  `------'  " ];
  const TWIRL = [ "    [<3]    ", "   .[||].   ", "  [ @    @ ]", "  [ ==== ]  ", " /`------'\\ " ];
  const SIGH = [ "    [<3]    ", "   .[||].   ", "  [ -    - ]", "  [ ^^^^ ]  ", "  `------'  " ];

  const P = [DREAMY, BLUSH, EYES_C, TWIRL, SIGH];
  const SEQ = [
    0,0,1,0, 2,2,0, 1,0,4, 0,0,3,3, 0,1,0,2, 1,0
  ];
  const Y_BOB = [ 0,-1,0,-1, 0,-1,0, -1,0,0, -1,0,0,0, -1,0,-1,0, -1,0 ];
  const beat = Math.floor(t / 5) % SEQ.length;
  buddyPrintSprite(P[SEQ[beat]], 5, Y_BOB[beat], 0xC618);

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

export const ROBOT_SPECIES: Species = {
  name: "robot",
  bodyColor: 0xC618,
  states: [doSleep, doIdle, doBusy, doAttention, doCelebrate, doDizzy, doHeart],
};
