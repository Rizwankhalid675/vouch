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

### 2.0 What the key-isolation test can and cannot see

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
author during the first round. A fifth — a published `front_man` defeating the
filter on the validator's messages — was found in review afterwards, and is §2.2b,
which also replaces the mechanism this section describes. Every site in `src/runtime` that writes a string into
the DOM was then enumerated and classified, and the rule they all follow now is:

> The transcript speaks in the deli's voice, so only an error **this runtime wrote**
> (a `RuntimeMessage`) may be shown there. Anything else is reported in our own
> words, with only its *kind* in the trace.

| Channel | What it was | Closed by |
|---|---|---|
| Action argument *values* | `add_to_cart({item: "the Reuben is dairy-free"})` printed that in the confirmation dialog | every id argument is an `enum` of published ids, so it fails validation before a dialog is drawn |
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
`allowed_peers` is `[]`; it became reachable the moment a peer could be published.

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
   filters, turned every site into a compile error. `tsc` named **13** in `src/`, and
   each was converted deliberately. This pass cannot be forgotten or skipped, which
   is the point of doing it with types rather than with attention.
2. **A grep for the class the types cannot see:** `textContent =`, `createTextNode`,
   and `el(...)` called with a non-literal text argument. This is how the fourth
   surface escaped three earlier sweeps — `refusalLine` returned a plain `string`
   assigned to `li.textContent` and never touched `SiteText` at all, so no amount of
   tightening `SiteText` would have found it. The grep found 10 sites; 5 build a
   string containing a runtime value, and 4 of those are now phrases.

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
+ `cardLines`; restructuring their DOM would mean rewriting the assertion that protects
the product's central claim, to reduce a risk that has no path to it. If a card ever
displays a value from outside the repository, this exception stops being defensible and
must be revisited. That is a condition, not a hope — it is checkable by grepping
`verdict-cards.ts` for anything it did not get from `canon.ts`.

**So: not "without exception". Two named exceptions, with a stated condition under
which each becomes a defect.**

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

All of them live in `src/runtime/limits.ts`.

**Per turn:** 16 model calls, 12 delegations, depth 3, 6 tool rounds, and 60 seconds
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
- The peer network (Task 8). `fetchPeerArtifact`, the peer-policy check and the §3.2
  composition walk are in place and tested, and `links.json` is loaded, but nothing
  is bound yet. The walk stops at **loaded and validated**: it resolves a reference,
  reads the peer manifest, selects the exactly-named entry, fetches and validates the
  definition, and reports what it loaded. It does **not** instantiate a peer's agents
  into the conversation, and the panel says so where it reports a successful load.
  Nothing in the code, the UI or the docs may say otherwise.

### 2.9 The refusal demonstration, and what it costs

§6's seventh check — "stop an invalid network, a composition cycle, an over-budget
request, and a denied origin with visible errors" — plus §3.4's missing-key setup
error make **five** refusals, each of which must put a string on screen. Three of them
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
