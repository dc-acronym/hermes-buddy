#!/usr/bin/env node
// QA screenshot harness — OWNER: qa agent.
//
//   node tests/e2e/screenshots.mjs [--out=<subdir of tests/out>] [--only=gallery,demo,mock,nav,landscape,inject]
//                                   [--cells="info page 1,pet stats (defaults)" --zoom=3]   (extra zoomed crops of gallery cells)
//
// Starts its own Vite dev server on :5179 (tests/e2e/vite.qa.config.mjs: no watcher / HMR),
// drives headless Chromium through
//   (a) /gallery.html            -> gallery-full.png + one PNG per section + gallery-results.json
//   (b) /index.html?demo         -> demo-NN.png every 2 s for ~20 s (+ sheet)
//   (c) /index.html?mock=<json>  -> mock-attention-NN.png (pending terminal prompt)
//   (d) keyboard navigation in ?demo (and in a deterministic ?mock=) -> nav-*-NN-<step>.png
//   (f) landscape-*.png: clock locked to landscape, is it upright inside the turned bezel?
//   (g) inject-*.png: snapshots pushed into the running app (busy, prompt arriving over an open menu,
//       completion, level-up, disconnected) via the source.ts test hooks
//   (e) console.txt with every console error/warning, page error and failed request
// and exits 1 if anything errored (console/page errors, failed requests, gallery cells that
// threw). The dev server is always killed on exit. Output lands in tests/out/ (gitignored).

import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync, rmSync, readdirSync, statSync, createWriteStream } from "node:fs";
import { dirname, resolve, basename, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const here = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(here, "../..");
const PORT = 5179;
const BASE = `http://127.0.0.1:${PORT}`;

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? true] : [a, true];
  }),
);
const outDir = resolve(appDir, "tests/out", typeof args.out === "string" ? args.out : "");
const only = typeof args.only === "string" ? args.only.split(",") : null;
const want = (g) => only === null || only.includes(g);

mkdirSync(outDir, { recursive: true });
// Start each run clean, but only for the groups being re-run (so a partial run keeps the rest).
const PREFIXES = { gallery: ["gallery-"], demo: ["demo-"], mock: ["mock-"], nav: ["nav-"], landscape: ["landscape-"], inject: ["inject-"] };
for (const f of readdirSync(outDir)) {
  const mine = Object.entries(PREFIXES).some(([g, ps]) => want(g) && ps.some((p) => f.startsWith(p)));
  if (mine || ["console.txt", "report.json", "summary.txt", "vite.log"].includes(f)) rmSync(join(outDir, f), { force: true });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log("[qa]", ...a);

// ── dev server ──────────────────────────────────────────────────────────────
let vite = null;
function killVite() {
  if (!vite || vite.killed) return;
  try {
    process.kill(-vite.pid, "SIGTERM");
  } catch {}
  const pid = vite.pid;
  setTimeout(() => {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {}
  }, 1500).unref();
  vite.killed = true;
}
process.on("exit", killVite);
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(sig, () => {
    killVite();
    process.exit(130);
  });
}
process.on("uncaughtException", (e) => {
  console.error("[qa] uncaught", e);
  killVite();
  process.exit(2);
});

async function startVite() {
  const logStream = createWriteStream(join(outDir, "vite.log"));
  vite = spawn(
    "npx",
    ["vite", "--config", "tests/e2e/vite.qa.config.mjs", "--port", String(PORT), "--strictPort"],
    { cwd: appDir, detached: true, stdio: ["ignore", "pipe", "pipe"] },
  );
  vite.stdout.pipe(logStream);
  vite.stderr.pipe(logStream);
  let exited = null;
  vite.on("exit", (c) => (exited = c ?? -1));
  const t0 = Date.now();
  while (Date.now() - t0 < 60_000) {
    if (exited !== null) throw new Error(`vite exited early with code ${exited} (see ${join(outDir, "vite.log")})`);
    try {
      const r = await fetch(`${BASE}/`);
      if (r.ok) return;
    } catch {}
    await sleep(300);
  }
  throw new Error("vite did not come up within 60 s");
}

// ── console / error collection ─────────────────────────────────────────────
/** @type {{scenario:string, level:string, text:string}[]} */
const consoleLog = [];
function attach(page, scenario) {
  page.on("console", (m) => {
    const t = m.type();
    if (t === "error" || t === "warning" || t === "assert") {
      const loc = m.location();
      const where = loc?.url ? ` (${loc.url.replace(BASE, "")}:${loc.lineNumber})` : "";
      consoleLog.push({ scenario, level: t, text: m.text() + where });
    }
  });
  page.on("pageerror", (e) => consoleLog.push({ scenario, level: "pageerror", text: String(e.stack || e.message || e) }));
  page.on("requestfailed", (r) => {
    if (/favicon/.test(r.url())) return;
    consoleLog.push({ scenario, level: "requestfailed", text: `${r.method()} ${r.url().replace(BASE, "")} ${r.failure()?.errorText ?? ""}` });
  });
  page.on("response", (r) => {
    if (r.status() >= 400 && !/favicon/.test(r.url())) {
      consoleLog.push({ scenario, level: "http" + r.status(), text: r.url().replace(BASE, "") });
    }
  });
}

/** Vite's error overlay (syntax errors in a module another agent is mid-edit) would cover screenshots. */
async function hideOverlay(page, scenario) {
  const txt = await page
    .evaluate(() => {
      const o = document.querySelector("vite-error-overlay");
      return o ? (o.shadowRoot?.textContent ?? "overlay").slice(0, 600) : null;
    })
    .catch(() => null);
  if (txt) consoleLog.push({ scenario, level: "vite-overlay", text: txt.replace(/\s+/g, " ") });
  await page.addStyleTag({ content: "vite-error-overlay{display:none!important}" }).catch(() => {});
}

async function shot(page, name, opts = {}) {
  const file = join(outDir, name.endsWith(".png") ? name : `${name}.png`);
  await page.screenshot({ path: file, ...opts });
  return file;
}

/**
 * Fingerprint of the largest canvas on the page (downscaled copy, so the app's own canvas is
 * never read back directly): tells whether the screen changes over time and whether it is lit.
 */
async function canvasFingerprint(page) {
  return page
    .evaluate(() => {
      const cs = [...document.querySelectorAll("canvas")].sort((a, b) => b.width * b.height - a.width * a.height);
      const c = cs[0];
      if (!c) return "no-canvas";
      try {
        const off = document.createElement("canvas");
        off.width = 54;
        off.height = 96;
        const g = off.getContext("2d", { willReadFrequently: true });
        g.imageSmoothingEnabled = false;
        g.drawImage(c, 0, 0, off.width, off.height);
        const d = g.getImageData(0, 0, off.width, off.height).data;
        let h = 2166136261;
        let nz = 0;
        for (let i = 0; i < d.length; i += 4) {
          h = Math.imul(h ^ d[i] ^ (d[i + 1] << 8) ^ (d[i + 2] << 16), 16777619);
          if (d[i] | d[i + 1] | d[i + 2]) nz++;
        }
        return `${c.width}x${c.height}:${(h >>> 0).toString(16)}:lit=${nz}`;
      } catch (e) {
        return "unreadable:" + e.message;
      }
    })
    .catch((e) => "eval-failed:" + e.message);
}

async function contactSheet(browser, files, name, { cols = 5, w = 240 } = {}) {
  if (!files.length) return;
  const htmlPath = join(outDir, `${name}.sheet.html`);
  const cells = files
    .map((f) => `<figure style="margin:0"><img src="file://${f}" width="${w}" style="display:block;outline:1px solid #333"><figcaption>${basename(f, ".png")}</figcaption></figure>`)
    .join("");
  writeFileSync(
    htmlPath,
    `<!doctype html><meta charset=utf-8><body style="margin:0;padding:8px;background:#14161a;color:#9aa3ad;font:10px monospace;display:grid;grid-template-columns:repeat(${cols},max-content);gap:8px">${cells}</body>`,
  );
  const p = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  await p.goto("file://" + htmlPath);
  await p.waitForFunction(() => [...document.images].every((i) => i.complete), null, { timeout: 15000 }).catch(() => {});
  await p.screenshot({ path: join(outDir, `${name}.png`), fullPage: true });
  await p.close();
  rmSync(htmlPath, { force: true });
}

// ── scenarios ──────────────────────────────────────────────────────────────
const summary = { gallery: null, demo: null, mock: null, landscape: null, inject: null, nav: {} };

async function runGallery(browser) {
  const scenario = "gallery";
  const ctx = await browser.newContext({ viewport: { width: 1900, height: 1000 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  attach(page, scenario);
  await page.goto(`${BASE}/gallery.html`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__galleryReady === true, null, { timeout: 240_000, polling: 500 });
  await hideOverlay(page, scenario);

  const results = await page.evaluate(() => window.__galleryResults);
  const importErrors = await page.evaluate(() => window.__galleryImportErrors);
  const sections = await page.evaluate(() => window.__gallerySections);
  writeFileSync(join(outDir, "gallery-results.json"), JSON.stringify({ importErrors, results }, null, 1));

  for (const [k, v] of Object.entries(importErrors)) consoleLog.push({ scenario, level: "gallery-import", text: `${k}: ${v}` });
  for (const r of results) {
    if (r.status === "error") {
      consoleLog.push({ scenario, level: "gallery-cell", text: `[${r.section}] ${r.label}: ${r.error}`, key: (r.error || "").split("\n")[0] });
    }
  }

  // per-section PNGs
  const files = [];
  for (const s of sections) {
    try {
      const f = join(outDir, `gallery-${s.id}.png`);
      await page.locator(`section[data-section="${s.id}"]`).screenshot({ path: f });
      files.push(f);
    } catch (e) {
      consoleLog.push({ scenario, level: "screenshot", text: `section ${s.id}: ${e.message}` });
    }
  }
  // optional zoomed crops of individual cells (match on caption substring)
  if (typeof args.cells === "string") {
    const zoom = Number(args.zoom) || 3;
    let k = 0;
    for (const needle of args.cells.split(",")) {
      const figs = page.locator("figure.cell", { hasText: needle.trim() });
      const n = Math.min(await figs.count(), 4);
      for (let i = 0; i < n; i++) {
        const fig = figs.nth(i);
        await fig.evaluate((f, z) => {
          const c = f.querySelector("canvas");
          if (c) {
            c.style.width = (c.width / 2) * z + "px";
            c.style.height = (c.height / 2) * z + "px";
          }
          const cap = f.querySelector("figcaption");
          if (cap) cap.style.maxWidth = "none";
        }, zoom);
        const name = needle.trim().replace(/[^a-z0-9]+/gi, "_").slice(0, 40);
        await fig.screenshot({ path: join(outDir, `cell-${String(k++).padStart(2, "0")}-${name}.png`) });
      }
    }
  }
  // the whole page
  const dims = await page.evaluate(() => ({ w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight }));
  try {
    await page.screenshot({ path: join(outDir, "gallery-full.png"), fullPage: true });
  } catch (e) {
    consoleLog.push({ scenario, level: "screenshot", text: `gallery-full: ${e.message}` });
  }

  const isOverview = (r) => r.section.startsWith("species-overview");
  const byStatus = { ok: 0, blank: 0, error: 0 };
  /** @type {Record<string, {n:number, sections:Set<string>, sample:string}>} */
  const errs = {};
  for (const r of results) {
    if (isOverview(r)) continue; // overview cells repeat frames from the per-species sections
    byStatus[r.status]++;
    if (r.status === "error") {
      const key = (r.error || "").split("\n")[0].slice(0, 160);
      (errs[key] ??= { n: 0, sections: new Set(), sample: r.label }).n++;
      errs[key].sections.add(r.section.replace(/^species-.*/, "species-*"));
    }
  }
  const blanks = results.filter((r) => r.status === "blank" && !isOverview(r)).map((r) => `${r.section}: ${r.label}`);
  const statics = results.filter((r) => r.animated === false).map((r) => r.label);
  const lowVariety = results
    .filter((r) => r.distinct !== undefined && r.distinct <= 3)
    .sort((a, b) => a.distinct - b.distinct)
    .map((r) => `${r.label.replace(" 1x t=10", "")}: ${r.distinct}`);
  const below = results.filter((r) => r.inkBelowCrop).map((r) => r.label);
  const clipped1x = results.filter((r) => r.edgeClip && / 1x /.test(r.label)).map((r) => `${r.label}[${r.edgeClip}]`);
  const clipped2x = results.filter((r) => r.edgeClip && / 2x /.test(r.label));
  const clipped2xBySpecies = {};
  for (const r of clipped2x) (clipped2xBySpecies[r.label.split(" ")[0]] ??= []).push(r.label.split(" ")[1]);
  summary.gallery = {
    pageSize: dims,
    cells: results.filter((r) => !isOverview(r)).length,
    ...byStatus,
    importErrors,
    distinctErrors: Object.entries(errs)
      .sort((a, b) => b[1].n - a[1].n)
      .map(([msg, v]) => ({ msg, n: v.n, sections: [...v.sections], sample: v.sample })),
    blankCells: blanks,
    staticSpeciesCells: statics.length,
    inkBelowCropCells: below,
    lowVariety,
    clipped1x,
    clipped2xBySpecies,
  };
  writeFileSync(join(outDir, "gallery-static-cells.txt"), statics.join("\n") + "\n");
  await ctx.close();
}

const DEMO_VIEWPORT = { width: 480, height: 860 };

async function warmUp(browser) {
  // Let Vite discover + pre-bundle dependencies before anything is screenshotted.
  const p = await browser.newPage();
  for (const u of ["/index.html?demo", "/gallery.html?only=none"]) {
    await p.goto(BASE + u, { waitUntil: "load" }).catch(() => {});
    await sleep(1500);
  }
  await p.close();
}

async function runDemo(browser) {
  const scenario = "demo";
  const ctx = await browser.newContext({ viewport: DEMO_VIEWPORT, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  attach(page, scenario);
  await page.goto(`${BASE}/index.html?demo`, { waitUntil: "load" });
  await hideOverlay(page, scenario);
  const frames = [];
  const prints = [];
  // 10 frames 2 s apart (the ~20 s the brief asks for), then 4 more 4.5 s apart so the later
  // scenarios of the 40 s demo cycle (attention, completed) are caught too.
  const N = 14;
  for (let i = 0; i < N; i++) {
    await sleep(i === 0 ? 800 : i < 10 ? 2000 : 4500);
    frames.push(await shot(page, `demo-${String(i).padStart(2, "0")}`));
    prints.push(await canvasFingerprint(page));
  }
  await contactSheet(browser, frames, "demo-sheet", { cols: 7, w: 230 });
  summary.demo = { frames: N, distinctCanvasStates: new Set(prints).size, fingerprints: prints };
  await ctx.close();
}

function mockSnapshot(over = {}) {
  return {
    connected: true,
    error: null,
    dbPath: "/Users/friend/.hermes/state.db",
    schemaVersion: 7,
    sessionsTotal: 2,
    sessionsRunning: 1,
    sessionsWaiting: 1,
    recentlyCompleted: false,
    tokensToday: 128400,
    tokensLifetime: 4820000,
    msg: "waiting on terminal",
    lines: [
      "you: clean the build dir and reinstall dependencies",
      "hermes: sure, I'll remove node_modules and reinstall",
      "tool terminal rm -rf node_modules && npm install",
    ],
    lineGen: 1,
    prompt: { id: "call_9fK2xq", tool: "terminal", hint: "rm -rf node_modules && npm install" },
    model: "hermes-3-70b",
    polledAt: Date.now(),
    ...over,
  };
}

async function runMock(browser) {
  const scenario = "mock";
  const ctx = await browser.newContext({ viewport: DEMO_VIEWPORT, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  attach(page, scenario);
  const url = `${BASE}/index.html?mock=${encodeURIComponent(JSON.stringify(mockSnapshot()))}`;
  await page.goto(url, { waitUntil: "load" });
  await hideOverlay(page, scenario);
  const frames = [];
  const prints = [];
  for (let i = 0; i < 4; i++) {
    await sleep(i === 0 ? 1500 : 1800);
    frames.push(await shot(page, `mock-attention-${String(i).padStart(2, "0")}`));
    prints.push(await canvasFingerprint(page));
  }
  await contactSheet(browser, frames, "mock-attention-sheet", { cols: 4, w: 360 });
  summary.mock = { frames: frames.length, distinctCanvasStates: new Set(prints).size, fingerprints: prints };
  await ctx.close();
}

/** One keyboard-driven walk through screens, menus, settings, reset. */
async function runNav(browser, tag, url) {
  const scenario = `nav-${tag}`;
  const ctx = await browser.newContext({ viewport: DEMO_VIEWPORT, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  attach(page, scenario);
  await page.goto(url, { waitUntil: "load" });
  await hideOverlay(page, scenario);
  await sleep(1500);
  const files = [];
  const prints = [];
  let n = 0;
  const step = async (name, action, settle = 450) => {
    try {
      await action?.();
    } catch (e) {
      consoleLog.push({ scenario, level: "nav-step", text: `${name}: ${e.message}` });
    }
    await sleep(settle);
    files.push(await shot(page, `nav-${tag}-${String(n++).padStart(2, "0")}-${name}`));
    prints.push(await canvasFingerprint(page));
  };
  const tap = (key) => () => page.keyboard.press(key);
  const hold = (key, ms = 900) => async () => {
    await page.keyboard.down(key);
    await sleep(ms);
    await page.keyboard.up(key);
  };

  await step("home", null);
  await step("space-pet", tap("Space"));
  await step("enter-pet-1", tap("Enter"), 700);
  await step("enter-pet-2-ratelimited", tap("Enter"), 700);
  await step("space-info0", tap("Space"));
  for (const [i, nm] of ["buttons", "hermes", "device", "database", "credits"].entries()) {
    await step(`enter-info${i + 1}-${nm}`, tap("Enter"));
  }
  await step("enter-info0-wrap", tap("Enter"));
  await step("space-home", tap("Space"));
  await step("hold-esc-menu", hold("Escape"));
  await step("menu-space-turnoff", tap("Space"));
  await step("menu-space-help", tap("Space"));
  await step("menu-enter-help-info", tap("Enter"));
  await step("hold-esc-menu2", hold("Escape"));
  await step("menu2-space1", tap("Space"));
  await step("menu2-space2", tap("Space"));
  await step("menu2-space-about", tap("Space"));
  await step("menu2-enter-credits", tap("Enter"));
  await step("space-home2", tap("Space"));
  await step("space-home3", tap("Space")); // info -> normal wrap-around check
  await step("hold-esc-menu3", hold("Escape"));
  await step("menu3-enter-settings", tap("Enter"));
  for (let i = 1; i < 10; i++) await step(`settings-sel${i}`, tap("Space"));
  // wrap to 0 then toggle things
  await step("settings-sel0-wrap", tap("Space"));
  await step("settings-sel0-enter-bright", tap("Enter"));
  await step("settings-sel0-enter-bright2", tap("Enter"));
  for (let i = 3; i <= 5; i++) await step(`settings-sel0-enter-bright${i}-restore`, tap("Enter"));
  await step("settings-sel1-sound", tap("Space"));
  await step("settings-sound-toggle", tap("Enter"));
  await step("settings-sound-toggle-back", tap("Enter"));
  await step("settings-sel2-hermes", tap("Space"));
  await step("settings-sel2-enter-hermes", tap("Enter"));
  await step("settings-hermes-esc", tap("Escape"), 400);
  for (let i = 3; i <= 6; i++) await step(`settings-sel${i}-b`, tap("Space"));
  await step("settings-sel6-enter-clockrot", tap("Enter"));
  await step("settings-sel6-enter-clockrot2", tap("Enter"));
  await step("settings-sel6-enter-clockrot3", tap("Enter"));
  await step("settings-sel7-asciipet", tap("Space"));
  await step("settings-asciipet-next", tap("Enter"));
  await step("settings-asciipet-next2", tap("Enter"));
  await step("settings-sel8-reset", tap("Space"));
  await step("reset-open", tap("Enter"));
  await step("reset-sel1", tap("Space"));
  await step("reset-armed", tap("Enter"), 300);
  await step("reset-armed-unarm-space", tap("Space"));
  await step("reset-sel0-space", tap("Space"));
  await step("reset-sel0-armed", tap("Enter"), 300);
  await step("reset-sel0-wait3s", null, 3400);
  await step("reset-hold-esc-close", hold("Escape"));
  await step("settings-sel9-back", tap("Space"));
  await step("settings-back-enter", tap("Enter"));
  const click = (sel) => () => page.locator(sel).click({ timeout: 2000 });
  const mouseHold = (sel, ms = 900) => async () => {
    const box = await page.locator(sel).boundingBox();
    if (!box) throw new Error(`no ${sel}`);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await sleep(ms);
    await page.mouse.up();
  };
  await step("click-btnA", click("#btnA"));
  await step("click-btnB", click("#btnB"));
  await step("mousehold-btnA-menu", mouseHold("#btnA"));
  await step("click-btnA-menu-next", click("#btnA"));
  await step("mousehold-btnA-close", mouseHold("#btnA"));
  await step("power-off", tap("p"));
  await step("power-on", tap("p"));
  // letter keys + nap (document hidden) + energy refill
  const setHidden = (hidden) => () =>
    page.evaluate((h) => {
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (h ? "hidden" : "visible") });
      document.dispatchEvent(new Event("visibilitychange"));
    }, hidden);
  await step("key-a", tap("a"));
  await step("key-b", tap("b"));
  await step("hold-m-menu", hold("m"));
  await step("hold-m-close", hold("m"));
  await step("nap-hidden", setHidden(true), 1500);
  await step("nap-visible", setHidden(false), 900);
  await step("key-a-after-nap", tap("a"));
  await step("end", null);

  await contactSheet(browser, files, `nav-${tag}-sheet`, { cols: 8, w: 200 });
  summary.nav[tag] = { steps: files.length, distinctCanvasStates: new Set(prints).size };
  await ctx.close();
}

/** Real app with the clock locked to landscape: is the clock face upright inside the rotated bezel? */
async function runLandscape(browser) {
  const scenario = "landscape";
  const ctx = await browser.newContext({ viewport: { width: 700, height: 420 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem("hermes-buddy:settings", JSON.stringify({ sound: false, onTop: true, led: true, hud: true, clockRot: 2, bright: 4 }));
    } catch {}
  });
  const page = await ctx.newPage();
  attach(page, scenario);
  const idle = mockSnapshot({ sessionsRunning: 0, sessionsWaiting: 0, sessionsTotal: 0, msg: "idle", prompt: null, lines: [] });
  await page.goto(`${BASE}/index.html?mock=${encodeURIComponent(JSON.stringify(idle))}`, { waitUntil: "load" });
  await hideOverlay(page, scenario);
  const files = [];
  for (let i = 0; i < 3; i++) {
    await sleep(i === 0 ? 2500 : 1500);
    files.push(await shot(page, `landscape-${i}`));
  }
  const cls = await page.evaluate(() => document.body.className);
  summary.landscape = { bodyClass: cls, frames: files.length };
  await ctx.close();
}

/** Push snapshots into the running app (dev server: same module instance as the app) and watch it react. */
async function runInject(browser) {
  const scenario = "inject";
  const ctx = await browser.newContext({ viewport: DEMO_VIEWPORT, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  attach(page, scenario);
  const quiet = mockSnapshot({ sessionsRunning: 0, sessionsWaiting: 0, sessionsTotal: 1, msg: "idle", prompt: null, lines: [], tokensLifetime: 100000 });
  await page.goto(`${BASE}/index.html?mock=${encodeURIComponent(JSON.stringify(quiet))}`, { waitUntil: "load" });
  await hideOverlay(page, scenario);
  await sleep(1500);
  const files = [];
  const prints = [];
  let n = 0;
  const inject = (partial) =>
    page.evaluate(async (p) => {
      const src = await import("/src/data/source.ts");
      src.dataReset(); // also stops the mock's 10 s keep-alive, which would overwrite what we inject
      src.dataInject(src.mockSnapshot({ ...p, polledAt: Date.now() }));
    }, partial);
  const step = async (name, action, settle = 600) => {
    try {
      await action?.();
    } catch (e) {
      consoleLog.push({ scenario, level: "inject-step", text: `${name}: ${e.message}` });
    }
    await sleep(settle);
    files.push(await shot(page, `inject-${String(n++).padStart(2, "0")}-${name}`));
    prints.push(await canvasFingerprint(page));
  };
  const hold = (key, ms = 900) => async () => {
    await page.keyboard.down(key);
    await sleep(ms);
    await page.keyboard.up(key);
  };
  const lines4 = [
    "you: the poller drops rows when WAL checkpoints mid-read",
    "hermes: reading crates/hermes-watch/src/lib.rs",
    "tool read_file crates/hermes-watch/src/lib.rs (412 lines)",
    "hermes: switching to SQLITE_OPEN_READ_ONLY",
  ];
  await step("idle-clock", null, 300);
  await step("busy-3-sessions", () => inject({ sessionsRunning: 3, sessionsTotal: 3, msg: "editing lib.rs", lines: lines4, lineGen: 2, tokensLifetime: 100500 }), 900);
  await step("busy-later", null, 900);
  await step("menu-open", hold("Escape"));
  await step("settings-open", () => page.keyboard.press("Enter"));
  await step("prompt-arrives-over-settings", () =>
    inject({ sessionsRunning: 1, sessionsWaiting: 1, msg: "waiting", lines: lines4, lineGen: 2, prompt: { id: "call_inj1", tool: "clarify", hint: "Deploy to staging or production?" }, tokensLifetime: 101000 }), 900);
  await step("prompt-later", null, 1500);
  await step("prompt-answered-completed", () => inject({ sessionsRunning: 0, sessionsWaiting: 0, recentlyCompleted: true, msg: "idle", lines: lines4, lineGen: 3, tokensLifetime: 102000 }), 900);
  await step("completed-later", () => inject({ sessionsRunning: 0, sessionsWaiting: 0, recentlyCompleted: false, msg: "idle", lines: lines4, lineGen: 3, tokensLifetime: 102000 }), 1500);
  await step("level-up", () => inject({ sessionsRunning: 1, msg: "editing lib.rs", lines: lines4, lineGen: 3, tokensLifetime: 165000 }), 800);
  await step("level-up-later", null, 1200);
  await step("pet-page-after-levelup", () => page.keyboard.press("Space"), 500);
  await step("pet-b-press", () => page.keyboard.press("Enter"), 700);
  await step("pet-to-info-to-home", async () => {
    await page.keyboard.press("Space");
    await sleep(150);
    await page.keyboard.press("Space");
  }, 500);
  await step("disconnected", () => inject({ connected: false, error: "state.db not found at /Users/friend/.hermes/state.db", sessionsRunning: 0, sessionsTotal: 0, msg: "", lines: [], lineGen: 4, schemaVersion: null }), 900);
  await step("disconnected-info", async () => {
    for (const k of ["Space", "Space", "Enter", "Enter", "Enter", "Enter"]) {
      await page.keyboard.press(k); // home -> pet -> info ABOUT, then B x4 -> DATABASE
      await sleep(120);
    }
  }, 600);
  await step("back-home", () => page.keyboard.press("Space"), 600);
  await contactSheet(browser, files, "inject-sheet", { cols: 8, w: 200 });
  summary.inject = { steps: files.length, distinctCanvasStates: new Set(prints).size };
  await ctx.close();
}

// ── main ───────────────────────────────────────────────────────────────────
let exitCode = 0;
let browser = null;
try {
  log(`output -> ${outDir}`);
  await startVite();
  log(`vite up on ${BASE}`);
  browser = await chromium.launch();
  await warmUp(browser);

  const runs = [
    ["gallery", () => runGallery(browser)],
    ["demo", () => runDemo(browser)],
    ["mock", () => runMock(browser)],
    ["nav", async () => {
      await runNav(browser, "demo", `${BASE}/index.html?demo`);
      const quiet = mockSnapshot({
        sessionsWaiting: 0,
        sessionsRunning: 2,
        msg: "editing lib.rs",
        prompt: null,
        lines: [
          "you: the poller drops rows when WAL checkpoints mid-read, can you take a look",
          "hermes: reading crates/hermes-watch/src/lib.rs",
          "tool read_file crates/hermes-watch/src/lib.rs (412 lines)",
          "hermes: the query opens read-write; switching to SQLITE_OPEN_READ_ONLY",
        ],
      });
      await runNav(browser, "mock", `${BASE}/index.html?mock=${encodeURIComponent(JSON.stringify(quiet))}`);
    }],
  ];
  runs.push(["landscape", () => runLandscape(browser)]);
  runs.push(["inject", () => runInject(browser)]);
  for (const [name, fn] of runs) {
    if (!want(name)) continue;
    log(`running ${name} ...`);
    try {
      await fn();
    } catch (e) {
      consoleLog.push({ scenario: name, level: "harness", text: String(e.stack || e) });
      log(`${name} FAILED: ${e.message}`);
    }
  }
} catch (e) {
  consoleLog.push({ scenario: "setup", level: "harness", text: String(e.stack || e) });
  log("setup failed:", e.message);
} finally {
  try {
    await browser?.close();
  } catch {}
  killVite();
}

// ── reports ────────────────────────────────────────────────────────────────
const isErr = (e) => e.level !== "warning";
const errors = consoleLog.filter(isErr);
const lines = consoleLog.map((e) => `[${e.scenario}] ${e.level.toUpperCase()}: ${e.text}`);
writeFileSync(join(outDir, "console.txt"), lines.length ? lines.join("\n") + "\n" : "(no console errors, warnings, page errors or failed requests)\n");
writeFileSync(join(outDir, "report.json"), JSON.stringify({ summary, errorCount: errors.length, warningCount: consoleLog.length - errors.length }, (k, v) => (v instanceof Set ? [...v] : v), 1));

const out = [];
out.push(`outputs: ${outDir}`);
if (summary.gallery) {
  const g = summary.gallery;
  out.push(`gallery: ${g.cells} cells -> ${g.ok} ok, ${g.blank} blank, ${g.error} error (page ${g.pageSize.w}x${g.pageSize.h}; ${g.staticSpeciesCells} species cells identical across ticks)`);
  for (const [k, v] of Object.entries(g.importErrors)) out.push(`  IMPORT FAILED ${k}: ${v}`);
  for (const d of g.distinctErrors.slice(0, 12)) out.push(`  x${d.n} ${d.msg}   e.g. '${d.sample}' in ${d.sections.join(",")}`);
  for (const b of g.blankCells.slice(0, 12)) out.push(`  blank: ${b}`);
  if (g.lowVariety.length) out.push(`  species/state with <=3 distinct frames over 80 ticks (${g.lowVariety.length}): ${g.lowVariety.slice(0, 14).join("; ")}`);
  if (g.inkBelowCropCells.length) out.push(`  ink below the shown crop (gallery crop too short): ${g.inkBelowCropCells.slice(0, 8).join("; ")}`);
  if (g.clipped1x.length) out.push(`  1x art touching a screen edge (${g.clipped1x.length}): ${g.clipped1x.slice(0, 8).join("; ")}`);
  const cs = Object.entries(g.clipped2xBySpecies);
  if (cs.length) out.push(`  2x home art touching a screen edge: ${cs.map(([k, v]) => `${k}(${[...new Set(v)].join("/")})`).join(", ")}`);
}
if (summary.demo) out.push(`demo: ${summary.demo.frames} frames, ${summary.demo.distinctCanvasStates} distinct canvas states`);
if (summary.mock) out.push(`mock: ${summary.mock.frames} frames, ${summary.mock.distinctCanvasStates} distinct canvas states`);
if (summary.inject) out.push(`inject: ${summary.inject.steps} steps, ${summary.inject.distinctCanvasStates} distinct canvas states`);
if (summary.landscape) out.push(`landscape: body class '${summary.landscape.bodyClass}' (see landscape-*.png: is the clock upright?)`);
for (const [k, v] of Object.entries(summary.nav)) out.push(`nav-${k}: ${v.steps} steps, ${v.distinctCanvasStates} distinct canvas states`);
out.push(`console: ${errors.length} errors, ${consoleLog.length - errors.length} warnings (see console.txt)`);
const byMsg = new Map();
for (const e of errors) {
  const k = `${e.level}: ${(e.key ?? e.text.split("\n")[0]).slice(0, 170)}`;
  byMsg.set(k, (byMsg.get(k) ?? 0) + 1);
}
for (const [k, n] of [...byMsg].sort((a, b) => b[1] - a[1]).slice(0, 15)) out.push(`  x${n} ${k}`);
writeFileSync(join(outDir, "summary.txt"), out.join("\n") + "\n");
console.log(out.join("\n"));
exitCode = errors.length ? 1 : 0;
process.exit(exitCode);
