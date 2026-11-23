/**
 * boot() — where the pure safety layer, the gate, the deli site and the published
 * artifacts become a running thing in a browser. OURS, written here.
 *
 * The order of operations below is the product's argument, in code:
 *
 *   1. The restriction picker and the verdict cards are wired FIRST, from the
 *      canonical menu and the pure checker. They need no manifest, no network, no
 *      router, no key and no model. Nothing that follows can stop them working.
 *   2. Only then does it try to load the published network and a router. Every
 *      failure from here on is reported in our own words and leaves (1) running.
 *
 * So a visitor with no key, or a broken manifest, or no network at all, still
 * gets the verdict beside every dish. A visitor with a key additionally gets a
 * model that may describe the menu and may not vouch for it.
 */

import type { Finding, Menu, Restriction } from "../../contracts.ts";
import { MENU, RESTRICTIONS } from "../safety/canon.ts";
import { registerSiteActions, checkSafety, type SiteContext } from "./actions.ts";
import { KeyStore, type StorageLike } from "./key-store.ts";
import { Router, SCRIPTED_ROUTER, SCRIPTS, missingKeyMessage } from "./llm.ts";
import { BudgetError, Conversation, CycleError, type Limits } from "./loop.ts";
import { Transcript } from "./transcript.ts";
import { renderVerdicts } from "./verdict-cards.ts";
import type { ConfirmItem, Manifest, NetworkConfig, Receipt, TraceEntry } from "./types.ts";
import { RuntimeMessage, TOKEN, joinSiteText, joinTokens, ours, quotedTokensOnly, siteText, tokenOrOmitted, type SiteText } from "./errors.ts";
import { DEFAULT_LIMITS } from "./limits.ts";
import { loadComposition, type ComposedNetwork } from "./composition.ts";
import { ActionRegistry, type ActionScope, type ConfirmFn } from "./upstream/action-registry.ts";
import { find_front_man } from "./upstream/graph.ts";
import { validate_network } from "./upstream/validation.ts";
import { manifestAllowsPeer, selectTopRouter } from "./upstream/router.ts";

export interface BootOptions {
  /** The document holding the deli site. Defaults to the mount's own. */
  doc?: Document;
  /** Site base the published artifacts are fetched from. Defaults to the page's directory. */
  base?: string;
  /** Which published network to run. Defaults to the manifest's first entry. */
  network?: string;
  fetchImpl?: typeof fetch;
  /** Where the visitor's key lives. `null` means nowhere, and the panel says so. */
  storage?: StorageLike | null;
  /** How the guest is asked before a committing action. Defaults to the panel's own dialog. */
  confirm?: ConfirmFn;
  limits?: Partial<Limits>;
  menu?: Menu;
  restrictions?: Restriction[];
  /** Origins the visitor has bound by hand, as upstream's `runtimeAllowedPeers`. */
  allowedPeers?: string[];
  /** Overrides for the committing checkout, so a test can make its outcome never arrive. */
  placeOrder?: SiteContext["placeOrder"];
  checkoutTimeoutMs?: number;
  now?: () => number;
}

export interface Runtime {
  /** The panel this runtime drew. */
  readonly panel: HTMLElement;
  /** The guest's current restriction selection. */
  selected(): Restriction[];
  /** Re-run the checker over the whole menu and repaint every card. Needs no model. */
  check(): Finding[];
  /** The checker's latest findings. */
  findings(): Finding[];
  /** Ask the network. Rejects only on a programming error; everything else is shown in the panel. */
  ask(text: string): Promise<void>;
  /** Every observable-execution record. Carries no credential; a test pins that. */
  trace(): TraceEntry[];
  /** The publisher's symbolic peer-network bindings for this network, from links.json. */
  links(): Record<string, string>;
  /** Fetch a public artifact from a peer origin, subject to the published peer policy. */
  fetchPeerArtifact(url: string): Promise<unknown>;
  /**
   * Load the network named by a §3.2 reference, and everything it composes.
   * Never rejects: every refusal is put on the page as a string, which is what
   * §6 asks for. Read the outcome from `[data-compose-status]` or `composed()`.
   */
  loadPeerNetwork(ref: string): Promise<void>;
  /** The networks the last load actually fetched and validated. Empty after a refusal. */
  composed(): ComposedNetwork[];
  /** The router this runtime resolved, or null when it could not start one. */
  readonly router: Router | null;
  readonly manifest: Manifest | null;
  readonly network: NetworkConfig | null;
  readonly conversation: Conversation | null;
  /** A write that began and whose outcome never came back. */
  outstanding(): Receipt | null;
  keyStore: KeyStore;
}

/**
 * A public agent artifact is fetched with no ambient credentials: no cookies, no
 * Authorization header (spec L322-324, "Public artifact requests MUST NOT include
 * the caller's private credentials"). The visitor's provider key is not in scope
 * here and could not be attached even by accident — this function cannot see it.
 */
export async function fetchPublicArtifact(url: string, fetchImpl: typeof fetch): Promise<unknown> {
  const resp = await fetchImpl(url, { credentials: "omit", cache: "no-store", headers: { Accept: "application/json" } });
  if (!resp.ok) throw new Error(`${url} returned HTTP ${resp.status}.`);
  return resp.json();
}

/**
 * The publisher's symbolic-name bindings for this network, from links.json.
 * Best effort: a site with no peers need not publish the file, and a missing one
 * is not a startup failure. Same no-credentials rule as every public artifact.
 */
export async function loadPublishedLinks(base: string, networkName: string, fetchImpl: typeof fetch): Promise<Record<string, string>> {
  try {
    const doc = (await fetchPublicArtifact(`${base}/links.json`, fetchImpl)) as {
      networks?: Record<string, Record<string, string>>;
    };
    return doc?.networks?.[networkName] ?? {};
  } catch {
    return {};
  }
}

/** The directory the page sits in, which is where its published artifacts live. */
function pageBase(doc: Document): string {
  try {
    const url = new URL(doc.baseURI);
    url.search = "";
    url.hash = "";
    url.pathname = url.pathname.replace(/[^/]*$/, "");
    return url.toString().replace(/\/$/, "");
  } catch {
    return "";
  }
}

function el<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  attrs: Record<string, string> = {},
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = doc.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (text !== undefined) node.textContent = text;
  return node;
}

export async function boot(mount: HTMLElement, opts: BootOptions = {}): Promise<Runtime> {
  const doc = opts.doc ?? mount.ownerDocument;
  const menu = opts.menu ?? MENU;
  const restrictions = opts.restrictions ?? RESTRICTIONS;
  const fetchImpl = opts.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const base = (opts.base ?? pageBase(doc)).replace(/\/$/, "");
  const now = opts.now ?? Date.now;
  const keyStore = new KeyStore(opts.storage === undefined ? undefined : opts.storage);
  const trace: TraceEntry[] = [];
  const runtimeAllowedPeers = new Set((opts.allowedPeers ?? []).map((o) => o.replace(/\/$/, "")));

  /* ---------------- the panel ---------------- */

  const panel = el(doc, "section", { class: "vouch-panel", "data-agent-panel": "" });
  panel.append(
    el(doc, "h2", {}, "Ask about the menu"),
    el(
      doc,
      "p",
      { class: "panel-note" },
      "An assistant here can describe dishes, read what you avoid and propose an order. " +
        "It is not allowed to tell you whether something is safe to eat. That verdict is worked out on this " +
        "page from the published ingredient list and shown beside each dish, and it works whether or not you " +
        "ever type anything here.",
    ),
  );

  // --- restrictions: the path to a verdict that involves no model at all ---
  const fs = el(doc, "fieldset", { class: "restrictions", "data-restrictions": "" });
  fs.append(el(doc, "legend", {}, "What do you need to avoid?"));
  const boxes: HTMLInputElement[] = [];
  for (const r of restrictions) {
    const label = el(doc, "label", { class: "restriction" });
    const box = el(doc, "input", { type: "checkbox", value: r.id, "data-restriction": r.id });
    boxes.push(box);
    label.append(box, el(doc, "span", {}, r.name));
    fs.append(label);
  }
  const verdictStatus = el(doc, "p", { class: "verdict-status", "data-verdict-status": "", role: "status" });
  fs.append(verdictStatus);
  panel.append(fs);

  // --- model settings, including the delete affordance the spec requires ---
  const settings = el(doc, "details", { class: "model-settings", "data-model-settings": "" });
  settings.append(el(doc, "summary", {}, "AI model settings (bring your own key)"));
  settings.append(
    el(
      doc,
      "p",
      { class: "byok-note" },
      "This site ships no model and no key, and pays for no inference. If you want the assistant, supply your " +
        "own provider key. It is kept in this browser only, is sent only to the provider you choose, and you can " +
        "delete it below at any time. Note that storage in this browser is not protection from other scripts " +
        "running on this page; we load none.",
    ),
  );
  const keyLabel = el(doc, "label", { class: "field" });
  const keyInput = el(doc, "input", {
    type: "password",
    autocomplete: "off",
    spellcheck: "false",
    "data-key-input": "",
    placeholder: "Your provider API key",
  });
  keyLabel.append(el(doc, "span", {}, "Provider key"), keyInput);
  const routerLabel = el(doc, "label", { class: "field" });
  const routerInput = el(doc, "input", { type: "url", "data-router-input": "", placeholder: "Leave blank to use the published route" });
  routerLabel.append(el(doc, "span", {}, "Router base URL"), routerInput);
  const modelLabel = el(doc, "label", { class: "field" });
  const modelInput = el(doc, "input", { type: "text", "data-model-input": "", placeholder: "Leave blank to use the network's model" });
  modelLabel.append(el(doc, "span", {}, "Model"), modelInput);
  const saveBtn = el(doc, "button", { type: "button", "data-key-save": "" }, "Save");
  const forgetBtn = el(doc, "button", { type: "button", class: "forget", "data-key-forget": "" }, "Delete my key from this browser");
  const replayLabel = el(doc, "label", { class: "field field-inline" });
  const replayBox = el(doc, "input", { type: "checkbox", "data-replay": "" });
  replayLabel.append(replayBox, el(doc, "span", {}, "Replay a recorded reply instead of calling a model"));
  const scriptSelect = el(doc, "select", { "data-script": "" });
  for (const s of SCRIPTS) scriptSelect.append(el(doc, "option", { value: s.id }, s.label));
  const keyStatus = el(doc, "p", { class: "key-status", "data-key-status": "", role: "status" });
  settings.append(keyLabel, routerLabel, modelLabel, saveBtn, forgetBtn, replayLabel, scriptSelect, keyStatus);
  panel.append(settings);

  /* ---------------- composing a published network, and refusing one ---------------- */

  /**
   * §6's seventh interoperability check, as a control a judge can press.
   *
   * Three of the five refusals this build must demonstrate — an invalid network,
   * a composition cycle and a denied origin — are properties of *loading* a
   * network, not of a conversation, so there was nowhere on the page they could
   * appear. They appear here, as a string, which is the requirement: a thrown
   * exception only a console sees demonstrates nothing to someone watching a
   * browser.
   *
   * Deliberately NOT a collapsed `<details>`: a refusal hidden behind a disclosure
   * triangle is a refusal nobody sees.
   */
  const compose = el(doc, "fieldset", { class: "compose", "data-compose": "" });
  compose.append(el(doc, "legend", {}, "Load a published agent network"));
  compose.append(
    el(
      doc,
      "p",
      { class: "panel-note" },
      "A network is named by a URL whose last path component is its name. This site publishes three deliberately " +
        "broken ones so that the refusals can be watched rather than taken on trust: /broken/invalid (its " +
        "metadata.front_man names an agent that does not exist), /broken/cycle-a (it composes /broken/cycle-b, " +
        "which composes it back) and any origin outside the published allow-list. Nothing here affects the menu or " +
        "the verdicts.",
    ),
  );
  const composeLabel = el(doc, "label", { class: "field" });
  const composeInput = el(doc, "input", {
    type: "text",
    "data-compose-input": "",
    placeholder: "/broken/cycle-a",
    "aria-label": "Network reference to load",
  });
  composeLabel.append(el(doc, "span", {}, "Network reference"), composeInput);
  const composeBtn = el(doc, "button", { type: "button", "data-compose-load": "" }, "Load");
  const composeStatus = el(doc, "p", { class: "compose-status", "data-compose-status": "", role: "alert" }, "Nothing loaded.");
  compose.append(composeLabel, composeBtn, composeStatus);
  panel.append(compose);

  // --- transcript, refusals, outstanding write, the ask form ---
  const log = el(doc, "div", { class: "transcript", "data-transcript": "" });
  const refusalPanel = el(doc, "div", { class: "refusals", "data-refusal-panel": "", hidden: "" });
  const outcomePanel = el(doc, "div", { class: "outcome", "data-outcome": "", hidden: "" });
  const confirmPanel = el(doc, "div", { class: "confirm", "data-confirm": "", hidden: "" });
  const form = el(doc, "form", { class: "ask", "data-ask": "" });
  const askInput = el(doc, "input", {
    type: "text",
    "data-ask-input": "",
    placeholder: "I'm lactose intolerant — what is on the menu?",
    "aria-label": "Ask about the menu",
  });
  const askBtn = el(doc, "button", { type: "submit", "data-ask-send": "" }, "Ask");
  const resetBtn = el(doc, "button", { type: "button", class: "reset", "data-new-conversation": "" }, "New conversation");
  form.append(askInput, askBtn, resetBtn);
  /**
   * Standing chrome, not a sentence the model produces each turn.
   *
   * The published agent instructions tell every agent to say that the site's
   * checker shows its verdict beside each dish. The gate withholds exactly that
   * sentence once the menu has been mentioned (LIMITS.md §2.1), and the controller
   * ruled that anything which must ALWAYS be true should not be said by the model
   * at all. So it is said here, once, where it is always on screen and always
   * true, rather than generated per turn and then withheld.
   */
  const standing = el(
    doc,
    "p",
    { class: "standing-note", "data-standing-note": "", role: "note" },
    "The assistant does not decide whether food is safe for you, and is not permitted to. " +
      "The verdict beside each dish is this site's own, worked out from the published ingredient list. " +
      "Read that, not the reply.",
  );
  const errorLine = el(doc, "p", { class: "runtime-error", "data-runtime-error": "", role: "alert", hidden: "" });
  const traceBox = el(doc, "details", { class: "trace", "data-trace": "" });
  traceBox.append(el(doc, "summary", {}, "What this ran"));
  const traceList = el(doc, "ol", { "data-trace-list": "" });
  traceBox.append(traceList);
  panel.append(log, refusalPanel, outcomePanel, confirmPanel, standing, form, errorLine, traceBox);
  mount.append(panel);



  /* ---------------- the verdict path: no model involved ---------------- */

  const selected = (): Restriction[] => restrictions.filter((r) => boxes.some((b) => b.value === r.id && b.checked));

  /**
   * The guest's verdict state. The ONLY thing that writes it is `check()`, and the
   * only things that call `check()` are a checkbox `change` event and
   * `Runtime.check()` — both of which read `selected()` and nothing else.
   *
   * No model-reachable code path appears below this line. It cannot: `renderVerdicts`
   * takes the guest's restriction list, not a `Finding[]`, so there is no signature
   * through which a model-requested check could write a card, and `SiteContext` no
   * longer carries a display callback for an action handler to call.
   */
  let findings: Finding[] = [];

  function check(): Finding[] {
    const chosen = selected();
    findings = renderVerdicts(doc, chosen, menu, restrictions);
    if (chosen.length === 0) {
      verdictStatus.textContent =
        "Nothing is being checked yet. Tick what you avoid and a verdict appears beside every dish — no account, no key, no assistant.";
      return findings;
    }
    const counts = { unsafe: 0, unknown: 0, safe: 0 };
    for (const f of findings) {
      if (f.verdict === "unsafe") counts.unsafe += 1;
      else if (f.verdict === "unknown") counts.unknown += 1;
      else counts.safe += 1;
    }
    // Describes the restriction set these findings were actually computed against,
    // which is the guest's, because it is the only one that can get here.
    verdictStatus.textContent =
      `Checked ${findings.length} ${findings.length === 1 ? "dish" : "dishes"} against ${chosen.map((r) => r.name).join(", ")}: ` +
      `${counts.unsafe} unsafe, ${counts.unknown} we cannot tell, ${counts.safe} with no conflict found. ` +
      `Each verdict is shown beside its dish, with the ingredient that decided it.`;
    return findings;
  }

  const ctx: SiteContext = {
    doc,
    menu,
    restrictions,
    selected,
    ...(opts.placeOrder ? { placeOrder: opts.placeOrder } : {}),
    ...(opts.checkoutTimeoutMs !== undefined ? { checkoutTimeoutMs: opts.checkoutTimeoutMs } : {}),
  };

  // Constructed here, after `selected`, so the refusal panel's cards are computed
  // from the guest's selection like every other card.
  const transcript = new Transcript(doc, log, refusalPanel, menu, restrictions, selected);

  for (const box of boxes) box.addEventListener("change", () => check());
  check();

  /* ---------------- the registry and the four actions ---------------- */

  const registry = new ActionRegistry();
  const addTrace = (entry: TraceEntry): void => {
    trace.push(entry);
    const li = el(doc, "li", { "data-trace-event": entry.event });
    // Rendered through `renderableDetail`, which is a SECOND net. Each trace call
    // site is already responsible for not putting model-chosen prose in a detail
    // (see loop.ts's `declaredKeys` and `refusalKind`), but the trace is a page
    // surface and a future call site will forget. This one refuses to print any
    // string that is not token-shaped or on the allow-list, so forgetting costs a
    // "<text omitted>" rather than an ungated sentence in the DOM.
    li.textContent = `${entry.event} — ${JSON.stringify(renderableDetail(entry.detail))}`;
    traceList.append(li);
  };

  const confirm: ConfirmFn = opts.confirm ?? domConfirm(doc, confirmPanel);

  /* ---------------- everything below may fail without breaking the above ---------------- */

  const fail = (message: SiteText): void => {
    errorLine.textContent = message;
    errorLine.removeAttribute("hidden");
    askInput.disabled = true;
    askBtn.disabled = true;
  };

  /** Which startup step we reached, for the trace. One of a fixed set of words. */
  let startupStage = "manifest";
  let manifest: Manifest | null = null;
  let network: NetworkConfig | null = null;
  let links: Record<string, string> = {};
  let router: Router | null = null;
  let conversation: Conversation | null = null;
  let scope: ActionScope | null = null;

  const showOutstanding = (r: Receipt, action = "checkout_demo_order"): void => {
    // Deliberately the same vocabulary, and the same classes, as an unknown
    // verdict card. "We don't know" is this product's answer to a missing
    // ingredient list and to a write whose result never came back, and a judge
    // should be able to see that it is the same answer.
    outcomePanel.replaceChildren();
    const card = el(doc, "div", { class: "verdict verdict-unknown", "data-verdict": "unknown", "data-outcome-unknown": "", role: "alert" });
    const head = el(doc, "p", { class: "verdict-head" });
    head.append(el(doc, "span", { class: "verdict-mark", "aria-hidden": "true" }, "?"), el(doc, "strong", {}, "We don't know"));
    card.append(
      head,
      el(
        doc,
        "p",
        { class: "verdict-reason" },
        action === "checkout_demo_order"
          ? `The order was started and its result never came back, so we cannot tell you whether it went through. ` +
            `It has NOT been tried again, and it will not be: repeating a write we cannot account for could place ` +
            `a second order. Check your order before trying once more yourself.`
          : `"${action}" was started and its result never came back, so we cannot tell you whether it took effect. ` +
            `It has NOT been tried again, and it will not be: repeating something we cannot account for could do it twice. ` +
            `Check your order before trying once more yourself.`,
      ),
      // `r.error` is a handler's message. Ours all interpolate enum-validated ids,
      // but the next handler added will not know that, so it is filtered here.
      el(doc, "p", { class: "verdict-source" }, siteText`Request ${r.requestId}. ${r.error ?? ""}`.trim()),
    );
    outcomePanel.append(card);
    outcomePanel.removeAttribute("hidden");
  };

  /**
   * Load a published network by its §3.2 reference, and put the outcome — a
   * refusal or a summary of what was loaded — on screen either way.
   *
   * Wired here, OUTSIDE the startup `try`, on purpose: it has to work when the
   * startup failed. A visitor whose manifest is unreachable can still watch this
   * runtime refuse a cycle, and with `manifest` null the allow-list is empty, so
   * cross-origin contact is refused rather than silently permitted.
   */
  const showCompose = (message: SiteText, kind: "refused" | "loaded"): void => {
    composeStatus.textContent = message;
    composeStatus.setAttribute("data-compose-kind", kind);
    composeStatus.removeAttribute("hidden");
  };

  let composed: ComposedNetwork[] = [];

  async function loadPeerNetwork(ref: string): Promise<void> {
    const wanted = ref.trim();
    if (!wanted) return;
    composeBtn.disabled = true;
    try {
      composed = await loadComposition(wanted, {
        siteBase: base,
        manifest,
        runtimeAllowedPeers,
        fetchArtifact: (url) => fetchPublicArtifact(url, fetchImpl),
        confirm,
        trace: addTrace,
        now,
        maxComposedNetworks: opts.limits?.maxComposedNetworks ?? DEFAULT_LIMITS.maxComposedNetworks,
      });
      const names = joinTokens(composed.map((c) => c.ref.name), ", ");
      showCompose(
        joinSiteText(
          siteText`Loaded and validated ${composed.length} published network`,
          ours(composed.length === 1 ? ": " : "s: "),
          names,
          ours(
            composed.length === 1
              ? ". It has not been run: binding another site's network into the conversation is not part of this build."
              : ". None of them has been run: binding another site's network into the conversation is not part of this build.",
          ),
        ),
        "loaded",
      );
    } catch (err) {
      // Same rule as the transcript and the startup line: only a message this
      // runtime wrote is shown in the deli's voice. A peer's malformed JSON
      // throws a SyntaxError that quotes the file, and an unreachable host
      // throws a TypeError; neither is ours to repeat.
      composed = [];
      showCompose(
        err instanceof RuntimeMessage
          ? err.siteMessage
          : siteText`Refused: that network could not be loaded (${(err as Error)?.name ?? "Error"}), so nothing was run.`,
        "refused",
      );
      addTrace({ at: now(), event: "composition_refused", detail: { kind: (err as Error)?.name ?? "Error" } });
    } finally {
      composeBtn.disabled = false;
    }
  }

  composeBtn.addEventListener("click", () => {
    void loadPeerNetwork(composeInput.value);
  });

  try {
    const manifestUrl = `${base}/agent-manifest.json`;
    manifest = (await fetchPublicArtifact(manifestUrl, fetchImpl)) as Manifest;
    addTrace({ at: now(), event: "manifest_loaded", detail: { url: manifestUrl, networks: (manifest.networks ?? []).map((n) => n.name) } });

    const entry = opts.network
      ? (manifest.networks ?? []).find((n) => n.name === opts.network)
      : (manifest.networks ?? [])[0];
    if (!entry) {
      // Fail closed: never silently run a different published network.
      throw new RuntimeMessage(
        siteText`No published network named '${opts.network ?? "(first)"}' in ${manifestUrl}; refusing to run a different one.`,
      );
    }

    const hoconUrl = new URL(entry.hocon, `${base}/`).toString();
    startupStage = "network";
    network = (await fetchPublicArtifact(hoconUrl, fetchImpl)) as NetworkConfig;
    const errors = validate_network(network).map(quotedTokensOnly);
    if (errors.length > 0) {
      // §6: an invalid network is stopped with visible errors, not a blank page.
      throw new RuntimeMessage(
        (siteText`The published network at ${hoconUrl} is not valid and was not run:` + `\n• ${errors.join("\n• ")}`) as SiteText,
      );
    }
    const front = find_front_man(network);
    if (!front) throw new RuntimeMessage(siteText`The published network at ${hoconUrl} declares no front agent.`);
    if (front !== entry.front_man) {
      // The manifest says one thing and the positional rule says another. Both are
      // published, so a visitor cannot tell which a runtime will honour. Refuse.
      throw new RuntimeMessage(
        siteText`The manifest names '${entry.front_man}' as the front agent, but the network's first instructed agent is '${front}'. Those must agree before this network can be run.`,
      );
    }
    addTrace({ at: now(), event: "network_loaded", detail: { url: hoconUrl, frontMan: front, agents: (network.tools ?? []).length } });

    // The publisher's peer-network link map (§3.3). Our network uses no symbolic
    // external reference yet, so this resolves to {}; it is loaded anyway because
    // it is one of the three public artifacts, it is fetched under the same
    // no-credentials rule as the other two, and Task 8's peer binding arrives here.
    startupStage = "links";
    links = await loadPublishedLinks(base, entry.name, fetchImpl);
    addTrace({ at: now(), event: "links_loaded", detail: { network: entry.name, bindings: Object.keys(links) } });

    scope = { base: base || "https://localhost", network: entry.name };
    startupStage = "actions";
    registerSiteActions(registry, scope, ctx);
    const declared = manifest.actions ?? [];
    const mismatch = reconcileActions(registry, scope, declared);
    if (mismatch.length > 0) {
      // A declared action that does not exist, or a `commits` flag that lies, is
      // worse than publishing nothing. Refuse to run the agent at all.
      throw new RuntimeMessage(
        (ours("The published action catalog and this runtime disagree, so the assistant was not started:") +
          `\n• ${mismatch.map(quotedTokensOnly).join("\n• ")}`) as SiteText,
      );
    }
    for (const name of registry.catalog(scope).map((e) => e.name)) {
      if ((network.tools ?? []).some((a) => a.name === name)) {
        throw new RuntimeMessage(
          siteText`'${name}' is both a registered site action and an agent in the network. Refusing to run an ambiguous catalog.`,
        );
      }
    }
    addTrace({
      at: now(),
      event: "actions_registered",
      detail: { actions: registry.catalog(scope).map((e) => ({ name: e.name, effect: e.effect, commits: e.commits })) },
    });

    const profile = keyStore.read();
    if (profile) {
      keyInput.value = profile.key;
      if (profile.router) routerInput.value = profile.router;
      if (profile.model) modelInput.value = profile.model;
    }

    const startRouter = (): Router | null => {
      if (!manifest || !network || !scope) return null;
      const stored = keyStore.read();
      const key = stored?.key ?? "";
      const override = replayBox.checked ? SCRIPTED_ROUTER : (routerInput.value.trim() || stored?.router || "");
      const model = modelInput.value.trim() || stored?.model || network.llm_config?.model_name || "";
      let selectedRoute;
      try {
        selectedRoute = selectTopRouter(manifest, override, key, modelInput.value.trim());
      } catch (err) {
        // `selectTopRouter` is upstream's; its message is ours by adoption, but it
        // is still filtered rather than trusted.
        keyStatus.textContent =
          err instanceof RuntimeMessage
            ? err.siteMessage
            : siteText`This site publishes no usable AI provider route for the key you supplied.`;
        return null;
      }
      const next = new Router({
        baseUrl: selectedRoute.baseUrl,
        apiKey: key,
        model: model || "gpt-4o-mini",
        fetchImpl,
        onTrace: addTrace,
        scriptId: scriptSelect.value || SCRIPTS[0]!.id,
        now,
      });
      addTrace({
        at: now(),
        event: "router_selected",
        detail: {
          baseUrl: next.baseUrl,
          upgradedToByok: selectedRoute.upgradedToByok,
          model: next.model,
          // Presence, never the value. Upstream's pattern.
          keySource: key ? "local BYOK (not shown)" : "none",
          replayed: next.scripted,
        },
      });
      keyStatus.textContent = next.scripted
        ? ours("Replaying a recorded reply. No model is called and no key is used. The gate, the checker and the verdict cards all run for real.")
        : next.needsKey
          ? missingKeyMessage(next.baseUrl)
          : siteText`Ready. Requests go to ${next.baseUrl} with your key, and nowhere else.`;
      // A setup error behind a closed disclosure triangle is a setup error nobody
      // reads. §3.4 calls for a CLEAR one, so the disclosure opens itself when
      // there is something to act on. It is never closed from here: a visitor who
      // closed it has decided.
      if (next.needsKey) settings.open = true;
      return next;
    };

    const rebuild = (): void => {
      router = startRouter();
      if (!router || !network || !scope) return;
      conversation = new Conversation({
        config: network,
        router,
        registry,
        scope,
        transcript,
        findings: () => findings,
        confirm,
        trace: addTrace,
        ...(opts.limits ? { limits: opts.limits } : {}),
        now,
        onReceipts: (name, receipts) => {
          if (!receipts) return;
          for (const r of receipts) {
            if (r.status === "unknown") showOutstanding(r, name);
            else if (r.status === "succeeded" && name === "checkout_demo_order") {
              transcript.showRuntime(ours("Your demo order is in. No payment was taken and no food is being made."), "receipt");
            }
          }
        },
      });
    };

    rebuild();

    saveBtn.addEventListener("click", () => {
      const key = keyInput.value.trim();
      if (!keyStore.available) {
        keyStatus.textContent = ours("This browser will not let this site store anything, so a key cannot be kept here.");
        return;
      }
      if (key) {
        const prof: Parameters<KeyStore["save"]>[0] = { key };
        if (routerInput.value.trim()) prof.router = routerInput.value.trim();
        if (modelInput.value.trim()) prof.model = modelInput.value.trim();
        keyStore.save(prof);
      }
      rebuild();
    });

    forgetBtn.addEventListener("click", () => {
      keyStore.forget();
      keyInput.value = "";
      // Rebuild first: starting a keyless router rewrites the status line, and the
      // visitor should be left reading what happened to their key, not a setup error.
      rebuild();
      keyStatus.textContent = ours(
        "Your key has been deleted from this browser. The verdict beside each dish is unaffected: it never needed a model.",
      );
    });

    resetBtn.addEventListener("click", () => {
      rebuild();
      log.replaceChildren();
      refusalPanel.replaceChildren();
      refusalPanel.setAttribute("hidden", "");
      outcomePanel.replaceChildren();
      outcomePanel.setAttribute("hidden", "");
      transcript.showRuntime(ours("New conversation. The verdict beside each dish is unchanged: it never depended on the conversation."), "reset");
    });

    replayBox.addEventListener("change", () => rebuild());
    scriptSelect.addEventListener("change", () => rebuild());
  } catch (err) {
    // Same rule as the transcript: only a message this runtime wrote is shown in
    // the site's voice. A malformed artifact throws a SyntaxError whose message
    // quotes the file; that is not ours to repeat.
    const message =
      err instanceof RuntimeMessage
        ? err.siteMessage
        : siteText`The agent could not be started (${(err as Error)?.name ?? "Error"} while loading the ${startupStage}).`;
    fail((message + "\n\nThe menu, the ingredient lists and the safety verdicts on this page are unaffected: they are worked out here and never call a model.") as SiteText);
    addTrace({ at: now(), event: "startup_failed", detail: { stage: startupStage, kind: (err as Error)?.name ?? "Error" } });
  }

  /* ---------------- asking ---------------- */

  async function ask(text: string): Promise<void> {
    if (!text.trim()) return;
    if (!conversation || !router) {
      transcript.showRuntime(
        ours("The assistant is not running, so there is nobody to ask. The verdict beside each dish still works."),
        "error",
      );
      return;
    }
    if (router.needsKey) {
      transcript.showUser(text);
      transcript.showRuntime(missingKeyMessage(router.baseUrl), "error");
      return;
    }
    askBtn.disabled = true;
    try {
      router.resetScript();
      await conversation.send(text);
    } catch (err) {
      // Only errors THIS runtime produced are rendered. Anything else - a parse
      // failure on a provider response, a handler we did not write - gets our own
      // sentence instead of its message. The transcript labels a runtime line
      // "Hollis & Rye", and the deli does not repeat text it cannot vouch for.
      if (err instanceof BudgetError || err instanceof CycleError || err instanceof RuntimeMessage) {
        transcript.showRuntime(err.siteMessage, "error");
        if (err instanceof BudgetError) {
          addTrace({ at: now(), event: "budget_stopped", detail: { budget: err.budget, limit: err.limit } });
        } else if (err instanceof CycleError) {
          addTrace({ at: now(), event: "budget_stopped", detail: { cycle: true } });
        }
      } else {
        transcript.showRuntime(
          ours(
            "Something went wrong talking to the model router, and the reply was not shown. " +
              "The details are under \u201cWhat this ran\u201d. The verdict beside each dish is unaffected.",
          ),
          "error",
        );
        addTrace({ at: now(), event: "turn_failed", detail: { kind: (err as Error)?.name ?? "Error" } });
      }
    } finally {
      askBtn.disabled = false;
      const out = conversation.outstanding;
      if (out) showOutstanding(out);
    }
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = askInput.value;
    askInput.value = "";
    void ask(text);
  });

  return {
    panel,
    selected,
    check,
    findings: () => findings,
    ask,
    trace: () => trace,
    links: () => links,
    loadPeerNetwork,
    composed: () => composed,
    async fetchPeerArtifact(url: string): Promise<unknown> {
      if (!manifestAllowsPeer(url, manifest, runtimeAllowedPeers)) {
        const origin = (() => {
          try {
            return new URL(url).origin;
          } catch {
            return url;
          }
        })();
        addTrace({ at: now(), event: "peer_refused", detail: { url, origin } });
        throw new Error(`Policy: ${origin} is not an allowed peer of this site, so it was not contacted.`);
      }
      addTrace({ at: now(), event: "peer_fetch", detail: { url, credentials: "omit" } });
      return fetchPublicArtifact(url, fetchImpl);
    },
    get router() {
      return router;
    },
    get manifest() {
      return manifest;
    },
    get network() {
      return network;
    },
    get conversation() {
      return conversation;
    },
    outstanding: () => conversation?.outstanding ?? null,
    keyStore,
  };
}

/**
 * Moved to `errors.ts`, beside `TOKEN`, when the composition loader became a
 * second caller. Re-exported here so its original import path still resolves.
 */
export { quotedTokensOnly } from "./errors.ts";

/**
 * Strings our own code puts in a trace detail that are legitimately prose.
 * Everything else must be token-shaped (no whitespace) to be rendered.
 */
const SAFE_TRACE_TEXT = new Set(["local BYOK (not shown)", "none", "<text omitted>"]);

/**
 * A trace detail with every string that could be prose replaced. Recursive, because
 * details nest (`arguments`, `argumentKeys`, `actions`). Numbers and booleans pass
 * through: they cannot carry a sentence.
 */
export function renderableDetail(value: unknown): unknown {
  if (typeof value === "string") {
    return SAFE_TRACE_TEXT.has(value) || TOKEN.test(value) ? value : "<text omitted>";
  }
  if (Array.isArray(value)) return value.map(renderableDetail);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      // A KEY can be model-chosen too (a trace of an arguments object).
      out[TOKEN.test(k) ? k : "<key omitted>"] = renderableDetail(v);
    }
    return out;
  }
  return value;
}

/**
 * Does the published `actions` catalog describe what the runtime actually has?
 * Checked in BOTH directions, and on the `commits` flag, because a flag that
 * lies is what would let a committing action run without asking.
 */
export function reconcileActions(
  registry: ActionRegistry,
  scope: ActionScope,
  declared: { name: string; purpose?: string; commits?: boolean }[],
): string[] {
  const problems: string[] = [];
  const live = registry.catalog(scope);
  const liveNames = live.map((e) => e.name);
  const declaredNames = declared.map((d) => d.name);
  for (const d of declared) {
    const entry = live.find((e) => e.name === d.name);
    if (!entry) {
      problems.push(`'${d.name}' is declared in agent-manifest.json but is not registered by this runtime.`);
      continue;
    }
    // Two links in one chain, and both have to hold:
    //   what we PUBLISH  ===  what the registry RECORDS  ===  when the guest is ASKED.
    // Checking only the first two would let an action be declared and recorded as
    // committing while the runtime quietly dispatched it without asking.
    if (d.commits !== entry.commits) {
      problems.push(`'${d.name}' is declared commits=${String(d.commits)} but the runtime records it as commits=${String(entry.commits)}.`);
    }
    const asksFirst = entry.effect !== "read";
    if (entry.commits !== asksFirst) {
      problems.push(
        `'${d.name}' is recorded as commits=${String(entry.commits)} but its effect '${entry.effect}' means the guest ` +
          `${asksFirst ? "is" : "is not"} asked before it runs. Those must agree.`,
      );
    }
  }
  for (const name of liveNames) {
    if (!declaredNames.includes(name)) problems.push(`'${name}' is registered by this runtime but is not declared in agent-manifest.json.`);
  }
  return problems;
}

/**
 * The confirmation dialog. The runtime owns confirmation, not the model: this
 * shows the action, its origin, its effect and its exact arguments, and nothing
 * is dispatched until the guest presses a button here.
 */
export function domConfirm(doc: Document, host: HTMLElement): ConfirmFn {
  return (plan: ConfirmItem[]) =>
    new Promise<boolean>((resolve) => {
      host.replaceChildren();
      host.append(el(doc, "p", { class: "confirm-head" }, plan.length === 1 ? "Approve this?" : `Approve these ${plan.length} steps?`));
      const ul = el(doc, "ul");
      for (const p of plan) {
        const li = el(doc, "li", { "data-confirm-action": p.action });
        li.append(
          el(doc, "strong", {}, p.action),
          el(
            doc,
            "span",
            {},
            ` — ${p.description} Destination: ${p.origin}. This ${p.effect === "read" ? "reads only" : p.effect === "irreversible" ? "cannot be undone" : "changes your order"}.`,
          ),
          el(doc, "code", {}, JSON.stringify(p.arguments)),
        );
        ul.append(li);
      }
      host.append(ul);
      const yes = el(doc, "button", { type: "button", "data-confirm-yes": "" }, "Yes, do it");
      const no = el(doc, "button", { type: "button", "data-confirm-no": "" }, "No");
      const finish = (answer: boolean): void => {
        host.replaceChildren();
        host.setAttribute("hidden", "");
        resolve(answer);
      };
      yes.addEventListener("click", () => finish(true));
      no.addEventListener("click", () => finish(false));
      host.append(yes, no);
      host.removeAttribute("hidden");
    });
}
