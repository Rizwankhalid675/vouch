# Submission screenshots

Four shots, 1568×740, captured from the **deployed** site at
`https://vouch-deli.netlify.app` on 24 November 2026 — not from a local build, and not
mocked up. Upload any or all to the Devpost form; one satisfies the field, and the first two
are the ones that argue the case.

Nothing here is staged: every state is reached by clicking the live site in the order the
captions describe.

---

### 1 — `1-three-verdicts-and-the-butter-three-steps-down.jpg`

**All three verdicts in one frame, with the find that justifies the whole project.**

Dairy-free ticked. The Reuben is **✕ Unsafe** — *"Contains dairy, through Swiss cheese →
Dairy."* The Pastrami is **✓ No conflict found** — never "safe". And the Turkey club is unsafe
*"through Brioche bun → Brioche → Butter → Dairy"*: butter three steps down a derivation chain,
inside a bun, with nothing in the ingredient line a person would read.

Every card carries the same footer — *"From the published ingredient list. Not a statement about
the kitchen, and not medical advice"* — which is the card saying what it is **not**.

### 2 — `2-the-claim-withheld-and-the-verdict-beside-it.jpg`

**The thesis, entire.** A question, a model's reply, and the architecture catching it.

The reply is labelled **"REPLAYED REPLY, NOT A LIVE MODEL CALL: A MODEL GIVING A FALSE
ALL-CLEAR"**, because a live model cannot be relied on to misbehave on cue and editing until it
does would be worse. The prose reads *"Happy to help. [A claim here was withheld; see the
ingredient list.]"* three times over.

Then the panel explains each withholding, including the one that matters most:

> Withheld a claim about the `Turkey club` — the phrase was `dairy-free`. **The checker found a
> conflict for this item.**

And two it withheld without knowing either way, each ending *"That does not mean it is false."*
That sentence is the honest cost: the gate suppresses true statements as well as false ones.
Beneath it, the verdict cards the guest should read instead.

### 3 — `3-a-refusal-in-the-validators-own-words.jpg`

**A refusal, watched rather than taken on trust.** The site publishes three deliberately broken
networks so this can be demonstrated. Loading `/broken/invalid` gives:

> Refused: the published network below is not valid, so it was not run. The validator reported
> one problem with it.
> The network that was read, then what the validator said about it — copied exactly from the
> published document and kept apart from our own words, **because this site did not write them**

…then the URL and `metadata.front_man names 'concierge', which is not an agent in this network`,
each in its own fenced block. The frame also catches the replayed reply below it.

### 4 — `4-nothing-is-being-checked-yet.jpg`

**The quietest shot, and the one no other entry will have.** Before anything is ticked: dishes
with **no verdict cards at all**, and a line saying why — *"Nothing is being checked yet. Tick
what you avoid and a verdict appears beside every dish — no account, no key, no assistant."*

Two dishes in frame also read *"Contains unknown: bakery glaze has no published ingredient
list."* The site does not pretend to have checked something you have not asked about, and it does
not pretend to know an ingredient nobody published.
