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
 * Fetched: 2026-11-23. Recorded in docs/vendor/PROVENANCE.md.
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
  ];
}
