/**
 * The model call. OURS, written here.
 *
 * Not adapted from upstream's llm.js: that client streams Server-Sent Events,
 * carries a provider-error taxonomy and a model/router policy, and is ~225 lines.
 * This one is a single non-streaming POST, which is all our loop needs, and
 * writing it ourselves is the point — the key-custody rule is the product's
 * security claim and it should be enforced in code we own and can show a judge.
 *
 * Three rules, each pinned by a test on captured payloads:
 *  1. The key is attached as an `Authorization: Bearer` header, and ONLY to the
 *     router base URL the visitor's own router selection resolved to.
 *  2. It is never put in a URL, a query string, a request body, a prompt, an
 *     action argument, or a trace entry. The trace records that a key was used,
 *     never the value — a pattern taken from upstream's `keySource` span field.
 *  3. A real router with no key stops the call with a setup error that names the
 *     host and says what to do. Upstream's wording at llm.js:61 sets the bar; we
 *     match it and add the sentence only this product can add.
 */

import { RuntimeMessage, joinSiteText, ours, siteText, type SiteReport, type SiteText } from "./errors.ts";
import type { TraceEntry } from "./types.ts";
import type { ToolSchema } from "./upstream/tool-schema.ts";
import rawScripts from "../../data/scripted-replies.json" with { type: "json" };

/** The pseudo-router that replays a recorded reply. A sibling of upstream's `browser://mock`. */
export const SCRIPTED_ROUTER = "vouch://scripted";

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
  name?: string;
}

export interface ModelToolCall {
  id: string;
  name: string;
  /** Raw JSON text as the model emitted it. Parsed, and then schema-validated, by the caller. */
  arguments: string;
}

export interface ModelReply {
  content: string;
  toolCalls: ModelToolCall[];
  /** How these words were produced. `scripted` is surfaced in the UI; it is never dressed up as live. */
  source: "live" | "scripted";
  /** Set for a scripted reply: which fixture, so the UI and the trace can name it. */
  scriptId?: string;
  scriptLabel?: string;
  model: string;
}

export interface ScriptTurn {
  content?: string;
  toolCalls?: { name: string; arguments: Record<string, unknown> }[];
}

export interface Script {
  id: string;
  label: string;
  describes: string;
  turns: ScriptTurn[];
}

interface ScriptFile {
  version: number;
  note: string;
  router: string;
  scripts: Script[];
}

const scriptFile = rawScripts as ScriptFile;

export const SCRIPTS: readonly Script[] = scriptFile.scripts;

export function scriptById(id: string): Script | undefined {
  return SCRIPTS.find((s) => s.id === id);
}

/**
 * A provider error code, if the body is JSON and the code is token-shaped
 * (`invalid_api_key`, `model_not_found`). Anything with whitespace, punctuation or
 * length is prose and is discarded rather than rendered.
 */
export async function providerErrorCode(resp: { text(): Promise<string> }): Promise<string> {
  try {
    const body: unknown = JSON.parse(await resp.text());
    const err = (body as { error?: { code?: unknown; type?: unknown } })?.error;
    for (const candidate of [err?.code, err?.type]) {
      if (typeof candidate === "string" && /^[a-z0-9_.-]{1,64}$/i.test(candidate)) return candidate;
    }
  } catch {
    /* not JSON, or no readable body: say nothing rather than guess */
  }
  return "";
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url || "?";
  }
}

/**
 * The setup error for a real router with no key — §3.4's "a missing key MUST stop
 * the model call with a clear setup error", and the fifth of the five refusals
 * this build has to make visible.
 *
 * "Clear" is doing work there. It names the host, says exactly what to do about
 * it, and says where the key stays — upstream's `llm.js` sets that bar and this
 * matches it. Then it says the thing upstream cannot: `check_safety` and the
 * verdict beside each dish need no key at all, because they are deterministic
 * and never call a model. A missing key degrades the conversation without
 * degrading the safety, and a visitor reading a setup error is exactly who needs
 * to be told that.
 */
export function missingKeyMessage(baseUrl: string): SiteReport {
  return {
    text: ours(
      "An AI provider key is required for the provider named below. Open the model settings above, paste your key, then select Save. Your key stays in this browser and is sent only to that provider. No model call was made. The safety check is not affected: check_safety and the verdict beside each dish are computed here, from the published ingredients, and work with no key at all.",
    ),
    quotedLabel: ours("The provider this key would go to, and nowhere else:"),
    quoted: [hostOf(baseUrl) || "(none configured)"],
  };
}

export interface RouterOptions {
  baseUrl: string;
  apiKey?: string;
  model: string;
  fetchImpl?: typeof fetch;
  /** Called with each record. Receives no credential: see `keySource` below. */
  onTrace?: (entry: TraceEntry) => void;
  /** Which recorded reply to replay, when the baseUrl is the scripted router. */
  scriptId?: string;
  now?: () => number;
}

export class Router {
  readonly baseUrl: string;
  readonly model: string;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly onTrace: (entry: TraceEntry) => void;
  private readonly scriptId: string;
  private readonly now: () => number;
  /** Position in the recorded script, for the replayed route only. */
  private scriptStep = 0;

  constructor(opts: RouterOptions) {
    this.baseUrl = (opts.baseUrl || "").replace(/\/$/, "");
    this.apiKey = opts.apiKey ?? "";
    this.model = opts.model;
    this.fetchImpl = opts.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
    this.onTrace = opts.onTrace ?? (() => {});
    this.scriptId = opts.scriptId ?? SCRIPTS[0]!.id;
    this.now = opts.now ?? Date.now;
  }

  get scripted(): boolean {
    return this.baseUrl === SCRIPTED_ROUTER;
  }

  /** True when this route needs a credential we do not have. */
  get needsKey(): boolean {
    return !this.scripted && (!this.apiKey || this.apiKey === "demo");
  }

  resetScript(): void {
    this.scriptStep = 0;
  }

  async chat({
    messages,
    tools,
    signal,
  }: {
    messages: ChatMessage[];
    tools?: ToolSchema[];
    signal?: AbortSignal;
  }): Promise<ModelReply> {
    if (this.scripted) return this.replay();
    if (this.needsKey) throw new RuntimeMessage(missingKeyMessage(this.baseUrl));

    const endpoint = `${this.baseUrl}/chat/completions`;
    const body: Record<string, unknown> = { model: this.model, messages, stream: false };
    if (tools && tools.length > 0) {
      body["tools"] = tools;
      body["tool_choice"] = "auto";
    }
    // `keySource` records THAT a key was used, never the value. Upstream's pattern.
    this.onTrace({
      at: this.now(),
      event: "model_call",
      detail: {
        routerHost: hostOf(this.baseUrl),
        endpoint,
        model: this.model,
        keySource: this.apiKey ? "local BYOK (not shown)" : "none",
        toolNames: (tools ?? []).map((t) => t.function.name),
        source: "live",
      },
    });

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    // The one place the key is ever attached, and it is attached to this router only.
    if (this.apiKey) headers["Authorization"] = `Bearer ${this.apiKey}`;
    if (hostOf(this.baseUrl) === "api.anthropic.com") headers["anthropic-dangerous-direct-browser-access"] = "true";

    const resp = await this.fetchImpl(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      // A provider key is a bearer credential we attach ourselves; we never want
      // the browser's ambient cookies going out alongside it.
      credentials: "omit",
      ...(signal ? { signal } : {}),
    });
    if (!resp.ok) {
      // The provider's response BODY is never put in the message. `ask` renders a
      // thrown message in the transcript in the SITE's own voice, and the visitor
      // chooses this router, so a body reading "The Reuben is dairy-free and safe
      // for you" would be unverified prose attributed to the deli. Only a
      // machine-shaped error code is extracted, and only if it is token-shaped.
      const code = await providerErrorCode(resp);
      // Two literals rather than one with a conditional fragment interpolated: a
      // fragment like " (invalid_api_key)" has whitespace in it, so `siteText`
      // would filter the whole thing away. Only bare tokens are interpolated.
      // `advice` is ours, so it is APPENDED as site text rather than interpolated
      // as a value — `siteText` filters values, and ours has whitespace in it.
      const advice = joinSiteText(
        ours(" Check the key and the router in the model settings above. The provider's own response is not shown "),
        ours("here, because this site does not repeat text it cannot vouch for."),
      );
      // The host is the visitor's router and the code is the provider's own
      // string; neither goes in a sentence of ours. Our prose names the status,
      // which is a number, and the rest is quoted.
      throw new RuntimeMessage({
        text: joinSiteText(siteText`The model router returned HTTP ${resp.status}.`, advice),
        quotedLabel: ours("The router that answered, and the error code it gave, if any:"),
        quoted: code ? [hostOf(this.baseUrl), code] : [hostOf(this.baseUrl)],
      });
    }
    const json = (await resp.json()) as {
      model?: string;
      choices?: { message?: { content?: string | null; tool_calls?: { id?: string; function?: { name?: string; arguments?: string } }[] } }[];
    };
    const message = json.choices?.[0]?.message ?? {};
    const toolCalls: ModelToolCall[] = (message.tool_calls ?? []).map((tc, i) => ({
      id: tc.id ?? `call_${i}`,
      name: tc.function?.name ?? "",
      arguments: tc.function?.arguments ?? "{}",
    }));
    return { content: message.content ?? "", toolCalls, source: "live", model: json.model ?? this.model };
  }

  /**
   * Replay the next turn of a recorded reply. The model's WORDS are fixed; nothing
   * downstream is: the gate, the checker and the verdict cards all run for real.
   */
  private replay(): ModelReply {
    const script = scriptById(this.scriptId);
    if (!script) {
      throw new RuntimeMessage({
        text: ours("No recorded reply is published under the name below."),
        quotedLabel: ours("The name that was asked for:"),
        quoted: [this.scriptId],
      });
    }
    const turn = script.turns[this.scriptStep];
    this.scriptStep += 1;
    this.onTrace({
      at: this.now(),
      event: "model_call",
      detail: {
        routerHost: SCRIPTED_ROUTER,
        model: "replayed-fixture",
        keySource: "none",
        source: "scripted",
        scriptId: script.id,
        turn: this.scriptStep,
      },
    });
    if (!turn) {
      return {
        content: "(the recorded reply ends here)",
        toolCalls: [],
        source: "scripted",
        scriptId: script.id,
        scriptLabel: script.label,
        model: "replayed-fixture",
      };
    }
    return {
      content: turn.content ?? "",
      toolCalls: (turn.toolCalls ?? []).map((tc, i) => ({
        id: `call_${script.id}_${this.scriptStep}_${i}`,
        name: tc.name,
        arguments: JSON.stringify(tc.arguments ?? {}),
      })),
      source: "scripted",
      scriptId: script.id,
      scriptLabel: script.label,
      model: "replayed-fixture",
    };
  }
}
