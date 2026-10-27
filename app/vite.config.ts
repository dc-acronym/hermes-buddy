import { defineConfig } from "vite";

// Tauri expects a fixed dev port and no host clearing of the terminal.
export default defineConfig({
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  // gallery.html is a dev/test page (served by `vite`), not part of the app bundle.
  build: { target: "es2022" },
  test: { globals: true, environment: "jsdom", include: ["tests/**/*.test.ts"] },
});
