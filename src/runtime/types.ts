import type { SiteText } from "./errors.ts";

/**
 * Shapes of the published artifacts the runtime consumes, and of the runtime's own
 * records. Ours, written here. Key NAMES follow the upstream reference (see
 * docs/vendor/), because they are the interoperability surface; the types are not.
 */

/** A JSON-Schema-ish node, as far as the bounded action schema subset goes. */
export interface ActionSchema {
  type: "object" | "array" | "string" | "integer" | "number" | "boolean";
  properties?: Record<string, ActionSchema>;
  required?: string[];
  additionalProperties?: false;
  items?: ActionSchema;
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  format?: "date" | "email";
  title?: string;
  description?: string;
  default?: unknown;
}

/** A reference in an agent's `tools` list: an agent name, a URL, or an MCP descriptor. */
export type ToolRef = string | { url: string; tools?: string[] };

export interface AgentSpec {
  name?: string;
  function?: { description?: string; parameters?: ActionSchema };
  instructions?: string;
  tools?: ToolRef[];
  /** Upstream markers for a coded tool / toolbox entry. We publish neither. */
  class?: string;
  toolbox?: string;
  allow?: {
    to_downstream?: { sly_data?: string[] };
    to_upstream?: { sly_data?: string[] };
  };
}

export interface NetworkConfig {
  metadata?: {
    name?: string;
    description?: string;
    front_man?: string;
    model_settings_are_hints?: boolean;
    private_context?: { default?: string; note?: string };
  };
  llm_config?: { model_name?: string };
  tools?: AgentSpec[];
}

export interface ManifestNetwork {
  name: string;
  front_man: string;
  hocon: string;
  description?: string;
}

/** The `actions` block is OUR extension; §3.3 lists action metadata as optional and declares no shape. */
/**
 * One entry of the published action catalog.
 *
 * §3.3 lists `action` metadata among the manifest's OPTIONAL blocks, so this
 * catalog is published by choice. Its FIELD NAMES are §2.1's, which names what a
 * runtime must support for a same-site action: "described by name, purpose, JSON
 * Schema, effect, and handler". `effect` was called `commits` here until fix
 * round 1 — a private word for a concept the spec had already named, and the
 * reason the peer consent card could hard-code an effect of its own.
 *
 * `handler` has no published form: it is code, and what a visitor's runtime gets
 * is the registered handler in `actions.ts`. `parameters` is the JSON Schema, by
 * the name every other schema in these artifacts carries.
 */
export interface ManifestAction {
  name: string;
  purpose: string;
  /** The same vocabulary the registry and the consent plan use. */
  effect: "read" | "write" | "irreversible";
  /** JSON Schema for the arguments. An action taking none says so, rather than omitting this. */
  parameters: Record<string, unknown>;
}

export interface Manifest {
  networks?: ManifestNetwork[];
  llm_router?: {
    base_url?: string;
    byok_router?: string;
    mock?: boolean;
    [k: string]: unknown;
  };
  allowed_peers?: string[];
  peer_policy?: { mode?: string; deny_origins?: string[]; denied_origins?: string[]; [k: string]: unknown };
  actions?: ManifestAction[];
  [k: string]: unknown;
}

/** One observable-execution record. Never carries a credential; a test pins that. */
export interface TraceEntry {
  at: number;
  event: string;
  detail: Record<string, unknown>;
}

/**
 * What the runtime shows the user before it dispatches a committing action.
 *
 * `description` is `SiteText`: the dialog renders it, so it is a surface that
 * speaks in the deli's voice, and it follows the same rule as the transcript and
 * the error line. It was a plain `string` built by concatenation until fix round
 * 2 - correct at the time because every value in it was filtered, but resting on
 * the author remembering, which is the exact thing the branded type exists to
 * replace. Values a caller wants shown go in `arguments`, which the dialog
 * renders in a node of its own.
 */
/**
 * WHAT APPROVING ONE CARD ACTUALLY DOES, as a closed set.
 *
 * The dialog turns this into the card's last clause, so every member of this
 * union is a sentence a person reads before deciding. It is a union and not a
 * string for one reason: fix round 1 found the peer card hard-coding
 * `effect: "read"` for BOTH of its purposes, so a card that had just said a
 * stranger's agents would run in this browser ended with "This reads only."
 *
 * The three action effects are the registry's own vocabulary. `run_peer_code` is
 * not one of them and must not be folded into one: running a published network
 * from another origin in the visitor's browser is not a read of anything, and it
 * is not a write to the order or an order that cannot be undone either. It is a
 * fourth thing and it gets a fourth sentence.
 *
 * `boot.ts` maps this union to those sentences through a `Record` over it, so
 * adding a member here is a type error until the sentence exists. A comment
 * asking the next author to remember is what this replaces; the comment was
 * already there, four lines above the bug, and it did not hold.
 */
export type ConfirmEffect = "read" | "write" | "irreversible" | "run_peer_code";

export interface ConfirmItem {
  action: string;
  description: SiteText;
  origin: string;
  effect: ConfirmEffect;
  /**
   * The card offers "do not ask again for this site, this visit", UNTICKED.
   *
   * Only peer contact sets it. §3.2's default is approval before each contact
   * and permits relaxing that "only from an explicit user choice", so the
   * control exists to BE that choice; the flag is what draws it. A committing
   * site action never carries it — "remember that I approved a write" is not a
   * thing this runtime offers.
   */
  rememberable?: true;
  arguments: Record<string, unknown>;
}

/**
 * The outcome of one dispatched action.
 *
 * For anything that commits, there are THREE outcomes, not two: `unknown` is the
 * honest report when the write began and the result never came back (spec L206-210,
 * "Timeouts and disconnects after a write begins MUST be reported as having an
 * unknown outcome"). It is the same refusal to collapse "we do not know" into a
 * certainty that the safety checker makes for an `unknown` verdict, and the runtime
 * MUST NOT repeat such a write to find out.
 *
 * `failed` is for an action that commits nothing (`effect: "read"`), where a thrown
 * error means the read did not happen and nothing is in doubt. Keeping the two
 * apart is why a failed `check_safety` does not read as "your order may have gone
 * through".
 */
export interface Receipt {
  action: string;
  requestId: string;
  status: "succeeded" | "unknown" | "failed" | "not_started";
  result?: unknown;
  error?: string;
}
