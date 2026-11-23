// @vitest-environment jsdom
//
// The runtime. What each block pins, and what would break it, is written above
// the block, because a test nobody can falsify is worse than no test.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { Finding, Restriction } from "../contracts.ts";
import { MENU, RESTRICTIONS } from "../src/safety/canon.ts";
import { verdictFor } from "../src/safety/verdict.ts";
import { gate, REFUSAL_MARKER } from "../src/gate/gate.ts";
import { mountShop } from "../src/site/shop.ts";
import { boot, loadPublishedLinks, reconcileActions, type BootOptions, type Runtime } from "../src/runtime/boot.ts";
import { actionDefinitions, checkSafety, registerSiteActions, type SiteContext } from "../src/runtime/actions.ts";
import { KeyStore, KEY_ITEM, type StorageLike } from "../src/runtime/key-store.ts";
import { SCRIPTED_ROUTER, SCRIPTS, scriptById } from "../src/runtime/llm.ts";
import { describeReceipts } from "../src/runtime/loop.ts";
import { cardKind, cardReason, renderVerdicts } from "../src/runtime/verdict-cards.ts";
import { claimedLabel, refusalLine } from "../src/runtime/transcript.ts";
import type { ConfirmItem, Manifest, NetworkConfig, TraceEntry } from "../src/runtime/types.ts";
import { ActionRegistry } from "../src/runtime/upstream/action-registry.ts";
import { classify_tool, find_front_man } from "../src/runtime/upstream/graph.ts";
import { validate_network } from "../src/runtime/upstream/validation.ts";
import { filter_sly_data } from "../src/runtime/upstream/sly-data.ts";
import { selectTopRouter, manifestAllowsPeer } from "../src/runtime/upstream/router.ts";

/* ================================================================== */
/* Harness                                                             */
/* ================================================================== */

const root = resolve(import.meta.dirname, "..");
const html = readFileSync(resolve(root, "src/site/index.html"), "utf8");
const readPublic = (f: string): unknown => JSON.parse(readFileSync(resolve(root, "public", f), "utf8"));
const MANIFEST = readPublic("agent-manifest.json") as Manifest;
const NETWORK = readPublic("vouch.network.json") as NetworkConfig;
const LINKS = readPublic("links.json");

const BASE = "https://deli.example";
const ROUTER = "https://api.openai.com/v1";
const ROUTER_URL = `${ROUTER}/chat/completions`;

/** Obviously fake. Never a real key, in a test, a fixture or a log line. */
const SENTINEL = "sk-FAKE-SENTINEL-vouch-task6-DO-NOT-USE";

interface Captured {
  url: string;
  init: RequestInit;
  request: Request;
  bodyText: string;
}

type ModelJson = Record<string, unknown>;

/** An OpenAI-shaped reply with plain text. */
const say = (content: string): ModelJson => ({ model: "test-model", choices: [{ message: { content } }] });

/** An OpenAI-shaped reply proposing one call. */
const callTool = (name: string, args: unknown = {}, id = `call_${name}`): ModelJson => ({
  model: "test-model",
  choices: [{ message: { content: "", tool_calls: [{ id, type: "function", function: { name, arguments: JSON.stringify(args) } }] } }],
});

const ok = (body: unknown): Response =>
  ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) }) as unknown as Response;
const missing = (): Response =>
  ({ ok: false, status: 404, json: async () => ({}), text: async () => "not found" }) as unknown as Response;

interface Harness {
  captured: Captured[];
  fetchImpl: typeof fetch;
  routerBodies: () => { messages: { role: string; content: string; name?: string }[]; tools?: { function: { name: string } }[] }[];
}

/**
 * A fetch that serves the REAL published artifacts from public/, plus a queue of
 * model replies, and records every request as a platform `Request` so assertions
 * are made on the normalised request rather than on the options we passed.
 */
function harness(opts: { replies?: ModelJson[]; artifacts?: Record<string, unknown>; peers?: Record<string, unknown>; artifactError?: boolean } = {}): Harness {
  const captured: Captured[] = [];
  const replies = [...(opts.replies ?? [])];
  const artifacts: Record<string, unknown> = {
    [`${BASE}/agent-manifest.json`]: MANIFEST,
    [`${BASE}/vouch.network.json`]: NETWORK,
    [`${BASE}/links.json`]: LINKS,
    ...opts.artifacts,
  };
  const fetchImpl = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    const bodyText = typeof init.body === "string" ? init.body : "";
    captured.push({ url, init, request: new Request(url, init), bodyText });
    if (opts.artifactError && url.startsWith(BASE)) throw new TypeError("Failed to fetch");
    if (url === ROUTER_URL) {
      const next = replies.shift();
      if (!next) throw new Error("the test ran out of scripted model replies");
      return ok(next);
    }
    if (Object.hasOwn(artifacts, url)) return ok(artifacts[url]);
    if (opts.peers && Object.hasOwn(opts.peers, url)) return ok(opts.peers[url]);
    return missing();
  }) as unknown as typeof fetch;
  return {
    captured,
    fetchImpl,
    routerBodies: () => captured.filter((c) => c.url === ROUTER_URL).map((c) => JSON.parse(c.bodyText)),
  };
}

class MemStorage implements StorageLike {
  readonly map = new Map<string, string>();
  getItem(k: string): string | null {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.map.set(k, v);
  }
  removeItem(k: string): void {
    this.map.delete(k);
  }
}

interface Session {
  runtime: Runtime;
  mount: HTMLElement;
  plans: ConfirmItem[][];
  storage: MemStorage;
  h: Harness;
  answer: { value: boolean };
  panelText: () => string;
  transcriptText: () => string;
  $: (sel: string) => HTMLElement | null;
  $$: (sel: string) => HTMLElement[];
  tick: (id: string) => void;
  setReplay: (scriptId: string) => void;
}

async function session(opts: Partial<BootOptions> & { h?: Harness; key?: string } = {}): Promise<Session> {
  const h = opts.h ?? harness();
  const storage = new MemStorage();
  if (opts.key) storage.setItem(KEY_ITEM, JSON.stringify({ key: opts.key }));
  const plans: ConfirmItem[][] = [];
  const answer = { value: true };
  const mount = document.createElement("div");
  document.body.append(mount);
  const { h: _ignored, key: _ignored2, ...rest } = opts;
  const runtime = await boot(mount, {
    base: BASE,
    fetchImpl: h.fetchImpl,
    storage,
    confirm: (plan) => {
      plans.push(plan);
      return answer.value;
    },
    ...rest,
  });
  const $ = (sel: string): HTMLElement | null => mount.querySelector<HTMLElement>(sel);
  const $$ = (sel: string): HTMLElement[] => [...mount.querySelectorAll<HTMLElement>(sel)];
  return {
    runtime,
    mount,
    plans,
    storage,
    h,
    answer,
    panelText: () => mount.textContent ?? "",
    transcriptText: () => $("[data-transcript]")?.textContent ?? "",
    $,
    $$,
    tick: (id: string) => {
      const box = mount.querySelector<HTMLInputElement>(`[data-restriction="${id}"]`)!;
      box.checked = true;
      box.dispatchEvent(new Event("change"));
    },
    setReplay: (scriptId: string) => {
      const select = mount.querySelector<HTMLSelectElement>("[data-script]")!;
      select.value = scriptId;
      const box = mount.querySelector<HTMLInputElement>("[data-replay]")!;
      box.checked = true;
      box.dispatchEvent(new Event("change"));
    },
  };
}

const slot = (id: string): HTMLElement => document.querySelector<HTMLElement>(`[data-verdict-slot="${id}"]`)!;
const card = (id: string): HTMLElement | null => document.querySelector<HTMLElement>(`[data-verdict-item="${id}"]`);
const DAIRY = RESTRICTIONS.find((r) => r.id === "dairy_free")!;

beforeEach(() => {
  document.documentElement.innerHTML = html;
  mountShop(document);
});

/* ================================================================== */
/* A. Verdict cards render independently of gated prose                */
/* ================================================================== */

describe("the verdict is displayed beside the dish, not through the chat", () => {
  /**
   * The requirement that outranks the rest of this task. Breaks if the renderer
   * is ever made to depend on a model reply, a router, a key or a successful
   * network load: here EVERY artifact fetch throws, so there is no manifest, no
   * network, no router and no assistant at all.
   */
  test("every card renders with no manifest, no network, no router, no key and no model", async () => {
    const s = await session({ h: harness({ artifactError: true }) });
    expect(s.runtime.router).toBeNull();
    expect(s.runtime.conversation).toBeNull();
    expect(s.$("[data-runtime-error]")!.hasAttribute("hidden")).toBe(false);

    s.tick("dairy_free");
    expect(s.$$("[data-verdict-slot] [data-verdict]")).toHaveLength(0); // slots are in the page, not the panel
    expect(document.querySelectorAll("[data-verdict-slot] [data-verdict]")).toHaveLength(MENU.items.length);
    expect(card("turkey_club")!.getAttribute("data-verdict")).toBe("unsafe");
    // And the page says so plainly, because a visitor should know why the chat is dead.
    expect(s.$("[data-runtime-error]")!.textContent).toContain("never call a model");
  });

  test("a card goes in its own item's slot, and in no other", async () => {
    const s = await session();
    s.tick("dairy_free");
    for (const item of MENU.items) {
      const inSlot = slot(item.id).querySelector("[data-verdict-item]");
      expect(inSlot?.getAttribute("data-verdict-item"), item.id).toBe(item.id);
    }
  });

  test("an unsafe card names the verdict and the ingredient that decided it", async () => {
    const s = await session();
    s.tick("dairy_free");
    const c = card("turkey_club")!;
    expect(c.getAttribute("data-verdict")).toBe("unsafe");
    expect(c.textContent).toContain("Unsafe");
    // Dairy in the turkey club is derived only: brioche -> butter -> dairy.
    expect(c.textContent!.toLowerCase()).toContain("dairy");
    expect(c.textContent!.toLowerCase()).toContain("butter");
    expect(c.textContent).toContain("→"); // the derivation path, not just a word
  });

  test("an unknown card says we do not know, and does not read as either a hazard or an all-clear", async () => {
    const s = await session();
    s.tick("dairy_free");
    const c = card("daily_special")!;
    expect(c.getAttribute("data-verdict")).toBe("unknown");
    expect(c.textContent).toContain("We don't know");
    expect(c.textContent).not.toContain("Unsafe");
    expect(c.textContent).not.toContain("No conflict");
    expect(c.textContent!.toLowerCase()).toContain("no ingredient list");
  });

  /**
   * A `safe` Finding with `covered: []` asserts nothing. Breaks the moment that
   * case is rendered with the reassuring wording: `cardKind` would return "safe"
   * and the headline would read "No conflict found".
   */
  test("a safe finding that checked nothing is rendered as not checked, never as reassurance", () => {
    const nothing: Finding = { item: "reuben", verdict: "safe", covered: [] };
    expect(cardKind(nothing)).toBe("unchecked");
    const text = cardReason(nothing, MENU);
    expect(text).toContain("Nothing was checked");
    expect(text).toContain("not an all-clear");
    expect(renderVerdicts(document, [nothing], MENU, RESTRICTIONS)).toBe(1);
    expect(card("reuben")!.getAttribute("data-verdict")).toBe("unchecked");
    expect(card("reuben")!.textContent).not.toContain("No conflict found");
  });

  test("with nothing selected, no card is shown at all and the page says why", async () => {
    const s = await session();
    expect(document.querySelectorAll("[data-verdict-slot] [data-verdict]")).toHaveLength(0);
    expect(s.$("[data-verdict-status]")!.textContent).toContain("Nothing is being checked yet");
    expect(s.$("[data-verdict-status]")!.textContent).toContain("no key");
  });

  test("a card survives the site being mounted again (node identity, not markup)", async () => {
    const s = await session();
    s.tick("dairy_free");
    const before = card("reuben")!;
    mountShop(document);
    expect(card("reuben")).toBe(before);
  });
});

/* ================================================================== */
/* A2. The shot the whole project exists for                           */
/* ================================================================== */

describe("a model giving a false all-clear, beside the card that contradicts it", () => {
  /**
   * The replayed fixture goes through the REAL gate, the REAL checker and the
   * REAL card renderer; only the model's words are fixed. Breaks if the gate is
   * bypassed (the claim appears in the transcript) or if cards are made to
   * depend on chat (no unsafe card beside the dish).
   */
  test("the claim is withheld and the dish's own card reads unsafe", async () => {
    const s = await session();
    s.tick("dairy_free");
    s.setReplay("false_all_clear");
    expect(s.runtime.router!.baseUrl).toBe(SCRIPTED_ROUTER);
    await s.runtime.ask("I'm lactose intolerant, what can I eat?");

    const t = s.transcriptText();
    expect(t).toContain(REFUSAL_MARKER);
    expect(t).not.toContain("dairy-free, so that one is fine");
    expect(t).not.toContain("The Reuben is spotless as well.");
    expect(s.panelText()).not.toContain("The Turkey club is dairy-free, so that one is fine for you.");

    expect(card("turkey_club")!.getAttribute("data-verdict")).toBe("unsafe");
    expect(card("reuben")!.getAttribute("data-verdict")).toBe("unsafe");
    expect(s.$("[data-refusal-panel]")!.hasAttribute("hidden")).toBe(false);
    expect(s.$$("[data-refusal-reason]").length).toBeGreaterThan(0);
  });

  /** It is labelled. A replayed reply dressed up as a live one would be the exact dishonesty this project is about. */
  test("a replayed reply says on the page that it was replayed", async () => {
    const s = await session();
    s.tick("dairy_free");
    s.setReplay("false_all_clear");
    await s.runtime.ask("anything");
    const tag = s.$("[data-replayed]")!;
    expect(tag).not.toBeNull();
    expect(tag.textContent).toContain("not a live model call");
    expect(s.runtime.trace().some((e) => e.detail["source"] === "scripted")).toBe(true);
  });

  /**
   * The honest cost of the design, demonstrated rather than hidden: the gate
   * withholds a TRUE warning too, and the guest still learns the truth — from
   * the card, which is the whole reason the card exists.
   */
  test("a true warning is withheld as well, and the card still carries the truth", async () => {
    const s = await session();
    s.tick("dairy_free");
    s.setReplay("true_warning_also_withheld");
    await s.runtime.ask("is the turkey club ok for me?");
    expect(s.transcriptText()).toContain(REFUSAL_MARKER);
    expect(s.transcriptText()).not.toContain("it is not dairy-free");
    expect(card("turkey_club")!.getAttribute("data-verdict")).toBe("unsafe");
    expect(card("turkey_club")!.textContent!.toLowerCase()).toContain("butter");
  });

  test("a well-behaved reply is not withheld, and the cards are there regardless", async () => {
    const s = await session();
    s.tick("dairy_free");
    s.setReplay("describes_without_vouching");
    await s.runtime.ask("tell me about the turkey club");
    expect(s.transcriptText()).not.toContain(REFUSAL_MARKER);
    expect(s.transcriptText()).toContain("Brioche bun");
    expect(s.runtime.trace().some((e) => e.detail["source"] === "scripted")).toBe(true);
    expect(card("turkey_club")!.getAttribute("data-verdict")).toBe("unsafe");
  });

  /**
   * Two false positives of the gate, pinned as FACTS rather than as approval, so
   * that a later change to the gate shows up here instead of passing unnoticed.
   * Both are why the verdict is rendered beside the dish rather than through the
   * prose: the prose channel is lossy in both directions.
   */
  test("the gate also withholds a safety disclaimer, and any non-derivable follow-up", async () => {
    const s = await session();
    s.tick("dairy_free");
    const disclaimer = gate("I do not decide whether a dish is safe for you.", s.runtime.findings(), MENU);
    expect(disclaimer.refusals.map((r) => r.reason)).toEqual(["item_unresolved"]);
    const pointer = gate("The verdict shown beside each dish is the one to read.", s.runtime.findings(), MENU);
    expect(pointer.refusals).toEqual([]); // on its own, it passes...
    const after = gate("The Turkey club is $11.00. The verdict shown beside each dish is the one to read.", s.runtime.findings(), MENU);
    expect(after.refusals.map((r) => r.reason)).toEqual(["not_derivable"]); // ...but not after the menu is mentioned
  });

  test("every recorded reply is a well-formed fixture that names what it demonstrates", () => {
    expect(SCRIPTS.length).toBeGreaterThanOrEqual(3);
    for (const s of SCRIPTS) {
      expect(scriptById(s.id)).toBe(s);
      expect(s.label.length).toBeGreaterThan(8);
      expect(s.describes.length).toBeGreaterThan(40);
      expect(s.turns.length).toBeGreaterThan(0);
    }
  });
});

/* ================================================================== */
/* B. The gate is the only path from model prose to the screen         */
/* ================================================================== */

describe("model prose reaches the screen only through the gate", () => {
  /**
   * Character-for-character. Breaks if anything renders the raw reply, a
   * partially gated reply, or a reply gated against a different finding set.
   */
  test("the rendered text is exactly gate(raw, findings).shown", async () => {
    const raw = "The Reuben is dairy-free and safe for you. It is $11.50.";
    const s = await session({ key: SENTINEL, h: harness({ replies: [say(raw)] }) });
    s.tick("dairy_free");
    await s.runtime.ask("what about the reuben?");
    const expected = gate(raw, s.runtime.findings(), MENU).shown;
    const rendered = s.$$("[data-turn='agent'] .turn-text").map((e) => e.textContent).join("");
    expect(rendered).toBe(expected);
    expect(rendered).not.toBe(raw);
  });

  test("no unbacked claim, in any of these replies, reaches the panel", async () => {
    const claims = [
      "The Reuben is completely dairy-free.",
      "You can safely eat the turkey club.",
      "The walnut brownie contains no nuts at all.",
      "Everything on the menu is fine for a coeliac.",
      "The daily special is free from dairy.",
    ];
    for (const raw of claims) {
      document.documentElement.innerHTML = html;
      mountShop(document);
      const s = await session({ key: SENTINEL, h: harness({ replies: [say(raw)] }) });
      s.tick("dairy_free");
      await s.runtime.ask("tell me");
      expect(s.transcriptText(), raw).not.toContain(raw);
      expect(s.transcriptText(), raw).toContain(REFUSAL_MARKER);
    }
  });

  /** A sub-agent's prose is a tool result for its caller, not something to render. */
  test("a sub-agent's words are never rendered; only the front agent's gated answer is", async () => {
    const h = harness({
      replies: [
        callTool("menu_guide", { question: "what is on the reuben?" }),
        say("MENU_GUIDE_INTERNAL_PROSE: the reuben is perfectly safe."),
        say("I can describe dishes, but the verdict beside each one is the site's."),
      ],
    });
    const s = await session({ key: SENTINEL, h });
    await s.runtime.ask("what is on the reuben?");
    expect(s.panelText()).not.toContain("MENU_GUIDE_INTERNAL_PROSE");
    expect(s.transcriptText()).toContain("Asked menu guide");
    expect(s.transcriptText()).toContain("the verdict beside each one is the site's");
  });

  /** The refusal names the claimed phrase and the reason, and does NOT reprint the sentence. */
  test("the refusal panel names what was claimed without republishing the sentence", async () => {
    const raw = "Good news, the Reuben is entirely dairy-free for you.";
    const s = await session({ key: SENTINEL, h: harness({ replies: [say(raw)] }) });
    s.tick("dairy_free");
    await s.runtime.ask("reuben?");
    const panel = s.$("[data-refusal-panel]")!;
    expect(panel.textContent).toContain("Withheld a claim");
    // Named the way a guest reads it, not by its internal id.
    expect(panel.textContent).toContain("about the Reuben");
    expect(panel.textContent).not.toContain("reuben)");
    expect(panel.textContent).not.toContain(raw);
  });

  /** `Refusal.claimed` is sometimes a meaningless token. Breaks if it is printed raw. */
  test("a meaningless claimed token is not printed raw", () => {
    expect(claimedLabel("dairy-free")).toBe("dairy-free");
    expect(claimedLabel("0")).toBe("a phrase in that sentence");
    expect(claimedLabel("i")).toBe("a phrase in that sentence");
    expect(claimedLabel("  ")).toBe("a phrase in that sentence");
    const withheld = "The Reuben is utterly dairy-free.";
    const line = refusalLine({ claimed: "0", items: ["reuben"], sentence: withheld, reason: "no_finding", why: "No checker finding backs this claim." });
    expect(line).not.toContain('"0"');
    expect(line).toContain("Reuben");
    // The withheld sentence is carried on the Refusal for a UI to use, and we
    // deliberately do not use it: reprinting the claim two inches below the place
    // it was withheld from would undo the withholding.
    expect(line).not.toContain(withheld);
  });
});

/* ================================================================== */
/* C. check_safety: registered, schema-validated, the only authority   */
/* ================================================================== */

function bareRegistry(): { registry: ActionRegistry; scope: { base: string; network: string }; ctx: SiteContext; painted: Finding[][] } {
  const painted: Finding[][] = [];
  const selected: Restriction[] = [DAIRY];
  const ctx: SiteContext = {
    doc: document,
    menu: MENU,
    restrictions: RESTRICTIONS,
    selected: () => selected,
    onFindings: (f) => painted.push(f),
  };
  const registry = new ActionRegistry();
  const scope = { base: BASE, network: "vouch" };
  registerSiteActions(registry, scope, ctx);
  return { registry, scope, ctx, painted };
}

describe("check_safety is a registered site action, and the only source of a verdict", () => {
  test("the registry holds exactly the four actions the manifest declares, in order", () => {
    const { registry, scope } = bareRegistry();
    expect(registry.catalog(scope).map((e) => e.name)).toEqual((MANIFEST.actions ?? []).map((a) => a.name));
    expect(registry.catalog(scope).map((e) => e.name)).toEqual(["get_menu_state", "check_safety", "add_to_cart", "checkout_demo_order"]);
  });

  test("the verdict it returns is byte-identical to calling the pure checker directly", () => {
    const { ctx } = bareRegistry();
    const got = checkSafety({ restrictions: ["dairy_free"] }, ctx);
    expect(got.checked).toEqual(["dairy_free"]);
    expect(got.findings).toEqual(MENU.items.map((i) => verdictFor(i, [DAIRY], MENU)));
  });

  /** Arguments are schema-validated and the action does not run on bad input. */
  test.each([
    ["an unknown field", { nope: 1 }],
    ["a restriction id this site does not publish", { restrictions: ["kosher"] }],
    ["an item id that is not on the menu", { items: ["foie_gras"] }],
    ["a string where an array belongs", { restrictions: "dairy_free" }],
    ["a number where an id belongs", { items: [7] }],
    ["a prototype-polluting key", { ["__proto__"]: { x: 1 }, items: ["reuben"] }],
  ])("check_safety refuses %s", async (_label, args) => {
    const { registry, scope, painted } = bareRegistry();
    await expect(registry.dispatch(scope, "check_safety", args, null, "t")).rejects.toThrow();
    expect(painted).toHaveLength(0);
  });

  test("check_safety runs on valid arguments, and its answer reaches the cards as well as the caller", async () => {
    const { registry, scope, painted } = bareRegistry();
    const got = await registry.dispatch(scope, "check_safety", { items: ["turkey_club"], restrictions: ["dairy_free"] }, null, "t");
    expect(got.receipts![0]!.status).toBe("succeeded");
    expect(painted).toHaveLength(1);
    expect(painted[0]![0]!.verdict).toBe("unsafe");
    // The side effect is the product: asking produced the display.
    renderVerdicts(document, painted[0]!, MENU, RESTRICTIONS);
    expect(card("turkey_club")!.getAttribute("data-verdict")).toBe("unsafe");
  });

  test("an unregistered action name is refused rather than guessed at", async () => {
    const { registry, scope } = bareRegistry();
    await expect(registry.dispatch(scope, "vouch_for_it", {}, null, "t")).rejects.toThrow(/No registered site action/);
  });

  /**
   * The action catalog is offered to the front agent only. Breaks if a sub-agent
   * is ever handed the catalog: `check_safety` would appear among its tools.
   */
  test("only the front agent is offered the action catalog", async () => {
    const h = harness({ replies: [callTool("menu_guide", { question: "x" }), say("ok"), say("done")] });
    const s = await session({ key: SENTINEL, h });
    await s.runtime.ask("x");
    const bodies = h.routerBodies();
    const frontTools = (bodies[0]!.tools ?? []).map((t) => t.function.name);
    const childTools = (bodies[1]!.tools ?? []).map((t) => t.function.name);
    expect(frontTools).toContain("check_safety");
    expect(frontTools).toContain("menu_guide");
    expect(childTools).not.toContain("check_safety");
    expect(childTools).toEqual([]);
  });

  test("get_menu_state hands over published data and no verdict", () => {
    const { ctx } = bareRegistry();
    const state = JSON.stringify(actionDefinitions(ctx));
    expect(state).toContain("get_menu_state");
    const def = actionDefinitions(ctx).find((d) => d.name === "get_menu_state")!;
    expect(def.effect).toBe("read");
    expect(def.commits).toBe(false);
  });

  /**
   * Every id-shaped argument is pinned to a published id. Breaks if an `enum` is
   * dropped: free text would then be echoed into the confirmation dialog, which
   * is a second route for model prose to reach the screen.
   */
  test("id arguments are pinned to published ids, so model prose cannot ride in as an argument", async () => {
    const { registry, scope } = bareRegistry();
    const defs = actionDefinitions({});
    expect(defs.find((d) => d.name === "add_to_cart")!.inputSchema.properties!["item"]!.enum).toEqual(MENU.items.map((i) => i.id));
    await expect(
      registry.dispatch(scope, "add_to_cart", { item: "the Reuben is dairy-free" }, async () => true, "t"),
    ).rejects.toThrow();
  });
});

/* ================================================================== */
/* D. Confirmation before anything that commits                        */
/* ================================================================== */

describe("the runtime, not the model, owns confirmation", () => {
  /**
   * Driven from the published manifest, in both directions. Breaks if an action
   * declared `commits: true` is ever dispatched without asking, or if a
   * `commits: false` one starts asking.
   */
  test.each((MANIFEST.actions ?? []).map((a) => [a.name, a.commits] as const))(
    "%s: commits=%s decides whether the guest is asked",
    async (name, commits) => {
      const { registry, scope } = bareRegistry();
      const asked: ConfirmItem[][] = [];
      const declined = await registry.dispatch(scope, name, name === "add_to_cart" ? { item: "reuben" } : {}, async (p) => {
        asked.push(p);
        return false;
      }, "t");
      if (commits) {
        expect(asked).toHaveLength(1);
        expect(declined.receipts).toBeNull(); // declined means nothing ran
      } else {
        expect(asked).toHaveLength(0);
        expect(declined.receipts![0]!.status).toBe("succeeded");
      }
    },
  );

  test("declining add_to_cart leaves the order untouched", async () => {
    const { registry, scope } = bareRegistry();
    const got = await registry.dispatch(scope, "add_to_cart", { item: "reuben", quantity: 2 }, async () => false, "t");
    expect(got.receipts).toBeNull();
    expect(document.querySelectorAll("[data-cart-line]")).toHaveLength(0);
  });

  test("approving add_to_cart changes the order and the result is read back out of the page", async () => {
    const { registry, scope } = bareRegistry();
    const got = await registry.dispatch(scope, "add_to_cart", { item: "reuben", quantity: 2 }, async () => true, "t");
    expect(got.receipts![0]!.status).toBe("succeeded");
    expect(got.receipts![0]!.result).toEqual({ item: "reuben", quantity: 2, cartQuantity: 2 });
    expect(document.querySelector("[data-cart-line='reuben'] [data-qty]")!.textContent).toBe("2");
  });

  test("the confirmation shows the action, its origin, its effect and its exact arguments", async () => {
    const { registry, scope } = bareRegistry();
    let seen: ConfirmItem[] = [];
    await registry.dispatch(scope, "add_to_cart", { item: "lemonade" }, async (p) => {
      seen = p;
      return false;
    }, "t");
    expect(seen).toEqual([
      { action: "add_to_cart", description: expect.stringContaining("order"), origin: BASE, effect: "write", arguments: { item: "lemonade" } },
    ]);
  });

  /** Fail closed: no way to ask means no dispatch, not a silent dispatch. */
  test("a committing action with no confirmation mechanism is refused, not run", async () => {
    const { registry, scope } = bareRegistry();
    await expect(registry.dispatch(scope, "checkout_demo_order", {}, null, "t")).rejects.toThrow(/no way to ask you first/);
    expect(document.querySelector("[data-confirmation]")!.hasAttribute("hidden")).toBe(true);
  });

  /** The manifest/runtime cross-check, and proof that it can fail. */
  test("a lying commits flag, a missing action and an undeclared action are all caught", () => {
    const { registry, scope } = bareRegistry();
    expect(reconcileActions(registry, scope, MANIFEST.actions ?? [])).toEqual([]);
    const lying = (MANIFEST.actions ?? []).map((a) => (a.name === "checkout_demo_order" ? { ...a, commits: false } : a));
    expect(reconcileActions(registry, scope, lying)).toEqual([expect.stringContaining("checkout_demo_order")]);
    const missingOne = (MANIFEST.actions ?? []).filter((a) => a.name !== "check_safety");
    expect(reconcileActions(registry, scope, missingOne)).toEqual([expect.stringContaining("not declared in agent-manifest.json")]);
    const phantom = [...(MANIFEST.actions ?? []), { name: "vouch_for_it", purpose: "x", commits: false }];
    expect(reconcileActions(registry, scope, phantom)).toEqual([expect.stringContaining("is not registered by this runtime")]);
  });

  /**
   * The third link in the chain: published flag === recorded flag === whether the
   * guest is actually asked. Breaks if an action can be recorded as committing
   * while its effect lets it dispatch unasked.
   */
  test("an action recorded as committing whose effect would skip the question is caught", () => {
    const registry = new ActionRegistry();
    const scope = { base: BASE, network: "vouch" };
    registry.register(
      scope,
      { name: "sneaky", description: "Reads, it says.", effect: "read", commits: true, inputSchema: { type: "object", properties: {}, additionalProperties: false } },
      () => ({}),
    );
    expect(registry.confirmRequired(registry.entryFor(scope, "sneaky")!)).toBe(false);
    expect(reconcileActions(registry, scope, [{ name: "sneaky", purpose: "x", commits: true }])).toEqual([
      expect.stringContaining("is not asked before it runs"),
    ]);
  });

  test("the assistant refuses to start at all when the published catalog disagrees with the runtime", async () => {
    const bent = structuredClone(MANIFEST);
    bent.actions = [...(bent.actions ?? []), { name: "pick_for_me", purpose: "Choose a safe dish for the guest.", commits: false }];
    const s = await session({ h: harness({ artifacts: { [`${BASE}/agent-manifest.json`]: bent } }) });
    expect(s.runtime.conversation).toBeNull();
    expect(s.$("[data-runtime-error]")!.textContent).toContain("pick_for_me");
    // ...and the cards are untouched by that refusal.
    s.tick("dairy_free");
    expect(card("turkey_club")!.getAttribute("data-verdict")).toBe("unsafe");
  });

  test("the panel's own dialog dispatches nothing until a button is pressed", async () => {
    const h = harness({ replies: [callTool("add_to_cart", { item: "reuben" }), say("Added.")] });
    const storage = new MemStorage();
    storage.setItem(KEY_ITEM, JSON.stringify({ key: SENTINEL }));
    const mount = document.createElement("div");
    document.body.append(mount);
    const runtime = await boot(mount, { base: BASE, fetchImpl: h.fetchImpl, storage }); // no injected confirm: the DOM dialog
    const pending = runtime.ask("add a reuben");
    await vi.waitFor(() => expect(mount.querySelector("[data-confirm-yes]")).not.toBeNull());
    expect(mount.querySelector("[data-confirm-action='add_to_cart']")!.textContent).toContain("deli.example");
    expect(document.querySelectorAll("[data-cart-line]")).toHaveLength(0); // nothing yet
    mount.querySelector<HTMLElement>("[data-confirm-yes]")!.click();
    await pending;
    expect(document.querySelector("[data-cart-line='reuben']")).not.toBeNull();
  });
});

/* ================================================================== */
/* E. A write whose outcome never came back                            */
/* ================================================================== */

describe("an unknown outcome is reported as unknown, and never retried", () => {
  /**
   * The project's own thesis applied to writes. Breaks if a timed-out write is
   * reported as a success or a failure, or if the runtime retries it: the call
   * counter would read 2.
   */
  test("a checkout that times out is unknown, not succeeded and not failed, and is dispatched once", async () => {
    let calls = 0;
    const h = harness({ replies: [callTool("checkout_demo_order", {}), say("I have passed that on.")] });
    const s = await session({
      key: SENTINEL,
      h,
      checkoutTimeoutMs: 120,
      placeOrder: () => {
        calls += 1;
        return new Promise(() => {}); // the write began; the result never arrives
      },
    });
    await s.runtime.ask("place my order");

    expect(calls).toBe(1);
    const outstanding = s.runtime.outstanding()!;
    expect(outstanding.status).toBe("unknown");
    expect(outstanding.status).not.toBe("succeeded");
    expect(outstanding.status).not.toBe("failed");

    // Visible, in the same words an unknown verdict uses.
    const banner = s.$("[data-outcome-unknown]")!;
    expect(banner).not.toBeNull();
    expect(banner.getAttribute("data-verdict")).toBe("unknown");
    expect(banner.textContent).toContain("We don't know");
    expect(banner.textContent).toContain("has NOT been tried again");

    // And the model is told the truth, not a reassurance.
    const second = h.routerBodies()[1]!;
    const toolMessage = second.messages.find((m) => m.role === "tool")!.content;
    expect(toolMessage).toContain("UNKNOWN OUTCOME");
    expect(toolMessage).not.toMatch(/RECEIPT/);
    expect(toolMessage).not.toMatch(/checkout_demo_order succeeded/);
    expect(calls).toBe(1);
  });

  test("the model is told plainly which of the three outcomes it got", () => {
    expect(describeReceipts("checkout_demo_order", [{ action: "a", requestId: "1", status: "succeeded", result: { summary: "ok" } }])).toContain("succeeded");
    const unknown = describeReceipts("checkout_demo_order", [{ action: "a", requestId: "1", status: "unknown", error: "timed out" }]);
    expect(unknown).toContain("UNKNOWN OUTCOME");
    expect(unknown).toContain("do NOT ask for it again");
    // It must not REPORT success. "do NOT say it succeeded" is the prohibition,
    // so the thing to exclude is the affirmative receipt form.
    expect(unknown).not.toMatch(/RECEIPT/);
    expect(unknown).not.toMatch(/checkout_demo_order succeeded/);
    expect(describeReceipts("check_safety", [{ action: "a", requestId: "1", status: "failed", error: "no" }])).toContain("FAILED");
  });

  /** A read that fails is a failure. Collapsing it into "unknown" would cry wolf. */
  test("a failed read is reported as failed, not as an unknown outcome", async () => {
    const { registry, scope } = bareRegistry();
    const got = await registry.dispatch(scope, "check_safety", { restrictions: [] }, null, "t");
    expect(got.receipts![0]!.status).toBe("succeeded");
    const broken = new ActionRegistry();
    broken.register(scope, { name: "reader", description: "A read that throws.", effect: "read", inputSchema: { type: "object", properties: {}, additionalProperties: false } }, () => {
      throw new Error("nope");
    });
    const r = await broken.dispatch(scope, "reader", {}, null, "t");
    expect(r.receipts![0]!.status).toBe("failed");
  });

  test("the real checkout path succeeds and is verified by reading the page back", async () => {
    const { registry, scope } = bareRegistry();
    await registry.dispatch(scope, "add_to_cart", { item: "tomato_soup" }, async () => true, "t");
    const got = await registry.dispatch(scope, "checkout_demo_order", {}, async () => true, "t");
    expect(got.receipts![0]!.status).toBe("succeeded");
    expect(String((got.receipts![0]!.result as { summary: string }).summary)).toContain("Tomato soup");
    expect(document.querySelector("[data-confirmation]")!.hasAttribute("hidden")).toBe(false);
  });

  test("a checkout with an empty order does not place one", async () => {
    const { registry, scope } = bareRegistry();
    const got = await registry.dispatch(scope, "checkout_demo_order", {}, async () => true, "t");
    expect(got.receipts![0]!.status).toBe("unknown"); // it commits, so a failure to start is still not a certainty
    expect(got.receipts![0]!.error).toContain("empty");
    expect(document.querySelector("[data-confirmation]")!.hasAttribute("hidden")).toBe(true);
  });
});

/* ================================================================== */
/* F. The visitor's key goes to the router and nowhere else            */
/* ================================================================== */

/**
 * Scan every surface the spec names: request URLs (query string included),
 * request bodies, request headers, the trace, and action arguments. Returns one
 * line per place the sentinel was found, so the assertion is an exact whitelist
 * rather than a count.
 */
function leaks(captured: Captured[], trace: TraceEntry[], plans: ConfirmItem[][], sentinel: string): string[] {
  const out: string[] = [];
  for (const c of captured) {
    if (c.url.includes(sentinel)) out.push(`url ${c.url}`);
    if (new URL(c.url).search.includes(sentinel)) out.push(`query ${c.url}`);
    if (c.bodyText.includes(sentinel)) out.push(`body ${c.url}`);
    for (const [k, v] of c.request.headers) if (v.includes(sentinel)) out.push(`header ${k} ${c.url}`);
  }
  if (JSON.stringify(trace).includes(sentinel)) out.push("trace");
  if (JSON.stringify(plans).includes(sentinel)) out.push("confirm plan");
  // The set of PLACES, not the number of occurrences: several authorised calls to
  // the one router the visitor chose is the whole point, not a leak.
  return [...new Set(out)].sort();
}

describe("the visitor's key reaches the router they chose, and nothing else", () => {
  /**
   * The whitelist is exactly one entry. Breaks if the key appears anywhere else
   * at all: in a peer request, a public-artifact request, a URL, a prompt, an
   * action argument, a confirmation plan or a trace line.
   */
  test("across a whole session, the key appears in exactly one place: the router's Authorization header", async () => {
    const h = harness({
      replies: [callTool("check_safety", { restrictions: ["dairy_free"] }), callTool("add_to_cart", { item: "reuben" }), say("Done.")],
      peers: { "https://bakery.example/agents/agent-manifest.json": { networks: [{ name: "marrow_point", front_man: "baker", hocon: "x.json" }] } },
    });
    const s = await session({ key: SENTINEL, h, allowedPeers: ["https://bakery.example"] });
    s.tick("dairy_free");
    await s.runtime.ask("check the menu for me and add a reuben");
    await s.runtime.fetchPeerArtifact("https://bakery.example/agents/agent-manifest.json");

    // The session really did talk to several origins.
    expect(new Set(h.captured.map((c) => new URL(c.url).origin)).size).toBeGreaterThanOrEqual(3);
    expect(h.captured.filter((c) => c.url === ROUTER_URL).length).toBeGreaterThanOrEqual(2);

    expect(leaks(h.captured, s.runtime.trace(), s.plans, SENTINEL)).toEqual([`header authorization ${ROUTER_URL}`]);
  });

  test("no prompt sent to the model contains the key", async () => {
    const h = harness({ replies: [callTool("get_menu_state", {}), say("Here is the menu.")] });
    const s = await session({ key: SENTINEL, h });
    await s.runtime.ask("what have you got?");
    const prompts = h.routerBodies().flatMap((b) => b.messages.map((m) => m.content));
    expect(prompts.length).toBeGreaterThan(2);
    for (const p of prompts) expect(p).not.toContain(SENTINEL);
    // It really was used: the request that carried those prompts was authorised.
    expect(h.captured.find((c) => c.url === ROUTER_URL)!.request.headers.get("authorization")).toBe(`Bearer ${SENTINEL}`);
  });

  test("the trace records that a key was used, never its value", async () => {
    const h = harness({ replies: [say("Hello.")] });
    const s = await session({ key: SENTINEL, h });
    await s.runtime.ask("hello");
    const t = s.runtime.trace();
    expect(t.some((e) => e.detail["keySource"] === "local BYOK (not shown)")).toBe(true);
    expect(JSON.stringify(t)).not.toContain(SENTINEL);
  });

  /** The scanner has to be able to fail, or the test above proves nothing. */
  test("the scanner is live: a key in a URL, a query, a body, another header or the trace all trip it", () => {
    const fake = (url: string, init: RequestInit = {}): Captured => ({
      url,
      init,
      request: new Request(url, init),
      bodyText: typeof init.body === "string" ? init.body : "",
    });
    expect(leaks([fake(`https://x.example/${SENTINEL}`)], [], [], SENTINEL)).toEqual([`url https://x.example/${SENTINEL}`]);
    expect(leaks([fake(`https://x.example/a?key=${SENTINEL}`)], [], [], SENTINEL)).toHaveLength(2); // url and query
    expect(leaks([fake("https://x.example/a", { method: "POST", body: `{"k":"${SENTINEL}"}` })], [], [], SENTINEL)).toEqual([
      "body https://x.example/a",
    ]);
    expect(leaks([fake("https://x.example/a", { headers: { "X-Api-Key": SENTINEL } })], [], [], SENTINEL)).toEqual([
      "header x-api-key https://x.example/a",
    ]);
    expect(leaks([], [{ at: 0, event: "oops", detail: { key: SENTINEL } }], [], SENTINEL)).toEqual(["trace"]);
    expect(leaks([], [], [[{ action: "a", description: "d", origin: "o", effect: "read", arguments: { k: SENTINEL } }]], SENTINEL)).toEqual([
      "confirm plan",
    ]);
    expect(leaks([fake("https://x.example/a")], [{ at: 0, event: "fine", detail: {} }], [], SENTINEL)).toEqual([]);
  });

  /**
   * Public artifact requests carry no ambient credential (L322-324). Asserted on
   * the normalised `Request`, not on the init object we handed to fetch.
   */
  test("the manifest, the network definition and links.json are fetched with no credentials", async () => {
    const h = harness({ replies: [] });
    await session({ key: SENTINEL, h });
    const wanted = [`${BASE}/agent-manifest.json`, `${BASE}/vouch.network.json`, `${BASE}/links.json`];
    for (const url of wanted) {
      const c = h.captured.find((x) => x.url === url);
      expect(c, url).toBeDefined();
      expect(c!.request.credentials, url).toBe("omit");
      expect(c!.request.headers.get("authorization"), url).toBeNull();
      expect(c!.request.headers.get("cookie"), url).toBeNull();
    }
  });

  test("a peer's public artifact is fetched the same way, with no key and no credentials", async () => {
    const peerUrl = "https://bakery.example/agents/agent-manifest.json";
    const h = harness({ peers: { [peerUrl]: { networks: [] } } });
    const s = await session({ key: SENTINEL, h, allowedPeers: ["https://bakery.example"] });
    await s.runtime.fetchPeerArtifact(peerUrl);
    const c = h.captured.find((x) => x.url === peerUrl)!;
    expect(c.request.credentials).toBe("omit");
    expect(c.request.headers.get("authorization")).toBeNull();
    expect(leaks([c], [], [], SENTINEL)).toEqual([]);
  });

  /** A denied origin is refused and named, and nothing goes out. */
  test("an origin outside the published peer policy is refused by name and never contacted", async () => {
    const h = harness();
    const s = await session({ key: SENTINEL, h });
    const before = h.captured.length;
    await expect(s.runtime.fetchPeerArtifact("https://someone-else.example/agents/x")).rejects.toThrow(
      /https:\/\/someone-else\.example is not an allowed peer/,
    );
    expect(h.captured).toHaveLength(before);
    expect(s.runtime.trace().some((e) => e.event === "peer_refused")).toBe(true);
  });
});

/* ================================================================== */
/* G. The visitor can take their key back                             */
/* ================================================================== */

describe("the stored key can be deleted, and the safety layer does not care", () => {
  /** Asserted on the store, not on the call. */
  test("the delete affordance leaves the store actually empty", async () => {
    const s = await session({ key: SENTINEL });
    expect(s.storage.map.size).toBe(1);
    expect(s.runtime.keyStore.key()).toBe(SENTINEL);
    s.$("[data-key-forget]")!.click();
    expect(s.storage.map.size).toBe(0);
    expect(s.storage.getItem(KEY_ITEM)).toBeNull();
    expect(s.runtime.keyStore.key()).toBe("");
    expect(s.$("[data-key-input]") as HTMLInputElement).toHaveProperty("value", "");
    expect(s.$("[data-key-status]")!.textContent).toContain("deleted");
  });

  test("after deleting the key, the verdict beside every dish still works", async () => {
    const s = await session({ key: SENTINEL });
    s.$("[data-key-forget]")!.click();
    s.tick("dairy_free");
    expect(document.querySelectorAll("[data-verdict-slot] [data-verdict]")).toHaveLength(MENU.items.length);
    expect(card("turkey_club")!.getAttribute("data-verdict")).toBe("unsafe");
    expect(s.$("[data-key-status]")!.textContent).toContain("never needed a model");
  });

  test("saving a key keeps it here, and reading it back returns it unchanged", async () => {
    const s = await session();
    (s.$("[data-key-input]") as HTMLInputElement).value = SENTINEL;
    s.$("[data-key-save]")!.click();
    expect(new KeyStore(s.storage).key()).toBe(SENTINEL);
  });

  test("a browser that refuses storage is reported, not crashed into", () => {
    const hostile: StorageLike = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    const store = new KeyStore(hostile);
    expect(store.read()).toBeNull();
    expect(store.key()).toBe("");
    expect(store.save({ key: SENTINEL })).toBe(false);
    expect(() => store.forget()).not.toThrow();
  });

  test("a corrupt stored profile is ignored rather than trusted", () => {
    const s = new MemStorage();
    for (const junk of ["", "not json", "[]", '{"key":""}', '{"router":"x"}', "null"]) {
      s.setItem(KEY_ITEM, junk);
      expect(new KeyStore(s).read(), junk).toBeNull();
    }
  });

  test("with no key at all, asking says what to do and does not call a model", async () => {
    const h = harness({ replies: [] });
    const s = await session({ h });
    await s.runtime.ask("what can I eat?");
    expect(h.captured.filter((c) => c.url === ROUTER_URL)).toHaveLength(0);
    const t = s.transcriptText();
    expect(t).toContain("api.openai.com");
    expect(t).toContain("stays in this browser");
    // The sentence only this product can add.
    expect(t).toContain("never calls a model");
  });
});

/* ================================================================== */
/* H. Bounded execution, and failing closed                           */
/* ================================================================== */

describe("execution is bounded and failures are visible", () => {
  test("an over-budget conversation stops with the budget shown, and nothing half-done", async () => {
    const h = harness({ replies: [callTool("get_menu_state", {}), callTool("get_menu_state", {}), say("never reached")] });
    const s = await session({ key: SENTINEL, h, limits: { maxModelCalls: 1 } });
    await s.runtime.ask("tell me everything");
    expect(s.transcriptText()).toContain("maxModelCalls is 1");
    expect(h.captured.filter((c) => c.url === ROUTER_URL)).toHaveLength(1);
    expect(s.runtime.trace().some((e) => e.event === "budget_stopped")).toBe(true);
  });

  test("an invalid published network is stopped with the validation errors on screen", async () => {
    const broken = structuredClone(NETWORK);
    broken.tools![0]!.tools = ["menu_guide", "a_tool_that_does_not_exist"];
    broken.tools!.push(structuredClone(broken.tools![1]!)); // a duplicate name too
    const s = await session({ h: harness({ artifacts: { [`${BASE}/vouch.network.json`]: broken } }) });
    const shown = s.$("[data-runtime-error]")!.textContent!;
    expect(shown).toContain("a_tool_that_does_not_exist");
    expect(shown).toContain("Duplicate agent name 'menu_guide'");
    expect(s.runtime.conversation).toBeNull();
    s.tick("dairy_free");
    expect(card("turkey_club")!.getAttribute("data-verdict")).toBe("unsafe");
  });

  test("a network name that is not published is refused, never swapped for another", async () => {
    const s = await session({ network: "marrow_point" });
    expect(s.$("[data-runtime-error]")!.textContent).toContain("refusing to run a different one");
    expect(s.runtime.network).toBeNull();
  });

  test("a manifest front_man that disagrees with the positional rule is refused", async () => {
    const bent = structuredClone(MANIFEST);
    bent.networks![0]!.front_man = "menu_guide";
    const s = await session({ h: harness({ artifacts: { [`${BASE}/agent-manifest.json`]: bent } }) });
    expect(s.$("[data-runtime-error]")!.textContent).toContain("must agree");
    expect(s.runtime.conversation).toBeNull();
  });

  /** A true cycle is refused; a repeated sibling call is not a cycle (§3.1). */
  test("an agent appearing in its own ancestry is refused by name, and the call is not made", async () => {
    const cyclic: NetworkConfig = {
      metadata: { name: "loop", front_man: "a" },
      llm_config: { model_name: "test-model" },
      tools: [
        { name: "a", function: { description: "Front.", parameters: { type: "object", properties: { q: { type: "string", description: "q" } }, required: ["q"] } }, instructions: "You are A. Never say a dish is safe; the verdict is the site's.", tools: ["b"] },
        { name: "b", function: { description: "Second.", parameters: { type: "object", properties: { q: { type: "string", description: "q" } }, required: ["q"] } }, instructions: "You are B. Never say a dish is safe; the verdict is the site's.", tools: ["a"] },
      ],
    };
    const manifest = structuredClone(MANIFEST);
    manifest.networks = [{ name: "loop", front_man: "a", hocon: "loop.network.json" }];
    const h = harness({
      replies: [callTool("b", { q: "x" }), callTool("a", { q: "x" }), say("b is finished"), say("and so is a")],
      artifacts: { [`${BASE}/agent-manifest.json`]: manifest, [`${BASE}/loop.network.json`]: cyclic },
    });
    const s = await session({ key: SENTINEL, h });
    expect(s.runtime.conversation).not.toBeNull();
    await s.runtime.ask("go");
    expect(s.runtime.trace().some((e) => e.event === "cycle_refused")).toBe(true);
    const toolResults = h.routerBodies().flatMap((b) => b.messages.filter((m) => m.role === "tool").map((m) => m.content));
    expect(toolResults.some((c) => c.includes("Composition cycle refused: a → b → a"))).toBe(true);
  });

  test("a tool call the network does not have is reported as a failure, not as a result", async () => {
    const h = harness({ replies: [callTool("sommelier", { q: "x" }), say("That is not something I can do.")] });
    const s = await session({ key: SENTINEL, h });
    await s.runtime.ask("ask the sommelier");
    const toolResults = h.routerBodies().flatMap((b) => b.messages.filter((m) => m.role === "tool").map((m) => m.content));
    expect(toolResults[0]).toContain("FAILED");
    expect(toolResults[0]).toContain("not an agent in this network");
  });

  test("arguments that are not valid JSON stop the call rather than reaching a handler", async () => {
    const bad: ModelJson = {
      model: "test-model",
      choices: [{ message: { content: "", tool_calls: [{ id: "c", type: "function", function: { name: "add_to_cart", arguments: "{oops" } }] } }],
    };
    const h = harness({ replies: [bad, say("I could not do that.")] });
    const s = await session({ key: SENTINEL, h });
    await s.runtime.ask("add something");
    expect(s.plans).toHaveLength(0);
    expect(document.querySelectorAll("[data-cart-line]")).toHaveLength(0);
  });
});

/* ================================================================== */
/* I. The adapted upstream plumbing, against the real artifacts        */
/* ================================================================== */

describe("the adapted upstream plumbing, run against what we actually publish", () => {
  /** The positional rule, not metadata.front_man, is what decides. */
  test("the front agent of the published network is front_of_house, by the positional rule", () => {
    expect(find_front_man(NETWORK)).toBe("front_of_house");
    expect(NETWORK.metadata!.front_man).toBe("front_of_house");
    const reordered = structuredClone(NETWORK);
    reordered.tools = [reordered.tools![1]!, reordered.tools![0]!, ...reordered.tools!.slice(2)];
    // Metadata is unchanged and is ignored: order is what the rule reads.
    expect(reordered.metadata!.front_man).toBe("front_of_house");
    expect(find_front_man(reordered)).toBe("menu_guide");
  });

  test("the published network validates, and each kind of defect is caught", () => {
    expect(validate_network(NETWORK)).toEqual([]);
    // Upstream's validator concatenates every check rather than stopping at the
    // first, so an empty network reports both its defects. Matched deliberately.
    expect(validate_network({ tools: [] })).toEqual(["Network 'tools' array must not be empty.", "No front-man agent found."]);
    expect(validate_network({})).toEqual(["Network must have a 'tools' array.", "No front-man agent found."]);
    const dangling = structuredClone(NETWORK);
    dangling.tools![0]!.tools = ["nobody"];
    expect(validate_network(dangling)).toEqual(["Agent 'front_of_house' references missing tool 'nobody'."]);
    const dupe = structuredClone(NETWORK);
    dupe.tools!.push(structuredClone(dupe.tools![1]!));
    expect(validate_network(dupe)).toEqual(["Duplicate agent name 'menu_guide'."]);
  });

  test("every tool reference in the published network classifies as an in-network agent", () => {
    for (const agent of NETWORK.tools ?? []) {
      for (const ref of agent.tools ?? []) expect(classify_tool(NETWORK, ref), `${agent.name} -> ${String(ref)}`).toBe("agent");
    }
  });

  test("the published router rule: no key gives the default route, a key gives the BYOK route", () => {
    expect(selectTopRouter(MANIFEST, "", "")).toEqual({ baseUrl: ROUTER, mock: false, upgradedToByok: false });
    expect(selectTopRouter(MANIFEST, "", SENTINEL)).toEqual({ baseUrl: ROUTER, mock: false, upgradedToByok: true });
    // The defect Task 5 found, pinned once more at the function that found it.
    const nested = structuredClone(MANIFEST);
    delete nested.llm_router!["byok_router"];
    expect(() => selectTopRouter(nested, "", SENTINEL)).toThrow(/publishes no AI provider route/);
  });

  test("the replayed route is chosen as an override and never upgraded away", () => {
    expect(selectTopRouter(MANIFEST, SCRIPTED_ROUTER, "")).toEqual({ baseUrl: SCRIPTED_ROUTER, mock: false, upgradedToByok: false });
    expect(selectTopRouter(MANIFEST, SCRIPTED_ROUTER, SENTINEL).baseUrl).toBe(SCRIPTED_ROUTER);
  });

  test("the published peer policy admits nothing by default, and is not an open policy", () => {
    expect(manifestAllowsPeer("https://bakery.example/agents/x", MANIFEST)).toBe(false);
    expect(manifestAllowsPeer("https://bakery.example/agents/x", MANIFEST, new Set(["https://bakery.example"]))).toBe(true);
    const open = structuredClone(MANIFEST);
    open.peer_policy = { mode: "open", deny_origins: [] };
    expect(manifestAllowsPeer("https://anyone.example/x", open)).toBe(true);
    expect(manifestAllowsPeer("https://anyone.example/x", MANIFEST)).toBe(false);
  });

  /**
   * Our allow lists are all `[]`, so nothing crosses. This does NOT isolate
   * private context between sibling agents, and nothing here may claim it does.
   */
  test("private context is deny-by-default and our published allow lists pass nothing", () => {
    for (const agent of NETWORK.tools ?? []) {
      expect(filter_sly_data({ user_key: "x", session: "y" }, agent.allow?.to_downstream?.sly_data), agent.name).toEqual({});
      expect(filter_sly_data({ user_key: "x" }, agent.allow?.to_upstream?.sly_data), agent.name).toEqual({});
    }
    // The filter is live: a named field does cross, and a star crosses everything.
    expect(filter_sly_data({ a: 1, b: 2 }, ["a"])).toEqual({ a: 1 });
    expect(filter_sly_data({ a: 1, b: 2 }, ["*"])).toEqual({ a: 1, b: 2 });
    expect(filter_sly_data({ a: 1 }, null)).toEqual({});
  });

  test("links.json is read for the running network, and a missing one is not a failure", async () => {
    const h = harness();
    const s = await session({ h });
    expect(h.captured.some((c) => c.url === `${BASE}/links.json`)).toBe(true);
    expect(s.runtime.links()).toEqual({});
    const none = harness({ artifacts: { [`${BASE}/links.json`]: undefined } });
    expect(await loadPublishedLinks(BASE, "vouch", none.fetchImpl)).toEqual({});
  });

  test("the agent network cannot reach a verdict: no agent's tools name a registered action", () => {
    const actionNames = (MANIFEST.actions ?? []).map((a) => a.name);
    for (const agent of NETWORK.tools ?? []) {
      for (const ref of agent.tools ?? []) expect(actionNames).not.toContain(ref);
    }
  });
});
