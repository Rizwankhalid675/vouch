/**
 * ===========================================================================
 * ADAPTED FROM THIRD-PARTY CODE. MODIFIED BY THE VOUCH AUTHORS.
 * ===========================================================================
 *
 * Source:  nsdeploy/runtime/runner.js, lines 119-131 only (`schemaFor`).
 *          https://github.com/cognizant-ai-lab/nsdeploy/blob/main/nsdeploy/runtime/runner.js
 * Project: Cognizant AI Lab — nsDeploy
 * Licence: Apache License 2.0. Full text: docs/vendor/LICENSE-Apache-2.0.txt
 * Fetched: 2026-11-23. Recorded in docs/vendor/PROVENANCE.md.
 *
 * CHANGES WE MADE (Apache-2.0 §4(b)):
 *  1. Translated from JavaScript to TypeScript.
 *  2. Took `schemaFor` only. Nothing else from runner.js (the agent loop, the
 *     token/price estimator, CRUSE handling, the sandbox and MCP paths) is here;
 *     our loop is in src/runtime/loop.ts and is ours.
 *  3. Behaviour unchanged, including the fallback `{request: string}` parameter
 *     shape for an agent that publishes no `function.parameters`. Every agent in
 *     our network publishes its own, so the fallback never fires for us; it is
 *     kept so that a peer network that omits them is translated the way upstream
 *     translates it.
 *
 * This is how an agent in the published graph becomes a function the model can
 * see. It is the one piece of "translate callable capabilities into model-visible
 * function schemas" (§3) that we take rather than write.
 */

import type { ActionSchema } from "../types.ts";

export interface ToolSchema {
  type: "function";
  function: { name: string; description: string; parameters: ActionSchema };
}

export function schemaFor(name: string, fn?: { description?: string; parameters?: ActionSchema }): ToolSchema {
  return {
    type: "function",
    function: {
      name,
      description: fn?.description ?? name,
      parameters:
        fn?.parameters ?? {
          type: "object",
          properties: { request: { type: "string", description: "The request to handle." } },
          required: ["request"],
        },
    },
  };
}
