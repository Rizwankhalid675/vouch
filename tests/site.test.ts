// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, test } from "vitest";
import type { Menu } from "../contracts.ts";
import { MENU, RESTRICTIONS } from "../src/safety/canon.ts";
import { verdictFor } from "../src/safety/verdict.ts";
import { containsLine, mountShop } from "../src/site/shop.ts";
import { prerender } from "../src/site/prerender.ts";

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

describe("derived allergens are disclosed on the page", () => {
  test("turkey club discloses dairy, which is only derived (brioche -> butter -> dairy)", () => {
    const t = document.querySelector("[data-item='turkey_club'] [data-contains]")!.textContent!.toLowerCase();
    expect(t).toContain("dairy");
    expect(t).toContain("gluten");
    expect(t).toContain("egg");
    expect(t).toContain("pork");
  });

  test("chili chicken plate discloses the unknown component", () => {
    const t = document.querySelector("[data-item='chili_chicken_plate'] [data-contains]")!.textContent!.toLowerCase();
    expect(t).toContain("unknown");
    expect(t).toContain("supplier chili sauce");
  });

  test("an item with no ingredient data says contents unknown", () => {
    const t = document.querySelector("[data-item='daily_special'] [data-contains]")!.textContent!.toLowerCase();
    expect(t).toContain("unknown");
  });

  test("every card carries a Contains line", () => {
    expect(document.querySelectorAll("[data-contains]")).toHaveLength(MENU.items.length);
  });
});

describe("the prerendered page (what a no-script reader gets)", () => {
  test("prices survive the build step intact, and every card carries ingredients and Contains", async () => {
    const { prerender } = await import("../src/site/prerender.ts");
    const out = prerender(html, MENU);
    const doc = new DOMParser().parseFromString(out, "text/html");
    expect(doc.querySelectorAll("[data-item]")).toHaveLength(MENU.items.length);
    expect(doc.querySelector("[data-item='reuben'] .price")!.textContent).toBe("$11.50");
    expect(doc.querySelector("[data-item='lemonade'] .price")!.textContent).toBe("$3.50");
    expect(doc.querySelector("[data-item='turkey_club'] [data-contains]")!.textContent!.toLowerCase()).toContain("dairy");
    expect(doc.querySelector("aside.cart")).not.toBeNull();
  });
});

describe("hydration keeps what is already on the page", () => {
  test("content placed in a verdict slot survives a later mountShop call", () => {
    const slot = document.querySelector("[data-verdict-slot='reuben']")!;
    const mark = document.createElement("div");
    mark.setAttribute("data-test-verdict", "x");
    slot.appendChild(mark);
    mountShop(document);
    expect(document.querySelector("[data-verdict-slot='reuben'] [data-test-verdict]")).toBe(mark);
  });

  test("a first mount over a prerendered page keeps content already in a slot", () => {
    document.documentElement.innerHTML = prerender(html, MENU);
    const mark = document.createElement("div");
    document.querySelector("[data-verdict-slot='lemonade']")!.appendChild(mark);
    mountShop(document);
    expect(document.querySelector("[data-verdict-slot='lemonade']")!.firstChild).toBe(mark);
  });

  test("a second mount does not double-bind the cart", () => {
    mountShop(document);
    click($("[data-item='lemonade'] [data-add]"));
    expect($("[data-cart-line='lemonade'] [data-qty]")!.textContent).toBe("1");
  });
});

describe("prerender refuses to ship a broken menu", () => {
  test("throws when the grid markup is not found", () => {
    expect(() => prerender("<html><body><div class='grid'></div></body></html>", MENU)).toThrow(/not found/);
  });
  test("throws when the menu renders zero items", () => {
    expect(() => prerender(html, { items: [], ingredients: MENU.ingredients })).toThrow(/0 items/);
  });
});

describe("the Contains line says something true about each kind of gap", () => {
  const menu: Menu = {
    items: [
      { id: "a", name: "A", price: 1, ingredients: ["sauce"] },
      { id: "b", name: "B", price: 1, ingredients: ["ghost"] },
    ],
    ingredients: { sauce: { id: "sauce", name: "Sauce", contains: [], contentsUnknown: true } },
  };
  test("a contentsUnknown ingredient keeps the supplier wording", () => {
    expect(containsLine(menu.items[0]!, menu)).toContain("sauce has no published ingredient list");
  });
  test("an id absent from the table is not blamed on a supplier and shows no raw id", () => {
    const t = containsLine(menu.items[1]!, menu);
    expect(t).toContain("an ingredient we have no record of");
    expect(t).not.toContain("published");
    expect(t).not.toContain("ghost");
  });
});

describe("mustard is tracked, so a hidden mustard is disclosed", () => {
  test("potato salad (mustard only via potato_salad_mix) names mustard", () => {
    expect($("[data-item='potato_salad'] [data-contains]")!.textContent!.toLowerCase()).toContain("mustard");
  });
  test("pastrami on rye names mustard", () => {
    expect($("[data-item='pastrami_on_rye'] [data-contains]")!.textContent!.toLowerCase()).toContain("mustard");
  });
});

describe("the card and the checker agree (parity)", () => {
  test("for every item and restriction, Contains matches verdictFor", () => {
    for (const item of MENU.items) {
      const text = containsLine(item, MENU).toLowerCase();
      for (const r of RESTRICTIONS) {
        const f = verdictFor(item, [r], MENU);
        if (f.verdict === "unsafe") {
          const name = (MENU.ingredients[f.because!.allergen]?.name ?? f.because!.allergen).toLowerCase();
          expect(text, `${item.id} / ${r.id}`).toContain(name);
        } else if (f.verdict === "unknown") {
          expect(text, `${item.id} / ${r.id}`).toContain("unknown");
        }
      }
    }
  });
});
