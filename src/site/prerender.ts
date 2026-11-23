import type { Menu } from "../../contracts.ts";
import { menuHtml } from "./shop.ts";

/**
 * Fill the [data-menu] grid of index.html with the rendered menu, so the page reads with scripts off.
 * The replacement is a function: menu text contains "$" (prices), which a string replacement would treat as a group reference.
 */
export function prerender(html: string, menu: Menu): string {
  const pattern = /(<div class="grid" data-menu>)[\s\S]*?(<\/div>\s*<\/section>)/;
  if (!pattern.test(html)) throw new Error("prerender: the [data-menu] grid was not found in index.html; refusing to ship an empty menu");
  const rendered = menuHtml(menu);
  const count = rendered.split("data-item=").length - 1;
  if (count === 0 || count !== menu.items.length) {
    throw new Error(`prerender: rendered ${count} items for a menu of ${menu.items.length}; refusing to ship it`);
  }
  return html.replace(pattern, (_m, open: string, close: string) => `${open}\n${rendered}\n      ${close}`);
}
