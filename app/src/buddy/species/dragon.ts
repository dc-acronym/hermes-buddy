// Port of src/buddies/dragon.cpp (anthropics/claude-desktop-buddy), 1:1.
import {
  buddyPrintSprite,
  buddySetCursor,
  buddySetColor,
  buddyPrint,
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
  type Species,
} from "../common";

// ─── SLEEP ───  ~12s cycle, 6 poses
function doSleep(t: number): void {
  const CURL = [ "            ", "            ", "   _____    ", "  (--   )~  ", "  `vvvvv'   " ];
  const BREATH = [ "            ", "            ", "   _____    ", "  (--   )~~ ", "  `vvvvv'   " ];
  const PUFF = [ "            ", "       o    ", "   _____    ", "  (--   )~~ ", "  `vvvvv'   " ];
  const TWITCH = [ "            ", "  /v\\  /v\\  ", " <  --  -- >", " (        ) ", "  `-vvvv-'  " ];
  const SNORE = [ "            ", "  /^\\  /^\\  ", " <  oo  oo >", " (   __   ) ", "  `-vvvv-'  " ];
  const HOARD = [ "            ", "            ", "   _____    ", "  (--   )$  ", "  `vvvvv'$$ " ];

  const P = [ CURL, BREATH, PUFF, TWITCH, SNORE, HOARD ];
  const SEQ = [
    0,1,0,1,0,1,2,1,
    0,1,0,1,
    3,4,3,4,
    1,2,1,
    5,5,0,0,
    1,2,1,2
  ];
  const beat = Math.floor(t / 5) % SEQ.length;
  buddyPrintSprite(P[SEQ[beat]], 5, 0, 0xF800);

  // Z's drift up-right, smoke puff drifts up
  const p1 = t % 10;
  const p2 = (t + 4) % 10;
  const p3 = (t + 7) % 12;
  buddySetColor(BUDDY_DIM);
  buddySetCursor(BUDDY_X_CENTER + 22 + p1, BUDDY_Y_OVERLAY + 18 - p1 * 2);
  buddyPrint("z");
  buddySetColor(BUDDY_WHITE);
  buddySetCursor(BUDDY_X_CENTER + 28 + p2, BUDDY_Y_OVERLAY + 12 - p2);
  buddyPrint("Z");
  // Smoke ring rising
  buddySetColor(BUDDY_DIM);
  buddySetCursor(BUDDY_X_CENTER + 18, BUDDY_Y_OVERLAY + 16 - p3);
  buddyPrint("o");
}

// ─── IDLE ───  ~14s cycle, 10 poses
function doIdle(t: number): void {
  const PROUD = [ "            ", "  /^\\  /^\\  ", " <  o    o >", " (   ww   ) ", "  `-vvvv-'  " ];
  const LOOK_L = [ "            ", "  /^\\  /^\\  ", " <o     o  >", " (   ww   ) ", "  `-vvvv-'  " ];
  const LOOK_R = [ "            ", "  /^\\  /^\\  ", " <  o     o>", " (   ww   ) ", "  `-vvvv-'  " ];
  const BLINK = [ "            ", "  /^\\  /^\\  ", " <  -    - >", " (   ww   ) ", "  `-vvvv-'  " ];
  const WING_UP = [ "  /^\\  /^\\  ", "  \\_/  \\_/  ", " <  o    o >", " (   ww   ) ", "  `-vvvv-'  " ];
  const WING_DN = [ "            ", "  \\v/  \\v/  ", " <  o    o >", " (   ww   ) ", "  `-vvvv-'  " ];
  const SNIFF = [ "      ~     ", "  /^\\  /^\\  ", " <  o    o >", " (   nn   ) ", "  `-vvvv-'  " ];
  const PUFF_R = [ "         ~  ", "  /^\\  /^\\  ", " <  o    o >", " (   ww   )~", "  `-vvvv-'  " ];
  const SMUG = [ "            ", "  /^\\  /^\\  ", " <  ^    ^ >", " (   --   ) ", "  `-vvvv-'  " ];
  const STRETCH = [ "  /^\\  /^\\  ", " //^\\  /^\\\\ ", "< <  o   o> >", "  (   ww  )  ", "   `-vvvv-'  " ];

  const P = [ PROUD, LOOK_L, LOOK_R, BLINK, WING_UP, WING_DN, SNIFF, PUFF_R, SMUG, STRETCH ];
  const SEQ = [
    0,0,1,0,2,0,3,
    4,5,4,5,4,5,
    0,0,6,7,
    0,3,0,8,8,0,
    1,2,0,
    9,9,0,0,
    7,0,8,0
  ];
  const beat = Math.floor(t / 5) % SEQ.length;
  buddyPrintSprite(P[SEQ[beat]], 5, 0, 0xF800);

  // Tiny smoke trail from nostrils when sniffing/puffing
  const pose = SEQ[beat];
  if (pose === 6 || pose === 7) {
    const s = (t & 7);
    buddySetColor(BUDDY_DIM);
    buddySetCursor(BUDDY_X_CENTER + (pose === 7 ? 14 : 0), BUDDY_Y_OVERLAY - 4 - s);
    buddyPrint(s & 1 ? "o" : ".");
  }
}

// ─── BUSY ───  ~10s cycle, 6 poses + gold-coin ticker
function doBusy(t: number): void {
  const COUNT_A = [ "    $$$$    ", "  /^\\  /^\\  ", " <  v    v >", " (   --   ) ", " /`-vvvv-'\\ " ];
  const COUNT_B = [ "    $$$$    ", "  /^\\  /^\\  ", " <  v    v >", " (   __   ) ", " \\`-vvvv-'/ " ];
  const PONDER = [ "      ?     ", "  /^\\  /^\\  ", " <  ^    ^ >", " (   ..   ) ", "  `-vvvv-'  " ];
  const STACK = [ "    [$]     ", "  /^|  /^\\  ", " <  v|   v >", " (   --   ) ", "  `-vvvv-'  " ];
  const EUREKA = [ "      *     ", "  /^\\  /^\\  ", " <  O    O >", " (   ^^   )~", "  `-vvvv-'  " ];
  const PUFF_OUT = [ "    ~~~~    ", "  /^\\  /^\\  ", " <  -    - >", " (   __   ) ", "  `-vvvv-'  " ];

  const P = [ COUNT_A, COUNT_B, PONDER, STACK, EUREKA, PUFF_OUT ];
  const SEQ = [
    0,1,0,1,0,1, 2,2, 0,1,0,1, 3,3, 2,4, 0,1,0,1,5
  ];
  const beat = Math.floor(t / 5) % SEQ.length;
  buddyPrintSprite(P[SEQ[beat]], 5, 0, 0xF800);

  // Gold coins clinking — '$' and '.' alternate
  const COINS = [ "$  ", "$$ ", "$$$", " $$", "  $", "   " ];
  buddySetColor(BUDDY_YEL);
  buddySetCursor(BUDDY_X_CENTER + 22, BUDDY_Y_OVERLAY + 14);
  buddyPrint(COINS[t % 6]);
  // Sparkle on top of pile
  if (Math.floor(t / 2) & 1) {
    buddySetColor(BUDDY_WHITE);
    buddySetCursor(BUDDY_X_CENTER + 24, BUDDY_Y_OVERLAY + 10);
    buddyPrint("*");
  }
}

// ─── ATTENTION ───  ~8s cycle, 6 poses + ! pulse
function doAttention(t: number): void {
  const ROAR = [ "    ^  ^    ", " /^^\\  /^^\\ ", "<  O    O  >", " (   <>   ) ", "  `-vvvv-'  " ];
  const SCAN_L = [ "    ^  ^    ", " /^^\\  /^^\\ ", "< O      O >", " (   O    ) ", "  `-vvvv-'  " ];
  const SCAN_R = [ "    ^  ^    ", " /^^\\  /^^\\ ", "<  O      O>", " (    O   ) ", "  `-vvvv-'  " ];
  const FLAME = [ "  ~~~  ~~~  ", " /^^\\  /^^\\ ", "<  O    O  >", " (   <>   )~", "  `-vvvv-'  " ];
  const PUFF_UP = [ "    ^  ^    ", "/^^^\\  /^^^\\", "<  O    O  >", "((  <>   ))~", " /`-vvvv-'\\ " ];
  const HISS = [ "    ^  ^    ", " /^^\\  /^^\\ ", "<  o    o  >", " (   ss   ) ", "  `-vvvv-'  " ];

  const P = [ ROAR, SCAN_L, SCAN_R, FLAME, PUFF_UP, HISS ];
  const SEQ = [
    0,4,0,1,0,2,0,3, 4,4,0,1,2,3, 5,0
  ];
  const beat = Math.floor(t / 5) % SEQ.length;
  const pose = SEQ[beat];
  const xOff = (pose === 4) ? ((t & 1) ? 1 : -1) : 0;
  buddyPrintSprite(P[pose], 5, 0, 0xF800, xOff);

  // Pulsing exclamations
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
  // Flame puff after a flame frame
  if (pose === 3 || pose === 4) {
    buddySetColor(BUDDY_YEL);
    buddySetCursor(BUDDY_X_CENTER + 18, BUDDY_Y_OVERLAY + 12 - ((t * 2) % 8));
    buddyPrint("^");
  }
}

// ─── CELEBRATE ───  ~5.6s cycle, 6 poses + multicolor confetti
function doCelebrate(t: number): void {
  const CROUCH = [ "            ", "  /^\\  /^\\  ", " <  ^    ^ >", " (   WW   ) ", " /`-vvvv-'\\ " ];
  const JUMP = [ "  \\(    )/  ", "   /^\\/^\\   ", " <  ^    ^ >", " (   WW   ) ", "  `-vvvv-'  " ];
  const PEAK = [ "  \\^    ^/  ", "  //^\\/^\\\\  ", " <  *    * >", " (   OO   ) ", "  `-vvvv-'  " ];
  const SPIN_L = [ "            ", "  /^\\  /^\\  ", "< <    <  > ", " (   ww   ) ", "  `-vvvv-'  " ];
  const SPIN_R = [ "            ", "  /^\\  /^\\  ", " <  >    > >", " (   ww   ) ", "  `-vvvv-'  " ];
  const POSE = [ "    \\$$/    ", "  /^\\  /^\\  ", " <  ^    ^ >", "/(   WW   )\\", "  `-vvvv-'  " ];

  const P = [ CROUCH, JUMP, PEAK, SPIN_L, SPIN_R, POSE ];
  const SEQ = [ 0,1,2,1,0, 3,4,3,4, 0,1,2,1,0, 5,5 ];
  const Y_SHIFT = [ 0,-3,-6,-3,0, 0,0,0,0, 0,-3,-6,-3,0, 0,0 ];
  const beat = Math.floor(t / 3) % SEQ.length;
  buddyPrintSprite(P[SEQ[beat]], 5, Y_SHIFT[beat], 0xF800);

  // Multicolor confetti raining
  const cols = [ BUDDY_YEL, BUDDY_HEART, BUDDY_CYAN, BUDDY_WHITE, BUDDY_GREEN ];
  for (let i = 0; i < 6; i++) {
    const phase = (t * 2 + i * 11) % 22;
    const x = BUDDY_X_CENTER - 36 + i * 14;
    const y = BUDDY_Y_OVERLAY - 6 + phase;
    if (y > BUDDY_Y_BASE + 20 || y < 0) continue;
    buddySetColor(cols[i % 5]);
    buddySetCursor(x, y);
    buddyPrint((i + Math.floor(t / 2)) & 1 ? "$" : "*");
  }
}

// ─── DIZZY ───  ~5.6s cycle, 5 poses + orbiting stars
function doDizzy(t: number): void {
  const TILT_L = [ "            ", " /^\\  /^\\   ", "< @    @ )  ", " (   ~~   ) ", "  `-vvvv-'  " ];
  const TILT_R = [ "            ", "   /^\\  /^\\ ", "  ( @    @ >", " (   ~~   ) ", "  `-vvvv-'  " ];
  const WOOZY = [ "            ", "  /v\\  /^\\  ", " <  x    @ >", " (   ~v   ) ", "  `-vvvv-'  " ];
  const WOOZY2 = [ "            ", "  /^\\  /v\\  ", " <  @    x >", " (   v~   ) ", "  `-vvvv-'  " ];
  const STUMBLE = [ "            ", "  /v\\  /v\\  ", " <  @    @ >", " (   --   ) ", " /`_-vv-_'\\ " ];

  const P = [ TILT_L, TILT_R, WOOZY, WOOZY2, STUMBLE ];
  const SEQ = [ 0,1,0,1, 2,3, 0,1,0,1, 4,4, 2,3 ];
  const X_SHIFT = [ -3,3,-3,3, 0,0, -3,3,-3,3, 0,0, 0,0 ];
  const beat = Math.floor(t / 4) % SEQ.length;
  buddyPrintSprite(P[SEQ[beat]], 5, 0, 0xF800, X_SHIFT[beat]);

  // Orbiting stars
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
  // Spinning '$' coin to remind us this is a dragon
  const p3 = (t + 2) % 8;
  buddySetColor(BUDDY_WHITE);
  buddySetCursor(BUDDY_X_CENTER + OX[p3] - 2, BUDDY_Y_OVERLAY + 6 + OY[p3]);
  buddyPrint("$");
}

// ─── HEART ───  ~10s cycle, 5 poses + rising heart stream
function doHeart(t: number): void {
  const DREAMY = [ "            ", "  /^\\  /^\\  ", " <  ^    ^ >", " (   ww   ) ", "  `-vvvv-'  " ];
  const BLUSH = [ "            ", "  /^\\  /^\\  ", " <#^    ^# >", " (   ww   ) ", "  `-vvvv-'  " ];
  const EYES_C = [ "            ", "  /^\\  /^\\  ", " < <3  <3  >", " (   ww   ) ", "  `-vvvv-'  " ];
  const TWIRL = [ "            ", "  /^\\  /^\\  ", " <  @    @ >", " (   ww   ) ", " /`-vvvv-'\\ " ];
  const SIGH = [ "      v     ", "  /^\\  /^\\  ", " <  -    - >", " (   ^^   )~", "  `-vvvv-'  " ];

  const P = [ DREAMY, BLUSH, EYES_C, TWIRL, SIGH ];
  const SEQ = [
    0,0,1,0, 2,2,0, 1,0,4, 0,0,3,3, 0,1,0,2, 1,0
  ];
  const Y_BOB = [ 0,-1,0,-1, 0,-1,0, -1,0,0, -1,0,0,0, -1,0,-1,0, -1,0 ];
  const beat = Math.floor(t / 5) % SEQ.length;
  buddyPrintSprite(P[SEQ[beat]], 5, Y_BOB[beat], 0xF800);

  // Rising heart stream
  buddySetColor(BUDDY_HEART);
  for (let i = 0; i < 5; i++) {
    const phase = (t + i * 4) % 16;
    const y = BUDDY_Y_OVERLAY + 16 - phase;
    if (y < -2 || y > BUDDY_Y_BASE) continue;
    const x = BUDDY_X_CENTER - 20 + i * 8 + (Math.floor(phase / 3) & 1) * 2 - 1;
    buddySetCursor(x, y);
    buddyPrint("v");
  }
  // Lovesick smoke ring drifts up
  const sp = (t * 2) % 18;
  buddySetColor(BUDDY_DIM);
  buddySetCursor(BUDDY_X_CENTER + 14, BUDDY_Y_OVERLAY + 14 - sp);
  buddyPrint("o");
}

export const DRAGON_SPECIES: Species = {
  name: "dragon",
  bodyColor: 0xF800,
  states: [
    doSleep, doIdle, doBusy, doAttention,
    doCelebrate, doDizzy, doHeart,
  ],
};
