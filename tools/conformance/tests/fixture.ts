// A conforming fixture agent site, and a `fetchImpl` that serves it.
//
// The fixture is NOT this project's site. It is a made-up two-agent network on a
// made-up origin, because the tool under test is for other people's sites and a
// fixture taken from our own repo would let a Vouch-shaped assumption pass
// unnoticed. Every test below starts from `conformingSite()` and breaks exactly
// one thing, so a failure names the thing that was broken.
//
// The CORS check is deliberately NOT tested through this fake. See cors.test.ts:
// a fabricated Response tests our idea of CORS, not CORS.

import type { FetchLike } from "../src/types.ts";

export const BASE = "https://fixture.example/agents/";
export const NETWORK_URL = "https://fixture.example/agents/demo";

export interface Artifact {
  /** A JSON value, serialised on the way out, or a raw string for malformed-body cases. */
  readonly body?: unknown;
  readonly raw?: string;
  readonly status?: number;
  readonly headers?: Record<string, string>;
  /**
   * Make the TRANSPORT fail for this URL, with this reason, instead of answering.
   *
   * An earlier version of this fixture had a comment saying a thrown error was
   * the case it deliberately did not exercise. That omission hid the worst bug
   * this tool has had: a connection that never happened was reported as the
   * site's failure, with eleven downstream lines blaming the site. There is no
   * substitute for exercising the path where nothing comes back at all.
   */
  readonly throws?: string;
}

/** The files a conforming fixture site publishes, as a mutable deep copy. */
export function conformingSite(): Record<string, Artifact> {
  return structuredClone({
    [`${BASE}agent-manifest.json`]: {
      body: {
        version: 1,
        site: { name: "Fixture Transit", description: "A made-up transit site." },
        networks: [
          {
            name: "demo",
            description: "Answers questions about a made-up transit network.",
            front_man: "concierge",
            hocon: "demo.network.json",
          },
        ],
        llm_router: {
          protocol: "openai-compatible",
          base_url: "https://router.fixture.example/v1",
          byok_router: "https://router.fixture.example/v1",
          default: { model: "a-model", requires_key: true },
        },
        peer_policy: { consent: "required_before_contact" },
        allowed_peers: ["https://peer.fixture.example"],
      },
    },
    [`${BASE}demo.network.json`]: {
      body: {
        metadata: { description: "Answers questions about a made-up transit network." },
        llm_config: { model_name: "a-model" },
        tools: [
          {
            name: "concierge",
            function: {
              description: "Entry point. Routes a traveller's question.",
              parameters: {
                type: "object",
                properties: { inquiry: { type: "string", description: "What the traveller asked." } },
                required: ["inquiry"],
              },
            },
            instructions: "Route the question to timetable or to the weather peer.",
            tools: ["timetable", "weather_peer"],
            allow: { to_downstream: { sly_data: [] }, to_upstream: { sly_data: [] } },
          },
          {
            name: "timetable",
            description: "Reads the published timetable.",
            instructions: "Answer only from the timetable you are given.",
            tools: [{ url: "https://tools.fixture.example/mcp", tools: ["search"] }],
          },
          {
            // A leaf: no `tools` key at all. The vendored schema makes the list
            // optional, and a checker that required one would fail every network
            // whose leaves are leaves.
            name: "fares",
            function: { description: "Quotes a published fare." },
            instructions: "Quote only fares from the published table.",
          },
        ],
      },
    },
    [`${BASE}links.json`]: {
      body: {
        version: 1,
        networks: { demo: { weather_peer: "https://peer.fixture.example/agents/weather" } },
      },
    },
  });
}

/**
 * Serves a file map over a fetch-shaped function, and records every URL asked for.
 *
 * Anything not in the map is a real 404 with a real body, so a checker that only
 * handled rejections would not look correct here. For the other direction -- the
 * transport failing and nothing coming back at all -- set `throws` on the entry.
 * Both paths are exercised; for a long time only this one was, and the other was
 * where the bug lived.
 */
export function serve(files: Record<string, Artifact>): {
  fetchImpl: FetchLike;
  asked: string[];
  origins: (string | null)[];
} {
  const asked: string[] = [];
  const origins: (string | null)[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    const href = String(url);
    asked.push(href);
    const headers = new Headers(init?.headers as HeadersInit | undefined);
    origins.push(headers.get("origin"));
    const file = files[href];
    if (file?.throws) {
      // The transport failing: no status, no headers, no body. What `fetch` does
      // for a DNS failure, a refused connection or a blocked proxy -- which is a
      // different thing from a site answering 404, and the whole point of the
      // tests that use this.
      throw new TypeError(`fetch failed: ${file.throws}`);
    }
    if (!file) {
      return new Response("not found", { status: 404, headers: { "content-type": "text/plain" } });
    }
    const body = file.raw ?? JSON.stringify(file.body);
    return new Response(body, {
      status: file.status ?? 200,
      headers: {
        "content-type": "application/json",
        "access-control-allow-origin": "*",
        ...(file.headers ?? {}),
      },
    });
  };
  return { fetchImpl, asked, origins };
}

/**
 * A minimal conforming site around exactly the agents a test hands it.
 *
 * Three tests used to run the shared `conformingSite()` unmodified and assert
 * `pass`, which tested the fixture's shape rather than the rule: adding
 * `tools: []` to one fixture agent made the "a leaf with no tools is fine" test
 * vacuous while leaving it green. A test that stops testing anything without
 * going red is the quietest way for a suite to rot, and this project's running
 * count of those is now seven.
 *
 * So a test that is about one agent shape builds that shape here and nothing
 * else depends on it.
 */
export function siteWithAgents(agents: readonly Record<string, unknown>[]): Record<string, Artifact> {
  const frontMan = agents[0]?.["name"];
  return {
    [`${BASE}agent-manifest.json`]: {
      body: {
        version: 1,
        networks: [
          { name: "demo", description: "A network built for one test.", front_man: frontMan, hocon: "demo.network.json" },
        ],
      },
    },
    [`${BASE}demo.network.json`]: {
      body: { metadata: { description: "A network built for one test." }, tools: structuredClone(agents) },
    },
    [`${BASE}links.json`]: { body: { version: 1, networks: { demo: {} } } },
  };
}
