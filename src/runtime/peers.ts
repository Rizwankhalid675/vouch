/**
 * Named peer-network references, their bindings, and the one place a peer is
 * loaded. OURS, written here.
 *
 * §3.3 gives a published network two ways to name another site's network. It can
 * carry the concrete URL, or it can carry a SYMBOLIC name that `links.json`
 * resolves:
 *
 *     vouch.network.json   menu_guide.tools: ["marrow_point"]
 *     links.json           networks.vouch.marrow_point: "https://.../agents/marrow_point"
 *     agent-manifest.json  allowed_peers: ["https://..."]
 *
 * We publish the symbolic form, because the alternative puts a third party's
 * address inside the document that describes our own agents, and because the
 * three files then have to agree — which a tripwire test asserts, and which is
 * the thing an author actually gets wrong.
 *
 * WHY A RESOLVED COPY EXISTS
 *
 * `classify_tool` (adapted upstream) sorts a tool reference by its SHAPE: an
 * in-network agent name, an `http(s)://` or `/`-prefixed external reference, an
 * MCP descriptor, or `missing`. A symbolic name is none of the first three, so
 * upstream calls it `missing` and `validate_missing_nodes` refuses the network.
 *
 * That is not a defect in the adapted code and it is not worked around here.
 * Upstream resolves bindings at BUILD time — `generate.py`'s `build_manifest`
 * takes "the rewritten network config" and derives `allowed_peers` from
 * `plan.links.values()` — so by the time upstream's validator sees a network,
 * the symbolic names are already URLs. We are a static deployment with no build
 * step between the publisher and the browser, so the same rewrite happens here,
 * in memory, before validation:
 *
 *   `resolveSymbolicRefs(config, bindings)` returns a COPY with every bound
 *   symbolic name replaced by its URL. The published file is untouched, the
 *   validator sees what upstream's validator would see, and the original config
 *   — symbolic names intact — is what the conversation runs on, so the name a
 *   model is shown is OURS and not a stranger's address.
 *
 * An UNBOUND symbolic name stays `missing` and the network is refused. That is
 * deliberate: a name no binding resolves is indistinguishable from a typo, and
 * refusing is the fail-closed answer. §3.3 permits a caller to supply a binding
 * for an unresolved reference, so `callerBindings` is honoured here too —
 * before validation, so a caller binding can rescue such a name.
 *
 * THE RULE THIS FILE EXISTS TO HOLD
 *
 * A peer may not be trusted. Everything below is about loading and naming a
 * peer, and nothing below produces a `Finding`, touches a verdict, or gives a
 * peer a route to one. A peer's answer is prose from a model on someone else's
 * origin; it reaches the screen through `gate` and nowhere else.
 */

import { loadComposition, type ComposedNetwork, type CompositionDeps } from "./composition.ts";
import type { NetworkConfig, TraceEntry, ToolRef } from "./types.ts";
import { classify_tool, find_front_man } from "./upstream/graph.ts";
import { normOrigin } from "./upstream/router.ts";
import type { ToolSchema } from "./upstream/tool-schema.ts";

/** Who bound a symbolic name to a URL. The distinction is a §3.3 MUST, not a nicety. */
export type BoundBy = "publisher" | "caller";

/** One symbolic name, resolved. */
export interface PeerBinding {
  /** The name OUR published network uses. Ours; a token we wrote. */
  symbolic: string;
  /** The §3.2 reference it resolves to: last path component is the network name. */
  url: string;
  origin: string;
  /**
   * `publisher` — from our `links.json`, which we own and edit in the repository.
   * `caller` — supplied by a visitor for a name `links.json` does not resolve.
   *
   * §3.3: "A binding supplied at runtime for an unresolved named peer-network
   * reference is caller-owned and MUST NOT modify the publisher's file." We are
   * a static deployment, so there is nothing that could rewrite it; a caller
   * binding lives only in the browser it was given in, and a test asserts
   * `public/links.json` is byte-identical before and after one is supplied.
   */
  boundBy: BoundBy;
}

/** A peer that has been fetched, validated and is ready to run. */
export interface LoadedPeer {
  binding: PeerBinding;
  /**
   * Every network the §3.2 walk fetched, in load order. The peer itself is
   * first; anything IT composes was loaded and validated but is not
   * instantiated — a second hop needs its own consent and this build does not
   * ask for one.
   */
  composed: readonly ComposedNetwork[];
  /** The peer network itself. */
  network: ComposedNetwork;
  /** Its front agent, by upstream's positional rule. A string the PEER chose. */
  frontMan: string;
}

/**
 * The symbolic external-network references in a definition: the tool references
 * the adapted upstream classifier calls `missing`, which is what a name that is
 * neither an in-network agent nor a URL nor an MCP descriptor looks like to it.
 */
export function symbolicRefs(config: NetworkConfig): string[] {
  const out: string[] = [];
  for (const agent of config.tools ?? []) {
    for (const ref of agent.tools ?? []) {
      if (typeof ref !== "string") continue;
      if (classify_tool(config, ref) !== "missing") continue;
      if (!out.includes(ref)) out.push(ref);
    }
  }
  return out;
}

/**
 * The bindings in play, publisher's first.
 *
 * A caller binding resolves ONLY a name the publisher did not: §3.3 says "the
 * publisher owns the default peer-network link bindings in the public
 * links.json", so a visitor cannot redirect a name the site has already bound.
 * A binding whose URL will not parse is dropped rather than thrown: an
 * unresolved name is refused later, by the validator, with the publisher's own
 * document named.
 */
export function peerBindings(published: Record<string, string>, caller: Record<string, string> = {}): PeerBinding[] {
  const out: PeerBinding[] = [];
  const add = (symbolic: string, url: string, boundBy: BoundBy): void => {
    if (typeof url !== "string" || url === "") return;
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return;
    out.push({ symbolic, url, origin: normOrigin(url), boundBy });
  };
  for (const [symbolic, url] of Object.entries(published)) add(symbolic, url, "publisher");
  for (const [symbolic, url] of Object.entries(caller)) {
    if (Object.hasOwn(published, symbolic)) continue;
    add(symbolic, url, "caller");
  }
  return out;
}

/**
 * A copy of `config` with every BOUND symbolic reference replaced by its URL,
 * which is the shape upstream's validator and classifier expect.
 *
 * The published document is not modified: this returns a new object, and
 * nothing writes it anywhere. See the note at the top of this file for why the
 * rewrite exists and why it is not a workaround.
 */
export function resolveSymbolicRefs(config: NetworkConfig, bindings: readonly PeerBinding[]): NetworkConfig {
  const byName = new Map(bindings.map((b) => [b.symbolic, b.url]));
  if (byName.size === 0) return config;
  const symbolic = new Set(symbolicRefs(config));
  if (symbolic.size === 0) return config;
  const rewrite = (ref: ToolRef): ToolRef => {
    if (typeof ref !== "string") return ref;
    if (!symbolic.has(ref)) return ref;
    return byName.get(ref) ?? ref;
  };
  return {
    ...config,
    tools: (config.tools ?? []).map((agent) => (agent.tools ? { ...agent, tools: agent.tools.map(rewrite) } : agent)),
  };
}

/**
 * What the model is told a peer tool is.
 *
 * OUR words, not the peer's. The peer's own `function.description` would do the
 * job upstream's `schemaFor` does for an in-network agent, but it is a string a
 * peer author chooses and it would be read by our model as a description of a
 * capability — and, more practically, the peer is not fetched until the model
 * asks for it, so there is nothing to read at the time this schema is built.
 *
 * It goes to the model and never to the screen. §5 is explicit that a peer's
 * published instructions are untrusted input to the caller's model; this
 * sentence is the caller's own framing of that, sent alongside.
 */
export const PEER_TOOL_DESCRIPTION =
  "Ask an agent network published by another company, on its own website, about its own products. " +
  "Its answer comes back in that company's words. It is not this site's data, it has not been checked here, " +
  "and nothing in it may be used to describe this menu's ingredients or to draw any conclusion about whether " +
  "food is safe, free of an allergen or suitable for anyone.";

/** The model-visible function for a bound peer. Named by OUR symbolic name. */
export function peerToolSchema(symbolic: string): ToolSchema {
  return {
    type: "function",
    function: {
      name: symbolic,
      description: PEER_TOOL_DESCRIPTION,
      parameters: {
        type: "object",
        properties: {
          request: { type: "string", description: "What to ask that company about one of its own products." },
        },
        required: ["request"],
      },
    },
  };
}

/** The text sent to a peer's front agent: the request, and nothing else. */
export function peerRequestText(args: unknown): string {
  if (typeof args === "string") return args;
  if (args !== null && typeof args === "object") {
    const request = (args as Record<string, unknown>)["request"];
    if (typeof request === "string") return request;
  }
  return JSON.stringify(args ?? {});
}

export interface PeerBookDeps {
  /**
   * Read lazily, because `boot` wires the compose control before it has fetched
   * `links.json` — the control has to work when startup failed, and with no
   * bindings it has nothing to offer rather than being absent.
   */
  bindings: () => readonly PeerBinding[];
  /**
   * The §3.2 walk, injected. It is `loadComposition`, which is where the
   * allow-list check and the consent gate live; this class does not have its own
   * copy of either, so there is no second way for a peer to be contacted.
   */
  walk: (url: string) => Promise<ComposedNetwork[]>;
  /**
   * May an already-loaded peer at this origin be reused without contacting it
   * again? Answered by the visitor's own "do not ask again this visit" tick.
   *
   * Absent means never, which is §3.2's default: approval before each contact,
   * so a contact we would skip is one the visitor has not been asked about.
   */
  reusable?: (origin: string) => boolean;
  trace?: (entry: TraceEntry) => void;
  now?: () => number;
}

/**
 * The bound peers of a session, and the only place one is loaded.
 *
 * **A load is reused only for an origin the visitor chose to remember**, and
 * that was a correction. It first shipped caching every load for the life of
 * the session, on the reading that §5's "a remembered approval is scoped to the
 * destination origin for the current session" granted the remembering. It does
 * not — it bounds what remembering may mean once you have it. §3.2 sets the
 * default at approval "before each contact" and permits relaxing it "only from
 * an explicit user choice", so a silent cache is a relaxation nobody chose.
 *
 * So: no tick, and every use walks again — allow-list, card, fetch, validate.
 * Ticked, and the load is reused for that origin, for this boot, which lands
 * exactly inside §5's bound. Nothing is remembered across page loads, because
 * nothing is written anywhere.
 */
export class PeerBook {
  private readonly loaded = new Map<string, LoadedPeer>();

  constructor(private readonly deps: PeerBookDeps) {}

  /** The bindings this session has, publisher's and caller's alike. */
  get bindings(): readonly PeerBinding[] {
    return this.deps.bindings();
  }

  binding(symbolic: string): PeerBinding | undefined {
    return this.bindings.find((b) => b.symbolic === symbolic);
  }

  /** Is this name one of our bound peer references? */
  bound(symbolic: string): boolean {
    return this.binding(symbolic) !== undefined;
  }

  /** The peer under this name, if it has already been loaded in this session. */
  peek(symbolic: string): LoadedPeer | undefined {
    return this.loaded.get(symbolic);
  }

  /**
   * Load the peer bound to `symbolic`: allow-list, consent, manifest, the
   * exactly-named entry, the definition, validation. Throws the `RuntimeMessage`
   * the walk throws, so a caller renders one string.
   */
  async open(symbolic: string): Promise<LoadedPeer> {
    const cached = this.loaded.get(symbolic);
    // Reused only if the visitor said not to ask again about that origin. The
    // check is on the BINDING's origin and not on the cached document, so a
    // binding that moved to another origin is contacted and asked about afresh.
    if (cached && this.deps.reusable?.(cached.binding.origin) === true) {
      this.deps.trace?.({
        at: (this.deps.now ?? Date.now)(),
        event: "peer_reused",
        detail: { boundAs: symbolic, origin: cached.binding.origin, why: "remembered this visit" },
      });
      return cached;
    }
    const binding = this.binding(symbolic);
    if (!binding) throw new Error(`No peer network is bound to the name '${symbolic}' by this site.`);
    const composed = await this.deps.walk(binding.url);
    const network = composed[0];
    if (!network) throw new Error(`The peer network bound to '${symbolic}' loaded nothing.`);
    const frontMan = find_front_man(network.config);
    // Unreachable through `walk`, which validates: `validate_front_man` reports
    // "No front-man agent found." and the walk throws before it returns. Kept
    // because the next caller of this class will not know that.
    if (!frontMan) throw new Error(`The peer network bound to '${symbolic}' declares no front agent.`);
    const peer: LoadedPeer = { binding, composed, network, frontMan };
    this.loaded.set(symbolic, peer);
    this.deps.trace?.({
      at: (this.deps.now ?? Date.now)(),
      event: "peer_instantiated",
      detail: {
        boundAs: symbolic,
        boundBy: binding.boundBy,
        origin: binding.origin,
        url: network.url,
        // The peer's own strings. Recorded as evidence; the RENDERED trace puts
        // every detail in a node of its own, so none of this can read as ours.
        network: network.ref.name,
        frontMan,
        agents: (network.config.tools ?? []).length,
        alsoLoadedNotRun: composed.slice(1).map((c) => c.url),
      },
    });
    return peer;
  }
}

/**
 * Build a `PeerBook` over `loadComposition`, with the run-purpose consent card.
 *
 * `deps` is read at call time, not captured, because `boot` learns the published
 * manifest after it wires this up.
 */
export function peerBookFor(
  bindings: () => readonly PeerBinding[],
  deps: () => Omit<CompositionDeps, "purpose">,
  hooks: { trace?: (entry: TraceEntry) => void; now?: () => number; reusable?: (origin: string) => boolean } = {},
): PeerBook {
  return new PeerBook({
    bindings,
    walk: (url) => loadComposition(url, { ...deps(), purpose: "run" }),
    ...(hooks.reusable ? { reusable: hooks.reusable } : {}),
    ...(hooks.trace ? { trace: hooks.trace } : {}),
    ...(hooks.now ? { now: hooks.now } : {}),
  });
}
