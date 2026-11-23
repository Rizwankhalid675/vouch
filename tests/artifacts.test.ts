import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { RESTRICTIONS } from "../src/safety/canon.ts";

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

  test("declares the site actions, and none of them is an agent", () => {
    const acts = manifest.actions.map((x: any) => x.name);
    expect(acts).toEqual(["get_menu_state", "check_safety", "add_to_cart", "checkout_demo_order"]);
    for (const x of manifest.actions) {
      expect(x.purpose.length).toBeGreaterThan(10);
      expect(typeof x.commits).toBe("boolean");
    }
    for (const n of names) expect(acts).not.toContain(n);
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
