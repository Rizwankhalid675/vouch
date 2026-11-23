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
import { verdictFor } from "../safety/verdict.ts";

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
 * Every line of text a card shows, as data. Pure: a function of the Finding, the
 * menu and the published restriction list, and of nothing else.
 *
 * It exists so that a test can assert a rendered card's `textContent` is EXACTLY
 * these lines and nothing more. That assertion is what catches text arriving in a
 * card from anywhere other than the checker.
 */
export function cardLines(f: Finding, menu: Menu, restrictions: Restriction[] = []): string[] {
  const kind = cardKind(f);
  const names = checkedAgainst(f, restrictions);
  return [
    MARK[kind],
    HEADLINE[kind],
    cardReason(f, menu),
    ...(names.length > 0 ? [`Checked against: ${names.join(", ")}.`] : []),
    "From the published ingredient list. Not a statement about the kitchen, and not medical advice.",
  ];
}

/** A word, not only a colour: the verdict must survive a monochrome screen. */
const MARK: Record<CardKind, string> = { unsafe: "✕", unknown: "?", safe: "✓", unchecked: "–" };

/**
 * One card, built as DOM nodes rather than a markup string: nothing here can
 * inject HTML, and nothing here comes from a model.
 *
 * Module-private on purpose. See `renderVerdicts` below: no exported function in
 * this module accepts a `Finding` from a caller and renders it, so there is no
 * signature through which a Finding the model asked for could reach a card.
 */
function verdictCard(doc: Document, f: Finding, menu: Menu, restrictions: Restriction[] = []): HTMLElement {
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
  mark.textContent = MARK[kind];
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
 * THE INVARIANT THIS SIGNATURE EXISTS TO ENFORCE
 *
 * The verdict cards are a pure function of (the menu, the guest's restriction set).
 * Nothing reachable from the model may change what any card shows — not its
 * verdict, not its text, not its presence, not its order.
 *
 * So this function **does not accept a `Finding`**. It takes the guest's selection
 * and computes the verdicts itself, through `verdictFor`, which is pure over
 * published data. `verdictCard` is module-private. There is therefore no signature
 * anywhere in this module through which a Finding computed for a model's arguments
 * could reach a slot: an attempt to do it does not type-check, rather than being a
 * rule someone has to remember.
 *
 * (The first version of this file took `Finding[]`, and `check_safety` — a read
 * action the guest is never asked about — handed it the model's own findings. A
 * model asking "is the turkey club nut-free?" while the guest had ticked dairy-free
 * replaced the unsafe card with a green tick. The cards are the defence in depth
 * that makes the gate's documented leaks survivable, so that was the architecture's
 * central claim being false. The signature is the fix.)
 *
 * An empty selection clears every slot: nothing was asked, so nothing is shown.
 * Returns the findings rendered, for the caller's own state and for the gate.
 */
export function renderVerdicts(doc: Document, selected: Restriction[], menu: Menu, published: Restriction[] = []): Finding[] {
  if (selected.length === 0) {
    clearVerdicts(doc);
    return [];
  }
  const findings = menu.items.map((item) => verdictFor(item, selected, menu));
  for (const f of findings) {
    const slot = doc.querySelector<HTMLElement>(`[data-verdict-slot="${cssEscape(f.item)}"]`);
    // Replaces only the contents of the slot this finding belongs to, so one
    // item's check cannot wipe another's.
    slot?.replaceChildren(verdictCard(doc, f, menu, published));
  }
  return findings;
}

/**
 * One card for one item, computed the same way `renderVerdicts` computes it, for a
 * caller that wants to show the guest's verdict somewhere else as well (the refusal
 * panel does). Takes the guest's selection, never a Finding, for the same reason.
 * Returns null when nothing is selected, rather than inventing a verdict.
 */
export function guestVerdictCard(
  doc: Document,
  itemId: string,
  selected: Restriction[],
  menu: Menu,
  published: Restriction[] = [],
): HTMLElement | null {
  if (selected.length === 0) return null;
  const item = menu.items.find((i) => i.id === itemId);
  if (!item) return null;
  return verdictCard(doc, verdictFor(item, selected, menu), menu, published);
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
