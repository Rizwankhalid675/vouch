import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { RESTRICTIONS } from "../src/safety/canon.ts";
import { actionDefinitions, withoutEnums } from "../src/runtime/actions.ts";
import { DEFAULT_LIMITS } from "../src/runtime/limits.ts";

const read = (f: string): any => JSON.parse(readFileSync(resolve(import.meta.dirname, "..", "public", f), "utf8"));
const manifest = read("agent-manifest.json");
const network = read("vouch.network.json");
const links = read("links.json");

const agents: any[] = network.tools;
const names = agents.map((a) => a.name);
const isUrl = (s: string) => /^https?:\/\//.test(s);

/** Every string and every key in a JSON value, with its path. */
function walk(v: unknown, path = "$", out: { path: string; key?: string; str?: string }[] = []) {
  if (typeof v === "string") out.push({ path, str: v });
  else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`, out));
  else if (v && typeof v === "object")
    for (const [k, x] of Object.entries(v)) {
      out.push({ path: `${path}.${k}`, key: k });
      walk(x, `${path}.${k}`, out);
    }
  return out;
}

/** Problems with one string or key that would make a published file depend on its publisher's machine or environment. */
function dataOnlyProblems(doc: unknown): string[] {
  const bad: string[] = [];
  for (const { path, key, str } of walk(doc)) {
    if (key) {
      if (/^(include|includes|import|imports|extends|\$ref|\$include|env|environment|env_vars?)$/i.test(key)) bad.push(`${path}: key ${key}`);
    }
    if (str === undefined) continue;
    const rules: [RegExp, string][] = [
      [/\$\{|\$\?\{|\$[A-Za-z_]/, "substitution"],
      [/%[A-Za-z_]+%|\{\{|\}\}/, "templating"],
      [/process\.env|import\.meta|\benv\./i, "environment"],
      [/(^|[^A-Za-z0-9])file:/i, "file: url"],
      [/(^|[\s"'(=,;:])(\.{1,2}[\\/]|~[\\/])/, "relative or home path"],
      [/(^|[\s"'(=,;:])\/(?!\/)[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]/, "absolute path"],
      [/[A-Za-z]:\\[A-Za-z0-9_.-]/, "windows path"],
      [/\b[\w-]+\.(conf|hocon|env|ya?ml)\b/i, "local config file"],
      [/\binclude\s*(file|url|classpath)?\s*\(?\s*["']/i, "HOCON include"],
    ];
    for (const [re, what] of rules) {
      // URLs are addresses, not local paths; only the substitution and templating rules apply to them.
      if (isUrl(str) && !["substitution", "templating", "environment"].includes(what)) continue;
      if (re.test(str)) bad.push(`${path}: ${what}: ${str.slice(0, 60)}`);
    }
  }
  return bad;
}

/** Credentials by key name and by value shape. */
function credentialProblems(doc: unknown): string[] {
  const bad: string[] = [];
  for (const { path, key, str } of walk(doc)) {
    if (key && /(api[_-]?key|secret|token|passw|authorization|bearer|credential|private[_-]?key)/i.test(key) && key !== "private_context")
      bad.push(`${path}: key ${key}`);
    if (str === undefined) continue;
    if (/\b(sk-[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9]{16,}|github_pat_\w{20,}|xox[abprs]-[\w-]{8,}|AKIA[0-9A-Z]{12,}|AIza[\w-]{20,}|eyJ[\w-]{10,}\.[\w-]{5,})/.test(str)) bad.push(`${path}: token-shaped value`);
    if (/\bbearer\s+[\w.~+/-]{8,}/i.test(str)) bad.push(`${path}: bearer value`);
    if (!isUrl(str) && /[A-Za-z0-9_+/=-]{32,}/.test(str)) bad.push(`${path}: long opaque string`);
  }
  return bad;
}

type Doc = { manifest: any; network: any; links: any };

/** A tool reference, resolved to everything it can name. */
function resolveRef(t: any, d: Doc): { kind: string; names: string[] } | null {
  const agentNames: string[] = d.network.tools.map((a: any) => a.name);
  const bound = d.links.networks?.[d.network.metadata.name] ?? {};
  if (typeof t === "string") {
    if (agentNames.includes(t)) return { kind: "agent", names: [t] };
    if (t in bound) return { kind: "symbolic", names: [t, bound[t]] };
    if (isUrl(t)) return { kind: "url", names: [t] };
    return null;
  }
  if (t && typeof t.url === "string" && isUrl(t.url)) return { kind: "mcp", names: [t.url, ...(t.tools ?? [])] };
  return null;
}

/** Tool references that do not resolve. */
function danglingRefs(d: Doc): string[] {
  return d.network.tools.flatMap((a: any) =>
    (a.tools ?? []).filter((t: any) => resolveRef(t, d) === null).map((t: any) => `${a.name} -> ${JSON.stringify(t)}`),
  );
}

const VERDICTISH = /verdict|safety|finding|vouch_for|(^|[^a-z])(un)?safe([^a-z]|$)|(^|[^a-z])(gate|check|checker)([^a-z]|$)/i;

/**
 * The architectural invariant: the verdict is reachable only as a registered site action.
 * Violations are tool references that, by agent name, symbolic name, bound peer URL, MCP URL or MCP tool name,
 * name a verdict source: either something verdict-shaped or any action the manifest declares.
 */
function verdictReach(d: Doc): string[] {
  const actionNames: string[] = (d.manifest.actions ?? []).map((x: any) => x.name);
  const bad: string[] = [];
  for (const a of d.network.tools)
    for (const t of a.tools ?? []) {
      // An unresolved reference is checked by what it says it is; it is also reported as dangling elsewhere.
      const names: string[] = resolveRef(t, d)?.names ?? (typeof t === "string" ? [t] : [t?.url, ...(t?.tools ?? [])].filter(Boolean));
      for (const n of names) {
        const parts = [n, ...n.split(/[/?#.:=]/)];
        if (VERDICTISH.test(n) || parts.some((p) => actionNames.includes(p))) bad.push(`${a.name} -> ${n}`);
      }
    }
  return bad;
}

/**
 * ALLOW-LIST for what an agent's `tools` may contain, for THIS network. Anything else fails, whatever it is called.
 * §2.1 permits bare URLs and MCP descriptors in general; this network has none, and a name-based test cannot tell
 * a bland alias ("dietary_helper") or a tool called "is_it_ok" from a harmless one. So the decision is explicit:
 *  - AGENTS: the in-network agents. To add an agent, name it here and justify it in the commit.
 *  - ALLOWED_KINDS: "agent" and "symbolic" (a name bound in links.json; Task 8's peer arrives this way, with its
 *    binding and its allowed_peers entry, and needs NO edit here). To permit a bare URL or an MCP descriptor,
 *    add "url" / "mcp" to ALLOWED_KINDS in the same commit that justifies it.
 */
const AGENTS = ["front_of_house", "menu_guide", "restriction_reader", "order_builder"];
const ALLOWED_KINDS: string[] = ["agent", "symbolic"];

function disallowedRefs(d: Doc, kinds: string[] = ALLOWED_KINDS, agentAllow: string[] = AGENTS): string[] {
  const bound = Object.keys(d.links.networks?.[d.network.metadata.name] ?? {});
  const bad: string[] = [];
  for (const a of d.network.tools)
    for (const t of a.tools ?? []) {
      const r = resolveRef(t, d);
      const ok =
        r !== null &&
        kinds.includes(r.kind) &&
        (r.kind === "agent" ? agentAllow.includes(t) : r.kind === "symbolic" ? bound.includes(t) : true);
      if (!ok) bad.push(`${a.name} -> ${JSON.stringify(t)}`);
    }
  return bad;
}

const doc: Doc = { manifest, network, links };
const peerDoc = (extra: any): Doc => {
  const d = structuredClone(doc);
  d.network.tools[0].tools.push(extra);
  return d;
};

/**
 * What the visitor's browser can actually call, from the manifest alone.
 *
 * This encodes the RULE of `selectTopRouter` in nsdeploy/runtime/engine.js; it does not copy its code.
 * docs/vendor/ is the authority. If this diverges from upstream, the divergence is the defect being pinned:
 * with a real key, upstream reads `llm_router.byok_router` ONLY and throws when it is absent or empty.
 * There is deliberately no fallback to `base_url` here, because upstream has none.
 */
function routeFor(m: any, visitorKey: string | null): { baseUrl: string } {
  const r = m.llm_router ?? {};
  if (visitorKey) {
    if (typeof r.byok_router !== "string" || r.byok_router === "")
      throw new Error("A real API key is configured, but this site publishes no AI provider route.");
    return { baseUrl: r.byok_router };
  }
  return { baseUrl: r.base_url || "" };
}

describe("agent-manifest.json (§3.3)", () => {
  test("declares name, front_man and hocon for the network", () => {
    expect(manifest.networks.length).toBeGreaterThanOrEqual(1);
    for (const n of manifest.networks) {
      expect(typeof n.name).toBe("string");
      expect(typeof n.front_man).toBe("string");
      expect(typeof n.hocon).toBe("string");
    }
    expect(manifest.networks.map((n: any) => n.name)).toContain(network.metadata.name);
  });

  test("front_man names an agent that exists in the network", () => {
    for (const n of manifest.networks) expect(names).toContain(n.front_man);
    expect(network.metadata.front_man).toBe(manifest.networks[0].front_man);
  });

  test("peer policy: top-level allowed_peers is declared, and is not an open policy", () => {
    expect(Array.isArray(manifest.allowed_peers)).toBe(true);
    expect(manifest.peer_policy.mode).toBeUndefined(); // "open" would admit any origin
    expect(manifest.deployment.mode).toBe("static");
  });

  /**
   * THE ALLOW-LIST IS PUBLISHED IN EXACTLY ONE PLACE.
   *
   * It was in two: a top-level `allowed_peers` naming the bakery, which is what
   * the runtime reads, and an empty `peer_policy.allowed_peers` beside it. So the
   * published document read as deny-all to anyone who consulted the nested block,
   * which is the same "two stories in one file" defect we spent a round removing
   * from `LIMITS.md`. §3.3 fixes no location — its manifest row says only "peer
   * policy" — so the tie is broken by which one the runtime reads.
   *
   * `peer_policy` itself STAYS: that row lists it as required content, and it
   * carries the rest of the policy. Only the duplicated key is gone.
   *
   * BREAKS IF: a nested copy comes back, or `peer_policy` loses the three fields
   * that are actually its own.
   */
  test("the allow-list is published in one place, and peer_policy keeps the rest of the policy", () => {
    expect(Object.keys(manifest.peer_policy)).not.toContain("allowed_peers");
    expect(manifest.peer_policy.consent).toBe("required_before_contact");
    expect(manifest.peer_policy.private_context).toBe("deny_by_default");
    expect(manifest.peer_policy.router_inherited_by_peers).toBe(true);
    // And the one place it does live says so, beside itself.
    expect(manifest["//allowed_peers"]).toMatch(/only place/i);
  });

  test("declares the site actions, and none of them is an agent", () => {
    const acts = manifest.actions.map((x: any) => x.name);
    expect(acts).toEqual(["get_menu_state", "check_safety", "add_to_cart", "checkout_demo_order"]);
    for (const n of names) expect(acts).not.toContain(n);
  });

  /**
   * THE CATALOG SPEAKS §3.1's VOCABULARY, AND THAT IS PINNED AS A PROPERTY.
   *
   * §3.3 lists `action` metadata among the manifest's OPTIONAL blocks, so
   * publishing it at all is voluntary and no requirement is at stake. What is at
   * stake is whether a runtime that reads action descriptions finds the fields
   * §3.1 names for them — Minimum Runtime Behavior, spec line 203, cited as §2.1
   * in five places until this round — "Support same-site registered actions described by
   * name, purpose, JSON Schema, effect, and handler" — rather than a private
   * word of ours. It said `commits` until fix round 1.
   *
   * Pinned per ENTRY rather than against the four names published today: a fifth
   * action added later is forced to carry all four fields, which is the thing a
   * shape test is for.
   *
   * BREAKS IF: an entry loses any of the four fields, carries an `effect` outside
   * the vocabulary the runtime uses, publishes a `parameters` that is not an
   * object schema, or brings `commits` back beside `effect`.
   */
  const EFFECTS = ["read", "write", "irreversible"];

  test("every published action is described by name, purpose, effect and a JSON Schema for its arguments", () => {
    expect(Array.isArray(manifest.actions)).toBe(true);
    expect(manifest.actions.length).toBeGreaterThan(0);
    for (const x of manifest.actions) {
      expect(typeof x.name, JSON.stringify(x)).toBe("string");
      expect(x.name.length, x.name).toBeGreaterThan(0);
      expect(typeof x.purpose, x.name).toBe("string");
      expect(x.purpose.length, x.name).toBeGreaterThan(10);
      expect(EFFECTS, x.name).toContain(x.effect);
      // An action taking no arguments SAYS it takes none. An omitted `parameters`
      // and an empty one are different claims and only one of them is checkable.
      expect(x.parameters, x.name).toBeTypeOf("object");
      expect(x.parameters.type, x.name).toBe("object");
      expect(x.parameters.properties, x.name).toBeTypeOf("object");
      expect(x.parameters.additionalProperties, x.name).toBe(false);
      // Two words for one concept is the defect we spent a round removing from
      // LIMITS.md. `commits` is derived from `effect` in the registry; a published
      // copy of a derived value can only ever disagree with it.
      expect(Object.keys(x), x.name).not.toContain("commits");
    }
  });

  /**
   * THE PUBLISHED SCHEMA CARRIES NO SNAPSHOT OF THE DATA.
   *
   * It did, for one round: `check_safety` enumerated all 34 menu item ids and all
   * 11 restriction ids, and `add_to_cart` enumerated the 34 again. So the manifest
   * held a copy of the menu, and two published files had to agree forever. This
   * project removed two `allowed_peers` that disagreed and a limits document that
   * disagreed with its own code; a duplicated menu is the same defect with a
   * longer fuse — it breaks nothing today and is wrong the first time a dish is
   * added.
   *
   * The enum was never the check. The runtime validates ids against the LIVE menu,
   * which is stricter than any published list and cannot go stale; the published
   * enum was a second, weaker copy of a check that already existed. What is
   * published now is the typed member and a description saying where the real list
   * lives — still a JSON Schema, which is all §2.1 asks for.
   *
   * BREAKS IF: an `enum` comes back anywhere in a published `parameters`, at any
   * depth. `tests/runtime.test.ts` separately pins that the enum STAYS in the
   * code-side schema, which is where it does the work.
   */
  test("no published argument schema enumerates the site's data", () => {
    for (const x of manifest.actions) {
      expect(JSON.stringify(x.parameters), x.name).not.toContain('"enum"');
      expect(withoutEnums(x.parameters), x.name).toEqual(x.parameters);
    }
  });

  /**
   * ...AND IT STILL DESCRIBES EXACTLY WHAT THE RUNTIME VALIDATES.
   *
   * A published schema that drifts from the validator is a document overstating
   * what it describes, which is this project's own named standard for a worse
   * defect than the gap it hides. So `parameters` is not a transcription of the
   * implementation: it is asserted equal to the registered `inputSchema` with the
   * data enums removed, property for property, bound for bound, description for
   * description.
   *
   * This is also checked at START-UP now, by `reconcileActions`, beside `name` and
   * `effect`. That became the right place the moment the enum went: with no data
   * snapshot in the published schema, nothing in it moves when the menu does, so a
   * disagreement is a genuine contract break rather than a stale copy — the same
   * class as a lying effect. It is asserted here as well because a build should
   * fail before a visitor's browser has to.
   *
   * BREAKS IF: an argument is added, removed, renamed, re-typed, re-bounded or
   * re-described in `actionDefinitions` without the manifest following it, or the
   * other way round.
   */
  test("...and each published schema is the one the runtime validates arguments against, minus the data enums", () => {
    const live = actionDefinitions({ checkoutTimeoutMs: 20000 });
    expect(manifest.actions.map((x: any) => x.name)).toEqual(live.map((d) => d.name));
    for (const x of manifest.actions) {
      const def = live.find((d) => d.name === x.name)!;
      expect(x.effect, x.name).toBe(def.effect);
      expect(x.parameters, x.name).toEqual(withoutEnums(def.inputSchema));
    }
  });
});

describe("the visitor can actually run the network (§6 check 2)", () => {
  // Behaviour, not shape: what a runtime would call, for the two visitors that matter.
  test("a visitor who supplies no key is given a declared default route, not an empty string", () => {
    const route = routeFor(manifest, null);
    expect(route.baseUrl).toMatch(/^https:\/\/[^/]+/);
  });

  test("a visitor who supplies their own key gets a usable router, and nothing throws", () => {
    let route: { baseUrl: string } | undefined;
    expect(() => (route = routeFor(manifest, "a-visitors-own-key"))).not.toThrow();
    expect(route!.baseUrl).toMatch(/^https:\/\/[^/]+/);
  });

  test("llm_router.byok_router is itself a non-empty https URL (a rename or an empty value cannot slip through)", () => {
    expect(manifest.llm_router.byok_router).toMatch(/^https:\/\/[^/]+/);
  });

  test("a model is available for the router the visitor ends up on", () => {
    expect(typeof network.llm_config.model_name).toBe("string");
    expect(network.llm_config.model_name.length).toBeGreaterThan(0);
  });

  test("the probe itself is falsifiable: a manifest with the route nested out of reach fails both outcomes", () => {
    const broken = structuredClone(manifest);
    broken.llm_router = { default: broken.llm_router.default, byok: true };
    expect(routeFor(broken, null).baseUrl).toBe("");
    expect(() => routeFor(broken, "a-visitors-own-key")).toThrow();
    for (const partial of [undefined, "", "https://not-the-key-name"]) {
      // byok_router deleted, emptied, or (via the key being renamed) absent while base_url is still present.
      const m = structuredClone(manifest);
      if (partial === undefined) delete m.llm_router.byok_router;
      else if (partial === "") m.llm_router.byok_router = "";
      else ((m.llm_router.byok_router_renamed = m.llm_router.byok_router), delete m.llm_router.byok_router);
      expect(() => routeFor(m, "a-visitors-own-key"), String(partial)).toThrow();
    }
  });
});

describe("vouch.network.json (§2.1)", () => {
  test("has identity: name, description, front agent", () => {
    expect(network.metadata.name).toBe("vouch");
    expect(network.metadata.description.length).toBeGreaterThan(10);
    expect(typeof network.metadata.front_man).toBe("string");
  });

  test("has the four agents of SPEC 4.2 with unique names", () => {
    expect([...names].sort()).toEqual(["front_of_house", "menu_guide", "order_builder", "restriction_reader"]);
    expect(new Set(names).size).toBe(names.length);
  });

  test("the front agent is first and carries instructions", () => {
    expect(names[0]).toBe(network.metadata.front_man);
    expect(agents[0].instructions.length).toBeGreaterThan(0);
  });

  test("every agent has description, JSON-Schema parameters, instructions and tools", () => {
    for (const a of agents) {
      expect(a.function.description.length, a.name).toBeGreaterThan(10);
      const p = a.function.parameters;
      expect(p.type, a.name).toBe("object");
      expect(typeof p.properties, a.name).toBe("object");
      expect(Object.keys(p.properties).length, a.name).toBeGreaterThan(0);
      for (const prop of Object.values<any>(p.properties)) {
        expect(typeof prop.type, a.name).toBe("string");
        expect(typeof prop.description, a.name).toBe("string");
      }
      expect(Array.isArray(p.required), a.name).toBe(true);
      for (const r of p.required) expect(Object.keys(p.properties), a.name).toContain(r);
      expect(a.instructions.length, a.name).toBeGreaterThan(40);
      expect(Array.isArray(a.tools), a.name).toBe(true);
    }
  });

  test("every tool reference resolves: agent, symbolic name bound in links.json, URL, or MCP descriptor", () => {
    expect(danglingRefs(doc)).toEqual([]);
    for (const a of agents) expect(a.tools, `${a.name} calls itself`).not.toContain(a.name);
  });

  test("every agent is reachable from the front agent", () => {
    const seen = new Set<string>();
    const visit = (n: string) => {
      if (seen.has(n)) return;
      seen.add(n);
      for (const t of agents.find((a) => a.name === n).tools) if (typeof t === "string" && names.includes(t)) visit(t);
    };
    visit(network.metadata.front_man);
    expect([...seen].sort()).toEqual([...names].sort());
  });

  test("NO tool reference, by any route, reaches a safety verdict (allow-list, plus name heuristics as a second net)", () => {
    expect(disallowedRefs(doc)).toEqual([]);
    expect(verdictReach(doc)).toEqual([]);
  });

  test("the network contains exactly the allow-listed agents", () => {
    expect([...names].sort()).toEqual([...AGENTS].sort());
  });

  test("...the allow-list is live: aliases, MCP tools of any name, bare URLs and unknown names all fail; a bound peer passes", () => {
    const alias = structuredClone(doc);
    alias.network.tools.push({ ...structuredClone(agents[1]), name: "dietary_helper" });
    alias.network.tools[0].tools.push("dietary_helper");
    expect(verdictReach(alias)).toEqual([]); // a bland name defeats the heuristic...
    expect(disallowedRefs(alias)).not.toEqual([]); // ...but not the allow-list
    expect(disallowedRefs(peerDoc({ url: "https://peer.example/mcp", tools: ["is_it_ok"] }))).not.toEqual([]);
    expect(disallowedRefs(peerDoc("https://peer.example/agents/anything"))).not.toEqual([]);
    expect(disallowedRefs(peerDoc("unbound_name"))).not.toEqual([]);
    const peer = peerDoc("marrow_point");
    peer.links.networks.vouch.marrow_point = "https://bakery.example/agents/marrow_point";
    expect(disallowedRefs(peer)).toEqual([]); // Task 8's wiring needs no edit to the allow-list
  });

  test("...and that check is live: it passes a legitimate peer and fails every way of routing a verdict in", () => {
    const peerLinks = (d: Doc, sym: string, url: string) => ((d.links.networks.vouch[sym] = url), d);
    // Legitimate wiring (what Task 8 adds) does not trip it.
    const ok = peerLinks(peerDoc("marrow_point"), "marrow_point", "https://bakery.example/agents/marrow_point");
    expect(danglingRefs(ok)).toEqual([]);
    expect(verdictReach(ok)).toEqual([]);
    expect(verdictReach(peerDoc("https://bakery.example/agents/marrow_point"))).toEqual([]);
    expect(verdictReach(peerDoc({ url: "https://bakery.example/mcp", tools: ["ingredients"] }))).toEqual([]);
    // Every way of putting the verdict in an agent's hands does.
    for (const bad of [
      "check_safety", // the site action by name
      "https://peer.example/agents/check_safety", // a URL
      "https://peer.example/safety-verdict", // a URL, by shape
      { url: "https://peer.example/mcp", tools: ["check_safety"] }, // an MCP tool
      { url: "https://peer.example/mcp", tools: ["verdict_for"] },
    ])
      expect(verdictReach(peerDoc(bad)), JSON.stringify(bad)).not.toEqual([]);
    // A symbolic name that is innocent, bound to a verdict URL, is caught through its binding.
    const sneaky = peerLinks(peerDoc("marrow_point"), "marrow_point", "https://bakery.example/agents/check_safety");
    expect(verdictReach(sneaky)).not.toEqual([]);
    // And a verdict-named agent added to the network.
    const rogue = structuredClone(doc);
    rogue.network.tools.push({ ...structuredClone(agents[1]), name: "safety_checker" });
    rogue.network.tools[0].tools.push("safety_checker");
    expect(verdictReach(rogue)).not.toEqual([]);
    // An unresolved reference is a broken network.
    expect(danglingRefs(peerDoc("not_bound_anywhere"))).not.toEqual([]);
  });

  test("every agent is told to describe and defer, and never to conclude about safety (smoke test; the gate is the control)", () => {
    for (const a of agents) {
      expect(a.instructions, a.name).toMatch(/never (say|state|claim|conclude|decide)/i);
      expect(a.instructions, a.name).toMatch(/verdict/i);
    }
  });

  test("restriction_reader names exactly the published restriction ids", () => {
    const rr = agents.find((a) => a.name === "restriction_reader");
    for (const r of RESTRICTIONS) expect(rr.instructions).toContain(r.id);
    const ids = new Set(RESTRICTIONS.map((r) => r.id));
    for (const m of rr.instructions.matchAll(/\b[a-z]+_free\b/g)) expect(ids.has(m[0]), m[0]).toBe(true);
  });

  test("no agent hard-codes a price, which would drift from the menu", () => {
    for (const a of agents) expect(JSON.stringify(a), a.name).not.toMatch(/\$\s?\d/);
  });

  test("private context is explicit: nothing passes unless a field is named", () => {
    expect(network.metadata.private_context.default).toBe("deny");
    for (const a of agents) expect(a.allow.to_downstream.sly_data, a.name).toEqual([]);
    expect(agents[0].allow.to_upstream.sly_data).toEqual([]);
  });

  test("model settings are declared as hints", () => {
    expect(network.metadata.model_settings_are_hints).toBe(true);
  });
});

describe("§2.2 portable data profile: resolved and data-only", () => {
  const published = { "agent-manifest.json": manifest, "vouch.network.json": network, "links.json": links };
  for (const [file, d] of Object.entries(published))
    test(`${file} has no includes, substitutions, env vars or local file references, anywhere in any string`, () => {
      expect(dataOnlyProblems(d)).toEqual([]);
    });

  test("the scanner is live: it catches publisher-only paths mid-string, and passes clean prose", () => {
    for (const bad of [
      "/Users/publisher/x",
      "see ./local-overrides.json for more",
      "load from ../shared/prompts.txt",
      "read ~/prompts/menu",
      "at /etc/vouch/secrets here",
      "C:\\Users\\p\\x",
      "file:///tmp/x",
      "Use ${MENU_PROMPT} here",
      "uses $HOME",
      "settings in overrides.conf",
      'include "shared.conf"',
    ])
      expect(dataOnlyProblems({ x: bad }), bad).not.toEqual([]);
    expect(dataOnlyProblems({ include: "x" })).not.toEqual([]);
    expect(dataOnlyProblems({ env: {} })).not.toEqual([]);
    for (const fine of [
      "Hollis & Rye serves dairy and/or egg dishes. Never say a dish is safe.",
      "https://bakery.example/agents/marrow_point",
      "vouch.network.json",
    ])
      expect(dataOnlyProblems({ x: fine }), fine).toEqual([]);
  });

  test("the manifest hocon location is a resolved .json served beside the manifest", () => {
    for (const n of manifest.networks) expect(n.hocon).toMatch(/^[A-Za-z0-9_.-]+\.json$/);
    expect(manifest.networks[0].hocon).toBe("vouch.network.json");
  });

  test("the network file is strict JSON with no comments", () => {
    const raw = readFileSync(resolve(import.meta.dirname, "..", "public", "vouch.network.json"), "utf8");
    expect(raw).not.toMatch(/^\s*(\/\/|#)/m);
    expect(Array.isArray(JSON.parse(raw).tools)).toBe(true);
  });
});

describe("credentials never appear in published files", () => {
  for (const [file, d] of Object.entries({ "agent-manifest.json": manifest, "vouch.network.json": network, "links.json": links }))
    test(file, () => expect(credentialProblems(d)).toEqual([]));

  test("the scanner is live: keys, token shapes and bearer values all trip it", () => {
    for (const bad of [
      { token: "x" },
      { api_key: "x" },
      { note: "ghp_" + "a".repeat(30) },
      { note: "sk-" + "a".repeat(30) },
      { note: "Bearer abcdefghijklmnop" },
      { note: "A".repeat(40) },
    ])
      expect(credentialProblems(bad), JSON.stringify(bad)).not.toEqual([]);
    expect(credentialProblems({ requires_key: true, note: "Hollis & Rye serves lunch." })).toEqual([]);
  });
});

describe("links.json (§3.3 peer-network link map)", () => {
  test("has version 1 and a networks map of symbolic name -> URL", () => {
    expect(links.version).toBe(1);
    expect(typeof links.networks).toBe("object");
    for (const [owner, map] of Object.entries<any>(links.networks)) {
      expect(typeof owner).toBe("string");
      for (const [sym, url] of Object.entries<string>(map)) {
        expect(sym).toMatch(/^[a-z0-9_]+$/);
        expect(url).toMatch(/^https?:\/\//);
      }
    }
    expect(links.networks).toHaveProperty("vouch");
  });

  /** Tripwire for the peer wiring: symbolic reference, binding and allow-list must all agree. */
  function peerWiring(d: Doc): string[] {
    const bad: string[] = [];
    const bound: Record<string, string> = d.links.networks?.[d.network.metadata.name] ?? {};
    const allowed: string[] = d.manifest.allowed_peers ?? [];
    const agentNames: string[] = d.network.tools.map((a: any) => a.name);
    const symbolic = new Set<string>();
    for (const a of d.network.tools)
      for (const t of a.tools ?? []) if (typeof t === "string" && !agentNames.includes(t) && !isUrl(t)) symbolic.add(t);
    for (const s of symbolic) if (!(s in bound)) bad.push(`symbolic reference "${s}" has no binding in links.json`);
    for (const [s, url] of Object.entries(bound))
      if (!allowed.includes(new URL(url).origin)) bad.push(`binding "${s}" -> ${new URL(url).origin} is not in allowed_peers`);
    return bad;
  }

  test("every symbolic external reference is bound, and every binding's origin is in top-level allowed_peers", () => {
    expect(peerWiring(doc)).toEqual([]);
  });

  test("...and that tripwire is live: forgetting any one of the three files is caught", () => {
    const full = () => {
      const d = peerDoc("marrow_point");
      d.links.networks.vouch.marrow_point = "https://bakery.example/agents/marrow_point";
      d.manifest.allowed_peers = ["https://bakery.example"];
      return d;
    };
    expect(peerWiring(full())).toEqual([]);
    const noBinding = full();
    delete noBinding.links.networks.vouch.marrow_point;
    expect(peerWiring(noBinding)).not.toEqual([]);
    const noAllow = full();
    noAllow.manifest.allowed_peers = [];
    expect(peerWiring(noAllow)).not.toEqual([]);
    const nestedOnly = full(); // the nested copy is ignored by the runtime
    nestedOnly.manifest.allowed_peers = undefined;
    nestedOnly.manifest.peer_policy.allowed_peers = ["https://bakery.example"];
    expect(peerWiring(nestedOnly)).not.toEqual([]);
  });
});

/**
 * THE SUMMARY LINE A READER TRUSTS, HELD TO THE CODE.
 *
 * `LIMITS.md` §2.6 opens with one sentence listing every per-turn bound, and that
 * sentence is what a reader takes away; the paragraphs below it are for whoever
 * wants the arithmetic. Fix round 1 found it still saying 60 seconds against a
 * `maxElapsedMs` of 90, edited for `depth 4` in the same hunk that left the
 * seconds behind — the fourth correction this file has had for stale prose, and
 * the first three were all caught by a reader rather than by anything that runs.
 *
 * So the numbers come from `DEFAULT_LIMITS` and the document is matched against
 * them. Every figure is asserted to be the ONLY one of its kind in the sentence,
 * which is what catches a stale number left beside a corrected one.
 */
describe("docs/LIMITS.md §2.6 says the numbers limits.ts actually holds", () => {
  const limitsMd = readFileSync(resolve(import.meta.dirname, "..", "docs/LIMITS.md"), "utf8");
  const section = (heading: string): string => {
    const start = limitsMd.indexOf(`### ${heading}`);
    expect(start, heading).toBeGreaterThan(-1);
    const rest = limitsMd.slice(start + heading.length);
    const end = rest.indexOf("\n### ");
    return end === -1 ? rest : rest.slice(0, end);
  };
  const bounds = section("2.6 Execution bounds");
  /** The opening summary: everything from "**Per turn:**" to the end of that paragraph. */
  const summary = bounds.slice(bounds.indexOf("**Per turn:**")).split("\n\n")[0]!.replace(/\n/g, " ");

  test("the opening summary carries each per-turn bound, and no stale copy of one", () => {
    expect(summary).toContain(`${DEFAULT_LIMITS.maxModelCalls} model calls`);
    expect(summary).toContain(`${DEFAULT_LIMITS.maxAgentCalls} delegations`);
    expect(summary).toContain(`depth ${DEFAULT_LIMITS.maxDepth}`);
    expect(summary).toContain(`${DEFAULT_LIMITS.maxRounds} tool rounds`);
    // The one that was stale. Asserted as the ONLY seconds figure in the summary,
    // so a corrected number added beside the old one still fails.
    expect(summary.match(/\d+(\.\d+)?\s+seconds/g)).toEqual([`${DEFAULT_LIMITS.maxElapsedMs / 1000} seconds`]);
    // And the other two figures the same paragraph publishes.
    expect(summary).toContain(`${DEFAULT_LIMITS.maxSessionModelCalls} model calls`);
    expect(summary).toContain(`${DEFAULT_LIMITS.maxComposedNetworks} network documents`);
  });

  test("...and the depth, rounds and call figures appear exactly once each, so a bump cannot be half-applied", () => {
    const once = (needle: string): number => summary.split(needle).length - 1;
    expect(once(`depth ${DEFAULT_LIMITS.maxDepth}`)).toBe(1);
    expect(once(`${DEFAULT_LIMITS.maxRounds} tool rounds`)).toBe(1);
    expect(once(`${DEFAULT_LIMITS.maxAgentCalls} delegations`)).toBe(1);
    // `model calls` appears twice on purpose: per turn and per session.
    expect(once("model calls")).toBe(2);
  });
});

/**
 * The provenance claim has to be checkable, because this project holds everyone
 * else to that standard. The SHA appears in `PROVENANCE.md`, in `upstream-pins.json`
 * and in all six adapted files' notices; they could drift apart silently, so they
 * are pinned to each other here.
 */
describe("upstream provenance is self-consistent (Apache-2.0 §4, and our own standard)", () => {
  const pins = JSON.parse(readFileSync(resolve(import.meta.dirname, "..", "docs/vendor/upstream-pins.json"), "utf8"));
  const provenance = readFileSync(resolve(import.meta.dirname, "..", "docs/vendor/PROVENANCE.md"), "utf8");
  const ADAPTED = [
    "graph.ts", "validation.ts", "sly-data.ts", "router.ts", "action-registry.ts", "tool-schema.ts",
  ];

  test("the pinned commit is a full 40-hex SHA", () => {
    expect(pins.commit).toMatch(/^[0-9a-f]{40}$/);
  });

  test("PROVENANCE.md names that commit, and no other", () => {
    const shas = [...new Set([...provenance.matchAll(/\b[0-9a-f]{40}\b/g)].map((m) => m[0]))];
    expect(shas).toEqual([pins.commit]);
  });

  test.each(ADAPTED)("src/runtime/upstream/%s's notice names that commit, and no other", (file) => {
    const src = readFileSync(resolve(import.meta.dirname, "..", "src/runtime/upstream", file), "utf8");
    const shas = [...new Set([...src.matchAll(/\b[0-9a-f]{40}\b/g)].map((m) => m[0]))];
    expect(shas, file).toEqual([pins.commit]);
    expect(src, file).toContain("Apache License 2.0");
    expect(src, file).toMatch(/CHANGES WE MADE \(Apache-2\.0 §4\(b\)\)/);
  });

  test("every pinned source has a 64-hex digest, and PROVENANCE.md records it", () => {
    const files = Object.entries<string>(pins.files);
    expect(files.length).toBe(6);
    for (const [name, digest] of files) {
      expect(digest, name).toMatch(/^[0-9a-f]{64}$/);
      expect(provenance, name).toContain(digest);
      expect(provenance, name).toContain(name);
    }
  });

  test("the adapted directory holds exactly the six files the provenance accounts for", () => {
    const listed = readdirSync(resolve(import.meta.dirname, "..", "src/runtime/upstream")).sort();
    expect(listed).toEqual([...ADAPTED].sort());
  });
});

/**
 * THE ALLERGEN BOUNDARY, HELD TO THE DATA THAT DRAWS IT.
 *
 * `LIMITS.md` §3 is the only place a guest can learn which allergens this site speaks
 * to and which it does not, and the §2.6 test exists because a sentence in that file
 * went stale four times with 495 tests green. This one exists because the same file
 * now carries a list that a data change can falsify, and the failure mode is worse
 * than a wrong number: a reader with a chickpea allergy acting on a boundary we had
 * since moved.
 *
 * Two assertions, in both directions:
 *  - every tracked allergen id is named in §3.1, and §3.1 names no id that is not
 *    tracked (so adding a twelfth restriction fails here until the document follows);
 *  - §3.2's declined ingredients are exactly the ones `restrictions.policy.md`
 *    declines, so the limits document and the policy file cannot tell two stories.
 *
 * This build extended the tracked set twice, mustard then celery. It will be extended
 * again, and this is what makes that an edit rather than a discrepancy.
 */
describe("docs/LIMITS.md §3 says the allergens restrictions.json actually tracks", () => {
  const limitsMd = readFileSync(resolve(import.meta.dirname, "..", "docs/LIMITS.md"), "utf8");
  const policy = readFileSync(resolve(import.meta.dirname, "..", "data/restrictions.policy.md"), "utf8");
  const section = (heading: string): string => {
    const start = limitsMd.indexOf(`### ${heading}`);
    expect(start, heading).toBeGreaterThan(-1);
    const rest = limitsMd.slice(start + heading.length);
    const end = rest.indexOf("\n### ");
    return end === -1 ? rest : rest.slice(0, end);
  };
  /** Every `backticked` token in a section, which is how §3 names an allergen id. */
  const ticked = (text: string): string[] => [...text.matchAll(/`([a-z_]+)`/g)].map((m) => m[1]!);

  const tracked = [...new Set(RESTRICTIONS.flatMap((r) => r.avoid))];

  test("§3.1 names every tracked allergen id, and names no id that is not tracked", () => {
    const named = ticked(section("3.1 The tracked set, and the rule that draws it"));
    for (const id of tracked) expect(named, id).toContain(id);
    // The other direction: an id left in the document after being dropped from the
    // data fails here. Non-id backticked tokens in that section are filenames and
    // identifiers, so only names that look like allergen ids are compared back.
    const idish = named.filter((n) => tracked.includes(n) || /^[a-z]+(_[a-z]+)?$/.test(n));
    for (const n of idish) {
      if (n.endsWith("_free") || n.includes(".") || n === "avoid" || n === "trackedAllergens") continue;
      expect(tracked, `§3.1 names \`${n}\`, which nothing in restrictions.json avoids`).toContain(n);
    }
  });

  test("§3.1's restriction and allergen counts are the ones the data holds", () => {
    const text = section("3.1 The tracked set, and the rule that draws it");
    expect(text).toContain(`**${RESTRICTIONS.length} published restrictions over ${tracked.length} tracked allergen ids**`);
  });

  test("§3.2's declined ingredients are exactly the ones the policy file declines", () => {
    const declined = policy
      .slice(policy.indexOf("Deliberately not tracked:"))
      .split("\n")[0]!
      .replace("Deliberately not tracked:", "")
      .split(",")
      .map((s) => s.trim().replace(/\.$/, ""))
      .filter(Boolean);
    expect(declined.length).toBeGreaterThan(0);
    const text = section("3.2 What is outside the set, named rather than left to be discovered");
    for (const ingredient of declined) expect(text, ingredient).toContain(ingredient);
    // And the count, so a seventh exclusion added to the policy cannot be silently
    // absent from the document that publishes the boundary.
    expect(text).toContain(`All ${declined.length === 6 ? "six" : String(declined.length)} are real sensitivities`);
  });

  test("§3 points at the policy file rather than restating it as its own authority", () => {
    expect(limitsMd).toContain("`data/restrictions.policy.md` is the authority");
  });
});

/**
 * THE SECTION A CITATION NAMES IS THE SECTION THAT CONTAINS THE QUOTE.
 *
 * Two citations were wrong across eight places, one of them inside the published
 * `agent-manifest.json`:
 *
 *  - the action field names were credited to **§2.1** (Minimum Network Content),
 *    which contains neither the word `purpose` nor the word `effect`. The quoted
 *    sentence is spec line 203, under **§3.1** Minimum Runtime Behavior.
 *  - the missing-key refusal was credited to **§3.4** (Browser Origin
 *    Requirements), which says nothing about keys. It is **§4**, Tenet Three,
 *    "Static BYOK option", spec line 369.
 *
 * Neither is a claim about the product, which is why nine review passes read past
 * them: they cost a reader who checks, and this project's whole argument is aimed
 * at that reader. So the pair is held to the pinned specification itself — both
 * halves, the section that has the sentence and the section that does not, because
 * only the second half catches a citation moved to a third wrong number.
 *
 * BREAKS IF: either citation is changed back, or the pinned spec is replaced by a
 * revision that moves either sentence — in which case the figure to fix is the
 * section number everywhere, and this test names the files.
 */
describe("the spec sections this project cites are the ones that carry the quotes", () => {
  const spec = readFileSync(resolve(import.meta.dirname, "..", "docs/mvp-spec-2026-11-23.md"), "utf8");
  const src = (p: string): string => readFileSync(resolve(import.meta.dirname, "..", p), "utf8");

  /** One numbered section of the pinned spec, up to the next heading of any level. */
  const section = (heading: string): string => {
    const start = spec.indexOf(heading);
    expect(start, heading).toBeGreaterThan(-1);
    const rest = spec.slice(start + heading.length);
    const end = rest.search(/\n#{2,3} /);
    return end === -1 ? rest : rest.slice(0, end);
  };

  const ACTION_FIELDS = "Support same-site registered actions described by name, purpose, JSON Schema, effect,";
  const MISSING_KEY = "a missing key MUST stop the model call\n    with a clear setup error";

  test("the action field names are in §3.1 and not in §2.1", () => {
    expect(section("### 3.1 Minimum Runtime Behavior")).toContain(ACTION_FIELDS);
    const s21 = section("### 2.1 Minimum Network Content");
    expect(s21).not.toContain(ACTION_FIELDS);
    expect(s21).not.toMatch(/\bpurpose\b/);
    expect(s21).not.toMatch(/\beffect\b/);
  });

  test("the missing-key MUST is in §4 and not in §3.4", () => {
    expect(section("## 4. Tenet Three: Pluggable Inference")).toContain(MISSING_KEY);
    const s34 = section("### 3.4 Browser Origin Requirements");
    expect(s34).not.toContain("missing key");
    expect(s34).not.toMatch(/\bkey\b/);
  });

  test("every place that cites either sentence names the right section", () => {
    // The published artifact, which is the one that ships.
    expect(manifest["//actions"]).toContain("§3.1's field names");
    expect(manifest["//actions"]).not.toMatch(/published in §2\.1/);
    // And the five code and document sites.
    expect(src("docs/LIMITS.md")).toContain("### 4.1 The `actions` block is optional metadata, published in §3.1's field names");
    expect(src("docs/CONFORMANCE-STATUS.md")).toContain("§3.1's own field names");
    expect(src("src/runtime/actions.ts")).toContain("§3.1's own field names");
    for (const p of ["src/runtime/llm.ts", "tests/refusals.test.ts"]) {
      expect(src(p), p).not.toMatch(/§3\.4's "a missing key/);
      expect(src(p), p).toContain('§4\'s "a missing key MUST stop');
    }
  });
});
