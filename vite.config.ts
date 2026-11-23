import { defineConfig, type Plugin } from "vite";
import { MENU } from "./src/safety/canon.ts";
import { menuHtml } from "./src/site/shop.ts";

/** Prerender the menu into the static HTML so the page reads, ingredients and all, with scripts off. */
const prerenderMenu: Plugin = {
  name: "prerender-menu",
  transformIndexHtml(html) {
    return html.replace(/(<div class="grid" data-menu>)[\s\S]*?(<\/div>\s*<\/section>)/, `$1\n${menuHtml(MENU)}\n      $2`);
  },
};

export default defineConfig({
  root: "src/site",
  base: "./",
  build: { outDir: "../../dist", emptyOutDir: true },
  plugins: [prerenderMenu],
});
