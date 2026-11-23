import type { Ingredient, Menu, MenuItem } from "../../contracts";

function fail(msg: string): never {
  throw new Error(`Malformed menu: ${msg}`);
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function stringArray(x: unknown, where: string): string[] {
  if (!Array.isArray(x) || x.some((s) => typeof s !== "string")) fail(`${where} must be an array of strings`);
  return x as string[];
}

/** Validate untrusted JSON into a Menu. Throws on any malformed or dangling reference. */
export function loadMenu(json: unknown): Menu {
  if (!isRecord(json)) fail("expected an object");
  if (!Array.isArray(json.items)) fail("`items` must be an array");
  if (!isRecord(json.ingredients)) fail("`ingredients` must be an object keyed by ingredient id");

  const ingredients: Record<string, Ingredient> = {};
  for (const [key, v] of Object.entries(json.ingredients)) {
    if (!isRecord(v)) fail(`ingredient "${key}" must be an object`);
    if (typeof v.id !== "string" || v.id !== key) fail(`ingredient "${key}" must have a matching id`);
    if (typeof v.name !== "string") fail(`ingredient "${key}" needs a name`);
    if (v.contentsUnknown !== undefined && v.contentsUnknown !== true) {
      fail(`ingredient "${key}".contentsUnknown must be true or absent`);
    }
    const ing: Ingredient = { id: v.id, name: v.name, contains: stringArray(v.contains, `ingredient "${key}".contains`) };
    if (v.contentsUnknown === true) ing.contentsUnknown = true;
    ingredients[key] = ing;
  }
  for (const ing of Object.values(ingredients)) {
    for (const c of ing.contains) {
      if (!Object.hasOwn(ingredients, c)) fail(`ingredient "${ing.id}" contains unknown ingredient "${c}"`);
    }
  }

  const seen = new Set<string>();
  const items: MenuItem[] = json.items.map((v: unknown, n: number) => {
    if (!isRecord(v)) fail(`item #${n} must be an object`);
    if (typeof v.id !== "string" || v.id === "") fail(`item #${n} needs an id`);
    if (seen.has(v.id)) fail(`duplicate item id "${v.id}"`);
    seen.add(v.id);
    if (typeof v.name !== "string") fail(`item "${v.id}" needs a name`);
    if (typeof v.price !== "number" || !Number.isFinite(v.price) || v.price < 0) fail(`item "${v.id}" needs a price`);
    const ids = stringArray(v.ingredients, `item "${v.id}".ingredients`);
    for (const x of ids) {
      if (!Object.hasOwn(ingredients, x)) fail(`item "${v.id}" references unknown ingredient "${x}"`);
    }
    return { id: v.id, name: v.name, price: v.price, ingredients: ids };
  });

  return { items, ingredients };
}
