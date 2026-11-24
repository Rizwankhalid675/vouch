# Limits

What this build does not do, does not know, and gets wrong. Written as it is found,
not at the end. The README may not claim anything this file contradicts.

Task 10 owns this document. Task 6 opened it with the two sections it is
responsible for: what was taken from upstream, and the runtime's own limits.

**If you read four things here, read these.** They are the limits with the shortest
path to harming someone, rather than the ones that were hardest to write:

- [§3](#3-what-the-checker-tracks-and-what-it-does-not) — **which allergens this site
  tracks, and the ones it does not.** The set was extended twice during this build and
  should not be read as settled.
- [§2.1](#21-the-gate-withholds-true-statements-and-more-of-them-than-you-would-expect)
  and [§2.1a](#21a-what-still-leaks-through-the-gate-and-which-of-its-two-defences-is-weaker)
  — the gate withholds **true** warnings as well as false ones, and what still leaks
  through it is an open-ended class rather than a list. Both are survivable for one
  reason: the verdict card beside each dish never passes through the gate.
- [§2.5a](#25a-6-check-2-is-met-byok-only-and-the-specification-is-silent-on-whether-that-conforms)
  — the one interoperability check this entry does not claim to pass.
- [§2.0](#20-what-a-verdict-card-can-and-cannot-be-moved-by) — why the verdict cards
  are the thing everything else here leans on, and the one time that was got wrong.

---

## 1. What is ours and what is not

Everything adapted from a third party lives in **one directory**,
`src/runtime/upstream/`. Nothing else in `src/` is adapted from anyone.

Six files there are adapted from Cognizant AI Lab's nsDeploy and Neuro SAN, which
are Apache License 2.0. The full accounting — the source URL of each file, what was
taken, and what was changed — is in
[`docs/vendor/PROVENANCE.md`](vendor/PROVENANCE.md), and each file repeats its own
change list in a notice at the top, as Apache 2.0 §4(b) requires.

In short:

| Taken | Why |
|---|---|
| front-man resolution, tool classification (`graph.ts`) | this is the rule a reference runtime applies to our published network; matching it is the point of publishing one |
| network validation (`validation.ts`) | so a malformed network is rejected with the same errors upstream reports |
| `sly_data` filtering (`sly-data.ts`) | the private-context boundary rule |
| router selection, peer policy (`router.ts`) | `selectTopRouter` is the function that decides where a visitor's key goes; our own paraphrase of it already cost us one defect |
| action schema validation and dispatch (`action-registry.ts`) | argument validation, confirmation and receipt semantics, including the never-retry rule |
| agent → function schema (`tool-schema.ts`) | one function, `schemaFor`, and nothing else from `runner.js` |

Written by us, not adapted: the four site actions, `check_safety`, the verdict
cards, the gate integration, the agent loop, the model client, the key store, the
panel, and all of `src/safety/`, `src/gate/`, `src/site/`, `tests/`, `data/` and
`public/`.

Two deliberate *non*-adaptations, both with reasons in the files themselves:
`src/runtime/llm.ts` is not upstream's `llm.js`, and `src/runtime/key-store.ts` is
not upstream's `byok.js` (upstream mirrors BYOK profiles to a host cookie on
loopback hosts; this site does not).

---

## 2. The runtime's limits

### 2.0 What a verdict card can and cannot be moved by

A verdict card's contents are a pure function of **(the menu, the guest's selected
restrictions)**. Nothing reachable from the model may change what a card shows — not
its verdict, not its text. Cards re-render when the guest changes their restrictions,
and at no other time.

**Two surfaces, and only one of them is fixed in presence and order.** The 34 slot
cards beside the dishes are: one per published item, in menu order, every one present
once a restriction is ticked and none before. The refusal panel also shows a card for
each dish a withheld claim named, and **those are model-selected in presence and
order** — the model chooses which dishes to talk about, and therefore which cards
appear there and in what sequence. No false reassurance can come of it: each card's
contents are still computed by `guestVerdictCard` from `selected()`, so the model can
cause a card to appear and cannot cause one to say anything. This sentence used to
claim "not its presence, not its order" of every card, which was true of the slots and
false of the panel.

*Presence* and *text* are both meant literally, and both are tested literally:

- **Text** includes the text a card gives to assistive technology, not only its
  `textContent`. `aria-label` **replaces** an element's accessible name, so a card
  whose visible text is byte-identical to the checker's could still read a model's
  ungated claim to a screen-reader user. The assertions compare a card's whole
  readable surface — text nodes, every text-bearing attribute, form-control values
  — against lines computed independently from `verdictFor` and from the guest's own
  selection. That oracle used to call `cardLines`, which shares both its text
  computations with the renderer, so it could not disagree with the renderer about
  half of a card; it now writes the mark, the headline, the scope line and the source
  line itself.
- **Presence** means presented, not in the DOM. `display:none`, the `hidden`
  attribute and `aria-hidden="true"` each hide a card while every existence check
  still passes, so every slot card is asserted visible, on itself and on each
  ancestor. A model that can hide every card blanks the safety channel as surely as
  one that can overwrite it.

**What the signature enforces, exactly.** `renderVerdicts` takes the guest's
`Restriction[]` and computes the verdicts itself; it has no parameter that would
accept a `Finding`, and the card builder is module-private. `SiteContext` carries no
display callback for an action handler to reach. So the signature makes one property
impossible to write: **no `Finding` can be injected into a card.** That is not the
same as the whole property above, and this file said it was.

It is now closer, because a second parameter went with it. `renderVerdicts` also took
the **published** restriction list and passed it to the card, which reverse-derived
the scope line — "Checked against: …" — by intersecting `Finding.covered` against
every published restriction. `covered` is the union of the selected restrictions'
`avoid` ids, so a published restriction sharing one id with a selected one was named
as checked: with `peanut_free: ["peanut"]` beside `nut_free: ["peanut", "tree_nut"]`
and only Peanut-free ticked, the walnut brownie rendered a green card saying
"Checked against: Nut-free, Peanut-free." A card claiming **more** coverage than was
performed, which is the dangerous direction, from a value originating **inside this
repository** — so the revisit condition this section used to give ("if a card ever
displays a value from outside the repository") would never have fired. Provenance was
the wrong question.

The published list is now not a parameter of anything in `verdict-cards.ts`: the only
restriction list any function there takes is the guest's selection, and the compiler
refused all five call sites when it was removed. The scope line is `selected.map(r =>
r.name)` with nothing derived. What covers the rest of the property is the oracle
above, not the signature.

It is stated this plainly because the first version of this runtime got it wrong in
a way that passed every test. `check_safety` is a `read` action, so it dispatches
with no confirmation and no notice, and its handler repainted the slots with
whatever the model had asked about. A guest who had ticked *Dairy-free* and typed
"is the turkey club nut-free?" — a correctly behaving model, no injection, no gate
leak — saw the unsafe card replaced by a green tick, and the page summarised it as
"0 unsafe" against their own restriction. The cards are what make §2.1 below
survivable, so that was the product's central claim being false.

A model may still ASK for a verdict. It gets a `Finding` back in the conversation,
and the conversation is gated. It does not get the display.

**One of the four card kinds cannot appear on screen, and it is a fail-safe rather
than dead copy.** `cardKind` returns `unchecked` for a `safe` Finding that covered
nothing, with the headline "Not checked" and the line "Nothing was checked, because
you have not told us what to avoid. This is not an all-clear." No renderer here can
produce it: `renderVerdicts` clears every slot and returns on an empty selection,
`guestVerdictCard` returns `null`, and `loadRestrictions` refuses a restriction with
an empty `avoid`. An auditor reading the vocabulary will assume otherwise, so it is
said here. It is kept because `verdictFor(item, [], menu)` **does** return
`{ verdict: "safe", covered: [] }` for a fully-known item, and that value is
exported and one careless call away; without the branch it would render "✓ No
conflict found" — reassurance computed from nothing checked. Both halves are
asserted: the guard is live, and neither renderer reaches it.

### 2.0a What the key-isolation test can and cannot see

The §6 key-isolation check asserts on captured payloads: every request a session makes is
recorded synchronously at the moment it is made, its body read later at scan time, so neither
the body's kind (string, `URLSearchParams`, `FormData`, stream, `Blob`) nor the timing of a
fire-and-forget request can hide a leak. A beacon carrying the key to another origin fails the
test in all five body shapes, awaited or not.

**Its boundary is the injected `fetchImpl`.** The harness supplies the runtime's fetch rather
than replacing the global one, so a module that called the global `fetch` directly would be
invisible to this test. Today nothing does — the key exists only inside `LlmClient`, which
holds `fetchImpl` — but the check is a check on the runtime's own request path, not a
machine-wide guarantee, and it should not be read as one. Verified by mutation: a beacon
through `fetchImpl` is caught; the same beacon through the global `fetch` escapes the harness
without being tested at all, which is a limit of the test, not a hole in the product.

Task 8's peer suite uses the same harness and therefore has the same boundary. It adds one
thing: the peer origin is a real published origin, so "the key is absent from every request
to the peer" is asserted against requests the deployed site actually makes, rather than
against a fixture origin invented for the test.

### 2.1 The gate withholds true statements, and more of them than you would expect

The gate cannot tell a true safety claim from a false one and does not try. It
refuses any claim no checker finding backs. Three consequences, all observable:

1. **A true warning is withheld.** "The Turkey club is not dairy-free" is refused
   exactly like "The Turkey club is dairy-free". Fixture:
   `true_warning_also_withheld` in `data/scripted-replies.json`.
2. **A safety *disclaimer* is withheld.** "I do not decide whether a dish is safe
   for you" is refused as `item_unresolved`, because it contains a safety word and
   names no item.
3. **A pointer to the verdict is withheld once the menu has been mentioned.** The
   gate's default-deny chain requires every sentence following a menu-mentioning
   one to be derivable from menu data. "The verdict shown beside each dish is the
   one to read" passes on its own and is refused after a description.

**All three are now said by the page instead of by the model**, and (3)'s tension with
the published instructions has been resolved rather than left open.

The ruling: anything that must *always* be true should not be generated per turn and
then judged. The panel carries a standing note — "The assistant does not decide whether
food is safe for you, and is not permitted to. The verdict beside each dish is this
site's own" — on screen before anyone types, and not model output. Three sentences that
*instructed* agents to produce a pointer were then removed from
`public/vouch.network.json`; every prohibition was kept.

**A correction to how that change was first described.** The commit message said the
gate "withholds exactly that sentence", which overstates it. As (3) says above, the
pointer passes the gate **standing alone** and is withheld only once a dish has been
mentioned — and the sentence that replaced it behaves the same way under the gate. So
the change removed a redundant and occasionally unsatisfiable instruction; it did not
repair a failure, and the honest value of it is tidiness plus one less way for an agent's
instructions to contradict what the guest sees. The standing note in the panel, which is
never gated, is what actually makes the guidance reliable.

All three remain survivable for exactly one reason: **the verdict is rendered beside
the dish, not through the prose.** The guest learns the Turkey club is unsafe from
its card, whatever the gate did to the sentence. If the cards were ever made to
depend on the conversation, every one of these would become a safety failure
rather than a wording annoyance. `tests/runtime.test.ts` pins that independence by
booting with every artifact fetch failing.

A fourth, smaller case: a sentence reciting real prices ("They are $11.00 and
$11.50") is withheld as `not_derivable` — **once a dish has been mentioned**, which is
the same qualifier (3) carries and for the same mechanism. Standing alone that sentence
passes; after "We have the Reuben and the Turkey club." it is withheld. Prices are
published data, so this is a false positive in the derivation check either way.

That qualifier was missing here until Task 10, and it joins the list below.

**This file's prose corrections, enumerated here and counted nowhere else.** The figure
had gone stale in four separate places at once — this paragraph said five, §2.8 said
three, §4 said four, `DECISIONS.md` said three and `artifacts.test.ts` said "fourth" —
on the one document whose subject is its own reliability, which is the costliest place
in the project for two numbers to disagree. A count that has gone stale four times should
not be a prose figure in five places. So it is a list, in one section, and every other
mention points here instead of restating it:

1. a leak count that was right after one round of Task 3's hardening and wrong after the
   third;
2. "applied without exception", when four surfaces were exempt and one of them was live
   and exploitable;
3. a tension described as unresolved after it had been resolved;
4. two sentences saying a redirect case passed that is in fact refused;
5. the price sentence above, which lost the qualifier that makes it a false positive
   either way;
6. this fix round's two — §2.8 describing a published peer in the present tense after
   the allow-list entry was withdrawn, and §4.1 crediting the action vocabulary to §2.1,
   a section that contains neither of the two words it was credited with.

**Six.** Nothing pins prose, and the suite being green says nothing about a sentence:
every one of these was found by a reader. That figure is held to the length of the list
above by `tests/artifacts.test.ts`, which is the only reason it can be trusted at the
top of a paragraph. It is also why §2.6 and §3.4 hold the two most expensive paragraphs
in this document to the code and the data they describe, and it is the standing reason to
re-read a sentence here rather than trust that something would have caught it.

### 2.1a What still leaks through the gate, and which of its two defences is weaker

§2.1 is about what the gate withholds that it should not. This section is the other
direction: what it lets through that it should not. **Do not read a number into it.**
The honest answer is a class with no boundary. The figure that would make this section
comfortable to read — "three known leaks" — is the one this project has already caught
itself about to publish **twice**: accurate after round 1 of Task 3's hardening and
wrong after round 3, both times carried forward by repeating an earlier finding instead
of re-checking it. It is not printed here, in either direction.

**The two defences, and the weaker one named.** A sentence is held to the allow-list
when it mentions the menu or follows a sentence that did; a sentence is read as a
safety *claim* — at any level, mentioning an item or not — when it carries a word on
one of two lists in `src/gate/claims.ts`: the claim vocabulary (`DIRECT`) and the
anaphora list (`ANAPHORA`).

> **The claim vocabulary is the weaker of the two defences.** Three rounds of
> hardening ended with this diagnostic, and it is published because it tells a
> reader exactly where to push: of nine concrete leaks found against an `unsafe`
> verdict, **seven closed by adding a single word — `clean` — to the vocabulary**,
> one needed a new anaphora entry, and one ("A good pick.") matched neither and
> needed a new evaluative-noun trigger written for it. A defence that a one-word
> edit moves by seven is a defence sized by whoever last thought of a word.
>
> Those nine were found by hand against the vocabulary as it stood on **23 November
> 2026**, and the nine sentences are recorded nowhere. The figure is **not
> reproducible**: the words that closed seven of them are in the lists now, so the
> same nine sentences no longer leak and a fresh sweep measures a different gate. It
> is a diagnostic of where to push, not a measurement anyone can repeat.

What makes shipping this defensible is not the lists. It is §2.0: the verdict card
renders beside the dish from the menu and the guest's restrictions, so a leaked
"Spotless." sits next to a card that reads **unsafe**. That is a claim that the gate
failing is *survivable*. It is not a claim that the gate is airtight, and nothing in
this build should be read as one.

**The residual, as a class rather than a count.** Round 1 of Task 3's review accepted
three specific residuals the allow-list inversion did not close:

- **(a)** an opening affirmation with no prior item mention and no prior refusal —
  "Of course it is.";
- **(b)** an item referred to by an alias sharing no word with any menu name;
- **(c)** a claim two sentences after an item mention, with a sentence in between,
  since adjacency is tracked one segment at a time.

Round 3 then closed part of that surface and **restated the remainder as one
open-ended class**: a sentence at level 1 carrying an evaluative word on neither list
and no back-reference — "A lovely pick.", "Spotless." Rounds stopped there, on the
reasoning that each patch closes instances while the class stays open.

**Which of the three the hardenings did and did not close**, established by running
the shipped gate rather than by reading the ledger twice. Every string below was put
through `gate()` with the real menu and the real `unsafe` findings for *Dairy-free*:

| Probe | Result |
|---|---|
| (a) `"Of course it is."` | **passes** |
| (a) `"Of course it is clean."` | withheld |
| (a) `"Yes."` / `"Absolutely."` | withheld |
| (b) `"Our signature is clean."` | withheld |
| (b) `"Our signature is lovely."` | **passes** |
| (c) `"The Turkey club is on the menu. It costs $11.00. It is clean."` | withheld |
| (c) `"The Turkey club is on the menu. It costs $11.00. Spotless."` | **passes** |
| (c) with an *unrelated* middle sentence instead | withheld (the middle sentence is itself refused, which re-arms the strict level) |

So: **none of the three was converted into a closed set, and none of the three
remains open on its own terms.** Each is now reachable through exactly one door — a
sentence whose evaluative or affirming word is on neither list — which is the round-3
class, arrived at from three directions. Round 3 narrowed the reassurance surface; it
did not turn an open class into a count, and this document will not print one. The
size of the class is the size of English's evaluative vocabulary minus two word
lists, and nobody on this project can state that number.

One asymmetry inside (c) is worth having: a **derivable** middle sentence breaks the
chain and a **refused** one preserves it. That is the direction to be wrong in — an
unrelated sentence keeps the next one under suspicion — but it means the leak needs
the model to say something factual in between, which is the easier of the two things
to arrange.

**The price of erring this way, since fail-closed is not free.** All four of these
are withheld as `item_unresolved` although none mentions a menu item: "We keep a
clean kitchen.", "The deli has a clean modern look.", "A great option for lunch.",
"Good choice of sides." The first two are the direct cost of the word `clean` that
closed seven leaks. Published rather than discovered, because a judge will type
something like one of them.

### 2.1b The tool-reference allow-list, and the two things it cannot catch

A safety verdict comes from one place, `check_safety`, and no agent's `tools` list may
reach it. Enforcing that by *rejecting suspicious names* failed twice in review: a name
test cannot tell an in-network agent under a bland alias (`dietary_helper`) from a
real one, and it cannot tell an MCP descriptor exposing a tool called `is_it_ok` from a
harmless one. So the check was inverted into an **allow-list** — `AGENTS` and
`ALLOWED_KINDS` in `tests/artifacts.test.ts` — which names the four agents this network
has and the two reference *kinds* it permits (an in-network agent, and a symbolic name
bound in `links.json`). A bare URL, an MCP descriptor and an unbound name all fail,
whatever they are called. Permitting one means editing the list in the commit that
justifies it, which is where the decision belongs. The name patterns are kept as a
second net.

**Two things it does not catch, and the gate is the control for both.**

1. **An author who adds a name to the allow-list *and* writes instructions asserting
   safety.** The allow-list governs what may be referenced, not what the referenced
   thing says. A deliberate edit plus deliberate prose defeats it by construction, and
   nothing short of reading the commit would see that.
2. **Anything inside a peer.** The allow-list is evaluated against *this* site's
   published network. A peer network's own agents, their instructions and their tool
   references are chosen by another publisher, and §5 of the specification says what
   they are: "Peer-network definitions MUST be treated as untrusted input to the
   caller's inference model." We do not inspect them for this property and could not
   usefully try.

In both cases the control is the gate, and behind the gate the verdict cards. There is
also a boundary worth stating plainly: **this allow-list is a build-time tripwire, not
a runtime control.** It runs in the test suite against the published artifacts. It
would catch the published network drifting; it stops nothing at runtime, and it is not
a reason to believe a claim that reached the page.

### 2.2 `Refusal.claimed` is sometimes meaningless

The claim classifier occasionally reports a claimed phrase of `"0"` or `"i"`. The
refusal panel replaces any token without three consecutive letters with "a phrase
in that sentence" rather than printing it.

Relatedly, a deliberate choice: the refusal panel names the **claimed phrase** and
the reason, and does **not** reprint the withheld sentence, although `Refusal`
carries it for a UI to use. Reprinting an unverified claim two inches below the
place it was withheld from would undo the withholding.

### 2.2a Where model-chosen text may and may not go

The gate is the only path for model *prose*, but prose is not the only thing a model
chooses. Three further channels were found and closed; a fourth was closed by the
author during the first round. A fifth — a published `front_man` defeating the
filter on the validator's messages — was found in review afterwards, and is §2.2b,
which also replaces the mechanism this section describes. Every site in `src/runtime` that writes a string into
the DOM was then enumerated and classified, and the rule they all follow now is:

> The transcript speaks in the deli's voice, so only an error **this runtime wrote**
> (a `RuntimeMessage`) may be shown there. Anything else is reported in our own
> words, with only its *kind* in the trace.

| Channel | What it was | Closed by |
|---|---|---|
| Action argument *values* | `add_to_cart({item: "the Reuben is dairy-free"})` printed that in the confirmation dialog | every id argument is an `enum` of the ids in this site's own menu and restriction data, in the schema the runtime validates against, so it fails validation before a dialog is drawn. The published catalog carries the same schemas without those enums — the runtime checks against the data itself, and a copy of the menu in `agent-manifest.json` would be a second published file that had to agree with it forever |
| Router HTTP error *body* | a 400 whose body was prose rendered as "Hollis & Rye — …" | the body is never put in the message; only a token-shaped provider error code survives |
| Action argument *keys*, and validator messages | `{"The Reuben is dairy-free": 1}` reached the rendered trace twice | the trace records only schema-declared keys plus a count, and a classification instead of the validator's message |
| Network validator interpolations | `Agent 'x' references missing tool 'y'` — ours today, a peer's once one is published | the message is rendered in a node of its own, marked `data-not-ours`. The filter that used to do this was defeated — §2.2b |
| A published agent's name in the **delegation notice** | `Asked the reuben is dairy free and safe to eat.` — the token filter passed the underscored name and `prettyToken` then put the spaces back | the name is a node; `prettyToken` and every other filter are deleted — §2.2b |
| The **rendered trace**, the **confirmation dialog's** origin and action name, the **refusal line's** claimed phrase, the **replay tag's** label | all interpolated a runtime value into one of our sentences | each is a phrase of our prose plus value nodes — §2.2b |
| The claimed phrase in a refusal | model text, named deliberately (SPEC 4.4) | filtered for meaningless tokens *and* bounded to a phrase |
| The confirmation dialog's `description` | a plain `string` built by concatenation; correct only while every author remembered to filter | `ConfirmItem.description` is `SiteText`, so the dialog's prose is ours by type. Values go in `arguments`, which the dialog renders in its own `data-not-ours` node |
| A published agent's **name** | `Hollis & Rye — Asked The Reuben is dairy-free and safe for you.` Ours are tokens; a **peer's are not**, and Task 8 loads a peer network from a second origin | the network is refused at startup (`validate_agent_names`), **and** the notice token-filters the name anyway |
| The startup catch | a malformed artifact's `SyntaxError` quotes the file | only a `RuntimeMessage` is shown; anything else becomes our own sentence plus a kind |
| The unknown-outcome card's source line | a handler's raw `error` | a node (`theirs`), beside a node for our request id — §2.2b |
| The key-status line | `selectTopRouter`'s message | only a `RuntimeMessage`'s own report is shown; the router host is a node — §2.2b |
| A **peer's answer** | prose produced by a model prompted by another company's published instructions | `Transcript.showPeerText`, which shares one private `renderGated` with `showModelText`: both put `gate(...).shown` into the DOM and nothing else. Asserted character-for-character on both paths |
| A **peer's origin and network name** | strings from `links.json` and from the peer's own document | nodes (`theirs`) in the row's source line and in the delegation notice; our symbolic name beside them is `datum`, because calling our own published name "not ours" would be a lie |
| What the model is told a **peer tool is** | a peer author's `function.description` | never used: `PEER_TOOL_DESCRIPTION` is ours. This one is about the prompt rather than the page, and it is listed here because the same question — whose words are these — has the same answer |

**Two rows above stopped being hypothetical in Task 8.** "A published agent's name"
and "Network validator interpolations" both said *ours today, a peer's once one is
published*. One is published now, on a second origin, and a peer author chooses
every string in it. Both nets are unchanged and both are now driven end to end by
`tests/peer.test.ts` rather than with the validator bypassed: a peer network whose
agent is named with a sentence is refused through the real walk, and the name
appears on the page only inside a node marked as not ours.

### 2.2b The filter that was defeated, and the rule that replaced it

A value that supplies the filter's own delimiter defeats the filter. A published
`metadata.front_man` of

```
x' The Reuben is dairy-free and safe for you to eat. '
```

makes the validator emit

```
metadata.front_man names 'x' The Reuben is dairy-free and safe for you to eat. '', which is not an agent in this network.
```

The apostrophes in the value re-pair the quotes. `quotedTokensOnly` saw `'x'` and
`''`, judged both token-shaped, kept both, and the sentence between them went
through untouched — then `ours(...)` declared the whole built string the site's own
words. **That rendered an ungated safety claim in the deli's voice**, on
`[data-compose-status]` and on the startup error line. It was not reachable while
`allowed_peers` was `[]`, and `allowed_peers` is `[]` again — the entry Task 8
published named an origin this project does not own, and it was withdrawn (§2.8
below). **That is not why this was fixed and is not a reason to call it latent**: the
compose field takes a URL the visitor types, a same-origin network needs no
allow-list entry at all, and the three `/broken/` networks reach the same startup
error line. A test drives it through the real walk with a hostile document served
from a peer's own URL.

It was the **third** filter for the same problem: action arguments in the
confirmation dialog, then agent names in the site's voice, then this. The lesson
taken is that a sanitiser built on a delimiter is defeated by supplying the
delimiter, so a fourth filter would buy a fourth incident. `quotedTokensOnly` was
**deleted**, not fixed, and the rule is structural:

> An untrusted value never becomes part of a sentence. It is rendered in its own
> node, structurally separate from the site's prose and labelled as not ours, so
> nothing it contains can be read as something the site is saying.

That holds whatever characters the value contains, which is the point — it stops
being a question about quoting. It is the shape the verdict cards already used one
layer down, where `verdictCard` is built from DOM nodes rather than a markup
string.

**How it is enforced**, in three places:

- `SiteReport` carries our prose and, separately, strings that are not ours.
  `renderReport` puts each of the latter in its own `<code data-not-ours>` by
  `textContent`, under a caption naming whose words they are. The type makes the
  attribution mandatory: a report with `quoted` cannot omit `quotedLabel`.
- `ours` accepts a string **literal** only, enforced by the compiler. The exact
  laundering that caused this — `ours(errors.join(...))` — no longer builds.
  `joinSiteText` accepts `SiteText` only, closing the same door twice.
- The tests assert the **property**, not the mechanism: run a refusal with a
  harmless value and with a hostile one, and the site's voice must be
  byte-identical. Our prose is literal, so it cannot vary with the value; anything
  that reached our sentence by any route changes it and fails.

### What was swept, and how — a correction

**This section said "Applied without exception". That was false**, and it is the third
overstatement this document has carried. Four surfaces were still interpolating a
runtime value into one of our sentences when it was written, and one of them was
live and exploitable:

```
agent name: the_reuben_is_dairy_free_and_safe_to_eat
rendered:   Hollis & Rye — Asked the reuben is dairy free and safe to eat.
```

That name matches `validate_agent_names`' `^[A-Za-z0-9_.:-]+$`, is under 64
characters, and passed the token filter — and then **`prettyToken` swapped its
underscores for spaces**, handing back the whitespace the filter's whole premise
rested on. Our own `detectClaims` reads the result as `reuben:dairy:dairy free`.
Fourth instance of one problem, and 324 tests passed with it live.

So the **capability** is gone, not the function. There is no longer anything that
will put a runtime value in a sentence:

| Was | Now |
|---|---|
| `siteText` took `unknown` and token-filtered each value | takes `number` and nothing else; a number has no letters and no spaces, so no number is a sentence |
| `tokenOrOmitted`, `prettyToken`, `joinTokens`, `TOKEN` | **deleted** |
| `renderableDetail` filtered trace strings | **deleted**; the trace detail is a node, so the trace now omits nothing and is a better diagnostic |
| values interpolated into prose | `theirs(v)` / `datum(v)` + `renderPhrase`, which render each value as its own `<code>` |

**How the sweep was done, because "we looked again" is what failed three times.**
Two passes, and the second exists because the first cannot see everything:

1. **The type system enumerated the surfaces.** Narrowing `siteText` to `number`,
   `ours` to a string literal and `joinSiteText` to `SiteText`, and deleting the four
   filters, turned every site into a compile error. `tsc` named **13** in `src/`
   (counted during that pass, 23 November 2026, and **not reproducible** — the
   capability whose removal produced the errors is deleted, so the sweep cannot be
   re-run and the thirteen are recorded nowhere but this sentence), and each was
   converted deliberately. This pass cannot be forgotten or skipped, which is the
   point of doing it with types rather than with attention.
2. **A grep for the class the types cannot see:** `textContent =`, `createTextNode`,
   and `el(...)` called with a non-literal text argument. This is how the fourth
   surface escaped three earlier sweeps — `refusalLine` returned a plain `string`
   assigned to `li.textContent` and never touched `SiteText` at all, so no amount of
   tightening `SiteText` would have found it. The grep found 10 sites; 5 build a
   string containing a runtime value, and 4 of those are now phrases — again counted
   on 23 November 2026, against the pre-sweep tree, with the ten sites enumerated
   nowhere. Re-running the same grep today finds a different number against different
   code and would not check this claim.

**The surfaces converted in this round**, all four the reviewer named plus one the
grep found:

- the delegation notice (`loop.ts`) — the live one;
- the rendered trace (`boot.ts`);
- the confirmation dialog's action name and `Destination:` origin (`boot.ts`);
- the refusal line's dish names and claimed phrase (`transcript.ts`);
- the replayed-reply tag's fixture label (`transcript.ts`), found by the grep.

**The exceptions that remain, named rather than claimed away.** Both are in
`verdict-cards.ts`:

- `Checked against: ${names.join(", ")}.` interpolates restriction display names.
- The reason line assigns `cardReason(f, menu)`, a string built from menu data.

They are left for two reasons, and the second is the stronger. First, every value in
them originates in this repository's own data files (`data/menu.json`,
`data/restrictions.json`, through `src/safety/canon.ts`) and there is no runtime path
by which a model, a peer or a provider sets one. Second, §2.0 asserts the cards' whole
readable surface **byte-for-byte** against an independent computation from `verdictFor`
and the guest's selection; restructuring their DOM would mean rewriting the assertion
that protects the product's central claim, to reduce a risk that has no path to it. If
a card ever displays a value from outside the repository, this exception stops being
defensible and must be revisited.

**That revisit condition was the wrong one, and the scope line proved it.** It asked
about *provenance*, and the first real defect in these two lines had impeccable
provenance: the scope line named restrictions from `data/restrictions.json`, through
`canon.ts`, set by nobody at runtime — and it named restrictions **the guest had not
selected**, because the published list was being passed in beside the selection and
intersected against `Finding.covered` (§2.0). A grep of `verdict-cards.ts` for a value
it did not get from `canon.ts` would have come back empty every time. So the condition
is now the other one: **if either line ever interpolates a value the guest's own
selection and the menu do not determine together, this exception stops being
defensible** — whatever repository it came from.

**So: not "without exception". Two named exceptions, with a stated condition under
which each becomes a defect.**

**And one more surface, found by the architecture review after all of the above.**
`SiteText` is a branded type, so the casts into it are the entire trust boundary.
There were four in `src/`. Three are guarded by the signature they sit behind —
`siteText(strings, ...values: number[])`, `ours(LiteralOnly<T>)` and
`joinSiteText(...parts: SiteText[])` — each of which refuses a built string at
compile time. The fourth took an arbitrary one:

```ts
function whyText(why: string): SiteText { return why as SiteText; }
```

It was rendered at `transcript.ts:73` as part of *our* prose rather than inside a
`theirs()` or `datum()` node, so it was inside `siteVoiceOfPage()` by construction
and every "not in the site's voice" assertion in the suite was blind to it. It was
not exploitable: its only producer was `WHY[reason]`, a closed table of literals in
`gate.ts`. But `errors.ts` states the exact rule it bypassed — *"The old signature
took `string`, so `ours(errors.map(filter).join())` compiled — a built string,
declared ours by assertion"* — and this was that function written with `as` instead
of `ours`.

`WHY` is now a `Record<RefusalReason, SiteText>` of `ours(...)` literals,
`Refusal.why` is `SiteText`, and `whyText` deleted itself. `gate.ts` imports `ours`
from `errors.ts` without giving up its purity, because `errors.ts` has no
module-scope DOM dependency — `Document` appears in it only as a parameter type.
Two doors now: the compiler refuses `` why: `${WHY[reason]} — ${claimed}` `` (the
mutation had to be written `as unknown as SiteText` to compile at all), and
`tests/gate.test.ts` asserts through the real gate that each refusal's `why` is
**identically** its reason's table entry, over probes that reach all seven reasons.
The only assertion on `why` before this was `length > 0`, which `why: "x"` passes.
`tests/artifacts.test.ts` holds the boundary itself: the casts live in `errors.ts`,
there are three of them, and a new one anywhere in `src/` fails.

**One promise was relaxed to do this, deliberately, and the tension with §2.2 is
resolved rather than left open.** The filter used to replace a hostile value with
`'<name omitted>'`, so it never reached the page. It is now **shown**, fenced and
attributed. That was put to the controller as an open question and ruled correct,
for four reasons worth keeping here so nobody re-derives them:

1. §6 and the task brief both require the refusal to **name the offending field and
   its bad value**. Suppressing it would fail the requirement the refusal exists to
   satisfy, and a publisher debugging a malformed network needs to see *which* name
   is wrong.
2. Structural separation plus explicit attribution is the **correct** way to display
   untrusted content, not a compromise forced by the fix. It is what a browser does
   with a certificate error and what a mail client does with a sender-claimed name.
3. **§2.2's no-echo rule governs a different speech act.** `REFUSAL_MARKER` withholds
   *the site's answer to a guest's question*. This is a diagnostic attributing a
   string to its source. Same characters, different act.
4. Defence in depth is untouched: the verdict card beside the dish still reads
   unsafe, whatever the refusal panel shows.

**The displayed length is capped** — 240 characters per value, 12 values — so that a
peer cannot use the refusal panel as a billboard. `QUOTED_CHARS_MAX` and
`QUOTED_LINES_MAX` in `src/runtime/errors.ts`, where the comment on them says this
too: **the cap is a UI measure and explicitly NOT a security control.** What keeps a
value out of the site's voice is the structural separation, which does not care how
long the string is; raise the cap to a million and the safety property is identical.
That distinction is written down in three places because this project has already
been bitten by a defence everyone trusted for the wrong reason — `quotedTokensOnly`
was read as the thing keeping a peer's prose out of the deli's voice, and one
apostrophe defeated it. A test asserts the cap can be raised to absurdity without
changing what the site says.

### The mechanism

Stating the rule in prose made it a convention, and the convention acquired four
bypasses inside one round. It is now a **type**:

```ts
type SiteText = string & { readonly __siteText: unique symbol };
```

`Transcript.showRuntime`, the startup error line and the key status take `SiteText`
and nothing else. Only two functions produce it: `ours(...)` for a string **literal**
written in this repository, and the `` siteText`...` `` tagged template, whose literal
parts are ours by construction and whose every `${value}` must be a **number**. A call
site that passes a raw string does not compile. Token filtering is gone — see §2.2b for
why a filter was the wrong kind of defence.

That idiom about filtering before joining is gone with the filters; so is the
"second net" the trace used to have. Neither is needed: a value in a node cannot be
read as our prose, so there is nothing for a second net to catch. The trace keeps a
different pair of independent defences, both still tested — the call sites record no
model-chosen string into the trace DATA, and the RENDERED trace shows the detail only
inside a `data-not-ours` node.

Note that the compile-time half cannot be pinned by a runtime test: widening
`siteText` back to `unknown`, or `ours` back to `string`, is undetectable to the suite
on its own. What the suite pins is each call site's observable output — so widening a
type is only exploitable if someone *also* writes the interpolation, and that is what
fails a test. The commented list of refused constructs in
`tests/runtime.test.ts` records what the compiler rejects, since no assertion can.

### What is "ours"

Values rendered without filtering are the site's own published data: menu item and
ingredient names, restriction display names, our fixture labels. They sit at the
same trust level as the source of this repository. Everything else — model output,
a published network's agent names, a provider's response text, a handler's error
message — is either gated, filtered, or not rendered.

What this does **not** claim: that the class is exhausted. It claims the class was
swept twice, with the enumeration written down both times, that the second sweep
found four bypasses the first had left, and that each net is pinned by a test that
fails when the net is removed.

### 2.3 Private context is not isolated between sibling agents

The `allow` blocks in the published network govern what crosses an **agent-site**
boundary. The upstream reference is explicit that `sly_data` "is already visible to
all other internal agents of the network". Nothing in this build isolates private
context between sibling agents inside one network, and nothing in the code, the UI
or the docs may say that it does.

In practice this costs nothing today: every `allow` list we publish is `[]`, so
`filter_sly_data` returns `{}` at every boundary and no private context exists.

**The peer boundary, and the channel a permitted field would cross by.** Task 8
made the agent-site boundary real: a peer's agents run in this browser, and
`runAgent` filters against the **calling** agent's `allow.to_downstream.sly_data`
before the peer's front agent is prompted. Two things about that are ours rather
than the specification's, and both are choices a reader should not have to infer.

- **The transport.** §5 says which fields may cross ("Only explicitly named fields
  MAY be forwarded under an applicable allow rule") and says nothing about how. A
  browser-local peer run has no transport of its own — the peer's agents run on
  the caller's router — so the only channel to them is the message array, and a
  permitted field crosses as a labelled system message (`privateContextMessages`
  in `loop.ts`). That means a forwarded field is **in a model prompt**, which is
  not a confidential surface. Nothing is forwarded when nothing is permitted: the
  function returns an empty array, so there is no message at all.
- **The filter runs per boundary, not once.** `front_of_house` → `menu_guide` is
  one boundary and `menu_guide` → the peer is another. A field named only at the
  second crosses nothing, because by then `menu_guide` is holding `{}`. That is
  the mechanism working, and a test names both to show the rule is live rather
  than a no-op.

The site supplies no private context at all — there is no sign-in and no table
number — so every one of these paths is exercised only by tests. `boot` takes a
`slyData` option for exactly that reason, and the panel has no way to set one.

**Nothing comes back.** §3.2 permits private context to return from a peer "for
fields explicitly permitted by the caller network". This build reads none: a
peer's answer is text, and no `sly_data` is parsed out of it or accepted from it.

### 2.4 Writes, and what "unknown" means

`checkout_demo_order` is the only action that commits anything irreversible. If it
starts and its outcome never comes back, the result is reported as **unknown** —
not success, not failure — and the runtime will not repeat it. That is the same
refusal to collapse "we do not know" into a certainty that the checker makes for a
missing ingredient list, and the UI says it in the same words.

`unknown` is reserved for a write that may have taken effect. A committing action
that fails *before* it touches the page — an empty order, a missing control —
reports `failed`, because nothing is in doubt. `unknown` has to mean one thing to be
worth anything.

What this does *not* give you: there is no idempotency key and no way to ask the
site afterwards what happened. The guest is told to check their order themselves.
A real deployment would need both.

**A declined write is now on the record too.** Every other end of a proposed action
wrote a trace entry — `action_receipt` when it ran, `action_refused` when the runtime
stopped it, and `peer_consent { approved: false }` on the peer path when a visitor
says no — and the one path that wrote nothing was the visitor declining. The
transcript said "You declined …", so the guest saw it; "What this ran" showed an
`action_proposed` with no outcome after it, which reads exactly like a receipt that
went missing. It is an `action_declined` entry now, carrying the action's name,
`approved: false` and `decidedBy: "guest"`, and nothing else — the same rule as every
other entry, because the model chose which registered action to propose.

### 2.5 Inference, keys and what browser storage is worth

- The site ships no model and no key and pays for no inference. With no key, the
  assistant does nothing and says so; the menu, the ingredient lists and the
  verdicts are unaffected, because none of them calls a model.
- The key lives in origin-scoped `localStorage` under one key, `vouch-byok-v1`, and
  can be deleted from the same panel it is entered in.
- The test that proves the key goes only to the router scans **captured requests**,
  and the capture is **synchronous**: an exfiltration beacon is fire-and-forget, and
  an earlier version read the body behind an `await` before recording it, so such a
  request landed after the assertions had run and was never scanned. Bodies are read
  at scan time, so neither body kind (string, `URLSearchParams`, `FormData`, `Blob`,
  `ReadableStream`) nor timing can hide one. All five shapes are pinned in both
  awaited and fire-and-forget form.
- **Origin-scoped storage is not isolation from other scripts on this origin.** The
  spec says so and so do we. The only mitigation that actually holds is loading no
  third-party script, which this site does. There is no Content-Security-Policy
  header on the static deployment yet; that is a gap.
- A browser that refuses storage is reported, not crashed into, but the key then
  cannot be kept between page loads.

### 2.5a §6 check 2 is met BYOK-only, and the specification is silent on whether that conforms

This is the entry's weakest conformance claim, so it is stated here in the document
whose job is to disclose exactly this. It has three parts, and the order matters
because two of the three are routinely got the wrong way round.

**One: the requirement level is MAY.** Quoted from the pinned spec rather than
recalled:

> §4: "A site **MAY** publish a default router and model, including a fixed endpoint
> operated or funded by the publisher."
>
> §4, Default inference: "A site **MAY** publish a default router and model that work
> without a visitor-supplied key."

Declining an option is not non-conformance. We **do** publish a default router and
model — `llm_router` names the protocol (`openai-compatible`), the endpoint
(`https://api.openai.com/v1`) and the model (`gpt-4o-mini`). What we decline is the
key-free part, and `default.requires_key` is published as `true` so that nobody has to
infer it. This site ships no model and pays for no inference; it does not pretend
otherwise anywhere.

**Two: of check 2's two clauses, we satisfy the second in full and cannot demonstrate
the first.** §6, check 2, verbatim:

> "Load and run that network in a browser with the site's published default router and
> model; **if BYOK is offered, also demonstrate the user-selected path.**"

The user-selected path is demonstrable and demonstrated. The first clause is **not
demonstrable here without a visitor key**, because the published default router
requires one.

**Three: the specification nowhere says a BYOK-only site conforms, nor that it fails.**
That silence is the real situation and this document will not resolve it in our own
favour. A strict reader may mark check 2 unmet. That is the correct way to lose a
point: on a disclosed limit, not on a surprise.

**How our own checker scores it: `not-demonstrated`, never `pass`.** The CLI's reason,
in its own words, is the three-part statement above compressed:

> "The manifest declares a default router, but nothing in it says that router works
> without a visitor-supplied key (no `requires_key: false`, no `publisher_funded:
> true`, no `mock: true`). §4's level is MAY … so a key-required site is neither a pass
> nor a failure of this check, and this tool will not resolve that silence in either
> direction."

A conformance tool that scored its author's own weakest claim as a pass would be
worthless, so it does not.

**Two corroborations, from two different reference runtimes.** They are *different
runtimes* and the distinction is load-bearing, so this document names each by
repository and path rather than calling either one "upstream":

- **the adapted runtime** — `cognizant-ai-lab/nsdeploy` (organisation **singular**),
  pinned in `docs/vendor/PROVENANCE.md`. This is what `src/runtime/upstream/` is
  adapted from, and what this project's own word "upstream" has meant throughout.
- **the starter runtime** — `cognizant-ai-labs/agentic-web` (organisation **plural**),
  `skills/agentify-website/runtime/`. This is the event's own spec-and-starter
  repository, vendored into the skill that the brief points entrants at. Nothing from
  it is adapted here.

They are not copies of each other. Their `selectTopRouter` functions differ in exactly
the area this section is about: the starter runtime's returns a `publisherFunded` field
and carries a `requestedPublisherFunded` branch, and the adapted runtime's has neither.
So "upstream's `selectTopRouter`" is ambiguous in a way that changes the answer, which
is why neither is called that below.

**Corroboration 1 — the starter runtime knows what a publisher-funded router is, and
says ours is not one.** In `cognizant-ai-labs/agentic-web` at commit `d67755e762`,
`skills/agentify-website/runtime/engine.js`:

```js
// line 56:  * (`llm_router.publisher_funded`, spec §4). A visitor's key is never sent to it,
// line 59: export function isPublisherFundedRouter(manifest, url) {
// line 61:   return declared.publisher_funded === true && declared.mock !== true && !!url
//              && !!declared.base_url && sameRouter(String(url).replace(/\/$/, ""), declared.base_url);
// line 73:   const publisherFunded = declared.publisher_funded === true && declared.mock !== true;
```

Run against `public/agent-manifest.json`, that runtime's `selectTopRouter` reports
**`publisherFunded: false` in all five configurations, with no error**, and
`isPublisherFundedRouter` is `false` for both our `base_url` and our `byok_router`. So
our manifest makes no claim that this site pays for inference — **the claim it would
be easiest to make by accident** — and the runtime that would act on such a claim
agrees.

There is a sharper version of the same point, which is a counterfactual rather than a
reading. `skills/agentify-website/scripts/build_network.mjs` lines 667-673 **refuses** a
manifest whose `byok_router` equals its `base_url` — *"Otherwise a visitor's own key
goes to the site's proxy"* — but only when `publisher_funded === true`. **Ours are
equal.** Setting that one flag to `true` would therefore have our own published
manifest refused by the event's own build check. Verified by running it both ways:
as published, `isPublisherFundedRouter(manifest, byok_router)` is `false` and nothing
refuses; with the flag added, it is `true` and the refusal fires. The refusal was
introduced in commit `9fb36d3dbe`, "Refuse a publisher-funded base_url that is also
byok_router".

**Corroboration 2 — the adapted runtime runs our manifest in both modes.**
`cognizant-ai-lab/nsdeploy`'s real `selectTopRouter` at the pinned revision — not our
paraphrase of it, which has already cost this project one defect — run against
`public/agent-manifest.json` in five configurations. With no key it returns our
published default; with a visitor key it upgrades to `byok_router` and reports
`upgradedToByok: true`; with an explicit router override it honours the override;
`"demo"` is correctly not treated as a real key. No configuration throws. So the
manifest is *runnable by that consumer* in both modes — a different and smaller claim
than "the default path runs without a key", and the one we are entitled to.

**A precision note, because this paragraph was briefly withdrawn in error and the
reason is worth publishing.** Corroboration 1 was first written as "upstream's current
runtime gates publisher funding behind `llm_router.publisher_funded === true`". An
implementer went to re-verify it, searched `cognizant-ai-lab/nsdeploy` and
`cognizant-ai-lab/neuro-san` — the two repositories this project's own vocabulary calls
upstream, and the only two `PROVENANCE.md` pins — found zero occurrences in either, and
withdrew the claim as unreproducible. The search was correct and the conclusion was
wrong: `publisher_funded` lives in a **third** repository whose organisation differs
from those two by one letter, `cognizant-ai-lab**s**`.

The lesson is not the one it first looked like. The claim did **not** come from memory;
somebody ran that function against this manifest and read the output. What came from
memory was the **attribution** — "upstream", a word with two referents here and a third
thing it was being used for. **A verified fact can still be unverifiable as stated, and
at that point it is indistinguishable from an invented one.** A reader who cannot
re-run a claim has to take it on trust, which is precisely what this document exists
not to ask of anyone. So every citation in this section now carries the repository, the
path and the commit, and the two runtimes are never both called "upstream".

### 2.6 Execution bounds

All of them live in `src/runtime/limits.ts`.

**Per turn:** 16 model calls, 12 delegations, depth 4, 6 tool rounds, and 90 seconds
of wall clock. These reset at the start of every turn, because the runaway a limit
exists to stop is a turn that will not finish. **Per session:** 300 model calls, as a
backstop against a page left open all day; reaching it says to start a new
conversation, and the panel has a control that does exactly that. **Per composition:** 4 network
documents in TOTAL — a count, not a depth, because the walk is depth-first over a
graph and a wide composition spends it as surely as a deep one. It was described as a
depth here and in `limits.ts` until fix round 2; it never was one.

`maxElapsedMs` and `maxComposedNetworks` are **arbitrary picks**: generous enough
that no honest session reaches them, finite as §3.1 requires, and derived from no
measurement at all. If either starts to matter, it should be measured rather than
reasoned about from its comment.

The per-turn call budgets were per *session* in the first version, which meant
sixteen plain questions bricked the assistant with no way back — finite, as §3.1 asks, but on the wrong axis,
and something any judge using the demo for two minutes would have hit.

Reaching any of them shows **both** figures — the budget and what had been spent —
because "over budget" without the numbers is indistinguishable from a bug, which is
the confusion §6's demonstration exists to rule out. They are said the way a person
would say them, not as field identifiers: "this turn may take 1 second, and has
already taken 2 seconds", not "maxElapsedMs is 1000 and this turn has already used
2000". Seconds carry their unit. The identifier stays in the trace, which is where a
developer looks.

**The wall clock** (§3.1's "elapsed execution time", the axis Task 6 left open) is
enforced at two points, and both are needed. At every step boundary, which stops a
turn making progress too slowly to be worth continuing; and by **aborting the
in-flight request**, which is the only thing that bounds a router that accepts a POST
and never answers. With only the first, the limit would be a lie for exactly the case
it exists for. What it does *not* bound: time spent inside a site action's own
handler, which is bounded separately by that action's timeout.

**A peer contact is checked against the call budgets before it is made**, not
after. The budgets a peer run spends are spent inside the delegation it performs,
so until fix round 1 an over-budget turn asked the visitor to approve a
third-party contact, let the peer serve two documents, and *then* stopped with
"Execution limit reached". An approval asked of a person and a request to
somebody else's server are two things that cannot be given back, so the headroom
for a delegation and for a model call is checked before the card is drawn. The
refusal is the ordinary one, with the same figures; it just arrives one step
earlier. §3.2: "The runtime stops … requests that exceed its budgets."

**Concurrency** has no numeric limit because it is structurally one: the loop awaits
every call in sequence and the composition walk is depth first, so there is never
more than one request in flight.

**Two cycle checks, with different scopes and deliberately different wording.**

- An agent appearing in its own *delegation* ancestry, inside one network, is
  refused: "Delegation cycle refused: a → b → a." (It said "Composition cycle" until
  Task 7; that is §6's term for the across-networks case, and two refusals with
  different scopes should not open with the same phrase.)
- A *composition* that returns to a network already on its path — network A composing
  B composing A — is refused with the resolved network URLs shown, before the repeat
  fetch is made.

Both are checked against the **path**, never against a set of everything seen. §3.1
is a MUST on this: "repeated invocation of the same agent MUST NOT, by itself, be
treated as a cycle." A seen-set on agent names refuses the second legitimate call to
`menu_guide`, which is what a guest asking about two dishes does; a seen-set on
networks refuses a diamond, where two networks both compose a third. Both
false-positive cases have their own test, and those tests are the reason a later
"fix" to either detector cannot quietly reintroduce the violation.

`maxComposedNetworks` is not made redundant by the cycle check: A → B → C → D → … of
distinct networks is not a cycle and would otherwise walk until the host ran out.

**`maxElapsedMs` was 60 seconds, and it was sized for a world where the peer could
not run.** Count a peer turn: `front_of_house` proposes `menu_guide` (1),
`menu_guide` proposes the bakery (2), the bakery's front agent proposes its own
sub-agent (3), that answers (4), the bakery answers (5), `menu_guide` answers (6),
`front_of_house` proposes `check_safety` (7) and then answers (8). Eight model
calls where the same question without a peer costs three or four. At eight seconds
a call — not a slow provider, just a real one on conference wifi — that is 64
seconds, and an ordinary demo question would have been stopped by a limit whose
purpose is to stop a turn that will not finish. It is 90 seconds now, which covers
eight calls at eleven seconds each. The trade is named rather than hidden: it is
also how long a router that accepts a POST and never answers is waited on before
the request is aborted.

**The other five were re-counted and left alone**, which is worth more than a round
of precautionary bumps: model calls 8 of 16, delegations 3 of 12, rounds 2 of 6,
and a session of ~37 peer questions rather than ~75 plain ones. Depth is the one
with no headroom left, and that is the point of its value — a fifth level is a
peer's peer, and this build does not take a second hop. The arithmetic is in
`limits.ts` beside the numbers, so the next person to change one can check it.

**`maxDepth` was 3 until Task 8, and was raised to 4 for a measured reason rather
than by taste.** A peer hop is a rung on the same ladder as our own delegations, so
the shortest honest route to the bakery — `front_of_house` → `menu_guide` → the
bakery's front agent — is already 3, and the bakery's own second agent is the
fourth. At 3 the peer network loaded, validated, and could only ever run half of
itself: the limit was not bounding a runaway, it was truncating a conforming
composition, and the truncation was invisible on the page. 4 is the smallest value
that admits the peer we actually publish. It remains an arbitrary pick in the same
sense `maxElapsedMs` is — finite as §3.1 requires, derived from no measurement of
anything but our own graph.

### 2.7 Replayed replies

`data/scripted-replies.json` holds fixed model replies that run through the real
gate, the real checker and the real cards — only the model's words are fixed. The
panel labels a replayed reply as replayed, and the trace records `source:
"scripted"`. They exist because the behaviour this product catches is a model being
confidently wrong, which cannot be waited for on camera or pinned by a live-model
test. They are never presented as a live generation.

### 2.8 Not covered by this build

- Cross-site action transport (outside the minimum profile).
- MCP tools: none are declared and none are called.
- Coded-tool bundles: none are published and none would be executed.
- Streaming model output: the client is a single non-streaming request.
- Streaming peer answers, and peer coded tools: neither is published and neither
  would be executed.

**The peer network is no longer in this list.** It used to say the composition walk
stopped at loaded-and-validated and that a peer's agents were never instantiated.
That was true until Task 8 and is now false, so it is replaced rather than softened:
a limits document that understates what a system does is as wrong as one that
overstates it, and this file has already taken the stale-prose corrections §2.1
enumerates.

What the build now does, **once a peer is wired in**: `public/vouch.network.json`
names a peer network symbolically, `public/links.json` binds that name to a URL on a
**second origin**, and `public/agent-manifest.json` lists that origin in its
top-level `allowed_peers`.
When our `menu_guide` asks for it, the runtime checks the published allow-list,
**blocks on a consent card naming the origin and the purpose**, fetches the peer's
`agent-manifest.json` from the base, selects the exactly-named entry, fetches and
validates the definition, and then **runs the peer's agents in this browser** on the
caller's router, under the caller's budgets. The answer comes back through the
normal tool-result path and reaches the screen through `gate`.

**What the deployed artifacts wire today: nothing.** All three fields are empty or
absent — `allowed_peers` is `[]`, `links.json` binds no name, and
`vouch.network.json` carries no symbolic reference. The entry we published named
`marrow-point-bakery.vercel.app`, a **claimable `*.vercel.app` subdomain this
project does not own and has never deployed**, so anyone who registered that Vercel
project name would have been an allow-listed peer of this site — fetched, parsed
and run in a visitor's browser, on the visitor's own router, behind a consent card
naming an origin the visitor had every reason to trust. `DECISIONS.md` had written
the refusal down before we committed it, in its own words.

So the paragraph above describes a **capability that is built, tested and
unreachable in the deployed build**, and this is the one place in this file that
says which. Nothing above it is withdrawn: the composition path is exercised
end to end in `tests/peer.test.ts` against the peer's own published documents on a
fixture origin in the reserved `.example` TLD, and the three published files go in
together — one step, one commit — when an origin we control exists
(`OWNER-TODO.md` item 1). The symbolic reference had to come out with the binding
rather than after it: unresolved, it is a `missing` tool to upstream's validator,
which stops the site at startup instead of going quiet.

### 2.8b Consent: the default is before each contact, and the relaxation is the visitor's

This shipped wrong for one review round and the correction is worth recording,
because the mistake was a reading of the spec rather than a slip in the code.

The first version cached a peer load for the session, so a visitor was asked once
per peer rather than once per contact. The justification was §5: *"A remembered
approval is scoped to the destination origin for the current session."* That
passage does not grant remembering — it **bounds what remembering may mean once
you have it**. The grant, and the limit on it, are in §3.2:

> "it MUST identify the external origin and purpose of the contact and obtain the
> user's approval **before each contact**. A runtime MAY support alternative trust
> policies and consent interfaces, but **any relaxation of the default MUST result
> from an explicit user choice**."

A silent cache is a relaxation nobody chose. So the card now carries an **unticked**
"Don't ask again about this site while I'm here", and:

- **Unticked** — every contact is put to the visitor again, and the fetch waits for
  each approval. Two uses of the bakery in one visit are two cards and two fetches.
- **Ticked** — the approval is remembered for that origin, for that boot, in memory.
  Nothing is written to storage, so closing the page forgets it, which is exactly
  §5's bound. The tick is the explicit choice §3.2 requires.

The test is written from the **default**, not from the relaxation: two contacts
with nothing ticked must produce two cards, and the second fetch must not happen
before the second approval. That is the assertion that fails if caching is ever
made the default again, and a mutation run confirms it does.

Two smaller rules fall out of the same place. A **committing site action is never
rememberable** — "remember that I approved a write" is not on offer. And
**declining remembers nothing**, whatever the box says.

### 2.8c Two paths that were safe only because nothing was published

Both were found by looking for one thing: *what was safe because `allowed_peers`
was `[]`, and stopped being safe the moment it was not?* Neither was a regression;
both were latent code whose status changed on the day a peer was published.

1. **`Runtime.fetchPeerArtifact` checked the allow-list and then fetched**, with no
   consent — unconsented contact with a third-party origin, which §3.2 forbids. The
   allow-list check and the consent gate are now one function, `clearToContact`, and
   both the composition walk and this method go through it. There is one route to a
   third-party origin in this runtime, and since fix round 1 both ends of it also
   run the landing check described below.

   **That claim was true of the peer routes and false of the site's own**, which
   fix round 3 closed. The three artifacts this site reads about itself —
   `links.json`, its own manifest, its own network definition — were fetched with
   no landing check, so a redirect from this site's own origin to a third one was
   parsed and run **as this site's own published network**: no allow-list check,
   no consent, no trace entry. It needs this site's own server or its DNS, which
   is narrow, and narrow is not closed; what was wrong was the word "one". All
   three now run the same check, a same-origin redirect still passes on the
   fast path, and a redirect off this origin is refused.

   **And `links.json`'s refusal names the wrong cause, which is worth stating as
   plainly as the thing it does right.** That fetch is best-effort — a site with
   no peers need not publish the file — so its `catch` swallows a refusal along
   with a missing file. The redirect is therefore refused, nothing from the third
   origin is parsed, and the bindings come back empty; the published network is
   then refused a step later because its one symbolic reference no longer
   resolves. Fail-closed, by a different route than the other two artifacts.

   But the message a reader gets says the three published files disagree. Someone
   seeing it would go and check `vouch.network.json`, `links.json` and
   `agent-manifest.json` against each other and find nothing wrong with any of
   them, because what actually happened was an off-origin redirect. The
   `peer_redirect_refused` trace entry says so. **So this is the one place in the
   startup path where the trace knows more than the page** — and on a project
   whose claim is that a refusal says what it refused and why, that asymmetry is
   the defect, not the refusal.

   **It is parked, not fixed, and deliberately.** The fix is for
   `loadPublishedLinks` to distinguish "no such file" from "refused" and report
   the second, which means deciding what best-effort should mean for a site with
   no peers — a bigger change than the hole warrants when the case needs this
   site's own server or its DNS and the refusal is visible either way. Written
   down here so it is a decision later rather than a rediscovery.
2. **A peer's network definition may be on a third origin, and that class has two
   halves, closed to different standards.** §3.2 permits the third origin in as
   many words — the `hocon` value "MAY be a relative path or an absolute HTTP or
   HTTPS URL" and "does not require the final network-definition URL to remain on
   the manifest's origin". §5 says what it is: "A redirect to a different origin
   MUST be treated as a new destination and evaluated under the same consent
   policy." Both halves are evaluated; only one of them can be evaluated in time.

   **The declared half is closed before the fetch.** A peer manifest naming an
   absolute `hocon` on a third origin hands us a URL we can read, so that origin
   goes through the full policy — the allow-list and then its own consent card,
   named as itself — before anything is requested of it. Nothing reaches it
   unless the visitor said yes to it specifically. This is the strong half.

   **The redirect half is closed after the fetch, and cannot be closed before
   it.** A peer whose `hocon` is a same-origin relative path may serve a 302 to
   anywhere. `fetch` will not reveal a cross-origin `Location` without following
   it, and `redirect: "error"` would refuse an ordinary same-origin
   trailing-slash or path-canonicalising redirect along with it. So the redirect
   is followed, `Response.url` is read, and **nothing whose landing origin the
   visitor has not approved is parsed, run or shown as the peer's** — refused
   before `json()`, with the landing origin on the page. §3.2 permits following
   the redirect, §5 requires the landing origin to be evaluated, and this is
   both at once.

   **What passes without a question is a redirect that stays on the same
   origin** — a trailing slash, `/x` to `/x/index.json`. A HOST change is not in
   that set: origins are compared whole, so `example.com` to `www.example.com`
   is a new destination and is refused unless that host is itself allow-listed
   and consented. That is stricter than "ordinary redirect" suggests, and it is
   the fail-closed direction. Both this file and the code said "a canonical host"
   passes until fix round 3; the behaviour was right and the sentences were
   describing something else.

   **"Evaluated under the same consent policy" means both controls, and that was
   fix round 2.** This check first shipped consulting only the allow-list, which
   is §3.2's separate control over which origins are permissible at all. The
   consent policy is the visitor's. Checking one left a real hole: with two
   allow-listed peers, approving the first would have let it redirect to the
   second and run the second's network under the first's approval — a visitor who
   approved one origin and got a network from another. A landing origin must now
   be allow-listed **and** in this session's consent set, which means an origin
   the visitor contacted themselves and ticked "don't ask again about this site
   while I'm here" for. Anything else is refused. It is not reachable with one
   entry in `allowed_peers`, and it was fixed before the second, because a known
   hole that goes live with a config change is the same bet this project already
   refuses to take on allow-list entries for origins that do not exist.

   **There is no card, and that is deliberate.** The visitor cannot be asked about
   a landing origin before the contact — the contact is how we found out there was
   one to ask about — and a card shown after the thing it asks about has happened
   is the consent-card defect of fix round 1 wearing a different hat. A refusal is
   the honest answer. The page says they approved one origin and the answer came
   from another; which of the two controls failed goes in the trace.

   **What that leaves, stated rather than hidden: the landing origin receives one
   GET.** Request headers, the visitor's IP and the fact of the request reach a
   server they did not approve, before anything could know where it landed. There
   is no browser mechanism that both prevents this and leaves ordinary redirects
   working. What the check buys is that **nothing from an origin the visitor did
   not approve is run or believed**, not that it was never contacted. Tests assert
   the refusal, assert the body was never parsed, and assert the GET, because the
   limit is part of the claim.

   **And one fail-open, in a path that is otherwise fail-closed.** The landing
   origin is read from `Response.url`, and when that is empty
   `fetchPublicArtifact` falls back to the URL it asked for — it treats missing
   provenance as "we did not land anywhere else". Every other branch of this
   check refuses what it cannot vouch for; this one admits it. It is not reachable
   as the runtime stands: a `mode: "cors"` response always carries its final URL,
   and an opaque response (`mode: "no-cors"`) could not be read as JSON anyway,
   so there is no version of this fetch that both yields a document and hides
   where the document came from. Fixing it would mean guessing at the behaviour of
   a state nothing produces, which is how the unreachable branch removed in the
   same round got written in the first place. So it is named here instead: if
   these artifacts are ever fetched by something other than the browser's own
   `fetch` — a service worker, a shim, a test double that does not set `url` —
   this is the line that stops being safe, and it should become a refusal at that
   point rather than a fallback.

The generalisation is recorded because it will apply again: **anything that was
safe because nothing was published deserves a second look once something is.** The
same sweep checked, and found nothing wrong with, the peer's schemas and
instructions reaching the model (§5 contemplates exactly that, and they reach no
page surface), a peer's coded-tool and MCP declarations (neither is offered to the
model and neither is executed), and a peer's own `llm_router` and `llm_config`
(read, ignored, and asserted ignored on the payloads).

### 2.8a What the peer composition does NOT do

Named here rather than left to be discovered, because each is a place a reader
could reasonably assume more:

- **One hop.** A peer's own external references are loaded and validated by the
  walk — that is how the composition cycle and the composition budget are
  enforced — but they are **not instantiated**. A peer's agents are offered no
  second peer, because §3.2's per-hop policy would require a second consent and
  this build asks for one. A peer that proposes one is told it is not an agent of
  its own network.
- **No site action crosses the boundary.** A peer's agents are offered no entry
  from our action catalog and the registry is not consulted in a peer's frame, so
  `check_safety` stays on this origin. Cross-site action transport is outside the
  minimum profile in any case.
- **No caller-binding UI.** §3.3 lets a visitor bind a symbolic reference this
  site has not bound, and `boot` takes a `peerBindings` option that does exactly
  that, caller-owned and never merged over a publisher's. There is no control for
  it on the page. The reason is the MUST attached to it — "MUST NOT modify the
  publisher's file" — and the fact that a UI which looks like it is saving a
  binding *to the site* when it is saving to one browser is the confusion that
  MUST exists to prevent. A test asserts `public/links.json` is byte-identical
  before and after a caller supplies one.
- **An unbound symbolic reference refuses the whole network.** Upstream's
  classifier reads a name nothing resolves as a `missing` tool, and we do not
  override that: a typo and an unresolved reference are indistinguishable, and
  refusing is the fail-closed answer. So the three published files must agree, and
  a tripwire test holds them to it.
- **No replay fixture covers the peer.** The recorded replies in
  `data/scripted-replies.json` are played by a parameterised test through a
  session with no peer artifacts, so a peer fixture would desynchronise its turns.
  Watching a peer exchange therefore needs a key; watching a peer *load*, and the
  consent card, does not.

### 2.9 The refusal demonstration, and what it costs

§6's seventh check — "stop an invalid network, a composition cycle, an over-budget
request, and a denied origin with visible errors" — plus §4's missing-key setup
error (Tenet Three, "Static BYOK option", spec line 369; §3.4 is Browser Origin
Requirements and says nothing about keys) make **five** refusals, each of which must put a string on screen. Three of them
are properties of *loading* a network rather than of a conversation, so the panel
carries a "Load a published agent network" control: a judge types a reference and
watches the refusal, rather than taking it on trust from a console.

Three honest costs:

- The broken fixtures under `public/broken/` **ship to production** in `dist/broken/`.
  That is deliberate — a judge should be able to fetch them over HTTP exactly as a
  peer's artifacts are fetched — but it does mean the deployed site serves three
  networks that no conforming runtime should run. They are invisible to discovery:
  the published manifest declares one network, `vouch`, and §3.2 requires an exact
  name match, so nothing reaches them by accident. A test pins that they are not
  listed.
- Their external references are **site-root-relative** (`/broken/cycle-b`), which
  keeps them portable between localhost, a preview host and production but assumes
  the site is served at the origin root. Served from a subpath, the cycle pair would
  resolve to the wrong place and fail as a 404 rather than as a cycle.
- The control adds a surface to the panel. It is a plain fieldset rather than a
  `<details>`, because a refusal behind a closed disclosure triangle is a refusal
  nobody sees — the same reasoning that now makes the model-settings disclosure open
  itself when the router needs a key.

---

## 3. What the checker tracks, and what it does not

This is a food-safety checker, so the boundary of the allergen set it speaks to is the
most important limit in this document. **An untracked allergen is precisely the thing
this product must not be quiet about**, and for most of this build's life this file was
quiet about it: the word "allergen" did not appear once.

`data/restrictions.policy.md` is the authority. It exists as a separate file because
`data/restrictions.json` is a bare array whose loader rejects anything else, so the
policy could not live in the data as a comment — and relaxing that loader so it could
would have traded a safety property for a convenience.

### 3.1 The tracked set, and the rule that draws it

The rule, verbatim from the policy file:

> "The tracked set is the EU-14 major allergens intersected with what this menu's
> ingredient data actually contains."

Today that is **11 published restrictions over 12 tracked allergen ids**: `dairy`,
`egg`, `fish`, `gluten`, `peanut`, `tree_nut`, `shellfish`, `soy`, `sesame`, `mustard`,
`celery` — and `pork`, which is not an allergen at all but a dietary restriction we
chose to support. `nut_free` is the one restriction that covers two ids (`peanut` and
`tree_nut`), which matters below.

There is one source of truth for that list and it is `data/restrictions.json`:
`trackedAllergens` is the union of every restriction's `avoid` list, and an allergen is
named in an item's **Contains** line because something avoids it, not because a view
hard-codes it. A hard-coded exception is exactly what went wrong once — see §3.3.

### 3.2 What is outside the set, named rather than left to be discovered

**Deliberately not tracked, although they are in this menu's ingredients:** chickpeas,
horseradish, garlic, cocoa, sauerkraut, cabbage. All six are real sensitivities for
real people and none is on the EU-14 or the US major-allergen lists. The reasoning was
that a boundary we can state and defend beats a longer list we cannot — **but someone
with a chickpea allergy should learn our limit from this page rather than from a plate
of falafel**, which is the whole reason this section exists.

**EU-14 members this build does not track:** sulphites and lupin, and the EU's separate
*crustaceans* and *molluscs* categories, which we collapse into one `shellfish` id.
None of the four appears anywhere in this menu's ingredient data, which is what the
intersection rule means in practice — but "absent from our data" is not "safe", and a
menu that grew would reopen each of them.

**`shellfish` is tracked and no menu item reaches it.** That is deliberate, not a data
error: it is the zero-hit case an exhaustive sweep needs, so that "no conflict found"
is exercised for a restriction with nothing behind it.

**Where the boundary meets the gate**, and these are consequences of fail-closed rather
than bugs:

- A claim naming no mappable allergen — "safe for you", "vegan", "sugar-free" — **can
  never be backed by a finding**, so it is always withheld.
- "nut-free" requires **both** `peanut` and `tree_nut` to be covered before it can be
  backed.
- A claim naming an allergen outside the tracked set refuses rather than being
  checked. Refusing is the right answer; it is still a refusal, and **the guest gets
  no verdict on that allergen from anywhere on this site.**

Run against the shipped gate with only *Dairy-free* selected, those three read:

| Claim | Refusal reason |
|---|---|
| "The Falafel wrap is chickpea-free." | `not_checked` |
| "The Falafel wrap is safe for you." | `not_checked` |
| "The Falafel wrap is vegan." | `not_checked` |
| "The Falafel wrap is sugar-free." | `not_checked` |
| "The Falafel wrap is nut-free." | `not_checked` — `peanut` and `tree_nut` are tracked but not *selected* |
| "The Falafel wrap is garlic-free." | `ingredient_subject` — garlic is an ingredient *name* in this menu, so the gate reads the sentence as a claim about an ingredient, not an allergen |
| "The Falafel wrap is dairy-free." | *passes* — backed by a finding |

The `garlic-free` row is the one to notice: an untracked thing that happens to be a
named ingredient refuses for a different stated reason than one that does not. Both
refuse, and the refusal text differs; a reader should not conclude from a
`not_checked` message that every untracked allergen produces it.

### 3.3 The set is not stable, and that is the finding

It was extended **twice during this build**, both times because an allergen turned out
to be reachable only by derivation on at least one dish:

1. **Mustard.** It is never a top-level ingredient in this data. Two dishes reach it
   and both only by derivation: `potato_salad` through
   `potato_salad_mix` → `yellow_mustard` → `mustard`, and `pastrami_on_rye` through
   `pastrami` → `spice_rub` → `mustard` and again through
   `yellow_mustard` → `mustard`. A hard-coded exception had been making it visible;
   when that went, mustard vanished from both Contains lines, which reopened — for
   mustard — exactly the invisible-derived-allergen hole that had already been closed
   for dairy. `mustard_free` was added, and the fix keeps the one-source-of-truth rule.
2. **Celery.** Found by the measurement demanded after the first fix — *which other
   allergens in the ingredient table are reachable but untracked?* — rather than by
   another report. It is EU-14 and reachable in the chicken salad sandwich, the matzo
   ball soup and the chicken noodle soup. It was top-level in two of the three and
   derived in one. `celery_free` was added on the same reasoning.

That measurement, re-run against the data as it stands on 24 November 2026, finds
**32 reachable-but-untracked leaf ingredients** — 43 leaf ingredients are reachable
from some dish, 11 of them are tracked, and the remaining 32 are the plain foods and
sub-recipe components the six named above are drawn from. No ingredient id is missing.
`shellfish` is the twelfth tracked id and is reached by nothing, as §3.2 says.

**Two things follow, and they are the reason this section is written as a limit rather
than as a changelog.** First, derivation is where this hides: an allergen reached only
through a sub-recipe is invisible to anyone reading a top-level ingredient list, which
is the thing the checker exists to do and the thing a person cannot do by eye. Second,
a set extended twice in one build is a set that will be extended again, so **the number
11 should be read as today's figure and not as a boundary anyone has settled.**

### 3.4 This document is now pinned to that data

Because the failure above was a document disagreeing with the data it describes,
`tests/artifacts.test.ts` asserts that §3.1's list of tracked allergen ids is exactly
`trackedAllergens(RESTRICTIONS)`, and that §3.2's six declined ingredients are exactly
the ones `data/restrictions.policy.md` declines. A twelfth restriction, or a change of
mind about horseradish, fails a test until this section follows. Prose is what has gone
stale every time in this file — §2.1 enumerates each one — and these two sentences are
the ones that could do it again most expensively.

---

## 4. What we publish, in whose vocabulary, and what we deliberately leave out

### 4.1 The `actions` block is optional metadata, published in §3.1's field names

`agent-manifest.json` carries an `actions` array describing the four site actions. Two
things about it should not be inferred:

**It is not required.** §3.3's manifest row lists what a manifest must carry and then
what it may: "One or more networks with name, front_man, and hocon; top-site LLM router
metadata; peer policy; **optional** brand, MCP, linking, deployment, action, theme, and
coded-tool metadata." Action metadata is in the optional group. We publish it anyway,
because a catalog nobody can read is not a catalog.

**Its field names are the specification's, not ours — and this changed mid-build, so
the earlier claim about it is retracted.** This document and `docs/DECISIONS.md` used to
say the shape was a legitimate extension of ours, on the grounds that §3.3 fixes no
shape. The first half of that is still true. The second half stopped being the honest
description when the block was rewritten to use the specification's own words for a
runtime's action descriptions: **`name`, `purpose`, `effect`, and a real JSON Schema in
`parameters`**. **§3.1** — Minimum Runtime Behavior, spec line 203, not §2.1 — asks a
runtime to "Support same-site registered actions described by name, purpose, JSON
Schema, effect, and handler", and we previously published `commits` where the
specification says `effect`, with no argument schema at all.

The section number was wrong in five places including the published manifest, and it was
the kind of wrong that wastes a reader's time rather than misleading them about the
product: §2.1 is Minimum Network Content and contains neither the word `purpose` nor the
word `effect`, so a reader who did what the text invited — check §2.1 — found nothing.
It is §3.1, line 203.

That was not merely a vocabulary mismatch. **The consent card's effect sentence was
hard-coded**, because the published catalog carried no effect for it to derive one
from. Using the specification's field names fixed a real defect and is better for that
reason — not because we had been failing a requirement. §3.3's optional listing is why
this is an improvement rather than a correction of non-conformance, and both halves
are said here so that neither can be quoted alone.

**Whose examples this was compared against**, since §2.5a is about what happens when
that is left vague. The comparison was with the four `*_agentified` example manifests in
`cognizant-ai-labs/agentic-web` — the event's spec-and-starter repository, not the
`nsdeploy` repository `PROVENANCE.md` pins. All four publish `actions` as an object of
`{version, module, bridge, agentTools}`: runtime wiring, not a described catalog. So
nothing there contradicts our shape; §3.1's own field names are the authority, and the
point was that we were not using them.

The four other optional keys those example manifests carry and we do not — `brand`,
`MCP`, `linking`, `theme` — are in the same optional group, so their absence is not a
gap either. They are absent because this entry does not publish capabilities it has not
built.

### 4.2 A published schema does not snapshot the site's own data

The published `parameters` schemas **deliberately enumerate no menu item ids and no
restriction ids.** An earlier version did: `check_safety` snapshotted all 34 item ids
*and* all 11 restriction ids, and `add_to_cart` the 34 again. That made
`agent-manifest.json` a second copy of the menu which had to agree with the first one
forever — the same defect as two allow-lists telling different stories, with a longer
fuse, because it was harmless until the day a dish was added.

The rule now, stated as an invariant rather than as a mechanism: **a published schema
does not snapshot the site's own data, and a published contract that disagrees with the
code must fail something as early as something can fail, without a data change being
able to trip it.** `reconcileActions` refuses to start if a published schema reappears
with an enumeration in it, and `withoutEnums` in `src/runtime/actions.ts` is the single
definition of what gets published, so the published copy is the code's schema minus its
enums and cannot drift from it.

The restriction-id enum was offered back on the grounds that 11 ids are more stable
than 34. It stayed dropped, and the second of the three reasons is the one worth
keeping: **the tracked-restriction list is empirically not stable** — §3.3 — so the
dataset that *felt* stable is the one this build extended twice.

**The cost, stated rather than hidden: an agent reading our manifest gets no enumerated
hint for menu item ids or restriction ids.** It must ask, or be corrected by the
runtime's validation, which checks arguments against the actual data and is stricter
than any published enum could be. The enum was never the check; it was a weaker second
copy of one.
