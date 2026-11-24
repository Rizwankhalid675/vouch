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
| 2 | Load and run it with the published default router; demonstrate BYOK too | BYOK path yes; funded-default no | tested + browser-verified (BYOK) |
| 3 | Call an internal agent **and** a grounded capability via MCP or a site action | Yes, via site actions | tested |
| 4 | After approval, load an exact named network from a second origin, run it locally | Yes | **browser-verified across two origins** |
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

Corroboration, since it was checked rather than assumed: upstream's current runtime gates
publisher funding behind an explicit `llm_router.publisher_funded === true`. Run against our
published manifest it reports `publisherFunded: false` with no error, so the manifest makes no
claim that this site pays for inference — the claim it would be easiest to make by accident.

**3 — An internal agent and a grounded capability.** Four registered site actions
(`get_menu_state`, `check_safety`, `add_to_cart`, `checkout_demo_order`), each published with
`name`, `purpose`, `effect` and a JSON Schema in `parameters` — §2.1's own field names. The check
reads "via MCP **or** a registered local site action", so shipping no MCP server is not a gap.

`check_safety` is the one that carries the argument: it is the only source of a safety verdict and
it is **not callable from any agent's tools**. The model can describe, rank and converse; it
cannot reach the thing that decides.

**4 — A named network from a second origin, after approval.** Verified live across two real
origins, which is the only way three of these checks mean anything. The strongest single result
this project has: **before approval, zero network requests reached the peer origin.** Not "the
card appeared first" — nothing went out at all. Consent is a gate, not a notice, which is what
"After user approval" actually demands. After approval the peer loads, validates and runs locally;
a second contact asks again with the box unticked; declining reports that nothing was fetched.

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

## What is only knowable after a deploy

Honest list, so none of it is quietly assumed:

1. **CORS headers actually arriving** on all three artifacts from a cross-origin request.
2. **HTTPS** — check 1's literal wording.
3. Layout at 320 / 375 / 570 / 900 / 1440px and contrast ratios **computed in the page**, on the
   real site. A verdict card unreadable at 320px is a safety failure, not a style nit.
4. The no-JavaScript path, tested only locally so far.
5. Our own conformance CLI's verdict on the deployed site. If it fails us, that is the tool
   working — report it and fix the site, never tune the checker until we pass.
