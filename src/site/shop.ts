import type { Menu, MenuItem } from "../../contracts.ts";
import { MENU } from "../safety/canon.ts";

/** Money is handled in integer cents so totals never drift. */
const cents = (price: number): number => Math.round(price * 100);
export const fmt = (c: number): string => `$${(c / 100).toFixed(2)}`;

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Plain-language ingredient names, exactly the list the safety checker reasons over. */
export function ingredientNames(item: MenuItem, menu: Menu): string[] {
  return item.ingredients.map((id) => menu.ingredients[id]?.name ?? id);
}

/** One menu card. Pure string, so the build can prerender it and the page reads without JS. */
export function itemHtml(item: MenuItem, menu: Menu): string {
  const names = ingredientNames(item, menu);
  const ingredients =
    names.length > 0
      ? `<span class="label">Ingredients</span> ${names.map(esc).join(", ")}`
      : `<span class="label">Ingredients</span> <em>Not listed. Ask at the counter.</em>`;
  return `<article class="item" data-item="${esc(item.id)}">
  <div class="item-head">
    <h3>${esc(item.name)}</h3>
    <span class="price">${fmt(cents(item.price))}</span>
  </div>
  <p class="ingredients" data-ingredients>${ingredients}</p>
  <!-- Per-item verdict mount point. Filled by the verdict display, never by chat prose. -->
  <div class="verdict-slot" data-verdict-slot="${esc(item.id)}"></div>
  <button type="button" class="add" data-add>Add to order</button>
</article>`;
}

export function menuHtml(menu: Menu): string {
  return menu.items.map((i) => itemHtml(i, menu)).join("\n");
}

export interface Shop {
  /** id -> quantity. Read-only view for later tasks. */
  cart(): ReadonlyMap<string, number>;
}

/** Wire the menu and cart into a document that carries the markup of index.html. */
export function mountShop(doc: Document, menu: Menu = MENU): Shop {
  const q = (sel: string): HTMLElement => {
    const el = doc.querySelector<HTMLElement>(sel);
    if (!el) throw new Error(`index.html is missing ${sel}`);
    return el;
  };
  const menuEl = q("[data-menu]");
  const linesEl = q("[data-cart-lines]");
  const emptyEl = q("[data-cart-empty]");
  const totalEl = q("[data-cart-total]");
  const countEl = q("[data-cart-count]");
  const checkoutEl = q("[data-checkout]") as HTMLButtonElement;
  const confirmEl = q("[data-confirmation]");

  const byId = new Map(menu.items.map((i) => [i.id, i]));
  const cart = new Map<string, number>();
  let orderNo = 0;

  menuEl.innerHTML = menuHtml(menu);

  function render(): void {
    let total = 0;
    let count = 0;
    const rows: string[] = [];
    for (const [id, qty] of cart) {
      const item = byId.get(id);
      if (!item) continue;
      const line = cents(item.price) * qty;
      total += line;
      count += qty;
      rows.push(`<li class="line" data-cart-line="${esc(id)}">
  <span class="line-name">${esc(item.name)}</span>
  <span class="line-total">${fmt(line)}</span>
  <span class="qty">
    <button type="button" data-dec aria-label="One fewer ${esc(item.name)}">&minus;</button>
    <span data-qty>${qty}</span>
    <button type="button" data-inc aria-label="One more ${esc(item.name)}">+</button>
  </span>
  <button type="button" class="remove" data-remove aria-label="Remove ${esc(item.name)}">Remove</button>
</li>`);
    }
    linesEl.innerHTML = rows.join("");
    emptyEl.toggleAttribute("hidden", cart.size > 0);
    totalEl.textContent = fmt(total);
    countEl.textContent = String(count);
    checkoutEl.disabled = cart.size === 0;
  }

  function change(id: string, delta: number): void {
    const next = (cart.get(id) ?? 0) + delta;
    if (next <= 0) cart.delete(id);
    else cart.set(id, next);
    confirmEl.setAttribute("hidden", "");
    render();
  }

  menuEl.addEventListener("click", (e) => {
    const t = (e.target as HTMLElement).closest("[data-add]");
    const id = t?.closest<HTMLElement>("[data-item]")?.dataset["item"];
    if (id) change(id, 1);
  });

  linesEl.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    const id = t.closest<HTMLElement>("[data-cart-line]")?.dataset["cartLine"];
    if (!id) return;
    if (t.closest("[data-inc]")) change(id, 1);
    else if (t.closest("[data-dec]")) change(id, -1);
    else if (t.closest("[data-remove]")) change(id, -(cart.get(id) ?? 0));
  });

  checkoutEl.addEventListener("click", () => {
    if (cart.size === 0) return;
    orderNo += 1;
    let total = 0;
    const lines: string[] = [];
    for (const [id, qty] of cart) {
      const item = byId.get(id);
      if (!item) continue;
      total += cents(item.price) * qty;
      lines.push(`<li>${qty} &times; ${esc(item.name)}</li>`);
    }
    confirmEl.innerHTML = `<h3>Order #${100 + orderNo} is in. Thank you.</h3>
<ul>${lines.join("")}</ul>
<p>Total ${fmt(total)}. This is a demo: no payment was taken and no food is being made.</p>`;
    confirmEl.removeAttribute("hidden");
    cart.clear();
    render();
  });

  render();
  return { cart: () => cart };
}

// Browser entry: index.html carries [data-menu]; tests mount explicitly instead.
if (typeof document !== "undefined" && document.querySelector("[data-menu]")) {
  mountShop(document);
}
