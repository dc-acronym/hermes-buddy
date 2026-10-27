// Port of src/buddies/rabbit.cpp (claude-desktop-buddy). Kept 1:1 with the firmware:
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
  const CURL = [ "            ", "    (\\_/)   ", "   ( -.- )  ", "  (zzz___)  ", "   `\"\"\"\"`   " ];
  const BREATHE = [ "            ", "    (\\_/)   ", "   ( -_- )  ", "  (___zz_)  ", "   `\"\"\"\"`   " ];
  const EARS_DN = [ "            ", "    (v_v)   ", "   ( -.- )  ", "  (___..)   ", "   `\"\"\"\"`   " ];
  const SIDE = [ "            ", "            ", "   .-^^^-.  ", "  ( -- zZ ) ", "   `~~~~`   " ];
  const TWITCH = [ "            ", "    (\\_/)   ", "   ( -.- )  ", "  (~__zz_)  ", "   `\"\"\"\"`   " ];
  const DREAM = [ "            ", "    (\\_/)   ", "   ( u.u )  ", "  (___oo_)  ", "   `\"\"\"\"`   " ];

  const P = [CURL, BREATHE, EARS_DN, SIDE, TWITCH, DREAM];
  const SEQ = [
    0,1,0,1,0,1,4,1,
    0,1,0,1,
    3,3,3,3,
    2,2,
    1,5,1,1
  ];
  const beat = Math.floor(t / 5) % SEQ.length;
  buddyPrintSprite(P[SEQ[beat]], 5, 0, 0xFFFF);

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
  const REST = [ "    (\\_/)   ", "   ( o o )  ", "  =(  v  )= ", "   (\")_(\")  ", "            " ];
  const LOOK_L = [ "    (\\_/)   ", "   (o  o )  ", "  =(  v  )= ", "   (\")_(\")  ", "            " ];
  const LOOK_R = [ "    (\\_/)   ", "   ( o  o)  ", "  =(  v  )= ", "   (\")_(\")  ", "            " ];
  const LOOK_U = [ "    (\\_/)   ", "   ( ^ ^ )  ", "  =(  v  )= ", "   (\")_(\")  ", "            " ];
  const BLINK = [ "    (\\_/)   ", "   ( - - )  ", "  =(  v  )= ", "   (\")_(\")  ", "            " ];
  const EAR_L = [ "    (/_\\)   ", "   ( o o )  ", "  =(  v  )= ", "   (\")_(\")  ", "            " ];
  const NOSE_A = [ "    (\\_/)   ", "   ( o o )  ", "  =(  ^  )= ", "   (\")_(\")  ", "            " ];
  const NOSE_B = [ "    (\\_/)   ", "   ( o o )  ", "  =(  *  )= ", "   (\")_(\")  ", "            " ];
  const CARROT = [ "    (\\_/)   ", "   ( o o )  ", "  =(  V  )= >--", "   (\")_(\")  ", "            " ];
  const STRETCH = [ "   (\\___/)  ", "  ( o   o ) ", " =(   v   )=", "   (\")_(\")  ", "            " ];

  const P = [REST, LOOK_L, LOOK_R, LOOK_U, BLINK, EAR_L, NOSE_A, NOSE_B, CARROT, STRETCH];
  const SEQ = [
    0,0,0,1,0,2,0,4,
    0,5,0,0,
    6,7,6,7,
    0,0,3,3,0,4,
    8,8,0,0,
    9,9,0,0
  ];
  const beat = Math.floor(t / 5) % SEQ.length;
  buddyPrintSprite(P[SEQ[beat]], 5, 0, 0xFFFF);
}

// ─── BUSY ───  ~10s cycle, 6 poses + dot ticker
function doBusy(t: number): void {
  const DIG_A = [ "    (\\_/)   ", "   ( v v )  ", "  =(  v  )= ", "  /(\")_(\")\\ ", "  ~~~~~~~~  " ];
  const DIG_B = [ "    (\\_/)   ", "   ( v v )  ", "  =(  v  )= ", "  \\(\")_(\")/  ", "  ~~~~~~~~  " ];
  const THINK = [ "  ? (\\_/)   ", "   ( o o )  ", "  =(  v  )= ", "   (\")_(\")  ", "            " ];
  const GNAW = [ "    (\\_/) >-", "   ( o o )==", "  =(  W  )= ", "   (\")_(\")  ", "            " ];
  const EUREKA = [ "  * (\\_/) * ", "   ( O O )  ", "  =(  ^  )= ", "  /(\")_(\")\\ ", "            " ];
  const WIPE = [ "    (\\_/)   ", "   ( - - )  ", "  =(  _  )= ", "   (\")_(\")  ", "    ~~~~    " ];

  const P = [DIG_A, DIG_B, THINK, GNAW, EUREKA, WIPE];
  const SEQ = [
    0,1,0,1,0,1, 2,2, 0,1,0,1, 3,3, 2,4, 0,1,0,1,5
  ];
  const beat = Math.floor(t / 5) % SEQ.length;
  buddyPrintSprite(P[SEQ[beat]], 5, 0, 0xFFFF);

  const DOTS = [ ".  ", ".. ", "...", " ..", "  .", "   " ];
  buddySetColor(BUDDY_WHITE);
  buddySetCursor(BUDDY_X_CENTER + 22, BUDDY_Y_OVERLAY + 14);
  buddyPrint(DOTS[t % 6]);
}

// ─── ATTENTION ───  ~8s cycle, 6 poses + ! pulse
function doAttention(t: number): void {
  const ALERT = [ "   /|  |\\   ", "  /(\\_/)\\   ", "  ( O  O )  ", "  =(  v  )= ", "   (\")_(\")  " ];
  const SCAN_L = [ "   /|  |\\   ", "  /(\\_/)\\   ", "  (O   O )  ", "  =(  v  )= ", "   (\")_(\")  " ];
  const SCAN_R = [ "   /|  |\\   ", "  /(\\_/)\\   ", "  ( O   O)  ", "  =(  v  )= ", "   (\")_(\")  " ];
  const SCAN_U = [ "   /|  |\\   ", "  /(\\_/)\\   ", "  ( ^  ^ )  ", "  =(  v  )= ", "   (\")_(\")  " ];
  const TENSE = [ "  /|/  \\|\\  ", "  /(\\_/)\\   ", "  ( O  O )  ", "  =(  v  )= ", "  /(\")_(\")\\ " ];
  const HUSH = [ "   /|  |\\   ", "   (\\_/)    ", "  ( o  o )  ", "  =(  .  )= ", "   (\")_(\")  " ];

  const P = [ALERT, SCAN_L, SCAN_R, SCAN_U, TENSE, HUSH];
  const SEQ = [
    0,4,0,1,0,2,0,3, 4,4,0,1,2,0, 5,0
  ];
  const beat = Math.floor(t / 5) % SEQ.length;
  const pose = SEQ[beat];
  const xOff = pose === 4 ? ((t & 1) ? 1 : -1) : 0;
  buddyPrintSprite(P[pose], 5, 0, 0xFFFF, xOff);

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
  const CROUCH = [ "    (\\_/)   ", "   ( ^ ^ )  ", "  =(  v  )= ", "   (\")_(\")  ", "  ~~~~~~~~  " ];
  const HOP = [ "  \\ (\\_/) / ", "   ( ^ ^ )  ", "  =(  v  )= ", "   (\")_(\")  ", "            " ];
  const PEAK = [ "  \\ (\\o/) / ", "   ( ^ ^ )  ", "  =(  W  )= ", "   ('')_('') ", "            " ];
  const SPIN_L = [ "    (\\_/)   ", "   ( <  < ) ", "  =(  v  )=/", "   (\")_(\")  ", "            " ];
  const SPIN_R = [ "    (\\_/)   ", "   ( >  > ) ", " \\=(  v  )= ", "   (\")_(\")  ", "            " ];
  const POSE = [ "   \\(\\_/)/  ", "   ( ^ ^ )  ", "  =(  W  )= ", "  /(\")_(\")\\ ", "            " ];

  const P = [CROUCH, HOP, PEAK, SPIN_L, SPIN_R, POSE];
  const SEQ = [ 0,1,2,1,0, 3,4,3,4, 0,1,2,1,0, 5,5 ];
  const Y_SHIFT = [ 0,-4,-8,-4,0, 0,0,0,0, 0,-4,-8,-4,0, 0,0 ];
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
    buddyPrint(((i + Math.floor(t / 2)) & 1) ? "*" : ".");
  }
}

// ─── DIZZY ───  ~5.6s cycle, 5 poses + orbiting stars
function doDizzy(t: number): void {
  const TILT_L = [ "   (\\_/)    ", "  ( @ @ )   ", " =(  ~  )=  ", "  (\")_(\")   ", "            " ];
  const TILT_R = [ "    (\\_/)   ", "    ( @ @ ) ", "   =(  ~  )=", "    (\")_(\") ", "            " ];
  const WOOZY = [ "    (\\_/)   ", "   ( x @ )  ", "  =(  ~v )= ", "   (\")_(\")  ", "            " ];
  const WOOZY2 = [ "    (\\_/)   ", "   ( @ x )  ", "  =( v~  )= ", "   (\")_(\")  ", "            " ];
  const FLOP = [ "    (\\_/)   ", "   ( @ @ )  ", "  =(  -  )= ", "  /(\")_(\")\\ ", " ~~~~~~~~~~ " ];

  const P = [TILT_L, TILT_R, WOOZY, WOOZY2, FLOP];
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
  const DREAMY = [ "    (\\_/)   ", "   ( ^ ^ )  ", "  =(  v  )= ", "   (\")_(\")  ", "            " ];
  const BLUSH = [ "    (\\_/)   ", "   (#^ ^#)  ", "  =(  v  )= ", "   (\")_(\")  ", "            " ];
  const EYES_C = [ "    (\\_/)   ", "   (<3 <3)  ", "  =(  v  )= ", "   (\")_(\")  ", "            " ];
  const TWIRL = [ "   \\(\\_/)/  ", "   ( @ @ )  ", "  =(  v  )= ", "  /(\")_(\")\\ ", "            " ];
  const SIGH = [ "    (v_v)   ", "   ( - - )  ", "  =(  ^  )= ", "   (\")_(\")  ", "            " ];

  const P = [DREAMY, BLUSH, EYES_C, TWIRL, SIGH];
  const SEQ = [
    0,0,1,0, 2,2,0, 1,0,4, 0,0,3,3, 0,1,0,2, 1,0
  ];
  const Y_BOB = [ 0,-1,0,-1, 0,-1,0, -1,0,0, -1,0,0,0, -1,0,-1,0, -1,0 ];
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

export const RABBIT_SPECIES: Species = {
  name: "rabbit",
  bodyColor: 0xFFFF,
  states: [doSleep, doIdle, doBusy, doAttention, doCelebrate, doDizzy, doHeart],
};
