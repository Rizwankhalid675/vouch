/**
 * Per-item verdict cards. OURS, written here, and the most load-bearing file in
 * this task.
 *
 * WHY THIS IS NOT CHAT OUTPUT
 *
 * The gate withholds a safety claim whenever no checker finding backs it. It
 * cannot tell a true claim from a false one and does not try, so a model saying
 * "this is not dairy-free" is withheld exactly like one saying it is. Suppressing
 * a true warning would be indefensible if the prose were the only channel. It is
 * defensible only because the verdict is rendered BESIDE the dish, by this file,
 * from the checker, with no dependency on the conversation.
 *
 * Three leak classes also remain documented in the gate. The card is the defence
 * in depth that makes them survivable: a leaked "Spotless." has to sit next to a
 * card reading unsafe.
 *
 * So: this module touches no model output, imports neither the gate nor the loop,
 * and renders from `Finding[]` alone. Task 4 left 34 mount points ready,
 * `<div class="verdict-slot" data-verdict-slot="{itemId}">`, hidden by CSS while
 * empty. If a future change makes a card appear only when a model has spoken,
 * the product has lost its safety property.
 *
 * READING A FINDING HONESTLY
 *  - `safe` with `covered: []` asserts NOTHING: no restriction was checked. It is
 *    rendered as "not checked", never as reassurance.
 *  - `unsafe`: `because.ingredient` is the TOP-LEVEL item ingredient and `via[0]`
 *    repeats it; `via` is the derivation path down to the allergen.
 *  - `unknown`: `because.allergen` is the literal string "unknown" and
 *    `because.ingredient` is the gap node. Rendered as "we don't know" — never as
 *    a hazard, never as an all-clear.
 */

import type { Finding, Menu, Restriction } from "../../contracts.ts";

/** What the card says at a glance. `unchecked` is ours, for a `safe` Finding that covered nothing. */
export type CardKind = "safe" | "unsafe" | "unknown" | "unchecked";

export function cardKind(f: Finding): CardKind {
  if (f.verdict === "safe" && f.covered.length === 0) return "unchecked";
  return f.verdict;
}

/** An ingredient or allergen id in the words a guest reads. Falls back to the id. */
function nameOf(id: string, menu: Menu): string {
  return menu.ingredients[id]?.name ?? id;
}

const HEADLINE: Record<CardKind, string> = {
  unsafe: "Unsafe for what you told us",
  unknown: "We don't know",
  safe: "No conflict found",
  unchecked: "Not checked",
};

/**
 * The sentence under the headline. Returned as text, so a caller can test the
 * wording without a DOM, and so nothing here can inject markup.
 */
export function cardReason(f: Finding, menu: Menu): string {
  const kind = cardKind(f);
  if (kind === "unsafe") {
    const b = f.because;
    if (!b) return "The checker found a conflict but did not record which ingredient. Treat this as unsafe and ask at the counter.";
    const allergen = nameOf(b.allergen, menu);
    const top = nameOf(b.ingredient, menu);
    const direct = b.via.length <= 1 || b.via[b.via.length - 1] === b.ingredient;
    if (direct) return `Contains ${allergen.toLowerCase()}: ${top} is on the ingredient list.`;
    const path = b.via.map((id) => nameOf(id, menu)).join(" → ");
    return `Contains ${allergen.toLowerCase()}, through ${path}.`;
  }
  if (kind === "unknown") {
    const b = f.because;
    if (!b) return "Some of this item's ingredients are not published, so it cannot be checked.";
    if (b.ingredient === f.item || b.via.length <= 1) {
      return "No ingredient list has been published for this item, so it cannot be checked.";
    }
    const gap = nameOf(b.ingredient, menu);
    const path = b.via.map((id) => nameOf(id, menu)).join(" → ");
    return `${gap} has no published ingredient list, so what it contains is unknown (${path}).`;
  }
  if (kind === "unchecked") {
    return "Nothing was checked, because you have not told us what to avoid. This is not an all-clear.";
  }
  const avoided = f.covered.map((id) => nameOf(id, menu).toLowerCase());
  const list = avoided.length === 1 ? avoided[0]! : `${avoided.slice(0, -1).join(", ")} or ${avoided[avoided.length - 1]!}`;
  return `No ${list} in the published ingredients for this item.`;
}

/** The restriction ids a card speaks to, in the guest's words. Empty when nothing was checked. */
export function checkedAgainst(f: Finding, restrictions: Restriction[]): string[] {
  const covered = new Set(f.covered);
  return restrictions.filter((r) => r.avoid.some((a) => covered.has(a))).map((r) => r.name);
}

/**
 * One card, built as DOM nodes rather than a markup string: nothing here can
 * inject HTML, and nothing here comes from a model.
 */
export function verdictCard(doc: Document, f: Finding, menu: Menu, restrictions: Restriction[] = []): HTMLElement {
  const kind = cardKind(f);
  const el = doc.createElement("div");
  el.className = `verdict verdict-${kind}`;
  el.setAttribute("data-verdict", kind);
  el.setAttribute("data-verdict-item", f.item);
  // A verdict appearing beside a dish is a status change the guest did not ask for.
  el.setAttribute("role", "status");

  const head = doc.createElement("p");
  head.className = "verdict-head";
  const mark = doc.createElement("span");
  mark.className = "verdict-mark";
  // A word, not only a colour: the verdict must survive a monochrome screen.
  mark.textContent = { unsafe: "✕", unknown: "?", safe: "✓", unchecked: "–" }[kind];
  mark.setAttribute("aria-hidden", "true");
  const label = doc.createElement("strong");
  label.textContent = HEADLINE[kind];
  head.append(mark, label);

  const reason = doc.createElement("p");
  reason.className = "verdict-reason";
  reason.textContent = cardReason(f, menu);

  el.append(head, reason);

  const names = checkedAgainst(f, restrictions);
  if (names.length > 0) {
    const scope = doc.createElement("p");
    scope.className = "verdict-scope";
    scope.textContent = `Checked against: ${names.join(", ")}.`;
    el.append(scope);
  }

  const source = doc.createElement("p");
  source.className = "verdict-source";
  source.textContent =
    "From the published ingredient list. Not a statement about the kitchen, and not medical advice.";
  el.append(source);
  return el;
}

/**
 * Put each Finding in its own item's slot.
 *
 * Replaces only the contents of a slot this function owns, and leaves every other
 * slot alone, so a card for one item cannot be wiped by a check of another.
 * Returns the number of cards rendered.
 */
export function renderVerdicts(doc: Document, findings: Finding[], menu: Menu, restrictions: Restriction[] = []): number {
  let n = 0;
  for (const f of findings) {
    const slot = doc.querySelector<HTMLElement>(`[data-verdict-slot="${cssEscape(f.item)}"]`);
    if (!slot) continue;
    slot.replaceChildren(verdictCard(doc, f, menu, restrictions));
    n += 1;
  }
  return n;
}

/** Empty every slot. The CSS hides an empty slot, so the card disappears with it. */
export function clearVerdicts(doc: Document): void {
  for (const slot of doc.querySelectorAll<HTMLElement>("[data-verdict-slot]")) slot.replaceChildren();
}

/**
 * Menu ids are `[a-z0-9_]`, but a selector built from data must not depend on
 * that staying true. `CSS.escape` where the browser has it, a conservative
 * fallback where it does not.
 */
function cssEscape(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") return CSS.escape(value);
  return value.replace(/["'\\\]\[]/g, "\\$&");
}
