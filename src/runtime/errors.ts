/**
 * Text this runtime is willing to say in the deli's own voice.
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
export function ours(literal: string): SiteText {
  return literal as SiteText;
}

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

/** Concatenate site text. Both halves are already ours, so the result is too. */
export function joinSiteText(...parts: (SiteText | string)[]): SiteText {
  return parts.join("") as SiteText;
}

/**
 * The network validator interpolates names out of a network definition into its
 * messages (`Agent 'x' references missing tool 'y'.`). Those come from OUR
 * published file today, but the same validator runs over a peer's network when a
 * composition is loaded, and a peer's agent could be named with a sentence. Every
 * quoted interpolation that is not token-shaped is replaced before the message
 * reaches the page.
 *
 * Lives here, beside `TOKEN`, rather than in `boot.ts`, because two callers now
 * need it: the startup path and the composition loader. `boot.ts` re-exports it,
 * so its original import path still works.
 */
export function quotedTokensOnly(message: string): string {
  return message.replace(/'([^']*)'/g, (_m, inner: string) => (TOKEN.test(inner) ? `'${inner}'` : "'<name omitted>'"));
}

/**
 * An error whose message this runtime wrote, and can therefore show the guest.
 *
 * Anything that is not one of these is reported in our own words instead, with
 * only its kind in the trace. That rule closed a router's HTTP error BODY being
 * rendered in the deli's voice, and a validator message that interpolated a
 * model-chosen argument name.
 */
export class RuntimeMessage extends Error {
  readonly siteMessage: SiteText;
  constructor(message: SiteText) {
    super(message);
    this.name = "RuntimeMessage";
    this.siteMessage = message;
  }
}
