// Discovery, exactly as §3.2 fixes it. No globbing, no guessed filenames.
//
// Copyright 2026 Rizwankhalid675. Licensed under the Apache License, Version 2.0.
//
// §3.2: "A peer network is identified by an HTTP or HTTPS URL whose final path
// component is its published network name. In this version, the runtime treats
// the preceding path as the site base and retrieves `agent-manifest.json` from
// that base."
//
// §3.2 again, on selection: "selects the entry whose name exactly matches the
// requested network. If no exact match exists, it MUST fail rather than select
// another published network."
//
// Two things follow, and both are load-bearing:
//
//  1. **The network name comes from the URL, and the file name comes from the
//     manifest.** Never the other way round. §3.3 says of
//     `<network>.network.json`: "This filename is a convention, not an
//     interoperability requirement; runtimes use the location declared in the
//     site manifest." A checker that looks for `<name>.network.json` reports a
//     conforming site as broken when it publishes under any other name.
//
//  2. **Exact match, no fallback.** A checker that falls back to the first entry
//     when the name misses will report a pass for a network nobody asked about.
//     That is the single most dangerous bug this file could have, so it has its
//     own test that asks for a name the manifest does not list.
//
// There is also a reason not to glob that is specific to sites built like this
// one: a site may publish deliberately broken networks (to demonstrate that its
// runtime refuses them). A globbing checker finds those and reports them as the
// publisher's failures.

import type { Target } from "./types.ts";

export class DiscoveryError extends Error {}

/**
 * Splits a network URL into the site base and the network name.
 *
 * @throws DiscoveryError if the URL is unparseable, is not http(s), or has no
 * final path component to take a network name from.
 */
export function deriveTarget(networkUrl: string): Target {
  let url: URL;
  try {
    url = new URL(networkUrl);
  } catch {
    throw new DiscoveryError(`not a URL: ${networkUrl}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new DiscoveryError(
      `a peer network is identified by an http or https URL (§3.2); got ${url.protocol}${networkUrl}`,
    );
  }
  // A query string and a fragment address something within a resource; neither is
  // part of the final path component, so neither is part of the network name.
  const segments = url.pathname.split("/");
  const last = segments.pop() ?? "";
  if (last === "") {
    throw new DiscoveryError(
      `no network name in ${networkUrl}: §3.2 takes the network name from the URL's final path ` +
        `component, so the URL must end in the network's published name (for example ` +
        `${url.origin}/agents/my_network), not in a slash or a bare origin`,
    );
  }
  const base = `${url.origin}${segments.join("/")}/`;
  return {
    networkUrl,
    base,
    networkName: decodeURIComponent(last),
    manifestUrl: new URL("agent-manifest.json", base).href,
  };
}

export interface ManifestNetwork {
  readonly name: string;
  readonly front_man?: unknown;
  readonly hocon?: unknown;
  readonly description?: unknown;
}

/**
 * The manifest entry whose `name` matches exactly, or null.
 *
 * Returns null rather than falling back, and the caller reports a failure. Case
 * is significant: a name that differs only by case is not an exact match.
 */
export function selectNetwork(entries: readonly unknown[], networkName: string): ManifestNetwork | null {
  for (const entry of entries) {
    if (entry && typeof entry === "object" && (entry as { name?: unknown }).name === networkName) {
      return entry as ManifestNetwork;
    }
  }
  return null;
}

/** The names a manifest publishes, for a failure message that tells a publisher what IS there. */
export function publishedNames(entries: readonly unknown[]): string[] {
  return entries
    .map((e) => (e && typeof e === "object" ? (e as { name?: unknown }).name : undefined))
    .filter((n): n is string => typeof n === "string");
}

/**
 * §3.2: "The runtime resolves the manifest's hocon value against the peer site
 * base ... The value MAY be a relative path or an absolute HTTP or HTTPS URL."
 */
export function resolveHocon(base: string, hocon: unknown): string | null {
  if (typeof hocon !== "string" || hocon.trim() === "") return null;
  try {
    return new URL(hocon, base).href;
  } catch {
    return null;
  }
}
