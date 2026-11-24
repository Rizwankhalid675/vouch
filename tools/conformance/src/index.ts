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
import { getArtifact, type Fetched } from "./fetch.ts";
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
  const manifestNetworks = Array.isArray((manifest.json as { networks?: unknown } | undefined)?.networks)
    ? (manifest.json as { networks: unknown[] }).networks
    : [];
  const entry = selectNetwork(manifestNetworks, target.networkName);

  // 2. The network definition, at the location the manifest declares — never at a
  //    filename this tool invented.
  const hoconUrl = entry ? resolveHocon(target.base, entry.hocon) : null;
  const network: Fetched | null = hoconUrl ? await get(hoconUrl) : null;

  // 3. The link map.
  const links = await get(new URL("links.json", target.base).href);

  const agentNames = new Set(agentsOf(network?.json).map((a) => a.name).filter((n) => n !== ""));
  // NULL, not an empty array: "this network references nothing symbolically" and
  // "I could not read the network" are different inputs and must not produce the
  // same sentence in the link map's detail.
  const symbolicRefs: string[] | null =
    network?.json !== undefined
      ? [...new Set(toolRefsOf(network.json, agentNames).filter((r) => r.kind === "symbolic").map((r) => r.value))]
      : null;

  const artifacts = [manifest, ...(network ? [network] : []), links];

  // Why a check that needs the network definition could not be made, traced to the
  // first thing that went wrong rather than to the symptom ("the network could not
  // be read" sends a publisher looking at a file that was never located) -- and
  // WHOSE limitation it is, which matters more.
  //
  // A request that never got an answer is not the site's fault and must not be
  // reported as such, so `blockedBy` is computed here rather than hard-coded, and
  // every downstream check inherits it. That hard-coded "site" was the bug.
  //
  // NAME THE ARTIFACT. "No artifact of this site was read" was false whenever the
  // manifest was read and only the hocon host refused -- which §3.2 expressly
  // permits to be a different origin -- and six checks had already passed on
  // artifacts that sentence said were not read.
  const unavailable: Unavailable =
    manifest.status === null
      ? {
          reason: `the site manifest at ${manifest.url} never answered, so the network definition was never even located.`,
          blockedBy: "checker",
          unreached: true,
          url: manifest.url,
        }
      : network?.status === null
        ? {
            reason: `the network definition at ${network.url} never answered. The site manifest was read; it is this one artifact that could not be, and §3.2 permits it to live on another origin.`,
            blockedBy: "checker",
            unreached: true,
            url: network.url,
          }
        : manifest.status !== 200 || manifest.json === undefined
          ? {
              reason: "the site manifest could not be read, so the network definition was never located.",
              blockedBy: "site",
              unreached: false,
            }
          : !entry
            ? {
                reason: "no manifest entry matched the requested network name, so no network definition was located.",
                blockedBy: "site",
                unreached: false,
              }
            : !hoconUrl
              ? {
                  reason: "the matching manifest entry declares no usable `hocon` location.",
                  blockedBy: "site",
                  unreached: false,
                }
              : {
                  reason: "the network definition at the location the manifest declares could not be read.",
                  blockedBy: "site",
                  unreached: false,
                };

  return [
    checkManifest(target, manifest),
    checkNetworkSelected(target, manifest),
    checkNetworkDefinition(manifest, entry, network),
    checkLinkMap(links, symbolicRefs),
    checkNetworkIdentity(entry, network, unavailable),
    checkAgentDefinitions(network, unavailable),
    checkTwoAgentNetwork(network, unavailable),
    checkInvocationSchemas(network, unavailable),
    checkPrivateContextRules(network, unavailable),
    checkPortableData(network, unavailable),
    checkReferentialIntegrity(entry, manifest, network, links, target.networkName, unavailable),
    checkHttps(target),
    checkCors(artifacts, probeOrigin, isLoopback(target)),
    checkCredentials(artifacts),
    ...declinedChecks(manifest, network),
  ];
}
