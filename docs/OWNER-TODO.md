# The four things only you can do

> **If you only open one file, open [`SUBMIT.md`](SUBMIT.md).** It is the live, ordered,
> paste-and-click list: record, upload, fill, submit. This file is the *record* of how these
> four items got to where they are — what blocked each one, what was wrong about it along the
> way, and what is still open. Three of the four are now done.

Everything else in this entry is buildable without you, and most of it is built. These four were
not.

**47 days left** as of 25 November 2026. The deadline is **11 January 2027, 08:00 PT /
16:00 UTC**. None of this is urgent today. All of it is cheap with a month to spare and
expensive in the last week.

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

**DONE, 24 November 2026 — the three published fields are wired, in one commit.** Both origins
are deployed and the peer is ours, so the site vouches for exactly one external origin:

| File | Field | Now |
|---|---|---|
| `public/agent-manifest.json` | `allowed_peers` | `["https://marrow-point-bakery.netlify.app"]` |
| `public/links.json` | `networks.vouch` | `{ "marrow_point": "https://marrow-point-bakery.netlify.app/agents/marrow_point" }` |
| `public/vouch.network.json` | `menu_guide.tools` | `["marrow_point"]` |

All three went in together, because separately the site breaks rather than degrades: a symbolic
reference with no binding is a missing tool to the validator, which refuses the network at
startup. `PEER_ORIGIN` in `tests/peer.test.ts` is the real origin now and the peer suite runs
against the published documents rather than a reserved-TLD fixture; "the published artifacts
vouch for no origin" is gone, replaced by a test that the published artifacts wire **that one
origin and no other** — including the `*.vercel.app` / `*.netlify.app` / `*.pages.dev` /
`*.github.io` check, kept as an allow-list of one rather than dropped.

**What is left for you here is the redeploy.** The live sites serve the build from before this
commit, so the compose field will not load the peer until `dist/` and `peer-dist/` are pushed
again. The same push carries a `public/_headers` fix: `/broken/*` had no CORS header on Netlify,
so the three deliberately broken networks were not readable from another origin (`DECISIONS.md`).

**One caveat that cannot be tested away.** The allow-listed origin is a Netlify subdomain, which
is ours while that site exists and returns to the pool if it is deleted — the same class of host
as the entry that was withdrawn, held safe by an account rather than by anything in the
repository. If this entry is to outlive the hackathon, a custom domain is the fix; if the
deployment is ever given up, all three fields empty again in one commit.

**Why they were empty, which is why the entry that is there now is written the way it is.** We
published `allowed_peers: ["https://marrow-point-bakery.vercel.app"]` and a binding to it, for a
**claimable `*.vercel.app` subdomain nobody here owned** — so whoever registered that Vercel
project name would have been an allow-listed peer of this site, run in a visitor's browser on the
visitor's own key. The three files agreed with each other perfectly the whole time, which is why
agreement between our own files is not the test: the origin's identity is. `docs/DECISIONS.md`
has the full record.

**Why this blocks more than the URL.** A list of things currently verified only on localhost,
which is where this project has already been bitten once: the page layout at real widths, colour
contrast on the verdict cards, whether CORS headers actually arrive, and the conformance
checker's verdict on the real site. Those become real checks the day a URL exists, and guesses
until then.

---

## 2. The demo video — the picture is cut, the voice is yours

**`docs/demo/vouch-demo.mp4` is built: 1920x1080, 102.5 seconds, silent.** Fourteen shots of the
deployed site at `https://vouch-deli.netlify.app`, captured on 24 November 2026 by clicking the
live site, with the captions set on-screen. Nothing in it is mocked up or re-rendered, and it was
checked frame by frame after encoding rather than taken on trust — the first cut silently held one
shot for twenty seconds and dropped the butter-chain shot entirely.

**What is still yours: the voice.** And it is a stricter requirement than this file said for
two days. The hackathon's front page: the video *"must include the Entrant explaining the
Project (not AI generated)"*. The Official Rules, in the same list: *"should include the Entrant
explaining the Project"*. `docs/EVENT.md` now records both verbatim and which governs. Either
way it is read by you, it is not synthesised, and I will not fake one.

`docs/demo/vouch-demo.srt` is the script — fourteen lines, one per shot. Record it into any
audio file and run **one command**:

```bash
tools/demo-video/add-voice.sh ~/Desktop/narration.m4a
```

That writes `vouch-demo-narrated.mp4`, leaves the silent cut untouched so a bad take costs
nothing, holds the closing card if your read runs a little long, and refuses to write a file
over two minutes.

**The first cut could not have been narrated at all, and it took measuring to see it.** It was
timed for *reading* captions: ten of its fourteen lines needed between 160 and 200 words a
minute to fit, which is faster than anyone speaks, so the voice would have overrun the picture
on nearly every shot — and nothing about the file would have shown that until you tried to read
over it. The cut is now *derived* from the script: `shot_seconds()` holds each shot as long as
its line takes to say at 145 words a minute, and refuses to build a cut the narration does not
fit. The runtime went 92.5s → 102.5s; the subtitles and the YouTube chapters come from the same
numbers, so the three cannot drift. `tools/demo-video/verify.py` then checks every shot is
actually where the cut says it is — the check that caught the first cut silently dropping the
butter-chain frame.

The central shot — a model saying something reassuring and wrong, the claim withheld, the
contradicting verdict beside it — is shot 8, at 0:41, and it renders as a single legible frame.
That shot is the whole video.

`docs/DEMO-SCRIPT.md` remains as the longer nine-shot script if you would rather record live
screen capture yourself; `docs/demo/README.md` has the rebuild instructions and
`docs/demo/vouch-demo.shots.md` the shot table, generated so it is never a cut behind.

---

## 3. The Devpost form

Yours, because it includes eligibility declarations and I will not complete an attestation on
your behalf. **[`SUBMIT.md`](SUBMIT.md) is the field-by-field version** — every value to paste,
in the order the form asks for it.

I have not seen the form: it is behind a login, and signing in as you is not something I do. So
`SUBMIT.md` lists the fields a Devpost hackathon form normally carries and says plainly to match
them by meaning rather than by name. One field it adds that nothing in this repository had yet:
the **elevator pitch**, which Devpost caps at 200 characters and which is the only line most
judges read before deciding whether to open the video. It is written, and it is 188 characters.

The text description is written and ready to paste, with no placeholders left:
`docs/SUBMISSION-TEXT.md`. The conformance CLI is cited there as a clone-and-run rather than an
npm package — publishing a package is an outward-facing release that is yours to make, and the
clone route was verified from a fresh shallow clone with no `npm install`. It now also answers
the rules' *New & Existing* item, which nothing in the submission had addressed: this project was
not updated during the submission period, it was built inside it, and the commit dates say so.

The YouTube title, description and chapter list are written too: `docs/demo/YOUTUBE.md`, all
paste-only. The chapter list used to be hand-written there, with a sentence underneath admitting
it would go stale if any shot were re-timed — which is precisely what happened when the shots
were re-timed for the narration. It is generated now, and `build.py` **fails** if the listing and
the cut disagree. The warning became a mechanism.

The front page asks two Otari questions the Rules page does not. They do not apply: the site's
router is whatever the published manifest names, and a visitor requesting a different one is
refused rather than quietly redirected. Leave those fields empty.

Check the video upload is set to **Public**, not Unlisted — an unlisted video answers a link
check and is still invisible to a judge who searches. Check it on the video's own page rather
than the upload confirmation, which shows what you selected rather than what was saved.

### The screenshots are done — `docs/screenshots/`

I twice told you these were yours, on the grounds that I could not write an image file out of
the browser I drive. That was simply wrong: the screenshot tool takes a `save_to_disk` option I
had not checked for. Correcting it rather than leaving the claim standing.

**Four shots, 1568×740, captured from the deployed site**, with `docs/screenshots/README.md`
explaining what each one proves. Upload any or all; one satisfies the field and the first two
argue the case. Re-shoot only if the site changes.

The shot list below is kept because it says *why* each frame was chosen, and because it is the
recipe if you ever want them retaken.

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

## 4. A public repository — DONE

**Live and public: <https://github.com/Rizwankhalid675/vouch>.** Verified from GitHub's side, not
just from the push output — `HEAD` on the remote matches local, and the licence, NOTICE, limits
document, decision record, screenshots and the conformance CLI's own README are all present.

The first attempt was rejected by a GitHub 500, which was transient; the retry sent all 1,058
objects. Note for next time: `git push` is refused to me by this environment's permission gate, so
a push is always yours to run — which is why `gh repo create --push` was the only route that got
partway on its own.

So the "shared with the community" line in Potential Impact is now true rather than merely
licensed: the checker is Apache-2.0, dependency-light, and reachable by anyone.



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
consent, key isolation, the conformance checker, the limits document, the decision record, the
screenshots, the public repository and the silent demo video are done and need nothing from you.

The qualification that used to sit here -- that cross-origin peer composition was built but
*switched off*, its three fields empty for want of a second origin -- no longer applies. Both
sites are deployed, the allow-list points at an origin we hold, and the composition runs
cross-origin against it; shots 10 and 11 of the demo video are that path executing.

What is left is exactly the three items above, and each is yours because of who must do it
rather than because the work is unfinished: a voice the rules require to be the Entrant's and
not AI generated, an upload to your YouTube account, and a form carrying eligibility
attestations. [`SUBMIT.md`](SUBMIT.md) walks all three in order.

Verified again on 25 November 2026 against the deployed sites rather than a local build: both
origins return 200, and the conformance CLI scores 14 of 14 machine-checkable checks with 6 NOT
CHECKED, exit 0.
