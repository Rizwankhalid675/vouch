/**
 * The transcript, and the single door model prose goes through to reach a screen.
 * OURS, written here.
 *
 * `showModelText` and `showPeerText` are the ONLY functions in this runtime that
 * put model-generated text into the DOM, and the only thing either will put
 * there is `gate(...).shown` — they share one private `renderGated`, which holds
 * the one call to `gate` in this file. Everything else the panel says is written
 * by us. The loop never touches the transcript element; it calls this. A test
 * asserts the rendered text is character-for-character
 * `gate(raw, findings, menu).shown` on both paths, so rendering raw prose, or
 * anything else, fails loudly.
 *
 * The second path is Task 8's, and it is the composition boundary: a peer's
 * answer is prose from a model on someone else's origin, and it is held to the
 * same findings as our own model's. Not a weaker check for a remote source, and
 * not a stronger one — the SAME one, which is the point.
 */

import type { Finding, Menu, Restriction } from "../../contracts.ts";
import { MENU, RESTRICTIONS } from "../safety/canon.ts";
import { gate, REFUSAL_MARKER, type Refusal } from "../gate/gate.ts";
import { datum, ours, renderPhrase, renderQuoted, theirs, type SitePhrase, type SiteReport, type SiteText } from "./errors.ts";
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
/**
 * THE FOURTH C1-PRIME SURFACE.
 *
 * This used to return a built `string` that was assigned to `li.textContent`,
 * which put a model-chosen phrase and a published dish name inside one of our
 * sentences - and did it on a path that bypassed `SiteText` entirely, so none of
 * the compile-time machinery saw it.
 *
 * It returns a PHRASE now. The dish names are our published data (`datum`), the
 * claimed phrase is the model's (`theirs`), and `r.why` is the gate's own prose,
 * which is written in this repository. `claimedLabel`'s bound is kept: a phrase
 * may be named, a sentence may not ride in as one, and now it cannot anyway,
 * because it lands in a node.
 */
export function refusalPhrase(r: Refusal, menu: Menu = MENU): SitePhrase {
  const named = r.items.map((id) => menu.items.find((i) => i.id === id)?.name ?? id);
  const parts: (SiteText | ReturnType<typeof theirs>)[] = [ours("Withheld a claim")];
  if (named.length > 0) {
    parts.push(ours(" about the "));
    for (const [i, name] of named.entries()) {
      if (i > 0) parts.push(ours(", "));
      parts.push(datum(name));
    }
  }
  parts.push(ours(" \u2014 the phrase was "), theirs(claimedLabel(r.claimed)), ours(". "), whyText(r.why));
  return parts;
}

/**
 * The gate's reason, as site text. The gate is in this repository and its
 * reasons are literals it wrote, so they are ours - but `Refusal.why` is typed
 * `string`, and `ours` takes a literal only, so the trust is stated here in one
 * place rather than assumed at the call site.
 */
function whyText(why: string): SiteText {
  return why as SiteText;
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
   *
   * It takes a `SiteReport` too, for an error that has to show words which are
   * not ours - a validator's, say. Those render in their own labelled nodes
   * BESIDE the turn's text, never inside the sentence the turn speaks.
   */
  /**
   * Our prose with values in nodes between the words. The only way a runtime
   * value reaches a transcript line, now that nothing will interpolate one.
   */
  showPhrase(phrase: SitePhrase, kind = "runtime"): HTMLElement {
    const row = this.doc.createElement("div");
    row.className = `turn turn-${kind}`;
    row.setAttribute("data-turn", kind);
    const label = this.doc.createElement("p");
    label.className = "turn-who";
    label.textContent = "Hollis & Rye";
    const body = this.doc.createElement("p");
    body.className = "turn-text";
    renderPhrase(this.doc, body, phrase);
    row.append(label, body);
    this.log.append(row);
    this.log.scrollTop = this.log.scrollHeight;
    return row;
  }

  showRuntime(message: SiteText | SiteReport, kind = "runtime"): HTMLElement {
    const report: SiteReport = typeof message === "string" ? { text: message } : message;
    const row = this.append(kind, "Hollis & Rye", report.text);
    if (report.quoted && report.quoted.length > 0) {
      // Beside the turn's own sentence, never inside it.
      const host = this.doc.createElement("div");
      host.className = "turn-report";
      renderQuoted(this.doc, host, report.quotedLabel, report.quoted);
      row.append(host);
    }
    return row;
  }

  /**
   * THE ONLY PATH FROM MODEL PROSE TO THE SCREEN.
   *
   * @param raw      exactly what the model produced
   * @param findings the checker's findings for the current restriction set
   */
  showModelText(raw: string, findings: Finding[], meta?: { source: "live" | "scripted"; scriptLabel?: string }): ShownResult {
    const { row, result } = this.renderGated(raw, findings, "agent", "Front of house");
    if (meta?.source === "scripted") {
      // Say so, visibly. A replayed reply presented as a live one would be the
      // exact dishonesty this project is about.
      // A FIFTH surface of the same class, found by the textContent sweep rather
      // than by the compiler: `scriptLabel` is our own fixture's label, but it was
      // interpolated into our sentence, which is the pattern and not the trust
      // level that matters. It is a node now.
      const tag = this.doc.createElement("p");
      tag.className = "replay-tag";
      tag.setAttribute("data-replayed", "true");
      renderPhrase(
        this.doc,
        tag,
        meta.scriptLabel
          ? [ours("Replayed reply, not a live model call:"), datum(meta.scriptLabel)]
          : [ours("Replayed reply, not a live model call.")],
      );
      row.prepend(tag);
    }
    this.showRefusals(result.refusals);
    return result;
  }

  /**
   * A PEER's answer, on its way to the screen through the same gate.
   *
   * This is the composition boundary, and it is the project's thesis in one
   * method. A peer's answer is prose produced by a model that was prompted by
   * instructions another company published on another origin. It is not data, it
   * is not a finding, and it is not evidence of anything. So it goes through
   * `gate` exactly as our own model's prose does, against the SAME findings —
   * the ones computed here from this site's published ingredient list — and a
   * claim no finding backs is withheld whoever made it.
   *
   * A peer that says "our glaze is completely dairy-free, I checked" is not a
   * safety source that happens to be remote. It is a sentence. It is withheld,
   * and the card beside the dish still reads "We don't know", because an
   * ingredient this site has not published stays unknown however confident
   * somebody else is about it.
   *
   * Two things are deliberately NOT done here: the answer is not attributed to
   * the deli (the row says a peer network said it, and names the origin), and the
   * peer's words are not put in one of our sentences. The origin and the peer's
   * own network name go in nodes, like every other stranger's string.
   */
  showPeerText(raw: string, findings: Finding[], peer: { origin: string; network: string }): ShownResult {
    const { row, result } = this.renderGated(raw, findings, "peer", "A peer network");
    const source = this.doc.createElement("p");
    source.className = "peer-source";
    source.setAttribute("data-peer-source", "");
    renderPhrase(this.doc, source, [
      ours("Answered by the network"),
      theirs(peer.network),
      ours(" published at"),
      theirs(peer.origin),
      ours(". These are that site's words, read here through the same check as any other reply. No verdict on this page comes from them."),
    ]);
    row.prepend(source);
    this.showRefusals(result.refusals);
    return result;
  }

  /**
   * Gate prose and put the result on screen. The ONE call site of `gate` in this
   * class, so "model prose reaches the screen only through the gate" is a
   * property of this file and not a habit of its authors: `showModelText` and
   * `showPeerText` differ in the label and the chrome around the row, never in
   * what reaches the text node.
   *
   * `who` is a literal at both call sites.
   */
  private renderGated(raw: string, findings: Finding[], kind: string, who: string): { row: HTMLElement; result: ShownResult } {
    const result = gate(raw, findings, this.menu);
    const row = this.append(kind, who, result.shown);
    if (result.shown.includes(REFUSAL_MARKER)) row.setAttribute("data-withheld", "true");
    return { row, result };
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
      // A phrase rendered as nodes, not a built string assigned to textContent.
      renderPhrase(this.doc, li, refusalPhrase(r, this.menu));
      ul.append(li);
    }
    block.append(h, ul);

    const items = [...new Set(refusals.flatMap((r) => r.items))];
    const cards = this.doc.createElement("div");
    cards.className = "refusal-verdicts";
    cards.setAttribute("data-refusal-verdicts", "");
    for (const id of items) {
      const card = guestVerdictCard(this.doc, id, this.selected(), this.menu);
      if (!card) continue;
      const wrap = this.doc.createElement("div");
      wrap.className = "refusal-verdict";
      // Already a dedicated node; marked so that the "what is the site's own
      // prose" sweep in the tests can tell data from prose here too.
      const name = this.doc.createElement("p");
      name.className = "refusal-verdict-name";
      renderPhrase(this.doc, name, [datum(this.menu.items.find((i) => i.id === id)?.name ?? id)]);
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
