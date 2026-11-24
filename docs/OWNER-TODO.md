# The four things only you can do

Everything else in this entry is buildable without you, and most of it is built. These four are
not, and three of them are hard gates: without them there is no valid submission, however good
the code is.

**48 days left** as of 24 November 2026. The deadline is **11 January 2027, 08:00 PT**. None of
these is urgent today. All four are cheap if done with a month to spare and expensive in the
last week, and the first one blocks measurements the rest of the work depends on.

---

## 1. A hosting account — this one blocks other work, not just the submission

The submission must include *"a public URL to the agentic website"*. The site also has to be
served from **two separate HTTPS origins**, because three of the specification's seven
interoperability checks are about one site loading another site's agents across an origin
boundary. A second path on the same host does not test anything; the browser's origin rule is
the mechanism under test.

I checked this machine: no `vercel`, `netlify` or `wrangler` command is installed and there is
no saved configuration for any of them. So there is no deploy credential here, and creating an
account or paying for one is yours, not mine.

**What to pick.** Either **Cloudflare Pages** or **Netlify** (both read the `public/_headers`
file already in the repo), or **Vercel** (reads the `vercel.json` already in the repo). All
three configs ship, because they are not interchangeable and a single one would be a silent
no-op on the wrong host. Any of the three is fine; free tiers cover this.

**GitHub Pages will not work.** It cannot set response headers at all, and CORS on the three
published files is a specification MUST. It is the obvious free choice and it is the one that
fails.

**Correction, 24 November 2026: you already have a Vercel account, so this item is much smaller
than it was written.** There is a deliberate `vercel.json` at `~/Desktop/PW` with a schema
reference and cache headers — that is how webrizz.dev is served — and a `netlify.toml` in a
previous hackathon folder. So there is no signup, no new account and nothing to pay for. What is
left is two commands, and `docs/DEPLOY-RUNBOOK.md` has them.

**Why the two commands are yours and not mine.** The deploy needs a credential, and this session's
sandbox denies me read access to `.env` precisely so that keys never pass through me. That limit is
working correctly, and I would rather not have it lifted for a token that can create and delete
deployments on your account. Everything either side of those two commands is mine.

**And I found a defect in our own deploy config while preparing it** — `peer/vercel.json` is
unreachable as configured, for the same reason this project keeps finding: it looks right and
cannot be read. The runbook explains it, and the first deploy settles it by measurement rather than
by my model of how Vercel resolves config.

**What I need from you:** the two commands in `docs/DEPLOY-RUNBOOK.md`, and the two URLs they
print. Two projects on one account is enough —
they get different origins. The repo already builds both halves: `npm run build` produces
`dist/` (the deli) and `peer-dist/` (the second site).

**Three published fields are deliberately empty until the peer origin exists, and they go in
together.** The site currently vouches for no external origin at all:

| File | Field | Today | On deploy |
|---|---|---|---|
| `public/agent-manifest.json` | `allowed_peers` | `[]` | `["https://<PEER-ORIGIN>"]` |
| `public/links.json` | `networks.vouch` | `{}` | `{ "marrow_point": "https://<PEER-ORIGIN>/agents/marrow_point" }` |
| `public/vouch.network.json` | `menu_guide.tools` | `[]` | `["marrow_point"]` |

All three in one commit, or the site breaks rather than degrades: a symbolic reference with no
binding is a missing tool to the validator, which refuses the network at startup. Then point
`PEER_ORIGIN` in `tests/peer.test.ts` at the real origin — the whole peer suite runs against a
reserved-TLD fixture until then — and delete `tests/peer.test.ts`'s "the published artifacts
vouch for no origin" test in the same commit, reading its comment first.

**Why they are empty.** They were not. We published `allowed_peers:
["https://marrow-point-bakery.vercel.app"]` and a binding to it, for a **claimable
`*.vercel.app` subdomain nobody here owns** — so whoever registered that Vercel project name
would have been an allow-listed peer of this site, run in a visitor's browser on the visitor's
own key. If you deploy the peer to Vercel, that project name is fine to claim *because you will
own it*; until then nothing may name it. `docs/DECISIONS.md` has the full record.

**Why this blocks more than the URL.** A list of things currently verified only on localhost,
which is where this project has already been bitten once: the page layout at real widths, colour
contrast on the verdict cards, whether CORS headers actually arrive, and the conformance
checker's verdict on the real site. Those become real checks the day a URL exists, and guesses
until then.

---

## 2. The demo video — your voice, and the rules say so

Under two minutes, public on YouTube, showing the site running in a browser, and the rules say it
*"should include the Entrant explaining the Project"*. That means a voice-over by you. I cannot
record one and should not fake one.

**`docs/DEMO-SCRIPT.md` is written and ready to read aloud.** Nine shots, 1:55 with five seconds
of margin, every line timed, and it says which shot to cut first if you run long. Every on-screen
string it quotes has been read out of the live page rather than drafted, so you can check the
recording shows what the script claims.

The central shot — a model saying something reassuring and wrong, the claim withheld, the
contradicting verdict beside it — is confirmed rendering as a **single frame**. That shot is the
whole video. If it is not legible, re-shoot it rather than narrating around it.

Needs item 1 first: record the deployed site at a real width, not localhost in a narrow window.

---

## 3. The Devpost form

Yours, because it includes eligibility declarations and I will not complete an attestation on
your behalf. The required fields are the public URL, a text description of features and
functionality, the video link, and one or more screenshots.

The text description is written and ready to paste: `docs/SUBMISSION-TEXT.md`.

Check the video upload is set to **Public**, not Unlisted — an unlisted video answers a link
check and is still invisible to a judge who searches.

### The screenshots are yours too, and here is the shot list

I said earlier that I would produce these. That was wrong in two ways, and correcting it is
cheaper than leaving you to discover it: they should be of the **deployed** site, and in any
case I cannot write an image file out of the browser I drive. So this is a shot list, in the
same form as the video script, and **I have confirmed every state below renders on the built
site** — so none of it is a guess about what you will see.

Four shots, in priority order. One is enough to satisfy the field; the first two are the ones
that argue the case.

**1. The verdict cards, with an unsafe one in frame.** Tick **Dairy-free** and scroll to the
Turkey club. The card reads *"✕ Unsafe for what you told us — Contains dairy, through Brioche
bun → Brioche → Butter → Dairy. Checked against: Dairy-free."* Butter three steps down a tree,
in a bun, with nothing in the ingredient line a person would read. Get the status line in frame
too if you can — *"Checked 34 dishes against Dairy-free: 15 unsafe, 3 we cannot tell, 16 with no
conflict found"* — because it shows the verdict is a sweep and not a lucky example.

**2. The withheld claim beside the contradicting verdict.** Tick Dairy-free, turn on *"Replay a
recorded reply instead of calling a model"*, leave the scenario on **A model giving a false
all-clear**, and ask anything. The transcript shows *"Replayed reply, not a live model call"* and
three sentences reading *"[A claim here was withheld; see the ingredient list.]"* — with the
unsafe Turkey club card beside them. This is the whole thesis in one frame and it is the one to
get right.

**3. A refusal.** Type `/broken/invalid` into *"Load a published agent network"* and press Load.
It refuses with the validator's own words, fenced and attributed: *"Refused: the published
network below is not valid, so it was not run… copied exactly from the published document and
kept apart from our own words, because this site did not write them"*, then the URL, then
*"metadata.front_man names 'concierge', which is not an agent…"*. Three deliberately broken
networks are published so this can be watched rather than taken on trust.

**4. The honest empty state.** Before ticking anything: the standing note — *"The assistant does
not decide whether food is safe for you, and is not permitted to"* — above 34 dishes with no
verdict cards at all, and the line *"Nothing is being checked yet."* The site does not pretend to
have checked something you have not told it about. A quiet shot, and the one a judge is least
likely to have seen from anyone else.

Shoot at a real window width, not a narrow one — the same reason the video script gives.

---

## 4. A public repository — not required, but it is a scored line item

This is the only one of the four that is optional. The repo has **no git remote** at all right
now, and the `gh` CLI's saved token is invalid (`gh auth refresh -h github.com` would fix that,
and needs your login).

It is worth doing because of one scoring line. "Potential Impact" asks, verbatim: *"Does the
project include any tools or services the Entrant built and shared with the community?"* The
conformance checker is our answer to that, and "shared" has to be true: the repo is licensed
Apache 2.0 with a NOTICE file and `private` removed from `package.json`, so it is legally
shareable — it just is not shared anywhere yet.

A judge cannot score a tool they cannot find.

---

## What is not waiting on you

For completeness, so this list does not read as though the entry is stalled: the site, the
deterministic checker, the gate, five published refusals, cross-origin peer composition behind
consent, key isolation, the conformance checker, the limits document and the decision record are
either done or in progress and need nothing from you. One qualification, because it is the one
piece of built work that is *switched off* in what we publish rather than merely unmeasured:
cross-origin peer composition is written and tested, and the three fields that point it at a
peer are empty until item 1 above. The only tasks that touch these four items
are the deploy-and-measure pass and the submission itself.
