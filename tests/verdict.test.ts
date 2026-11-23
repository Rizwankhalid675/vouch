import { describe, expect, test } from "vitest";
import raw from "../data/menu.json" with { type: "json" };
import type { Menu, MenuItem, Restriction } from "../contracts";
import { loadMenu } from "../src/safety/menu";
import { allergensOf } from "../src/safety/derive";
import { verdictFor } from "../src/safety/verdict";
import { loadRestrictions } from "../src/safety/restrictions";
import { RESTRICTIONS } from "../src/safety/canon";

const menu = loadMenu(raw);
const item = (id: string): MenuItem => {
  const i = menu.items.find((x) => x.id === id);
  if (!i) throw new Error(`no item ${id}`);
  return i;
};
const byId = (id: string): Restriction => {
  const x = RESTRICTIONS.find((q) => q.id === id);
  if (!x) throw new Error(`no restriction ${id}`);
  return x;
};
const dairyFree = byId("dairy_free");
const sesameFree = byId("sesame_free");
const r = (id: string, ...avoid: string[]): Restriction => ({ id, name: id, avoid });



describe("verdictFor", () => {
  test("an item with no ingredient data is unknown, never safe", () => {
    const f = verdictFor(item("daily_special"), [dairyFree], menu);
    expect(f.verdict).toBe("unknown");
    expect(f.because).toBeDefined();
  });

  test("a restriction the menu has never seen does not make everything safe", () => {
    const all = menu.items.map((i) => verdictFor(i, [sesameFree], menu));
    expect(all.every((f) => f.verdict === "safe")).toBe(false);
    const alien = menu.items.map((i) => verdictFor(i, [r("kiwi_free", "kiwi")], menu));
    expect(alien.some((f) => f.verdict === "safe")).toBe(true); // fully-known items stay safe
    expect(alien.find((f) => f.item === "daily_special")?.verdict).toBe("unknown");
  });

  test("a derived allergen names every hop that led to it", () => {
    const f = verdictFor(item("turkey_club"), [dairyFree], menu);
    expect(f.verdict).toBe("unsafe");
    expect(f.because?.via).toEqual(["brioche_bun", "brioche", "butter", "dairy"]);
    expect(f.because?.ingredient).toBe("brioche_bun");
    expect(f.because?.allergen).toBe("dairy");
  });

  test("an unsafe finding names the earliest matching ingredient", () => {
    const f = verdictFor(item("chocolate_chip_cookie"), [r("x", "dairy", "egg")], menu);
    expect(f.verdict).toBe("unsafe");
    expect(f.because?.ingredient).toBe("butter"); // butter precedes egg in the item
  });

  test("an item reaching a contentsUnknown ingredient with no known allergen is unknown, never safe", () => {
    for (const rs of [[dairyFree], RESTRICTIONS, []]) {
      const f = verdictFor(item("chili_chicken_plate"), rs, menu);
      expect(f.verdict).toBe("unknown");
      expect(f.because?.ingredient).toBe("supplier_chili_sauce");
    }
    expect(verdictFor(item("glazed_donut"), [r("sesame_free", "sesame")], menu).verdict).toBe("unknown");
  });

  test("a contentsUnknown ingredient nested deep is still found", () => {
    const m: Menu = {
      items: [{ id: "x", name: "X", price: 1, ingredients: ["a"] }],
      ingredients: {
        a: { id: "a", name: "A", contains: ["b"] },
        b: { id: "b", name: "B", contains: ["c"] },
        c: { id: "c", name: "C", contains: [], contentsUnknown: true },
        dairy: { id: "dairy", name: "Dairy", contains: [] },
      },
    };
    const f = verdictFor(m.items[0]!, [dairyFree], m);
    expect(f.verdict).toBe("unknown");
    expect(f.because?.via).toEqual(["a", "b", "c"]);
  });

  test("unsafe outranks unknown when an item is both", () => {
    const m: Menu = {
      items: [{ id: "x", name: "X", price: 1, ingredients: ["mystery", "cheese"] }],
      ingredients: {
        mystery: { id: "mystery", name: "M", contains: [], contentsUnknown: true },
        cheese: { id: "cheese", name: "C", contains: ["dairy"] },
        dairy: { id: "dairy", name: "Dairy", contains: [] },
      },
    };
    const f = verdictFor(m.items[0]!, [dairyFree], m);
    expect(f.verdict).toBe("unsafe");
    expect(f.because?.via).toEqual(["cheese", "dairy"]);
  });

  test("an ingredient absent from the table makes the item unknown", () => {
    const m: Menu = { items: [], ingredients: {} };
    const f = verdictFor({ id: "x", name: "X", price: 1, ingredients: ["ghost"] }, [dairyFree], m);
    expect(f.verdict).toBe("unknown");
  });

  test("a dangling reference inside contains makes the item unknown", () => {
    const m: Menu = {
      items: [],
      ingredients: { a: { id: "a", name: "A", contains: ["ghost"] } },
    };
    expect(verdictFor({ id: "x", name: "X", price: 1, ingredients: ["a"] }, [dairyFree], m).verdict).toBe("unknown");
  });

  test("a fully known item with no matching allergen is safe", () => {
    const f = verdictFor(item("fruit_cup"), [dairyFree], menu);
    expect(f.verdict).toBe("safe");
    expect(f.because).toBeUndefined();
  });

  test("an item is checked against every restriction in the set", () => {
    expect(verdictFor(item("fruit_cup"), [dairyFree, sesameFree], menu).verdict).toBe("safe");
    expect(verdictFor(item("lox_bagel"), [dairyFree, sesameFree], menu).verdict).toBe("unsafe");
  });

  test("cycles in contains terminate", () => {
    const m: Menu = {
      items: [],
      ingredients: {
        a: { id: "a", name: "A", contains: ["b"] },
        b: { id: "b", name: "B", contains: ["a", "dairy"] },
        dairy: { id: "dairy", name: "Dairy", contains: [] },
      },
    };
    const f = verdictFor({ id: "x", name: "X", price: 1, ingredients: ["a"] }, [dairyFree], m);
    expect(f.verdict).toBe("unsafe");
    expect(f.because?.via).toEqual(["a", "b", "dairy"]);
  });

  test("safe findings carry no because; unsafe and unknown always do", () => {
    for (const i of menu.items)
      for (const rs of RESTRICTIONS) {
        const f = verdictFor(i, [rs], menu);
        expect(f.item).toBe(i.id);
        if (f.verdict === "safe") expect(f.because).toBeUndefined();
        else {
          expect(f.because).toBeDefined();
          expect(f.because!.via.length).toBeGreaterThan(0);
        }
      }
  });

  test("is pure: same input twice gives equal output and does not mutate the menu", () => {
    const before = JSON.stringify(menu);
    const a = verdictFor(item("turkey_club"), RESTRICTIONS, menu);
    const b = verdictFor(item("turkey_club"), RESTRICTIONS, menu);
    expect(a).toEqual(b);
    expect(JSON.stringify(menu)).toBe(before);
  });

  test("the whole menu against every restriction never throws, never undefined, and never says safe past an unknown", () => {
    const reachesUnknown = (ids: string[], seen = new Set<string>()): boolean =>
      ids.some((id) => {
        if (seen.has(id)) return false;
        seen.add(id);
        const g = menu.ingredients[id];
        return !g || g.contentsUnknown === true || reachesUnknown(g.contains, seen);
      });
    let combos = 0;
    for (const i of menu.items)
      for (const rs of RESTRICTIONS) {
        const f = verdictFor(i, [rs], menu);
        combos++;
        expect(["safe", "unsafe", "unknown"]).toContain(f.verdict);
        if (i.ingredients.length === 0 || reachesUnknown(i.ingredients)) {
          expect(f.verdict).not.toBe("safe");
        }
        if (f.verdict === "unsafe") expect(rs.avoid).toContain(f.because!.allergen);
      }
    expect(combos).toBe(menu.items.length * RESTRICTIONS.length);
    expect(combos).toBeGreaterThanOrEqual(24 * 9);
  });
});

describe("allergensOf", () => {
  test("returns every reachable allergen with its full path", () => {
    const found = allergensOf("brioche_bun", menu);
    const dairy = found.find((a) => a.allergen === "dairy");
    expect(dairy?.via).toEqual(["brioche_bun", "brioche", "butter", "dairy"]);
    expect(found.map((a) => a.allergen)).toEqual(expect.arrayContaining(["dairy", "egg", "gluten"]));
  });

  test("an ingredient with nothing beneath it yields no allergens", () => {
    expect(allergensOf("lettuce", menu).filter((a) => a.allergen !== "lettuce")).toEqual([]);
  });

  test("an id absent from the table is reported as itself, not expanded, and does not throw", () => {
    expect(allergensOf("ghost", menu)).toEqual([{ allergen: "ghost", via: ["ghost"] }]);
  });
});

describe("restrictions data", () => {
  test("the canonical set loads, is non-empty and has unique ids", () => {
    expect(RESTRICTIONS.length).toBeGreaterThanOrEqual(9);
    expect(new Set(RESTRICTIONS.map((x) => x.id)).size).toBe(RESTRICTIONS.length);
  });

  test("the set exercises the data: at least one restriction nothing violates, at least one many items violate", () => {
    const unsafeCount = (rs: Restriction) => menu.items.filter((i) => verdictFor(i, [rs], menu).verdict === "unsafe").length;
    expect(unsafeCount(byId("shellfish_free"))).toBe(0);
    expect(RESTRICTIONS.some((x) => unsafeCount(x) >= 5)).toBe(true);
    // the clean path: some item is genuinely safe for shellfish-free
    expect(menu.items.some((i) => verdictFor(i, [byId("shellfish_free")], menu).verdict === "safe")).toBe(true);
  });

  test("loadRestrictions throws when an avoid id is not in the ingredient table", () => {
    expect(() => loadRestrictions([{ id: "k", name: "K", avoid: ["kiwi"] }], menu)).toThrow(/kiwi/);
  });

  test.each([
    ["not an array", {}],
    ["empty avoid", [{ id: "a", name: "A", avoid: [] }]],
    ["duplicate id", [{ id: "a", name: "A", avoid: ["dairy"] }, { id: "a", name: "A", avoid: ["egg"] }]],
    ["missing name", [{ id: "a", avoid: ["dairy"] }]],
  ])("loadRestrictions rejects %s", (_l, input) => {
    expect(() => loadRestrictions(input, menu)).toThrow();
  });
});
