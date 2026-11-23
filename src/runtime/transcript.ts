/**
 * The transcript, and the single door model prose goes through to reach a screen.
 * OURS, written here.
 *
 * `showModelText` is the ONLY function in this runtime that puts model-generated
 * text into the DOM, and the only thing it will put there is `gate(...).shown`.
 * Everything else the panel says is written by us. The loop never touches the
 * transcript element; it calls this. A test asserts the rendered text is
 * character-for-character `gate(raw, findings, menu).shown`, so rendering raw
 * prose, or anything else, fails loudly.
 */

import type { Finding, Menu, Restriction } from "../../contracts.ts";
import { MENU, RESTRICTIONS } from "../safety/canon.ts";
import { gate, REFUSAL_MARKER, type Refusal } from "../gate/gate.ts";
import { guestVerdictCard } from "./verdict-cards.ts";

/**
 * A `Refusal.claimed` is sometimes a meaningless token — "0", "i" — because of a
 * known rough edge in the claim classifier. Printing it raw would make the
 * refusal panel read like nonsense, so a token that is not a word is replaced by
 * a description of where it was.
 */
export function claimedLabel(claimed: string): string {
  const trimmed = claimed.trim();
  // It is model text, so it is bounded as well as filtered: a PHRASE may be
  // named (SPEC 4.4 asks for it) but a sentence may not ride in as one. Anything
  // longer than a phrase, or with no word in it, is described instead of quoted.
  if (!/[A-Za-z]{3,}/.test(trimmed)) return "a phrase in that sentence";
  if (trimmed.length > 40 || trimmed.split(/\s+/).length > 5) return "a phrase in that sentence";
  return trimmed;
}

/**
 * We do NOT reproduce the withheld sentence in the panel, although `Refusal`
 * carries it for exactly that purpose. Naming the claimed phrase and the reason
 * satisfies "a visible refusal naming what was claimed and why it could not be
 * shown" (SPEC 4.4) without re-publishing an unverified assertion two inches
 * below the place it was withheld from.
 */
export function refusalLine(r: Refusal, menu: Menu = MENU): string {
  const named = r.items.map((id) => menu.items.find((i) => i.id === id)?.name ?? id);
  const about = named.length > 0 ? ` about the ${named.join(", ")}` : "";
  return `Withheld a claim${about} ("${claimedLabel(r.claimed)}"). ${r.why}`;
}

export interface ShownResult {
  shown: string;
  refusals: Refusal[];
}

export class Transcript {
  constructor(
    private readonly doc: Document,
    private readonly log: HTMLElement,
    private readonly refusalPanel: HTMLElement,
    private readonly menu: Menu = MENU,
    private readonly restrictions: Restriction[] = RESTRICTIONS,
    /**
     * The guest's own restriction selection. The refusal panel's verdict cards are
     * computed from THIS and from nothing a caller hands in, for the same reason
     * `renderVerdicts` takes no `Finding`: a card must never show a verdict the
     * model asked for.
     */
    private readonly selected: () => Restriction[] = () => [],
  ) {}

  /** The guest's own words. Not model output; no gate applies. */
  showUser(text: string): void {
    this.append("guest", "You", text);
  }

  /**
   * Our words: a status, an error, a receipt. Never model output. If you find
   * yourself reaching for this with a string that came from a model, stop — that
   * is the bypass this whole design exists to prevent.
   */
  showRuntime(text: string, kind = "runtime"): HTMLElement {
    return this.append(kind, "Hollis & Rye", text);
  }

  /**
   * THE ONLY PATH FROM MODEL PROSE TO THE SCREEN.
   *
   * @param raw      exactly what the model produced
   * @param findings the checker's findings for the current restriction set
   */
  showModelText(raw: string, findings: Finding[], meta?: { source: "live" | "scripted"; scriptLabel?: string }): ShownResult {
    const result = gate(raw, findings, this.menu);
    const row = this.append("agent", "Front of house", result.shown);
    if (result.shown.includes(REFUSAL_MARKER)) row.setAttribute("data-withheld", "true");
    if (meta?.source === "scripted") {
      // Say so, visibly. A replayed reply presented as a live one would be the
      // exact dishonesty this project is about.
      const tag = this.doc.createElement("p");
      tag.className = "replay-tag";
      tag.setAttribute("data-replayed", "true");
      tag.textContent = `Replayed reply, not a live model call${meta.scriptLabel ? `: ${meta.scriptLabel}` : ""}.`;
      row.prepend(tag);
    }
    this.showRefusals(result.refusals);
    return result;
  }

  /**
   * A refusal says "read the verdict beside the dish". Showing that verdict right
   * here as well is strictly better than telling the guest to go and look: the
   * withheld sentence and the verdict that contradicts it end up in one place,
   * which is how a reader meets them.
   *
   * The card is computed by `guestVerdictCard` from the GUEST's selection, the
   * same way the slot card is. This function takes no `Finding` from anyone, so a
   * verdict the model asked for cannot appear here either. When nothing is
   * selected, or the item is unknown, no card is shown and none is invented.
   */
  showRefusals(refusals: Refusal[]): void {
    if (refusals.length === 0) return;
    const block = this.doc.createElement("div");
    block.className = "refusal-block";
    block.setAttribute("data-refusals", String(refusals.length));
    const h = this.doc.createElement("p");
    h.className = "refusal-head";
    h.textContent =
      refusals.length === 1
        ? "One claim was withheld. Read the verdict beside the dish instead."
        : `${refusals.length} claims were withheld. Read the verdict beside each dish instead.`;
    const ul = this.doc.createElement("ul");
    for (const r of refusals) {
      const li = this.doc.createElement("li");
      li.setAttribute("data-refusal-reason", r.reason);
      li.textContent = refusalLine(r, this.menu);
      ul.append(li);
    }
    block.append(h, ul);

    const items = [...new Set(refusals.flatMap((r) => r.items))];
    const cards = this.doc.createElement("div");
    cards.className = "refusal-verdicts";
    cards.setAttribute("data-refusal-verdicts", "");
    for (const id of items) {
      const card = guestVerdictCard(this.doc, id, this.selected(), this.menu, this.restrictions);
      if (!card) continue;
      const wrap = this.doc.createElement("div");
      wrap.className = "refusal-verdict";
      const name = this.doc.createElement("p");
      name.className = "refusal-verdict-name";
      name.textContent = this.menu.items.find((i) => i.id === id)?.name ?? id;
      wrap.append(name, card);
      cards.append(wrap);
    }
    if (cards.children.length > 0) block.append(cards);

    this.refusalPanel.append(block);
    this.refusalPanel.removeAttribute("hidden");
  }

  private append(kind: string, who: string, text: string): HTMLElement {
    const row = this.doc.createElement("div");
    row.className = `turn turn-${kind}`;
    row.setAttribute("data-turn", kind);
    const label = this.doc.createElement("p");
    label.className = "turn-who";
    label.textContent = who;
    const body = this.doc.createElement("p");
    body.className = "turn-text";
    // textContent, always: no model-produced string is ever parsed as markup.
    body.textContent = text;
    row.append(label, body);
    this.log.append(row);
    this.log.scrollTop = this.log.scrollHeight;
    return row;
  }
}
