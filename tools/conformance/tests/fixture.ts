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
 * Anything not in the map is a real 404 with a real body, not a thrown error: a
 * checker that only handles rejections would otherwise look correct here and
 * crash on a live site that answers 404.
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
