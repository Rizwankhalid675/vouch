import { describe, expect, test } from "vitest";
import raw from "../data/menu.json";
import { loadMenu } from "../src/safety/menu";

describe("menu data", () => {
  test("every ingredient referenced by an item exists in the ingredient table", () => {
    const menu = loadMenu(raw);
    const missing = menu.items.flatMap((i) => i.ingredients.filter((x) => !menu.ingredients[x]));
    expect(missing).toEqual([]);
  });

  test("every ingredient referenced by another ingredient exists in the table", () => {
    const menu = loadMenu(raw);
    const missing = Object.values(menu.ingredients).flatMap((g) =>
      g.contains.filter((x) => !menu.ingredients[x]),
    );
    expect(missing).toEqual([]);
  });

  test("an item may declare no ingredients, and that is not an error", () => {
    expect(() =>
      loadMenu({ ...raw, items: [{ id: "x", name: "Special", price: 5, ingredients: [] }] }),
    ).not.toThrow();
  });

  test("the shipped menu has at least 24 items and one with no ingredients", () => {
    const menu = loadMenu(raw);
    expect(menu.items.length).toBeGreaterThanOrEqual(24);
    expect(menu.items.some((i) => i.ingredients.length === 0)).toBe(true);
  });

  test("brioche_bun reaches dairy through exactly brioche -> butter -> dairy", () => {
    const menu = loadMenu(raw);
    expect(menu.ingredients["brioche_bun"]?.contains).toContain("brioche");
    expect(menu.ingredients["brioche"]?.contains).toContain("butter");
    expect(menu.ingredients["butter"]?.contains).toContain("dairy");
    expect(menu.ingredients["brioche_bun"]?.contains).not.toContain("dairy");
    expect(menu.ingredients["brioche"]?.contains).not.toContain("dairy");
  });

  test("ids are snake_case and unique", () => {
    const menu = loadMenu(raw);
    const ids = [...menu.items.map((i) => i.id), ...Object.keys(menu.ingredients)];
    expect(ids.filter((x) => !/^[a-z][a-z0-9]*(_[a-z0-9]+)*$/.test(x))).toEqual([]);
    expect(new Set(menu.items.map((i) => i.id)).size).toBe(menu.items.length);
  });
});

describe("loadMenu rejects malformed input", () => {
  test.each([
    ["null", null],
    ["a string", "menu"],
    ["no items", { ingredients: {} }],
    ["item without a price", { items: [{ id: "a", name: "A", ingredients: [] }], ingredients: {} }],
    ["item with unknown ingredient", { items: [{ id: "a", name: "A", price: 1, ingredients: ["ghost"] }], ingredients: {} }],
    ["ingredients not an array on item", { items: [{ id: "a", name: "A", price: 1, ingredients: "x" }], ingredients: {} }],
    ["ingredient key mismatching its id", { items: [], ingredients: { a: { id: "b", name: "B", contains: [] } } }],
    ["ingredient contains unknown id", { items: [], ingredients: { a: { id: "a", name: "A", contains: ["ghost"] } } }],
  ])("%s", (_label, input) => {
    expect(() => loadMenu(input)).toThrow();
  });
});
