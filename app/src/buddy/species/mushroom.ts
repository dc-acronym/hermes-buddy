// Port of src/buddies/mushroom.cpp (anthropics/claude-desktop-buddy), 1:1.
import {
  buddyPrintSprite,
  buddySetCursor,
  buddySetColor,
  buddyPrint,
  BUDDY_CYAN,
  BUDDY_DIM,
  BUDDY_GREEN,
  BUDDY_HEART,
  BUDDY_WHITE,
  BUDDY_X_CENTER,
  BUDDY_YEL,
  BUDDY_Y_BASE,
  BUDDY_Y_OVERLAY,
  type Species,
} from "../common";

// ─── SLEEP ───  ~12s cycle, 6 poses
function doSleep(t: number): void {
  const TUCK = [ "            ", " .-o-OO-o-. ", "(__________)", "   |-  - |  ", "   |____|   " ];
  const BREATHE = [ "            ", " .-O-oo-O-. ", "(__________)", "   |-  - |  ", "   |____|   " ];
  const DEEP = [ "            ", " .-o-oo-o-. ", "(__________)", "   |_  _ |  ", "   |____|   " ];
  const LEAN = [ "            ", "  .-o-OO-o-.", "  (________)", "    |-  -| /", "    |____|  " ];
  const LEAN_Z = [ "            ", "  .-o-OO-o-.", "  (________)", "    |z  z| /", "    |____|  " ];
  const MUMBLE = [ "            ", " .-O-OO-O-. ", "(__________)", "   |o  o |  ", "   |____|   " ];

  const P = [ TUCK, BREATHE, DEEP, LEAN, LEAN_Z, MUMBLE ];
  const SEQ = [
    0,1,0,1,0,1,2,1,
    0,1,0,1,
    3,4,3,4,3,4,
    3,3,
    1,5,1,1
  ];
  const beat = Math.floor(t / 5) % SEQ.length;
  buddyPrintSprite(P[SEQ[beat]], 5, 0, 0xF810);

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
  const REST = [ "            ", " .-o-OO-o-. ", "(__________)", "   |o   o|  ", "   |____|   " ];
  const LOOK_L = [ "            ", " .-o-OO-o-. ", "(__________)", "   |o  o |  ", "   |____|   " ];
  const LOOK_R = [ "            ", " .-o-OO-o-. ", "(__________)", "   | o  o|  ", "   |____|   " ];
  const LOOK_U = [ "            ", " .-o-OO-o-. ", "(__________)", "   |^   ^|  ", "   |____|   " ];
  const BLINK = [ "            ", " .-o-OO-o-. ", "(__________)", "   |-   -|  ", "   |____|   " ];
  const CAP_BOB = [ "            ", " .-O-oo-O-. ", "(__________)", "   |o   o|  ", "   |____|   " ];
  const SPORE_A = [ "  . o .  .  ", " .-o-OO-o-. ", "(__________)", "   |o   o|  ", "   |____|   " ];
  const SPORE_B = [ " o  .  o .  ", " .-O-oo-O-. ", "(__________)", "   |o   o|  ", "   |____|   " ];
  const SHIVER = [ "            ", " .~o-OO-o~. ", "(~~~~~~~~~~)", "   |o   o|  ", "   |____|   " ];
  const SWAY = [ "            ", "  .-o-OO-o-.", "  (________)", "   |o   o|  ", "   |____|   " ];

  const P = [ REST, LOOK_L, LOOK_R, LOOK_U, BLINK, CAP_BOB, SPORE_A, SPORE_B, SHIVER, SWAY ];
  const SEQ = [
    0,0,0,1,0,2,0,4,
    0,5,0,0,
    6,7,6,7,
    0,0,3,3,0,4,
    8,8,0,0,
    9,9,0,0
  ];
  const beat = Math.floor(t / 5) % SEQ.length;
  buddyPrintSprite(P[SEQ[beat]], 5, 0, 0xF810);
}

// ─── BUSY ───  ~10s cycle, 6 poses + dot ticker
function doBusy(t: number): void {
  const SCAN_A = [ "            ", " .-o-OO-o-. ", "(__________)", "   |v   v|  ", "  /|____|\\  " ];
  const SCAN_B = [ "            ", " .-o-OO-o-. ", "(__________)", "   |v   v|  ", "  \\|____|/  " ];
  const THINK = [ "      ?     ", " .-O-oo-O-. ", "(__________)", "   |^   ^|  ", "   |____|   " ];
  const READ = [ "    [_]     ", " .-o-OO-o|. ", "(________|_)", "   |o   o|  ", "   |____|   " ];
  const AHA = [ "      *     ", " .-O-OO-O-. ", "(__________)", "   |O   O|  ", "  /|____|\\  " ];
  const PHEW = [ "    ~~~     ", " .-o-OO-o-. ", "(__________)", "   |-   -|  ", "   |____|   " ];

  const P = [ SCAN_A, SCAN_B, THINK, READ, AHA, PHEW ];
  const SEQ = [
    0,1,0,1,0,1, 2,2, 0,1,0,1, 3,3, 2,4, 0,1,0,1,5
  ];
  const beat = Math.floor(t / 5) % SEQ.length;
  buddyPrintSprite(P[SEQ[beat]], 5, 0, 0xF810);

  const DOTS = [ ".  ", ".. ", "...", " ..", "  .", "   " ];
  buddySetColor(BUDDY_WHITE);
  buddySetCursor(BUDDY_X_CENTER + 22, BUDDY_Y_OVERLAY + 14);
  buddyPrint(DOTS[t % 6]);
}

// ─── ATTENTION ───  ~8s cycle, 6 poses + ! pulse
function doAttention(t: number): void {
  const ALERT = [ "            ", " /^o-OO-o^\\ ", "(__________)", "   |O   O|  ", "   |____|   " ];
  const SCAN_L = [ "            ", " /^o-OO-o^\\ ", "(__________)", "   |O  O |  ", "   |____|   " ];
  const SCAN_R = [ "            ", " /^o-OO-o^\\ ", "(__________)", "   | O  O|  ", "   |____|   " ];
  const SCAN_U = [ "            ", " /^o-OO-o^\\ ", "(__________)", "   |^   ^|  ", "   |____|   " ];
  const TENSE = [ "    ^  ^    ", "/^^o-OO-o^^\\", "(__________)", "   |O   O|  ", "  /|____|\\  " ];
  const HUSH = [ "            ", " /^o-OO-o^\\ ", "(__________)", "   |o   o|  ", "   |____|   " ];

  const P = [ ALERT, SCAN_L, SCAN_R, SCAN_U, TENSE, HUSH ];
  const SEQ = [
    0,4,0,1,0,2,0,3, 4,4,0,1,2,0, 5,0
  ];
  const beat = Math.floor(t / 5) % SEQ.length;
  const pose = SEQ[beat];
  const xOff = (pose === 4) ? ((t & 1) ? 1 : -1) : 0;
  buddyPrintSprite(P[pose], 5, 0, 0xF810, xOff);

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
  const CROUCH = [ "            ", " .-o-OO-o-. ", "(__________)", "   |^   ^|  ", "  /|____|\\  " ];
  const JUMP = [ "  \\(    )/  ", " .-o-OO-o-. ", "(__________)", "   |^   ^|  ", "   |____|   " ];
  const PEAK = [ "  \\^    ^/  ", " .-O-OO-O-. ", "(__________)", "   |^   ^|  ", "   |____|   " ];
  const SPIN_L = [ "            ", " .-o-OO-o-. ", "(__________)", "  <|<   <|  ", "   |____|   " ];
  const SPIN_R = [ "            ", " .-o-OO-o-. ", "(__________)", "   |>   >|> ", "   |____|   " ];
  const POSE = [ "    \\__/    ", " .-O-OO-O-. ", "(__________)", "   |^   ^|  ", " /|____|\\   " ];

  const P = [ CROUCH, JUMP, PEAK, SPIN_L, SPIN_R, POSE ];
  const SEQ = [ 0,1,2,1,0, 3,4,3,4, 0,1,2,1,0, 5,5 ];
  const Y_SHIFT = [ 0,-3,-6,-3,0, 0,0,0,0, 0,-3,-6,-3,0, 0,0 ];
  const beat = Math.floor(t / 3) % SEQ.length;
  buddyPrintSprite(P[SEQ[beat]], 5, Y_SHIFT[beat], 0xF810);

  const cols = [ BUDDY_YEL, BUDDY_HEART, BUDDY_CYAN, BUDDY_WHITE, BUDDY_GREEN ];
  for (let i = 0; i < 6; i++) {
    const phase = (t * 2 + i * 11) % 22;
    const x = BUDDY_X_CENTER - 36 + i * 14;
    const y = BUDDY_Y_OVERLAY - 6 + phase;
    if (y > BUDDY_Y_BASE + 20 || y < 0) continue;
    buddySetColor(cols[i % 5]);
    buddySetCursor(x, y);
    buddyPrint((i + Math.floor(t / 2)) & 1 ? "*" : ".");
  }
}

// ─── DIZZY ───  ~5.6s cycle, 5 poses + orbiting stars
function doDizzy(t: number): void {
  const TILT_L = [ "            ", ".-o-OO-o-.  ", "(________)  ", "  |@   @|   ", "  |____|    " ];
  const TILT_R = [ "            ", "  .-o-OO-o-.", "  (________)", "    |@   @| ", "    |____|  " ];
  const WOOZY = [ "            ", " .~o-OO-o~. ", "(~~~~~~~~~~)", "   |x   @|  ", "   |~v~~|   " ];
  const WOOZY2 = [ "            ", " .~o-OO-o~. ", "(~~~~~~~~~~)", "   |@   x|  ", "   |~~v~|   " ];
  const STUMBLE = [ "            ", " .-o-OO-o-. ", "(__________)", "   |@   @|  ", " /-|_---_|\\ " ];

  const P = [ TILT_L, TILT_R, WOOZY, WOOZY2, STUMBLE ];
  const SEQ = [ 0,1,0,1, 2,3, 0,1,0,1, 4,4, 2,3 ];
  const X_SHIFT = [ -3,3,-3,3, 0,0, -3,3,-3,3, 0,0, 0,0 ];
  const beat = Math.floor(t / 4) % SEQ.length;
  buddyPrintSprite(P[SEQ[beat]], 5, 0, 0xF810, X_SHIFT[beat]);

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
  const DREAMY = [ "            ", " .-o-OO-o-. ", "(__________)", "   |^   ^|  ", "   |____|   " ];
  const BLUSH = [ "            ", " .-o-OO-o-. ", "(__________)", "  #|^   ^|# ", "   |____|   " ];
  const EYES_C = [ "            ", " .-O-oo-O-. ", "(__________)", "   |<3 <3|  ", "   |____|   " ];
  const TWIRL = [ "            ", " .-O-OO-O-. ", "(__________)", "   |@   @|  ", "  /|____|\\  " ];
  const SIGH = [ "            ", " .-o-OO-o-. ", "(__________)", "   |-   -|  ", "   |^^^^|   " ];

  const P = [ DREAMY, BLUSH, EYES_C, TWIRL, SIGH ];
  const SEQ = [
    0,0,1,0, 2,2,0, 1,0,4, 0,0,3,3, 0,1,0,2, 1,0
  ];
  const Y_BOB = [ 0,-1,0,-1, 0,-1,0, -1,0,0, -1,0,0,0, -1,0,-1,0, -1,0 ];
  const beat = Math.floor(t / 5) % SEQ.length;
  buddyPrintSprite(P[SEQ[beat]], 5, Y_BOB[beat], 0xF810);

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

export const MUSHROOM_SPECIES: Species = {
  name: "mushroom",
  bodyColor: 0xF810,
  states: [
    doSleep, doIdle, doBusy, doAttention,
    doCelebrate, doDizzy, doHeart,
  ],
};
