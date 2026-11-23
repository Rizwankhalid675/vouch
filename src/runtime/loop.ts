/**
 * The agent loop. OURS, written here.
 *
 * Not adapted: upstream's runner.js is 25 KB of loop plus CRUSE presentation,
 * the coded-tool sandbox, MCP, turn control and streaming. We publish none of
 * those, and the one place our loop differs from a conventional one — every word
 * the model produces leaves through `Transcript.showModelText`, and nowhere else
 * — is the thing worth being able to read in full.
 *
 * What it does:
 *  - resolves the front agent through the adapted upstream rule (graph.ts);
 *  - turns each agent in the published graph into a model-visible function
 *    (upstream's `schemaFor`), and each registered site action into another;
 *  - dispatches an action through the registry, which validates its arguments and
 *    obtains the guest's confirmation when the action commits something;
 *  - bounds execution: model calls, delegations, depth and a true-cycle check
 *    (§3.1; a repeated invocation of the same agent is NOT a cycle, an agent
 *    appearing in its own ancestry is);
 *  - fails closed. An unresolvable or unauthorised call is reported to the
 *    network and never represented as having succeeded.
 */

import type { Finding } from "../../contracts.ts";
import type { Refusal } from "../gate/gate.ts";
import { RuntimeMessage } from "./errors.ts";
import type { ChatMessage, ModelReply, Router } from "./llm.ts";
import type { Transcript } from "./transcript.ts";
import type { NetworkConfig, Receipt, TraceEntry } from "./types.ts";
import { classify_tool, find_front_man, spec_for } from "./upstream/graph.ts";
import { allowed_downstream_sly, filter_sly_data, type SlyData } from "./upstream/sly-data.ts";
import { schemaFor, type ToolSchema } from "./upstream/tool-schema.ts";
import type { ActionRegistry, ActionScope, ConfirmFn } from "./upstream/action-registry.ts";

export interface Limits {
  /**
   * Model calls within ONE TURN, across every agent. Per turn, not per session:
   * the runaway this exists to stop is a turn that will not finish, and a
   * session-lifetime budget instead bricks the assistant after N questions with
   * no way back, which is worse than no limit for anyone actually using the site.
   */
  maxModelCalls: number;
  /** Agent-to-agent delegations within one turn. */
  maxAgentCalls: number;
  /** How deep delegation may nest. */
  maxDepth: number;
  /** Tool-call rounds within a single turn. */
  maxRounds: number;
  /**
   * Model calls for the whole conversation. A backstop against a page left open
   * all day, set far above any honest session, and recoverable: reaching it tells
   * the guest to start a new conversation, and the panel has a control that does.
   */
  maxSessionModelCalls: number;
}

export const DEFAULT_LIMITS: Limits = {
  maxModelCalls: 16,
  maxAgentCalls: 12,
  maxDepth: 3,
  maxRounds: 6,
  maxSessionModelCalls: 300,
};

/** Thrown when an execution limit is reached. Carries the limit, so the UI can show it. */
export class BudgetError extends RuntimeMessage {
  constructor(
    readonly budget: keyof Limits,
    readonly limit: number,
  ) {
    super(
      `Execution limit reached: ${budget} is ${limit}. Nothing further was run, and nothing was left half-done.` +
        (budget === "maxSessionModelCalls"
          ? " Start a new conversation to carry on; the verdict beside each dish is unaffected either way."
          : " Ask again, more simply, and this turn starts from a fresh budget."),
    );
    this.name = "BudgetError";
  }
}

/** Thrown when an agent appears in its own delegation ancestry. */
export class CycleError extends RuntimeMessage {
  constructor(readonly path: string[]) {
    super(`Composition cycle refused: ${path.join(" → ")}. The call was not made.`);
    this.name = "CycleError";
  }
}

export interface ConversationDeps {
  config: NetworkConfig;
  router: Router;
  registry: ActionRegistry;
  scope: ActionScope;
  transcript: Transcript;
  /** The checker's findings for the current restriction set, read fresh each turn. */
  findings: () => Finding[];
  /** How the guest is asked before a committing action. `null` means they cannot be asked. */
  confirm: ConfirmFn | null;
  trace: (entry: TraceEntry) => void;
  limits?: Partial<Limits>;
  /** Private context for this conversation. Ours is empty, and the allow lists are all `[]`. */
  slyData?: SlyData;
  now?: () => number;
  newId?: () => string;
  /** Told about every dispatched action and its receipts, including an unknown outcome. */
  onReceipts?: (actionName: string, receipts: Receipt[] | null) => void;
}

export interface TurnResult {
  text: string;
  refusals: Refusal[];
  /** Receipts from every action dispatched during this turn, in order. */
  receipts: Receipt[];
}

let idCounter = 0;

export class Conversation {
  readonly frontMan: string;
  private readonly limits: Limits;
  private readonly history: ChatMessage[] = [];
  /** Reset at the start of every turn: these bound a turn, not a lifetime. */
  private modelCalls = 0;
  private agentCalls = 0;
  /** Never reset. The session backstop. */
  private sessionModelCalls = 0;
  /** An action whose outcome we could not confirm. Set once; never cleared by us. */
  private unresolvedWrite: Receipt | null = null;

  constructor(private readonly deps: ConversationDeps) {
    const front = find_front_man(deps.config);
    if (!front) throw new Error("This network declares no front agent, so there is nothing to talk to.");
    this.frontMan = front;
    this.limits = { ...DEFAULT_LIMITS, ...deps.limits };
  }

  /** The write we started and could not confirm, if there is one. Shown, never retried. */
  get outstanding(): Receipt | null {
    return this.unresolvedWrite;
  }

  /** Model calls used so far, against the budget. For the observability panel. */
  usage(): { modelCalls: number; agentCalls: number; sessionModelCalls: number; limits: Limits } {
    return {
      modelCalls: this.modelCalls,
      agentCalls: this.agentCalls,
      sessionModelCalls: this.sessionModelCalls,
      limits: this.limits,
    };
  }

  private id(): string {
    if (this.deps.newId) return this.deps.newId();
    idCounter += 1;
    return `turn-${idCounter}`;
  }

  private now(): number {
    return (this.deps.now ?? Date.now)();
  }

  private spend(budget: "maxModelCalls" | "maxAgentCalls"): void {
    if (budget === "maxModelCalls") {
      if (this.sessionModelCalls >= this.limits.maxSessionModelCalls) {
        throw new BudgetError("maxSessionModelCalls", this.limits.maxSessionModelCalls);
      }
      if (this.modelCalls >= this.limits.maxModelCalls) throw new BudgetError("maxModelCalls", this.limits.maxModelCalls);
      this.modelCalls += 1;
      this.sessionModelCalls += 1;
    } else {
      if (this.agentCalls >= this.limits.maxAgentCalls) throw new BudgetError("maxAgentCalls", this.limits.maxAgentCalls);
      this.agentCalls += 1;
    }
  }

  /** The functions the front agent may call: its own sub-agents, then the site action catalog. */
  toolSchemas(agentName: string): ToolSchema[] {
    const spec = spec_for(this.deps.config, agentName);
    const out: ToolSchema[] = [];
    for (const ref of spec?.tools ?? []) {
      if (typeof ref !== "string") continue;
      if (classify_tool(this.deps.config, ref) !== "agent") continue;
      const child = spec_for(this.deps.config, ref);
      out.push(schemaFor(ref, child?.function));
    }
    if (agentName === this.frontMan) {
      for (const entry of this.deps.registry.catalog(this.deps.scope)) {
        out.push(schemaFor(entry.name, { description: entry.description, parameters: entry.inputSchema }));
      }
    }
    return out;
  }

  /**
   * The system prompt. Built from the published instructions plus the runtime's
   * own rules about the action catalog. Carries no credential — a test asserts
   * the sentinel key value is absent from every prompt string sent to the model.
   */
  systemPrompt(agentName: string): string {
    const spec = spec_for(this.deps.config, agentName);
    const parts = [spec?.instructions ?? ""];
    if (agentName === this.frontMan) {
      const names = this.deps.registry.catalog(this.deps.scope).map((e) => e.name);
      parts.push(
        [
          "The site registers these actions with the runtime, and you may propose a call to one by its exact name: " +
            names.join(", ") +
            ".",
          "An action that changes the order is dispatched only after the guest confirms it; your proposal is not the deed, and a receipt is the only evidence that anything happened.",
          "check_safety returns the site's own verdict. Report it exactly as given, or point the guest at the verdict shown beside the dish. Do not restate it in your own words, do not round it up, and never draw a conclusion of your own from an ingredient list.",
          "The verdict for every dish is displayed beside the dish itself. That display is what the guest reads.",
        ].join(" "),
      );
    }
    return parts.filter(Boolean).join("\n\n");
  }

  /** One turn. Returns the gated text that reached the screen. */
  async send(userText: string): Promise<TurnResult> {
    const invocationId = this.id();
    // A fresh budget for this turn. See `Limits.maxModelCalls`.
    this.modelCalls = 0;
    this.agentCalls = 0;
    this.deps.transcript.showUser(userText);
    this.history.push({ role: "user", content: userText });
    const receipts: Receipt[] = [];
    const messages: ChatMessage[] = [{ role: "system", content: this.systemPrompt(this.frontMan) }, ...this.history];
    const tools = this.toolSchemas(this.frontMan);

    for (let round = 0; round < this.limits.maxRounds; round += 1) {
      this.spend("maxModelCalls");
      const reply = await this.deps.router.chat({ messages, tools });
      if (reply.toolCalls.length === 0) {
        const result = this.deps.transcript.showModelText(reply.content, this.deps.findings(), {
          source: reply.source,
          ...(reply.scriptLabel ? { scriptLabel: reply.scriptLabel } : {}),
        });
        this.history.push({ role: "assistant", content: reply.content });
        return { text: result.shown, refusals: result.refusals, receipts };
      }
      messages.push(this.assistantTurn(reply));
      for (const call of reply.toolCalls) {
        const outcome = await this.runToolCall(call.name, call.arguments, invocationId, [this.frontMan], receipts);
        messages.push({ role: "tool", tool_call_id: call.id, name: call.name, content: outcome });
      }
    }
    throw new BudgetError("maxRounds", this.limits.maxRounds);
  }

  private assistantTurn(reply: ModelReply): ChatMessage {
    return {
      role: "assistant",
      content: reply.content,
      tool_calls: reply.toolCalls.map((t) => ({
        id: t.id,
        type: "function" as const,
        function: { name: t.name, arguments: t.arguments },
      })),
    };
  }

  /**
   * Run one model-proposed call: a sub-agent, or a registered site action.
   * Returns the text handed back to the proposing agent. Every failure is
   * reported there as a failure, never as a result.
   */
  private async runToolCall(
    name: string,
    rawArguments: string,
    invocationId: string,
    stack: string[],
    receipts: Receipt[],
  ): Promise<string> {
    let args: unknown;
    try {
      args = JSON.parse(rawArguments || "{}");
    } catch {
      return "REFUSED: those arguments were not valid JSON, so nothing was run.";
    }

    const action = this.deps.registry.entryFor(this.deps.scope, name);
    if (action) {
      this.deps.trace({
        at: this.now(),
        event: "action_proposed",
        detail: {
          action: name,
          effect: action.effect,
          commits: action.commits,
          origin: new URL(action.base).origin,
          // The KEYS of the raw model JSON are model-chosen strings, and the trace
          // is rendered on the page, so an argument named
          // "The Reuben is dairy-free" would put that sentence in the DOM. Record
          // only keys the schema itself declares, plus a count of the rest. The
          // validated VALUES are recorded below, once the schema has constrained
          // them to published ids.
          ...declaredKeys(args, action.inputSchema),
        },
      });
      try {
        const { receipts: got, arguments: validated } = await this.deps.registry.dispatch(
          this.deps.scope,
          name,
          args,
          this.deps.confirm,
          invocationId,
        );
        this.deps.trace({ at: this.now(), event: "action_arguments", detail: { action: name, arguments: validated } });
        if (got === null) {
          this.deps.transcript.showRuntime(`You declined "${name}". Nothing was done.`, "declined");
          this.deps.onReceipts?.(name, null);
          return `DECLINED: the guest did not approve ${name}. It did not run.`;
        }
        receipts.push(...got);
        this.deps.onReceipts?.(name, got);
        for (const r of got) {
          this.deps.trace({ at: this.now(), event: "action_receipt", detail: { action: name, status: r.status, requestId: r.requestId } });
          if (r.status === "unknown") this.unresolvedWrite = r;
        }
        return describeReceipts(name, got);
      } catch (err) {
        const message = String((err as Error)?.message ?? err);
        // `message` goes to the MODEL, which is fine, and must not go to the trace,
        // which is rendered: the validator interpolates the offending argument name
        // into "Unexpected arguments.<raw key>.", so the message can carry
        // model-chosen prose. The trace gets a classification instead.
        this.deps.trace({ at: this.now(), event: "action_refused", detail: { action: name, kind: refusalKind(message) } });
        return `FAILED: ${name} did not run. ${message}`;
      }
    }

    const kind = classify_tool(this.deps.config, name);
    if (kind !== "agent") {
      return `FAILED: '${name}' is not an agent in this network and not a registered site action. Nothing was run.`;
    }
    if (stack.includes(name)) {
      const err = new CycleError([...stack, name]);
      this.deps.trace({ at: this.now(), event: "cycle_refused", detail: { path: err.path } });
      return `REFUSED: ${err.message}`;
    }
    if (stack.length >= this.limits.maxDepth) {
      return `REFUSED: delegation is already ${stack.length} deep and the limit is ${this.limits.maxDepth}. '${name}' was not called.`;
    }
    return this.runAgent(name, args, invocationId, stack, receipts);
  }

  /**
   * Run a sub-agent. Its prose goes back to its caller as a tool result; it is
   * NOT rendered. Only the front agent's final answer reaches the screen, and it
   * reaches it through the gate.
   */
  private async runAgent(
    name: string,
    args: unknown,
    invocationId: string,
    stack: string[],
    receipts: Receipt[],
  ): Promise<string> {
    this.spend("maxAgentCalls");
    const parentSpec = spec_for(this.deps.config, stack[stack.length - 1]!);
    // Private context is deny-by-default, and our network names no allowed field,
    // so this is `{}` every time. It is filtered anyway, through the adapted
    // upstream filter, so that a future allow list is honoured the way upstream
    // honours it. This does NOT isolate context between sibling agents; see sly-data.ts.
    const passed = filter_sly_data(this.deps.slyData, allowed_downstream_sly(parentSpec));
    this.deps.trace({
      at: this.now(),
      event: "agent_delegated",
      detail: { agent: name, from: stack[stack.length - 1]!, slyDataKeys: Object.keys(passed), depth: stack.length },
    });
    this.deps.transcript.showRuntime(`Asked ${name.replace(/_/g, " ")}.`, "delegated");

    const messages: ChatMessage[] = [
      { role: "system", content: this.systemPrompt(name) },
      { role: "user", content: typeof args === "string" ? args : JSON.stringify(args) },
    ];
    const tools = this.toolSchemas(name);
    const nextStack = [...stack, name];

    for (let round = 0; round < this.limits.maxRounds; round += 1) {
      this.spend("maxModelCalls");
      const reply = await this.deps.router.chat({ messages, ...(tools.length > 0 ? { tools } : {}) });
      if (reply.toolCalls.length === 0) return reply.content;
      messages.push(this.assistantTurn(reply));
      for (const call of reply.toolCalls) {
        const outcome = await this.runToolCall(call.name, call.arguments, invocationId, nextStack, receipts);
        messages.push({ role: "tool", tool_call_id: call.id, name: call.name, content: outcome });
      }
    }
    throw new BudgetError("maxRounds", this.limits.maxRounds);
  }
}

/**
 * What the proposing agent is told about an outcome. An unknown outcome is
 * reported as unknown — the model is not allowed to hear "it worked" about a
 * write we could not confirm, any more than a guest is.
 */
export function describeReceipts(name: string, receipts: Receipt[]): string {
  return receipts
    .map((r) => {
      if (r.status === "succeeded") return `RECEIPT ${name} succeeded (${r.requestId}): ${JSON.stringify(r.result)}`;
      if (r.status === "unknown") {
        return `UNKNOWN OUTCOME: ${name} was started (${r.requestId}) and its result never came back. Do NOT say it succeeded, do NOT say it failed, and do NOT ask for it again. ${r.error ?? ""}`.trim();
      }
      if (r.status === "failed") return `FAILED: ${name} did not run. ${r.error ?? ""}`.trim();
      return `NOT STARTED: ${name} was not attempted.`;
    })
    .join("\n");
}

/**
 * The argument keys a trace may safely show: those the action's own schema
 * declares, which are our strings, not the model's. Anything else is counted.
 */
function declaredKeys(args: unknown, schema: { properties?: Record<string, unknown> }): { argumentKeys: string[]; undeclaredKeyCount: number } {
  if (typeof args !== "object" || args === null) return { argumentKeys: [], undeclaredKeyCount: 0 };
  const declared = Object.keys(schema.properties ?? {});
  const keys = Object.keys(args as Record<string, unknown>);
  return {
    argumentKeys: keys.filter((k) => declared.includes(k)),
    undeclaredKeyCount: keys.filter((k) => !declared.includes(k)).length,
  };
}

/** One of a fixed set of words. Never the validator's interpolated message. */
export function refusalKind(message: string): string {
  if (/^No registered site action/.test(message)) return "not_registered";
  if (/no way to ask you first/.test(message)) return "no_confirmation";
  if (/^(Invalid|Missing|Unexpected|Unsafe object key|Action data exceeds)/.test(message)) return "invalid_arguments";
  return "handler_error";
}
