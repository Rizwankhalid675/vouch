/**
 * ===========================================================================
 * ADAPTED FROM THIRD-PARTY CODE. MODIFIED BY THE VOUCH AUTHORS.
 * ===========================================================================
 *
 * Source:  nsdeploy/runtime/actions.js
 *          https://github.com/cognizant-ai-lab/nsdeploy/blob/main/nsdeploy/runtime/actions.js
 * Project: Cognizant AI Lab — nsDeploy
 * Licence: Apache License 2.0. Full text: docs/vendor/LICENSE-Apache-2.0.txt
 * Fetched: 2026-11-23 at commit 486ecf26aa8775963f9b765f894734bef1ac9817.
 * Permalink: https://github.com/cognizant-ai-lab/nsdeploy/blob/486ecf26aa8775963f9b765f894734bef1ac9817/nsdeploy/runtime/actions.js
 *            (re-fetched at that SHA and verified byte-identical to what was adapted)
 * Recorded in docs/vendor/PROVENANCE.md.
 *
 * CHANGES WE MADE (Apache-2.0 §4(b)):
 *  1. Translated from JavaScript to TypeScript; added types throughout.
 *  2. TAKEN SUBSTANTIALLY UNCHANGED: `plain`, `cloneData`, the `keywords` schema
 *     allow-list, `checkSchema`, `validateData`, and the `register` / `catalog` /
 *     `execute` methods of `ActionRegistry` including its receipt semantics
 *     (status `succeeded` / `unknown` / `not_started`, abort-on-timeout, and the
 *     rule that a write whose outcome is unknown is NEVER retried).
 *  3. DROPPED, because we publish no CRUSE generative interface: `actionBindings`,
 *     `proposalRefs`, `actionContext`, `ActionRegistry.validatePresentation` and
 *     `ActionRegistry.prepare` (which exist to validate model-proposed UI
 *     components and map form fields onto action arguments). Our model proposes
 *     an action by name through ordinary function calling, and `dispatch` below
 *     replaces `prepare`.
 *  4. ADDED `dispatch(name, rawArgs, confirm, invocationId)`: resolves a short
 *     action name to its canonical ref, validates the arguments against the
 *     registered input schema, and hands a one-entry plan to upstream's
 *     `execute`. Ours.
 *  5. CHANGED when the user is asked to confirm. Upstream's `execute` calls
 *     `confirm` for every plan, because in upstream every action arrives as a
 *     CRUSE component the user has already clicked. Here, confirmation is
 *     required when and only when `effect !== "read"`; a read action dispatches
 *     without a prompt, and a non-read action with no confirmation mechanism
 *     available FAILS CLOSED instead of dispatching. This is what §2.1 and §3.1
 *     require of the runtime ("obtains any required user confirmation", "MUST
 *     validate arguments and show the user the destination and arguments before
 *     a write or irreversible operation").
 *  6. ADDED the `commits` field on a registration, so that the boolean our
 *     manifest publishes for each action can be cross-checked against the effect
 *     the runtime actually enforces. Upstream has no `commits`; the `actions`
 *     block in our manifest is our own extension.
 *  7. ADDED `confirmRequired` and `entryFor` as public reads, for the same
 *     cross-check. Ours.
 *  8. CHANGED the receipt status for a failed READ action from upstream's blanket
 *     `unknown` to `failed`. Upstream records `unknown` for every error during
 *     execute, which is conservative but imprecise: a read commits nothing, so an
 *     error there leaves nothing in doubt. `unknown` is reserved for an action that
 *     commits, which is the state spec L206-210 requires. The never-retry rule is
 *     upstream's and is unchanged.
 *  9. ADDED a `requestId` to `not_started` receipts, which upstream omits, because
 *     our `Receipt` type requires one.
 * 10. ADDED `NoEffectError`: a handler that fails before changing anything records
 *     `failed`, not `unknown`, whatever its effect. Upstream has no equivalent.
 */

import type { ActionSchema, ConfirmItem, Receipt } from "../types.ts";

export type Effect = "read" | "write" | "irreversible";

/**
 * OURS, not upstream's. Thrown by a handler that failed BEFORE it changed
 * anything, so the outcome is a plain failure and nothing is in doubt.
 *
 * Without it, every error from a non-read action records `unknown`, which is
 * conservative but blunts the distinction: `add_to_cart` refusing because the page
 * has no Add control would raise the same "your order may have gone through"
 * warning as a checkout that genuinely timed out mid-write. `unknown` has to mean
 * one thing to be worth anything.
 */
export class NoEffectError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NoEffectError";
  }
}
export type Availability = "local-only" | "bridge" | "top-level";

export const plain = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);

const badKeys = new Set(["__proto__", "prototype", "constructor"]);

export function cloneData<T>(value: T): T {
  const text = JSON.stringify(value);
  if (!text || text.length > 65536) throw new Error("Action data exceeds 64 KB.");
  return JSON.parse(text, (key: string, v: unknown) => {
    if (badKeys.has(key)) throw new Error("Unsafe object key.");
    return v;
  }) as T;
}

// A deliberately bounded JSON Schema subset; unsupported validation keywords fail
// at registration instead of being silently ignored. UI annotations are harmless.
const keywords = new Set([
  "type", "properties", "required", "additionalProperties", "items", "enum",
  "minimum", "maximum", "minLength", "maxLength", "minItems", "maxItems",
  "format", "title", "description", "default",
]);

export function checkSchema(schema: unknown, depth = 0): asserts schema is ActionSchema {
  if (!plain(schema) || depth > 8) throw new Error("Invalid action schema.");
  for (const key of Object.keys(schema)) {
    if (!keywords.has(key) && !key.startsWith("x-")) throw new Error(`Unsupported action schema keyword: ${key}`);
  }
  if (!["object", "array", "string", "integer", "number", "boolean"].includes(schema["type"] as string)) {
    throw new Error("Action schema requires a supported type.");
  }
  if (schema["enum"] && (!Array.isArray(schema["enum"]) || schema["enum"].length === 0)) throw new Error("Invalid enum.");
  if (schema["format"] && !["date", "email"].includes(schema["format"] as string)) {
    throw new Error("Supported formats: date, email.");
  }
  for (const key of ["minimum", "maximum", "minLength", "maxLength", "minItems", "maxItems"]) {
    if (schema[key] !== undefined && !Number.isFinite(schema[key])) throw new Error(`Invalid ${key}.`);
  }
  if (schema["type"] === "object") {
    const properties = schema["properties"];
    if (!plain(properties)) throw new Error("Object schema requires properties.");
    if (schema["additionalProperties"] !== undefined && schema["additionalProperties"] !== false) {
      throw new Error("Action objects must reject extra fields.");
    }
    const required = schema["required"];
    if (required && (!Array.isArray(required) || required.some((k) => !Object.hasOwn(properties, k as string)))) {
      throw new Error("Invalid required fields.");
    }
    Object.values(properties).forEach((s) => checkSchema(s, depth + 1));
  }
  if (schema["type"] === "array") checkSchema(schema["items"], depth + 1);
}

export function validateData(schema: ActionSchema, value: unknown, path = "arguments"): void {
  const fail = (): never => {
    throw new Error(`Invalid ${path}.`);
  };
  if (schema.type === "object") {
    if (!plain(value)) fail();
    const obj = value as Record<string, unknown>;
    const properties = schema.properties ?? {};
    for (const key of schema.required ?? []) {
      if (!Object.hasOwn(obj, key)) throw new Error(`Missing ${path}.${key}.`);
    }
    for (const [key, v] of Object.entries(obj)) {
      if (badKeys.has(key) || !Object.hasOwn(properties, key)) throw new Error(`Unexpected ${path}.${key}.`);
      validateData(properties[key]!, v, `${path}.${key}`);
    }
  } else if (schema.type === "array") {
    if (!Array.isArray(value) || value.length < (schema.minItems ?? 0) || value.length > (schema.maxItems ?? 1000)) fail();
    (value as unknown[]).forEach((v, i) => validateData(schema.items!, v, `${path}[${i}]`));
  } else if (schema.type === "integer" || schema.type === "number") {
    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      (schema.type === "integer" && !Number.isInteger(value)) ||
      value < (schema.minimum ?? -Infinity) ||
      value > (schema.maximum ?? Infinity)
    ) {
      fail();
    }
  } else if (schema.type === "string") {
    if (typeof value !== "string" || value.length < (schema.minLength ?? 0) || value.length > (schema.maxLength ?? 65536)) fail();
    if (schema.format === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value as string)) fail();
    if (
      schema.format === "date" &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(value as string) ||
        !Number.isFinite(Date.parse(value as string)) ||
        new Date(value as string).toISOString().slice(0, 10) !== value)
    ) {
      fail();
    }
  } else if (typeof value !== "boolean") {
    fail();
  }
  if (schema.enum && !schema.enum.some((v) => JSON.stringify(v) === JSON.stringify(value))) fail();
}

export interface ActionScope {
  base: string;
  network: string;
}

export interface ActionDefinition {
  name: string;
  description: string;
  inputSchema: ActionSchema;
  outputSchema?: ActionSchema;
  effect?: Effect;
  availability?: Availability;
  callerOrigins?: string[];
  timeoutMs?: number;
  /** OURS: mirrors the `commits` boolean the manifest publishes for this action. */
  commits?: boolean;
}

export type ActionHandler = (
  args: Record<string, unknown>,
  ctx: { requestId: string; signal: AbortSignal },
) => unknown | Promise<unknown>;

export interface ActionEntry extends ActionScope {
  ref: string;
  name: string;
  description: string;
  inputSchema: ActionSchema;
  outputSchema?: ActionSchema;
  effect: Effect;
  availability: Availability;
  callerOrigins: string[];
  timeoutMs: number;
  commits: boolean;
  execute: ActionHandler;
}

export type ConfirmFn = (plan: ConfirmItem[]) => boolean | Promise<boolean>;

export class ActionRegistry {
  readonly entries = new Map<string, ActionEntry>();

  register(scope: ActionScope, definition: ActionDefinition, execute: ActionHandler): string {
    const {
      name,
      description,
      inputSchema,
      outputSchema,
      effect = "write",
      availability = "local-only",
      callerOrigins = [],
      timeoutMs = 180000,
      commits,
    } = cloneData(definition);
    if (!/^[A-Za-z][\w-]{0,79}$/.test(name || "") || !description || typeof execute !== "function") {
      throw new Error("Action requires name, description and execute function.");
    }
    if (!["read", "write", "irreversible"].includes(effect) || !["local-only", "bridge", "top-level"].includes(availability)) {
      throw new Error("Invalid action policy.");
    }
    if (!Array.isArray(callerOrigins) || callerOrigins.some((o) => o !== "*" && new URL(o).origin !== o)) {
      throw new Error("callerOrigins must contain exact origins.");
    }
    if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 300000) {
      throw new Error("timeoutMs must be 100–300000.");
    }
    checkSchema(inputSchema);
    if (inputSchema.type !== "object") throw new Error("Action input must be an object.");
    if (outputSchema) checkSchema(outputSchema);
    const ref = `${scope.base.replace(/\/$/, "")}/${encodeURIComponent(scope.network)}#${name}`;
    if (this.entries.has(ref)) throw new Error(`Duplicate action: ${name}`);
    // OURS: `commits` defaults from the effect, so the two can never silently disagree.
    const entry: ActionEntry = {
      ref, name, description, inputSchema, effect, availability, callerOrigins, timeoutMs,
      commits: commits ?? effect !== "read",
      ...(outputSchema ? { outputSchema } : {}),
      ...scope,
      execute,
    };
    this.entries.set(ref, entry);
    return ref;
  }

  catalog(scope: ActionScope): Omit<ActionEntry, "execute" | "base" | "network" | "callerOrigins" | "timeoutMs">[] {
    return [...this.entries.values()]
      .filter((e) => e.base === scope.base && e.network === scope.network)
      .map(({ ref, name, description, inputSchema, outputSchema, effect, availability, commits }) =>
        cloneData({ ref, name, description, inputSchema, outputSchema, effect, availability, commits }),
      );
  }

  /** OURS. Resolve a short action name within one scope. */
  entryFor(scope: ActionScope, name: string): ActionEntry | undefined {
    return [...this.entries.values()].find((e) => e.base === scope.base && e.network === scope.network && e.name === name);
  }

  /** OURS. A read never asks; anything that commits always does. */
  confirmRequired(entry: ActionEntry): boolean {
    return entry.effect !== "read";
  }

  /**
   * OURS. Validate arguments, obtain confirmation if the action commits anything,
   * then hand a one-entry plan to `execute` below.
   *
   * `receipts` is `null` when the user declined. Throws when validation fails or
   * when a committing action has no confirmation mechanism: fail closed, never
   * dispatch. `arguments` is returned so that the caller can record the VALIDATED
   * arguments — never the raw model JSON — in its trace.
   */
  async dispatch(
    scope: ActionScope,
    name: string,
    rawArgs: unknown,
    confirm: ConfirmFn | null,
    invocationId: string,
  ): Promise<{ receipts: Receipt[] | null; arguments: Record<string, unknown> }> {
    const entry = this.entryFor(scope, name);
    if (!entry) throw new Error(`No registered site action named '${name}'.`);
    const args = cloneData(plain(rawArgs) ? rawArgs : {});
    validateData(entry.inputSchema, args);
    if (this.confirmRequired(entry) && typeof confirm !== "function") {
      throw new Error(`'${name}' commits something and this runtime has no way to ask you first; refusing to run it.`);
    }
    const gate: ConfirmFn = this.confirmRequired(entry) ? confirm! : () => true;
    return { receipts: await this.execute([{ entry, args }], gate, invocationId), arguments: args };
  }

  async execute(
    plan: { entry: ActionEntry; args: Record<string, unknown> }[],
    confirm: ConfirmFn,
    invocationId: string,
  ): Promise<Receipt[] | null> {
    // Confirm the immutable complete payload before any action begins.
    const approved = await confirm(
      plan.map(({ entry, args }) => ({
        action: entry.name,
        description: entry.description,
        origin: new URL(entry.base).origin,
        effect: entry.effect,
        arguments: cloneData(args),
      })),
    );
    if (!approved) return null;
    const receipts: Receipt[] = [];
    for (let i = 0; i < plan.length; i++) {
      const { entry, args } = plan[i]!;
      const requestId = `${invocationId}:${i}`;
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const result = cloneData(
          await Promise.race([
            Promise.resolve().then(() => entry.execute(cloneData(args), { requestId, signal: controller.signal })),
            new Promise((_resolve, reject) => {
              timer = setTimeout(() => {
                controller.abort();
                reject(new Error("Action timed out; outcome unknown. Check the site before retrying."));
              }, entry.timeoutMs);
            }),
          ]),
        );
        if (entry.outputSchema) validateData(entry.outputSchema, result, "result");
        receipts.push({ action: entry.ref, requestId, status: "succeeded", result });
      } catch (error) {
        // The site may have committed before the call failed. NEVER retry: this loop
        // dispatches each plan entry exactly once and breaks here.
        // OUR CHANGE: upstream records `unknown` for every error. A read commits
        // nothing, so an error there is a plain failure and nothing is in doubt;
        // only an action that commits can leave an unknown outcome behind.
        receipts.push({
          action: entry.ref,
          requestId,
          status: entry.effect === "read" || error instanceof NoEffectError ? "failed" : "unknown",
          error: String((error as Error)?.message ?? error),
        });
        for (const { entry: rest } of plan.slice(i + 1)) {
          receipts.push({ action: rest.ref, requestId: `${invocationId}:skipped`, status: "not_started" });
        }
        break;
      } finally {
        clearTimeout(timer);
      }
    }
    return receipts;
  }
}
