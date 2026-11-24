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
 * published agent's NAME in the site's voice. Agent names are not ours: since
 * Task 8 this site loads a peer network from a second origin, and a peer author
 * chooses that string. `Hollis & Rye — Asked The Reuben is dairy-free and safe
 * for you.` needed no mutation at all, only a peer that named an agent with a
 * sentence.
 *
 * So `SiteText` is a branded type. The literal parts of a `siteText` template come
 * from our own source and are trusted, and every interpolated value must be a
 * NUMBER — the token filter this paragraph used to describe was deleted rather
 * than fixed, because a value supplying its own delimiter defeated it. A call
 * site that passes a raw string to one of those surfaces does not compile; a
 * value that must be shown goes in a node, through `theirs` or `datum`.
 *
 * This is the same shape as the verdict cards' fix: a signature, not a rule someone
 * has to remember.
 */

/** A string this runtime composed. Cannot be produced by a cast from user data. */
export type SiteText = string & { readonly __siteText: unique symbol };

/**
 * Compose site text from literals and NUMBERS.
 *
 * It used to take `unknown` and token-filter each value, on the premise that a
 * string with no whitespace in it cannot form a sentence. `prettyToken` then
 * swapped underscores for spaces on the way out, and handed the whitespace back:
 *
 *   agent name: the_reuben_is_dairy_free_and_safe_to_eat
 *   rendered:   Hollis & Rye — Asked the reuben is dairy free and safe to eat.
 *
 * That name passes `validate_agent_names` (it matches `^[A-Za-z0-9_.:-]+$` and is
 * under 64 characters), passed the filter, and our OWN claim detector reads the
 * result as `reuben:dairy:dairy free`. Fourth instance of one problem, after
 * action arguments, agent names and `front_man` via quote re-pairing.
 *
 * So the capability is gone rather than repaired. **A value cannot be
 * interpolated into a sentence at all**, because there is no longer a function
 * that will do it: `siteText` accepts `number` and nothing else, and the compiler
 * enforces that. A number has no letters and no spaces, so no number forms a
 * sentence — `NaN` and `Infinity` included.
 *
 * Anything else that must be shown goes in a NODE, via `theirs` or `datum` and
 * `renderPhrase`. There is one way to show a value, and it is structural.
 *
 *   siteText`Limit ${16}.`        →   "Limit 16."
 *   siteText`Asked ${name}.`      →   does not compile
 */
export function siteText(strings: TemplateStringsArray, ...values: number[]): SiteText {
  let out = strings[0] ?? "";
  for (let i = 0; i < values.length; i += 1) out += String(values[i]) + (strings[i + 1] ?? "");
  return out as SiteText;
}

/**
 * Mark a string literal written in this repository as site text.
 *
 * **It accepts a literal and nothing else, and the compiler enforces that.**
 * `ours(someVariable)` does not compile; neither does `ours("a" + b)`, nor an
 * interpolated template, nor an `any`, nor a `` `${string}` `` template-literal
 * type, nor a generic wrapper that keeps `T` in an inference position.
 *
 * This is the door the `front_man` bypass came through. The old signature took
 * `string`, so `ours(errors.map(filter).join("\n• "))` compiled — a built string,
 * declared ours by assertion. Filtering it first was the mistake; the only safe
 * thing to declare ours is text that is literally in this repository.
 */
export function ours<T extends string>(literal: LiteralOnly<T>): SiteText {
  return literal as unknown as SiteText;
}

/**
 * `T` when `T` is a string LITERAL type, and `never` once it has widened to
 * `string`. Written as an intersection rather than a bare conditional so that
 * `T` stays in an inference position.
 */
type LiteralOnly<T extends string> = T & (string extends T ? never : unknown);

/**
 * How much of a foreign value is shown, and how many of them.
 *
 * **These are UI measures. They are NOT a security control, and nothing should
 * ever be written that depends on them for safety.** What keeps a value out of
 * the site's voice is the structural separation above, which does not care how
 * long the string is or how many there are — raise these to a million and the
 * safety property is identical. They exist so that a peer cannot use our refusal
 * panel as a billboard, which is a layout problem.
 *
 * This distinction is written down because this project has already been bitten
 * by a defence that everyone trusted for the wrong reason: `quotedTokensOnly`
 * was read as the thing keeping a peer's prose out of the deli's voice, and it
 * was defeated by one apostrophe. If a later reader decides the cap is the
 * defence and raises it, nothing breaks — and that is the point.
 */
export const QUOTED_CHARS_MAX = 240;
export const QUOTED_LINES_MAX = 12;

/**
 * A value rendered in a node of its own, never inside a sentence.
 *
 * Two kinds, because attribution has to be truthful and "not ours" would be a lie
 * about our own menu:
 *
 *  - `theirs(v)` — a stranger's string: a peer's agent name, a model's phrase, a
 *    provider's code. Marked `data-not-ours`, and the tests' notion of "the
 *    site's voice" is the page with every one of these removed.
 *  - `datum(v)` — our own published data shown as a value: a dish name, a request
 *    id, an action name. Marked `data-site-data`. Still a node, so it still
 *    cannot form a sentence; the separate attribute exists so a caption can say
 *    whose words a block is without lying.
 *
 * Both carry the same guarantee, which is the only one that matters: the value is
 * a node, so nothing it contains can be read as part of our prose.
 */
export interface ValueNode {
  readonly value: string;
  readonly ours: boolean;
}

export function theirs(value: unknown): ValueNode {
  return { value: String(value ?? ""), ours: false };
}

export function datum(value: unknown): ValueNode {
  return { value: String(value ?? ""), ours: true };
}

/** Our prose and the values it is about, in reading order. */
export type SitePhrase = readonly (SiteText | ValueNode)[];

/** Marks a node whose content is NOT the site speaking. */
export const NOT_OURS = "data-not-ours";
/** Marks a node holding the site's own data, shown as a value rather than as prose. */
export const SITE_DATUM = "data-site-data";

/**
 * Render a phrase: our prose as text, every value as its own `<code>`.
 *
 * Inline-block nodes, so the line still reads as a line. The point is not how it
 * looks; it is that there is no code path by which `value` becomes part of a
 * string we have called ours.
 */
export function renderPhrase(doc: Document, host: HTMLElement, phrase: SitePhrase): void {
  host.replaceChildren();
  for (const part of phrase) {
    if (typeof part === "string") {
      host.append(doc.createTextNode(part));
      continue;
    }
    const node = doc.createElement("code");
    node.className = part.ours ? "site-datum" : "not-ours";
    node.setAttribute(part.ours ? SITE_DATUM : NOT_OURS, "");
    node.textContent = part.value.slice(0, QUOTED_CHARS_MAX);
    host.append(node);
  }
}

/**
 * Concatenate site text. Every part is already ours, so the result is too.
 *
 * It used to accept `string` as well, which made it a second way to declare a
 * built string ours. There is no longer any way to filter a runtime string into
 * our prose: `siteText` interpolates only numbers, and `joinTokens`,
 * `prettyToken` and `tokenOrOmitted` were deleted rather than fixed, because a
 * filter is defeated by supplying whatever it strips. A caller holding a raw
 * string passes it to `theirs()` or `datum()`, which render it in its own node.
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
  for (const line of lines.slice(0, QUOTED_LINES_MAX)) {
    const item = doc.createElement("li");
    const fenced = doc.createElement("code");
    fenced.setAttribute(NOT_OURS, "");
    // `textContent` on a node of its own. Not escaped, not quoted, not filtered:
    // there is nothing for a delimiter in `line` to re-pair with, because `line`
    // is never adjacent to any syntax of ours.
    fenced.textContent = line.slice(0, QUOTED_CHARS_MAX);
    item.append(fenced);
    // The note that something was cut is OURS, so it goes in its own element
    // outside the not-ours node rather than being appended to the value.
    if (line.length > QUOTED_CHARS_MAX) {
      const note = doc.createElement("small");
      note.className = "report-shortened";
      note.textContent = "(shortened for display; the whole value is in the published document)";
      item.append(note);
    }
    list.append(item);
  }
  if (lines.length > QUOTED_LINES_MAX) {
    const more = doc.createElement("li");
    more.className = "report-shortened";
    more.textContent = `(${lines.length - QUOTED_LINES_MAX} further lines are not shown here)`;
    list.append(more);
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

/**
 * A value interpolated into an attribute SELECTOR, escaped.
 *
 * Menu and restriction ids are `[a-z0-9_]` today, but a selector built from data
 * must not depend on that staying true: one `"` or `]` in an id turns
 * `[data-item="${id}"]` into a different selector, or into a `SyntaxError` thrown
 * out of `querySelector` before the caller's own checks can run.
 *
 * It lives here, with one explanation, because it was in `verdict-cards.ts` with
 * the explanation and `actions.ts` built the same shape of selector without it.
 * `CSS.escape` where the environment has it, a conservative fallback where it does
 * not — this file has no module-scope DOM dependency and keeps none.
 */
export function cssEscape(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") return CSS.escape(value);
  return value.replace(/["'\\\]\[]/g, "\\$&");
}
