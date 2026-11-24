import type { Menu, Restriction } from "../../contracts";

function fail(msg: string): never {
  throw new Error(`Malformed restrictions: ${msg}`);
}

/**
 * Validate untrusted JSON into Restriction[]. Every `avoid` id must exist in the
 * menu's ingredient table: a restriction naming something the kitchen has never
 * heard of would silently match nothing.
 */
export function loadRestrictions(json: unknown, menu: Menu): Restriction[] {
  if (!Array.isArray(json)) fail("expected an array");
  const seen = new Set<string>();
  return json.map((v: unknown, n: number) => {
    if (typeof v !== "object" || v === null || Array.isArray(v)) fail(`restriction #${n} must be an object`);
    const r = v as Record<string, unknown>;
    if (typeof r.id !== "string" || r.id === "") fail(`restriction #${n} needs an id`);
    if (seen.has(r.id)) fail(`duplicate restriction id "${r.id}"`);
    seen.add(r.id);
    if (typeof r.name !== "string") fail(`restriction "${r.id}" needs a name`);
    if (!Array.isArray(r.avoid) || r.avoid.length === 0 || r.avoid.some((s) => typeof s !== "string")) {
      fail(`restriction "${r.id}".avoid must be a non-empty array of strings`);
    }
    const avoid = r.avoid as string[];
    for (const a of avoid) {
      if (!Object.hasOwn(menu.ingredients, a)) fail(`restriction "${r.id}" avoids "${a}", which is not in the ingredient table`);
    }
    return { id: r.id, name: r.name, avoid };
  });
}
