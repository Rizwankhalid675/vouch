import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { MENU, RESTRICTIONS } from "../src/safety/canon.ts";

const read = (f: string): any => JSON.parse(readFileSync(resolve(process.cwd(), "public", f), "utf8"));
const manifest = read("agent-manifest.json");
const network = read("vouch.network.json");
const links = read("links.json");

const agents: any[] = network.tools;
const names = agents.map((a) => a.name);

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

/** Every tool reference an agent can reach: strings, plus MCP descriptor urls. */
function toolRefs(a: any): string[] {
  return (a.tools ?? []).flatMap((t: any) => (typeof t === "string" ? [t] : [t.url, ...(t.tools ?? [])]));
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

  test("carries top-site router metadata and a peer policy with allowed_peers", () => {
    expect(manifest.llm_router).toBeTruthy();
    expect(typeof manifest.llm_router.default.base_url).toBe("string");
    expect(typeof manifest.llm_router.default.model).toBe("string");
    expect(manifest.llm_router.byok).toBe(true);
    expect(Array.isArray(manifest.peer_policy.allowed_peers)).toBe(true);
  });

  test("never carries a credential", () => {
    const text = JSON.stringify(manifest) + JSON.stringify(network);
    expect(text).not.toMatch(/api[_-]?key|authorization|bearer|sk-[A-Za-z0-9]/i);
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

  test("every tool reference resolves to an agent, a URL, or an MCP descriptor", () => {
    for (const a of agents)
      for (const t of a.tools) {
        if (typeof t === "string") {
          expect(names.includes(t) || /^https?:\/\//.test(t), `${a.name} -> ${t}`).toBe(true);
          expect(t, `${a.name} calls itself`).not.toBe(a.name);
        } else {
          expect(typeof t.url, a.name).toBe("string");
          expect(t.url).toMatch(/^https?:\/\//);
        }
      }
  });

  test("the front agent can reach every other agent", () => {
    const front = agents.find((a) => a.name === network.metadata.front_man);
    expect(new Set(front.tools)).toEqual(new Set(names.filter((n) => n !== front.name)));
  });

  test("NO agent's tools reach a safety verdict", () => {
    // Strictest form: with the current network every tool is another agent, and none of the
    // four is a verdict source. Any URL, MCP descriptor or action name would have to be argued for here.
    const verdictish = /verdict|safe|unsafe|check|allerg|finding|vouch_for|gate/i;
    for (const a of agents)
      for (const ref of toolRefs(a)) {
        expect(names, `${a.name} -> ${ref} is not an in-network agent`).toContain(ref);
        expect(ref, `${a.name} -> ${ref}`).not.toMatch(verdictish);
      }
    // And nothing in the network declares itself a verdict emitter.
    for (const a of agents) {
      expect(a.name).not.toMatch(verdictish);
      expect(JSON.stringify(a.function.parameters)).not.toMatch(/verdict/i);
    }
  });

  test("every agent is told to describe and defer, and never to conclude about safety", () => {
    for (const a of agents) {
      expect(a.instructions, a.name).toMatch(/never (say|state|claim|conclude|decide)/i);
      expect(a.instructions, a.name).toMatch(/safe/i);
      expect(a.instructions, a.name).toMatch(/verdict/i);
      expect(a.instructions, a.name).not.toMatch(/\b(you may|you can|always) (say|state|tell)[^.]*\bis safe\b/i);
    }
  });

  test("restriction_reader names exactly the published restriction ids", () => {
    const rr = agents.find((a) => a.name === "restriction_reader");
    for (const r of RESTRICTIONS) expect(rr.instructions).toContain(r.id);
    const ids = new Set(RESTRICTIONS.map((r) => r.id));
    for (const m of rr.instructions.matchAll(/\b[a-z]+_free\b/g)) expect(ids.has(m[0]), m[0]).toBe(true);
  });

  test("menu_guide's published prices match the menu, if it quotes any", () => {
    const mg = agents.find((a) => a.name === "menu_guide");
    for (const m of mg.instructions.matchAll(/\b([a-z_]+) at \$?(\d+\.\d\d)/g)) {
      const item = MENU.items.find((i) => i.id === m[1]);
      expect(item, m[1]).toBeTruthy();
      expect(item!.price.toFixed(2)).toBe(m[2]);
    }
  });

  test("private context is explicit: nothing passes unless a field is named", () => {
    expect(network.metadata.private_context.default).toBe("deny");
    for (const a of agents) {
      expect(a.allow.to_downstream.sly_data, a.name).toEqual([]);
      expect(a.allow.to_upstream.sly_data, a.name).toEqual([]);
    }
  });

  test("model settings are declared as hints", () => {
    expect(network.metadata.model_settings_are_hints).toBe(true);
  });
});

describe("§2.2 portable data profile: resolved and data-only", () => {
  const published = { manifest, network, links };
  for (const [file, doc] of Object.entries(published)) {
    test(`${file} has no includes, substitutions, env vars or local file references`, () => {
      for (const { path, key, str } of walk(doc)) {
        if (key) expect(key, path).not.toMatch(/^(include|includes|import|imports|extends|\$ref|\$include)$/i);
        if (key) expect(key, path).not.toMatch(/^(env|environment|env_vars?)$/i);
        if (str !== undefined) {
          expect(str, path).not.toMatch(/\$\{|\$\?\{|\$[A-Za-z_]/); // HOCON / shell substitution
          expect(str, path).not.toMatch(/%[A-Za-z_]+%|\{\{|\}\}/); // other templating
          expect(str, path).not.toMatch(/process\.env|import\.meta|\benv\./i);
          expect(str, path).not.toMatch(/^file:|^~\/|^\/(?!\/)|^\.\.?\//); // local files
          expect(str, path).not.toMatch(/\binclude\s+(file|url|classpath)?\(?["']/i); // HOCON include
          expect(str, path).not.toMatch(/\.(conf|hocon)\b/i);
        }
      }
    });
  }

  test("the manifest hocon location is a resolved .json served beside the manifest", () => {
    for (const n of manifest.networks) expect(n.hocon).toMatch(/^[A-Za-z0-9_.-]+\.json$/);
    expect(manifest.networks[0].hocon).toBe("vouch.network.json");
  });

  test("the network is plain JSON data: no functions, no non-JSON values", () => {
    const raw = readFileSync(resolve(process.cwd(), "public/vouch.network.json"), "utf8");
    expect(JSON.parse(JSON.stringify(JSON.parse(raw)))).toEqual(network);
    expect(raw).not.toMatch(/^\s*(\/\/|#)/m);
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

  test("every bound symbolic name is declared as a tool somewhere in the network, and vice versa", () => {
    const bound = Object.keys(links.networks.vouch);
    const external = agents.flatMap((a) => (a.tools as any[]).filter((t) => typeof t === "string" && !names.includes(t)));
    // Symbolic (non-URL) external references must be bound; URLs need no binding.
    const symbolic = external.filter((t) => !/^https?:\/\//.test(t));
    expect(new Set(symbolic)).toEqual(new Set(bound));
  });
});
