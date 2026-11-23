import type { Restriction } from "../../contracts";

/**
 * The allergen ids the checker can speak to: the union of every restriction's `avoid` list.
 * The one vocabulary shared by the checker's coverage and the site's "Contains" line.
 */
export function trackedAllergens(restrictions: Restriction[]): Set<string> {
  return new Set(restrictions.flatMap((r) => r.avoid));
}
