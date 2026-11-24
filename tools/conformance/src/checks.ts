// The checks.
//
// Copyright 2026 Rizwankhalid675. Licensed under the Apache License, Version 2.0.
//
// Each function here returns exactly one CheckResult and quotes the requirement
// it is checking. Where the specification's requirement level is MAY, or where
// the answer needs something a shell does not have, the result is
// `not-demonstrated` with the reason — never a pass, and never left out.

import type { Fetched } from "./fetch.ts";
import { describe as describeFetch } from "./fetch.ts";
import { publishedNames, selectNetwork, type ManifestNetwork } from "./discover.ts";
import { credentialFindings, formatFinding, portabilityFindings } from "./rules.ts";
import type { Blocker, CheckResult, Target, Unavailable } from "./types.ts";

const pass = (
  check: string,
  title: string,
  section: string,
  detail: string,
  findings: readonly string[] = [],
): CheckResult => ({ check, title, status: "pass", section, detail, findings });

const fail = (
  check: string,
  title: string,
  section: string,
  detail: string,
  findings: readonly string[],
): CheckResult => ({ check, title, status: "fail", section, detail, findings });

const declined = (
  check: string,
  title: string,
  section: string,
  detail: string,
  blockedBy: Blocker,
  findings: readonly string[] = [],
): CheckResult => ({ check, title, status: "not-demonstrated", section, detail, findings, blockedBy });

/**
 * A check that could not be made because an earlier one failed.
 *
 * Not a failure: this tool did not look, so it will not claim the site is wrong.
 * Not a pass either, obviously. `blockedBy: "site"` because the reason the tool
 * could not look is on the site's side, and a publisher needs to know that it is
 * not the tool refusing.
 */
const notReached = (
  check: string,
  title: string,
  section: string,
  because: string,
  blockedBy: Blocker = "site",
  unreached = false,
): CheckResult => ({
  check,
  title,
  status: "not-demonstrated",
  section,
  detail: `Not reached: ${because} This check was not made; resolve that first and run again.`,
  findings: [],
  blockedBy,
  ...(unreached ? { unreached: true } : {}),
});

/**
 * The request never got an answer: no status, no headers, no body.
 *
 * A DNS failure, a refused connection, a blocked proxy, a timeout, a mistyped
 * hostname. **A site cannot be at fault for a request that never arrived**, so
 * this is never a failure and never blamed on the site. It is the one case where
 * `blockedBy: "checker"` means something other than "a shell cannot drive a
 * browser": it means this checker did not get as far as asking.
 *
 * This was a real bug, found by review and not by us. A refused connection
 * produced `FAIL ... It was not [readable]` plus eleven lines reading "blocked by
 * the site", about a site that was serving correctly the whole time. "I could not
 * look" rendered as "I looked and it is wrong" -- the exact confusion every other
 * line of this tool exists to prevent.
 */
const neverReached = (check: string, title: string, section: string, fetched: Fetched): CheckResult => ({
  check,
  title,
  status: "not-demonstrated",
  section,
  detail:
    "This checker never reached the host, so it has no information about this site at all. Nothing came " +
    "back: no status, no headers, no body. That is a DNS failure, a refused connection, a proxy in the " +
    "way, a timeout or a mistyped hostname -- and a site cannot be at fault for a request that never " +
    "arrived, so this is not reported as its failure. Check the URL, then whether this machine can reach " +
    "that host at all.",
  findings: [describeFetch(fetched)],
  blockedBy: "checker",
  unreached: true,
});

// ---------------------------------------------------------------------------
// Presence (§3.2, §3.3)
// ---------------------------------------------------------------------------

const MANIFEST_TITLE = "Site manifest published and readable by a public GET";

export function checkManifest(target: Target, fetched: Fetched): CheckResult {
  const title = MANIFEST_TITLE;
  // Nothing came back at all. Not the site's failure; see `neverReached`.
  if (fetched.status === null) return neverReached("manifest-reachable", title, "§3.3", fetched);
  // §3.3, hosting rule for agent-manifest.json: "Public GET from the derived site base".
  if (fetched.status !== 200 || fetched.json === undefined) {
    return fail(
      "manifest-reachable",
      title,
      "§3.3",
      `§3.3 requires agent-manifest.json to be readable by a public GET from the site base derived ` +
        `from the network URL (${target.base}). It was not.`,
      [describeFetch(fetched)],
    );
  }
  const networks = (fetched.json as { networks?: unknown }).networks;
  if (!Array.isArray(networks) || networks.length === 0) {
    return fail(
      "manifest-reachable",
      title,
      "§3.3",
      "The manifest was read, but §3.3 requires it to carry \"One or more networks with name, front_man, and hocon\".",
      [`${fetched.url}: no non-empty \`networks\` array`],
    );
  }
  return pass(
    "manifest-reachable",
    title,
    "§3.3",
    `Read from the site base derived from the network URL, and it lists ${networks.length} network(s).`,
    [describeFetch(fetched), `publishes: ${publishedNames(networks).join(", ") || "(no named entries)"}`],
  );
}

export function checkNetworkSelected(target: Target, manifest: Fetched): CheckResult {
  const title = "The requested network name matches a manifest entry exactly";
  const section = "§3.2";
  if (manifest.status === null) {
    return notReached(
      "network-selected",
      title,
      section,
      "this checker never reached the host, so no manifest was read.",
      "checker",
      true,
    );
  }
  if (manifest.status !== 200 || manifest.json === undefined) {
    return notReached("network-selected", title, section, "the site manifest could not be read.");
  }
  const networks = (manifest.json as { networks?: unknown }).networks;
  if (!Array.isArray(networks)) {
    return notReached("network-selected", title, section, "the site manifest has no `networks` array.");
  }
  const entry = selectNetwork(networks, target.networkName);
  if (!entry) {
    return fail(
      "network-selected",
      title,
      section,
      '§3.2: the runtime "selects the entry whose name exactly matches the requested network. If no exact ' +
        'match exists, it MUST fail rather than select another published network." There is no exact match, ' +
        "so this tool failed rather than checking a network nobody asked about.",
      [
        `requested: ${target.networkName}`,
        `manifest publishes: ${publishedNames(networks).join(", ") || "(no named entries)"}`,
      ],
    );
  }
  return pass("network-selected", title, section, `The manifest entry named \`${target.networkName}\` was selected.`, [
    `${target.networkName} -> hocon: ${String(entry.hocon)}`,
  ]);
}

export function checkNetworkDefinition(
  manifest: Fetched,
  entry: ManifestNetwork | null,
  network: Fetched | null,
): CheckResult {
  const title = "Resolved network definition published and readable by a public GET";
  const section = "§3.3";
  if (manifest.status === null) {
    return notReached(
      "network-reachable",
      title,
      section,
      "this checker never reached the host, so the manifest never named a network definition.",
      "checker",
      true,
    );
  }
  if (manifest.status !== 200 || manifest.json === undefined) {
    return notReached("network-reachable", title, section, "the site manifest could not be read.");
  }
  if (!entry) {
    return notReached(
      "network-reachable",
      title,
      section,
      "no manifest entry matched the requested network name, so there is no declared location to fetch.",
    );
  }
  if (!network) {
    return fail(
      "network-reachable",
      title,
      section,
      "§3.3 requires the manifest entry to declare the network definition's HTTP(S) location in `hocon`, and " +
        "§3.2 resolves that value against the site base. This entry's `hocon` is missing or unusable as a URL.",
      [`${String(entry.name)}: hocon = ${JSON.stringify(entry.hocon ?? null)}`],
    );
  }
  if (network.status === null) return neverReached("network-reachable", title, section, network);
  if (network.status !== 200 || network.json === undefined) {
    return fail(
      "network-reachable",
      title,
      section,
      "The location the manifest declares in `hocon` did not answer a public GET with a JSON document.",
      [describeFetch(network)],
    );
  }
  const tools = (network.json as { tools?: unknown }).tools;
  if (!Array.isArray(tools)) {
    return fail(
      "network-reachable",
      title,
      section,
      "The document was read, but the vendored agent-network schema requires a `tools` array: it is the list of " +
        "agent definitions that make up the network, and the first entry is the front man.",
      [`${network.url}: no \`tools\` array`],
    );
  }
  return pass("network-reachable", title, section, `Read from the location the manifest declares, with ${tools.length} agent(s).`, [
    describeFetch(network),
  ]);
}

export function checkLinkMap(links: Fetched, symbolicRefs: readonly string[]): CheckResult {
  const title = "Peer-network link map published (links.json)";
  const section = "§3.3";
  const needed =
    symbolicRefs.length > 0
      ? `This network has ${symbolicRefs.length} symbolic external reference(s) that nothing else resolves (${symbolicRefs.join(", ")}), so the link map is what binds them.`
      : "This network declares no symbolic external reference, so the link map has nothing to bind — but §3.3 lists it among the minimum public files, so its absence is reported rather than waived.";
  if (links.status === null) return neverReached("links-reachable", title, section, links);
  if (links.status !== 200 || links.json === undefined) {
    return fail(
      "links-reachable",
      title,
      section,
      `§3.3 lists links.json among the minimum public files, hosted for "Public GET". ${needed}`,
      [describeFetch(links)],
    );
  }
  const networks = (links.json as { networks?: unknown }).networks;
  if (networks === undefined || networks === null || typeof networks !== "object" || Array.isArray(networks)) {
    return fail(
      "links-reachable",
      title,
      section,
      "links.json was read, but §3.3's example shape maps a network name to its named peer bindings under a " +
        "`networks` object, and this document has no such object.",
      [`${links.url}: no \`networks\` object`],
    );
  }
  return pass("links-reachable", title, section, "Published and readable, with a `networks` binding map.", [
    describeFetch(links),
  ]);
}

// ---------------------------------------------------------------------------
// Content (§2.1)
// ---------------------------------------------------------------------------

export interface Agent {
  readonly index: number;
  readonly raw: Record<string, unknown>;
  readonly name: string;
}

/** The agents in a network document, in published order. The first is the front man. */
export function agentsOf(network: unknown): Agent[] {
  const tools = (network as { tools?: unknown } | null)?.tools;
  if (!Array.isArray(tools)) return [];
  return tools.map((raw, index) => ({
    index,
    raw: (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>,
    name: typeof (raw as { name?: unknown })?.name === "string" ? ((raw as { name: string }).name) : "",
  }));
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);
const AGENT_NAME = /^[A-Za-z0-9_-]+$/;

export function checkNetworkIdentity(
  entry: ManifestNetwork | null,
  network: Fetched | null,
  unavailable: Unavailable,
): CheckResult {
  const title = "Network identity: a stable name, a short description and a named front agent";
  const section = "§2.1";
  if (!entry || !network || network.json === undefined) {
    return notReached("network-identity", title, section, unavailable.reason, unavailable.blockedBy, unavailable.unreached);
  }
  const doc = network.json as { metadata?: { description?: unknown; name?: unknown; front_man?: unknown } };
  const problems: string[] = [];
  if (!str(entry.front_man) && !str(doc.metadata?.front_man)) {
    problems.push(
      "no front agent is named: §3.3 requires `front_man` on the manifest entry, and nothing names one here",
    );
  }
  if (!str(entry.description) && !str(doc.metadata?.description)) {
    problems.push(
      "no description: §2.1 requires \"a short description\"; neither the manifest entry nor the network's " +
        "`metadata.description` carries one",
    );
  }
  if (agentsOf(network.json).length === 0) {
    problems.push("the network defines no agents");
  }
  if (problems.length > 0) {
    return fail(
      "network-identity",
      title,
      section,
      '§2.1: "A stable network name, a short description, and the name of its front agent."',
      problems,
    );
  }
  return pass("network-identity", title, section, "A name, a description and a named front agent are all published.", [
    `name: ${entry.name}`,
    `front agent: ${str(entry.front_man) ?? str(doc.metadata?.front_man)}`,
  ]);
}

export function checkAgentDefinitions(network: Fetched | null, unavailable: Unavailable): CheckResult {
  const title = "Agent definitions: unique name, a description, instructions when it uses an LLM";
  const section = "§2.1";
  if (!network || network.json === undefined) {
    return notReached("agent-definitions", title, section, unavailable.reason, unavailable.blockedBy, unavailable.unreached);
  }
  const agents = agentsOf(network.json);
  const problems: string[] = [];
  const seen = new Map<string, number>();
  for (const agent of agents) {
    const at = `tools[${agent.index}]`;
    if (agent.name === "") {
      problems.push(`${at}: no \`name\`; the vendored schema requires one on every agent`);
      continue;
    }
    if (!AGENT_NAME.test(agent.name)) {
      problems.push(
        `${at} (\`${agent.name}\`): a name may hold "alphanumeric characters with '-' or '_' as word ` +
          'separators. No spaces or other punctuation is allowed."',
      );
    }
    const first = seen.get(agent.name);
    if (first !== undefined) {
      problems.push(
        `${at} (\`${agent.name}\`): duplicate of tools[${first}]; §2.1 requires "a unique name within the scope ` +
          'of a single agent network hocon description"',
      );
    } else {
      seen.set(agent.name, agent.index);
    }

    const isToolbox = str(agent.raw["toolbox"]) !== null;
    const isCodedTool = str(agent.raw["class"]) !== null;
    const fn = (agent.raw["function"] ?? null) as { description?: unknown } | null;
    const hasDescription =
      str(fn?.description) !== null || str(agent.raw["description"]) !== null;
    if (!hasDescription && !isToolbox) {
      problems.push(
        `${at} (\`${agent.name}\`): no description. The vendored reference: "Every agent other than a toolbox ` +
          'agent must have its function description filled out, here or as a top-level description."',
      );
    }
    if (!isToolbox && !isCodedTool && str(agent.raw["instructions"]) === null) {
      problems.push(
        `${at} (\`${agent.name}\`): no \`instructions\`, and nothing marks it as a coded tool or a toolbox agent. ` +
          '§2.1 requires "instructions when it uses an LLM".',
      );
    }
    const tools = agent.raw["tools"];
    if (tools !== undefined && !Array.isArray(tools)) {
      problems.push(`${at} (\`${agent.name}\`): \`tools\` is present but is not an array`);
    }
  }
  if (problems.length > 0) {
    return fail("agent-definitions", title, section, `${problems.length} agent definition problem(s).`, problems);
  }
  return pass(
    "agent-definitions",
    title,
    section,
    `All ${agents.length} agent(s) carry a unique name, a description and instructions where an LLM is used.`,
    [`agents: ${agents.map((a) => a.name).join(", ")}`],
  );
}

export function checkTwoAgentNetwork(network: Fetched | null, unavailable: Unavailable): CheckResult {
  const title = "A two-agent network is published (§6's first interoperability check)";
  const section = "§6";
  if (!network || network.json === undefined) {
    return notReached("two-agent-network", title, section, unavailable.reason, unavailable.blockedBy, unavailable.unreached);
  }
  const agents = agentsOf(network.json);
  if (agents.length < 2) {
    return fail(
      "two-agent-network",
      title,
      section,
      '§6\'s first check reads "Publish a two-agent HOCON network and a manifest from an ordinary HTTPS web host."',
      [`this network defines ${agents.length} agent(s): ${agents.map((a) => a.name).join(", ") || "(none)"}`],
    );
  }
  return pass("two-agent-network", title, section, `${agents.length} agents are published.`, [
    `agents: ${agents.map((a) => a.name).join(", ")}`,
  ]);
}

export function checkInvocationSchemas(network: Fetched | null, unavailable: Unavailable): CheckResult {
  const title = "Invocation schemas are JSON-Schema compatible in the honoured form";
  const section = "§2.1";
  if (!network || network.json === undefined) {
    return notReached("invocation-schemas", title, section, unavailable.reason, unavailable.blockedBy, unavailable.unreached);
  }
  const agents = agentsOf(network.json);
  const problems: string[] = [];
  let declaredCount = 0;
  for (const agent of agents) {
    const fn = (agent.raw["function"] ?? null) as { parameters?: unknown } | null;
    const parameters = fn?.parameters;
    const at = `tools[${agent.index}].function.parameters`;
    if (parameters === undefined || parameters === null) continue;
    declaredCount += 1;
    if (typeof parameters !== "object" || Array.isArray(parameters)) {
      problems.push(`${at}: not an object`);
      continue;
    }
    const schema = parameters as Record<string, unknown>;
    if (schema["type"] !== "object") {
      problems.push(
        `${at}: \`type\` is ${JSON.stringify(schema["type"] ?? null)}. The vendored reference: "The type of the ` +
          'parameters dictionary is always `object`."',
      );
    }
    const properties = schema["properties"];
    if (typeof properties !== "object" || properties === null || Array.isArray(properties)) {
      const unsupported = ["anyOf", "oneOf", "allOf", "$ref", "additionalProperties"].filter((k) => k in schema);
      problems.push(
        `${at}: no \`properties\` dictionary` +
          (unsupported.length > 0 ? `, and it uses ${unsupported.join(", ")}` : "") +
          '. The vendored reference: "Only the `type: object` + `properties` form ... is supported" and a schema ' +
          "that uses constructs outside it without a `properties` dictionary \"is rejected as invalid when the " +
          'agent is called as a tool".',
      );
    }
  }
  if (problems.length > 0) {
    return fail("invocation-schemas", title, section, `${problems.length} invocation schema problem(s).`, problems);
  }
  return pass(
    "invocation-schemas",
    title,
    section,
    `${declaredCount} of ${agents.length} agent(s) declare \`function.parameters\`, and each declared schema uses ` +
      "the honoured `type: object` + `properties` form. An agent that declares none is not a failure: the reference " +
      "synthesises a required `inquiry` string for it, so a caller's request still gets through.",
  );
}

const SLY_BLOCKS = ["to_downstream", "from_downstream", "to_upstream", "to_tracing"] as const;

export function checkPrivateContextRules(network: Fetched | null, unavailable: Unavailable): CheckResult {
  const title = "Private-context fields are named, not allowed in bulk";
  const section = "§2.1";
  if (!network || network.json === undefined) {
    return notReached("private-context-rules", title, section, unavailable.reason, unavailable.blockedBy, unavailable.unreached);
  }
  const problems: string[] = [];
  let namedCount = 0;
  for (const agent of agentsOf(network.json)) {
    const allow = (agent.raw["allow"] ?? null) as Record<string, unknown> | null;
    if (!allow || typeof allow !== "object") continue;
    for (const block of SLY_BLOCKS) {
      const inner = allow[block];
      if (!inner || typeof inner !== "object") continue;
      const sly = (inner as { sly_data?: unknown }).sly_data;
      const at = `tools[${agent.index}] (\`${agent.name}\`).allow.${block}.sly_data`;
      if (sly === true) {
        problems.push(`${at}: \`true\` allows every private field through without naming any`);
      } else if (sly && typeof sly === "object" && !Array.isArray(sly)) {
        for (const [key, value] of Object.entries(sly as Record<string, unknown>)) {
          if ((key === "*" || key === "") && value !== false) {
            problems.push(`${at}: the wildcard key \`${key}\` allows fields that are never named`);
          } else if (value !== false) {
            namedCount += 1;
          }
        }
      } else if (Array.isArray(sly)) {
        namedCount += sly.filter((k) => typeof k === "string").length;
      }
    }
  }
  if (problems.length > 0) {
    return fail(
      "private-context-rules",
      title,
      section,
      '§2.1: "Private data is separate from chat content and is deny-by-default across agent-site boundaries. ' +
        'A network MUST explicitly name fields that may pass downstream or upstream."',
      problems,
    );
  }
  return pass(
    "private-context-rules",
    title,
    section,
    namedCount > 0
      ? `${namedCount} private-context field permission(s), each naming its field.`
      : "No private-context field is allowed through at all, which is §2.1's deny-by-default and conformant. " +
          "Whether the runtime honours it cannot be seen from here — see the private-context check below.",
  );
}

// ---------------------------------------------------------------------------
// Portability (§2.2) and referential integrity
// ---------------------------------------------------------------------------

export function checkPortableData(network: Fetched | null, unavailable: Unavailable): CheckResult {
  const title = "Published definition is portable data: no includes, substitutions, env or publisher paths";
  const section = "§2.2";
  if (!network || network.json === undefined) {
    return notReached("portable-data", title, section, unavailable.reason, unavailable.blockedBy, unavailable.unreached);
  }
  const findings = portabilityFindings(network.json);
  if (findings.length > 0) {
    return fail(
      "portable-data",
      title,
      section,
      '§2: the published form "MUST NOT depend on local includes, environment substitutions, or publisher-only ' +
        'file paths that the Neuro SAN HOCON format affords on server systems." Matched anywhere in a string, ' +
        "not only at its start.",
      findings.map(formatFinding),
    );
  }
  return pass(
    "portable-data",
    title,
    section,
    "No include, substitution, environment reference or publisher-side path anywhere in the document.",
  );
}

export type ToolRefKind = "internal" | "url" | "mcp" | "external-name" | "symbolic";

export interface ToolRef {
  readonly at: string;
  readonly value: string;
  readonly kind: ToolRefKind;
}

/** Every tool reference in the network, classified by the form it uses. */
export function toolRefsOf(network: unknown, agentNames: ReadonlySet<string>): ToolRef[] {
  const refs: ToolRef[] = [];
  for (const agent of agentsOf(network)) {
    const tools = agent.raw["tools"];
    if (!Array.isArray(tools)) continue;
    tools.forEach((entry, i) => {
      const at = `tools[${agent.index}] (\`${agent.name}\`).tools[${i}]`;
      if (entry && typeof entry === "object" && typeof (entry as { url?: unknown }).url === "string") {
        refs.push({ at, value: (entry as { url: string }).url, kind: "mcp" });
        return;
      }
      if (typeof entry !== "string") {
        refs.push({ at, value: JSON.stringify(entry), kind: "symbolic" });
        return;
      }
      if (agentNames.has(entry)) refs.push({ at, value: entry, kind: "internal" });
      else if (/^https?:\/\//i.test(entry)) refs.push({ at, value: entry, kind: "url" });
      else if (entry.startsWith("/")) refs.push({ at, value: entry, kind: "external-name" });
      else refs.push({ at, value: entry, kind: "symbolic" });
    });
  }
  return refs;
}

export function checkReferentialIntegrity(
  entry: ManifestNetwork | null,
  manifest: Fetched,
  network: Fetched | null,
  links: Fetched,
  networkName: string,
  unavailable: Unavailable,
): CheckResult {
  const title = "Every reference resolves: front agent, in-network agents, link-map bindings, URLs, MCP";
  const section = "§3.1";
  if (!network || network.json === undefined) {
    return notReached("referential-integrity", title, section, unavailable.reason, unavailable.blockedBy, unavailable.unreached);
  }
  const agents = agentsOf(network.json);
  const names = new Set(agents.map((a) => a.name).filter((n) => n !== ""));
  const problems: string[] = [];

  // EVERY declaration, not the first one found. A site may name its front agent in
  // the manifest entry AND in the network's own metadata, and when the two disagree
  // the site has published two answers to the same question. Reading one and
  // ignoring the other is how a checker misses exactly the defect a publisher
  // actually ships: an agent gets renamed and one of the two declarations follows.
  // (Found by running this tool against a deliberately broken fixture whose only
  // defect was in the declaration the first version of this check did not read.)
  const doc = network.json as { metadata?: { front_man?: unknown } };
  const declarations: { where: string; value: string }[] = [];
  if (str(entry?.front_man)) declarations.push({ where: "the manifest entry's `front_man`", value: str(entry?.front_man)! });
  if (str(doc.metadata?.front_man)) {
    declarations.push({ where: "the network's `metadata.front_man`", value: str(doc.metadata?.front_man)! });
  }
  for (const declaration of declarations) {
    if (!names.has(declaration.value)) {
      problems.push(
        `${declaration.where} is \`${declaration.value}\`, which is not the name of any agent in the network ` +
          `(${[...names].join(", ") || "none"})`,
      );
    } else if (agents[0]?.name !== declaration.value) {
      // The vendored reference: "The first of these in the list is called the 'Front Man'."
      // A declaration naming a different one disagrees with the runtime that reads it.
      problems.push(
        `${declaration.where} is \`${declaration.value}\`, which is not the first entry in \`tools\` (that is ` +
          '`' + `${agents[0]?.name}` + '`). The vendored reference: "The first of these in the list is called ' +
          'the Front Man."',
      );
    }
  }
  const distinct = [...new Set(declarations.map((d) => d.value))];
  if (distinct.length > 1) {
    problems.push(
      `the site publishes ${distinct.length} different front agents for this one network ` +
        `(${declarations.map((d) => `${d.value} in ${d.where}`).join("; ")}). A caller reads one of them.`,
    );
  }
  const frontMan = declarations[0]?.value ?? null;

  const bindings = ((links.json as { networks?: Record<string, unknown> } | undefined)?.networks ?? {})[networkName];
  const bound = new Set(
    bindings && typeof bindings === "object" && !Array.isArray(bindings) ? Object.keys(bindings) : [],
  );
  const manifestNames = new Set(
    Array.isArray((manifest.json as { networks?: unknown } | undefined)?.networks)
      ? publishedNames((manifest.json as { networks: unknown[] }).networks)
      : [],
  );

  for (const ref of toolRefsOf(network.json, names)) {
    if (ref.kind === "internal" || ref.kind === "url" || ref.kind === "mcp") continue;
    if (ref.kind === "external-name") {
      const name = ref.value.slice(1);
      if (!manifestNames.has(name)) {
        problems.push(
          `${ref.at}: \`${ref.value}\` names an external agent network, and the site manifest publishes no ` +
            `network called \`${name}\` (it publishes ${[...manifestNames].join(", ") || "nothing"})`,
        );
      }
      continue;
    }
    if (!bound.has(ref.value)) {
      problems.push(
        `${ref.at}: \`${ref.value}\` is neither an agent in this network, nor a URL, nor an MCP descriptor, nor ` +
          `a name bound for this network in links.json (bound: ${[...bound].join(", ") || "nothing"})`,
      );
    }
  }

  if (problems.length > 0) {
    return fail(
      "referential-integrity",
      title,
      section,
      '§3.1 requires a runtime to "Reject malformed networks, duplicate or missing agent references, an invalid ' +
        'front agent, and unsupported executable definitions before any model call." These would be rejected.',
      problems,
    );
  }
  const refs = toolRefsOf(network.json, names);
  return pass("referential-integrity", title, section, `Front agent and all ${refs.length} tool reference(s) resolve.`, [
    `front agent: ${frontMan ?? "(none named)"}`,
    ...refs.map((r) => `${r.at}: ${r.value} (${r.kind})`),
  ]);
}

// ---------------------------------------------------------------------------
// Hosting (§3.3, §3.4)
// ---------------------------------------------------------------------------

/**
 * Hosts where plain HTTP is a local development server rather than a deployment.
 *
 * §3.3: "Production deployments MUST use HTTPS; loopback HTTP is acceptable for
 * local development." Two checks read this and they must never disagree, because
 * a host that `https-hosting` excuses but `cors-hosting` does not recognise gets
 * a CORS pass worded as though it had been read off a deployed origin -- which is
 * the one thing that clause exists to prevent.
 *
 * `.localhost` and `.test` are both reserved for exactly this by RFC 6761;
 * `0.0.0.0` is what a dev server prints when it binds every interface; and
 * `::ffff:127.x.x.x` is how loopback arrives on a dual-stack listener. Anchored
 * at both ends with a literal dot before the reserved suffixes, so
 * `localhost.example.com` and `mytest.example` are not local anything.
 *
 * The `7f` branch is not obfuscation: `new URL("http://[::ffff:127.0.0.1]/")`
 * reports its hostname as `[::ffff:7f00:1]`, because the parser normalises the
 * IPv4-mapped form to hex. Matching only the dotted spelling would miss every
 * such host after parsing, which is the only place this is ever read. `7f` plus
 * two hex digits is the whole of 127/8.
 */
const LOOPBACK =
  /^(localhost|127(\.\d{1,3}){3}|0\.0\.0\.0|\[?::1\]?|\[?::ffff:(127(\.\d{1,3}){3}|7f[0-9a-f]{2}:[0-9a-f]{1,4})\]?|.+\.(localhost|test))$/i;

export function checkHttps(target: Target): CheckResult {
  const title = "Served over HTTPS (loopback HTTP allowed for local development)";
  const section = "§3.3";
  const url = new URL(target.networkUrl);
  if (url.protocol === "https:") {
    return pass("https-hosting", title, section, "The site base is HTTPS.", [`site base: ${target.base}`]);
  }
  if (isLoopback(target)) {
    return pass(
      "https-hosting",
      title,
      section,
      '§3.3: "Production deployments MUST use HTTPS; loopback HTTP is acceptable for local development." This is ' +
        "a loopback host, so plain HTTP is allowed here — and this result says nothing about the deployed site.",
      [`site base: ${target.base}`],
    );
  }
  return fail(
    "https-hosting",
    title,
    section,
    '§3.3: "Production deployments MUST use HTTPS; loopback HTTP is acceptable for local development." This host ' +
      "is not loopback.",
    [`site base: ${target.base}`],
  );
}

export function isLoopback(target: Target): boolean {
  try {
    return LOOPBACK.test(new URL(target.networkUrl).hostname);
  } catch {
    return false;
  }
}

export function checkCors(artifacts: readonly Fetched[], probeOrigin: string, loopback: boolean): CheckResult {
  const title = "CORS header present on the real response for every public artifact";
  const section = "§3.4";
  const reachable = artifacts.filter((a) => a.status === 200);
  if (reachable.length === 0) {
    const neverAnswered = artifacts.every((a) => a.status === null);
    return notReached(
      "cors-hosting",
      title,
      section,
      neverAnswered
        ? "this checker never reached the host, so there was no response to read a header off."
        : "no public artifact answered a GET with 200, so there was no response to read a header off.",
      neverAnswered ? "checker" : "site",
      neverAnswered,
    );
  }
  const problems: string[] = [];
  const evidence: string[] = [];
  for (const artifact of reachable) {
    const allow = artifact.allowOrigin;
    if (allow === null) {
      problems.push(`${artifact.url}: no Access-Control-Allow-Origin on the HTTP ${artifact.status} response`);
    } else if (allow.trim() !== "*" && allow.trim() !== probeOrigin) {
      problems.push(
        `${artifact.url}: Access-Control-Allow-Origin: ${allow} — which permits that origin, not a browser on ` +
          "any other one",
      );
    } else {
      evidence.push(`${artifact.url}: Access-Control-Allow-Origin: ${allow}`);
    }
  }
  if (problems.length > 0) {
    return fail(
      "cors-hosting",
      title,
      section,
      '§3.2: "Cross-origin artifacts MUST be published with appropriate CORS headers", and §3.3 gives the ' +
        'manifest\'s hosting rule as "CORS enabled for callers". This was read off the real response to a GET ' +
        `carrying \`Origin: ${probeOrigin}\`, not inferred from a config file. (§3.4 exempts a site whose ` +
        "artifacts are only ever loaded from its own origin: if no other origin will ever load these, this " +
        "failure does not apply to you.)",
      problems,
    );
  }
  return pass(
    "cors-hosting",
    title,
    section,
    `Every reachable artifact answered a cross-origin GET (Origin: ${probeOrigin}) with a usable ` +
      "Access-Control-Allow-Origin." +
      (loopback
        ? " But this ran against a loopback host, so it is evidence about the server on this machine and " +
          "nothing else. CORS is the check most likely to pass locally and fail deployed: a `_headers` file is " +
          "a silent no-op on a host that reads `vercel.json`, and the reverse is equally silent. Run this " +
          "again against the deployed origin before believing it."
        : ""),
    evidence,
  );
}

export function checkCredentials(artifacts: readonly Fetched[]): CheckResult {
  const title = "No credential published in the manifest, the network definition or the link map";
  const section = "§4";
  const readable = artifacts.filter((a) => a.json !== undefined);
  if (readable.length === 0) {
    const neverAnswered = artifacts.every((a) => a.status === null);
    return notReached(
      "credential-handling",
      title,
      section,
      neverAnswered
        ? "this checker never reached the host, so there was nothing to read."
        : "no public artifact could be read as JSON.",
      neverAnswered ? "checker" : "site",
      neverAnswered,
    );
  }
  const problems: string[] = [];
  for (const artifact of readable) {
    for (const finding of credentialFindings(artifact.json)) {
      problems.push(`${artifact.url} -> ${formatFinding(finding)}`);
    }
  }
  if (problems.length > 0) {
    return fail(
      "credential-handling",
      title,
      section,
      '§4: a conforming runtime "MUST NOT place it in URLs, manifests, agent network specification, prompts, ' +
        'action arguments, traces, analytics, or peer-site requests." Values are not reprinted below; revoke ' +
        "anything real that is named.",
      problems,
    );
  }
  return pass(
    "credential-handling",
    title,
    section,
    `${readable.length} published artifact(s) carry no credential-shaped value. This is a pattern check, so it ` +
      "is evidence of nothing worse than the patterns it knows.",
  );
}

// ---------------------------------------------------------------------------
// What a command line cannot check (§6)
// ---------------------------------------------------------------------------

/** The §6 checks this tool declines, in the order §6 lists them. */
export const DECLINED_CHECKS = [
  "run-default-router",
  "grounded-capability",
  "peer-composition",
  "key-isolation",
  "private-context-at-peer",
  "visible-refusals",
] as const;

const NO_BROWSER =
  "This tool is a command line: it has no browser, no running agent loop and no model credential, so it cannot " +
  "observe this. ";

export function declinedChecks(manifest: Fetched, network: Fetched | null): CheckResult[] {
  const manifestDoc = (manifest.json ?? {}) as Record<string, unknown>;
  const router = (manifestDoc["llm_router"] ?? null) as Record<string, unknown> | null;
  const routerDefault = (router?.["default"] ?? null) as Record<string, unknown> | null;
  const keyFree =
    router !== null &&
    (router["publisher_funded"] === true ||
      router["mock"] === true ||
      routerDefault?.["requires_key"] === false ||
      router["requires_key"] === false);

  const routerDetail = router
    ? keyFree
      ? "The manifest does declare a default router that it says needs no visitor key, so the path exists to be " +
        "run; running it is what cannot be done from here."
      : "The manifest declares a default router, but nothing in it says that router works without a " +
        "visitor-supplied key (no `requires_key: false`, no `publisher_funded: true`, no `mock: true`). §4's " +
        'level is MAY — "A site MAY publish a default router and model that work without a visitor-supplied ' +
        'key" — so a key-required site is neither a pass nor a failure of this check, and this tool will not ' +
        "resolve that silence in either direction."
    : "The manifest declares no `llm_router` at all, so there is no default router for this check to run — and " +
      "§4's level is MAY, so that alone is not a failure either.";

  const mcpCount = network?.json
    ? toolRefsOf(network.json, new Set(agentsOf(network.json).map((a) => a.name))).filter((r) => r.kind === "mcp")
        .length
    : 0;
  const actions = Array.isArray(manifestDoc["actions"]) ? (manifestDoc["actions"] as unknown[]).length : 0;
  const peers = Array.isArray(manifestDoc["allowed_peers"]) ? (manifestDoc["allowed_peers"] as unknown[]).length : 0;

  return [
    declined(
      "run-default-router",
      "Run the network with the site's published default router, and the BYOK path too",
      "§6",
      `${NO_BROWSER}${routerDetail}`,
      keyFree ? "checker" : "checker-and-site",
      router ? [`manifest declares llm_router: ${Object.keys(router).join(", ")}`] : ["manifest declares no llm_router"],
    ),
    declined(
      "grounded-capability",
      "Call an internal agent and a grounded capability through MCP or a site action",
      "§6",
      `${NO_BROWSER}What is declared can be read: ${mcpCount} MCP descriptor(s) in the network and ${actions} ` +
        "action(s) in the manifest. A declaration is not a call; whether either one answers, and whether the " +
        "runtime validates its arguments, needs the page running.",
      mcpCount + actions > 0 ? "checker" : "checker-and-site",
      [`MCP descriptors: ${mcpCount}`, `declared site actions: ${actions}`],
    ),
    declined(
      "peer-composition",
      "After user approval, load an exact named network from a second origin and run it locally",
      "§6",
      `${NO_BROWSER}Consent is a browser interaction and local execution is a browser runtime; neither exists ` +
        `here. The link map and allow-list can be read (${peers} allowed peer origin(s)), and this tool can be ` +
        "pointed at a peer's own network URL to check that peer's published artifacts — but running the peer in " +
        "a caller's browser, after approval, is not something a shell observes.",
      "checker",
      [`allowed peer origins declared: ${peers}`],
    ),
    declined(
      "key-isolation",
      "With a user key active, the second site never receives it and cannot change the caller's router",
      "§6",
      `${NO_BROWSER}This is a claim about requests a running page makes with a live credential. It can only be ` +
        "shown by capturing those requests in a browser; a static read of published files cannot see where a key " +
        "goes at runtime. The published-file half of §4 — that no credential is in the artifacts themselves — is " +
        "checked above as `credential-handling`, and is a much weaker statement than this one.",
      "checker",
    ),
    declined(
      "private-context-at-peer",
      "Private context is absent at the peer unless a named field is explicitly allowed",
      "§6",
      `${NO_BROWSER}What the network declares is checked above as \`private-context-rules\`. Whether the runtime ` +
        "honours those declarations — that the field really is absent in the request that reaches the peer — is a " +
        "property of a live invocation, and a declaration is not the behaviour.",
      "checker",
    ),
    declined(
      "visible-refusals",
      "An invalid network, a cycle, an over-budget request and a denied origin all stop with a visible error",
      "§6",
      `${NO_BROWSER}Each of the four needs a runtime to refuse something and a page to show the refusal. This ` +
        "tool can check that the artifacts of a *valid* network are valid; it cannot watch an invalid one being " +
        "refused, and it will not read the presence of a broken fixture on a site as evidence that anything " +
        "refuses it.",
      "checker",
    ),
  ];
}
