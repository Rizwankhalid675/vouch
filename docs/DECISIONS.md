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

**The verdict cards are a pure function of the menu and the guest's restrictions.**
The first version of this rule said the cards must render independently of model *prose*. A
model could not write a card — and then a model *tool call* did. Asking the checker for a
verdict with different arguments overwrote the guest's cards and printed "0 unsafe" against
their own allergen, reachable on the normal path by a correctly behaving model. The rule now
names the property rather than the channel: nothing reachable from the model may change what
any card shows — not its verdict, not its text, not its presence, not its order. It is
enforced by a signature. The renderer takes the guest's restrictions and computes the verdicts
itself, so displaying a model-supplied verdict does not compile.

**There is no way to put a runtime string into the site's own prose.**
Four separate times, a string chosen by a model or a peer reached the screen in the deli's
voice: through an action argument, through an agent's name, through a field value that
supplied its own quote and re-paired the filter's delimiters, and finally through a filter
that stripped whitespace followed by a prettifier that put it back. Each time the fix was a
better filter. The fourth time the capability was deleted instead. `siteText` now interpolates
only numbers — a number has no letters and no spaces, so no number can be a sentence — and a
value that must be shown goes in its own labelled node. There are two kinds of node, because
attribution has to be truthful: a stranger's string and our own menu data are marked
differently, since calling our own menu "not ours" would itself be a lie.

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
A static site has no publishable secret, so we ship no provider key. We publish the router
protocol, endpoint and model and require a visitor key, and say exactly that — rather than
inventing a funded default we cannot honour.

Checking this against the spec rather than against memory changed how it should be stated.
§4's requirement level is **MAY**: "A site MAY publish a default router and model that work
without a visitor-supplied key." Declining an option is not non-conformance, and an earlier
draft of this file implied we fell short of a mandate. §6's checklist line assumes a runnable
default, so its first clause is not demonstrable here without a visitor key — while its second,
"if BYOK is offered, also demonstrate the user-selected path", is satisfied in full. What the
specification does not do is say that a BYOK-only site conforms, or that it fails. That silence
is the actual situation, and naming it is better than resolving it in our own favour.

The event's own starter runtime corroborates the reading, by a route anyone can re-run:
`cognizant-ai-labs/agentic-web` at commit `d67755e762`,
`skills/agentify-website/runtime/engine.js:56-73`, gates publisher funding behind an explicit
`llm_router.publisher_funded === true`. Run against our published manifest it reports
`publisherFunded: false` with no error. Our manifest therefore makes no claim that the site pays
for inference — which is the claim it would be easiest to make by accident. Separately, the
adapted runtime (`cognizant-ai-lab/nsdeploy`, pinned in `PROVENANCE.md`) runs the same manifest in
five configurations without throwing, in both the default and the BYOK mode.

**A naming decision that cost a round, recorded because it will recur.** This paragraph said
"upstream's runtime". There are **three** repositories in play and two of them differ by one
letter: `cognizant-ai-lab/nsdeploy` and `cognizant-ai-lab/neuro-san` (singular), which
`PROVENANCE.md` pins and which this project's word "upstream" has always meant, and
`cognizant-ai-labs/agentic-web` (plural), the event's spec-and-starter repository, which nothing
here is adapted from. `publisher_funded` lives only in the third. An implementer sent to re-verify
the claim searched the two that "upstream" names, found nothing, and withdrew it as
unreproducible — correct search, wrong conclusion, and the fault was in the word.

**So the rule now is: name the repository, the path and the commit, and never write "upstream"
where two referents are live.** And the lesson is one notch sharper than "cite from a run rather
than from memory", which is recorded above and is a different failure. This claim *did* come from
a run. The **attribution** came from memory. A verified fact can still be unverifiable as stated,
and at that point a reader cannot tell it from an invented one — so the citation is part of the
claim, not decoration on it.

A strict reader may still score the check unmet. That remains the correct way to lose a point,
and it is the same three-valued judgement our own conformance CLI makes: `not-demonstrated`,
never a quiet `pass`.

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

**Five refusals, not four.** The plan named four — invalid network, composition cycle,
over-budget, denied origin. The specification requires a fifth that no task owned: a missing
key must stop the model call with a clear setup error. It is answered with the line only this
project can add — the checker and the verdict cards keep working with no key at all, because
they never call a model. A visitor with no AI provider still gets every safety answer this
site can give.

**Repeated invocation is not a cycle.** The obvious cycle detector — a set of seen agent names
— would refuse a guest who asks about two dishes, because that invokes the same agent twice.
The specification forbids treating that as a cycle. Detection happens on the composition path
across networks, and the false-positive case has its own test, so that a later "fix" cannot
quietly reintroduce the violation.

---

## Process decisions that changed the outcome

**The real consumer was run against our published files, and it found what tests could not.**
Three schema questions could not be settled from the specification's prose. Fetching the
upstream reference and running the real runtime against our artifacts revealed that our router
configuration nested a key one level deeper than the runtime reads it: a visitor supplying
their own API key received *"this site publishes no AI provider route"* instead of a usable
router. One hundred and twenty-three local tests passed. Tests written about an inferred
schema only check the inference against itself.

**The pinned spec was re-checked against its own repository rather than assumed stable.**
The entry is judged against a copy pinned on 23 November from **`cognizant-ai-labs/agentic-web`**
— named, because the two repositories `PROVENANCE.md` pins are a different organisation and this
document has already paid once for leaving that to inference. On 24 November that repository had
moved — two commits in the router area, which is our weakest conformance claim — so the assumption
was worth testing. The specification text itself is byte-identical (SHA-256 `050c86cd…83763`),
re-confirmed again later the same day at the newer commit `05a665e`. But the **starter runtime
vendored in that repository**, `skills/agentify-website/`, gained a build-time refusal for a
manifest whose `byok_router` equals its `base_url`. Ours does. The refusal is gated on
`llm_router.publisher_funded === true`, a flag we do not set, so it does not fire — verified both
ways, including the counterfactual where setting it refuses our own manifest. That runtime's
router selector was re-run against our published manifest in five configurations and all five
behave correctly, including the BYOK upgrade that a hundred and twenty-three local tests had
previously missed. Pinning a dependency and verifying the pin are different acts.

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

**The compiler enumerates; a grep finds what it cannot see.**
Removing the interpolation capability was done in two passes, and only the second one was
unusual. Narrowing the types and deleting the filters turned every unsafe call site into a
compile error — thirteen of them, named by the compiler rather than by anyone's memory. But a
raw `textContent =` never touches a typed API, so no type can object to it; one surface had
survived three careful sweeps for exactly that reason. A grep for the untyped escape routes
found it, and a fifth surface nobody had named. A type system enforces where its API is used;
the places that bypass the API need their own search.

**Tests assert properties, and three were rejected for passing the wrong way.**
One restated a constant it was meant to pin. One asserted an implementation rather than an
invariant, and so failed on legitimate future code — a test someone eventually loosens. One
reimplemented the consumer it was testing, more forgivingly than the real thing, so three ways
of breaking the configuration passed. A fourth checked that an element existed rather than
that it was visible, and hiding it passed. The habit that catches these is mutation: break the
thing deliberately, and watch the test fail before trusting it.

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

**An invariant was scoped to a channel instead of a property**, and the product's central
claim was false as built while every test passed. "Independent of prose" was not "independent
of the model". The brief is the ceiling on what gets built, so every way the wording was
narrower than the intent became a hole — and the tests inherited the same blind spot, because
they were written against the same wording.

**A commit message overstated its own change.** It said the gate withheld a sentence
unconditionally; the sentence passes the gate standing alone and is withheld only after a dish
is mentioned. The limits document had said this more precisely than the commit did.

**A false claim was written into published agent instructions** — that the page shows a verdict
"always and on every dish", when no verdict exists before the guest says what they avoid. An
unbacked claim, in the file a reader takes as the argument, on a project about not making
unbacked claims.

**The limits document has been corrected three times**: a leak count that was accurate after
one fix round and wrong after the third, a claim that a rule had been "applied without
exception" when four surfaces were exempt and one was live, and a tension described as
unresolved after it had been resolved. Every one of these was in prose. Nothing pins prose,
and 324 passing tests say nothing about a sentence.

**A consent card told a visitor "This reads only." about running a stranger's code.**
The card that asks permission to load another site's agents said, in one breath, that those
agents would run in this browser and that the operation was a read. The effect clause was
hard-coded to `read` for both purposes, and four lines above that line a comment called this
"an inaccuracy a consent card cannot have". The principle was written down, next to the code
that broke it, by the same hand, in the same minute.

A test asserted the wrong value outright — `effect === "read"` for the run purpose — so the
suite defended the defect. It read the plan object; the bug was in the rendered sentence. The
controller had also seen this card in a browser and approved it, having read its description
and never its final clause. Three checks, one blind spot, shared.

The fix was not a better comment. The published action catalog now carries each action's effect
in the spec's own field, the card derives its clause from what the plan does, and the test reads
the rendered text for both purposes. **A comment is a note to a reader; a type is a note to the
compiler.** Only one of them refuses to build.

**Comments outlived the code they described.** After the filters were deleted, three comments
still explained them in the present tense — one of them telling a future caller to route raw
strings through functions that no longer exist, and one asserting that quoting a value is what
protects it, which is the precise belief four incidents had just disproved.
