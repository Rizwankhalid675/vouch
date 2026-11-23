/**
 * ===========================================================================
 * ADAPTED FROM THIRD-PARTY CODE. MODIFIED BY THE VOUCH AUTHORS.
 * ===========================================================================
 *
 * Source:  nsdeploy/runtime/generated/validation.gen.mjs
 *          https://github.com/cognizant-ai-lab/nsdeploy/blob/main/nsdeploy/runtime/generated/validation.gen.mjs
 *          (itself generated upstream from neuro_san/kernel/validation.py)
 * Project: Cognizant AI Lab — nsDeploy
 * Licence: Apache License 2.0. Full text: docs/vendor/LICENSE-Apache-2.0.txt
 * Fetched: 2026-11-23 at commit 486ecf26aa8775963f9b765f894734bef1ac9817.
 * Permalink: https://github.com/cognizant-ai-lab/nsdeploy/blob/486ecf26aa8775963f9b765f894734bef1ac9817/nsdeploy/runtime/generated/validation.gen.mjs
 *            (re-fetched at that SHA and verified byte-identical to what was adapted)
 * Recorded in docs/vendor/PROVENANCE.md.
 *
 * CHANGES WE MADE (Apache-2.0 §4(b)):
 *  1. Translated from JavaScript to TypeScript; upstream's `_get` helper replaced
 *     with direct property access.
 *  2. Error STRINGS are kept byte-for-byte as upstream emits them, so that a
 *     conformance check run against the reference runtime and against ours
 *     reports the same text for the same malformed network.
 *  3. Added `validate_duplicate_names`, which upstream's generated module does
 *     NOT have, and included it in `validate_network`. §3.1 requires a runtime to
 *     reject "duplicate or missing agent references"; upstream's generated
 *     validator covers missing but not duplicate. This addition is ours, and its
 *     message wording is ours, not upstream's.
 *  3b. Added `validate_agent_names`, also ours and also not upstream's: upstream
 *     checks a name for presence only, and a name is interpolated into text a
 *     guest reads. See the note on that function.
 *  4. Dropped nothing.
 *
 * Function names are kept in upstream's snake_case deliberately; see graph.ts.
 */

import type { NetworkConfig } from "../types.ts";
import { classify_tool, find_front_man } from "./graph.ts";

export function validate_shape(config: NetworkConfig): string[] {
  const errors: string[] = [];
  const tools = config.tools;
  if (!tools) {
    errors.push("Network must have a 'tools' array.");
    return errors;
  }
  if (tools.length === 0) {
    errors.push("Network 'tools' array must not be empty.");
    return errors;
  }
  for (const agent of tools) {
    if (agent.name === undefined || agent.name === null) errors.push("Every agent must have a 'name'.");
  }
  return errors;
}

export function validate_missing_nodes(config: NetworkConfig): string[] {
  const errors: string[] = [];
  const tools = config.tools;
  if (!tools) return errors;
  for (const agent of tools) {
    const refs = agent.tools;
    if (!refs) continue;
    const owner = agent.name;
    for (const ref of refs) {
      if (classify_tool(config, ref) === "missing") {
        errors.push(`Agent '${String(owner)}' references missing tool '${String(ref)}'.`);
      }
    }
  }
  return errors;
}

export function validate_front_man(config: NetworkConfig): string[] {
  const errors: string[] = [];
  if (find_front_man(config) === null) errors.push("No front-man agent found.");
  return errors;
}

/**
 * OURS, not upstream's.
 *
 * An agent's name is interpolated into places a guest reads — a delegation notice
 * in the site's own voice, a validator message, a trace line. Upstream checks a
 * name only for PRESENCE, never for shape, so a network whose agent is *named*
 * with a sentence is valid upstream and produces, on our page:
 *
 *   Hollis & Rye — Asked The Reuben is dairy-free and safe for you.
 *
 * Ours are tokens, so this is latent today. Task 8 loads a peer network from a
 * second origin and a peer author chooses that string, which makes it live. The
 * network is refused rather than rendered: failing closed at startup protects
 * every place a name is interpolated at once, including places not written yet.
 *
 * This is the first of two nets. The second is that every interpolation into the
 * site's voice goes through `siteText`, which token-filters it anyway.
 */
export function validate_agent_names(config: NetworkConfig): string[] {
  const errors: string[] = [];
  for (const agent of config.tools ?? []) {
    const name = agent.name;
    if (name === undefined || name === null) continue; // validate_shape reports this
    if (name.length > 64 || !/^[A-Za-z0-9_.:-]+$/.test(name)) {
      errors.push(`Agent name is not a usable identifier: '${name}'.`);
    }
  }
  return errors;
}

/** OURS, not upstream's. §3.1 requires rejecting duplicate agent references. */
export function validate_duplicate_names(config: NetworkConfig): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const agent of config.tools ?? []) {
    const name = agent.name;
    if (name === undefined) continue;
    if (seen.has(name)) errors.push(`Duplicate agent name '${name}'.`);
    seen.add(name);
  }
  return errors;
}

export function validate_network(config: NetworkConfig): string[] {
  return [
    ...validate_shape(config),
    ...validate_front_man(config),
    ...validate_missing_nodes(config),
    ...validate_duplicate_names(config),
    ...validate_agent_names(config),
  ];
}
