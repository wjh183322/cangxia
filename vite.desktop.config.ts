import { resolve } from "node:path";
import { defineConfig } from "vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  root: resolve("desktop/ui-src"),
  base: "./",
  plugins: [viteReact(), tailwindcss()],
  resolve: {
    alias: { "@": resolve("src") },
  },
  build: {
    outDir: resolve("desktop/ui"),
    emptyOutDir: true,
    assetsDir: "assets",
  },
});
