/** Shared types for Vouch. The checker (SPEC 4.3) is the only authority on `Verdict`. */

export interface MenuItem {
  id: string;
  name: string;
  price: number;
  /** Ingredient ids. May be empty: an item with no ingredient data reads `unknown`, never `safe`. */
  ingredients: string[];
}

export interface Ingredient {
  id: string;
  name: string;
  /** Ids of ingredients (or allergens) this ingredient directly contains. */
  contains: string[];
}

export interface Restriction {
  id: string;
  name: string;
  /** Ingredient/allergen ids this restriction avoids. */
  avoid: string[];
}

export type Verdict = "safe" | "unsafe" | "unknown";

export interface Finding {
  item: string;
  verdict: Verdict;
  /** The exact ingredient and rule that decided it. Present unless safe. */
  because?: { ingredient: string; allergen: string; via: string[] };
}

export interface Menu {
  items: MenuItem[];
  /** Ingredient table keyed by ingredient id. */
  ingredients: Record<string, Ingredient>;
}
