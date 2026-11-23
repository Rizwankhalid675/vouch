import type { Menu } from "../../contracts";
import { MENU } from "../safety/canon.ts";

/**
 * Safety-claim detection. Pure: no DOM, network, model or I/O.
 *
 * Design rule: FAIL CLOSED. A sentence is a claim if it reads as reassurance about
 * suitability in any register (confident, hedged, vague, a bare "yes"). A false
 * positive costs a replaced sentence; a false negative could put an allergen on a
 * plate. Detection is deliberately over-broad; the gate then demands backing.
 */

export interface Claim {
  /** The whole sentence the claim lives in (original text, trimmed). */
  text: string;
  /** First menu item id the sentence mentions, if any. */
  item?: string;
  /** All menu item ids the sentence mentions (each needs backing). */
  items: string[];
  /** First allergen/dietary word the sentence names, if any. */
  allergen?: string;
  /** The phrase that made this sentence a claim (normalised, lowercase). */
  claimed: string;
  /**
   * True when the sentence also names an ingredient that is not part of an item
   * name ("the melon is allergen free"). An item-level Finding cannot back a
   * claim about an ingredient, so such a claim can never be backed.
   */
  ingredientSubject: boolean;
}

export interface Segment {
  /** Exact original slice, including trailing whitespace. */
  raw: string;
  /** Original slice without surrounding whitespace. */
  core: string;
}

/* ---------- normalisation ---------- */

export function norm(s: string): string {
  return s
    .normalize("NFKC")
    .replace(/[​-‏⁠﻿­‪-‮]/g, "")
    .replace(/<[^>]*>/g, "")
    .replace(/[‐-―−﹘﹣－]/g, "-")
    .replace(/[‘’ʼ`]/g, "'")
    .replace(/[*~]/g, "")
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\bchill?[ie]\b/g, "chili") // chilli / chile / chili
    .replace(/(?<![a-z0-9])(?:[a-z] ){3,}[a-z](?![a-z0-9])/g, (m) => m.replace(/ /g, "")) // "d a i r y"
    .replace(/\s+/g, " ")
    .trim();
}

/** Split into sentence-ish segments, preserving every byte of the original. */
export function segments(prose: string): Segment[] {
  const out: Segment[] = [];
  const re = /[\s\S]*?(?:[.!?]+(?=\s|$)|;|\n+|$)\s*/g;
  for (const m of prose.matchAll(re)) {
    const raw = m[0];
    if (raw.length === 0) continue;
    out.push({ raw, core: raw.trim() });
  }
  return out;
}

/* ---------- vocabulary ---------- */

/** Allergen / dietary / ingredient words a claim is usually about. */
const STATIC_VOCAB = [
  "dairy", "milk", "lactose", "cheese", "butter", "cream", "yogurt", "yoghurt", "whey", "casein",
  "egg", "eggs", "gluten", "wheat", "flour", "barley", "rye", "nut", "nuts", "peanut", "peanuts",
  "tree nut", "tree nuts", "almond", "almonds", "walnut", "walnuts", "cashew", "cashews", "pecan",
  "pecans", "pistachio", "pistachios", "hazelnut", "hazelnuts", "shellfish", "shrimp", "prawn",
  "crab", "lobster", "mollusc", "mollusk", "fish", "salmon", "tuna", "anchovy", "anchovies", "soy",
  "soya", "soybean", "sesame", "tahini", "pork", "bacon", "ham", "lard", "mustard", "celery",
  "lupin", "sulphite", "sulphites", "sulfite", "sulfites", "meat", "beef", "chicken", "animal",
  "sugar", "alcohol", "gelatin", "gelatine", "msg", "allergen", "allergens", "ingredient", "ingredients",
];
const MENU_VOCAB_CACHE = new WeakMap<Menu, string[]>();
function menuVocab(menu: Menu): string[] {
  let v = MENU_VOCAB_CACHE.get(menu);
  if (!v) {
    v = [];
    for (const [id, ing] of Object.entries(menu.ingredients)) {
      v.push(norm(id), norm(ing.name));
    }
    MENU_VOCAB_CACHE.set(menu, v);
  }
  return v;
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const wordAlt = (words: string[]) =>
  new RegExp(`(?<![a-z0-9])(?:${[...new Set(words)].sort((a, b) => b.length - a.length).map(esc).join("|")})(?![a-z0-9])`, "g");

const STATIC_RE = wordAlt(STATIC_VOCAB);

const NEGATOR =
  /(?<![a-z0-9])(?:no|not|none|nor|never|zero|without|nothing|neither|cannot|lacks?|lacking|sans|minus|excluding|excludes?|excluded|omits?|omitted|omitting|devoid|absent|free of|free from)(?![a-z0-9])|n't(?![a-z])/;
const CONTAINMENT =
  /(?<![a-z0-9])(?:contain\w*|include\w*|made with|made from|use[sd]?|using|has|have|having|feature\w*|involve\w*|trace\w*|touch\w*|prepared|cooked|fried|served)(?![a-z0-9])/;
const HARM =
  /(?<![a-z0-9])(?:problems?|issues?|concerns?|risks?|risky|troubles?|hurt\w*|harm\w*|bother\w*|trigger\w*|affect\w*|upset\w*|cause\w*|react\w*|danger\w*|sick\w*|ill|illness|symptoms?|worr\w+|anything|any)(?![a-z0-9])/;
const EXCEPTIVE = /(?<![a-z0-9])(?:only|just|except|apart from|other than|besides|aside from|but)(?![a-z0-9])/;

interface Trigger { re: RegExp }
const T = (re: RegExp): Trigger => ({ re });

/** Direct trigger phrases: a match anywhere in the sentence makes it a claim. */
const DIRECT: Trigger[] = [
  // X-free in every spelling
  T(/(?<![a-z0-9])[a-z0-9]+-free(?![a-z0-9])/),
  T(/(?<![a-z0-9])[a-z]{3,}free(?![a-z0-9])/), // glued: "dairyfree", or a hyphen removed by obfuscation
  T(/(?<![a-z0-9])(?:dairy|gluten|lactose|egg|nut|peanut|soy|sesame|shellfish|fish|pork|wheat|allergen|allergy|sugar|meat|animal|cross|tree nut)s? free(?![a-z0-9])/),
  T(/(?<![a-z0-9])free (?:from|of)(?![a-z0-9])/),
  // safety words
  T(/(?<![a-z0-9])(?:safe|safely|safer|safest|safety|unsafe)(?![a-z0-9])/),
  // OK-ness
  T(/(?<![a-z0-9])(?:ok|okay|alright|all right)(?![a-z0-9])/),
  T(/(?<![a-z0-9])(?:be|is|are|am|was|were|'re|'m|'s|'ll|look|looks|seem|seems|feel|feels|sound|sounds|stay|stays|probably|likely|totally|perfectly|completely|just|all|will|should|would|could|might|may|think|so) (?:\w+ ){0,2}?fine(?![a-z0-9])/),
  T(/(?<![a-z0-9])fine (?:for|with|to|by|here)(?![a-z0-9])/),
  T(/(?<![a-z0-9])fine$/),
  // reassurance
  T(/(?<![a-z0-9])worr(?:y|ies|ied|ying)(?![a-z0-9])/),
  T(/(?<![a-z0-9])(?:rest (?:assured|easy)|breathe easy|peace of mind|without (?:a )?(?:care|concern|fear|hesitat\w*|worry))(?![a-z0-9])/),
  T(/(?<![a-z0-9])(?:harmless|risk-free|low[- ]risk|minimal risk|tolerat\w+|gentle on|easy on|kid-proof|[a-z]+-proof)(?![a-z0-9])/),
  T(/(?<![a-z0-9])no (?:problem|problems|issue|issues|concern|concerns|risk|risks|danger|harm|trouble|fear|reaction|reactions|worries|cause for|doubt)(?![a-z0-9])/),
  T(/(?<![a-z0-9])nothing (?:in|inside|hidden|sneaky|nasty|bad|harmful|to (?:worry|fear|be))(?![a-z0-9])/),
  // assurance / confidence (hedged or not)
  T(/(?<![a-z0-9])(?:guarantee\w*|promise\w*|assur\w+|certain\w*|definitely|absolutely|confident\w*|trust\w*|swear|surely|undoubtedly|no doubt|for sure|100 ?%|vouch(?:ed|es)? for|(?:i|we) vouch|(?:i'm|i am|we're|we are|pretty|quite|fairly|am|are|be) sure|sure (?:that|thing))(?![a-z0-9])/),
  T(/(?<![a-z0-9])(?:should|shouldn't|ought to) be (?:\w+ ){0,3}?(?:for|with|to|ok|okay|fine|good|safe|alright|suitable)(?![a-z0-9])/),
  // verification claims
  T(/(?<![a-z0-9])(?:verified|confirmed|checked|double-checked|cross-checked|cleared|certified|approved|tested|validated|screened|inspected|audited|vetted)(?![a-z0-9])/),
  // suitability
  T(/(?<![a-z0-9])(?:suitable|suits?|suited|appropriate|acceptable|permissible|permitted|compliant|compatible|accommodat\w+|caters?|catering)(?![a-z0-9])/),
  T(/(?<![a-z0-9])(?:good|great|perfect|ideal|right|fit|works?|recommended|best|friendly|okay|fine) (?:\w+ )?(?:for|with|to) (?:\w+ ){0,2}(?:you|your|anyone|everyone|everybody|people|those|folks|guests|diners|customers|someone|somebody|him|her|them|kids?|children|vegans?|vegetarians?|celiacs?|coeliacs?|allerg\w*|diet\w*|restrict\w*|needs?|sensitiv\w*|intoleran\w*|avoid\w*)(?![a-z0-9])/),
  T(/(?<![a-z0-9])(?:[a-z]+-friendly|friendly (?:for|to|with|option))(?![a-z0-9])/),
  T(/(?<![a-z0-9])(?:good to (?:go|eat)|all (?:good|set|clear)|in the clear|green light|go ahead|dig in|have at it|eat up|go for it)(?![a-z0-9])/),
  T(/(?<![a-z0-9])(?:you(?:'re| are)|we've got you|got you) (?:good|set|covered|sorted|fine|safe|clear)(?![a-z0-9])/),
  T(/(?<![a-z0-9])you (?:can|could|may|should be able to|are able to) (?:safely |freely |confidently |easily |happily )?(?:eat|have|enjoy|order|go|relax|trust|rely|consume|tuck)(?![a-z0-9])/),
  T(/(?<![a-z0-9])feel free to (?:eat|order|enjoy|have|dig)(?![a-z0-9])/),
  T(/(?<![a-z0-9])the usual suspects|major allergens|common allergens|top (?:8|9|eight|nine)(?![a-z0-9])/),
  // the allergy domain itself and dietary labels: always need backing
  T(/(?<![a-z0-9])(?:allerg\w*|intoleran\w*|celiac|coeliac|anaphyla\w*|dietary|diets?|restrictions?|cross[- ]?(?:contamination|contact)|contaminat\w*|traces?|sensitiv\w*)(?![a-z0-9])/),
  T(/(?<![a-z0-9])(?:vegan|vegetarian|pescatarian|halal|kosher|keto|paleo|plant[- ]based|dairy[- ]?less|nut[- ]?less)(?![a-z0-9])/),
  // orphan answers to a safety question
  T(/^(?:yes|yep|yeah|yup|yea|correct|absolutely|definitely|indeed|affirmative|you bet|certainly|that's right|that is right|no|nope|nah)(?![a-z0-9])/),
];

interface Hit { index: number; text: string }
function firstHit(s: string, re: RegExp): Hit | undefined {
  const g = new RegExp(re.source, re.flags.replace("g", ""));
  const m = g.exec(s);
  return m ? { index: m.index, text: m[0] } : undefined;
}

/* ---------- item resolution ---------- */

interface ItemMatcher { id: string; re: RegExp }
const MATCHER_CACHE = new WeakMap<Menu, ItemMatcher[]>();
function itemMatchers(menu: Menu): ItemMatcher[] {
  let m = MATCHER_CACHE.get(menu);
  if (!m) {
    m = [];
    for (const item of menu.items) {
      const forms = [...new Set([norm(item.name), norm(item.id)])];
      for (const f of forms) {
        m.push({ id: item.id, re: new RegExp(`(?<![a-z0-9])${esc(f)}(?:'s|s|es)?(?![a-z0-9])`, "g") });
      }
    }
    // longest names first so "chicken salad sandwich" is masked before anything shorter
    m.sort((a, b) => b.re.source.length - a.re.source.length);
    MATCHER_CACHE.set(menu, m);
  }
  return m;
}

function resolveItems(s: string, menu: Menu): { items: string[]; masked: string } {
  const found = new Map<string, number>();
  let masked = s;
  for (const { id, re } of itemMatchers(menu)) {
    re.lastIndex = 0;
    const m = re.exec(masked);
    if (m) {
      if (!found.has(id)) found.set(id, m.index);
      masked = masked.replace(re, " ");
    }
  }
  const items = [...found.entries()].sort((a, b) => a[1] - b[1]).map(([id]) => id);
  return { items, masked };
}

function mentionsOtherIngredient(masked: string, menu: Menu): boolean {
  const allowed = new Set(STATIC_VOCAB);
  const names = menuVocab(menu).filter((n) => n.length > 2 && !allowed.has(n));
  return wordAlt(names).test(masked);
}

/* ---------- detection ---------- */

function classify(core: string, menu: Menu): Claim | undefined {
  const s = norm(core);
  if (s === "") return undefined;
  const hits: Hit[] = [];
  for (const t of DIRECT) {
    const h = firstHit(s, t.re);
    if (h) hits.push(h);
  }
  const vocabHit = firstHit(s, STATIC_RE);
  const neg = firstHit(s, NEGATOR);
  const mv = menuVocab(menu);
  const anyVocab = vocabHit ?? (mv.length ? firstHit(s, wordAlt(mv)) : undefined);
  // negation x vocabulary: "contains no dairy", "without butter", "doesn't have egg"
  if (neg && anyVocab) hits.push(neg);
  // negation x containment verb: "does not contain anything unusual"
  if (neg) {
    const c = firstHit(s, CONTAINMENT);
    if (c) hits.push(neg);
    const h = firstHit(s, HARM);
    if (h) hits.push(neg);
  }
  // "free" beside an allergen word, however the list is phrased
  const free = firstHit(s, /(?<![a-z0-9])free(?![a-z0-9])/);
  if (free && vocabHit) hits.push(free);
  // "contains dairy only in the cheese", "everything but the dressing"
  const ex = firstHit(s, EXCEPTIVE);
  if (ex && vocabHit) hits.push(ex);

  if (hits.length === 0) return undefined;
  hits.sort((a, b) => a.index - b.index);
  const { items, masked } = resolveItems(s, menu);
  const claim: Claim = {
    text: core,
    items,
    claimed: hits[0]!.text.trim(),
    ingredientSubject: mentionsOtherIngredient(masked, menu),
  };
  if (items[0] !== undefined) claim.item = items[0];
  if (vocabHit) claim.allergen = vocabHit.text;
  return claim;
}

/**
 * Every sentence of `prose` that reads as a safety/suitability assertion.
 * Backing is NOT decided here; see gate().
 */
export function detectClaims(prose: string, menu: Menu = MENU): Claim[] {
  const out: Claim[] = [];
  for (const seg of segments(prose)) {
    const c = classify(seg.core, menu);
    if (c) out.push(c);
  }
  return out;
}

/** Internal: same as detectClaims but aligned to segments, for gate(). */
export function classifySegment(core: string, menu: Menu): Claim | undefined {
  return classify(core, menu);
}
