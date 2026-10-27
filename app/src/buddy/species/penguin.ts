// Port of src/buddies/penguin.cpp (claude-desktop-buddy). Kept 1:1 with the firmware:
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

// ─── SLEEP ───  ~12s cycle, 6 poses, curled on ice
function doSleep(t: number): void {
  const TUCK = [ "            ", "   .---.    ", "  ( -- )    ", "  (_____)   ", "   ~~~~~    " ];
  const BREATHE = [ "            ", "   .---.    ", "  ( -- )    ", "  (_____)   ", "   =====    " ];
  const SNORE = [ "    o O .   ", "   .---.    ", "  ( __ )    ", "  (_____)   ", "   =====    " ];
  const TIPPED = [ "            ", "            ", "  .-----.   ", " ( --   )=> ", "  `~~~~~`   " ];
  const TIPPED2 = [ "            ", "            ", "  .-----.   ", " ( zz   )=> ", "  `~~~~~`   " ];
  const TWITCH = [ "            ", "   .---.    ", "  ( ^^ )    ", " /(_____)   ", "   ~~~~~    " ];

  const P = [TUCK, BREATHE, SNORE, TIPPED, TIPPED2, TWITCH];
  const SEQ = [
    0,1,0,1,0,1,2,1,
    0,1,0,1,
    3,4,3,4,3,4,
    3,3,
    1,5,1,1
  ];
  const beat = Math.floor(t / 5) % SEQ.length;
  buddyPrintSprite(P[SEQ[beat]], 5, 0, 0x041F);

  // Z particles drift up-right with cold-blue tint
  const p1 = t % 10;
  const p2 = (t + 4) % 10;
  const p3 = (t + 7) % 10;
  buddySetColor(BUDDY_CYAN);
  buddySetCursor(BUDDY_X_CENTER + 20 + p1, BUDDY_Y_OVERLAY + 18 - p1 * 2);
  buddyPrint("z");
  buddySetColor(BUDDY_WHITE);
  buddySetCursor(BUDDY_X_CENTER + 26 + p2, BUDDY_Y_OVERLAY + 14 - p2);
  buddyPrint("Z");
  buddySetColor(BUDDY_DIM);
  buddySetCursor(BUDDY_X_CENTER + 16 + Math.floor(p3 / 2), BUDDY_Y_OVERLAY + 10 - Math.floor(p3 / 2));
  buddyPrint("z");
}

// ─── IDLE ───  ~14s cycle, 10 poses of waddling, formal posture
function doIdle(t: number): void {
  const STAND = [ "   .---.    ", "  ( o>o )   ", " /(     )\\  ", "  `-----`   ", "   J   L    " ];
  const WAD_L = [ "   .---.    ", "  ( o>o )   ", "/(     )    ", "  `-----`   ", "  J    L    " ];
  const WAD_R = [ "   .---.    ", "  ( o>o )   ", " (     )\\   ", "  `-----`   ", "   J    L   " ];
  const BLINK = [ "   .---.    ", "  ( ->- )   ", " /(     )\\  ", "  `-----`   ", "   J   L    " ];
  const LOOK_L = [ "   .---.    ", "  (o> o )   ", " /(     )\\  ", "  `-----`   ", "   J   L    " ];
  const LOOK_R = [ "   .---.    ", "  ( o >o)   ", " /(     )\\  ", "  `-----`   ", "   J   L    " ];
  const PREEN = [ "   .---.    ", "  ( o>o )   ", " /(  v  )\\  ", "  `-----`   ", "   J   L    " ];
  const FLAP = [ "  \\.---./   ", "  ( o>o )   ", "/(     )\\   ", "  `-----`   ", "   J   L    " ];
  const BOW = [ "            ", "   .---.    ", "  ( v>v )   ", " /(_____)\\  ", "   J   L    " ];
  const STRETCH = [ "  /.---.\\   ", " ( ^>^ )    ", "//(     )\\\\ ", "  `-----`   ", "   J   L    " ];

  const P = [STAND, WAD_L, WAD_R, BLINK, LOOK_L, LOOK_R, PREEN, FLAP, BOW, STRETCH];
  const SEQ = [
    0,0,1,2,1,2,0,3,
    0,4,0,5,0,
    6,6,0,3,
    0,1,2,1,2,0,
    7,7,0,0,
    8,8,0,
    9,9,0,0
  ];
  const beat = Math.floor(t / 5) % SEQ.length;
  buddyPrintSprite(P[SEQ[beat]], 5, 0, 0x041F);
}

// ─── BUSY ───  ~10s cycle, 6 poses + dot ticker, formal flipper-typing
function doBusy(t: number): void {
  const TYPE_A = [ "   .---.    ", "  ( v>v )   ", " /(     )\\  ", " /`-----`\\  ", "   J   L    " ];
  const TYPE_B = [ "   .---.    ", "  ( v>v )   ", " \\(     )/  ", " \\`-----`/  ", "   J   L    " ];
  const THINK = [ "      ?     ", "   .---.    ", "  ( ^>^ )   ", " /(  .  )\\  ", "   J   L    " ];
  const SIP = [ "    [_]     ", "   .---.|   ", "  ( o>o |   ", " /(     )\\  ", "   J   L    " ];
  const EUREKA = [ "      *     ", "   .---.    ", "  ( O>O )   ", " /(  ^  )\\  ", "   J   L    " ];
  const RELIEF = [ "    ~~~     ", "   .---.    ", "  ( ->- )   ", " /(  _  )\\  ", "   J   L    " ];

  const P = [TYPE_A, TYPE_B, THINK, SIP, EUREKA, RELIEF];
  const SEQ = [
    0,1,0,1,0,1, 2,2, 0,1,0,1, 3,3, 2,4, 0,1,0,1,5
  ];
  const beat = Math.floor(t / 5) % SEQ.length;
  buddyPrintSprite(P[SEQ[beat]], 5, 0, 0x041F);

  const DOTS = [ ".  ", ".. ", "...", " ..", "  .", "   " ];
  buddySetColor(BUDDY_WHITE);
  buddySetCursor(BUDDY_X_CENTER + 22, BUDDY_Y_OVERLAY + 14);
  buddyPrint(DOTS[t % 6]);
}

// ─── ATTENTION ───  ~8s cycle, 6 poses + ! pulse, alert flippers up
function doAttention(t: number): void {
  const ALERT = [ "   .---.    ", "  ( O>O )   ", " /(     )\\  ", "  `-----`   ", "   J   L    " ];
  const SCAN_L = [ "   .---.    ", "  (O> O )   ", " /(     )\\  ", "  `-----`   ", "   J   L    " ];
  const SCAN_R = [ "   .---.    ", "  ( O >O)   ", " /(     )\\  ", "  `-----`   ", "   J   L    " ];
  const SCAN_U = [ "   .---.    ", "  ( ^>^ )   ", " /(     )\\  ", "  `-----`   ", "   J   L    " ];
  const TENSE = [ "  /.---.\\   ", " /( O>O )\\  ", "//(     )\\\\ ", "  `-----`   ", "  J     L   " ];
  const HUSH = [ "   .---.    ", "  ( o>o )   ", " /(  .  )\\  ", "  `-----`   ", "   J   L    " ];

  const P = [ALERT, SCAN_L, SCAN_R, SCAN_U, TENSE, HUSH];
  const SEQ = [
    0,4,0,1,0,2,0,3, 4,4,0,1,2,0, 5,0
  ];
  const beat = Math.floor(t / 5) % SEQ.length;
  const pose = SEQ[beat];
  const xOff = pose === 4 ? ((t & 1) ? 1 : -1) : 0;
  buddyPrintSprite(P[pose], 5, 0, 0x041F, xOff);

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

// ─── CELEBRATE ───  ~5.6s cycle, 6 poses + confetti rain, jumping penguin
function doCelebrate(t: number): void {
  const CROUCH = [ "            ", "   .---.    ", "  ( ^>^ )   ", " /(_____)\\  ", "   J   L    " ];
  const JUMP = [ "  \\.---./   ", "  ( ^>^ )   ", " /(     )\\  ", "  `-----`   ", "   ^   ^    " ];
  const PEAK = [ "  \\^---^/   ", "  ( O>O )   ", " /(  W  )\\  ", "  `-----`   ", "   v   v    " ];
  const SPIN_L = [ "   .---.    ", "  ( <>< )   ", "/(     )    ", "  `-----`   ", "   /   \\    " ];
  const SPIN_R = [ "   .---.    ", "  (>< ><)   ", " (     )\\   ", "  `-----`   ", "   \\   /    " ];
  const POSE = [ "    \\_/     ", "   .---.    ", "  ( ^>^ )   ", "/(  W  )\\   ", "   J   L    " ];

  const P = [CROUCH, JUMP, PEAK, SPIN_L, SPIN_R, POSE];
  const SEQ = [ 0,1,2,1,0, 3,4,3,4, 0,1,2,1,0, 5,5 ];
  const Y_SHIFT = [ 0,-3,-6,-3,0, 0,0,0,0, 0,-3,-6,-3,0, 0,0 ];
  const beat = Math.floor(t / 3) % SEQ.length;
  buddyPrintSprite(P[SEQ[beat]], 5, Y_SHIFT[beat], 0x041F);

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

// ─── DIZZY ───  ~5.6s cycle, 5 poses + orbiting stars, slipping on ice
function doDizzy(t: number): void {
  const SLIP_L = [ "  .---.     ", " ( @>@ )    ", "/(     )    ", " `-----`    ", "  J   L     " ];
  const SLIP_R = [ "    .---.   ", "   ( @>@ )  ", "   (     )\\ ", "    `-----` ", "     J   L  " ];
  const WOOZY = [ "   .---.    ", "  ( x>@ )   ", " /(  ~  )\\  ", "  `-----`   ", "   J   L    " ];
  const WOOZY2 = [ "   .---.    ", "  ( @>x )   ", " /(  ~  )\\  ", "  `-----`   ", "   J   L    " ];
  const SPLAT = [ "            ", "   .---.    ", "  ( @>@ )   ", " (_______)= ", "   ~~~~~    " ];

  const P = [SLIP_L, SLIP_R, WOOZY, WOOZY2, SPLAT];
  const SEQ = [ 0,1,0,1, 2,3, 0,1,0,1, 4,4, 2,3 ];
  const X_SHIFT = [ -3,3,-3,3, 0,0, -3,3,-3,3, 0,0, 0,0 ];
  const beat = Math.floor(t / 4) % SEQ.length;
  buddyPrintSprite(P[SEQ[beat]], 5, 0, 0x041F, X_SHIFT[beat]);

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

// ─── HEART ───  ~10s cycle, 5 poses + rising heart stream, dreamy penguin
function doHeart(t: number): void {
  const DREAMY = [ "   .---.    ", "  ( ^>^ )   ", " /(     )\\  ", "  `-----`   ", "   J   L    " ];
  const BLUSH = [ "   .---.    ", "  (#^>^#)   ", " /(     )\\  ", "  `-----`   ", "   J   L    " ];
  const EYES_C = [ "   .---.    ", "  (<3><3)   ", " /(     )\\  ", "  `-----`   ", "   J   L    " ];
  const TWIRL = [ "   .---.    ", "  ( @>@ )   ", "/(     )\\   ", "  `-----`   ", "    \\ /     " ];
  const SIGH = [ "   .---.    ", "  ( ->- )   ", " /(  ^  )\\  ", "  `-----`   ", "   J   L    " ];

  const P = [DREAMY, BLUSH, EYES_C, TWIRL, SIGH];
  const SEQ = [
    0,0,1,0, 2,2,0, 1,0,4, 0,0,3,3, 0,1,0,2, 1,0
  ];
  const Y_BOB = [ 0,-1,0,-1, 0,-1,0, -1,0,0, -1,0,0,0, -1,0,-1,0, -1,0 ];
  const beat = Math.floor(t / 5) % SEQ.length;
  buddyPrintSprite(P[SEQ[beat]], 5, Y_BOB[beat], 0x041F);

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

export const PENGUIN_SPECIES: Species = {
  name: "penguin",
  bodyColor: 0x041F,
  states: [doSleep, doIdle, doBusy, doAttention, doCelebrate, doDizzy, doHeart],
};
