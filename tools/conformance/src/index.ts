// agentic-web-conformance — the public API.
//
// Copyright 2026 Rizwankhalid675. Licensed under the Apache License, Version 2.0.
//
//   import { runChecks } from "agentic-web-conformance";
//   const results = await runChecks("https://example.com/agents/my_network");
//
// `runChecks` takes the URL of ONE published network, not a site root. That is
// §3.2's own addressing: "A peer network is identified by an HTTP or HTTPS URL
// whose final path component is its published network name ... the runtime treats
// the preceding path as the site base and retrieves `agent-manifest.json` from
// that base." A function that took a site root would have to guess a network
// name, and guessing is the thing §3.2 was written to stop.
//
// Nothing in this tool reads a local file, assumes a directory layout, or knows
// any particular origin. It is for other people's sites; ours is one input.

import { deriveTarget, resolveHocon, selectNetwork, DiscoveryError } from "./discover.ts";
import { getArtifact, type Answered, type Fetched } from "./fetch.ts";
import {
  DECLINED_CHECKS,
  agentsOf,
  checkAgentDefinitions,
  checkCors,
  checkCredentials,
  checkHttps,
  checkInvocationSchemas,
  checkLinkMap,
  checkManifest,
  checkNetworkDefinition,
  checkNetworkIdentity,
  checkNetworkSelected,
  checkPortableData,
  checkPrivateContextRules,
  checkReferentialIntegrity,
  checkTwoAgentNetwork,
  declinedChecks,
  isLoopback,
  toolRefsOf,
} from "./checks.ts";
import type { CheckResult, RunOptions, Target, Unavailable } from "./types.ts";

export { DECLINED_CHECKS, DiscoveryError, deriveTarget };
export type { DeclinedCheckId } from "./checks.ts";
export { exitCodeFor, renderJson, renderText, VERSION } from "./report.ts";
export type { Blocker, CheckResult, CheckStatus, FetchLike, RunOptions, Target } from "./types.ts";

/**
 * A synthetic origin for the `Origin` header on every artifact request.
 *
 * `.invalid` is reserved by RFC 2606 and resolves nowhere, so it cannot
 * accidentally be the target's own origin — which matters, because a same-origin
 * probe makes the CORS result meaningless.
 */
export const DEFAULT_PROBE_ORIGIN = "https://agentic-web-conformance.invalid";

/**
 * Every check this tool reports, in the order it reports them.
 *
 * One list, used as both the key set of the result record and the output order, so
 * "the set of checks a run reports does not depend on what answered" is a property
 * of the types rather than of seven code paths each remembering to be complete.
 */
export const CHECK_IDS = [
  "manifest-reachable",
  "network-selected",
  "network-reachable",
  "links-reachable",
  "network-identity",
  "agent-definitions",
  "two-agent-network",
  "invocation-schemas",
  "private-context-rules",
  "portable-data",
  "referential-integrity",
  "https-hosting",
  "cors-hosting",
  "credential-handling",
  ...DECLINED_CHECKS,
] as const;

export type CheckId = (typeof CHECK_IDS)[number];

/** Runs every check this tool can make, and reports the ones it cannot. */
export async function runChecks(networkUrl: string, options: RunOptions = {}): Promise<CheckResult[]> {
  const target = deriveTarget(networkUrl);
  return runChecksOn(target, options);
}

/** As `runChecks`, for a caller that has already derived the target. */
export async function runChecksOn(target: Target, options: RunOptions = {}): Promise<CheckResult[]> {
  const fetchImpl = options.fetchImpl ?? ((url, init) => globalThis.fetch(url, init));
  const timeoutMs = options.timeoutMs ?? 10_000;
  const probeOrigin = options.probeOrigin ?? DEFAULT_PROBE_ORIGIN;
  const get = (url: string) => getArtifact(url, fetchImpl, probeOrigin, timeoutMs);

  // 1. The manifest, from the base derived from the URL. Always first: §3.2 gives
  //    no other way in, and the network's own location is only knowable from here.
  const manifest = await get(target.manifestUrl);
  const manifestDoc = manifest.outcome === "answered" ? manifest.json : undefined;
  const manifestNetworks = Array.isArray((manifestDoc as { networks?: unknown } | undefined)?.networks)
    ? (manifestDoc as { networks: unknown[] }).networks
    : [];
  const entry = selectNetwork(manifestNetworks, target.networkName);

  // 2. The network definition, at the location the manifest declares — never at a
  //    filename this tool invented.
  const hoconUrl = entry ? resolveHocon(target.base, entry.hocon) : null;
  const network: Fetched | null = hoconUrl ? await get(hoconUrl) : null;

  // 3. The link map.
  const links = await get(new URL("links.json", target.base).href);

  // THE AVAILABILITY DECISION, MADE ONCE.
  //
  // Seven content checks need the network definition. Each used to take a
  // `Fetched | null` and decide for itself whether it could read it, and three
  // rounds of this project's longest-running defect were one of those decisions
  // being wrong. They now receive an `Answered` or nothing at all, so a check
  // cannot be handed a request that got no answer -- there is no type that would
  // let it -- and `Unavailable` is a union, so the reason cannot be a site-blaming
  // one when nothing arrived.
  const networkDoc: Answered | null = network !== null && network.outcome === "answered" ? network : null;
  const agentNames = new Set(
    agentsOf(networkDoc?.json).map((a) => a.name).filter((n) => n !== ""),
  );
  // NULL, not an empty array: "this network references nothing symbolically" and
  // "I could not read the network" are different inputs and must not produce the
  // same sentence in the link map's detail.
  const symbolicRefs: string[] | null =
    networkDoc?.json !== undefined
      ? [...new Set(toolRefsOf(networkDoc.json, agentNames).filter((r) => r.kind === "symbolic").map((r) => r.value))]
      : null;

  const artifacts = [manifest, ...(network ? [network] : []), links];

  // Traced to the first thing that went wrong rather than to the symptom ("the
  // network could not be read" sends a publisher looking at a file that was never
  // located), and NAMING THE ARTIFACT rather than generalising to "the host":
  // §3.2 expressly permits the network definition to live on another origin, so
  // "no artifact of this site was read" was false whenever only that one refused.
  const unavailable: Unavailable =
    manifest.outcome === "no-answer"
      ? {
          kind: "unreached",
          artifact: manifest,
          what: "This check needs the network definition, whose location is declared in the site manifest.",
        }
      : network !== null && network.outcome === "no-answer"
        ? {
            kind: "unreached",
            artifact: network,
            what:
              "This check needs the network definition. The site manifest WAS read; it is this one artifact " +
              "that could not be, and §3.2 permits it to live on another origin.",
          }
        : manifest.json === undefined
          ? {
              kind: "unreadable",
              reason: "the site manifest could not be read, so the network definition was never located.",
            }
          : !entry
            ? {
                kind: "unreadable",
                reason: "no manifest entry matched the requested network name, so no network definition was located.",
              }
            : !hoconUrl
              ? { kind: "unreadable", reason: "the matching manifest entry declares no usable `hocon` location." }
              : {
                  kind: "unreadable",
                  reason: "the network definition at the location the manifest declares could not be read.",
                };

  // THE WHOLE SET, AS A TOTAL RECORD, mapped over one canonical order.
  //
  // This used to be an array literal with a spread on the end, and round 4's
  // refactor lost two checks inside that spread: a `slice(2)` on a three-element
  // array dropped `key-isolation` and `private-context-at-peer` whenever an
  // artifact got no answer. A reachable run reported twenty checks and an
  // unreachable one eighteen, and nothing said which two had gone -- a silent
  // omission, which is the one thing this tool may never do, since a check that is
  // not listed cannot be read as a pass, a failure or a declined item.
  //
  // `Record<CheckId, CheckResult>` is TOTAL. Leaving a check out is a compile
  // error (TS2741), naming one twice is a compile error, and `CHECK_IDS` fixes the
  // order -- so no state can assemble a different set, rather than seven branches
  // each remembering to be complete.
  //
  // Where the compiler stops, and this was measured rather than assumed: the
  // RECORD's totality is enforced, but the emitted LIST's is not. Truncating the
  // map below -- `CHECK_IDS.slice(2).map(...)`, the same shape as the round-4
  // regression -- compiles clean. What catches that is the test that asserts the
  // reported set equals `CHECK_IDS` in all seven states; it fails nine ways. So
  // the set is held by a type for its membership and by a test for its
  // completeness, and only the first of those is "by construction".
  const byId: Record<CheckId, CheckResult> = {
    "manifest-reachable": checkManifest(target, manifest),
    "network-selected": checkNetworkSelected(target, manifest),
    "network-reachable": checkNetworkDefinition(manifest, entry, network),
    "links-reachable": checkLinkMap(links, symbolicRefs),
    "network-identity": checkNetworkIdentity(entry, networkDoc, unavailable),
    "agent-definitions": checkAgentDefinitions(networkDoc, unavailable),
    "two-agent-network": checkTwoAgentNetwork(networkDoc, unavailable),
    "invocation-schemas": checkInvocationSchemas(networkDoc, unavailable),
    "private-context-rules": checkPrivateContextRules(networkDoc, unavailable),
    "portable-data": checkPortableData(networkDoc, unavailable),
    "referential-integrity": checkReferentialIntegrity(
      entry,
      manifest,
      networkDoc,
      links,
      target.networkName,
      unavailable,
    ),
    "https-hosting": checkHttps(target),
    "cors-hosting": checkCors(artifacts, probeOrigin, isLoopback(target)),
    "credential-handling": checkCredentials(artifacts),
    ...declinedChecks(manifest, network),
  };
  return CHECK_IDS.map((id) => byId[id]);
}
