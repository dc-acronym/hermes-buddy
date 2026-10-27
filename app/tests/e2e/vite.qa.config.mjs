// Vite config used only by tests/e2e/screenshots.mjs (QA agent).
// Same app, but: fixed port 5179, no file watcher / HMR (so another agent saving a file
// mid-run cannot full-reload a page we are screenshotting), deps pre-bundled up front.
import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  root: fileURLToPath(new URL("../..", import.meta.url)),
  clearScreen: false,
  server: { port: 5179, strictPort: true, host: "127.0.0.1", hmr: false, watch: null },
  optimizeDeps: { include: ["gifuct-js"] },
});
