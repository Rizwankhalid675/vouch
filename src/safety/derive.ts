import type { Menu } from "../../contracts";

export interface Reached {
  /** Id of a node reachable from the start (the start itself included). */
  allergen: string;
  /** Path from the start ingredient to `allergen`, inclusive at both ends. */
  via: string[];
}

/**
 * Every id reachable from `ingredient` through `contains`, breadth-first, so each
 * is reported with a shortest path and in a stable order. Cycle-safe. Ids absent
 * from the table are reported (they are reachable) but not expanded. Pure.
 */
export function allergensOf(ingredient: string, menu: Menu): Reached[] {
  const out: Reached[] = [];
  const seen = new Set<string>([ingredient]);
  let frontier: string[][] = [[ingredient]];
  while (frontier.length > 0) {
    const next: string[][] = [];
    for (const via of frontier) {
      const id = via[via.length - 1]!;
      out.push({ allergen: id, via });
      const node = Object.hasOwn(menu.ingredients, id) ? menu.ingredients[id] : undefined;
      for (const c of node?.contains ?? []) {
        if (seen.has(c)) continue;
        seen.add(c);
        next.push([...via, c]);
      }
    }
    frontier = next;
  }
  return out;
}

/**
 * The first place beneath `ingredient` where the data runs out: an ingredient
 * flagged `contentsUnknown`, or an id missing from the table. Pure.
 */
export function firstGap(ingredient: string, menu: Menu): Reached | undefined {
  for (const r of allergensOf(ingredient, menu)) {
    if (!Object.hasOwn(menu.ingredients, r.allergen) || menu.ingredients[r.allergen]!.contentsUnknown === true) return r;
  }
  return undefined;
}
