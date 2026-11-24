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

**What I need from you:** an account, and either the credential in place so a deploy command
works from here, or you running two deploys yourself. Two projects on one account is enough —
they get different origins. The repo already builds both halves: `npm run build` produces
`dist/` (the deli) and `peer-dist/` (the second site).

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

I will draft the text description and produce the screenshots once there is a deployed site to
screenshot. Check the video upload is set to **Public**, not Unlisted — an unlisted video
answers a link check and is still invisible to a judge who searches.

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
either done or in progress and need nothing from you. The only tasks that touch these four items
are the deploy-and-measure pass and the submission itself.
