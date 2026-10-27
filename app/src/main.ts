// Boot: create the Display on #screen, attach input, run setup() then loop() at ~60 Hz.
// OWNER: loop+menus+stats agent.
import "./style.css";
import { Display } from "./hw/tft";
import { inputAttach } from "./hw/input";
import { attachRotation } from "./hw/platform";
import { dataInit } from "./data/source";
import { setDisplay } from "./app/state";
import { loop, setup } from "./app/loop";

async function main(): Promise<void> {
  const display = new Display(document.getElementById("screen") as HTMLCanvasElement, 2);
  setDisplay(display);
  attachRotation(display); // landscape clock turns the bezel sideways
  inputAttach(document.body);
  await dataInit();
  await setup();
  // setInterval, not requestAnimationFrame: rAF stops when the window is minimized,
  // and the pet keeps polling, napping and accumulating stats while hidden.
  setInterval(loop, 16);
}

main().catch((e) => console.error("hermes-buddy failed to start", e));
