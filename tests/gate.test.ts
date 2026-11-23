import { describe, expect, test } from "vitest";
import type { Finding } from "../contracts";
import { MENU, RESTRICTIONS } from "../src/safety/canon.ts";
import { verdictFor } from "../src/safety/verdict.ts";
import { detectClaims } from "../src/gate/claims.ts";
import { gate, REFUSAL_MARKER } from "../src/gate/gate.ts";

const dairyFree = RESTRICTIONS.find((r) => r.id === "dairy_free")!;
const find = (id: string): Finding => {
  const item = MENU.items.find((i) => i.id === id);
  if (!item) throw new Error(`no item ${id}`);
  return verdictFor(item, [dairyFree], MENU);
};
const safe = (item: string, covered: string[] = ["dairy"]): Finding => ({ item, verdict: "safe", covered });

describe("the gate: no unbacked safety claim reaches the screen", () => {
  test("an unbacked safety claim never reaches the screen", () => {
    const { shown, refusals } = gate("The brioche burger is dairy-free.", []);
    expect(shown).not.toMatch(/dairy-free/);
    expect(refusals[0]!.claimed).toBe("dairy-free");
  });

  test("real findings: the fixtures behave as the tests assume", () => {
    expect(find("fruit_cup").verdict).toBe("safe");
    expect(find("chili_chicken_plate").verdict).toBe("unknown");
    expect(find("reuben").verdict).toBe("unsafe");
  });

  test("a claim backed by a matching finding is allowed through unchanged", () => {
    const prose = "The fruit cup is dairy-free.";
    const { shown, refusals } = gate(prose, [find("fruit_cup")]);
    expect(refusals).toEqual([]);
    expect(shown).toBe(prose);
  });

  test("a finding for a DIFFERENT item is not backing", () => {
    const { shown, refusals } = gate("The lemonade is dairy-free.", [safe("fruit_cup")]);
    expect(refusals.length).toBe(1);
    expect(shown).not.toMatch(/dairy-free/);
  });

  test("an unknown finding does NOT back a safety claim (the central case)", () => {
    const f = find("chili_chicken_plate");
    expect(f.verdict).toBe("unknown");
    for (const prose of ["The chilli chicken plate is dairy-free.", "The chili chicken plate is dairy-free."]) {
      const { shown, refusals } = gate(prose, [f]);
      expect(refusals.length).toBe(1);
      expect(shown).not.toMatch(/dairy-free/);
    }
    const r = gate("The chili chicken plate is dairy-free.", [f]).refusals[0]!;
    expect(r.item).toBe("chili_chicken_plate");
    expect(r.reason).toBe("unknown");
  });

  test("a safe finding covering dairy does NOT back a gluten-free claim, but DOES back dairy-free", () => {
    const f = safe("fruit_cup", ["dairy"]);
    const g = gate("The fruit cup is gluten-free.", [f]);
    expect(g.refusals[0]!.reason).toBe("not_checked");
    expect(g.shown).not.toMatch(/gluten-free/);
    expect(gate("The fruit cup is dairy-free.", [f]).refusals).toEqual([]);
    expect(gate("The fruit cup is dairy-free and gluten-free.", [f]).refusals.length).toBe(1);
    expect(gate("The fruit cup is dairy-free and gluten-free.", [safe("fruit_cup", ["dairy", "gluten"])]).refusals).toEqual([]);
  });

  test("a safe finding with covered: [] backs nothing; generic claims are never backed", () => {
    expect(gate("The fruit cup is dairy-free.", [safe("fruit_cup", [])]).refusals[0]!.reason).toBe("not_checked");
    expect(gate("The fruit cup is safe for you.", [safe("fruit_cup", ["dairy"])]).refusals[0]!.reason).toBe("not_checked");
    expect(gate("The fruit cup is nut-free.", [safe("fruit_cup", ["peanut"])]).refusals.length).toBe(1);
    expect(find("fruit_cup").covered).toEqual(["dairy"]);
    const none = verdictFor(MENU.items.find((i) => i.id === "fruit_cup")!, [], MENU);
    expect(none).toEqual({ item: "fruit_cup", verdict: "safe", covered: [] });
  });

  test("an unsafe finding does not back a safety claim", () => {
    const r = gate("The Reuben is dairy-free.", [find("reuben")]).refusals[0]!;
    expect(r.reason).toBe("unsafe");
  });

  test("one safe finding cannot outvote an unknown/unsafe finding for the same item", () => {
    const unk: Finding = { item: "fruit_cup", verdict: "unknown", covered: ["dairy"], because: { ingredient: "x", allergen: "unknown", via: ["x"] } };
    expect(gate("The fruit cup is dairy-free.", [safe("fruit_cup"), unk]).refusals.length).toBe(1);
  });

  test("a claim naming two items needs both backed", () => {
    const prose = "The fruit cup and the lemonade are dairy-free.";
    expect(gate(prose, [safe("fruit_cup")]).refusals.length).toBe(1);
    expect(gate(prose, [safe("fruit_cup"), safe("lemonade")]).refusals.length).toBe(0);
  });

  test("synonyms for a safety assertion are caught", () => {
    for (const s of ["dairy-free", "free from dairy", "contains no dairy", "you'll be fine with", "safe for you"])
      expect(detectClaims(`The soup is ${s}.`).length).toBeGreaterThan(0);
  });

  test("a wide net of phrasings is caught", () => {
    const phrases = [
      "The soup is dairy free.", "The soup is Dairy-Free!", "The soup is free of dairy.", "The soup has no dairy.",
      "The soup doesn't contain milk.", "The soup is made without butter.", "The soup is 100% vegan.",
      "The soup is gluten-friendly.", "The soup is allergy friendly.", "The soup is suitable for celiacs.",
      "The soup is perfectly safe.", "You can safely eat the soup.", "You can eat the soup.",
      "Go ahead and order the soup.", "Don't worry about the soup.", "The soup is no problem for you.",
      "The soup won't cause any trouble.", "The soup is low risk.", "I guarantee the soup is fine.",
      "We checked the soup.", "The soup has been verified.", "The soup is good for people with allergies.",
      "The soup is okay.", "The soup is fine.", "The soup should be alright.", "The soup is probably fine for you.",
      "Rest assured about the soup.", "The soup is nut free.", "The soup is kosher.", "Yes, the soup is.",
      "The soup is in the clear.", "The soup is fine for most.", "The soup is kid-proof.", "Eat up, the soup is great.",
      "The soup has zero allergens.", "Nothing in the soup will bother you.", "The soup is not unsafe.",
      "The soup is free from the usual suspects.", "The soup does not contain anything risky.",
    ];
    const missed = phrases.filter((p) => detectClaims(p).length === 0);
    expect(missed).toEqual([]);
  });

  test("hedged and vague reassurance fails closed", () => {
    for (const s of [
      "It should be OK for most people.",
      "I think you will probably be fine.",
      "Most people tolerate it without any trouble.",
      "There is nothing in it to worry about.",
      "It is likely suitable for your needs.",
      "Chances are it is no issue.",
    ]) {
      const { shown, refusals } = gate(s, []);
      expect(refusals.length, s).toBe(1);
      expect(shown, s).toBe(REFUSAL_MARKER);
    }
  });

  test("a claim the detector cannot parse fails closed", () => {
    expect(gate("It should be OK for most people.", []).refusals.length).toBe(1);
  });

  test("a claim with no identifiable item can never be backed", () => {
    const r = gate("Everything here is dairy-free.", [safe("fruit_cup")]).refusals[0]!;
    expect(r.reason).toBe("item_unresolved");
    // pronoun in a later sentence does not inherit the earlier sentence's item
    const g = gate("The fruit cup is on the menu. It is dairy-free.", [safe("fruit_cup")]);
    expect(g.refusals.length).toBe(1);
    expect(g.shown).toMatch(/^The fruit cup is on the menu\./);
  });

  test("a backed item name cannot launder a claim about an ingredient", () => {
    const g = gate("The fruit cup comes with melon, and the melon is allergen free.", [safe("fruit_cup")]);
    expect(g.refusals.length).toBe(1);
  });

  test("an orphan yes/no answer is refused", () => {
    expect(gate("Yes.", []).refusals.length).toBe(1);
    expect(gate("No, it doesn't.", []).refusals.length).toBe(1);
  });

  test("obfuscation: case, markdown, zero-width, entities of spacing, fullwidth", () => {
    for (const s of [
      "The soup is DAIRY-FREE.", "The soup is **dairy**-free.", "The soup is dai​ry-free.",
      "The soup is dairy‑free.", "The soup is <b>dairy</b>-free.", "The soup is ｄａｉｒｙ-free.",
      "The soup is `dairy_free`.", "The soup is dairy­free.",
    ]) expect(gate(s, []).refusals.length, s).toBe(1);
  });

  test("obfuscation: spaced letters", () => {
    expect(gate("The soup is d a i r y free.", []).refusals.length).toBe(1);
  });

  test("descriptive prose derivable from menu data passes untouched", () => {
    const prose = "The Reuben is made with rye bread, corned beef, swiss cheese, sauerkraut and russian dressing. It costs $11.50.\nOrder at the counter, and ask for extra napkins.";
    const g = gate(prose, [find("reuben")]);
    expect(g.shown).toBe(prose);
    expect(g.refusals).toEqual([]);
    expect(detectClaims(prose)).toEqual([]);
  });

  test("allow-list cost: ordinary marketing prose about an item is withheld, not derivable", () => {
    const prose = "The Reuben is stacked with corned beef and swiss on grilled rye. It costs $11.50 and is our most popular sandwich!";
    const g = gate(prose, [find("reuben")]);
    expect(g.refusals.map((r) => r.reason)).toEqual(["not_derivable", "not_derivable"]);
    expect(detectClaims(prose)).toEqual([]); // not a safety claim; withheld by the allow-list
  });

  test("a wrong price or an ingredient the item lacks is not derivable", () => {
    expect(gate("The Reuben costs $4.", []).refusals[0]!.reason).toBe("not_derivable");
    expect(gate("The fruit cup contains peanut butter.", []).refusals[0]!.reason).toBe("not_derivable");
  });

  test("C1: every register of reassurance about an item is withheld, even with an unsafe finding", () => {
    const unsafe = (item: string): Finding => ({
      item, verdict: "unsafe", covered: ["dairy"], because: { ingredient: "x", allergen: "dairy", via: ["x", "dairy"] },
    });
    const fx = [unsafe("reuben"), unsafe("chili_chicken_plate"), unsafe("fruit_cup")];
    for (const s of [
      "The Reuben is 0% dairy.",
      "I'd go with the Reuben if you're avoiding dairy.",
      "I'd recommend the chili chicken plate.",
      "The chili chicken plate meets your needs.",
      "The chili chicken plate qualifies.",
      "The chili chicken plate ticks every box.",
      "The chili chicken plate is within your limits.",
      "Nothing on your list shows up in the fruit cup.",
      "The fruit cup is clean.",
    ]) {
      const g = gate(s, fx);
      expect(g.refusals.length, s).toBe(1);
      expect(g.shown, s).toBe(REFUSAL_MARKER);
    }
  });

  test("C2: an affirmation after a refused question is withheld too", () => {
    const g = gate("Is the chili chicken plate dairy-free? Of course it is.", [find("chili_chicken_plate")]);
    expect(g.refusals.length).toBe(2);
    expect(g.shown).toBe(`${REFUSAL_MARKER} ${REFUSAL_MARKER}`);
    expect(g.shown).not.toMatch(/course/);
    const list = gate("- fruit cup\n- lemonade\nBoth work.", []);
    expect(list.shown).not.toMatch(/work/);
    expect(list.refusals.length).toBe(1);
    expect(gate("The fruit cup is on the menu. It is.", []).refusals.length).toBe(1);
    expect(gate("The soup is dairy-free. Yes. Definitely so.", []).refusals.length).toBe(3);
  });

  test("a derivable continuation does not break the chain (round 2 defect)", () => {
    const unsafe: Finding = {
      item: "fruit_cup", verdict: "unsafe", covered: ["dairy"], because: { ingredient: "x", allergen: "dairy", via: ["x", "dairy"] },
    };
    for (const s of [
      "The fruit cup is on the menu. It costs $5. It is clean.",
      "The fruit cup is on the menu. It costs $5. It ticks every box.",
      "The fruit cup is on the menu. It costs $5. I'd recommend it.",
      "The fruit cup is on the menu. It costs $5. Nothing on your list shows up in it.",
      "Fruit cup. It costs $5. It is clean.",
    ]) {
      const g = gate(s, [unsafe]);
      expect(g.refusals.length, s).toBe(1);
      expect(g.shown.endsWith(REFUSAL_MARKER), s).toBe(true);
    }
  });

  test("round 3: reassurance tails at level 1 are withheld", () => {
    const unsafe: Finding = {
      item: "fruit_cup", verdict: "unsafe", covered: ["dairy"], because: { ingredient: "x", allergen: "dairy", via: ["x", "dairy"] },
    };
    const head = "The fruit cup is on the menu. It costs $5. ";
    for (const t of [
      "The former is clean.", "Same here.", "Yours is clean.", "Such a clean pick.", "Said item is clean.",
      "Totally clean.", "Perfectly clean.", "Completely clean.", "A good pick.",
    ]) {
      const g = gate(head + t, [unsafe]);
      expect(g.refusals.length, t).toBe(1);
      expect(g.shown, t).toBe(head + REFUSAL_MARKER);
    }
  });

  test("overcorrection guards: innocuous prose still passes", () => {
    expect(gate("Same opening hours on Sunday.", []).refusals).toEqual([]);
    expect(gate("The Reuben is made with rye bread, corned beef, swiss cheese, sauerkraut and russian dressing. It costs $11.50.", []).refusals).toEqual([]);
    expect(gate("The fruit cup is on the menu. It costs $5. Welcome to the deli!", []).refusals).toEqual([]);
  });

  test("the chain ends on a genuinely new topic", () => {
    const g = gate("The fruit cup is on the menu. It costs $5. Welcome to the deli!", []);
    expect(g.refusals).toEqual([]);
    expect(g.shown).toBe("The fruit cup is on the menu. It costs $5. Welcome to the deli!");
  });

  test("a continuation sentence that restates derivable facts passes", () => {
    expect(gate("The Reuben is on the menu. It costs $11.50.", []).refusals).toEqual([]);
  });

  test("only the offending sentence is replaced, whitespace preserved", () => {
    const g = gate("Welcome to the deli. The fruit cup is dairy-free. Order at the counter.", []);
    // the sentence right after a refusal is withheld too (it may be an answer to it)
    expect(g.shown).toBe(`Welcome to the deli. ${REFUSAL_MARKER} ${REFUSAL_MARKER}`);
    const h = gate("Welcome to the deli. The fruit cup is dairy-free.", []);
    expect(h.shown).toBe(`Welcome to the deli. ${REFUSAL_MARKER}`);
    expect(h.refusals.length).toBe(1);
  });

  test("the gate is idempotent: its own refusal marker is not a claim", () => {
    expect(detectClaims(REFUSAL_MARKER)).toEqual([]);
    const once = gate("The soup is dairy-free. The soup is safe for you.", []);
    const twice = gate(once.shown, []);
    expect(twice.shown).toBe(once.shown);
    expect(twice.refusals).toEqual([]);
  });

  test("refusals name what was claimed and why", () => {
    const r = gate("The soup is free from dairy.", []).refusals[0]!;
    expect(r.claimed).toBe("free from");
    expect(r.sentence).toBe("The soup is free from dairy.");
    expect(r.why.length).toBeGreaterThan(0);
  });
});
