import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

function electronHtml(): Plugin {
  return {
    name: "cangxia-electron-html",
    transformIndexHtml(html) {
      return html.replace(/\s+crossorigin(?:="[^"]*")?/g, "");
    },
  };
}

export default defineConfig({
  root: resolve("desktop/ui-src"),
  base: "./",
  plugins: [viteReact(), tailwindcss(), electronHtml()],
  resolve: {
    alias: { "@": resolve("src") },
  },
  build: {
    outDir: resolve("desktop/ui"),
    emptyOutDir: true,
    assetsDir: "assets",
    modulePreload: false,
  },
});
