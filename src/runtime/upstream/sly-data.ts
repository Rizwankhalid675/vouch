/**
 * ===========================================================================
 * ADAPTED FROM THIRD-PARTY CODE. MODIFIED BY THE VOUCH AUTHORS.
 * ===========================================================================
 *
 * Source:  nsdeploy/runtime/generated/sly_data.gen.mjs
 *          https://github.com/cognizant-ai-lab/nsdeploy/blob/main/nsdeploy/runtime/generated/sly_data.gen.mjs
 *          (itself generated upstream from neuro_san/kernel/sly_data.py)
 * Project: Cognizant AI Lab — nsDeploy
 * Licence: Apache License 2.0. Full text: docs/vendor/LICENSE-Apache-2.0.txt
 * Fetched: 2026-11-23. Recorded in docs/vendor/PROVENANCE.md.
 *
 * CHANGES WE MADE (Apache-2.0 §4(b)):
 *  1. Translated from JavaScript to TypeScript.
 *  2. Upstream's signatures take `null` for "no sly_data" / "no allow list";
 *     ours take `undefined` as well, because an absent `allow` block in our
 *     network reads as `undefined` rather than `null`.
 *  3. Added `allowed_downstream_sly` / `allowed_upstream_sly`, which read the
 *     `allow` block off an agent spec. These are not in the generated module;
 *     they mirror the equivalent helpers in upstream's hand-written kernel.js
 *     (same repository, same licence).
 *  4. Dropped nothing.
 *
 * WHAT THESE DO NOT DO — read before describing this anywhere:
 * The `allow` blocks govern what crosses an AGENT-SITE boundary. The upstream
 * reference is explicit that sly_data "is already visible to all other internal
 * agents of the network". Filtering here does NOT isolate private context
 * between sibling agents inside one network, and we must not claim that it does.
 * Our published network names no allowed field at all (`sly_data: []` everywhere),
 * so the filter returns `{}` for every boundary either way.
 *
 * Function names are kept in upstream's snake_case deliberately; see graph.ts.
 */

import type { AgentSpec } from "../types.ts";

export type SlyData = Record<string, unknown>;

export function redact_sly_data(sly_data: SlyData | null | undefined): SlyData | null {
  if (sly_data === null || sly_data === undefined) return null;
  const out: SlyData = {};
  for (const key of Object.keys(sly_data)) out[key] = "<redacted>";
  return out;
}

export function filter_sly_data(sly_data: SlyData | null | undefined, allowed_keys: string[] | null | undefined): SlyData {
  if (sly_data === null || sly_data === undefined) return {};
  if (allowed_keys === null || allowed_keys === undefined) return {};
  if (allowed_keys.length === 0) return {};
  if (allowed_keys.includes("*")) return { ...sly_data };
  const out: SlyData = {};
  for (const key of allowed_keys) {
    if (Object.hasOwn(sly_data, key)) out[key] = sly_data[key];
  }
  return out;
}

export function allowed_downstream_sly(spec: AgentSpec | null | undefined): string[] | null {
  return spec?.allow?.to_downstream?.sly_data ?? null;
}

export function allowed_upstream_sly(spec: AgentSpec | null | undefined): string[] | null {
  return spec?.allow?.to_upstream?.sly_data ?? null;
}
