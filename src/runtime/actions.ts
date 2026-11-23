/**
 * The four site actions Hollis & Rye registers with the runtime. OURS, written
 * here. This file is where the entry's idea lives, so none of it is adapted.
 *
 * The names, purposes and `commits` flags are already published in
 * `public/agent-manifest.json`. They are the public contract; boot.ts
 * cross-checks this file against that file at start-up and refuses to run if the
 * two disagree, because a declared action that does not exist, or a `commits`
 * flag that lies, is worse than publishing nothing at all.
 *
 * THE POINT OF `check_safety`
 *
 * The agent network can REQUEST a verdict. It can never produce one. No agent's
 * `tools` list reaches a verdict by any route (pinned in tests/artifacts.test.ts);
 * the only way to one is this registered site action, whose handler calls
 * `verdictFor` — a pure function over published ingredient data — and hands back
 * its `Finding` unaltered. The model's part is asking. The answer is the
 * checker's, and it goes to the dish's own verdict card as well as to the model.
 */

import type { Finding, Menu, MenuItem, Restriction } from "../../contracts.ts";
import { MENU, RESTRICTIONS } from "../safety/canon.ts";
import { verdictFor } from "../safety/verdict.ts";
import { containsLine, ingredientNames } from "../site/shop.ts";
import type { ActionDefinition, ActionRegistry, ActionScope } from "./upstream/action-registry.ts";

/** What the actions need from the page and from the session. */
export interface SiteContext {
  doc: Document;
  menu: Menu;
  /** Every published restriction. */
  restrictions: Restriction[];
  /** What the guest has currently selected, which is what `check_safety` defaults to. */
  selected: () => Restriction[];
  /** Called with each fresh set of findings, so the verdict cards can be rendered. */
  onFindings: (findings: Finding[]) => void;
  /**
   * Perform the demo order and return its receipt. The default clicks the site's
   * own checkout button and reads the confirmation back out of the DOM, because a
   * write that reports success without being read back has not been verified.
   * Overridable so that a test can make the outcome never arrive.
   */
  placeOrder?: (signal: AbortSignal) => Promise<{ summary: string }>;
  /** How long the committing checkout may take before its outcome is unknown. */
  checkoutTimeoutMs?: number;
}

const itemById = (menu: Menu, id: string): MenuItem | undefined => menu.items.find((i) => i.id === id);

/* ------------------------------------------------------------------ */
/* check_safety: the checker, and the only authority on a verdict      */
/* ------------------------------------------------------------------ */

export interface CheckSafetyArgs {
  items?: string[];
  restrictions?: string[];
}

/**
 * Resolve the restriction ids an action was given, failing closed on anything
 * unrecognised. Silently dropping an id the guest asked about would turn "we did
 * not check that" into an unqualified verdict, which is the single worst thing
 * this code could do.
 */
export function resolveRestrictions(ids: string[] | undefined, all: Restriction[], fallback: Restriction[]): Restriction[] {
  if (ids === undefined) return fallback;
  const out: Restriction[] = [];
  for (const id of ids) {
    const found = all.find((r) => r.id === id);
    if (!found) {
      throw new Error(`'${id}' is not a restriction this site publishes. The published ids are: ${all.map((r) => r.id).join(", ")}.`);
    }
    out.push(found);
  }
  return out;
}

export function resolveItems(ids: string[] | undefined, menu: Menu): MenuItem[] {
  if (ids === undefined) return menu.items;
  return ids.map((id) => {
    const item = itemById(menu, id);
    if (!item) throw new Error(`'${id}' is not an item on this menu.`);
    return item;
  });
}

/** The verdict, from the pure layer, unaltered. */
export function checkSafety(args: CheckSafetyArgs, ctx: SiteContext): { findings: Finding[]; checked: string[] } {
  const restrictions = resolveRestrictions(args.restrictions, ctx.restrictions, ctx.selected());
  const items = resolveItems(args.items, ctx.menu);
  const findings = items.map((item) => verdictFor(item, restrictions, ctx.menu));
  ctx.onFindings(findings);
  return { findings, checked: restrictions.map((r) => r.id) };
}

/* ------------------------------------------------------------------ */
/* get_menu_state: published data, no verdict anywhere in it           */
/* ------------------------------------------------------------------ */

export function menuState(ctx: SiteContext): {
  items: { id: string; name: string; price: number; ingredients: string[]; contains: string }[];
  restrictions: { id: string; name: string }[];
  selected: string[];
  cart: { item: string; quantity: number }[];
} {
  return {
    items: ctx.menu.items.map((i) => ({
      id: i.id,
      name: i.name,
      price: i.price,
      ingredients: ingredientNames(i, ctx.menu),
      // Disclosure of derived allergen data, which is a fact about the ingredient
      // table. It is NOT a verdict about anyone, and the model must not read it as one.
      contains: containsLine(i, ctx.menu),
    })),
    restrictions: ctx.restrictions.map((r) => ({ id: r.id, name: r.name })),
    selected: ctx.selected().map((r) => r.id),
    cart: readCart(ctx.doc),
  };
}

export function readCart(doc: Document): { item: string; quantity: number }[] {
  const out: { item: string; quantity: number }[] = [];
  for (const line of doc.querySelectorAll<HTMLElement>("[data-cart-line]")) {
    const item = line.dataset["cartLine"];
    const qty = Number(line.querySelector<HTMLElement>("[data-qty]")?.textContent ?? "0");
    if (item && Number.isFinite(qty) && qty > 0) out.push({ item, quantity: qty });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* add_to_cart and checkout_demo_order: the site's own controls        */
/* ------------------------------------------------------------------ */

/**
 * Drive the site's own Add button rather than reaching into the cart's state.
 * The site has to work with no agent at all, so the agent uses what a guest
 * uses, and the result is verified by reading the cart line back.
 */
export function addToCart(doc: Document, menu: Menu, item: string, quantity: number): { item: string; quantity: number; cartQuantity: number } {
  if (!itemById(menu, item)) throw new Error(`'${item}' is not an item on this menu.`);
  const card = doc.querySelector<HTMLElement>(`[data-item="${item}"]`);
  const button = card?.querySelector<HTMLElement>("[data-add]");
  if (!button) throw new Error(`The page has no Add control for '${item}', so nothing was added.`);
  const before = readCart(doc).find((l) => l.item === item)?.quantity ?? 0;
  for (let n = 0; n < quantity; n += 1) button.click();
  const after = readCart(doc).find((l) => l.item === item)?.quantity ?? 0;
  if (after !== before + quantity) {
    throw new Error(`The cart shows ${after} of '${item}', not the ${before + quantity} expected. Read the order yourself before trying again.`);
  }
  return { item, quantity, cartQuantity: after };
}

/** The default order placement: click the site's checkout, then read the confirmation back. */
export function placeOrderInPage(doc: Document): { summary: string } {
  const lines = readCart(doc);
  if (lines.length === 0) throw new Error("The order is empty, so there is nothing to place.");
  const button = doc.querySelector<HTMLButtonElement>("[data-checkout]");
  if (!button) throw new Error("The page has no checkout control, so no order was placed.");
  if (button.disabled) throw new Error("The checkout control is disabled, so no order was placed.");
  button.click();
  const confirmation = doc.querySelector<HTMLElement>("[data-confirmation]");
  if (!confirmation || confirmation.hasAttribute("hidden")) {
    // The click happened. Whether anything came of it is not something we know.
    throw new Error("The order was submitted but no confirmation appeared, so its outcome is unknown.");
  }
  return { summary: (confirmation.textContent ?? "").replace(/\s+/g, " ").trim() };
}

/* ------------------------------------------------------------------ */
/* Registration                                                        */
/* ------------------------------------------------------------------ */

const FINDING_SCHEMA = {
  type: "object" as const,
  additionalProperties: false as const,
  properties: {
    item: { type: "string" as const, description: "The menu item id this verdict is about." },
    verdict: { type: "string" as const, enum: ["safe", "unsafe", "unknown"], description: "The checker's verdict." },
    covered: {
      type: "array" as const,
      description: "The allergen ids this verdict speaks to. An empty list means nothing was checked.",
      items: { type: "string" as const, description: "An allergen id." },
    },
    because: {
      type: "object" as const,
      additionalProperties: false as const,
      description: "The ingredient and rule that decided it. Absent for a safe verdict.",
      properties: {
        ingredient: { type: "string" as const, description: "The item ingredient that decided the verdict." },
        allergen: { type: "string" as const, description: "The allergen id, or the literal 'unknown' for a data gap." },
        via: {
          type: "array" as const,
          description: "The derivation path from the ingredient to the allergen.",
          items: { type: "string" as const, description: "An ingredient or allergen id." },
        },
      },
      required: ["ingredient", "allergen", "via"],
    },
  },
  required: ["item", "verdict", "covered"],
};

/**
 * The definitions, separated from the handlers so a test can read them without a DOM.
 *
 * Every id-shaped argument is an `enum` of the ids this site actually publishes.
 * That is not politeness to the model. An action's arguments are shown to the
 * guest in the confirmation dialog before a committing action runs, so a free-text
 * `item` would be a second, unguarded route for model prose to reach the screen:
 * `add_to_cart({item: "the Reuben is dairy-free"})` would print that claim in the
 * dialog. Pinning the value set makes such an argument fail validation before any
 * dialog is drawn. The gate is the only path for prose; this keeps it the only one.
 */
export function actionDefinitions(ctx: Pick<SiteContext, "checkoutTimeoutMs"> & { menu?: Menu; restrictions?: Restriction[] }): ActionDefinition[] {
  const itemIds = (ctx.menu ?? MENU).items.map((i) => i.id);
  const restrictionIds = (ctx.restrictions ?? RESTRICTIONS).map((r) => r.id);
  return [
    {
      name: "get_menu_state",
      description:
        "Read the current menu, the guest's restrictions and the cart. Returns published data only: item names, prices, listed ingredients and the derived allergens disclosed on each card. It contains no verdict and must not be read as one.",
      effect: "read",
      commits: false,
      inputSchema: { type: "object", additionalProperties: false, properties: {} },
    },
    {
      name: "check_safety",
      description:
        "Ask the site's checker for its verdict (safe, unsafe or unknown, with the deciding ingredient) on menu items under a set of restrictions. This is the only source of a safety verdict. You may ask; you may not conclude. The verdict is also shown beside each dish, and that display, not your summary, is what the guest reads.",
      effect: "read",
      commits: false,
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          items: {
            type: "array",
            description: "Menu item ids to check. Omit to check the whole menu.",
            maxItems: 64,
            items: { type: "string", description: "A menu item id.", enum: itemIds },
          },
          restrictions: {
            type: "array",
            description: "Published restriction ids to check against. Omit to use what the guest has selected on the page.",
            maxItems: 16,
            items: { type: "string", description: "A published restriction id.", enum: restrictionIds },
          },
        },
      },
      outputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          findings: { type: "array", description: "One finding per item checked.", maxItems: 128, items: FINDING_SCHEMA },
          checked: {
            type: "array",
            description: "The restriction ids actually checked. Empty means nothing was checked.",
            maxItems: 16,
            items: { type: "string", description: "A restriction id." },
          },
        },
        required: ["findings", "checked"],
      },
    },
    {
      name: "add_to_cart",
      description: "Add a menu item to the guest's order. This changes the order, so the guest confirms it first.",
      effect: "write",
      commits: true,
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          item: { type: "string", description: "The menu item id to add.", enum: itemIds },
          quantity: { type: "integer", description: "How many to add. Defaults to one.", minimum: 1, maximum: 10 },
        },
        required: ["item"],
      },
      outputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          item: { type: "string", description: "The item added." },
          quantity: { type: "integer", description: "How many were added." },
          cartQuantity: { type: "integer", description: "How many are in the order now, read back from the page." },
        },
        required: ["item", "quantity", "cartQuantity"],
      },
    },
    {
      name: "checkout_demo_order",
      description:
        "Place the demo order. No payment is taken and no food is made. It commits the order, so the guest confirms it first, and if its outcome cannot be confirmed it is reported as unknown rather than retried.",
      effect: "irreversible",
      commits: true,
      timeoutMs: ctx.checkoutTimeoutMs ?? 20000,
      inputSchema: { type: "object", additionalProperties: false, properties: {} },
      outputSchema: {
        type: "object",
        additionalProperties: false,
        properties: { summary: { type: "string", description: "The confirmation the page showed, read back after the order." } },
        required: ["summary"],
      },
    },
  ];
}

/** Register all four, returning their canonical refs in declaration order. */
export function registerSiteActions(registry: ActionRegistry, scope: ActionScope, ctx: SiteContext): string[] {
  const handlers: Record<string, (args: Record<string, unknown>, c: { signal: AbortSignal }) => unknown> = {
    get_menu_state: () => menuState(ctx),
    check_safety: (args) => checkSafety(args as CheckSafetyArgs, ctx),
    add_to_cart: (args) => addToCart(ctx.doc, ctx.menu, String(args["item"]), Number(args["quantity"] ?? 1)),
    checkout_demo_order: (_args, c) =>
      ctx.placeOrder ? ctx.placeOrder(c.signal) : placeOrderInPage(ctx.doc),
  };
  return actionDefinitions(ctx).map((def) => registry.register(scope, def, (args, c) => handlers[def.name]!(args, c)));
}

/** Where the runtime should look in the DOM to find the shop it drives. */
export function siteControlsPresent(doc: Document): boolean {
  return doc.querySelector("[data-menu]") !== null && doc.querySelector("[data-checkout]") !== null;
}

/** The published defaults, for a caller that has no reason to override them. */
export function defaultSiteContext(doc: Document, onFindings: (f: Finding[]) => void, selected: () => Restriction[]): SiteContext {
  return { doc, menu: MENU, restrictions: RESTRICTIONS, selected, onFindings };
}
