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
| 1 | 0:00–0:10 | The deli, scrolling. Ingredients visible on every card. | "This is a deli. Thirty-four dishes, every ingredient listed. No agent involved yet — the site works with scripts off." |
| 2 | 0:10–0:20 | Type a restriction in plain words: "I'm lactose intolerant." | "I'll tell the agent what I can't eat, in my own words." |
| 3 | 0:20–0:40 | **The core shot.** The replayed model reply appears with a sentence greyed out and marked withheld. Beside it, on the card, a verdict reading **unsafe — dairy, via brioche bun → brioche → butter**. | "The model said this was fine. It wasn't — there's butter in the bun, two steps down. So the claim was withheld, and the verdict beside it came from the ingredient data, not from the model." |
| 4 | 0:40–0:50 | A dish with an unknown ingredient. Card reads **unknown**, not safe, not unsafe. | "When the data doesn't say, it says unknown. It never guesses in your favour." |
| 5 | 0:50–1:05 | The five refusals, fast cuts: invalid network naming the bad field, the composition cycle with its path, over-budget with both numbers, denied origin named, missing key with a setup message. | "The spec asks a runtime to fail visibly. Invalid network, composition cycle, over budget, denied origin, missing key — each one says what it refused and why." |
| 6 | 1:05–1:20 | Consent card naming the peer origin; approve; the peer's network loads and runs locally. Then the peer answers with confident prose → verdict **unknown**. | "A second site's agent network, loaded after approval and run in my browser. It answers with prose, so it gets unknown — a peer is not a source of truth." |
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
