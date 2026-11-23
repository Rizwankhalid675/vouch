// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, test } from "vitest";
import { MENU } from "../src/safety/canon.ts";
import { mountShop } from "../src/site/shop.ts";

const html = readFileSync(resolve(process.cwd(), "src/site/index.html"), "utf8");
const $ = (s: string) => document.querySelector<HTMLElement>(s);
const $$ = (s: string) => [...document.querySelectorAll<HTMLElement>(s)];
const click = (el: Element | null) => (el as HTMLElement).click();

beforeEach(() => {
  document.documentElement.innerHTML = html;
  mountShop(document);
});

describe("the deli site, no agent", () => {
  test("every menu item renders with name, price and a visible ingredient list", () => {
    expect($$("[data-item]")).toHaveLength(MENU.items.length);
    const reuben = $("[data-item='reuben']")!;
    expect(reuben.textContent).toContain("Reuben");
    expect(reuben.textContent).toContain("$11.50");
    const ing = reuben.querySelector("[data-ingredients]")!.textContent!;
    expect(ing).toContain("Rye bread");
    expect(ing).toContain("Swiss cheese");
    expect(ing).toContain("Russian dressing");
  });

  test("an item with no ingredient data says so rather than showing an empty list", () => {
    const t = $("[data-item='daily_special'] [data-ingredients]")!.textContent!;
    expect(t.toLowerCase()).toContain("not listed");
  });

  test("each item has an empty verdict slot, independent of any chat", () => {
    const slots = $$("[data-verdict-slot]");
    expect(slots).toHaveLength(MENU.items.length);
    expect(slots[0]!.getAttribute("data-verdict-slot")).toBe(MENU.items[0]!.id);
    expect(slots[0]!.children).toHaveLength(0);
  });

  test("cart adds, increments, decrements and removes", () => {
    click($("[data-item='reuben'] [data-add]"));
    click($("[data-item='reuben'] [data-add]"));
    click($("[data-item='lemonade'] [data-add]"));
    expect($$("[data-cart-line]")).toHaveLength(2);
    expect($("[data-cart-total]")!.textContent).toContain("$26.50");
    click($("[data-cart-line='reuben'] [data-dec]"));
    expect($("[data-cart-total]")!.textContent).toContain("$15.00");
    click($("[data-cart-line='lemonade'] [data-remove]"));
    expect($$("[data-cart-line]")).toHaveLength(1);
    click($("[data-cart-line='reuben'] [data-dec]"));
    expect($$("[data-cart-line]")).toHaveLength(0);
    expect($("[data-cart-empty]")!.hasAttribute("hidden")).toBe(false);
  });

  test("demo checkout confirms the order and clears the cart", () => {
    click($("[data-item='tomato_soup'] [data-add]"));
    click($("[data-checkout]"));
    const c = $("[data-confirmation]")!;
    expect(c.hasAttribute("hidden")).toBe(false);
    expect(c.textContent).toContain("Tomato soup");
    expect(c.textContent!.toLowerCase()).toContain("demo");
    expect($$("[data-cart-line]")).toHaveLength(0);
  });

  test("checkout with an empty cart does nothing", () => {
    click($("[data-checkout]"));
    expect($("[data-confirmation]")!.hasAttribute("hidden")).toBe(true);
  });

  test("nothing agent-related exists in the DOM", () => {
    expect(document.querySelector("[data-agent]")).toBeNull();
  });
});
