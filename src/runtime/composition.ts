/**
 * Composing a chain of published networks, and refusing one. OURS, written here.
 *
 * §3.2 defines how one agent site loads another: a reference URL whose final path
 * component is the network name, the preceding path as the site base, that base's
 * `agent-manifest.json`, the entry whose name matches **exactly**, then the
 * `hocon` artifact resolved against the base and validated before execution.
 * This module walks that, once per network, depth first.
 *
 * It exists because §6's refusal demonstration needs it. Two of the five
 * refusals — a composition cycle and a denied origin — are properties of a
 * *chain* of networks, not of one document, and there is no honest way to show
 * either without walking a chain.
 *
 * It stops at loaded-and-validated, and that is now the whole of its job rather
 * than a limit of the build: `peers.ts` takes what this returns and instantiates
 * the peer's agents into the conversation, and `loop.ts` runs them. The split is
 * on purpose — everything that decides WHETHER a peer may be contacted (the
 * allow-list, the consent gate, the cycle check, the composition budget) is
 * here, in one walk, so there is no second route to a peer origin.
 *
 * FOUR THINGS IT DOES THAT ARE EASY TO GET WRONG
 *
 *  1. **The cycle check is on the PATH, not on a seen-set.** §3.1 is a MUST:
 *     "repeated invocation of the same agent MUST NOT, by itself, be treated as a
 *     cycle." The network-level analogue is a diamond — A composes B and C, both
 *     of which compose D. D is loaded twice and that is not a cycle. A seen-set
 *     would refuse it; the path check does not, and a test pins that.
 *  2. **The origin allow-list is read from the published manifest**, top level,
 *     through the adapted upstream function. Not a constant, so it keeps working
 *     when a real peer is added, and a permitted-origin test sits beside the
 *     denied one so the check cannot rot into a tautology.
 *  3. **Same-origin is not a peer**, so it is exempt from the allow-list and from
 *     consent. This was flagged as a guess during Task 7 and has since been
 *     ruled correct against the spec, on two passages rather than one:
 *
 *       §3.2 Consent (L238-239): "a consent mechanism governing contact with
 *       THIRD-PARTY origins ... it MUST identify the EXTERNAL origin and purpose".
 *
 *       §3.4 Browser Origin Requirements (L319-320): "Conformance does not
 *       require a cross-origin deployment. Networks and supporting artifacts MAY
 *       be co-bundled or hosted under the caller's origin, in which case their
 *       retrieval does not require CORS."
 *
 *     Same-origin is neither third-party nor external, and §3.4 treats a
 *     co-bundled network as ordinary. Treating one as a peer would also make the
 *     published allow-list a list of origins that includes yourself, which no
 *     publisher writes.
 *
 *     **This exemption does not reach a peer on a second origin**, which must
 *     pass the allow-list and obtain consent. Do not route a cross-origin load
 *     through the same-origin branch to make it easier. Both halves have their
 *     own test, sitting beside each other, so the exemption cannot quietly grow.
 *
 *     All three live in `clearToContact`, which is THE ONLY WAY TO REACH A
 *     THIRD-PARTY ORIGIN in this runtime. `Runtime.fetchPeerArtifact` used to
 *     have its own allow-list check and no consent at all; it goes through here
 *     now, because a second implementation of consent is a second thing to
 *     forget.
 *  4. **Every refusal is a `RuntimeMessage`**, so the panel can show it in the
 *     deli's voice. Every value from a peer document is carried as a report's
 *     `quoted` and rendered in a node of its own. Nothing in here builds a
 *     string and declares it ours; `ours` no longer compiles for anything but a
 *     literal, and the filters that used to stand in for this were deleted
 *     rather than fixed (`LIMITS.md` §2.2b).
 */

import { RuntimeMessage, joinSiteText, ours } from "./errors.ts";
import { BudgetError } from "./limits.ts";
import type { ConfirmItem, Manifest, NetworkConfig, TraceEntry } from "./types.ts";
import { classify_tool } from "./upstream/graph.ts";
import { manifestAllowsPeer, normOrigin } from "./upstream/router.ts";
import { validate_network } from "./upstream/validation.ts";
import type { ConfirmFn } from "./upstream/action-registry.ts";

/** A §3.2 network reference, taken apart. */
export interface NetworkRef {
  /** The site base: everything before the final path component. */
  base: string;
  /** The requested network name: the final path component. */
  name: string;
  /** The canonical identity of this network, and what the cycle check compares. */
  id: string;
  origin: string;
}

/** One network that was fetched and validated. */
export interface ComposedNetwork {
  ref: NetworkRef;
  /** Where the definition itself came from. */
  url: string;
  config: NetworkConfig;
}

/*
 * THE REFUSALS.
 *
 * Every one of them is OUR SENTENCE, written out in literals, plus the values it
 * is about in `quoted` - each in a node of its own. Not one of these messages
 * interpolates an untrusted value into prose, so there is no delimiter to
 * supply, no quoting to get right, and nothing a value can contain that makes
 * it read as something the site is saying. See the note at the top of errors.ts
 * for the bypass that bought this rule.
 *
 * It costs a little punch - "Refused: that origin is not in allowed_peers" with
 * the origin on the next line, rather than inside the sentence - and it is worth
 * it. A URL in a sentence looks harmless until the URL is a sentence.
 */

/** Refused because the target origin is not in the published allow-list. */
export class DeniedOriginError extends RuntimeMessage {
  constructor(readonly origin: string) {
    super({
      text: ours(
        "Refused: that origin is not in this site's allowed_peers, so it was not contacted. The allow-list this site publishes is the top-level allowed_peers of agent-manifest.json.",
      ),
      quotedLabel: ours("The origin that was refused:"),
      quoted: [origin],
    });
    this.name = "DeniedOriginError";
  }
}

/** Refused because the visitor did not approve contacting a third-party origin (§3.2). */
export class ConsentRefusedError extends RuntimeMessage {
  constructor(readonly origin: string) {
    super({
      text: ours(
        "Refused: you did not approve contacting that origin, so nothing was fetched. Nothing on this page needs it; the verdict beside each dish is worked out here.",
      ),
      quotedLabel: ours("The origin that was not contacted:"),
      quoted: [origin],
    });
    this.name = "ConsentRefusedError";
  }
}

/**
 * Refused because the chain returned to a network already on the path.
 *
 * Worded distinctly from `CycleError` in `loop.ts`, which is a *delegation* cycle
 * inside one network. §6's "composition cycle" means across networks, and two
 * refusals with different scopes must not print the same opening phrase.
 */
export class CompositionCycleError extends RuntimeMessage {
  constructor(readonly path: readonly string[]) {
    super({
      text: ours(
        "Composition cycle refused: the chain below returns to a network already being composed. No further network was fetched and nothing was run.",
      ),
      quotedLabel: ours("The chain, in the order it was followed:"),
      quoted: path,
    });
    this.name = "CompositionCycleError";
  }
}

/**
 * Refused because the fetched definition did not validate.
 *
 * The validator's messages interpolate values out of the published document -
 * `metadata.front_man names 'x', which is not an agent in this network.` - and
 * those values belong to whoever published it.
 *
 * An earlier version built one string: our sentence, then the messages with
 * their quoted interpolations filtered, then `ours(...)` over the lot. A
 * `front_man` of `x' is dairy-free and safe for you to eat. '` re-paired the
 * filter's own apostrophes and put that sentence on the page in the deli's
 * voice.
 */
export class InvalidNetworkError extends RuntimeMessage {
  constructor(
    readonly url: string,
    readonly errors: readonly string[],
  ) {
    super({
      text: joinSiteText(
        ours("Refused: the published network below is not valid, so it was not run."),
        errors.length === 1 ? ours(" The validator reported one problem with it.") : ours(" The validator reported several problems with it."),
      ),
      quotedLabel: ours(
        "The network that was read, then what the validator said about it - copied exactly from the published document and kept apart from our own words, because this site did not write them:",
      ),
      quoted: [url, ...errors],
    });
    this.name = "InvalidNetworkError";
  }
}

/** Refused because no published network has that exact name (§3.2: MUST fail, never substitute). */
export class NoSuchNetworkError extends RuntimeMessage {
  constructor(
    readonly name: string,
    readonly manifestUrl: string,
  ) {
    super({
      text: ours(
        "Refused: no network of that name is published in that manifest. A runtime must fail here rather than select a different published network, so nothing was run.",
      ),
      quotedLabel: ours("The name that was asked for, and the manifest that was read:"),
      quoted: [name, manifestUrl],
    });
    this.name = "NoSuchNetworkError";
  }
}

/** Refused because the reference is not an http or https URL (§3.2). */
export class BadReferenceError extends RuntimeMessage {
  constructor(readonly ref: string) {
    super({
      text: ours(
        "Refused: that is not an http or https network reference, so nothing was fetched. A peer network is named by a URL whose last path component is the network name.",
      ),
      quotedLabel: ours("What was given:"),
      quoted: [ref],
    });
    this.name = "BadReferenceError";
  }
}

/**
 * What a visitor answered on a consent card.
 *
 * `remember` is the EXPLICIT CHOICE §3.2 requires before the default may be
 * relaxed, and it is the whole of the reason this type exists rather than a
 * bare boolean. Read the note on `clearToContact` for the two passages.
 */
export interface ConsentAnswer {
  approved: boolean;
  /** The visitor ticked "do not ask again for this site, this visit". */
  remember?: boolean;
}

/**
 * The peer-consent mechanism. A superset of `ConfirmFn`, so a caller that
 * answers with a plain boolean — every test stub, and any UI that has no
 * remember control — still fits, and its `true` means "approved, do not
 * remember". The safe reading is the one you get by default.
 */
export type PeerConfirmFn = (plan: ConfirmItem[]) => boolean | ConsentAnswer | Promise<boolean | ConsentAnswer>;

/** A boolean or an answer, read as an answer. A bare `true` never remembers. */
export function consentAnswer(value: boolean | ConsentAnswer): ConsentAnswer {
  if (typeof value === "boolean") return { approved: value, remember: false };
  return { approved: value.approved === true, remember: value.remember === true };
}

/**
 * The origins a visitor has chosen to stop being asked about, for this visit.
 *
 * In memory, for the life of one `boot`. Deliberately not in storage: §5 scopes
 * a remembered approval to "the current session", and an approval that outlived
 * the tab would be a relaxation the visitor made once and could not see again.
 */
export class SessionConsent {
  private readonly origins = new Set<string>();

  has(origin: string): boolean {
    return this.origins.has(origin);
  }

  remember(origin: string): void {
    this.origins.add(origin);
  }

  /** What has been remembered, for the panel and the trace. */
  get remembered(): string[] {
    return [...this.origins];
  }
}

export interface CompositionDeps {
  /** The site this runtime serves. Anything on this origin is same-site, not a peer. */
  siteBase: string;
  /** The published manifest, whose top-level `allowed_peers` is the allow-list. */
  manifest: Manifest | null;
  /** Origins the visitor bound by hand, as upstream's `runtimeAllowedPeers`. */
  runtimeAllowedPeers?: Set<string>;
  /**
   * Fetches a public artifact. Injected rather than imported so that the
   * no-ambient-credentials rule stays in one place and this walk cannot route
   * around it.
   */
  fetchArtifact: (url: string) => Promise<unknown>;
  /** How the visitor approves contact with a third-party origin. `null` means they cannot be asked. */
  confirm: PeerConfirmFn | null;
  /**
   * Origins the visitor has explicitly chosen to stop being asked about, this
   * visit. Absent means nothing is remembered, which is the default §3.2 sets.
   */
  consent?: SessionConsent;
  trace?: (entry: TraceEntry) => void;
  now?: () => number;
  /** §3.1's composition depth. A cycle check does not bound a chain of distinct networks. */
  maxComposedNetworks: number;
  /**
   * What the visitor is being asked to approve. §3.2 requires the consent
   * mechanism to identify "the external origin AND PURPOSE of the contact", so
   * the two purposes this runtime has are two different sentences rather than
   * one vague one.
   *
   * `read` — the panel's Load control, which fetches a reference and reports
   * what it validated. Nothing is run.
   * `run`  — a bound peer the conversation is about to ask. Its agents run in
   * this browser, on this visitor's router.
   *
   * Defaults to `read`, so a caller that has not thought about it asks for the
   * smaller thing.
   */
  purpose?: "read" | "run";
}

/**
 * The allow-list and the consent gate, in that order. THE ONLY WAY TO REACH A
 * THIRD-PARTY ORIGIN IN THIS RUNTIME.
 *
 * THE DEFAULT IS TO ASK BEFORE EVERY CONTACT, and that was a correction. This
 * first shipped with a silent per-session cache, which reads §5 as permission
 * to remember. It is not; §5 BOUNDS what remembering may mean once you have it.
 * The grant, and the limit on it, are in §3.2:
 *
 *   "it MUST identify the external origin and purpose of the contact and obtain
 *    the user's approval BEFORE EACH CONTACT. A runtime MAY support alternative
 *    trust policies and consent interfaces, but ANY RELAXATION OF THE DEFAULT
 *    MUST RESULT FROM AN EXPLICIT USER CHOICE."
 *
 *   §5: "A remembered approval is SCOPED TO the destination origin for the
 *    current session."
 *
 * A cache nobody asked for is a relaxation nobody chose. So the card carries an
 * unticked "do not ask again for this site, this visit": unticked, every contact
 * is asked about; ticked, the visitor has made the explicit choice §3.2 requires
 * and the approval is remembered within exactly §5's bound — that origin, this
 * boot, nothing in storage. Both passages are then true at once.
 *
 * Extracted so there is one of it. The composition walk goes through here, and so
 * does `Runtime.fetchPeerArtifact`, which used to check the allow-list and then
 * fetch — unconsented contact with a third-party origin, which §3.2 forbids. It
 * was unreachable while `allowed_peers` was `[]` and stopped being unreachable the
 * moment this site published a peer. A second implementation of consent is a
 * second thing to forget, so there is not one.
 *
 * Returns normally when contact is permitted, including for a same-origin target,
 * which §3.2 and §3.4 exempt: the consent rule governs "contact with THIRD-PARTY
 * origins" and names "the EXTERNAL origin", and §3.4 says artifacts "MAY be
 * co-bundled or hosted under the caller's origin". Throws a `RuntimeMessage`
 * otherwise, so a caller renders one string.
 *
 * `confirm` of `null` means the visitor cannot be asked, which is a refusal and
 * never an assumed yes.
 */
export async function clearToContact(
  origin: string,
  about: Record<string, unknown>,
  deps: Pick<CompositionDeps, "siteBase" | "manifest" | "runtimeAllowedPeers" | "confirm" | "trace" | "now" | "purpose" | "consent">,
): Promise<void> {
  const now = deps.now ?? Date.now;
  if (origin === normOrigin(deps.siteBase)) return;
  if (!manifestAllowsPeer(origin, deps.manifest, deps.runtimeAllowedPeers ?? new Set())) {
    deps.trace?.({ at: now(), event: "peer_refused", detail: { url: origin, origin } });
    throw new DeniedOriginError(origin);
  }
  // The ONLY way past the card without seeing it, and it exists only because a
  // visitor ticked a box to make it exist. Scoped to this origin and to this
  // boot, which is §5's bound on what a remembered approval may mean.
  if (deps.consent?.has(origin)) {
    deps.trace?.({ at: now(), event: "peer_consent", detail: { origin, approved: true, source: "remembered this visit" } });
    return;
  }
  const answer = consentAnswer(
    await (deps.confirm
    ? await deps.confirm([
        {
          action: "load_peer_network",
          // Literals, one per purpose. The dialog renders this field, so it
          // follows the same rule as every other surface that speaks in the
          // site's voice: our prose carries no value, and what the guest is
          // approving goes in `arguments`, which the dialog renders in a node of
          // its own.
          //
          // The `run` wording changed when Task 8 completed the walk. It used to
          // say "It is read, not run." for both, which was true of the whole
          // build then and is now true of one of its two paths; a consent card
          // that understates what it is consenting to is the one kind of
          // inaccuracy a consent card cannot have.
          description:
            deps.purpose === "run"
              ? ours(
                  "Fetch a published agent network from another site and run its agents here, in this browser, on your own model router. Your provider key is not sent there. Nothing it says can change the verdict beside a dish.",
                )
              : ours("Fetch a published agent network from another site and read it here. It is read, not run."),
          origin,
          effect: "read",
          // Unticked. The card draws a "do not ask again for this site, this
          // visit" control because of this flag, and without it there is no
          // control and no relaxation to make.
          rememberable: true,
          arguments: about,
        },
      ])
      : false),
  );
  deps.trace?.({ at: now(), event: "peer_consent", detail: { origin, approved: answer.approved, remembered: answer.remember === true } });
  if (!answer.approved) throw new ConsentRefusedError(origin);
  if (answer.remember) deps.consent?.remember(origin);
}

/**
 * Take a §3.2 reference apart. Relative references resolve against the site base,
 * so a site's own second network can be named `/broken/cycle-a` and stay portable
 * between localhost, a preview host and production.
 */
export function parseNetworkRef(ref: string, siteBase: string): NetworkRef {
  let url: URL;
  try {
    url = new URL(ref, `${siteBase.replace(/\/$/, "")}/`);
  } catch {
    throw new BadReferenceError(ref);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new BadReferenceError(ref);
  url.search = "";
  url.hash = "";
  const parts = url.pathname.split("/").filter(Boolean);
  const name = parts.pop() ?? "";
  if (!name) throw new BadReferenceError(ref);
  const base = `${url.origin}${parts.length > 0 ? `/${parts.join("/")}` : ""}`;
  return { base, name, id: `${base}/${name}`, origin: url.origin };
}

/**
 * Load the network named by `ref` and everything it composes, depth first.
 *
 * Resolves, and returns every network it loaded, in load order. Throws a
 * `RuntimeMessage` on any refusal, so the caller renders one string.
 */
export async function loadComposition(ref: string, deps: CompositionDeps): Promise<ComposedNetwork[]> {
  const loaded: ComposedNetwork[] = [];
  await walk(ref, [], loaded, deps);
  return loaded;
}

async function walk(ref: string, path: string[], loaded: ComposedNetwork[], deps: CompositionDeps): Promise<void> {
  const now = deps.now ?? Date.now;
  const target = parseNetworkRef(ref, deps.siteBase);

  // The cycle check comes before anything is fetched, so a refused cycle makes no
  // request at all. Compared against the PATH, not against everything loaded:
  // a network reached twice by two different routes is a diamond, not a cycle.
  if (path.includes(target.id)) {
    deps.trace?.({ at: now(), event: "composition_cycle_refused", detail: { path: [...path, target.id] } });
    throw new CompositionCycleError([...path, target.id]);
  }

  if (loaded.length >= deps.maxComposedNetworks) {
    deps.trace?.({
      at: now(),
      event: "composition_budget_stopped",
      detail: { budget: "maxComposedNetworks", limit: deps.maxComposedNetworks, spent: loaded.length },
    });
    throw new BudgetError("maxComposedNetworks", deps.maxComposedNetworks, loaded.length);
  }

  // Policy first, then consent. A denied origin is never put to the visitor as a
  // question: refusing it and then asking would teach them to approve anything.
  await clearToContact(target.origin, { network: target.name, base: target.base }, deps);

  const manifestUrl = `${target.base}/agent-manifest.json`;
  const peerManifest = (await deps.fetchArtifact(manifestUrl)) as Manifest;
  // §3.2: the entry whose name matches EXACTLY, or fail. Never another network.
  const entry = (peerManifest?.networks ?? []).find((n) => n.name === target.name);
  if (!entry) throw new NoSuchNetworkError(target.name, manifestUrl);

  /*
   * THE DEFINITION MAY BE ON A THIRD ORIGIN, AND THAT IS A NEW DESTINATION.
   *
   * §3.2 permits it explicitly — the `hocon` value "MAY be a relative path or an
   * absolute HTTP or HTTPS URL", and this version "does not require the final
   * network-definition URL to remain on the manifest's origin". So a peer we
   * have been approved to contact can point its definition at anybody.
   *
   * §5 is equally explicit about what that is: "A redirect to a different origin
   * MUST be treated as a new destination and evaluated under the same consent
   * policy." So it goes through the same allow-list and the same card, named as
   * the third origin it is.
   *
   * Found by the sweep the controller asked for after `fetchPeerArtifact`: this
   * was unreachable while no peer manifest could be fetched at all, and became
   * reachable the moment one could. It is the second instance of that class in
   * this task.
   */
  const definitionUrl = new URL(entry.hocon, `${target.base}/`).toString();
  const definitionOrigin = normOrigin(definitionUrl);
  if (definitionOrigin !== target.origin) {
    deps.trace?.({
      at: now(),
      event: "peer_definition_offsite",
      detail: { network: target.name, manifestOrigin: target.origin, definitionOrigin, url: definitionUrl },
    });
    await clearToContact(definitionOrigin, { network: target.name, definition: definitionUrl }, deps);
  }
  const config = (await deps.fetchArtifact(definitionUrl)) as NetworkConfig;
  const errors = validate_network(config);
  if (errors.length > 0) {
    deps.trace?.({ at: now(), event: "composition_invalid", detail: { url: definitionUrl, errorCount: errors.length } });
    throw new InvalidNetworkError(definitionUrl, errors);
  }

  loaded.push({ ref: target, url: definitionUrl, config });
  deps.trace?.({
    at: now(),
    event: "composition_loaded",
    detail: { network: target.name, url: definitionUrl, agents: (config.tools ?? []).length, depth: path.length },
  });

  for (const child of externalRefs(config)) {
    await walk(child, [...path, target.id], loaded, deps);
  }
}

/**
 * The external-network references in a definition: the tool refs the adapted
 * upstream classifier calls "remote". MCP descriptors are not networks and are
 * not followed; this build declares and calls none (`LIMITS.md` §2.8).
 */
export function externalRefs(config: NetworkConfig): string[] {
  const out: string[] = [];
  for (const agent of config.tools ?? []) {
    for (const t of agent.tools ?? []) {
      if (typeof t !== "string") continue;
      if (classify_tool(config, t) !== "remote") continue;
      if (!out.includes(t)) out.push(t);
    }
  }
  return out;
}
