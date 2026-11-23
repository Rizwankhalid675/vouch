# Limits

What this build does not do, does not know, and gets wrong. Written as it is found,
not at the end. The README may not claim anything this file contradicts.

Task 10 owns this document. Task 6 opened it with the two sections it is
responsible for: what was taken from upstream, and the runtime's own limits.

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
| agent → function schema (`tool-schema.ts`) | one 12-line function |

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

A verdict card is a pure function of **(the menu, the guest's restriction set)**.
Nothing reachable from the model may change what any card shows — not its verdict,
not its text, not its **presence**, not its order. Cards re-render when the guest
changes their restrictions, and at no other time.

*Presence* and *text* are both meant literally, and both are tested literally:

- **Text** includes the text a card gives to assistive technology, not only its
  `textContent`. `aria-label` **replaces** an element's accessible name, so a card
  whose visible text is byte-identical to the checker's could still read a model's
  ungated claim to a screen-reader user. The assertions compare a card's whole
  readable surface — text nodes, every text-bearing attribute, form-control values
  — against lines computed independently from `verdictFor` + `cardLines`.
- **Presence** means presented, not in the DOM. `display:none`, the `hidden`
  attribute and `aria-hidden="true"` each hide a card while every existence check
  still passes, so every card is asserted visible, on itself and on each ancestor.
  A model that can hide every card blanks the safety channel as surely as one that
  can overwrite it.

This is enforced by a signature, not by a convention: `renderVerdicts` takes the
guest's `Restriction[]` and computes the verdicts itself; it has no parameter that
would accept a `Finding`, and the card builder is module-private. `SiteContext`
carries no display callback for an action handler to reach.

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
$11.50") was withheld as `not_derivable`. Prices are published data, so this is a
false positive in the derivation check.

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
author during the first round. Every site in `src/runtime` that writes a string into
the DOM was then enumerated and classified, and the rule they all follow now is:

> The transcript speaks in the deli's voice, so only an error **this runtime wrote**
> (a `RuntimeMessage`) may be shown there. Anything else is reported in our own
> words, with only its *kind* in the trace.

| Channel | What it was | Closed by |
|---|---|---|
| Action argument *values* | `add_to_cart({item: "the Reuben is dairy-free"})` printed that in the confirmation dialog | every id argument is an `enum` of published ids, so it fails validation before a dialog is drawn |
| Router HTTP error *body* | a 400 whose body was prose rendered as "Hollis & Rye — …" | the body is never put in the message; only a token-shaped provider error code survives |
| Action argument *keys*, and validator messages | `{"The Reuben is dairy-free": 1}` reached the rendered trace twice | the trace records only schema-declared keys plus a count, and a classification instead of the validator's message |
| Network validator interpolations | `Agent 'x' references missing tool 'y'` — ours today, a peer's in Task 8 | quoted interpolations that are not token-shaped are replaced |
| The claimed phrase in a refusal | model text, named deliberately (SPEC 4.4) | filtered for meaningless tokens *and* bounded to a phrase |
| A published agent's **name** | `Hollis & Rye — Asked The Reuben is dairy-free and safe for you.` Ours are tokens; a **peer's are not**, and Task 8 loads a peer network from a second origin | the network is refused at startup (`validate_agent_names`), **and** the notice token-filters the name anyway |
| The startup catch | a malformed artifact's `SyntaxError` quotes the file | only a `RuntimeMessage` is shown; anything else becomes our own sentence plus a kind |
| The unknown-outcome card's source line | a handler's raw `error` | token-filtered |
| The key-status line | `selectTopRouter`'s message | token-filtered |

### The mechanism

Stating the rule in prose made it a convention, and the convention acquired four
bypasses inside one round. It is now a **type**:

```ts
type SiteText = string & { readonly __siteText: unique symbol };
```

`Transcript.showRuntime`, the startup error line and the key status take `SiteText`
and nothing else. Only two functions produce it: `ours(...)` for a literal written
in this repository, and the `` siteText`...` `` tagged template, whose literal parts
are ours by construction and whose every `${value}` is **token-filtered** — anything
with whitespace in it is replaced with `<omitted>` rather than printed. A call site
that passes a raw string does not compile.

One idiom follows from that and is worth knowing: filter values *then* join with our
own separator (`joinTokens`), rather than joining then filtering, because a
separator with a space in it would take the whole joined string down with it.

Note that this half of the mechanism is enforced at **compile time**, so no runtime
test can fail when it is removed — widening the parameter back to `string` is
undetectable to the suite. What the suite pins is the filtering behaviour
(`siteText`, `tokenOrOmitted`, `joinTokens`) and each call site's observable output.

Two further independent nets, both tested: each trace call site records no
model-chosen string, **and** the trace renderer refuses to print any string that is
not token-shaped or allow-listed. The second exists because the first depends on
every future call site remembering.

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

### 2.6 Execution bounds

**Per turn:** 16 model calls, 12 delegations, depth 3, 6 tool rounds. These reset at
the start of every turn, because the runaway a limit exists to stop is a turn that
will not finish. **Per session:** 300 model calls, as a backstop against a page left
open all day; reaching it says to start a new conversation, and the panel has a
control that does exactly that.

They were per *session* in the first version, which meant sixteen plain questions
bricked the assistant with no way back — finite, as §3.1 asks, but on the wrong axis,
and something any judge using the demo for two minutes would have hit.

An agent appearing in its own delegation ancestry is refused with the path shown; a
repeated call to the same agent is not treated as a cycle, as §3.1 requires.

There is no wall-clock budget and no concurrency limit, because the loop is
sequential and tab-scoped. §3.1 asks for finite limits on elapsed execution time;
ours is bounded only indirectly, by the call budget and each action's timeout.
Assigned to Task 7.

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
- The peer network (Task 8). `fetchPeerArtifact` and the peer-policy check are in
  place and tested, and `links.json` is loaded, but nothing is bound yet.
