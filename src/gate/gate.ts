import type { Finding, Menu } from "../../contracts.ts";
import { MENU } from "../safety/canon.ts";
import type { Claim } from "./claims.ts";
import { classifySegment, derivation, segments } from "./claims.ts";

/**
 * Shown in place of a withheld sentence. Must never itself read as a claim
 * (the gate is idempotent); a test pins that. The claim's text is deliberately
 * NOT echoed here: refusals[] carries it, so no unverified assertion is rendered.
 */
export const REFUSAL_MARKER = "[A claim here was withheld; see the ingredient list.]";

export type RefusalReason = "no_finding" | "unknown" | "unsafe" | "item_unresolved" | "ingredient_subject" | "not_checked" | "not_derivable";

export interface Refusal {
  /** The phrase that made the sentence a safety claim, e.g. "dairy-free". */
  claimed: string;
  /** First item the claim was about, if it could be resolved. */
  item?: string;
  items: string[];
  /** The withheld sentence, verbatim. For the UI's refusal panel, never for the page body. */
  sentence: string;
  reason: RefusalReason;
  /** Human-readable why. */
  why: string;
}

const WHY: Record<RefusalReason, string> = {
  no_finding: "No checker finding backs this claim.",
  unknown: "The checker could not determine this item's safety (missing ingredient data), so it cannot be called safe.",
  unsafe: "The checker found a conflict for this item.",
  item_unresolved: "The claim does not clearly name a menu item, so no finding can back it.",
  not_checked: "This claim was not checked: the checker's verdict does not cover what it asserts. That does not mean it is false.",
  not_derivable:
    "This sentence could not be derived from the menu (item names, prices, ingredients) or backed by a checker finding. That does not mean it is false.",
  ingredient_subject: "The claim is about an ingredient, not a checked item.",
};

/**
 * The only path from model prose to the screen. Pure.
 *
 * An item is "backed" only when there is at least one `safe` Finding for it and NO
 * `unsafe`/`unknown` Finding for it (findings may cover several restrictions).
 * `unknown` never backs a claim. The allergens a claim names must all lie in the
 * union of the backing Findings' `covered`; otherwise the claim is "not checked".
 */
export function gate(
  prose: string,
  findings: Finding[],
  menu: Menu = MENU,
): { shown: string; refusals: Refusal[] } {
  const refusals: Refusal[] = [];
  let shown = "";
  // Allow-list state: did the previous segment mention the menu or get withheld?
  let ctx = false;
  let carried: string[] = [];

  const parts = prose.split(REFUSAL_MARKER);
  parts.forEach((part, pi) => {
    if (pi > 0) {
      shown += REFUSAL_MARKER; // our own earlier output; a withheld sentence sits here
      ctx = true;
      carried = [];
    }
    for (const seg of segments(part)) {
      if (seg.core === "") {
        shown += seg.raw;
        continue;
      }
      const claim = classifySegment(seg.core, menu);
      const d = derivation(seg.core, menu);
      let reason: RefusalReason | undefined;
      let claimed = "";
      let items = d.items;
      if (claim) {
        claimed = claim.claimed;
        items = claim.items;
        reason = refusalReason(claim, findings);
        if (!reason) {
          const bad = d.offending({ claim: true, carried: [] });
          if (bad !== undefined) {
            reason = "not_derivable";
            claimed = bad;
          }
        }
      } else if (d.mentions || ctx) {
        // Default-deny: an item-mentioning sentence passes only if derivable from menu data.
        const bad = d.offending({ claim: false, carried });
        if (bad !== undefined) {
          reason = "not_derivable";
          claimed = bad;
        } else if (!d.mentions && !d.hasContent) {
          reason = "not_derivable"; // a bare "It is." after an item or refusal is an affirmation
          claimed = seg.core;
        }
      }
      ctx = reason !== undefined || d.mentions;
      carried = ctx ? (d.items.length ? d.items : carried) : [];
      if (!reason) {
        shown += seg.raw;
        continue;
      }
      const r: Refusal = { claimed, items, sentence: seg.core, reason, why: WHY[reason] };
      if (items[0] !== undefined) r.item = items[0];
      refusals.push(r);
      const lead = seg.raw.slice(0, seg.raw.indexOf(seg.core));
      const trail = seg.raw.slice(lead.length + seg.core.length);
      shown += lead + REFUSAL_MARKER + trail;
    }
  });
  return { shown, refusals };
}

function refusalReason(claim: Claim, findings: Finding[]): RefusalReason | undefined {
  const { items, ingredientSubject } = claim;
  if (items.length === 0) return "item_unresolved";
  if (ingredientSubject) return "ingredient_subject";
  let worst: RefusalReason | undefined;
  for (const id of items) {
    const mine = findings.filter((f) => f.item === id);
    if (mine.some((f) => f.verdict === "unsafe")) return "unsafe";
    if (mine.some((f) => f.verdict === "unknown")) worst = "unknown";
    else if (!mine.some((f) => f.verdict === "safe")) worst ??= "no_finding";
    else {
      const covered = new Set(mine.flatMap((f) => f.covered));
      if (claim.unscoped || !claim.allergens.every((a) => covered.has(a))) worst ??= "not_checked";
    }
  }
  return worst;
}
