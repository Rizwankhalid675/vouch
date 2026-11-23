/**
 * ===========================================================================
 * ADAPTED FROM THIRD-PARTY CODE. MODIFIED BY THE VOUCH AUTHORS.
 * ===========================================================================
 *
 * Source:  nsdeploy/runtime/engine.js, lines 22-93 only (the routing and
 *          peer-policy functions; none of the Engine class).
 *          https://github.com/cognizant-ai-lab/nsdeploy/blob/main/nsdeploy/runtime/engine.js
 * Project: Cognizant AI Lab — nsDeploy
 * Licence: Apache License 2.0. Full text: docs/vendor/LICENSE-Apache-2.0.txt
 * Fetched: 2026-11-23. Recorded in docs/vendor/PROVENANCE.md.
 *
 * CHANGES WE MADE (Apache-2.0 §4(b)):
 *  1. Translated from JavaScript to TypeScript; added types and return shapes.
 *  2. Took `normOrigin`, `sameRouter`, `selectTopRouter`, `manifestAllowsPeer`
 *     and `selectPeerRouter`. Did NOT take `isPublishedMockRouter` (it fetches a
 *     peer manifest to decide whether a router is the upstream demo mock; we
 *     publish no mock router) or anything else from engine.js.
 *  3. `selectTopRouter`'s logic, including the thrown message, is unchanged. The
 *     throw is load-bearing: a visitor with their own key and no published
 *     `llm_router.byok_router` must be stopped, not silently routed somewhere
 *     else. Task 5 found that defect in our manifest by running the real
 *     function; tests/artifacts.test.ts now pins the manifest shape against it.
 *  4. `manifestAllowsPeer` keeps upstream's `peer_policy.mode === "open"` branch
 *     even though our manifest deliberately does not set it, so that a peer's
 *     published policy is read the way upstream reads it.
 *  5. Dropped nothing from the five functions taken.
 */

import type { Manifest } from "../types.ts";

export function normOrigin(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return String(url || "");
  }
}

export function sameRouter(left: string, right: string): boolean {
  try {
    const normalize = (value: string): string => {
      const url = new URL(value);
      const loopback = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname);
      const host = loopback ? "loopback" : url.hostname.toLowerCase();
      return `${url.protocol}//${host}:${url.port}${url.pathname.replace(/\/$/, "")}${url.search}`;
    };
    return normalize(left) === normalize(right);
  } catch {
    return String(left || "").replace(/\/$/, "") === String(right || "").replace(/\/$/, "");
  }
}

export interface SelectedRouter {
  baseUrl: string;
  mock: boolean;
  upgradedToByok: boolean;
}

export function selectTopRouter(
  manifest: Manifest | null | undefined,
  routerOverride: string,
  byokKey: string,
  modelOverride = "",
): SelectedRouter {
  const declared = manifest?.llm_router ?? {};
  const hasRealKey = !!(byokKey && byokKey !== "demo");
  const hasExplicitModel = !!String(modelOverride || "").trim();
  let requested = String(routerOverride || "").replace(/\/$/, "");
  const requestedMock = !!requested && declared.mock === true && sameRouter(requested, declared.base_url ?? "");

  if ((hasRealKey || hasExplicitModel) && (!requested || requestedMock)) {
    if (!declared.byok_router) {
      throw new Error("A real API key is configured, but this site publishes no AI provider route.");
    }
    requested = declared.byok_router;
    return { baseUrl: requested, mock: false, upgradedToByok: true };
  }
  if (requested) {
    return {
      baseUrl: requested,
      mock: declared.mock === true && sameRouter(requested, declared.base_url ?? ""),
      upgradedToByok: false,
    };
  }
  return { baseUrl: declared.base_url || "", mock: declared.mock === true, upgradedToByok: false };
}

export function manifestAllowsPeer(
  target: string,
  manifest: Manifest | null | undefined,
  runtimeAllowedPeers: Set<string> = new Set(),
): boolean {
  const targetOrigin = normOrigin(target);
  const policy = manifest?.peer_policy ?? (manifest?.["web_policy"] as Manifest["peer_policy"]);
  if (policy?.mode === "open") {
    let parsed: URL;
    try {
      parsed = new URL(target);
    } catch {
      return false;
    }
    if (!["http:", "https:"].includes(parsed.protocol)) return false;
    const denied = (policy.deny_origins ?? policy.denied_origins ?? []).map(normOrigin);
    if (denied.includes(targetOrigin)) return false;
    return true;
  }
  const declared = (manifest?.allowed_peers ?? []).map(normOrigin);
  return declared.includes(targetOrigin) || runtimeAllowedPeers.has(targetOrigin);
}

export function selectPeerRouter(callerRouter: { baseUrl?: string; mock?: boolean } | null | undefined): {
  baseUrl: string;
  mock: boolean;
} {
  if (!callerRouter?.baseUrl) {
    throw new Error("The caller has no active LLM router to use for this peer network.");
  }
  return { baseUrl: callerRouter.baseUrl, mock: callerRouter.mock === true };
}
