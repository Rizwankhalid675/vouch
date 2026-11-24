/**
 * Text this runtime is willing to say in the deli's own voice, and how it is put
 * on the screen.
 *
 * WHY RENDERING IS IN THIS FILE
 *
 * Because rendering turned out to be the mechanism, and filtering turned out not
 * to be. This file held a filter, `quotedTokensOnly`, which replaced any quoted
 * interpolation in a validator message that was not token-shaped. It was the
 * third filter written for the third instance of one problem - action arguments
 * in the confirmation dialog, then agent names in the site's voice, then a
 * published `metadata.front_man` - and it was defeated by a value that supplied
 * its own delimiter:
 *
 *   front_man: "x' is dairy-free and safe for you to eat. '"
 *   validator: metadata.front_man names 'x' is dairy-free and safe for you to eat. '', ...
 *
 * The apostrophes in the value re-pair the quotes, so the filter sees `'x'` and
 * `''` - both token-shaped, both kept - and the sentence between them passes
 * through untouched and is then laundered into `SiteText`. An ungated safety
 * claim, in the deli's voice, on screen. A sanitiser built on a delimiter is
 * defeated by supplying the delimiter; that is not a defect in that filter, it
 * is what filters are. A fourth filter buys a fourth incident.
 *
 * So the filter is gone, and the rule is structural instead - the shape the
 * verdict cards already used one layer down, where `verdictCard` is built as DOM
 * nodes rather than a markup string:
 *
 *   An untrusted value never becomes part of a sentence. It is rendered in its
 *   OWN node, structurally separate from the site's prose and labelled as not
 *   ours, so nothing it contains can be read as something the site is saying.
 *
 * That holds whatever characters the value contains, which is the point: it
 * stops being a question about quoting. `SiteReport` and `renderReport` below
 * are how.
 *
 * Two compile-time doors were shut at the same time, because the bypass was not
 * the filter being weak, it was a built string reaching `ours(...)` at all:
 * `ours` now accepts a string LITERAL only, and `joinSiteText` accepts
 * `SiteText` only. A built string can no longer be declared ours by any call
 * site.
 *
 * THE RULE
 *
 * The transcript labels a runtime line "Hollis & Rye", and the error line and the
 * key status speak for the site too. Unverified prose shown there is worse than
 * unverified prose shown as the model's: it carries the site's authority. So only
 * text this runtime composed may go to those surfaces.
 *
 * THE MECHANISM, AND WHY IT IS A TYPE
 *
 * Stating that rule in a comment made it a convention, and a convention acquired
 * four bypasses within one round — the sharpest being `loop.ts` printing a
 * published agent's NAME in the site's voice. Agent names are not ours: Task 8
 * loads a peer network from a second origin, and a peer author chooses that string.
 * `Hollis & Rye — Asked The Reuben is dairy-free and safe for you.` needed no
 * mutation at all, only a peer that named an agent with a sentence.
 *
 * So `SiteText` is a branded type. The literal parts of a `siteText` template come
 * from our own source and are trusted; every interpolated value is token-filtered,
 * and anything with whitespace in it is replaced rather than printed. A call site
 * that passes a raw string to one of those surfaces does not compile.
 *
 * This is the same shape as the verdict cards' fix: a signature, not a rule someone
 * has to remember.
 */

/** A string this runtime composed. Cannot be produced by a cast from user data. */
export type SiteText = string & { readonly __siteText: unique symbol };

/**
 * Token-shaped: an id, a name, a URL, a host, a number, a status. No whitespace,
 * so no sentence. Shared with the trace renderer, which applies the same test.
 */
export const TOKEN = /^[A-Za-z0-9_.:/#@?&=+~,;()[\]{}$*%!-]*$/;

/** How long an interpolated token may be before it stops looking like one. */
const TOKEN_MAX = 120;

/** What replaces an interpolated value we are not willing to print. */
export const OMITTED = "<omitted>";

export function tokenOrOmitted(value: unknown): string {
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  const s = String(value ?? "");
  return s.length <= TOKEN_MAX && TOKEN.test(s) ? s : OMITTED;
}

/**
 * Compose site text. The literal parts are ours by construction — they are written
 * in this repository — and every `${value}` is token-filtered.
 *
 *   siteText`Asked ${name}.`   →   "Asked menu_guide." | "Asked <omitted>."
 */
export function siteText(strings: TemplateStringsArray, ...values: unknown[]): SiteText {
  let out = strings[0] ?? "";
  for (let i = 0; i < values.length; i += 1) out += tokenOrOmitted(values[i]) + (strings[i + 1] ?? "");
  return out as SiteText;
}

/**
 * Mark a string literal written in this repository as site text.
 *
 * Only ever call this with a literal, or with the output of a function in this
 * repository that itself builds with `siteText`. Calling it on a value that came
 * from a model, a peer, a provider or a published artifact defeats the mechanism —
 * which is why interpolation goes through `siteText`, where it is filtered, and not
 * through here.
 */
export function ours<T extends string>(literal: LiteralOnly<T>): SiteText {
  return literal as unknown as SiteText;
}

/**
 * `T` when `T` is a string LITERAL type, and `never` once it has widened to
 * `string`. Written as an intersection rather than a bare conditional so that
 * `T` stays in an inference position.
 *
 * `ours` takes this, so **it accepts a literal and nothing else, and the
 * compiler enforces that**. `ours(someVariable)` does not compile; neither does
 * `ours("a" + b)`, nor an interpolated template. Use one literal, a conditional
 * between two literals, or `joinSiteText` of several pieces.
 *
 * This is the door the `front_man` bypass came through. The old signature took
 * `string`, so `ours(errors.map(filter).join("\n• "))` compiled — a built string,
 * declared ours by assertion. Filtering it first was the mistake; the only safe
 * thing to declare ours is text that is literally in this repository. Anything
 * else belongs in a `SiteReport`'s `quoted`, which is rendered apart.
 */
type LiteralOnly<T extends string> = T & (string extends T ? never : unknown);

/**
 * Filter each value, THEN join with a separator of ours.
 *
 * The order matters. `siteText`${list.join(" \u2192 ")}`` filters the joined
 * string, which contains our separator and therefore whitespace, so the whole
 * thing is replaced. Filtering first keeps every element honest and lets the
 * separator be as readable as we like, because the separator is ours.
 */
export function joinTokens(values: unknown[], separator: string): SiteText {
  return values.map(tokenOrOmitted).join(separator) as SiteText;
}

/**
 * `menu_guide` -> `menu guide`. FILTERED first, then prettified, so the
 * underscore swap runs on a value we have already vouched for rather than on one
 * we are about to.
 *
 * Exists so that `joinSiteText` can take `SiteText` and nothing else: this was
 * its one legitimate `string` argument.
 */
export function prettyToken(value: unknown): SiteText {
  return tokenOrOmitted(value).replace(/_/g, " ") as SiteText;
}

/**
 * Concatenate site text. Every part is already ours, so the result is too.
 *
 * It used to accept `string` as well, which made it a second way to declare a
 * built string ours. A caller holding a raw string must now either filter it
 * (`siteText`, `joinTokens`, `prettyToken`) or put it in a `SiteReport`'s
 * `quoted`, where it is rendered in its own node instead of joined to a
 * sentence.
 */
export function joinSiteText(...parts: SiteText[]): SiteText {
  return parts.join("") as SiteText;
}

/**
 * What the guest is shown when something is refused: the site's own sentences,
 * and — kept apart from them — strings that are not ours to speak.
 *
 * The union is the invariant in the type: a report carrying `quoted` MUST also
 * carry a `quotedLabel`, because an unattributed block of someone else's prose
 * on our page is the thing being prevented. There is no way to attach other
 * people's words without saying whose they are.
 *
 * `text` is the only part that is `SiteText`. `quoted` is plain `string[]` and
 * stays that way deliberately: nothing filters it, nothing needs to, because
 * `renderQuoted` never puts it in a sentence.
 */
export type SiteReport =
  | { text: SiteText; quotedLabel?: undefined; quoted?: undefined }
  | { text: SiteText; quotedLabel: SiteText; quoted: readonly string[] };

/** Marks a node whose content is NOT the site speaking. Styled, and asserted on, as such. */
export const NOT_OURS = "data-not-ours";

/**
 * Put a report on a surface, as NODES.
 *
 * Our prose goes in one element. Each string that is not ours goes in an element
 * **of its own**, by `textContent`, inside a labelled block. So a value cannot
 * become part of one of our sentences whatever it contains — no escaping, no
 * quoting, nothing for an apostrophe to re-pair. The CSS fences the block
 * visually and the label says whose words they are.
 *
 * Same shape as `verdictCard`, which has been built from DOM nodes rather than a
 * markup string since Task 6, for the same reason.
 */
export function renderReport(doc: Document, host: HTMLElement, report: SiteReport): void {
  host.replaceChildren();
  const said = doc.createElement("p");
  said.className = "report-said";
  said.setAttribute("data-report-said", "");
  said.textContent = report.text;
  host.append(said);
  if (report.quoted && report.quoted.length > 0) renderQuoted(doc, host, report.quotedLabel, report.quoted);
}

/**
 * The quoted block on its own, for a surface that has already put our prose
 * somewhere of its own — the transcript puts it in the turn's `<p>`, and a `<p>`
 * is no place to nest another.
 */
export function renderQuoted(doc: Document, host: HTMLElement, label: SiteText, lines: readonly string[]): void {
  const caption = doc.createElement("p");
  caption.className = "report-quoted-label";
  caption.textContent = label;
  const list = doc.createElement("ul");
  list.className = "report-quoted";
  for (const line of lines) {
    const item = doc.createElement("li");
    const fenced = doc.createElement("code");
    fenced.setAttribute(NOT_OURS, "");
    // `textContent` on a node of its own. Not escaped, not quoted, not filtered:
    // there is nothing for a delimiter in `line` to re-pair with, because `line`
    // is never adjacent to any syntax of ours.
    fenced.textContent = line;
    item.append(fenced);
    list.append(item);
  }
  host.append(caption, list);
}

/** Add more of our own prose to a report without disturbing what is quoted in it. */
export function alsoSay(report: SiteReport, more: SiteText): SiteReport {
  const text = joinSiteText(report.text, more);
  return report.quoted ? { text, quotedLabel: report.quotedLabel, quoted: report.quoted } : { text };
}

/**
 * An error whose message this runtime wrote, and can therefore show the guest.
 *
 * Anything that is not one of these is reported in our own words instead, with
 * only its kind in the trace. That rule closed a router's HTTP error BODY being
 * rendered in the deli's voice, and a validator message that interpolated a
 * model-chosen argument name.
 *
 * It carries a `report`, not just a string, so an error that has to show someone
 * else's words can do so without them ever being joined to ours. `siteMessage`
 * remains, and is OUR prose only: a surface still rendering just `siteMessage`
 * as text shows less, never more, which is the right way for a caller that has
 * not been updated to be wrong.
 */
export class RuntimeMessage extends Error {
  readonly siteMessage: SiteText;
  readonly report: SiteReport;
  constructor(message: SiteText | SiteReport) {
    const report: SiteReport = typeof message === "string" ? { text: message } : message;
    super(report.text);
    this.name = "RuntimeMessage";
    this.siteMessage = report.text;
    this.report = report;
  }
}
