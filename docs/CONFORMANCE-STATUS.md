# Where we stand on the seven §6 checks

Stage One of judging is **pass/fail on conformance**, so this is the gate before any of the four
scored criteria is even read. This file says where each of the seven checks actually stands, and
— more usefully — *how strongly* each one is known, because "the test passes" and "I watched it
happen in a browser" are different claims and this project does not get to blur them.

Four levels are used below, strongest first:

- **browser-verified** — someone drove the built site in a real browser and read the result.
- **payload-asserted** — a test asserts on captured network requests, not on a variable.
- **tested** — covered by the suite, in jsdom.
- **needs a deployed origin** — cannot be known until the site is hosted.

Last updated 24 November 2026. `docs/OWNER-TODO.md` lists what is blocked and on whom.

---

| # | Check | Status | How strongly |
|---|---|---|---|
| 1 | Publish a two-agent network and manifest from an ordinary HTTPS host | Built; not hosted | **needs a deployed origin** |
| 2 | Load and run it with the published default router; demonstrate BYOK too | BYOK path yes; funded-default no | tested; **no browser run with a provider key** |
| 3 | Call an internal agent **and** a grounded capability via MCP or a site action | Yes, via site actions | tested |
| 4 | After approval, load an exact named network from a second origin, run it locally | Built; **no peer wired in what we publish** | **browser-verified across two loopback origins** |
| 5 | The second site never receives the user's key and cannot change the caller's router | Yes | **payload-asserted** |
| 6 | Private context absent at the peer unless explicitly allowed | Yes | **payload-asserted** |
| 7 | Stop an invalid network, a composition cycle, an over-budget request and a denied origin, visibly | Five refusals, not four | tested; three browser-verified |

---

## The detail, check by check

**1 — Publish from an ordinary HTTPS host.** The network has four agents, not two, and the three
required files are published and pinned by name in `tests/artifacts.test.ts`. What does not exist
is the HTTPS host: no deploy credential is on this machine. CORS configuration for both honoured
formats ships (`public/_headers` for Cloudflare Pages and Netlify, `vercel.json` for Vercel),
but **a config file is not evidence** — a `_headers` file on Vercel is a silent no-op, and so is
the reverse. The header has to be read off a real cross-origin response. This is the single
highest-value verification still outstanding.

**2 — Published default router, and BYOK.** This is the one check we do not claim outright, and
the honest statement has three parts. §4's requirement level is **MAY**: "A site MAY publish a
default router and model that work without a visitor-supplied key." We publish a default router
and model — protocol, endpoint, model name — and decline the key-free part, which is an option
and not a mandate. The check's **second** clause, "if BYOK is offered, also demonstrate the
user-selected path", we satisfy in full. Its **first** cannot be run here without a visitor key.
And the specification nowhere says a BYOK-only site conforms, nor that it fails; that silence is
the real situation and we name it rather than resolving it in our own favour.

Our own conformance checker scores this `not-demonstrated` with the reason — never a quiet pass.
A strict reader may mark it unmet, and that is the correct way to lose a point.

**This row said "browser-verified (BYOK)" for a review round and nothing records such a run.**
By the scale at the top of this file, browser-verified means someone drove the built site and
read the result; no browser run anywhere in this project has used a provider key, because none
has been supplied. What is verified is the *route selection*, run against our published manifest
by both reference runtimes' own selectors (`RESULTS.md` §3.3), and the key panel's rendering on
the built site. The request itself has never been made. Downgraded to what is true.

Corroboration, from two different reference runtimes, both checked rather than assumed. They are
named by repository and path because this project has two "upstreams" whose organisation names
differ by one letter.

**The starter runtime** — `cognizant-ai-labs/agentic-web` (organisation *plural*), the event's own
spec-and-starter repository, at commit `d67755e762`,
`skills/agentify-website/runtime/engine.js:56-73` — gates publisher funding behind an explicit
`llm_router.publisher_funded === true` and exports `isPublisherFundedRouter`. Run against
`public/agent-manifest.json` it reports **`publisherFunded: false` in all five configurations with
no error**, and `isPublisherFundedRouter` is false for both our routers. So the manifest makes no
claim that this site pays for inference — the claim it would be easiest to make by accident.

Sharper, as a counterfactual: `skills/agentify-website/scripts/build_network.mjs:667-673` refuses a
manifest whose `byok_router` equals its `base_url` *when* `publisher_funded` is true — and **ours
are equal**. Setting that one flag would have our own manifest refused by the event's own build
check. Verified both ways. The refusal arrived in commit `9fb36d3dbe`.

**The adapted runtime** — `cognizant-ai-lab/nsdeploy` (organisation *singular*), pinned in
`docs/vendor/PROVENANCE.md`, whose `selectTopRouter` is what `src/runtime/upstream/router.ts` is
adapted from — runs our manifest in five configurations without throwing: our published default
with no key, an upgrade to `byok_router` with one. That is a smaller claim than "the default path
runs without a key" and is the one we are entitled to.

The two runtimes' `selectTopRouter` differ in exactly this area — the starter's returns a
`publisherFunded` field and the adapted one does not — so neither is called simply "upstream" here.
Figures, commands and the one-letter trap that briefly cost this claim a wrong withdrawal are in
`docs/RESULTS.md` §3.3 and `docs/LIMITS.md` §2.5a.

**3 — An internal agent and a grounded capability.** Four registered site actions
(`get_menu_state`, `check_safety`, `add_to_cart`, `checkout_demo_order`), each published with
`name`, `purpose`, `effect` and a JSON Schema in `parameters` — §3.1's own field names (Minimum
Runtime Behavior, spec line 203; §2.1 is Minimum Network Content and contains neither word). The check
reads "via MCP **or** a registered local site action", so shipping no MCP server is not a gap.

`check_safety` is the one that carries the argument: it is the only source of a safety verdict and
it is **not callable from any agent's tools**. The model can describe, rank and converse; it
cannot reach the thing that decides.

**4 — A named network from a second origin, after approval.** Verified in a real browser across
**two loopback origins** — `localhost:4178` (the built deli) and `localhost:4179` (the built
peer) — on 24 November 2026, which is the first time §6 checks 4-6 were exercised outside jsdom.
Two ports are a browser origin boundary; they are **not** two hosts, so this says nothing about
CORS or HTTPS, and this file's weakest grade is still "needs a deployed origin". The full record,
with the commands, the date, what was modified in the built output and what was observed in
order, is `docs/RESULTS.md` §4.5 — it had no entry there at all for a review round, and three of
the seven grades in the table above rest on it.

The result worth keeping, and the reason the run was made: **before approval, zero network
requests reached the peer origin.** Not "the card appeared first" — the browser's own network
log, filtered on the peer port, returned nothing. Consent is a gate, not a notice, which is what
"After user approval" actually demands. After approval the peer loads, validates and runs
locally; a second contact asks again with the box unticked; declining reports that nothing was
fetched.

**And the deli publishes no peer today.** The allow-list entry this ran against named a claimable
`*.vercel.app` subdomain we do not own, and it is withdrawn with its binding and its symbolic
reference (`docs/DECISIONS.md`). The capability is unchanged and tested; what is empty is the
three published fields, and they go back in at the deploy step (`docs/OWNER-TODO.md` item 1).

**5 — No key at the peer, no router takeover.** Asserted on **captured request payloads**: every
request a session makes is recorded at the moment it is made and its body read at scan time, so
neither the body's type (string, `URLSearchParams`, `FormData`, stream, `Blob`) nor a
fire-and-forget beacon can hide a leak. The key assertion is an exact whitelist of where the
credential may appear, not a count. What this cannot see is documented in `LIMITS.md` §2.0a.

**6 — Private context absent unless allowed.** Same method, with a sentinel value and the rule
proved live by naming the field at both boundaries. One honest limitation, stated in `LIMITS.md`
§2.3 and not claimed away: the per-agent `allow` blocks govern flow to and from *external* agents.
The upstream reference is explicit that private data is already visible to every agent **inside**
a network, so we do not claim those blocks isolate our own agents from each other.

**7 — Visible refusals.** The specification names four. We publish **five**, because a missing
provider key must also stop a model call with a clear setup error, and that one lets us say the
thing only this project can: the checker and the verdict cards keep working with no key at all,
because they never call a model. A visitor with no AI provider still gets every safety answer the
site can give.

Three are confirmed rendering on the built site — invalid network, composition cycle, and a
refused contact. Three deliberately broken networks are **published** at `/broken/`, so the
refusals can be watched rather than taken on trust.

---

## Our own checker, run against our own site

Run by the controller on 24 November 2026 against the built deli served on loopback, first-hand
rather than on a report:

```
14 checks made, 6 not checked.
Result: 1 failed, 13 passed, 6 NOT CHECKED — exit 1
```

The thirteen passes cover the manifest and its exact-name match, the resolved network definition,
the link map, network and agent identity, JSON-Schema invocation shapes, named private-context
fields, §2.2 portability, full referential integrity, the HTTPS rule, and the absence of any
published credential.

**The one failure is CORS, and it is the honest answer to what was measured.** A `vite preview`
server applies neither `public/_headers` nor `vercel.json` — those are host-level configuration —
so all three artifacts came back with no `Access-Control-Allow-Origin`. The checker read that off
a real response to a GET carrying a real `Origin` header, not from a config file, and it named all
three artifacts. For a stranger's site that result would be a true failure; for ours it means only
that loopback is not a host.

**This is exactly why CORS is the highest-value verification left.** It is the one check that
passes locally in every wrong configuration and fails deployed, and nothing short of a real
cross-origin request against the real host can settle it.

The six NOT CHECKED are the six that need a browser and a live model, and the checker's own
reasoning on the refusals check is worth quoting, because it declines to credit us for something
we did do: *"it will not read the presence of a broken fixture on a site as evidence that anything
refuses it."* We publish three deliberately broken networks; the tool correctly treats that as
unverified rather than as proof.

### Two caveats about the checker's own test coverage

Both weaken claims that the test count would otherwise imply, so they are stated here rather than
left in a report:

1. The five tests that assert on a real CORS response prove **the checker reads a real header
   correctly**. They say nothing whatever about our deployed site.
2. `.github/workflows/ci.yml` has **never run**, because this repository has no remote. Every
   "CI runs it" claim in the project is about the file, not about a run that happened. The five
   CORS tests are, today, verified by manual runs outside the restricted local environment —
   they pass — and nothing else.

---

## Widths, contrast and the no-JavaScript path, measured on the built site

Measured by the controller on 24 November 2026 in a real browser against the built output, with
ratios **computed in the page** rather than judged from a screenshot. Task 10 repeats all of it
on the deployed origin; what changes is that a failure there now points at the deployment rather
than at the code.

**Widths — no horizontal scroll at any of 320, 375, 570, 900 or 1440px**, and no element
extending past the viewport at any of them. The single element found outside the viewport is the
skip link at `left: -999px`, which is the correct pattern for one and is not a defect. This
matters because the responsive bug this project already shipped had three independent causes, one
visible only at 320px and two only at 375px.

**Contrast — every verdict card passes WCAG AAA.** Computed foreground against the nearest opaque
background, walking up the tree, for all three verdict states:

| Element | Size | Unsafe | We don't know | No conflict found |
|---|---|---|---|---|
| Icon and headline | 16.8 / 15.2px bold | 8.67 | 7.47 | 8.50 |
| The deciding reason | 14.08px | 13.56 | 14.34 | 13.87 |
| "Checked against" and the caption | 11.84px | 7.36 | 7.78 | 7.53 |

The lowest ratio anywhere on a verdict card is **7.36** against a AAA threshold of 7.0 and an AA
threshold of 4.5. A verdict card that cannot be read is a safety failure rather than a style nit,
so this is the measurement that most needed making.

**One judgement call, raised and decided:** the caption carrying *"Not a statement about the
kitchen, and not medical advice"* renders at **11.84px** (0.74rem against a 16px root). It passes
AAA on contrast and it is a disclaimer repeated on 34 cards, so small is defensible — but it is
below the 12px most guidance treats as a floor, and it is the one sentence on the card that limits
what the verdict means.

**The owner's decision, 24 November 2026: leave it as designed.** Recorded here because the point
of raising it was to make it a choice rather than an oversight. Anyone who reads this and disagrees
is disagreeing with a decision, which is the right thing to be able to do.

**The no-JavaScript path is correct by construction, not by accident.** Checked against the built
`dist/index.html` (22,911 bytes) rather than in jsdom:

- All 34 dishes and all 34 ingredient blocks are in the static markup, "Turkey club" and "Butter"
  among them — so the ingredient data a person would check is readable with scripts off.
- **None** of the agent panel's text is in the static HTML: not its heading, not the standing
  note, not the restriction controls, not the key panel. The whole panel is built by script. So
  with JavaScript off the page promises no assistant, rather than showing a dead one.
- The 34 verdict slots are in the static markup but collapse, because
  `.verdict-slot:empty { display: none }`. No empty boxes and no unexplained placeholders.
- One element is hidden in the static markup: the confirmation dialog's `role="status"`
  container. One script tag. No `<noscript>` block is needed, because nothing is missing.

---

## What is only knowable after a deploy

Honest list, so none of it is quietly assumed:

1. **CORS headers actually arriving** on all three artifacts from a cross-origin request.
2. **HTTPS** — check 1's literal wording.
3. Layout at 320 / 375 / 570 / 900 / 1440px and contrast ratios **computed in the page**, on the
   real site. A verdict card unreadable at 320px is a safety failure, not a style nit.
4. The no-JavaScript path, tested only locally so far.
5. Our own conformance CLI's verdict on the deployed site. If it fails us, that is the tool
   working — report it and fix the site, never tune the checker until we pass.
