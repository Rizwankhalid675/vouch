import type { Menu } from "../../contracts.ts";
import { menuHtml } from "./shop.ts";

/**
 * Fill the [data-menu] grid of index.html with the rendered menu, so the page reads with scripts off.
 * The replacement is a function: menu text contains "$" (prices), which a string replacement would treat as a group reference.
 */
export function prerender(html: string, menu: Menu): string {
  return html.replace(/(<div class="grid" data-menu>)[\s\S]*?(<\/div>\s*<\/section>)/, (_m, open: string, close: string) => `${open}\n${menuHtml(menu)}\n      ${close}`);
}
