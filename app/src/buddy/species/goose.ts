// Port of src/buddies/goose.cpp (anthropics/claude-desktop-buddy), 1:1.
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
  BUDDY_RED,
  BUDDY_WHITE,
  BUDDY_X_CENTER,
  BUDDY_YEL,
  BUDDY_Y_BASE,
  BUDDY_Y_OVERLAY,
  type Species,
} from "../common";

// ─── SLEEP ───  ~12s cycle, 6 poses, head tucked under wing
function doSleep(t: number): void {
  const TUCK = [ "            ", "    __      ", "   /  \\__   ", "  (  zz  )  ", "   `~~~~`   " ];
  const BREATHE = [ "            ", "    __      ", "   /  \\__   ", "  (  --  )  ", "   `~~~~`   " ];
  const SNORE = [ "    o O .   ", "    __      ", "   /  \\__   ", "  (  --  )  ", "   `~~~~`   " ];
  const PEEK = [ "            ", "    _o      ", "   /  \\__   ", "  (  --  )  ", "   `~~~~`   " ];
  const SHIFT = [ "            ", "      __    ", "   __/  \\   ", "  (  zz  )  ", "   `~~~~`   " ];
  const HONK_DR = [ "    HnK..   ", "    __      ", "   /  \\__   ", "  (  zZ  )  ", "   `~~~~`   " ];

  const P = [ TUCK, BREATHE, SNORE, PEEK, SHIFT, HONK_DR ];
  const SEQ = [
    0,1,0,1,0,1,2,1,
    0,1,0,3,
    4,4,4,1,
    0,1,2,2,
    0,1,5,1
  ];
  const beat = Math.floor(t / 5) % SEQ.length;
  buddyPrintSprite(P[SEQ[beat]], 5, 0, 0xFFFF);

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

// ─── IDLE ───  ~14s cycle, 10 poses, swaggering goose
function doIdle(t: number): void {
  const STAND = [ "            ", "    (>      ", "    ||      ", "  _(__)_    ", "   ^^^^     " ];
  const LOOK_L = [ "            ", "  <)        ", "   ||       ", "  _(__)_    ", "   ^^^^     " ];
  const LOOK_R = [ "            ", "      (>    ", "      ||    ", "  _(__)_    ", "   ^^^^     " ];
  const LOOK_U = [ "    /\\      ", "    (>      ", "    ||      ", "  _(__)_    ", "   ^^^^     " ];
  const BLINK = [ "            ", "    (->     ", "    ||      ", "  _(__)_    ", "   ^^^^     " ];
  const PREEN = [ "            ", "    (v      ", "    |\\__    ", "  _(__)_    ", "   ^^^^     " ];
  const PECK = [ "            ", "            ", "    (>      ", "    || _    ", "  _(__)_    " ];
  const STEP_L = [ "            ", "    (>      ", "    ||      ", "  _(__)_    ", "   ^/ ^     " ];
  const STEP_R = [ "            ", "    (>      ", "    ||      ", "  _(__)_    ", "   ^ \\^     " ];
  const WING_FL = [ "            ", "    (>      ", " <==||==>   ", "  _(__)_    ", "   ^^^^     " ];

  const P = [ STAND, LOOK_L, LOOK_R, LOOK_U, BLINK, PREEN, PECK, STEP_L, STEP_R, WING_FL ];
  const SEQ = [
    0,0,4,0,1,0,2,0,
    7,8,7,8,
    0,0,3,0,4,
    5,5,0,
    6,6,0,0,
    9,9,0,4,0
  ];
  const beat = Math.floor(t / 5) % SEQ.length;
  buddyPrintSprite(P[SEQ[beat]], 5, 0, 0xFFFF);
}

// ─── BUSY ───  ~10s cycle, 6 poses + honk ticker
function doBusy(t: number): void {
  const PATROL_A = [ "            ", "    (>      ", " <==||==>   ", "  _(__)_    ", "   /^ ^\\    " ];
  const PATROL_B = [ "            ", "    (>      ", "  =-||-=    ", "  _(__)_    ", "   ^/ \\^    " ];
  const CHARGE = [ "            ", "      (>>   ", "    _||_    ", "   (___)    ", "   //\\\\     " ];
  const PECK_DN = [ "            ", "            ", "    \\v_     ", "  _(__)_    ", "   ^^^^     " ];
  const HISS = [ "    sss     ", "    (>>>    ", "    ||      ", "  _(__)_    ", "   ^^^^     " ];
  const STOMP = [ "            ", "    (>      ", "  /=||=\\    ", "  _(__)_    ", "  >^^  ^^<  " ];

  const P = [ PATROL_A, PATROL_B, CHARGE, PECK_DN, HISS, STOMP ];
  const SEQ = [
    0,1,0,1,0,1, 3,3, 0,1,0,1, 2,2, 4,4, 0,1, 5,5,0
  ];
  const beat = Math.floor(t / 5) % SEQ.length;
  buddyPrintSprite(P[SEQ[beat]], 5, 0, 0xFFFF);

  const HONKS = [ "h  ", "ho ", "hon", "onk", "nk!", "k! ", "!  ", "   " ];
  buddySetColor(BUDDY_YEL);
  buddySetCursor(BUDDY_X_CENTER + 22, BUDDY_Y_OVERLAY + 14);
  buddyPrint(HONKS[t % 8]);
}

// ─── ATTENTION ───  ~8s cycle, 6 poses + ! pulse + HONK overlay
function doAttention(t: number): void {
  const ALERT = [ "    HONK!   ", "     (>>    ", "     ||     ", "   _(__)_   ", "    ^^^^    " ];
  const SCAN_L = [ "    HONK!   ", "  <<)       ", "    ||      ", "   _(__)_   ", "    ^^^^    " ];
  const SCAN_R = [ "    HONK!   ", "       (>>  ", "      ||    ", "   _(__)_   ", "    ^^^^    " ];
  const RAISE = [ "   HONK!!   ", " <===(>>===>", "     ||     ", "   _(__)_   ", "    ^^^^    " ];
  const LUNGE = [ "  HONK!!!   ", "       (>>> ", "      _||_  ", "    _(__)_  ", "    /^^^\\   " ];
  const GLARE = [ "    HONK!   ", "    (-->    ", "    ||      ", "  _(__)_    ", "  /^ ^^ ^\\  " ];

  const P = [ ALERT, SCAN_L, SCAN_R, RAISE, LUNGE, GLARE ];
  const SEQ = [
    0,3,0,1,0,2,0,3, 4,4,0,1,2,0, 5,0
  ];
  const beat = Math.floor(t / 5) % SEQ.length;
  const pose = SEQ[beat];
  const xOff = (pose === 4) ? ((t & 1) ? 2 : -2) : ((pose === 3) ? ((t & 1) ? 1 : -1) : 0);
  buddyPrintSprite(P[pose], 5, 0, 0xFFFF, xOff);

  if (Math.floor(t / 2) & 1) {
    buddySetColor(BUDDY_RED);
    buddySetCursor(BUDDY_X_CENTER - 6, BUDDY_Y_OVERLAY);
    buddyPrint("!");
  }
  if (Math.floor(t / 3) & 1) {
    buddySetColor(BUDDY_YEL);
    buddySetCursor(BUDDY_X_CENTER + 6, BUDDY_Y_OVERLAY + 4);
    buddyPrint("!");
  }
  if (Math.floor(t / 4) & 1) {
    buddySetColor(BUDDY_RED);
    buddySetCursor(BUDDY_X_CENTER + 14, BUDDY_Y_OVERLAY + 8);
    buddyPrint("!");
  }
}

// ─── CELEBRATE ───  ~5.6s cycle, 6 poses + confetti rain + HONK
function doCelebrate(t: number): void {
  const CROUCH = [ "            ", "    (>      ", "   _||_     ", "  (____)    ", "   ^^^^     " ];
  const JUMP = [ "  HONK!     ", "    (>>     ", " <==||==>   ", "  _(__)_    ", "   /  \\     " ];
  const PEAK = [ " *HONK!HONK*", "    (^^>    ", "<===||===>  ", "  _(__)_    ", "   /  \\     " ];
  const SPIN_L = [ "            ", "  <)        ", "<==||        ", "  _(__)_    ", "   ^^^^     " ];
  const SPIN_R = [ "            ", "       (>   ", "       ||==>", "  _(__)_    ", "   ^^^^     " ];
  const POSE = [ "    \\o/     ", "    (>>     ", " <==||==>   ", " _(____)_   ", "   /^^\\     " ];

  const P = [ CROUCH, JUMP, PEAK, SPIN_L, SPIN_R, POSE ];
  const SEQ = [ 0,1,2,1,0, 3,4,3,4, 0,1,2,1,0, 5,5 ];
  const Y_SHIFT = [ 0,-3,-7,-3,0, 0,0,0,0, 0,-3,-7,-3,0, 0,0 ];
  const beat = Math.floor(t / 3) % SEQ.length;
  buddyPrintSprite(P[SEQ[beat]], 5, Y_SHIFT[beat], 0xFFFF);

  const cols = [ BUDDY_YEL, BUDDY_HEART, BUDDY_CYAN, BUDDY_WHITE, BUDDY_GREEN ];
  for (let i = 0; i < 7; i++) {
    const phase = (t * 2 + i * 9) % 22;
    const x = BUDDY_X_CENTER - 40 + i * 12;
    const y = BUDDY_Y_OVERLAY - 6 + phase;
    if (y > BUDDY_Y_BASE + 20 || y < 0) continue;
    buddySetColor(cols[i % 5]);
    buddySetCursor(x, y);
    buddyPrint((i + Math.floor(t / 2)) & 1 ? "*" : "o");
  }
}

// ─── DIZZY ───  ~5.6s cycle, 5 poses + orbiting stars
function doDizzy(t: number): void {
  const TILT_L = [ "            ", "   (x       ", "   ||\\      ", "  _(__)_    ", "   v^^v     " ];
  const TILT_R = [ "            ", "       x)   ", "      /||   ", "    _(__)_  ", "     v^^v   " ];
  const WOOZY = [ "            ", "    (@      ", "    ||~     ", "  _(__)_    ", "    ~vv~    " ];
  const WOOZY2 = [ "            ", "    @)      ", "   ~||      ", "  _(__)_    ", "    ~vv~    " ];
  const STUMBLE = [ "            ", "    (X      ", "    /\\      ", " _(____)_   ", "  v^v  v^v  " ];

  const P = [ TILT_L, TILT_R, WOOZY, WOOZY2, STUMBLE ];
  const SEQ = [ 0,1,0,1, 2,3, 0,1,0,1, 4,4, 2,3 ];
  const X_SHIFT = [ -3,3,-3,3, 0,0, -3,3,-3,3, 0,0, 0,0 ];
  const beat = Math.floor(t / 4) % SEQ.length;
  buddyPrintSprite(P[SEQ[beat]], 5, 0, 0xFFFF, X_SHIFT[beat]);

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
  buddySetColor(BUDDY_PURPLE);
  buddySetCursor(BUDDY_X_CENTER + OX[p3] - 2, BUDDY_Y_OVERLAY + 6 + OY[p3]);
  buddyPrint("+");
}

// ─── HEART ───  ~10s cycle, 5 poses + rising heart stream
function doHeart(t: number): void {
  const DREAMY = [ "            ", "    (^>     ", "    ||      ", "  _(__)_    ", "   ^^^^     " ];
  const BLUSH = [ "            ", "   #(^>#    ", "    ||      ", "  _(__)_    ", "   ^^^^     " ];
  const EYES_C = [ "            ", "    (<3>    ", "    ||      ", "  _(__)_    ", "   ^^^^     " ];
  const TWIRL = [ "            ", "    (@>     ", " <==||==>   ", "  _(__)_    ", "   ^^^^     " ];
  const SIGH = [ "    ~~~     ", "    (->     ", "    ||      ", "  _(__)_    ", "   ^^^^     " ];

  const P = [ DREAMY, BLUSH, EYES_C, TWIRL, SIGH ];
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

export const GOOSE_SPECIES: Species = {
  name: "goose",
  bodyColor: 0xFFFF,
  states: [
    doSleep, doIdle, doBusy, doAttention,
    doCelebrate, doDizzy, doHeart,
  ],
};
