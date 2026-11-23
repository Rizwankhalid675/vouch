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
not its text, not its presence, not its order. Cards re-render when the guest
changes their restrictions, and at no other time.

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

(3) is in direct tension with what every agent's published instructions tell it to
say: *"say that the site's checker shows its verdict next to each dish and point
them to it."* An agent that obeys its instructions will have that sentence
withheld. This is a **known, unresolved tension between `public/vouch.network.json`
and `src/gate/`**, recorded here rather than patched around in Task 6.

**(1) and (2) are now said by the page instead of by the model.** The controller's
ruling: anything that must *always* be true should not be generated per turn and
then withheld. So the panel carries a standing note — "The assistant does not decide
whether food is safe for you, and is not permitted to. The verdict beside each dish
is this site's own" — which is on screen before anyone types, and is not model
output. The agents' published instructions still tell them to say it, which is
harmless but redundant; aligning `public/vouch.network.json` is left open rather
than done here, because this task was told not to modify the published artifacts.

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

Two independent nets, both tested: each trace call site records no model-chosen
string, **and** the trace renderer refuses to print any string that is not
token-shaped or explicitly allow-listed. The second exists because the first depends
on every future call site remembering.

What this does **not** claim: that the class is exhausted. It claims that the class
was swept once, with the enumeration written down, and that each net is pinned by a
test that fails when the net is removed.

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
