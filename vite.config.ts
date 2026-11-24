import { defineConfig, type Plugin } from "vite";
import { MENU } from "./src/safety/canon.ts";
import { prerender } from "./src/site/prerender.ts";

/** Prerender the menu into the static HTML so the page reads, ingredients and all, with scripts off. */
const prerenderMenu: Plugin = {
  name: "prerender-menu",
  transformIndexHtml: (html) => prerender(html, MENU),
};

export default defineConfig({
  root: "src/site",
  base: "./",
  // The three conformance artifacts (§3.3) live in /public and are copied to the site root.
  publicDir: "../../public",
  build: { outDir: "../../dist", emptyOutDir: true },
  plugins: [prerenderMenu],
});
