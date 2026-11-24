// agentic-web-conformance: the checks.
//
// WHAT THESE TESTS ARE FOR
//
// This tool's product is not "a list of green ticks". It is the distinction
// between three statements that are easy to collapse into one:
//
//   "I looked and it is right."            -> pass
//   "I looked and it is wrong."            -> fail
//   "This cannot be checked from here."    -> not-demonstrated
//
// So the tests below are weighted towards the third. A checker that quietly
// upgrades an unchecked item to a pass is worse than no checker, and most of the
// ways that happens are invisible in a green suite: an exact-match lookup that
// falls back to the first entry, a regex anchored to `^` that misses a path in
// the middle of a string, a declined check rendered with the word PASS on its
// line. There is a test for each of those, and each one was watched failing
// against a deliberately broken implementation before it was kept.
//
// FOUR RULES THIS FILE FOLLOWS
//
//  1. **Break one thing.** Every case starts from `conformingSite()` and changes
//     exactly one value, so a failure names a cause rather than a symptom.
//  2. **Assert the finding, not the count.** A check that fails for the wrong
//     reason is a bug; `findings` is asserted to contain the offending value.
//  3. **Never assert a constant back.** Nothing here restates a literal the
//     implementation also holds; the assertions are about behaviour under a
//     changed input.
//  4. **No fixture from our own site.** The fixture is a made-up transit site.
//     If this file read `public/` it would pass on a tool that only works here.

import { describe, expect, test } from "vitest";
import { runChecks, exitCodeFor, renderText, DECLINED_CHECKS } from "../src/index.ts";
import { deriveTarget } from "../src/discover.ts";
import type { CheckResult } from "../src/types.ts";
import { portabilityFindings } from "../src/rules.ts";
import { BASE, NETWORK_URL, conformingSite, serve, siteWithAgents } from "./fixture.ts";

/** One check by id. Throws rather than returning undefined: a missing check is a bug, not a pass. */
function one(results: readonly CheckResult[], id: string): CheckResult {
  const found = results.find((r) => r.check === id);
  if (!found) throw new Error(`no check with id ${id}; got ${results.map((r) => r.check).join(", ")}`);
  return found;
}

/** Run against a file map. */
async function run(files: Record<string, unknown>, url = NETWORK_URL) {
  const { fetchImpl, asked, origins } = serve(files as never);
  const results = await runChecks(url, { fetchImpl });
  return { results, asked, origins };
}

const findingsText = (r: CheckResult) => r.findings.join("\n");

describe("§3.2 discovery: the manifest, never a glob", () => {
  test("the final path component is the network name and the preceding path is the site base", () => {
    const target = deriveTarget("https://peer.example/agents/transit");
    expect(target.networkName).toBe("transit");
    expect(target.base).toBe("https://peer.example/agents/");
    expect(target.manifestUrl).toBe("https://peer.example/agents/agent-manifest.json");
  });

  test("a query string and a fragment are not part of the network name", () => {
    const target = deriveTarget("https://peer.example/agents/transit?v=2#top");
    expect(target.networkName).toBe("transit");
    expect(target.base).toBe("https://peer.example/agents/");
  });

  test("a URL with no final path component is rejected, because there is no network name in it", () => {
    expect(() => deriveTarget("https://peer.example/agents/")).toThrow(/network name/i);
    expect(() => deriveTarget("https://peer.example")).toThrow(/network name/i);
  });

  test("a non-HTTP scheme is rejected", () => {
    expect(() => deriveTarget("file:///tmp/agents/transit")).toThrow(/http/i);
  });

  test("a name absent from the manifest fails and does NOT fall back to another published network", async () => {
    // §3.2: "selects the entry whose name exactly matches the requested network.
    // If no exact match exists, it MUST fail rather than select another published network."
    const { results } = await run(conformingSite(), `${BASE}demo-staging`);
    const selected = one(results, "network-selected");
    expect(selected.status).toBe("fail");
    expect(findingsText(selected)).toContain("demo-staging");
    expect(findingsText(selected)).toContain("demo");
    // And nothing downstream may claim to have checked a network.
    expect(one(results, "network-reachable").status).not.toBe("pass");
    expect(one(results, "agent-definitions").status).not.toBe("pass");
    expect(exitCodeFor(results)).not.toBe(0);
  });

  test("a name that differs only by case is not an exact match", async () => {
    const { results } = await run(conformingSite(), `${BASE}DEMO`);
    expect(one(results, "network-selected").status).toBe("fail");
  });

  test("it asks only for URLs under the site base it was given, and never for a filename it guessed", async () => {
    // The two traps in one assertion: no hard-coded origin of ours, and no globbing
    // for `<network>.network.json` before the manifest has named it.
    const { asked } = await run(conformingSite());
    expect(asked.length).toBeGreaterThan(0);
    for (const url of asked) expect(url.startsWith(BASE)).toBe(true);
    const manifestIndex = asked.findIndex((u) => u.endsWith("agent-manifest.json"));
    const networkIndex = asked.findIndex((u) => u.endsWith("demo.network.json"));
    expect(manifestIndex).toBeGreaterThanOrEqual(0);
    expect(networkIndex).toBeGreaterThan(manifestIndex);
  });
});

describe("§3.3 presence: reachable by public GET", () => {
  test("a conforming site produces no failures", async () => {
    const { results } = await run(conformingSite());
    const failed = results.filter((r) => r.status === "fail");
    expect(failed.map((r) => `${r.check}: ${r.detail}\n${findingsText(r)}`)).toEqual([]);
    expect(exitCodeFor(results)).toBe(0);
  });

  test("an absent manifest is a failure that names the URL tried and the status returned", async () => {
    const files = conformingSite();
    delete files[`${BASE}agent-manifest.json`];
    const { results } = await run(files);
    const check = one(results, "manifest-reachable");
    expect(check.status).toBe("fail");
    expect(findingsText(check)).toContain(`${BASE}agent-manifest.json`);
    expect(findingsText(check)).toContain("404");
  });

  test("an absent network definition is a failure that names the resolved URL", async () => {
    const files = conformingSite();
    delete files[`${BASE}demo.network.json`];
    const { results } = await run(files);
    const check = one(results, "network-reachable");
    expect(check.status).toBe("fail");
    expect(findingsText(check)).toContain(`${BASE}demo.network.json`);
  });

  test("an absent links.json is a failure, and the detail says whether anything needed it", async () => {
    const files = conformingSite();
    delete files[`${BASE}links.json`];
    const { results } = await run(files);
    const check = one(results, "links-reachable");
    expect(check.status).toBe("fail");
    expect(findingsText(check)).toContain(`${BASE}links.json`);
    expect(check.detail).toMatch(/weather_peer/);
  });

  test("a host this checker never reached is NOT reported as the site's failure", async () => {
    // THE WORST BUG THIS TOOL HAS HAD, and the one its whole thesis is about.
    //
    // A DNS failure, a refused connection, a blocked proxy or a mistyped hostname
    // produced `FAIL §3.3 ... It was not [readable]` and eleven downstream lines
    // reading "blocked by the site" -- a confident indictment of a site this
    // checker never contacted, with the blame attributed to that site. "I could
    // not look" rendered as "I looked and it is wrong", in the path a stranger
    // hits first. It was observed in the wild, against a site that was serving
    // correctly throughout, and read without anyone noticing.
    //
    // A site cannot be at fault for a request that never arrived.
    const files = conformingSite();
    files[`${BASE}agent-manifest.json`] = { throws: "ECONNREFUSED 10.0.0.1:443" };
    const { results } = await run(files);

    const manifest = one(results, "manifest-reachable");
    expect(manifest.status).toBe("not-demonstrated");
    expect(manifest.blockedBy).toBe("checker");
    expect(manifest.detail).toMatch(/never reached|did not reach/i);
    expect(findingsText(manifest)).toContain("ECONNREFUSED");

    // Nothing anywhere in the run may blame the site for this.
    for (const result of results) {
      expect(result.status, result.check).not.toBe("fail");
      if (result.blockedBy === "site") {
        throw new Error(`${result.check} blames the site for a connection that never happened`);
      }
    }
  });

  test("an HTTP error IS the site's failure: a 404 and a 500 stay failures, and say so", async () => {
    // The other direction, and it has to keep working. The fix for the bug above
    // is not "stop failing"; it is "fail only about answers that arrived."
    for (const status of [404, 500, 403]) {
      const files = conformingSite();
      files[`${BASE}agent-manifest.json`] = { raw: "nope", status };
      const { results } = await run(files);
      const manifest = one(results, "manifest-reachable");
      expect(manifest.status, `HTTP ${status}`).toBe("fail");
      expect(findingsText(manifest)).toContain(String(status));
      expect(one(results, "agent-definitions").blockedBy, `HTTP ${status}`).toBe("site");
    }
  });

  test("a network definition the checker never reached is not the site's failure either", async () => {
    const files = conformingSite();
    files[`${BASE}demo.network.json`] = { throws: "EAI_AGAIN cdn.fixture.example" };
    const { results } = await run(files);
    const network = one(results, "network-reachable");
    expect(network.status).toBe("not-demonstrated");
    expect(network.blockedBy).toBe("checker");
    expect(findingsText(network)).toContain("EAI_AGAIN");
    // ...and the checks downstream of it inherit the checker, not the site.
    expect(one(results, "agent-definitions").blockedBy).toBe("checker");
    expect(one(results, "portable-data").blockedBy).toBe("checker");
    expect(results.some((r) => r.status === "fail")).toBe(false);
  });

  test("a link map the checker never reached is not the site's failure either", async () => {
    const files = conformingSite();
    files[`${BASE}links.json`] = { throws: "ETIMEDOUT" };
    const { results } = await run(files);
    const links = one(results, "links-reachable");
    expect(links.status).toBe("not-demonstrated");
    expect(links.blockedBy).toBe("checker");
    expect(findingsText(links)).toContain("ETIMEDOUT");
  });

  test("a run that reached nothing exits 4, not 1: no verdict about the site was reached", async () => {
    // Exit 1 would be a false indictment and exit 0 a false all-clear. Someone's
    // CI needs to tell "your site failed a check" from "nothing was contacted".
    const unreachable = conformingSite();
    for (const url of Object.keys(unreachable)) unreachable[url] = { throws: "ECONNREFUSED" };
    const { results } = await run(unreachable);
    expect(exitCodeFor(results)).toBe(4);

    // A real failure outranks it: a finding is a finding.
    const mixed = conformingSite();
    mixed[`${BASE}links.json`] = { throws: "ECONNREFUSED" };
    const net = mixed[`${BASE}demo.network.json`]!.body as { tools: { name: string }[] };
    net.tools[1]!.name = "demo agent with a space";
    expect(exitCodeFor((await run(mixed)).results)).toBe(1);

    // And a clean run is still 0.
    expect(exitCodeFor((await run(conformingSite())).results)).toBe(0);
  });

  test("the report tells a reader that nothing was contacted, rather than leaving them to infer it", async () => {
    const unreachable = conformingSite();
    for (const url of Object.keys(unreachable)) unreachable[url] = { throws: "ECONNREFUSED" };
    const { results } = await run(unreachable);
    const text = renderText(results, deriveTarget(NETWORK_URL));
    // The CLOSING SUMMARY has to say it, not just the per-check lines: that is the
    // line a reader skims to. Asserting only on `/never reached/i` passed while
    // the summary said nothing, because the per-check blocker lines contain the
    // same words -- so the assertion is on the phrase only the summary uses.
    expect(text).toMatch(/reached no verdict about the site/i);
    expect(text).toMatch(/NEVER REACHED THE HOST/);
    expect(text).toContain("exit 4");
    // It must not tell them their site is broken.
    expect(text).not.toMatch(/blocked by the site/);
    expect(text).not.toMatch(/\bFAIL\b/);
  });

  test("a manifest that is not JSON is a failure, not a crash", async () => {
    const files = conformingSite();
    files[`${BASE}agent-manifest.json`] = { raw: "<!doctype html><title>404</title>" };
    const { results } = await run(files);
    expect(one(results, "manifest-reachable").status).toBe("fail");
    expect(exitCodeFor(results)).toBe(1);
  });

  test("a `hocon` value may be an absolute URL on another origin, and is resolved as given", async () => {
    // §3.2: "The value MAY be a relative path or an absolute HTTP or HTTPS URL ...
    // it does not require the final network-definition URL to remain on the manifest's origin."
    const files = conformingSite();
    const manifest = files[`${BASE}agent-manifest.json`]!.body as { networks: { hocon: string }[] };
    manifest.networks[0]!.hocon = "https://cdn.fixture.example/demo.json";
    files["https://cdn.fixture.example/demo.json"] = files[`${BASE}demo.network.json`]!;
    delete files[`${BASE}demo.network.json`];
    const { results, asked } = await run(files);
    expect(one(results, "network-reachable").status).toBe("pass");
    expect(asked).toContain("https://cdn.fixture.example/demo.json");
  });
});

describe("§2.1 minimum network content", () => {
  test("an agent with no description anywhere fails, and the finding names that agent", async () => {
    const files = conformingSite();
    const net = files[`${BASE}demo.network.json`]!.body as { tools: Record<string, unknown>[] };
    delete net.tools[1]!["description"];
    const { results } = await run(files);
    const check = one(results, "agent-definitions");
    expect(check.status).toBe("fail");
    expect(findingsText(check)).toContain("timetable");
    expect(findingsText(check)).not.toContain("concierge");
  });

  test("a top-level `description` satisfies the requirement in place of `function.description`", async () => {
    // The vendored reference is the authority: "A shorter way to give the function
    // description of an agent ... It is put into the agent's function". Requiring
    // `function.description` would report a conforming site as broken.
    //
    // Built here rather than read off the shared fixture. This used to run
    // `conformingSite()` unmodified, which tested the fixture's shape: the moment
    // a fixture agent gained a `function.description`, the test would have gone on
    // passing while checking nothing.
    const bothForms = siteWithAgents([
      { name: "front", function: { description: "Takes the question." }, instructions: "Route it.", tools: ["leaf"] },
      { name: "leaf", description: "Answers it.", instructions: "Answer from what you are given." },
    ]);
    expect(one((await run(bothForms)).results, "agent-definitions").status).toBe("pass");

    // ...and the top-level form alone is enough, for the front agent too.
    const onlyTopLevel = siteWithAgents([
      { name: "front", description: "Takes the question.", instructions: "Route it.", tools: ["leaf"] },
      { name: "leaf", description: "Answers it.", instructions: "Answer from what you are given." },
    ]);
    expect(one((await run(onlyTopLevel)).results, "agent-definitions").status).toBe("pass");
  });

  test("two agents with the same name fail: §2.1 requires a unique name within the network", async () => {
    const files = conformingSite();
    const net = files[`${BASE}demo.network.json`]!.body as { tools: { name: string }[] };
    net.tools[1]!.name = "concierge";
    const { results } = await run(files);
    const check = one(results, "agent-definitions");
    expect(check.status).toBe("fail");
    expect(findingsText(check)).toMatch(/concierge/);
  });

  test("an agent name with a space fails the documented name pattern", async () => {
    const files = conformingSite();
    const net = files[`${BASE}demo.network.json`]!.body as { tools: { name: string }[] };
    net.tools[1]!.name = "time table";
    const { results } = await run(files);
    expect(one(results, "agent-definitions").status).toBe("fail");
  });

  test("an LLM agent with no instructions fails; a coded tool with none does not", async () => {
    const withoutInstructions = conformingSite();
    const a = withoutInstructions[`${BASE}demo.network.json`]!.body as { tools: Record<string, unknown>[] };
    delete a.tools[1]!["instructions"];
    expect(one((await run(withoutInstructions)).results, "agent-definitions").status).toBe("fail");

    const codedTool = conformingSite();
    const b = codedTool[`${BASE}demo.network.json`]!.body as { tools: Record<string, unknown>[] };
    delete b.tools[1]!["instructions"];
    b.tools[1]!["class"] = "TimetableTool";
    expect(one((await run(codedTool)).results, "agent-definitions").status).toBe("pass");
  });

  test("a leaf agent with no `tools` key is not a failure: the reference says the list is optional", async () => {
    // Requiring one would fail every network whose leaves are leaves.
    //
    // THE REVIEWER'S EXAMPLE, and the reason this is built here. It used to run the
    // shared fixture and rely on one of its agents happening to omit `tools`.
    // Adding `tools: []` to that agent made the test vacuous and left it green --
    // a test that stops testing anything without going red.
    const leafWithoutTools = siteWithAgents([
      { name: "front", description: "Takes the question.", instructions: "Route it.", tools: ["leaf"] },
      { name: "leaf", description: "Answers it.", instructions: "Answer from what you are given." },
    ]);
    expect(one((await run(leafWithoutTools)).results, "agent-definitions").status).toBe("pass");

    // An empty list is equally fine, and is a different shape from an absent key.
    const leafWithEmptyTools = siteWithAgents([
      { name: "front", description: "Takes the question.", instructions: "Route it.", tools: ["leaf"] },
      { name: "leaf", description: "Answers it.", instructions: "Answer.", tools: [] },
    ]);
    expect(one((await run(leafWithEmptyTools)).results, "agent-definitions").status).toBe("pass");

    // ...and a `tools` that is not a list still fails, so this is not a blanket pass.
    const wrongType = siteWithAgents([
      { name: "front", description: "Takes the question.", instructions: "Route it.", tools: ["leaf"] },
      { name: "leaf", description: "Answers it.", instructions: "Answer.", tools: "leaf" },
    ]);
    expect(one((await run(wrongType)).results, "agent-definitions").status).toBe("fail");
  });

  test("a single-agent network fails §6's two-agent minimum, and the finding gives the count", async () => {
    const files = conformingSite();
    const net = files[`${BASE}demo.network.json`]!.body as { tools: unknown[] };
    net.tools = [net.tools[0]];
    const { results } = await run(files);
    const check = one(results, "two-agent-network");
    expect(check.status).toBe("fail");
    expect(findingsText(check)).toContain("1");
  });
});

describe("§2.1 invocation schemas", () => {
  test("`function.parameters` without a `properties` dictionary fails", async () => {
    const files = conformingSite();
    const net = files[`${BASE}demo.network.json`]!.body as { tools: { function: { parameters: unknown } }[] };
    net.tools[0]!.function.parameters = { type: "object", anyOf: [{ type: "string" }] };
    const { results } = await run(files);
    const check = one(results, "invocation-schemas");
    expect(check.status).toBe("fail");
    expect(findingsText(check)).toMatch(/properties/);
  });

  test("`function.parameters` whose type is not `object` fails", async () => {
    const files = conformingSite();
    const net = files[`${BASE}demo.network.json`]!.body as { tools: { function: { parameters: unknown } }[] };
    // `properties` is present and well formed, so only the `type` rule can catch this.
    net.tools[0]!.function.parameters = { type: "string", properties: {} };
    const { results } = await run(files);
    const check = one(results, "invocation-schemas");
    expect(check.status).toBe("fail");
    expect(findingsText(check)).toMatch(/type.*always `object`|`type` is "string"/);
  });

  test("an agent that declares no parameters at all is not a failure", async () => {
    // The reference synthesises a required `inquiry` string for a sub-agent that
    // declares none, so the request still reaches it. A tool that failed this
    // would be stricter than the runtime, which is not strictness, it is noise.
    //
    // Built here: run against the shared fixture, this asserted a pass on a
    // document whose agents all DO declare parameters, so it proved nothing about
    // an agent that does not.
    const noneAnywhere = siteWithAgents([
      { name: "front", description: "Takes the question.", instructions: "Route it.", tools: ["leaf"] },
      { name: "leaf", description: "Answers it.", instructions: "Answer from what you are given." },
    ]);
    const results = (await run(noneAnywhere)).results;
    expect(one(results, "invocation-schemas").status).toBe("pass");
    expect(one(results, "invocation-schemas").detail).toMatch(/0 of 2/);

    // An explicit null is the other way a publisher declares nothing.
    const explicitNull = siteWithAgents([
      {
        name: "front",
        function: { description: "Takes the question.", parameters: null },
        instructions: "Route it.",
        tools: ["leaf"],
      },
      { name: "leaf", description: "Answers it.", instructions: "Answer from what you are given." },
    ]);
    expect(one((await run(explicitNull)).results, "invocation-schemas").status).toBe("pass");
  });
});

describe("§2.1 private-context rules", () => {
  test("a blanket `sly_data: true` fails: §2.1 says the network MUST name the fields", async () => {
    const files = conformingSite();
    const net = files[`${BASE}demo.network.json`]!.body as {
      tools: { allow?: { to_downstream?: { sly_data: unknown } } }[];
    };
    net.tools[0]!.allow!.to_downstream!.sly_data = true;
    const { results } = await run(files);
    const check = one(results, "private-context-rules");
    expect(check.status).toBe("fail");
    expect(findingsText(check)).toContain("to_downstream");
  });

  test("a named list passes, and so does declaring nothing at all: deny-by-default is conformant", async () => {
    const { results } = await run(conformingSite());
    expect(one(results, "private-context-rules").status).toBe("pass");

    const silent = conformingSite();
    const net = silent[`${BASE}demo.network.json`]!.body as { tools: Record<string, unknown>[] };
    delete net.tools[0]!["allow"];
    expect(one((await run(silent)).results, "private-context-rules").status).toBe("pass");
  });
});

describe("§2.2 portable data profile", () => {
  test("a publisher-only path in the MIDDLE of a string is caught, not just one at its start", async () => {
    // The anchoring trap, kept verbatim. An earlier version of this project's own
    // check anchored to `^` and would have passed exactly this value.
    const files = conformingSite();
    const net = files[`${BASE}demo.network.json`]!.body as { tools: { instructions: string }[] };
    net.tools[1]!.instructions = "Answer from the timetable. Overrides live in ./local-overrides.json when present.";
    const { results } = await run(files);
    const check = one(results, "portable-data");
    expect(check.status).toBe("fail");
    expect(findingsText(check)).toContain("./local-overrides.json");
  });

  test("a `${...}` substitution inside a URL is caught, because a URL is not exempt from substitution", async () => {
    const files = conformingSite();
    const net = files[`${BASE}demo.network.json`]!.body as { tools: { tools?: unknown[] }[] };
    net.tools[0]!.tools = ["timetable", { url: "https://tools.example/mcp?token=${MCP_TOKEN}", tools: ["search"] }];
    const { results } = await run(files);
    const check = one(results, "portable-data");
    expect(check.status).toBe("fail");
    expect(findingsText(check)).toContain("${MCP_TOKEN}");
  });

  test("an ordinary cross-origin URL is NOT reported as an absolute publisher path", async () => {
    // The same regexes that catch `/etc/agents/net.hocon` must leave
    // `https://peer.fixture.example/agents/weather` alone, or the tool fails every
    // site that links a peer -- which is every site the spec is about.
    const { results } = await run(conformingSite());
    expect(one(results, "portable-data").status).toBe("pass");
  });

  test("the path rules do not fire on an http(s) URL, but the substitution rules still do", () => {
    // Tested on the rule engine directly. A URL is an address, not a local path,
    // and the same regexes that must catch `/etc/agents/net.hocon` must leave a
    // published peer or MCP URL alone -- otherwise the tool fails every site that
    // links anything, which is every site this specification is about. A fixture
    // that merely happens to contain no path-shaped URL proves none of this.
    expect(portabilityFindings({ a: "https://cdn.example/site/config.yaml" })).toEqual([]);
    expect(portabilityFindings({ a: "https://cdn.example/x/./y" })).toEqual([]);
    expect(portabilityFindings({ a: "https://peer.example/agents/transit" })).toEqual([]);
    // ...and a substitution is unportable wherever it sits, URL or not.
    expect(portabilityFindings({ a: "https://cdn.example/${REGION}/x" })).toHaveLength(1);
    expect(portabilityFindings({ a: "https://cdn.example/x?t=$TOKEN" })).toHaveLength(1);
  });

  test("a URL EMBEDDED in a sentence is exempt too, not just a string that is entirely one", () => {
    // The same class as the anchoring question. The exemption tested the whole
    // string, so a bare URL was exempt and a sentence mentioning one was not:
    //
    //   "Docs at https://cdn.example/site/config.yaml"
    //
    // ...was reported as a publisher-only config file, on the `.yaml` inside a
    // perfectly portable public URL. Agent instructions are prose that mentions
    // URLs; a rule that fires on that makes the tool unusable on real sites.
    expect(portabilityFindings({ a: "Docs at https://cdn.example/site/config.yaml" })).toEqual([]);
    expect(portabilityFindings({ a: "See https://cdn.example/a/b for the feed." })).toEqual([]);
    expect(portabilityFindings({ a: "Mirror: http://mirror.example/x/./y (legacy)" })).toEqual([]);

    // ...and the exemption is a span, not a licence: a real local path in the SAME
    // string still fails, and so does a substitution inside the URL.
    const alongside = portabilityFindings({ a: "Docs at https://cdn.example/ok.yaml, overrides in ./local.conf" });
    expect(alongside).toHaveLength(1);
    expect(alongside[0]!.excerpt).toContain("./local.conf");

    // And the scan must keep going PAST an in-URL match of the SAME rule. Here
    // the config-file rule matches `ok.yaml` first, inside the URL, and then
    // `local-overrides.conf` outside it; a scanner that gave up on the first
    // in-span hit would excuse the second, and no other rule covers this string.
    const afterTheUrl = portabilityFindings({
      a: "Docs at https://cdn.example/ok.yaml and overrides in local-overrides.conf",
    });
    expect(afterTheUrl).toHaveLength(1);
    expect(afterTheUrl[0]!.what).toContain("config file");
    expect(portabilityFindings({ a: "Feed at https://cdn.example/${REGION}/x" })).toHaveLength(1);
    expect(portabilityFindings({ a: "Config lives at /etc/agents/net.hocon, see https://docs.example/a/b" })).toHaveLength(1);
  });

  test("a HOCON include key fails wherever it sits in the document", async () => {
    const files = conformingSite();
    const net = files[`${BASE}demo.network.json`]!.body as { tools: Record<string, unknown>[] };
    // The value trips no value rule on its own, so only the key rule can catch this.
    net.tools[1]!["include"] = "shared_definitions";
    const { results } = await run(files);
    const check = one(results, "portable-data");
    expect(check.status).toBe("fail");
    expect(findingsText(check)).toMatch(/key `include`/);
  });

  test("an environment reference fails", async () => {
    const files = conformingSite();
    const net = files[`${BASE}demo.network.json`]!.body as { llm_config: Record<string, unknown> };
    net.llm_config["api_base"] = "$OPENAI_BASE_URL";
    const { results } = await run(files);
    expect(one(results, "portable-data").status).toBe("fail");
  });

  test("a finding gives the JSON path AND the offending value, so a publisher can go and fix it", async () => {
    const files = conformingSite();
    const net = files[`${BASE}demo.network.json`]!.body as { tools: { instructions: string }[] };
    net.tools[1]!.instructions = "Read ~/secrets/keys.conf first.";
    const { results } = await run(files);
    const finding = findingsText(one(results, "portable-data"));
    expect(finding).toContain("tools[1].instructions");
    expect(finding).toContain("~/secrets/keys.conf");
  });
});

describe("referential integrity", () => {
  test("a `front_man` that names no agent in the network fails", async () => {
    const files = conformingSite();
    const manifest = files[`${BASE}agent-manifest.json`]!.body as { networks: { front_man: string }[] };
    manifest.networks[0]!.front_man = "reception";
    const { results } = await run(files);
    const check = one(results, "referential-integrity");
    expect(check.status).toBe("fail");
    expect(findingsText(check)).toContain("reception");
    // Specifically this reason. There is a second branch below that also fires on
    // this input, and a test satisfied by either one pins neither.
    expect(findingsText(check)).toMatch(/not the name of any agent in the network/);
  });

  test("a front agent that exists but is not the first entry in `tools` fails", async () => {
    // The vendored reference: "The first of these in the list is called the Front
    // Man." A manifest that names a different one disagrees with the runtime that
    // will read it, and the site has two answers to the same question.
    const files = conformingSite();
    const manifest = files[`${BASE}agent-manifest.json`]!.body as { networks: { front_man: string }[] };
    manifest.networks[0]!.front_man = "timetable";
    const { results } = await run(files);
    const check = one(results, "referential-integrity");
    expect(check.status).toBe("fail");
    expect(findingsText(check)).toMatch(/not the first entry/);
  });

  test("a front agent declared in the network's own metadata is checked too, not just the manifest's", async () => {
    // Found by running this tool against a deliberately broken fixture. A site may
    // name its front agent twice — in the manifest entry and in the network's
    // `metadata` — and the defect a publisher actually ships is that one of the two
    // follows a rename and the other does not. The first version of this check read
    // the manifest's value, found it correct, and reported a pass on a network whose
    // own metadata advertised an agent that did not exist.
    const files = conformingSite();
    const net = files[`${BASE}demo.network.json`]!.body as { metadata: Record<string, unknown> };
    net.metadata["front_man"] = "reception";
    const { results } = await run(files);
    const check = one(results, "referential-integrity");
    expect(check.status).toBe("fail");
    expect(findingsText(check)).toContain("metadata.front_man");
    expect(findingsText(check)).toContain("reception");
  });

  test("two declarations that disagree are a failure even when both name a real agent", async () => {
    const files = conformingSite();
    const net = files[`${BASE}demo.network.json`]!.body as { metadata: Record<string, unknown> };
    net.metadata["front_man"] = "timetable";
    const { results } = await run(files);
    const check = one(results, "referential-integrity");
    expect(check.status).toBe("fail");
    expect(findingsText(check)).toMatch(/different front agents/);
  });

  test("a symbolic tool reference bound in links.json resolves; an unbound one fails and is named", async () => {
    const bound = await run(conformingSite());
    expect(one(bound.results, "referential-integrity").status).toBe("pass");

    const files = conformingSite();
    const links = files[`${BASE}links.json`]!.body as { networks: Record<string, unknown> };
    links.networks["demo"] = {};
    const { results } = await run(files);
    const check = one(results, "referential-integrity");
    expect(check.status).toBe("fail");
    expect(findingsText(check)).toContain("weather_peer");
  });

  test("a links.json binding under a DIFFERENT network name does not resolve this network's reference", async () => {
    const files = conformingSite();
    const links = files[`${BASE}links.json`]!.body as { networks: Record<string, unknown> };
    links.networks = { other: { weather_peer: "https://peer.fixture.example/agents/weather" } };
    const { results } = await run(files);
    expect(one(results, "referential-integrity").status).toBe("fail");
  });

  test("a `/name` external-agent reference resolves only to a network the manifest publishes", async () => {
    const files = conformingSite();
    const net = files[`${BASE}demo.network.json`]!.body as { tools: { tools?: unknown[] }[] };
    net.tools[0]!.tools = ["timetable", "/not_published"];
    const { results } = await run(files);
    const check = one(results, "referential-integrity");
    expect(check.status).toBe("fail");
    expect(findingsText(check)).toContain("/not_published");
  });
});

describe("§3.3 and §3.4 hosting", () => {
  test("plain HTTP on a public host fails: production deployments MUST use HTTPS", async () => {
    const files: Record<string, unknown> = {};
    for (const [url, file] of Object.entries(conformingSite())) {
      files[url.replace("https://fixture.example", "http://fixture.example")] = file;
    }
    const { results } = await run(files, "http://fixture.example/agents/demo");
    const check = one(results, "https-hosting");
    expect(check.status).toBe("fail");
    expect(findingsText(check)).toContain("http://fixture.example");
  });

  test("plain HTTP on loopback passes, because §3.3 allows it for local development", async () => {
    const files: Record<string, unknown> = {};
    for (const [url, file] of Object.entries(conformingSite())) {
      files[url.replace("https://fixture.example", "http://127.0.0.1:4173")] = file;
    }
    const { results } = await run(files, "http://127.0.0.1:4173/agents/demo");
    const check = one(results, "https-hosting");
    expect(check.status).toBe("pass");
    expect(check.detail).toMatch(/local development/i);
  });

  test("every shape of local development host counts as loopback, for BOTH checks", async () => {
    // `myapp.test:5173` is an ordinary local development host. It used to fail
    // `https-hosting` as "not loopback" -- and far worse, `cors-hosting` PASSED
    // with the unqualified wording, dropping the "evidence about this machine
    // only" clause that is the whole point of that sentence. A local pass that
    // reads like a deployed pass is the exact failure the clause was added for,
    // so both checks are asserted for every host shape, together.
    const hosts = [
      "localhost:5173",
      "127.0.0.1:4173",
      "127.1.2.3",
      "myapp.localhost:3000",
      "myapp.test:5173",
      "deep.sub.myapp.test",
      "0.0.0.0:8080",
      "[::1]:8000",
      "[::ffff:127.0.0.1]:8000",
    ];
    for (const host of hosts) {
      const files: Record<string, unknown> = {};
      for (const [url, file] of Object.entries(conformingSite())) {
        // Through `new URL`, because that is how the tool resolves an artifact URL
        // and the parser normalises some hosts (`[::ffff:127.0.0.1]` becomes
        // `[::ffff:7f00:1]`). Keying the fixture off the raw spelling would make
        // the fetch miss and hand this test a not-demonstrated it has not earned.
        files[new URL(url.replace("https://fixture.example", `http://${host}`)).href] = file;
      }
      const { results } = await run(files, `http://${host}/agents/demo`);
      const https = one(results, "https-hosting");
      expect(https.status, host).toBe("pass");
      expect(https.detail, host).toMatch(/local development/i);
      const cors = one(results, "cors-hosting");
      expect(cors.status, host).toBe("pass");
      expect(cors.detail, host).toMatch(/loopback host/);
    }
  });

  test("a host that merely looks local is not treated as loopback", async () => {
    // The regex has to stay a regex about loopback, not about the word "local".
    for (const host of ["localhost.example.com", "mytest.example", "notlocalhost", "127.0.0.1.example.com"]) {
      const files: Record<string, unknown> = {};
      for (const [url, file] of Object.entries(conformingSite())) {
        files[url.replace("https://fixture.example", `http://${host}`)] = file;
      }
      const { results } = await run(files, `http://${host}/agents/demo`);
      expect(one(results, "https-hosting").status, host).toBe("fail");
      expect(one(results, "cors-hosting").detail, host).not.toMatch(/loopback host/);
    }
  });

  test("a CORS pass on a loopback host says so, because it is evidence about this machine only", async () => {
    // The same trap as HTTPS, one step further on: CORS is the check most likely to
    // pass locally and fail deployed, because a `_headers` file is a silent no-op on
    // a host that reads `vercel.json` and the reverse is equally silent. A pass read
    // off localhost that did not say this would be the tool's own worst habit.
    const files: Record<string, unknown> = {};
    for (const [url, file] of Object.entries(conformingSite())) {
      files[url.replace("https://fixture.example", "http://127.0.0.1:4173")] = file;
    }
    const local = await run(files, "http://127.0.0.1:4173/agents/demo");
    const localCors = one(local.results, "cors-hosting");
    expect(localCors.status).toBe("pass");
    expect(localCors.detail).toMatch(/loopback host/);
    expect(localCors.detail).toMatch(/deployed/);

    // ...and does not say it when the target is a real origin, where the pass means what it says.
    const remote = await run(conformingSite());
    const remoteCors = one(remote.results, "cors-hosting");
    expect(remoteCors.status).toBe("pass");
    expect(remoteCors.detail).not.toMatch(/loopback host/);
  });

  test("every artifact request carries an Origin header, so a server that gates CORS on it answers honestly", async () => {
    const { origins } = await run(conformingSite());
    expect(origins.length).toBeGreaterThan(0);
    for (const origin of origins) expect(origin).toMatch(/^https?:\/\//);
    // ...and never this site's own origin, which would make the probe same-origin and the CORS result meaningless.
    for (const origin of origins) expect(origin).not.toBe("https://fixture.example");
  });
});

describe("§4 credential handling", () => {
  test("a credential-shaped value published in the manifest fails", async () => {
    const files = conformingSite();
    const manifest = files[`${BASE}agent-manifest.json`]!.body as { llm_router: Record<string, unknown> };
    manifest.llm_router["api_key"] = "sk-SOMETHINGLONGENOUGHTOLOOKREAL0123456789";
    const { results } = await run(files);
    const check = one(results, "credential-handling");
    expect(check.status).toBe("fail");
    expect(findingsText(check)).toContain("llm_router.api_key");
  });

  test("the finding does not reprint the credential it found", async () => {
    // A conformance report gets pasted into issues and CI logs. Echoing the key
    // back would turn a tool that reports a leak into a second copy of it.
    const files = conformingSite();
    const manifest = files[`${BASE}agent-manifest.json`]!.body as { llm_router: Record<string, unknown> };
    manifest.llm_router["api_key"] = "sk-SOMETHINGLONGENOUGHTOLOOKREAL0123456789";
    const { results } = await run(files);
    const report = renderText(results, deriveTarget(NETWORK_URL));
    expect(report).not.toContain("SOMETHINGLONGENOUGHTOLOOKREAL");
    expect(findingsText(one(results, "credential-handling"))).not.toContain("SOMETHINGLONGENOUGHTOLOOKREAL");
  });

  test("placeholders, short values and non-strings are not credentials", async () => {
    // The old title claimed `requires_key: true` and an empty `byok_router`, and
    // the test ran the clean fixture, where `byok_router` is a non-empty URL and
    // `requires_key` is a boolean that `walk()` never visits. It asserted a clean
    // pass on a clean document and named a case it did not construct. So: build
    // the case, and keep the title to what is checked.
    const files = conformingSite();
    const manifest = files[`${BASE}agent-manifest.json`]!.body as { llm_router: Record<string, unknown> };
    const placeholders = {
      base_url: "https://router.fixture.example/v1",
      byok_router: "",
      requires_key: true,
      api_key: "",
      token: "<your token>",
      secret: "REPLACE_ME",
      password: "none",
      authorization: "Bearer",
      client_secret: "changeme",
      private_key: "xxxxx",
      // Short but NOT a placeholder, so only the length rule can excuse it. The
      // title said "short values" before this line existed, which made the claim
      // true of the title and false of the test.
      access_token: "oauth2",
    };
    manifest.llm_router = placeholders;
    const check = one((await run(files)).results, "credential-handling");
    expect(check.status, findingsText(check)).toBe("pass");

    // ...and the check is live on that same document: one real-looking value trips it.
    const planted = conformingSite();
    const plantedRouter = planted[`${BASE}agent-manifest.json`]!.body as { llm_router: Record<string, unknown> };
    plantedRouter.llm_router = { ...placeholders, token: "ghp_0123456789abcdefghijklmnopqrstuvwx" };
    expect(one((await run(planted)).results, "credential-handling").status).toBe("fail");
  });
});

describe("what the tool declines to check, and why", () => {
  test("every §6 check needing a browser or a live model is not-demonstrated, and none is a pass", async () => {
    const { results } = await run(conformingSite());
    for (const id of DECLINED_CHECKS) {
      const check = one(results, id);
      expect(check.status).toBe("not-demonstrated");
      expect(check.blockedBy).toBeTruthy();
      expect(check.detail.length).toBeGreaterThan(20);
    }
    // The set is closed: a check that quietly stops being reported is the same
    // failure as one that reads as a pass.
    const declined = results.filter((r) => r.status === "not-demonstrated").map((r) => r.check).sort();
    expect(declined).toEqual([...DECLINED_CHECKS].sort());
  });

  test("a not-demonstrated check never makes the exit code non-zero on its own", async () => {
    const { results } = await run(conformingSite());
    expect(results.some((r) => r.status === "not-demonstrated")).toBe(true);
    expect(exitCodeFor(results)).toBe(0);
  });

  test("check 2 is not-demonstrated on a site that requires a visitor key, and blames the checker AND the site", async () => {
    // §4's requirement level is MAY: "A site MAY publish a default router and model
    // that work without a visitor-supplied key." A BYOK-only site is neither a pass
    // nor a failure, and the tool must not resolve that silence in either direction.
    const { results } = await run(conformingSite());
    const check = one(results, "run-default-router");
    expect(check.status).toBe("not-demonstrated");
    expect(check.blockedBy).toBe("checker-and-site");
    expect(check.detail).toMatch(/requires_key|visitor-supplied key|without a key/i);
  });

  test("check 2 blames only the checker when the site says its default router needs no key", async () => {
    const files = conformingSite();
    const manifest = files[`${BASE}agent-manifest.json`]!.body as {
      llm_router: { default: Record<string, unknown> };
    };
    manifest.llm_router.default["requires_key"] = false;
    const { results } = await run(files);
    const check = one(results, "run-default-router");
    expect(check.status).toBe("not-demonstrated");
    expect(check.blockedBy).toBe("checker");
  });

  test("a site that publishes no router metadata at all is still not-demonstrated, never a pass", async () => {
    const files = conformingSite();
    const manifest = files[`${BASE}agent-manifest.json`]!.body as Record<string, unknown>;
    delete manifest["llm_router"];
    const { results } = await run(files);
    expect(one(results, "run-default-router").status).toBe("not-demonstrated");
  });

  test("a check that cannot be reached because an earlier one failed is not-demonstrated and blames the site", async () => {
    const files = conformingSite();
    delete files[`${BASE}agent-manifest.json`];
    const { results } = await run(files);
    const check = one(results, "agent-definitions");
    expect(check.status).toBe("not-demonstrated");
    expect(check.blockedBy).toBe("site");
    expect(check.detail).toMatch(/manifest/i);
    // The run still fails overall, on the check that actually failed.
    expect(exitCodeFor(results)).toBe(1);
  });
});

describe("the report a publisher reads", () => {
  test("a declined check is labelled NOT CHECKED and the word PASS never appears on its line", async () => {
    const { results } = await run(conformingSite());
    const text = renderText(results, deriveTarget(NETWORK_URL));
    expect(text).toContain("NOT CHECKED");
    const declinedTitles = results.filter((r) => r.status === "not-demonstrated").map((r) => r.title);
    expect(declinedTitles.length).toBeGreaterThan(0);
    for (const title of declinedTitles) {
      const line = text.split("\n").find((l) => l.includes(title));
      expect(line, `no line for ${title}`).toBeTruthy();
      expect(line!).not.toMatch(/\bPASS\b/);
      expect(line!).toContain("NOT CHECKED");
    }
  });

  test("the report says, in its own words, which checks were made and which were declined", async () => {
    const { results } = await run(conformingSite());
    const text = renderText(results, deriveTarget(NETWORK_URL));
    const checked = results.filter((r) => r.status !== "not-demonstrated").length;
    const declined = results.length - checked;
    expect(text).toContain(`${checked} checks made`);
    // Not `${declined} ` -- that matched the bare number anywhere in the report,
    // including inside a URL or a count of something else, and left the sibling
    // assertion doing all the work.
    expect(text).toContain(`${declined} not checked`);
    expect(text).toContain(NETWORK_URL);
  });

  test("every check carries a spec section, so a publisher can go and read the requirement", async () => {
    const { results } = await run(conformingSite());
    for (const r of results) expect(r.section, r.check).toMatch(/^§\d/);
  });

  test("exit code is 1 when anything failed and 0 when nothing did", async () => {
    const good = await run(conformingSite());
    expect(exitCodeFor(good.results)).toBe(0);

    const files = conformingSite();
    delete files[`${BASE}links.json`];
    const bad = await run(files);
    expect(exitCodeFor(bad.results)).toBe(1);
  });
});
