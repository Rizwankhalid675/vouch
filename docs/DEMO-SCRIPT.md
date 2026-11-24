# Demo video — script and shot list

**Hard constraints from the rules** (`docs/EVENT.md` §5): under **two minutes**, public on
**YouTube**, shown running in a browser, and it *"should include the Entrant explaining the
Project"* — a voice-over by you, not a silent screen capture. One or more screenshots are
submitted separately.

**Who records this:** you. I cannot record a voice-over, and the rules ask for yours
specifically. Everything below is written to be read aloud at a normal pace.

## The one decision this script makes

120 seconds cannot show the deli, the gate, five refusals, the verdict cards, the
cross-origin peer, key isolation and the conformance CLI. Trying to show everything is how
a submission video becomes a list.

So the video makes **one claim** and proves it on camera:

> A language model may describe food. It may never tell you the food is safe. The part of
> this site that decides what is safe to eat never calls a model at all.

Everything else is evidence for that claim, or it is cut.

## Do not gamble on live model output — and this needs a build change

**The central shot requires the model to say something reassuring and wrong.** If we record
a live model call and it behaves well, the video demonstrates nothing: the whole point is
what happens when the model misbehaves. Waiting for a bad generation on camera is not a plan,
and editing until we get one is worse.

So the runtime needs a way to **replay a fixed model response** — a scripted or recorded
reply, visibly labelled as such in the UI, that goes through the real gate and the real
verdict path with nothing stubbed downstream.

**This is a build requirement no task brief contains.** It is small, it is honest (the
response is labelled, the pipeline is real), and without it the most important fifteen
seconds of the video cannot be filmed. Flagging it now rather than discovering it in January.

It is also the right engineering: a fixed input through a real pipeline is a regression test
you can watch, which is worth more than a demo you cannot reproduce.

## Shot list

| # | Time | On screen | Voice-over |
|---|---|---|---|
| 1 | 0:00–0:10 | The deli, scrolling. Ingredients visible on every card that has them. | "This is a deli. Thirty-four dishes, with every ingredient the kitchen knows listed — and where it doesn't know, the card says so. No agent involved yet — the site works with scripts off." |
| 2 | 0:10–0:20 | Type a restriction in plain words: "I'm lactose intolerant." | "I'll tell the agent what I can't eat, in my own words." |
| 3 | 0:20–0:40 | **The core shot.** The replayed reply appears with the claim withheld. On the Turkey club card, verbatim: **"✕ Unsafe for what you told us — Contains dairy, through Brioche bun → Brioche → Butter → Dairy. Checked against: Dairy-free."** | "The model said this was fine. It isn't — there is butter in the bun, three steps down, and no dairy anywhere in the ingredient line a person would read. The claim was withheld, and the verdict beside it came from the ingredient data, not from the model." |
| 4 | 0:40–0:50 | A dish with an unknown ingredient → **unknown**. Then a clear dish, whose card reads **"✓ No conflict found"** — never "safe" — with the line every card carries: *"From the published ingredient list. Not a statement about the kitchen, and not medical advice."* | "When the data doesn't say, it says unknown — it never guesses in your favour. And when the data is clear it still won't say safe. It says it found no conflict, and tells you what it was not looking at." |
| 5 | 0:50–1:05 | The five refusals, fast cuts. Paste `/broken/invalid`, `/broken/cycle-a`, then an origin outside the allow-list. The cycle shows its path as three fenced nodes: `cycle-a → cycle-b → cycle-a`. Let the panel's own line be readable once. | "The spec asks a runtime to fail visibly. Invalid network, composition cycle, over budget, denied origin, missing key — each says what it refused and why. These three are deliberately broken and published, so the refusals can be watched rather than taken on trust." |
| 6 | 1:05–1:20 | Consent card naming the peer origin; approve; the peer's network loads and runs locally. Then the peer's confident sentence about its own glaze is **withheld**, and the glazed donut's card beside it still reads **"We don't know"**. | "Another site's agent network, loaded after approval and run in my browser. Its answer goes through the same gate as my own model's — so the bakery's claim about its own glaze is withheld, and the card still says we don't know, because this site has not published what is in that glaze." |
| 7 | 1:20–1:30 | Key panel: the key is set; network tab shows the key in the router request and absent from the peer request. Then delete the key. | "My key, my browser. It reaches the router I chose and nothing else, and I can delete it." |
| 8 | 1:30–1:45 | Terminal: the conformance CLI against the deployed URL, passing, with NOT CHECKED lines visible. | "I built a conformance checker anyone can run against any agentic site. It also says which checks it can't make — that's the same discipline." |
| 9 | 1:45–1:55 | Back to the card: withheld claim, verdict beside it. Hold. | "A model that can't be trusted to say 'safe' is still useful. It just doesn't get the last word." |

Total 1:55. Five seconds of margin. **Cut shot 4 first** if it runs long — shot 3 already
carries the argument, and shot 6 repeats the unknown verdict in a stronger setting.

## Recording notes

- Record the deployed site at a real width, not localhost and not a narrow window. A layout
  bug that only shows on the real site at a real width has already bitten this project once.
- Shots 5 and 8 are the only terminal/console shots. Keep them short; judges watch the
  browser.
- Shot 3 is the whole video. If it is not legible — the withheld sentence and the unsafe card
  in the same frame, both readable — re-shoot it rather than narrating around it.
- Do not read the voice-over faster to fit more in. Cut a shot instead.
- Check the upload is **Public**, not Unlisted. An unlisted video returns HTTP 200 to a link
  check and is still invisible to a judge who searches — verify by opening the watch page and
  confirming it is not marked unlisted.

## How this maps to the four criteria

Each shot earns against more than one, which is the only way 120 seconds covers four equally
weighted criteria:

- **Technological Implementation** — shots 5, 6, 7, 8: the spec's own refusals, cross-origin
  composition, credential isolation, conformance.
- **Design** — shots 1, 3, 4: a complete deli, not a chat box with a demo button; the verdict
  lives on the card where the decision is made.
- **Potential Impact** — shot 8, and the fact that the checker is reusable by anyone. The
  criterion explicitly rewards something built and shared with the community.
- **Quality of the Idea** — shots 3 and 9: the inversion itself. The model proposes, a
  deterministic gate decides, and the evidence survives.

## Verified on-screen strings

Every string below was read out of the live DOM on the built site, not drafted. Use them to
check the recording shows what the script claims.

- **Standing note, on screen before anyone types:** "The assistant does not decide whether
  food is safe for you, and is not permitted to. The verdict beside each dish is this site's
  own, worked out from the published ingredient list. Read that, not the reply."
- **The replayed reply, labelled:** "Replayed reply, not a live model call:" then the scenario's
  own name — "A model giving a false all-clear" — then the agent name "Front of house" and the
  reply itself: "Happy to help. [A claim here was withheld; see the ingredient list.]" repeated
  for each withheld sentence. The label and the scenario name are both on screen, so no viewer
  can mistake a recording for a live call.
- **The status line after ticking Dairy-free:** "Checked 34 dishes against Dairy-free: 15
  unsafe, 3 we cannot tell, 16 with no conflict found. Each verdict is shown beside its dish,
  with the ingredient that decided it."
- **The status line before ticking anything:** "Nothing is being checked yet. Tick what you
  avoid and a verdict appears beside every dish — no account, no key, no assistant."
- **Unsafe card:** "✕ Unsafe for what you told us / Contains dairy, through Brioche bun →
  Brioche → Butter → Dairy. / Checked against: Dairy-free."
- **Clear card:** "✓ No conflict found / No dairy in the published ingredients for this item."
- **Every card:** "From the published ingredient list. Not a statement about the kitchen, and
  not medical advice."
- **Invalid network:** "Refused: the published network below is not valid, so it was not run.
  … copied exactly from the published document and kept apart from our own words, because
  this site did not write them:" then the URL and the validator's words, each fenced.
- **Cycle:** "Composition cycle refused: the chain below returns to a network already being
  composed. No further network was fetched and nothing was run."
- **The panel's own explanation of the fixtures:** "This site also publishes three deliberately
  broken networks so that the refusals can be watched rather than taken on trust".

**Before ticking a restriction there are no verdict cards at all** — 34 empty slots and a
status line saying so. That is correct and worth one beat of screen time: the site does not
pretend to have checked something you have not told it about.

Shots 1-5 have been confirmed rendering on the built site, and shot 3 — the whole video
— was confirmed as **one frame**: the labelled replayed reply with its three withheld claims,
and the turkey club's unsafe card naming the butter three steps down, both on screen together.
The console was silent on load and after the turn. Shot 8 needs the deployed URL (Task 10).

**Shot 7 is confirmed only as far as the panel's rendering.** The key panel was driven on the
built site and reads correctly, but the shot as scripted shows a network tab with the key in a
router request and absent from a peer request — that needs a real provider credential and a real
router request, and neither has been made. Record it expecting to discover something.

**There are three recorded replies, not one**, and the second is worth knowing about even
though the script does not use it: `false_all_clear` (shot 3), `true_warning_also_withheld`,
and `describes_without_vouching`. The second one shows the gate refusing a model that was
*right* — the cost `LIMITS.md` §2.1 admits in prose. If a judge asks "does it just suppress
wrong answers?", that scenario is the answer, on screen, in about eight seconds.

**Shot 6 can be filmed once the site is redeployed.** Both origins are live and the three fields
are wired: `allowed_peers` names `https://marrow-point-bakery.netlify.app`, `links.json`
binds `marrow_point` to it, and `vouch.network.json` carries the symbolic reference. What a judge
types in the "Load a published agent network" field is `marrow_point` — the panel's own note says
so now, which it did not while nothing was bound — and the consent card names the bakery's origin
and says its agents will run in this browser. The prerequisite that remains is a **redeploy**:
the wiring is in the repository and in `dist/`, and the live site serves the previous build until
it is pushed again. (The fields were empty for a round because the origin we had listed was a
claimable `*.vercel.app` subdomain nobody here owned — `DECISIONS.md`.)

The peer exchange in the second half of the shot needs a provider key, because no recorded reply
covers it (`LIMITS.md` §2.8a).

**Why the donut ends on `unknown`, said precisely, because the obvious reading is wrong.** It is
not that the peer's answers "get `unknown`" — a peer's prose goes through the **same gate** as our
own model's (`showPeerText` and `showModelText` share one `renderGated`), so its safety claim is
*withheld*, not converted into a verdict. Verdicts attach to dishes, not to answers, and nothing
fetches a peer's ingredient data. The glazed donut reads "We don't know" because **this site's
own** `data/menu.json` publishes `bakery_glaze` with `contentsUnknown: true`. So the one party who
would actually know says dairy-free, that sentence is withheld, and the card beside it still says
we don't know — and a peer claiming the *Reuben* were dairy-free would sit beside a card reading
**unsafe**. That is the shot.
