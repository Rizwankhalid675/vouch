import type { Finding, Menu, MenuItem, Restriction } from "../../contracts";
import { allergensOf, firstGap } from "./derive.ts";

/**
 * The only authority on whether food is safe. Pure: no clock, network, model or I/O.
 *
 * Precedence: unsafe > unknown > safe. A definite hazard outranks an uncertainty;
 * `safe` is returned only when every ingredient is fully known and none matches.
 */
export function verdictFor(item: MenuItem, restrictions: Restriction[], menu: Menu): Finding {
  // 1. A definite hazard wins. Earliest ingredient, then earliest restriction/avoid entry.
  for (const ing of item.ingredients) {
    const reached = allergensOf(ing, menu);
    for (const rs of restrictions) {
      for (const a of rs.avoid) {
        const hit = reached.find((r) => r.allergen === a);
        if (hit) return { item: item.id, verdict: "unsafe", because: { ingredient: ing, allergen: a, via: hit.via } };
      }
    }
  }

  // 2. Missing data is never safe.
  if (item.ingredients.length === 0) {
    return { item: item.id, verdict: "unknown", because: { ingredient: item.id, allergen: "unknown", via: [item.id] } };
  }
  for (const ing of item.ingredients) {
    const gap = firstGap(ing, menu);
    if (gap) {
      return { item: item.id, verdict: "unknown", because: { ingredient: gap.allergen, allergen: "unknown", via: gap.via } };
    }
  }

  return { item: item.id, verdict: "safe" };
}
