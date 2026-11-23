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
 * either without walking a chain. It deliberately stops at loaded-and-validated:
 * binding a peer network into the conversation is Task 8's, and `LIMITS.md` §2.8
 * says so.
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
 *  3. **Same-origin is not a peer.** §3.2's consent requirement governs "contact
 *     with third-party origins". A site's own second network is not a third
 *     party, and treating it as one would make the published allow-list a list of
 *     origins including yourself, which no publisher writes.
 *  4. **Every refusal is a `RuntimeMessage`**, so the panel can show it in the
 *     deli's voice, and every interpolated value — an origin, a URL, a network
 *     name, a validator message — comes from a peer document and is filtered.
 */

import { RuntimeMessage, joinSiteText, joinTokens, ours, quotedTokensOnly, siteText, tokenOrOmitted } from "./errors.ts";
import { BudgetError } from "./limits.ts";
import type { Manifest, NetworkConfig, TraceEntry } from "./types.ts";
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

/** Refused because the target origin is not in the published allow-list. */
export class DeniedOriginError extends RuntimeMessage {
  constructor(readonly origin: string) {
    super(
      joinSiteText(
        siteText`Refused: ${origin} is not in this site's allowed_peers, so it was not contacted.`,
        ours(" The allow-list this site publishes is the top-level allowed_peers of agent-manifest.json."),
      ),
    );
    this.name = "DeniedOriginError";
  }
}

/** Refused because the visitor did not approve contacting a third-party origin (§3.2). */
export class ConsentRefusedError extends RuntimeMessage {
  constructor(readonly origin: string) {
    super(
      joinSiteText(
        siteText`Refused: you did not approve contacting ${origin}, so nothing was fetched.`,
        ours(" Nothing on this page needs it; the verdict beside each dish is worked out here."),
      ),
    );
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
  constructor(readonly path: string[]) {
    super(
      joinSiteText(
        ours("Composition cycle refused: "),
        joinTokens(path, " → "),
        ours(". That chain returns to a network already being composed. No further network was fetched and nothing was run."),
      ),
    );
    this.name = "CompositionCycleError";
  }
}

/** Refused because the fetched definition did not validate. Names each offending field. */
export class InvalidNetworkError extends RuntimeMessage {
  constructor(
    readonly url: string,
    readonly errors: string[],
  ) {
    super(
      joinSiteText(
        siteText`Refused: the network at ${url} is not valid and was not run:`,
        // Each validator message's own literal text is ours; its quoted
        // interpolations come from the peer's document and are filtered first.
        // Same shape as the startup path's handling of the same strings.
        ours(`\n• ${errors.map(quotedTokensOnly).join("\n• ")}`),
      ),
    );
    this.name = "InvalidNetworkError";
  }
}

/** Refused because no published network has that exact name (§3.2: MUST fail, never substitute). */
export class NoSuchNetworkError extends RuntimeMessage {
  constructor(
    readonly name: string,
    readonly manifestUrl: string,
  ) {
    super(
      joinSiteText(
        siteText`Refused: no network named '${name}' is published in ${manifestUrl}.`,
        ours(" A runtime must fail here rather than select a different published network, so nothing was run."),
      ),
    );
    this.name = "NoSuchNetworkError";
  }
}

/** Refused because the reference is not an http or https URL (§3.2). */
export class BadReferenceError extends RuntimeMessage {
  constructor(readonly ref: string) {
    super(
      joinSiteText(
        siteText`Refused: '${ref}' is not an http or https network reference, so nothing was fetched.`,
        ours(" A peer network is named by a URL whose last path component is the network name."),
      ),
    );
    this.name = "BadReferenceError";
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
  confirm: ConfirmFn | null;
  trace?: (entry: TraceEntry) => void;
  now?: () => number;
  /** §3.1's composition depth. A cycle check does not bound a chain of distinct networks. */
  maxComposedNetworks: number;
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
  const sameSite = target.origin === normOrigin(deps.siteBase);
  if (!sameSite) {
    if (!manifestAllowsPeer(target.id, deps.manifest, deps.runtimeAllowedPeers ?? new Set())) {
      deps.trace?.({ at: now(), event: "peer_refused", detail: { url: target.id, origin: target.origin } });
      throw new DeniedOriginError(target.origin);
    }
    const approved = deps.confirm
      ? await deps.confirm([
          {
            action: "load_peer_network",
            // The confirmation dialog renders this, and the network name came out
            // of a URL, so it is token-filtered like every other interpolation
            // into a surface the guest reads.
            description: `Fetch the published agent network "${tokenOrOmitted(target.name)}" from another site and read it here.`,
            origin: target.origin,
            effect: "read",
            arguments: { network: target.name, base: target.base },
          },
        ])
      : false;
    deps.trace?.({ at: now(), event: "peer_consent", detail: { origin: target.origin, approved } });
    if (!approved) throw new ConsentRefusedError(target.origin);
  }

  const manifestUrl = `${target.base}/agent-manifest.json`;
  const peerManifest = (await deps.fetchArtifact(manifestUrl)) as Manifest;
  // §3.2: the entry whose name matches EXACTLY, or fail. Never another network.
  const entry = (peerManifest?.networks ?? []).find((n) => n.name === target.name);
  if (!entry) throw new NoSuchNetworkError(target.name, manifestUrl);

  const definitionUrl = new URL(entry.hocon, `${target.base}/`).toString();
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
