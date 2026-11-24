/**
 * ===========================================================================
 * ADAPTED FROM THIRD-PARTY CODE. MODIFIED BY THE VOUCH AUTHORS.
 * ===========================================================================
 *
 * Source:  nsdeploy/runtime/generated/graph.gen.mjs
 *          https://github.com/cognizant-ai-lab/nsdeploy/blob/main/nsdeploy/runtime/generated/graph.gen.mjs
 *          (itself generated upstream from neuro_san/kernel/graph.py)
 * Project: Cognizant AI Lab — nsDeploy
 * Licence: Apache License 2.0. Full text: docs/vendor/LICENSE-Apache-2.0.txt
 * Fetched: 2026-11-23 at commit 486ecf26aa8775963f9b765f894734bef1ac9817.
 * Permalink: https://github.com/cognizant-ai-lab/nsdeploy/blob/486ecf26aa8775963f9b765f894734bef1ac9817/nsdeploy/runtime/generated/graph.gen.mjs
 *            (re-fetched at that SHA and verified byte-identical to what was adapted)
 * Recorded in docs/vendor/PROVENANCE.md.
 *
 * CHANGES WE MADE (Apache-2.0 §4(b)):
 *  1. Translated from JavaScript to TypeScript: added parameter and return types,
 *     replaced upstream's `_get` / `_contains` helpers (which exist to emulate
 *     Python semantics in generated JS) with direct property access and
 *     `Array.prototype.includes`.
 *  2. `_spec_for` renamed `spec_for` and exported; upstream keeps it module-private
 *     with a leading underscore.
 *  3. `classify_tool`'s "remote" branch: upstream evaluates
 *     `_contains(ref, names)`, which for an array argument means
 *     `names.includes(ref)`. Written here as `!agent_names(config).includes(ref)`.
 *     Behaviour unchanged; a test pins the classification of each reference kind.
 *  4. Dropped nothing. Every exported function upstream exports is here.
 *
 * Function NAMES are kept in upstream's snake_case deliberately, so that a
 * reviewer can diff this file against the source and so that every call site in
 * our code visibly reads as a call into adapted upstream logic.
 */

import type { NetworkConfig, AgentSpec, ToolRef } from "../types.ts";

export function is_external_agent(ref: string): boolean {
  return ref.startsWith("http://") || ref.startsWith("https://") || ref.startsWith("/");
}

export function is_mcp_ref(ref: string): boolean {
  if (!ref.startsWith("http://") && !ref.startsWith("https://")) return false;
  const lowered = ref.toLowerCase();
  return lowered.includes("/mcp/") || lowered.endsWith("/mcp") || lowered.includes("//mcp.") || lowered.includes(".mcp.");
}

/**
 * The positional front-man rule: the FIRST agent in `tools[]` that has
 * instructions and is neither a coded tool nor a toolbox entry.
 *
 * This, not `metadata.front_man`, is what the reference runtime reads. Our
 * network keeps `front_of_house` first in `tools[]` so that both agree.
 */
export function find_front_man(config: NetworkConfig): string | null {
  const tools = config.tools;
  if (!tools) return null;
  for (const agent of tools) {
    if (agent.instructions && !agent.class && !agent.toolbox) return agent.name ?? null;
  }
  if (tools.length > 0) return tools[0]!.name ?? null;
  return null;
}

export function agent_names(config: NetworkConfig): string[] {
  const out: string[] = [];
  for (const agent of config.tools ?? []) {
    if (agent.name !== undefined && agent.name !== null) out.push(agent.name);
  }
  return out;
}

export type ToolKind = "mcp" | "remote" | "missing" | "coded" | "toolbox" | "agent";

export function classify_tool(config: NetworkConfig, ref: ToolRef): ToolKind {
  if (typeof ref !== "string" || is_mcp_ref(ref)) return "mcp";
  if (is_external_agent(ref) && !agent_names(config).includes(ref)) return "remote";
  const spec = spec_for(config, ref);
  if (spec === null) return "missing";
  if (spec.class) return "coded";
  if (spec.toolbox) return "toolbox";
  return "agent";
}

export function spec_for(config: NetworkConfig, name: string): AgentSpec | null {
  for (const agent of config.tools ?? []) {
    if (agent.name === name) return agent;
  }
  return null;
}
