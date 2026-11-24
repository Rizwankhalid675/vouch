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
 *  3c. Added `validate_declared_front_man`, ours, not upstream's. Upstream resolves
 *     the front man positionally and never reads `metadata.front_man`, so a
 *     network whose declared front man names no agent is valid upstream and runs
 *     a different agent than its own metadata advertises. See the note on it.
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
 * Ours are tokens, so this was latent while no peer existed. It is LIVE since
 * Task 8: this site loads a peer network from a second origin and a peer author
 * chooses that string. The network is refused rather than rendered — failing
 * closed here protects every place a name is interpolated at once, including
 * places not written yet — and `tests/peer.test.ts` drives it through the real
 * walk with such a name served from the peer's own URL.
 *
 * This is the first of two nets. The second is that a name reaching the page
 * goes into a node of its own, marked as not the site's words. (It used to be
 * "the site's voice token-filters it anyway"; that filter was deleted rather
 * than fixed — `LIMITS.md` §2.2b — because a value supplying the filter's own
 * delimiter defeated it.)
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

/**
 * OURS, not upstream's.
 *
 * `find_front_man` is positional and never reads `metadata.front_man`. So a
 * publisher who renames an agent and forgets the metadata ships a network that
 * validates, runs, and advertises an entry point that does not exist — the most
 * ordinary failure a real publisher actually ships, and one that is silent
 * everywhere: the manifest, the metadata and the running agent can all disagree
 * and nothing says so.
 *
 * Reported as a named field with its bad value, because "invalid network" is not
 * a structured validation error. This validator runs over a peer's document, so
 * the value is a stranger's string. The quotes around it are cosmetic and protect
 * nothing — a value supplying its own quote defeated exactly that assumption once.
 * What keeps it out of our voice is the renderer, which puts it in its own node.
 *
 * Checked only when the field is present. It is optional, and a network that
 * declares nothing is not making a claim that can be wrong.
 */
export function validate_declared_front_man(config: NetworkConfig): string[] {
  const declared = config.metadata?.front_man;
  if (declared === undefined || declared === null || declared === "") return [];
  for (const agent of config.tools ?? []) {
    if (agent.name === declared) return [];
  }
  return [`metadata.front_man names '${declared}', which is not an agent in this network.`];
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
    ...validate_declared_front_man(config),
  ];
}
