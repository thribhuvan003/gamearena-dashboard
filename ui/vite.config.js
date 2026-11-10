// Build settings for the page. Vite's defaults are used, with one warning silenced.
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    rollupOptions: {
      onwarn(warning, warn) {
        // TanStack Query marks its files "use client" for server-rendered React. This page is
        // rendered only in the browser, so the marker means nothing here and is safe to drop.
        if (warning.code === "MODULE_LEVEL_DIRECTIVE") return;
        warn(warning);
      },
    },
  },
});
