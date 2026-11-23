# Decisions

Vouch was built by an orchestrated set of agents working from a plan, with a controller
making the calls the plan did not answer. Thirty-seven of those calls were recorded as
rulings while the work ran. This file keeps the ones that shaped the product, in the order
they were made, along with the mistakes — because a project arguing that systems should say
what they do not know would be a poor advertisement for itself if its own record were tidied.

Each entry says what was decided and why. Where a decision could be wrong, it says what that
would cost.

---

## The architecture

**A `Finding` records which restrictions it actually accounted for.**
A verdict that says "safe" without saying *safe from what* asserts nothing a caller can rely
on. `Finding.covered` carries the allergen ids the verdict speaks to, and the gate refuses a
claim whose allergen is outside that set. Without this, a `safe` Finding computed for one
restriction would silently back a claim about a different one.

**"No allergens listed" and "nobody knows what is in this" are different facts.**
A leaf ingredient with an empty `contains` list is indistinguishable from an ingredient whose
breakdown nobody has. The contract gained an explicit unknown-contents flag, and the menu
data gained real instances of it. This is the difference between *safe* and *unknown*, and
collapsing it is the exact failure the product exists to prevent.

**Ingredients are shown per item, and that is a correctness requirement.**
The site's own tagline is "with every ingredient written down". A reviewer raised the
per-item ingredient list as a presentation nicety; it was ruled a correctness defect. If a
human cannot check the data the checker reasons over, the site is asking to be trusted rather
than checked, and the whole argument collapses.

**The gate inverted from a deny-list to an allow-list.**
This is the central decision. The first gate tried to detect unsafe claims by pattern. Three
rounds of patching showed the shape of that mistake: each patch closed instances while the
class stayed open. The gate now **withholds by default** — a sentence mentioning a menu item
passes only if every assertion it makes is derivable from the menu data or backed by a
Finding.

**Then patching stopped, deliberately, with a known gap left open.**
After round three the residual was an open-ended class: a short evaluative sentence with no
word on any list and no back-reference ("A lovely pick.", "Spotless."). Further rounds would
have bought shrinking increments of a set with no boundary. What makes that safe to ship is
not the word lists but the fact that **verdict cards render independently of the prose**, so a
leaked "Spotless." sits beside a card reading *unsafe*. The vocabulary list is the weaker of
the two defences, and `LIMITS.md` says so, because that tells a reader where to push.

**The gate suppresses true warnings as well as false ones.**
A model saying "this is not dairy-free" is refused exactly like one saying it is. That is a
real cost, accepted knowingly, and it is survivable only because the verdict is displayed
beside the prose rather than through it.

---

## Honesty about the data

**The tracked-allergen boundary was written down rather than extended ad hoc.**
Two allergens — mustard, then celery — turned out to be reachable only by derivation on some
dishes, so a guest reading the card would not see them. Rather than keep adding allergens by
intuition, the rule became explicit: the EU-14 major allergens intersected with what this
menu's data actually contains, with every exclusion named. An untracked allergen is precisely
the kind of thing this product must not be quiet about.

**A strict validator was not relaxed for a convenience.**
The restriction loader rejects malformed data, which meant the tracking policy could not live
as a comment inside the data file. The ruling was to keep the validator strict and put the
policy in its own file next to the data. Trading a safety property for a comment would have
been a bad trade at any price.

---

## Conformance

**The published BYOK position is declared honestly instead of faked.**
A static site has no publishable secret, so we ship no provider key. The specification's
checklist asks for a run on "the site's published default router". We publish the router
*protocol and model* and require a visitor key, and say exactly that — rather than inventing
a funded default we cannot honour. A strict reader may score that check unmet. That is the
correct way to lose a point.

**Tool references are an allow-list, for the same reason the gate is.**
A name-based check could not see a verdict-shaped agent under a bland alias, or an MCP tool
called `is_it_ok`. Rather than widen the patterns — the mistake already made once on the gate
— the check enumerates what a tool reference may be and fails everything else. Adding a
legitimate one is a deliberate, visible edit, which is where that decision belongs.

**No peer was pre-wired; a tripwire was added instead.**
Publishing an allow-list entry for an origin that does not exist is worse than publishing
none. A test now asserts that every symbolic reference has a binding and every binding's
origin is allowed. It is vacuous today and becomes live the moment a peer is added, and it
cannot be satisfied by forgetting.

**Claims about the private-context rules were cut back to what is true.**
The per-agent `allow` blocks govern flow to and from *external* agents. The upstream
reference is explicit that private data is already visible to every agent inside a network. So
the documentation may not claim those blocks isolate our own agents from each other — and
does not.

---

## Process decisions that changed the outcome

**The real consumer was run against our published files, and it found what tests could not.**
Three schema questions could not be settled from the specification's prose. Fetching the
upstream reference and running the real runtime against our artifacts revealed that our router
configuration nested a key one level deeper than the runtime reads it: a visitor supplying
their own API key received *"this site publishes no AI provider route"* instead of a usable
router. One hundred and twenty-three local tests passed. Tests written about an inferred
schema only check the inference against itself.

**The reference was vendored, with its licence, before any code was taken.**
Both upstream repositories are Apache 2.0. The licence and a provenance record naming what was
fetched, when, and what was run were committed *first*, so that the question "which parts are
yours?" has a one-file answer rather than a reconstruction.

**Both hosting config formats ship, because they are not interchangeable.**
`_headers` is honoured by Cloudflare Pages and Netlify and ignored by Vercel; `vercel.json` is
the reverse. CORS on the published artifacts is mandatory, so a single config would have been a
silent no-op on the wrong host with every local test still green. GitHub Pages is ruled out
entirely: it cannot set response headers at all.

**The demo script was written early, as a requirements check.**
It found that the most important shot — a model saying something reassuring and wrong, withheld,
with the verdict beside it — could not be filmed, because a live model cannot be relied upon to
misbehave on cue. The runtime therefore replays a fixed reply through the real gate and the real
verdict path, labelled as replayed. That is also a regression test you can watch, which no
live-model test can be.

---

## Mistakes, recorded

**A test restated a constant instead of pinning a property**, and passed while the live system
was wrong. (From a sibling project, carried here as a standing check on every new test: a test
that cannot fail is worse than no test.)

**A severity was asserted without being checked.** An allergen was described as "invisible on
all three cards" when it was top-level on two of them. The decision it supported was still
right; the claim was not. The same check had been done correctly one round earlier and was
coasted on the second time.

**An implementation was prescribed where an invariant should have been stated** — twice. The
first time, the implementer correctly refused the one-line fix and substituted a better rule.
The second time produced a test that failed on legitimate future code, which is a test someone
eventually loosens. The lesson is recorded in the briefs: state the invariant, let the
implementer choose the mechanism.

**A test reimplemented the consumer and was more forgiving than it.** The replacement router
test modelled upstream's logic with a fallback upstream does not have, so three ways of
breaking the configuration passed. Found by mutation testing, not by review.

**A stale figure was nearly written into the limitations document.** "Three known leak classes"
was accurate after one fix round and wrong after the third. It was caught before shipping. On a
project whose entire argument is that systems should state what they do not know, that document
is the one place an error would be fatal.
