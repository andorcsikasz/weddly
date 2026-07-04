import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@shared": fileURLToPath(new URL("../shared", import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:8787",
        changeOrigin: true,
      },
      // Uploaded files (cover photos, moodboard images, listing heroes) are
      // served by the backend at /uploads/*. Without this the dev server (5173)
      // 404s them — they only worked in prod where one origin serves both — so
      // a couple's cover photo showed a broken-image icon in the editor preview.
      "/uploads": {
        target: "http://localhost:8787",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
    // No production source maps. `true` emitted a .js.map next to every
    // bundle plus a `//# sourceMappingURL=` comment, so the backend (which
    // serves frontend/dist statically) handed anyone with DevTools a full
    // reconstruction of our original TypeScript. There's no Sentry sourcemap
    // upload wired up, so the maps bought us nothing — they only leaked source.
    // Dev debugging is unaffected: the Vite dev server maps via native ESM,
    // independent of this build-only flag.
    sourcemap: false,
    rollupOptions: {
      output: {
        // Split heavy third-party deps into named vendor chunks so a
        // landing-page visitor doesn't download 800KB of React + router +
        // icon font on first paint. The chunks land in the browser cache
        // and survive across deploys when the SPA changes but the deps
        // don't — pure-SPA navigations under /app/* keep the cached
        // vendor chunks alive. Tuned against the a11y/perf-critic agent's
        // 768KB root-chunk finding.
        // Function form because the static-object form misses sub-paths
        // (react/jsx-runtime, scheduler) that the array entries don't
        // enumerate exhaustively. Path-prefix matches catch every file
        // resolved out of the named node_modules directory.
        manualChunks(id) {
          // Locale chunks come first — they're heavy (~160KB each) and need
          // to ship as separate files so the i18n layer can dynamic-import
          // HU only when a non-EN-default visitor flips the language.
          // Returning explicit chunk names ensures Vite emits them as
          // hu-*.js / en-*.js even when the import looks eager (the
          // prerender script imports both at build time, which would
          // otherwise inline them into the main chunk).
          if (id.includes("/src/locales/hu.ts")) return "locale-hu";
          if (id.includes("/src/locales/en.ts")) return "locale-en";

          if (!id.includes("node_modules")) return undefined;
          // React core + scheduler — never changes for our visitors and is
          // the single biggest fixed cost.
          if (
            id.includes("/node_modules/react/") ||
            id.includes("/node_modules/react-dom/") ||
            id.includes("/node_modules/scheduler/")
          ) {
            return "vendor-react";
          }
          if (id.includes("/node_modules/react-router")) return "vendor-router";
          if (id.includes("/node_modules/lucide-react/")) return "vendor-lucide";
          return undefined;
        },
      },
    },
  },
});
