// @vitest-environment jsdom
//
// §6's seventh interoperability check: "Stop an invalid network, a composition
// cycle, an over-budget request, and a denied origin with visible errors." Plus
// §3.4's "a missing key MUST stop the model call with a clear setup error", which
// is a fifth refusal of exactly the same shape and belongs with these four.
//
// TWO RULES THIS FILE FOLLOWS, BOTH PAID FOR
//
//  1. **Visible, not present.** An earlier suite asserted that a node EXISTED and
//     passed while every card was hidden. Every refusal here is asserted visible
//     through `hiddenReason`, on the element and on each of its ancestors, and
//     read through `readableText`, which sees text-bearing attributes too.
//  2. **A test must fail when the thing it tests breaks.** Each block says what
//     invariant it encodes and the exact change that would make it fail. Nothing
//     here restates a constant, and nothing reimplements its subject: the broken
//     fixtures are the REAL files from `public/broken/`, served over the harness
//     fetch exactly as a peer's artifacts would be.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, test } from "vitest";
import { MENU } from "../src/safety/canon.ts";
import { detectClaims } from "../src/gate/claims.ts";
import { NOT_OURS, QUOTED_CHARS_MAX, QUOTED_LINES_MAX, ours, renderQuoted } from "../src/runtime/errors.ts";
import { seconds } from "../src/runtime/limits.ts";
import { mountShop } from "../src/site/shop.ts";
import { boot, domConfirm, type BootOptions, type Runtime } from "../src/runtime/boot.ts";
import { KEY_ITEM, type StorageLike } from "../src/runtime/key-store.ts";
import {
  BadReferenceError,
  CompositionCycleError,
  ConsentRefusedError,
  DeniedOriginError,
  InvalidNetworkError,
  NoSuchNetworkError,
  externalRefs,
  parseNetworkRef,
} from "../src/runtime/composition.ts";
import { missingKeyMessage } from "../src/runtime/llm.ts";
import { BudgetError } from "../src/runtime/limits.ts";
import { validate_declared_front_man, validate_network } from "../src/runtime/upstream/validation.ts";
import { manifestAllowsPeer } from "../src/runtime/upstream/router.ts";
import type { ConfirmItem, Manifest, NetworkConfig } from "../src/runtime/types.ts";

/* ================================================================== */
/* Harness                                                             */
/* ================================================================== */

const root = resolve(import.meta.dirname, "..");
const html = readFileSync(resolve(root, "src/site/index.html"), "utf8");
const readJson = (...parts: string[]): unknown => JSON.parse(readFileSync(resolve(root, ...parts), "utf8"));

const MANIFEST = readJson("public", "agent-manifest.json") as Manifest;
const NETWORK = readJson("public", "vouch.network.json") as NetworkConfig;
const LINKS = readJson("public", "links.json");

/** The deliberately broken artifacts, read from disk. Not re-typed here; that is the point. */
const BROKEN_MANIFEST = readJson("public", "broken", "agent-manifest.json") as Manifest;
const INVALID = readJson("public", "broken", "invalid.network.json") as NetworkConfig;
const CYCLE_A = readJson("public", "broken", "cycle-a.network.json") as NetworkConfig;
const CYCLE_B = readJson("public", "broken", "cycle-b.network.json") as NetworkConfig;

const BASE = "https://deli.example";
const ROUTER_URL = "https://api.openai.com/v1/chat/completions";
const BROKEN = `${BASE}/broken`;

/** Obviously fake. Never a real key, in a test, a fixture or a log line. */
const SENTINEL = "sk-FAKE-SENTINEL-vouch-task7-DO-NOT-USE";

type ModelJson = Record<string, unknown>;
const say = (content: string): ModelJson => ({ model: "test-model", choices: [{ message: { content } }] });
const callTools = (calls: { name: string; args?: unknown }[]): ModelJson => ({
  model: "test-model",
  choices: [
    {
      message: {
        content: "",
        tool_calls: calls.map((c, i) => ({
          id: `call_${c.name}_${i}`,
          type: "function",
          function: { name: c.name, arguments: JSON.stringify(c.args ?? {}) },
        })),
      },
    },
  ],
});

const ok = (body: unknown): Response =>
  ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) }) as unknown as Response;
const notFound = (): Response =>
  ({ ok: false, status: 404, json: async () => ({}), text: async () => "not found" }) as unknown as Response;

interface Harness {
  urls: string[];
  fetchImpl: typeof fetch;
  /** How many times a URL was requested. The cycle tests care about the count, not just the fact. */
  count: (url: string) => number;
}

/**
 * A fetch that serves the real published artifacts AND the real broken fixtures,
 * plus any extra artifacts a test supplies and a queue of model replies.
 *
 * `onModelCall` runs when the router is hit, which is how the wall-clock test
 * moves time: deterministically, at a known point, rather than by sleeping.
 */
function harness(
  opts: { replies?: ModelJson[]; artifacts?: Record<string, unknown>; onModelCall?: () => void } = {},
): Harness {
  const urls: string[] = [];
  const replies = [...(opts.replies ?? [])];
  const artifacts: Record<string, unknown> = {
    [`${BASE}/agent-manifest.json`]: MANIFEST,
    [`${BASE}/vouch.network.json`]: NETWORK,
    [`${BASE}/links.json`]: LINKS,
    [`${BROKEN}/agent-manifest.json`]: BROKEN_MANIFEST,
    [`${BROKEN}/invalid.network.json`]: INVALID,
    [`${BROKEN}/cycle-a.network.json`]: CYCLE_A,
    [`${BROKEN}/cycle-b.network.json`]: CYCLE_B,
    ...opts.artifacts,
  };
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);
    if (url === ROUTER_URL) {
      opts.onModelCall?.();
      const next = replies.shift();
      if (!next) throw new Error("the test ran out of scripted model replies");
      return ok(next);
    }
    if (Object.hasOwn(artifacts, url) && artifacts[url] !== undefined) return ok(artifacts[url]);
    return notFound();
  }) as unknown as typeof fetch;
  return { urls, fetchImpl, count: (url) => urls.filter((u) => u === url).length };
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
  h: Harness;
  /** Every confirmation plan the runtime put to the guest. */
  plans: ConfirmItem[][];
  answer: { value: boolean };
  $: (sel: string) => HTMLElement | null;
  composeText: () => string;
  transcriptText: () => string;
  tick: (id: string) => void;
}

async function session(opts: Partial<BootOptions> & { h?: Harness; key?: string } = {}): Promise<Session> {
  const h = opts.h ?? harness();
  const storage = new MemStorage();
  if (opts.key) storage.setItem(KEY_ITEM, JSON.stringify({ key: opts.key }));
  const plans: ConfirmItem[][] = [];
  const answer = { value: true };
  const mount = document.createElement("div");
  document.body.append(mount);
  const { h: _h, key: _k, ...rest } = opts;
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
  return {
    runtime,
    mount,
    h,
    plans,
    answer,
    $,
    composeText: () => visibleTextOf(mount, "[data-compose-status]"),
    transcriptText: () => visibleTextOf(mount, "[data-transcript]"),
    tick: (id: string) => {
      const box = mount.querySelector<HTMLInputElement>(`[data-restriction="${id}"]`)!;
      box.checked = true;
      box.dispatchEvent(new Event("change"));
    },
  };
}

/* ------------------------------------------------------------------ */
/* Visible, not merely present                                         */
/* ------------------------------------------------------------------ */

const TEXT_ATTRS = ["aria-label", "aria-description", "title", "alt", "placeholder", "value"];

/** Everything on an element and its subtree that a person or assistive tech can read. */
function readableText(el: Element): string {
  const parts: string[] = [el.textContent ?? ""];
  for (const node of [el, ...el.querySelectorAll("*")]) {
    for (const a of TEXT_ATTRS) {
      const v = node.getAttribute(a);
      if (v) parts.push(v);
    }
  }
  return parts.join(" ");
}

/**
 * Why this element is not presented, or null if it is. jsdom has no layout, so
 * this checks the mechanisms that do not need one — `hidden`, `aria-hidden`,
 * inline `display`/`visibility`/`opacity` — on the element and on every ancestor.
 *
 * This exists because a previous "visible to the user" test asserted the node was
 * in the DOM, and hiding the element passed it.
 */
function hiddenReason(el: Element | null): string | null {
  if (!el) return "no element";
  for (let node: Element | null = el; node && node !== document.documentElement; node = node.parentElement) {
    const tag = node.tagName.toLowerCase();
    if (node.hasAttribute("hidden")) return `hidden on <${tag}>`;
    if (node.getAttribute("aria-hidden") === "true") return `aria-hidden on <${tag}>`;
    const style = (node as HTMLElement).style;
    if (style?.display === "none") return `display:none on <${tag}>`;
    if (style?.visibility === "hidden" || style?.visibility === "collapse") return `visibility on <${tag}>`;
    if (style?.opacity === "0") return `opacity:0 on <${tag}>`;
    // A refusal inside a collapsed <details> is a refusal nobody sees.
    if (tag === "details" && !(node as HTMLDetailsElement).open && node !== el) return "inside a closed <details>";
  }
  return null;
}

/**
 * The readable text of a surface, ASSERTED VISIBLE first. Every refusal assertion
 * in this file goes through here, so none of them can pass on a hidden element.
 */
function visibleTextOf(root: ParentNode, selector: string): string {
  const el = root.querySelector(selector);
  const why = hiddenReason(el);
  if (why) throw new Error(`${selector} is not visible to the guest: ${why}`);
  return readableText(el!);
}

/**
 * A surface with every `data-not-ours` node taken out: **what the site itself is
 * saying** there.
 *
 * This is the structural fix as a function. Someone else's words may be shown on
 * our page, fenced and attributed; they may never be part of a sentence of ours.
 * Whatever is left after removing those nodes is the deli speaking, and a safety
 * claim in it is the failure this product exists to prevent.
 */
function siteVoiceOf(root: ParentNode, selector: string): string {
  const el = root.querySelector(selector);
  const why = hiddenReason(el);
  if (why) throw new Error(`${selector} is not visible to the guest: ${why}`);
  const clone = el!.cloneNode(true) as Element;
  for (const node of [...clone.querySelectorAll(`[${NOT_OURS}]`)]) node.replaceWith("");
  return readableText(clone);
}

/** The text of each node on a surface that is marked as not the site speaking. */
function notOursTextOf(root: ParentNode, selector: string): string[] {
  return [...(root.querySelector(selector)?.querySelectorAll(`[${NOT_OURS}]`) ?? [])].map((n) => n.textContent ?? "");
}

/**
 * The WHOLE PAGE in the site's voice: every readable surface, minus every node
 * marked as not ours. The verdict slots live outside the panel, so a page-wide
 * check is the only one that cannot be scoped to the wrong element — the mistake
 * an earlier suite made and paid for.
 */
function siteVoiceOfPage(): string {
  const clone = document.body.cloneNode(true) as HTMLElement;
  for (const node of [...clone.querySelectorAll(`[${NOT_OURS}]`)]) node.replaceWith("");
  return `${readableText(clone)} ${document.title}`;
}

/**
 * What the site CLAIMS in its own voice, as the project's own detector sees it.
 *
 * NOT asserted to be empty, and that is the point: this page is SUPPOSED to make
 * safety claims — the verdict beside each dish is one, and the menu copy
 * ("if an item says its ingredients are not listed, ask at the counter") trips
 * the detector too. Those are the backed claims the whole product exists to
 * make.
 *
 * So the property is a DIFFERENCE, not an absence: an untrusted value must not
 * change what the site claims. The same page, loaded with a benign value and
 * with a hostile one, must claim exactly the same things.
 */
function claimsInSiteVoice(): string[] {
  return detectClaims(siteVoiceOfPage(), MENU)
    .map((c) => `${c.item ?? "-"}:${c.allergen ?? "-"}:${c.claimed}`)
    .sort();
}

beforeEach(() => {
  document.documentElement.innerHTML = html;
  mountShop(document);
});

/* ================================================================== */
/* The fixtures are what they claim to be                              */
/* ================================================================== */

describe("the broken fixtures break in the one way each claims, and no other", () => {
  /**
   * INVARIANT: `invalid.network.json` is well-formed JSON and valid in every
   * respect except its declared front man. Without this, the invalid-network
   * refusal below could be passing for the wrong reason — a typo, a missing
   * field, or unparseable JSON, which would prove only that `JSON.parse` works.
   *
   * BREAKS IF: the fixture gains a second defect, loses the front_man defect, or
   * stops being JSON (`readJson` throws at import).
   */
  test("the invalid network's only defect is its declared front man, and it parses", () => {
    expect(validate_network(INVALID)).toEqual(["metadata.front_man names 'concierge', which is not an agent in this network."]);
    // The defect is exactly "names an agent that does not exist", not "is absent".
    expect(INVALID.metadata!.front_man).toBe("concierge");
    expect((INVALID.tools ?? []).map((a) => a.name)).not.toContain("concierge");
    // And the validator is live rather than always complaining.
    expect(validate_declared_front_man(NETWORK)).toEqual([]);
    expect(validate_declared_front_man({ tools: [{ name: "x", instructions: "y" }] })).toEqual([]);
  });

  /**
   * INVARIANT: neither half of the cycle pair is an invalid document. The cycle is
   * a property of the PAIR, which is what §6 means by a composition cycle, and
   * what distinguishes it from a self-reference.
   *
   * BREAKS IF: either fixture is made invalid (then "refused" would not identify
   * which check refused it), or if either stops naming the other as external.
   */
  test("both halves of the cycle validate on their own, and each names the other as external", () => {
    expect(validate_network(CYCLE_A)).toEqual([]);
    expect(validate_network(CYCLE_B)).toEqual([]);
    expect(externalRefs(CYCLE_A)).toEqual(["/broken/cycle-b"]);
    expect(externalRefs(CYCLE_B)).toEqual(["/broken/cycle-a"]);
    // Not a self-reference, which is the easy case a real two-site cycle walks past.
    expect(externalRefs(CYCLE_A)).not.toContain("/broken/cycle-a");
    expect(externalRefs(CYCLE_B)).not.toContain("/broken/cycle-b");
  });

  /**
   * INVARIANT (§3.2): the site's published manifest declares one network and does
   * not list the broken ones. They are reachable by URL and invisible to
   * discovery, because "if no exact match exists, it MUST fail rather than select
   * another published network" — so a runtime must never reach them by accident.
   *
   * BREAKS IF: anyone adds a broken fixture to `public/agent-manifest.json`, or
   * points a published `hocon` into `broken/`.
   */
  test("the published manifest does not list the broken fixtures", () => {
    expect((MANIFEST.networks ?? []).map((n) => n.name)).toEqual(["vouch"]);
    for (const n of MANIFEST.networks ?? []) expect(n.hocon).not.toContain("broken");
    // The fixtures' own manifest is a separate document and lists all three.
    expect((BROKEN_MANIFEST.networks ?? []).map((n) => n.name)).toEqual(["invalid", "cycle-a", "cycle-b"]);
    // It admits no peer either, so loading it cannot become a way out to another origin.
    expect(BROKEN_MANIFEST.allowed_peers).toEqual([]);
  });

  /**
   * INVARIANT (§3.2): a reference is a URL whose LAST path component is the
   * network name and whose preceding path is the site base.
   *
   * BREAKS IF: the parse takes the whole path as the base, or drops the origin
   * from the identity the cycle check compares (then two same-named networks on
   * different sites would collide and a legitimate load would read as a cycle).
   */
  test("a network reference is split into site base and network name, origin included", () => {
    expect(parseNetworkRef("/broken/cycle-a", BASE)).toEqual({
      base: `${BASE}/broken`,
      name: "cycle-a",
      id: `${BASE}/broken/cycle-a`,
      origin: BASE,
    });
    expect(parseNetworkRef("https://peer.example/agents/transit", BASE).base).toBe("https://peer.example/agents");
    expect(parseNetworkRef("https://peer.example/agents/transit", BASE).name).toBe("transit");
    // Same name, different site: different identities.
    expect(parseNetworkRef("https://a.example/x/n", BASE).id).not.toBe(parseNetworkRef("https://b.example/x/n", BASE).id);
  });
});

/* ================================================================== */
/* Refusal 1: an invalid network                                       */
/* ================================================================== */

describe("refusal 1 — an invalid network is stopped with the offending field on screen", () => {
  /**
   * INVARIANT (§3.2 definition fetch): a network definition fetched over HTTP is
   * validated BEFORE execution, and the refusal names the offending field and its
   * bad value, visibly. Not "invalid network".
   *
   * BREAKS IF: `validate_declared_front_man` is dropped from `validate_network`;
   * the composition loader stops validating; `InvalidNetworkError` stops
   * interpolating the field; or the status element is hidden.
   */
  test("the field and its bad value are named, the network is not loaded, and the string is visible", async () => {
    const s = await session();
    await s.runtime.loadPeerNetwork("/broken/invalid");

    expect(siteVoiceOf(s.mount, "[data-compose-status]")).toContain("is not valid, so it was not run");
    expect(siteVoiceOf(s.mount, "[data-compose-status]")).toContain("The validator reported one problem with it");
    // The document and the validator's words are shown, each in a node of its
    // own, and neither is in a sentence of ours.
    expect(notOursTextOf(s.mount, "[data-compose-status]")).toEqual([
      `${BROKEN}/invalid.network.json`,
      "metadata.front_man names 'concierge', which is not an agent in this network.",
    ]);
    expect(siteVoiceOf(s.mount, "[data-compose-status]")).not.toContain("concierge");
    expect(s.runtime.composed()).toEqual([]);
    expect(s.$("[data-compose-status]")!.getAttribute("data-compose-kind")).toBe("refused");

    // It really did fetch the definition: this is the validator refusing, not a 404.
    expect(s.h.count(`${BROKEN}/invalid.network.json`)).toBe(1);
  });

  /**
   * INVARIANT: the refusal is a string the deli composed, never the fetch
   * layer's. An unreachable definition throws an `Error` whose message quotes
   * the URL and the status; that is not ours to repeat. The same rule covers a
   * malformed one, whose `SyntaxError` quotes the file.
   *
   * The fixture serves a **404**, which is what this exercises; the title said
   * "not JSON" until fix round 2, which described a different case.
   *
   * BREAKS IF: the catch in `loadPeerNetwork` starts showing `err.message`.
   */
  test("a definition that cannot be fetched is refused in the site's own words, not the fetch layer's", async () => {
    const h = harness({
      artifacts: {
        [`${BROKEN}/invalid.network.json`]: undefined, // 404, which is also not ours to quote
      },
    });
    const s = await session({ h });
    await s.runtime.loadPeerNetwork("/broken/invalid");
    const shown = s.composeText();
    expect(shown).toContain("Refused");
    expect(shown).not.toContain("returned HTTP");
    expect(s.runtime.composed()).toEqual([]);
  });

  /**
   * INVARIANT (§3.2): an exact name match, or fail. Never a different network.
   *
   * BREAKS IF: the loader falls back to the manifest's first entry.
   */
  test("a name no published network has is refused, never swapped for another", async () => {
    const s = await session();
    await s.runtime.loadPeerNetwork("/broken/not-published");
    expect(siteVoiceOf(s.mount, "[data-compose-status]")).toContain("no network of that name is published in that manifest");
    expect(notOursTextOf(s.mount, "[data-compose-status]")).toEqual(["not-published", `${BROKEN}/agent-manifest.json`]);
    expect(s.runtime.composed()).toEqual([]);
    // The fixtures' manifest was read, and no definition was fetched from it.
    expect(s.h.count(`${BROKEN}/agent-manifest.json`)).toBe(1);
    expect(s.h.urls.filter((u) => u.endsWith(".network.json") && u.startsWith(BROKEN))).toEqual([]);
  });
});

/* ================================================================== */
/* Refusal 2: a composition cycle, across two documents                */
/* ================================================================== */

describe("refusal 2 — a two-document composition cycle is refused with the path shown", () => {
  /**
   * INVARIANT (§6): network A composing B composing A is refused, the path is on
   * screen, and the refusal happens BEFORE the repeat fetch.
   *
   * BREAKS IF: the cycle check moves after the fetch (the count assertion fails);
   * the path is not interpolated (the path assertion fails); the check compares
   * network NAMES rather than resolved identities; or the status is hidden.
   */
  test("the path is named, and nothing is fetched twice", async () => {
    const s = await session();
    await s.runtime.loadPeerNetwork("/broken/cycle-a");

    expect(siteVoiceOf(s.mount, "[data-compose-status]")).toContain("Composition cycle refused");
    expect(siteVoiceOf(s.mount, "[data-compose-status]")).toContain("No further network was fetched and nothing was run");
    // The chain, each hop in its own node and in the order it was followed.
    expect(notOursTextOf(s.mount, "[data-compose-status]")).toEqual([
      `${BROKEN}/cycle-a`,
      `${BROKEN}/cycle-b`,
      `${BROKEN}/cycle-a`,
    ]);
    expect(s.runtime.composed()).toEqual([]);

    // Each document was fetched once. A detector that fetched first would make the
    // first of these 2.
    expect(s.h.count(`${BROKEN}/cycle-a.network.json`)).toBe(1);
    expect(s.h.count(`${BROKEN}/cycle-b.network.json`)).toBe(1);
    expect(s.runtime.trace().some((e) => e.event === "composition_cycle_refused")).toBe(true);
  });

  /**
   * INVARIANT: the refusal is about the PAIR, not about one document. Entering
   * the loop from the other end refuses too, and the path starts where the
   * visitor started.
   *
   * BREAKS IF: the detector special-cases a particular fixture, or anchors the
   * path at the wrong end.
   */
  test("entering the same loop from the other end is refused too, with its own path", async () => {
    const s = await session();
    await s.runtime.loadPeerNetwork("/broken/cycle-b");
    expect(notOursTextOf(s.mount, "[data-compose-status]")).toEqual([
      `${BROKEN}/cycle-b`,
      `${BROKEN}/cycle-a`,
      `${BROKEN}/cycle-b`,
    ]);
  });

  /**
   * INVARIANT (§3.1, a MUST, at the network level): a network reached twice by
   * two different routes is a diamond, not a cycle. The check is on the PATH.
   *
   * BREAKS IF: `path.includes(id)` becomes a seen-set over everything loaded —
   * then `leaf` is refused the second time it is reached and this test fails.
   */
  test("a diamond composition loads: the same network reached twice is not a cycle", async () => {
    const peer = (name: string, refs: string[]): NetworkConfig => ({
      metadata: { name, front_man: `${name}_front` },
      llm_config: { model_name: "test-model" },
      tools: [
        {
          name: `${name}_front`,
          function: { description: "Front.", parameters: { type: "object", properties: { q: { type: "string", description: "q" } }, required: ["q"] } },
          instructions: "You describe only, and never say a dish is safe; the verdict is the site's.",
          tools: refs,
        },
      ],
    });
    const manifestFor = (names: string[]): Manifest => ({
      networks: names.map((n) => ({ name: n, front_man: `${n}_front`, hocon: `${n}.network.json` })),
      allowed_peers: [],
    });
    const s = await session({
      h: harness({
        artifacts: {
          [`${BASE}/dag/agent-manifest.json`]: manifestFor(["hub", "left", "right", "leaf"]),
          [`${BASE}/dag/hub.network.json`]: peer("hub", ["/dag/left", "/dag/right"]),
          [`${BASE}/dag/left.network.json`]: peer("left", ["/dag/leaf"]),
          [`${BASE}/dag/right.network.json`]: peer("right", ["/dag/leaf"]),
          [`${BASE}/dag/leaf.network.json`]: peer("leaf", []),
        },
      }),
      limits: { maxComposedNetworks: 8 },
    });
    await s.runtime.loadPeerNetwork("/dag/hub");
    expect(siteVoiceOf(s.mount, "[data-compose-status]")).not.toContain("cycle");
    expect(s.runtime.composed().map((c) => c.ref.name)).toEqual(["hub", "left", "leaf", "right", "leaf"]);
    expect(s.h.count(`${BASE}/dag/leaf.network.json`)).toBe(2);
  });

  /**
   * INVARIANT (§3.1 composition depth): a chain of DISTINCT networks is bounded.
   * The cycle check cannot do this job — nothing here is a cycle.
   *
   * BREAKS IF: `maxComposedNetworks` stops being enforced; the walk then follows
   * the chain to its end and `composed()` holds four entries instead of none.
   */
  test("a chain of distinct networks is stopped by the composition-depth budget, with both figures", async () => {
    const link = (name: string, next: string | null): NetworkConfig => ({
      metadata: { name, front_man: `${name}_front` },
      llm_config: { model_name: "test-model" },
      tools: [
        {
          name: `${name}_front`,
          function: { description: "Front.", parameters: { type: "object", properties: { q: { type: "string", description: "q" } }, required: ["q"] } },
          instructions: "You describe only, and never say a dish is safe; the verdict is the site's.",
          tools: next ? [next] : [],
        },
      ],
    });
    const names = ["n1", "n2", "n3", "n4"];
    const s = await session({
      h: harness({
        artifacts: {
          [`${BASE}/chain/agent-manifest.json`]: {
            networks: names.map((n) => ({ name: n, front_man: `${n}_front`, hocon: `${n}.network.json` })),
            allowed_peers: [],
          } satisfies Manifest,
          [`${BASE}/chain/n1.network.json`]: link("n1", "/chain/n2"),
          [`${BASE}/chain/n2.network.json`]: link("n2", "/chain/n3"),
          [`${BASE}/chain/n3.network.json`]: link("n3", "/chain/n4"),
          [`${BASE}/chain/n4.network.json`]: link("n4", null),
        },
      }),
      limits: { maxComposedNetworks: 2 },
    });
    await s.runtime.loadPeerNetwork("/chain/n1");
    const shown = s.composeText();
    expect(shown).toContain("a composition may load 2 published networks");
    expect(shown).toContain("has already loaded 2");
    expect(s.runtime.composed()).toEqual([]);
    expect(s.h.count(`${BASE}/chain/n4.network.json`)).toBe(0);
  });
});

/* ================================================================== */
/* §3.1's MUST: a repeated invocation is not a cycle                   */
/* ================================================================== */

describe("a repeated invocation is NOT a cycle (§3.1, a MUST)", () => {
  /**
   * INVARIANT: "repeated invocation of the same agent MUST NOT, by itself, be
   * treated as a cycle." A guest asking about two dishes invokes `menu_guide`
   * twice, which is ordinary conversation.
   *
   * This test is as important as the cycle tests. Without it, a later "fix" to a
   * cycle detector reintroduces the violation silently — and the violation is
   * not subtle: it refuses the second question anyone asks.
   *
   * BREAKS IF: the delegation check becomes a seen-set on agent names
   * (`seen.has(name)` instead of `stack.includes(name)`). Then the second
   * `menu_guide` call is refused, `cycle_refused` appears in the trace, and the
   * tool result carries a refusal instead of the sub-agent's answer.
   */
  test("the same agent invoked twice in one turn is not refused", async () => {
    const h = harness({
      replies: [
        callTools([{ name: "menu_guide", args: { question: "what is the reuben?" } }]),
        say("The Reuben has corned beef, sauerkraut, swiss and rye."),
        callTools([{ name: "menu_guide", args: { question: "and the turkey club?" } }]),
        say("The Turkey club has turkey, bacon, lettuce, tomato and mayonnaise."),
        say("Both described."),
      ],
      onModelCall: () => {},
    });
    const s = await session({ key: SENTINEL, h });
    await s.runtime.ask("tell me about the reuben and the turkey club");

    expect(s.runtime.trace().some((e) => e.event === "cycle_refused")).toBe(false);
    expect(s.transcriptText()).not.toContain("cycle");
    // Both delegations actually happened, in the deli's own voice.
    const delegated = s.runtime.trace().filter((e) => e.event === "agent_delegated");
    expect(delegated.map((e) => e.detail["agent"])).toEqual(["menu_guide", "menu_guide"]);
  });

  /**
   * INVARIANT: and yet a genuine delegation cycle — an agent inside its own
   * ancestry — IS still refused. Without this, "does not refuse repeats" could be
   * satisfied by refusing nothing at all.
   *
   * BREAKS IF: the ancestry check is removed.
   */
  test("...while an agent inside its own ancestry is still refused", async () => {
    const cyclic: NetworkConfig = {
      metadata: { name: "loop", front_man: "a" },
      llm_config: { model_name: "test-model" },
      tools: [
        { name: "a", function: { description: "Front.", parameters: { type: "object", properties: { q: { type: "string", description: "q" } }, required: ["q"] } }, instructions: "You are A, and never say a dish is safe.", tools: ["b"] },
        { name: "b", function: { description: "Second.", parameters: { type: "object", properties: { q: { type: "string", description: "q" } }, required: ["q"] } }, instructions: "You are B, and never say a dish is safe.", tools: ["a"] },
      ],
    };
    const manifest = structuredClone(MANIFEST);
    manifest.networks = [{ name: "loop", front_man: "a", hocon: "loop.network.json" }];
    const h = harness({
      replies: [
        callTools([{ name: "b", args: { q: "x" } }]),
        callTools([{ name: "a", args: { q: "x" } }]),
        say("b is done"),
        say("and so is a"),
      ],
      artifacts: { [`${BASE}/agent-manifest.json`]: manifest, [`${BASE}/loop.network.json`]: cyclic },
    });
    const s = await session({ key: SENTINEL, h });
    await s.runtime.ask("go");
    expect(s.runtime.trace().some((e) => e.event === "cycle_refused")).toBe(true);
  });
});

/* ================================================================== */
/* Refusal 3: over budget, with the budget AND the spend               */
/* ================================================================== */

describe("refusal 3 — an over-budget request stops with the budget and the spend shown", () => {
  /**
   * INVARIANT: the refusal shows BOTH figures. "Over budget" without them is
   * indistinguishable from a bug, which is the confusion §6 exists to rule out.
   *
   * BREAKS IF: either number is dropped from `BudgetError`'s message, or the
   * limit stops being enforced (then the second reply is shown instead).
   */
  test("the model-call budget names the limit and what had been spent", async () => {
    const h = harness({ replies: [callTools([{ name: "get_menu_state" }]), say("never reached")] });
    const s = await session({ key: SENTINEL, h, limits: { maxModelCalls: 1 } });
    await s.runtime.ask("tell me everything");
    const shown = s.transcriptText();
    expect(shown).toContain("this turn may make 1 model call");
    expect(shown).toContain("has already made 1");
    expect(shown).not.toContain("never reached");
    expect(s.h.count(ROUTER_URL)).toBe(1);
  });

  /**
   * INVARIANT (§3.1, the axis Task 6 left open): elapsed execution time is
   * finite, and an overrun is reported as the wall-clock budget rather than as a
   * network error. Both figures again.
   *
   * The clock is moved by the harness at the moment the router is called, so this
   * is deterministic — no sleeping, and no dependence on how fast the suite runs.
   *
   * BREAKS IF: `maxElapsedMs` is not checked (the turn completes and "Described."
   * reaches the transcript); or the check happens only BEFORE a call, in which
   * case a single slow call is never caught and this test fails.
   */
  test("the wall clock stops a turn that overran, and names the elapsed time", async () => {
    let clock = 0;
    const h = harness({
      replies: [say("Described."), say("not reached")],
      onModelCall: () => {
        clock += 2000; // this one call took two seconds
      },
    });
    const s = await session({ key: SENTINEL, h, limits: { maxElapsedMs: 1000 }, now: () => clock });
    await s.runtime.ask("what have you got?");
    const shown = s.transcriptText();
    // Seconds, with the unit, because a guest and a judge read this string.
    expect(shown).toContain("this turn may take 1 second");
    expect(shown).toContain("has already taken 2 seconds");
    expect(shown).not.toContain("maxElapsedMs");
    expect(shown).not.toContain("1000");
    // The reply that came back late does not get to put its words on the screen.
    expect(shown).not.toContain("Described.");
    expect(s.runtime.trace().some((e) => e.event === "budget_stopped" && e.detail["budget"] === "maxElapsedMs")).toBe(true);
  });

  /**
   * INVARIANT: the wall clock is a limit, not a wall. A turn inside its budget
   * finishes normally.
   *
   * BREAKS IF: the clock is checked against the wrong origin (a session start
   * rather than a turn start), or fires unconditionally. Either makes the second
   * question fail here.
   */
  test("a turn inside the wall-clock budget completes, and each turn starts the clock again", async () => {
    let clock = 0;
    const h = harness({
      replies: [say("One."), say("Two.")],
      onModelCall: () => {
        clock += 400; // well inside the budget, but two turns exceed it together
      },
    });
    const s = await session({ key: SENTINEL, h, limits: { maxElapsedMs: 500 }, now: () => clock });
    await s.runtime.ask("a");
    await s.runtime.ask("b");
    const shown = s.transcriptText();
    expect(shown).toContain("One.");
    expect(shown).toContain("Two.");
    expect(shown).not.toContain("Execution limit reached");
  });
});

/* ================================================================== */
/* Refusal 4: a denied origin — and a permitted one                    */
/* ================================================================== */

describe("refusal 4 — a denied origin is refused by name, and a permitted one is not", () => {
  const PEER = "https://bakery.example";
  const PEER_BASE = `${PEER}/agents`;
  const peerNetwork: NetworkConfig = {
    metadata: { name: "marrow_point", front_man: "baker" },
    llm_config: { model_name: "test-model" },
    tools: [
      {
        name: "baker",
        function: { description: "Describes the bakery's own items.", parameters: { type: "object", properties: { q: { type: "string", description: "q" } }, required: ["q"] } },
        instructions: "You describe baked goods, and never say whether one is safe for anyone.",
        tools: [],
      },
    ],
  };
  const peerArtifacts = {
    [`${PEER_BASE}/agent-manifest.json`]: {
      networks: [{ name: "marrow_point", front_man: "baker", hocon: "marrow_point.network.json" }],
      allowed_peers: [],
    } satisfies Manifest,
    [`${PEER_BASE}/marrow_point.network.json`]: peerNetwork,
  };

  /** A manifest that permits the bakery at the TOP LEVEL only; the nested copy stays empty. */
  function permitting(): Manifest {
    const m = structuredClone(MANIFEST);
    m.allowed_peers = [PEER];
    m.peer_policy = { ...(m.peer_policy ?? {}), allowed_peers: [] };
    return m;
  }

  /**
   * INVARIANT: the refusal names the denied origin, nothing is sent to it, and
   * the visitor is never even asked — policy is decided before consent, because
   * asking about an origin you have already decided to refuse teaches people to
   * approve anything.
   *
   * BREAKS IF: the allow-list check is removed; the origin stops being
   * interpolated; a request reaches the origin; or consent is sought first.
   */
  test("an origin absent from the published allow-list is named, never contacted, never put to the guest", async () => {
    const s = await session();
    const before = s.h.urls.length;
    await s.runtime.loadPeerNetwork("https://elsewhere.example/agents/anything");

    expect(siteVoiceOf(s.mount, "[data-compose-status]")).toContain("that origin is not in this site's allowed_peers");
    expect(notOursTextOf(s.mount, "[data-compose-status]")).toEqual(["https://elsewhere.example"]);
    expect(s.h.urls).toHaveLength(before);
    expect(s.plans).toEqual([]);
    expect(s.runtime.composed()).toEqual([]);
    expect(s.runtime.trace().some((e) => e.event === "peer_refused")).toBe(true);
  });

  /**
   * INVARIANT: the allow-list is READ FROM THE PUBLISHED MANIFEST, top level, at
   * runtime. This is the test that stops the one above from being a tautology:
   * `allowed_peers` is `[]` today, so a hard-coded deny would pass it forever,
   * including after a real peer is published.
   *
   * BREAKS IF: the deny is hard-coded (nothing is ever permitted); the check
   * reads `peer_policy.allowed_peers` instead of the top-level list (this
   * manifest's nested copy is deliberately empty, so a nested read refuses the
   * bakery and this test fails); or the manifest stops being consulted.
   */
  test("an origin present in the published top-level allowed_peers is contacted and loaded", async () => {
    const h = harness({ artifacts: { [`${BASE}/agent-manifest.json`]: permitting(), ...peerArtifacts } });
    const s = await session({ h });
    await s.runtime.loadPeerNetwork(`${PEER_BASE}/marrow_point`);

    expect(siteVoiceOf(s.mount, "[data-compose-status]")).toContain("Loaded and validated the published network below");
    expect(notOursTextOf(s.mount, "[data-compose-status]").join(" ")).toContain("marrow_point");
    expect(s.runtime.composed().map((c) => c.ref.name)).toEqual(["marrow_point"]);
    expect(s.h.count(`${PEER_BASE}/marrow_point.network.json`)).toBe(1);
    // The published allow-list really is what permitted it, and only at top level.
    expect(manifestAllowsPeer(`${PEER_BASE}/marrow_point`, permitting())).toBe(true);
    expect(manifestAllowsPeer(`${PEER_BASE}/marrow_point`, MANIFEST)).toBe(false);
  });

  /**
   * INVARIANT (§3.2 consent): an allow-listed third-party origin is still put to
   * the visitor before contact, and a refusal stops the fetch.
   *
   * BREAKS IF: consent is skipped once the allow-list passes — then the peer is
   * fetched although the guest said no, and the URL count assertion fails.
   */
  test("an allow-listed origin is still asked about, and a no stops the fetch", async () => {
    const h = harness({ artifacts: { [`${BASE}/agent-manifest.json`]: permitting(), ...peerArtifacts } });
    const s = await session({ h });
    s.answer.value = false;
    await s.runtime.loadPeerNetwork(`${PEER_BASE}/marrow_point`);

    expect(s.plans).toHaveLength(1);
    expect(s.plans[0]![0]!.origin).toBe(PEER);
    expect(siteVoiceOf(s.mount, "[data-compose-status]")).toContain("you did not approve contacting that origin");
    expect(notOursTextOf(s.mount, "[data-compose-status]")).toEqual([PEER]);
    expect(s.h.count(`${PEER_BASE}/agent-manifest.json`)).toBe(0);
    expect(s.runtime.composed()).toEqual([]);
  });

  /**
   * INVARIANT: this site's own networks are not third parties. §3.2's consent
   * requirement governs "contact with third-party origins"; demanding consent to
   * read your own second network would make the published allow-list a list of
   * origins that includes yourself, which no publisher writes.
   *
   * BREAKS IF: the same-origin branch is removed — then the fixture load below
   * records a confirmation plan, or is refused for not being in `allowed_peers`.
   */
  test("a same-origin network needs no peer consent and is not checked against allowed_peers", async () => {
    const s = await session();
    await s.runtime.loadPeerNetwork("/broken/invalid");
    expect(s.plans).toEqual([]);
    // It got as far as the validator, which is proof the origin check let it past.
    expect(s.composeText()).toContain("metadata.front_man");
  });
});

/* ================================================================== */
/* Refusal 5: a missing key (§3.4)                                     */
/* ================================================================== */

describe("refusal 5 — a missing key stops the model call with a clear setup error", () => {
  /**
   * INVARIANT (§3.4, a MUST): with a router that requires a key and no key
   * present, the model call does not happen and the visitor sees a setup message
   * that names the host, says what to do, says where the key stays, and says that
   * the safety check needs no key at all.
   *
   * BREAKS IF: the `needsKey` guard is removed (a router request appears); the
   * message loses the host, the instruction or the `check_safety` sentence; or it
   * becomes a thrown error that only a console sees.
   */
  test("the message names the host, what to do, and that check_safety needs no key", async () => {
    const h = harness({ replies: [] });
    const s = await session({ h });
    await s.runtime.ask("what can I eat?");

    const shown = s.transcriptText();
    expect(s.h.count(ROUTER_URL)).toBe(0);
    expect(shown).toContain("An AI provider key is required for the provider named below");
    expect(notOursTextOf(s.mount, "[data-transcript]")).toEqual(["api.openai.com"]);
    expect(shown).toContain("Open the model settings above, paste your key, then select Save");
    expect(shown).toContain("stays in this browser and is sent only to that provider");
    expect(shown).toContain("No model call was made");
    expect(shown).toContain("check_safety and the verdict beside each dish");
    expect(shown).toContain("work with no key at all");
  });

  /**
   * INVARIANT: and the claim that message makes is TRUE. The verdict beside each
   * dish is computed with no key, no router and no model call.
   *
   * This is the contrast the product rests on, so it is asserted rather than
   * described: if the message said it and the cards needed a key, the setup error
   * would be a lie.
   *
   * BREAKS IF: the verdict path ever acquires a dependency on a router or a key.
   */
  test("and with no key at all the verdict beside each dish still appears", async () => {
    const s = await session({ h: harness({ replies: [] }) });
    await s.runtime.ask("what can I eat?");
    s.tick("dairy_free");

    const card = document.querySelector<HTMLElement>('[data-verdict-item="turkey_club"]');
    expect(hiddenReason(card)).toBeNull();
    expect(card!.getAttribute("data-verdict")).toBe("unsafe");
    expect(s.runtime.findings().length).toBeGreaterThan(0);
    // No model was involved in any of it.
    expect(s.h.count(ROUTER_URL)).toBe(0);
  });

  /**
   * INVARIANT: the same setup error is READABLE on the panel before anyone types,
   * so a visitor is told what is missing rather than finding out by asking.
   *
   * The key status lives inside the "AI model settings" disclosure, which is
   * closed by default — and this assertion caught that, because `visibleTextOf`
   * treats a collapsed `<details>` as hidden. The disclosure now opens itself
   * when the router needs a key.
   *
   * BREAKS IF: the key-status line stops reporting `needsKey`, or the disclosure
   * stops opening for it — a setup error behind a closed triangle is not clear.
   */
  test("the setup error is readable on the panel before anything is asked", async () => {
    const s = await session();
    expect(visibleTextOf(s.mount, "[data-key-status]")).toContain("An AI provider key is required for the provider named below");
    expect(notOursTextOf(s.mount, "[data-key-status]")).toEqual(["api.openai.com"]);
    expect((s.$("[data-model-settings]") as HTMLDetailsElement).open).toBe(true);
  });

  /**
   * INVARIANT: and the disclosure stays shut when there is nothing to act on, so
   * opening it means something.
   *
   * BREAKS IF: it is opened unconditionally — which would make the test above
   * pass for the wrong reason.
   */
  test("...and the disclosure stays shut when a key is present", async () => {
    const s = await session({ key: SENTINEL });
    expect((s.$("[data-model-settings]") as HTMLDetailsElement).open).toBe(false);
  });
});

/* ================================================================== */
/* All five, visible                                                   */
/* ================================================================== */

describe("all five refusals put a visible string on the screen", () => {
  /**
   * INVARIANT: each of the five refusals §6 and §3.4 require is readable on the
   * page, on an element that is not hidden by `hidden`, `aria-hidden`, inline
   * `display`/`visibility`/`opacity`, or a collapsed `<details>`.
   *
   * This is the task's actual requirement, asserted once in one place so it
   * cannot be satisfied four times and missed on the fifth.
   *
   * BREAKS IF: any refusal becomes a thrown error with no rendering, or its
   * surface is hidden. `visibleTextOf` throws rather than returning "" when the
   * element is hidden, so hiding one fails this test rather than passing it.
   */
  const cases: { what: string; surface: string; expect: string; run: (s: Session) => Promise<unknown> }[] = [
    {
      what: "an invalid network",
      surface: "[data-compose-status]",
      expect: "is not valid, so it was not run",
      run: (s) => s.runtime.loadPeerNetwork("/broken/invalid"),
    },
    {
      what: "a composition cycle",
      surface: "[data-compose-status]",
      expect: "Composition cycle refused",
      run: (s) => s.runtime.loadPeerNetwork("/broken/cycle-a"),
    },
    {
      what: "a denied origin",
      surface: "[data-compose-status]",
      expect: "that origin is not in this site's allowed_peers",
      run: (s) => s.runtime.loadPeerNetwork("https://elsewhere.example/agents/anything"),
    },
    {
      what: "an over-budget request",
      surface: "[data-transcript]",
      expect: "Execution limit reached",
      run: (s) => s.runtime.ask("tell me everything"),
    },
    {
      what: "a missing key",
      surface: "[data-transcript]",
      expect: "An AI provider key is required",
      run: (s) => s.runtime.ask("what can I eat?"),
    },
  ];

  test.each(cases)("$what is refused with a visible string", async ({ surface, expect: wanted, run }) => {
    const h = harness({ replies: [callTools([{ name: "get_menu_state" }]), say("never reached")] });
    // A key so the over-budget case reaches the budget rather than the key check;
    // the missing-key case overrides it below.
    const withKey = wanted.includes("provider key") ? {} : { key: SENTINEL };
    const s = await session({ h, limits: { maxModelCalls: 1 }, ...withKey });
    await run(s);
    expect(visibleTextOf(s.mount, surface)).toContain(wanted);
  });

  /**
   * INVARIANT: none of the five is only a thrown error. `loadPeerNetwork` never
   * rejects, and `ask` never rejects; the refusal is the rendering.
   *
   * BREAKS IF: a refusal is rethrown instead of rendered.
   */
  test("no refusal reaches the caller as a rejection", async () => {
    const h = harness({ replies: [callTools([{ name: "get_menu_state" }]), say("never reached")] });
    const s = await session({ key: SENTINEL, h, limits: { maxModelCalls: 1 } });
    await expect(s.runtime.loadPeerNetwork("/broken/invalid")).resolves.toBeUndefined();
    await expect(s.runtime.loadPeerNetwork("/broken/cycle-a")).resolves.toBeUndefined();
    await expect(s.runtime.loadPeerNetwork("https://elsewhere.example/agents/x")).resolves.toBeUndefined();
    await expect(s.runtime.ask("tell me everything")).resolves.toBeUndefined();
  });

  /**
   * INVARIANT: the refusal machinery does not depend on the site having started
   * successfully. A visitor whose manifest is unreachable can still watch this
   * runtime refuse, and with no manifest the allow-list is empty, so a
   * third-party origin is refused rather than silently permitted.
   *
   * BREAKS IF: the compose control is wired inside the startup `try`, or the
   * allow-list defaults to permissive when the manifest is null.
   */
  test("a failed startup leaves the refusals working, and admits no peer", async () => {
    const h = harness({ artifacts: { [`${BASE}/agent-manifest.json`]: undefined } });
    const s = await session({ h });
    expect(s.runtime.manifest).toBeNull();
    await s.runtime.loadPeerNetwork("https://elsewhere.example/agents/x");
    expect(s.composeText()).toContain("is not in this site's allowed_peers");
    await s.runtime.loadPeerNetwork("/broken/cycle-a");
    expect(s.composeText()).toContain("Composition cycle refused");
  });

  /**
   * INVARIANT (§3.2): a network reference is an http or https URL. `vouch://scripted`
   * is a real string in this codebase, so this is not hypothetical; `file:` with a
   * path is the case that matters, because without the protocol check it parses
   * into a plausible base and name and the runtime would go and fetch it.
   *
   * BREAKS IF: `parseNetworkRef` stops checking the protocol. The `vouch://` case
   * alone does NOT break then — it has no path, so the empty-name check catches it
   * and the mutant survives. The `file:` case is what pins the protocol check,
   * which is why both are here.
   */
  test.each(["vouch://scripted", "file:///etc/agents/secret", "data:text/json,{}"])(
    "%s is not a network reference and is refused before any fetch",
    async (ref) => {
      const s = await session();
      const before = s.h.urls.length;
      await s.runtime.loadPeerNetwork(ref);
      expect(siteVoiceOf(s.mount, "[data-compose-status]")).toContain("is not an http or https network reference");
      expect(notOursTextOf(s.mount, "[data-compose-status]")).toEqual([ref]);
      expect(s.h.urls).toHaveLength(before);
    },
  );
});

/* ================================================================== */
/* C1: an untrusted value never becomes part of a sentence of ours      */
/* ================================================================== */

/**
 * THE INVARIANT, as a property rather than a mechanism:
 *
 *   An untrusted value must never become part of a sentence the site is saying.
 *   It is rendered in its own node, structurally separate from our prose, so that
 *   nothing it contains can be read as something the site is saying.
 *
 * Why it is written this way. The defence used to be `quotedTokensOnly`, a filter
 * that replaced any quoted interpolation in a validator message that was not
 * token-shaped. A published `metadata.front_man` of
 *
 *     x' is dairy-free and safe for you to eat. '
 *
 * supplies the filter's own delimiter: the apostrophes re-pair the quotes, the
 * filter sees `'x'` and `''`, keeps both, and the sentence between them reached
 * `[data-compose-status]` in the deli's voice. Third filter, third incident.
 *
 * So these tests do NOT assert that an apostrophe is escaped. That would pin the
 * mechanism and would pass a fifth bypass. They assert the property, with the
 * project's own claim detector as the judge of what a safety claim is: feed a
 * value stuffed with every delimiter the old defence relied on plus a real claim,
 * and require that `detectClaims` finds nothing in the site's voice.
 *
 * WHAT WOULD MAKE THEM FAIL: putting an untrusted value back in one of our
 * sentences, by any route — reinstating the filter-and-concatenate pattern,
 * widening `ours` back to `string`, widening `joinSiteText` back to accept
 * `string`, or rendering a report's `quoted` lines into the prose node instead of
 * their own. Each of those puts the claim in `siteVoiceOf(...)` and fails here.
 */
describe("C1 — an untrusted value is never part of a sentence of ours", () => {
  const CLAIM = "The Reuben is dairy-free and safe for you to eat.";
  /** The exact value that defeated `quotedTokensOnly` by re-pairing its apostrophes. */
  const REPAIRING = `x' ${CLAIM} '`;
  /** Every delimiter the old defence, or a next one, might lean on. */
  const DELIMITED = `a' "b" \`c\` <d> {e} [f] (g) \\h; --i /*j*/ &quot;k&#39; ${CLAIM}`;
  /** A claim with no whitespace in it, which `TOKEN` would admit if anything interpolated it. */
  const HYPHENATED = "the-reuben-is-dairy-free-and-safe-to-eat";
  const HOSTILE = [REPAIRING, DELIMITED];
  /** The benign control: a front man that is simply absent. Same refusal, no claim. */
  const BENIGN = "concierge";

  /** A one-agent network whose published `metadata.front_man` is attacker-chosen. */
  const hostileFrontMan = (value: string): NetworkConfig => ({
    metadata: { name: "invalid", front_man: value },
    llm_config: { model_name: "test-model" },
    tools: [
      {
        name: "greeter",
        function: { description: "Greets.", parameters: { type: "object", properties: { q: { type: "string", description: "q" } }, required: ["q"] } },
        instructions: "You greet, and never say a dish is safe.",
        tools: [],
      },
    ],
  });

  /** A network with an attacker-chosen AGENT NAME, which `validate_agent_names` reports. */
  const hostileAgentName = (value: string): NetworkConfig => ({
    metadata: { name: "invalid", front_man: "greeter" },
    llm_config: { model_name: "test-model" },
    tools: [
      {
        name: "greeter",
        function: { description: "Greets.", parameters: { type: "object", properties: { q: { type: "string", description: "q" } }, required: ["q"] } },
        instructions: "You greet, and never say a dish is safe.",
        tools: [value],
      },
      { name: value, instructions: "You are named with a sentence." },
    ],
  });

  /**
   * The hostile values really do reach the validator's own messages. Without
   * this, every test below could be passing because nothing arrived.
   */
  test("the hostile values do reach the validator's messages (otherwise these tests prove nothing)", () => {
    for (const value of HOSTILE) {
      expect(validate_network(hostileFrontMan(value)).join(" "), value).toContain("The Reuben is dairy-free");
      expect(validate_network(hostileAgentName(value)).join(" "), value).toContain("The Reuben is dairy-free");
    }
  });

  /** And the retired filter really was defeated by the re-pairing value. */
  test("the retired filter would have let the re-pairing value through", () => {
    const retired = (m: string): string =>
      m.replace(/'([^']*)'/g, (_x, inner: string) => (/^[A-Za-z0-9_.:/#@?&=+~,;()[\]{}$*%!-]*$/.test(inner) ? `'${inner}'` : "'<name omitted>'"));
    const message = `metadata.front_man names '${REPAIRING}', which is not an agent in this network.`;
    expect(retired(message)).toContain("is dairy-free and safe for you to eat");
    expect(detectClaims(retired(message), MENU).length).toBeGreaterThan(0);
  });

  /* ---- refusal 1: an invalid network, through the real boot and composition ---- */

  /** Load `/broken/invalid` with a given definition and report what the page says. */
  async function loadInvalid(config: NetworkConfig): Promise<{ voice: string; notOurs: string }> {
    const h = harness({ artifacts: { [`${BROKEN}/invalid.network.json`]: config } });
    const s = await session({ h });
    await s.runtime.loadPeerNetwork("/broken/invalid");
    expect(s.runtime.composed()).toEqual([]);
    return {
      voice: siteVoiceOf(s.mount, "[data-compose-status]"),
      notOurs: notOursTextOf(s.mount, "[data-compose-status]").join(" "),
    };
  }

  test.each(HOSTILE)("a hostile front_man says nothing in our voice: %s", async (value) => {
    const benign = await loadInvalid(hostileFrontMan(BENIGN));
    document.documentElement.innerHTML = html;
    mountShop(document);
    const hostile = await loadInvalid(hostileFrontMan(value));

    // Our prose is literal, so it is byte-identical either way.
    expect(hostile.voice).toContain("is not valid, so it was not run");
    expect(hostile.voice).toBe(benign.voice);
    expect(hostile.voice).not.toContain("dairy-free");
    expect(hostile.voice).not.toContain("safe for you");
    // And the evidence IS shown, in a node that says it is not ours.
    expect(hostile.notOurs).toContain("The Reuben is dairy-free");
    expect(benign.notOurs).not.toContain("dairy-free");
  });

  test.each(HOSTILE)("a hostile AGENT NAME says nothing in our voice: %s", async (value) => {
    const benign = await loadInvalid(hostileFrontMan(BENIGN));
    document.documentElement.innerHTML = html;
    mountShop(document);
    const hostile = await loadInvalid(hostileAgentName(value));
    expect(hostile.voice).not.toContain("dairy-free");
    expect(hostile.voice).toBe(benign.voice);
    expect(hostile.notOurs).toContain("The Reuben is dairy-free");
  });

  /** The STARTUP path renders the same validator messages on a different surface. */
  test.each(HOSTILE)("the startup error line follows the same rule: %s", async (value) => {
    const hostile = structuredClone(NETWORK);
    hostile.metadata!.front_man = value;
    const s = await session({ h: harness({ artifacts: { [`${BASE}/vouch.network.json`]: hostile } }) });
    expect(s.runtime.conversation).toBeNull();
    const voice = siteVoiceOf(s.mount, "[data-runtime-error]");
    expect(voice).toContain("is not valid, so it was not run");
    expect(voice).not.toContain("dairy-free");
    expect(notOursTextOf(s.mount, "[data-runtime-error]").join(" ")).toContain("The Reuben is dairy-free");
    // The claim is nowhere in the site's voice on the whole page.
    expect(siteVoiceOfPage()).not.toContain("dairy-free and safe for you");
    // ...and the cards, which are the actual safety channel, are untouched.
    s.tick("dairy_free");
    expect(hiddenReason(document.querySelector('[data-verdict-item="reuben"]'))).toBeNull();
  });

  /* ---- the other four refusals, with the same payload ---- */

  /**
   * THE GENERAL PROPERTY, and the sharpest form of it available.
   *
   * Our refusal prose is written entirely in literals, so **it cannot vary with
   * the value**. Run the same refusal with a harmless value and with a hostile
   * one, and the site's voice must be byte-identical. Not "contains no claim" —
   * identical. A value that reached our sentence by any route would change it.
   *
   * None of these interpolates a value into prose any more: the rule has no
   * exceptions, so a hostile reference, origin or host goes in its own node like
   * a validator message does.
   *
   * `HYPHENATED` is the case that drove that decision. `TOKEN` admits hyphens, so
   * a value with no whitespace WOULD have survived `siteText` and landed in our
   * sentence — and the project's own detector reads "https://the-reuben-is-dairy-
   * free-and-safe-to-eat.example is not in this site's allowed_peers" as a
   * dairy-free claim about the Reuben. Marginal, and a visitor's own typing
   * rather than a peer's, but the invariant says never, so it is never.
   *
   * BREAKS IF: any of these values is interpolated into our prose again — the
   * two renderings then differ and the equality fails, whatever the quoting.
   */
  const paired: { what: string; benign: string; hostile: string }[] = [
    { what: "a denied origin", benign: "https://elsewhere.example/agents/x", hostile: `https://${HYPHENATED}.example/agents/x` },
    { what: "a bad reference", benign: "vouch://scripted", hostile: `vouch://${REPAIRING}` },
    { what: "a name no network has", benign: "/broken/nope", hostile: `/broken/${encodeURIComponent(CLAIM)}` },
    {
      what: "a denied origin whose path also carries delimiters",
      benign: "https://elsewhere.example/agents/plain",
      hostile: `https://${HYPHENATED}.example/agents/${encodeURIComponent(REPAIRING)}`,
    },
  ];

  test.each(paired)("$what: our sentence is the same whatever the value", async ({ benign, hostile }) => {
    const voiceFor = async (ref: string): Promise<{ voice: string; notOurs: string }> => {
      document.documentElement.innerHTML = html;
      mountShop(document);
      const s = await session();
      await s.runtime.loadPeerNetwork(ref);
      return {
        voice: siteVoiceOf(s.mount, "[data-compose-status]"),
        notOurs: notOursTextOf(s.mount, "[data-compose-status]").join(" "),
      };
    };
    const clean = await voiceFor(benign);
    const nasty = await voiceFor(hostile);

    expect(clean.voice).toContain("Refused");
    expect(nasty.voice).toBe(clean.voice);
    // The value is shown, and only where it is marked as not ours.
    expect(nasty.notOurs).not.toBe(clean.notOurs);
    expect(nasty.voice).not.toContain(HYPHENATED);
    expect(nasty.voice).not.toContain("dairy-free");
  });

  /** A composition cycle shows a chain of resolved URLs; none of it is in our sentence. */
  test("a composition cycle puts every hop in its own node, and none in our sentence", async () => {
    const s = await session();
    await s.runtime.loadPeerNetwork("/broken/cycle-a");
    expect(siteVoiceOf(s.mount, "[data-compose-status]")).toBe(
      "Composition cycle refused: the chain below returns to a network already being composed. " +
        "No further network was fetched and nothing was run." +
        "The chain, in the order it was followed:",
    );
    expect(notOursTextOf(s.mount, "[data-compose-status]")).toHaveLength(3);
  });

  /** The missing-key setup error names a host the VISITOR chose. */
  test("the missing-key setup error's own words do not vary with the router host", async () => {
    const voiceFor = async (routerUrl: string): Promise<{ voice: string; notOurs: string }> => {
      document.documentElement.innerHTML = html;
      mountShop(document);
      const s = await session({ h: harness({ replies: [] }) });
      s.mount.querySelector<HTMLInputElement>("[data-router-input]")!.value = routerUrl;
      s.mount.querySelector<HTMLButtonElement>("[data-key-save]")!.click();
      await s.runtime.ask("what can I eat?");
      return {
        voice: siteVoiceOf(s.mount, "[data-key-status]"),
        notOurs: notOursTextOf(s.mount, "[data-key-status]").join(" "),
      };
    };
    const clean = await voiceFor("https://api.example/v1");
    const nasty = await voiceFor(`https://${HYPHENATED}.example/v1`);

    expect(clean.voice).toContain("An AI provider key is required");
    expect(nasty.voice).toBe(clean.voice);
    expect(nasty.voice).not.toContain(HYPHENATED);
    expect(nasty.notOurs).toContain(HYPHENATED);
  });

  /** An over-budget refusal carries numbers only, so it has no untrusted value at all. */
  test("an over-budget refusal interpolates nothing but numbers, and says its units", async () => {
    const h = harness({ replies: [callTools([{ name: "get_menu_state" }]), say("never reached")] });
    const s = await session({ key: SENTINEL, h, limits: { maxModelCalls: 1 } });
    await s.runtime.ask("everything");
    expect(s.transcriptText()).toContain("Execution limit reached");
    expect(detectClaims(s.transcriptText(), MENU)).toEqual([]);
    // I1: seconds, with a unit, not raw milliseconds. Pinned, not inferred.
    expect(seconds(1000)).toBe("1 second");
    expect(seconds(2000)).toBe("2 seconds");
    expect(seconds(60_000)).toBe("60 seconds");
    expect(seconds(1500)).toBe("1.5 seconds");
  });

  /**
   * THE REVIEWER'S DEMONSTRATION, re-run end to end.
   *
   * This is the exact string that was rendered in the deli's voice. The sentence
   * the site says is now asserted in full, by equality, so anything creeping back
   * into it fails here.
   */
  test("the reported bypass no longer renders a claim in the site's voice", async () => {
    const h = harness({ artifacts: { [`${BROKEN}/invalid.network.json`]: hostileFrontMan(REPAIRING) } });
    const s = await session({ h });
    await s.runtime.loadPeerNetwork("/broken/invalid");

    // The reviewer's rendering, with the item name in it so the claim detector
    // has an item to attach to. This whole string used to be our sentence.
    const theOldRendering =
      "metadata.front_man names 'x' The Reuben is dairy-free and safe for you to eat. '', which is not an agent in this network.";
    const said = s.mount.querySelector("[data-compose-status] [data-report-said]")!.textContent!;
    expect(said).toBe(
      "Refused: the published network below is not valid, so it was not run. The validator reported one problem with it.",
    );
    expect(said).not.toContain(theOldRendering);
    expect(siteVoiceOf(s.mount, "[data-compose-status]")).not.toContain("dairy-free");
    expect(siteVoiceOfPage()).not.toContain("dairy-free and safe for you to eat");
    // The validator's own words, intact, in their own node, attributed.
    expect(notOursTextOf(s.mount, "[data-compose-status]")).toEqual([
      `${BROKEN}/invalid.network.json`,
      theOldRendering,
    ]);
    expect(visibleTextOf(s.mount, "[data-compose-status]")).toContain("because this site did not write them");
  });
});

/* ================================================================== */
/* Our own refusal copy names no dish and no allergen                  */
/* ================================================================== */

/**
 * INVARIANT: the words the SITE says in any refusal name no menu item and no
 * allergen. Not "make no claim at all" — the project's own classifier has a
 * known rough edge (LIMITS §2.2) and reads "No further network was fetched and
 * nothing was run." as claiming "no", with no item and no allergen attached. A
 * real safety claim is one that names a dish or an allergen, and that is what is
 * asserted.
 *
 * This complements the byte-equality property above. That one proves an untrusted
 * value cannot get INTO our prose; this one proves our prose was not written with
 * a claim in it in the first place — which no amount of structural separation
 * would fix.
 *
 * BREAKS IF: someone writes a refusal message that mentions a dish or an
 * allergen, or moves a value back into one of these sentences such that the
 * constructed message names one.
 */
describe("the words the site says in a refusal name no dish and no allergen", () => {
  /**
   * A claim that is about FOOD: it names a published menu item, or a published
   * allergen. The classifier's rough edges are deliberately excluded — it reads
   * "No further network was fetched" as claiming "no", and reads the
   * missing-key message's true sentence about `check_safety` and "the published
   * ingredients" as `allergen: "ingredients"` with no allergen in `allergens`.
   * Neither says anything about a dish, which is what matters here.
   */
  const aboutFood = (text: string): unknown[] =>
    detectClaims(text, MENU).filter((c) => c.item !== undefined || c.allergens.length > 0);

  test("every refusal's own prose and caption are free of item and allergen claims", () => {
    const reports = [
      new InvalidNetworkError("https://x/y.json", ["metadata.front_man names 'q', which is not an agent in this network."]).report,
      new DeniedOriginError("https://x").report,
      new CompositionCycleError(["a", "b", "a"]).report,
      new NoSuchNetworkError("n", "https://x/agent-manifest.json").report,
      new BadReferenceError("vouch://x").report,
      new ConsentRefusedError("https://x").report,
      missingKeyMessage("https://api.openai.com/v1"),
      new BudgetError("maxElapsedMs", 60_000, 61_000).report,
      new BudgetError("maxModelCalls", 16, 16).report,
      new BudgetError("maxComposedNetworks", 4, 4).report,
    ];
    expect(reports.length).toBeGreaterThan(9);
    for (const r of reports) {
      const ourWords = `${r.text} ${r.quotedLabel ?? ""}`;
      expect(aboutFood(ourWords), ourWords).toEqual([]);
    }
  });

  /** And the check is live: a message that DOES name a dish is caught. */
  test("...and that check would catch a refusal that named a dish", () => {
    expect(aboutFood("Refused: the Reuben is dairy-free, so it was not run.").length).toBeGreaterThan(0);
  });
});

/* ================================================================== */
/* Fix round 2: the display cap, and the confirmation dialog           */
/* ================================================================== */

describe("a foreign value is bounded for display, and the bound is not the defence", () => {
  /**
   * INVARIANT: a peer cannot use the refusal panel as a billboard. A long value
   * is shortened for display and a long list is truncated, with the fact that
   * something was cut said in OUR words, in a node outside the not-ours one.
   *
   * BREAKS IF: the slice in `renderQuoted` is removed.
   */
  test("an enormous value is shortened, and the site says so in its own words", async () => {
    const huge = "z".repeat(5_000);
    const s = await session({
      h: harness({
        artifacts: {
          [`${BROKEN}/invalid.network.json`]: {
            metadata: { name: "invalid", front_man: huge },
            llm_config: { model_name: "test-model" },
            tools: [{ name: "greeter", instructions: "You greet, and never say a dish is safe." }],
          } satisfies NetworkConfig,
        },
      }),
    });
    await s.runtime.loadPeerNetwork("/broken/invalid");

    const quoted = notOursTextOf(s.mount, "[data-compose-status]");
    for (const line of quoted) expect(line.length).toBeLessThanOrEqual(QUOTED_CHARS_MAX);
    // The note about shortening is ours, and is not inside the fenced node.
    expect(siteVoiceOf(s.mount, "[data-compose-status]")).toContain("shortened for display");
    expect(quoted.join(" ")).not.toContain("shortened for display");
  });

  /**
   * INVARIANT: a long LIST is truncated too, and the count of what is not shown
   * is ours.
   *
   * BREAKS IF: the `slice(0, QUOTED_LINES_MAX)` is removed.
   */
  test("a long list of foreign lines is truncated, and the remainder is counted", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const lines = Array.from({ length: QUOTED_LINES_MAX + 5 }, (_v, i) => `line ${i}`);
    renderQuoted(document, host, ours("Theirs:"), lines);
    expect(host.querySelectorAll(`[${NOT_OURS}]`)).toHaveLength(QUOTED_LINES_MAX);
    expect(host.textContent).toContain("5 further lines are not shown here");
  });

  /**
   * INVARIANT, and the one that matters most here: **the cap is a UI measure, not
   * a security control.** Raising it to absurdity must not change what the site
   * says, because what keeps a value out of our voice is the structural
   * separation, which does not care about length.
   *
   * Asserted by rendering the same hostile value with no practical cap at all
   * and checking our prose is byte-identical to the capped rendering.
   *
   * BREAKS IF: someone makes the cap load-bearing — e.g. by truncating at a
   * length chosen to cut a claim in half, so that the safety property depends on
   * the number. Then the two renderings differ in the site's voice.
   */
  test("the cap can be raised to absurdity without changing what the site says", () => {
    const claim = "The Reuben is dairy-free and safe for you to eat. ".repeat(40);
    const capped = document.createElement("div");
    const uncapped = document.createElement("div");
    document.body.append(capped, uncapped);

    renderQuoted(document, capped, ours("Theirs:"), [claim]);
    // The same render with the value already inside the cap: our words, unchanged.
    renderQuoted(document, uncapped, ours("Theirs:"), [claim.slice(0, QUOTED_CHARS_MAX)]);

    const voiceOf = (el: HTMLElement): string => {
      const clone = el.cloneNode(true) as HTMLElement;
      for (const n of [...clone.querySelectorAll(`[${NOT_OURS}]`)]) n.replaceWith("");
      return clone.textContent ?? "";
    };
    // The only difference our voice carries is the note that something was cut.
    expect(voiceOf(capped).replace("(shortened for display; the whole value is in the published document)", "")).toBe(voiceOf(uncapped));
    // And in both, the claim is only ever inside a not-ours node.
    for (const el of [capped, uncapped]) expect(voiceOf(el)).not.toContain("dairy-free");
  });
});

describe("the confirmation dialog speaks in the site's voice, and its values do not", () => {
  /**
   * INVARIANT (fix round 2, minor 1): `ConfirmItem.description` is `SiteText`,
   * so the dialog's prose is ours by type rather than by the author
   * remembering. The peer's network name is NOT in that prose; it is in
   * `arguments`, which the dialog renders in a node of its own.
   *
   * BREAKS IF: the peer-load description interpolates the network name again —
   * the equality below fails. It would also stop compiling, which is the point
   * of branding the field.
   */
  test("the peer-consent prompt's words carry no value, and the name is in its own node", async () => {
    const PEER = "https://bakery.example";
    const permitting = structuredClone(MANIFEST);
    permitting.allowed_peers = [PEER];
    const s = await session({
      h: harness({
        artifacts: {
          [`${BASE}/agent-manifest.json`]: permitting,
          [`${PEER}/agents/agent-manifest.json`]: {
            networks: [{ name: "marrow_point", front_man: "baker", hocon: "marrow_point.network.json" }],
            allowed_peers: [],
          } satisfies Manifest,
          [`${PEER}/agents/marrow_point.network.json`]: {
            metadata: { name: "marrow_point", front_man: "baker" },
            llm_config: { model_name: "test-model" },
            tools: [{ name: "baker", instructions: "You describe baked goods and never say one is safe." }],
          } satisfies NetworkConfig,
        },
      }),
    });
    await s.runtime.loadPeerNetwork(`${PEER}/agents/marrow_point`);

    expect(s.plans).toHaveLength(1);
    const item = s.plans[0]![0]!;
    expect(item.description).toBe("Fetch a published agent network from another site and read it here. It is read, not run.");
    expect(item.description).not.toContain("marrow_point");
    // The value the guest is approving is still shown to them, as an argument.
    expect(item.arguments).toEqual({ network: "marrow_point", base: `${PEER}/agents` });
  });

  /**
   * INVARIANT: the dialog renders the arguments in a node marked as not ours,
   * for the same reason the quoted block is. Model-chosen argument values are
   * enum-validated (LIMITS §2.2a), but `load_peer_network`'s are not, and the
   * next action added will not know either way.
   *
   * BREAKS IF: the arguments go back into a sentence, or lose the marker.
   */
  test("the dialog's arguments are rendered in a node marked as not the site's words", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const confirm = domConfirm(document, host);
    void confirm([
      {
        action: "add_to_cart",
        description: ours("Add a menu item to the order."),
        origin: "https://deli.example",
        effect: "write",
        arguments: { item: "reuben" },
      },
    ]);
    const marked = host.querySelector(`[${NOT_OURS}]`);
    expect(marked).not.toBeNull();
    expect(marked!.textContent).toContain("reuben");
    host.querySelector<HTMLButtonElement>("[data-confirm-no]")!.click();
  });
});

describe("pressing Load with nothing in the field says so", () => {
  /**
   * INVARIANT (fix round 2, minor 7): an empty reference clears the status. It
   * used to return early, leaving the previous "Loaded and validated …" on
   * screen as if it described the empty input.
   *
   * BREAKS IF: the early return stops writing a status.
   */
  test("an empty reference replaces the previous result rather than leaving it up", async () => {
    const s = await session();
    await s.runtime.loadPeerNetwork("/broken/cycle-b");
    expect(s.composeText()).toContain("Composition cycle refused");
    await s.runtime.loadPeerNetwork("   ");
    expect(s.composeText()).toContain("no network reference was given");
    expect(s.composeText()).not.toContain("Composition cycle refused");
    expect(s.runtime.composed()).toEqual([]);
  });
});
