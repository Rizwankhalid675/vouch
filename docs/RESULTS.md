# Results

Every measurement this entry makes about itself, with the command that produced it and
the date it was run. Written so that a reader can reproduce any line rather than take
it on trust, and so that the things we have **not** measured are as visible as the
things we have.

Two rules this file follows:

1. **A configuration file is not evidence.** Where a claim could only be settled by
   reading a real response, this file either records the real response or says the
   claim is unmeasured. It never infers a result from a config file that would produce
   it.
2. **Nothing is recorded as passing that was not run.** Items waiting on a deploy are
   marked `NOT MEASURED — needs a deployed origin` and carry the exact command.

Last run **24 November 2026**. `docs/OWNER-TODO.md` lists what is blocked and on whom;
`docs/CONFORMANCE-STATUS.md` says where each of the specification's seven
interoperability checks stands and how strongly.

---

## 0. What is still missing, in one place

The deploy is blocked on the owner: no `vercel`, `netlify` or `wrangler` is installed
on this machine, there is no saved configuration for any of them, and the repository
has no git remote. Nothing below was improvised around that.

| # | Blocked item | Spec | Command to run the moment a URL exists |
|---|---|---|---|
| B1 | **The deployed origins** | §3.3, §6 check 1 | `npm run build && npm run build:peer`, then deploy `dist/` and `peer-dist/` to two separate origins |
| B2 | **CORS headers on the three artifacts, read off a real cross-origin response** | §3.2, §3.3, §3.4 | `npm run conformance -- https://<DELI-ORIGIN>/vouch --origin https://agentic-web-conformance.invalid` |
| B3 | The conformance CLI's verdict on the deployed site | §6 | as B2, and again for the peer: `npm run conformance -- https://<PEER-ORIGIN>/agents/marrow_point` |
| B4 | Widths and contrast on the deployed build | — | open each origin at 320 / 375 / 570 / 900 / 1440px with a cache-buster; compute ratios in the page |
| B5 | The no-JavaScript path on the deployed build | §3.1 | load the deployed page with scripting disabled |
| B6 | The five CORS tests in our own suite | — | `npm run test:cors` (see §6 below — they are **skipped**, not passed, in this environment) |

**Fill these in: the deployed origins.**

| | Origin | Host | Deployed |
|---|---|---|---|
| Deli (top site) | `PLACEHOLDER — not yet deployed` | *Cloudflare Pages / Netlify / Vercel* | — |
| Bakery (peer) | `PLACEHOLDER — not yet deployed` | *as above, second project* | — |

**Fill these in: the CORS response headers, read off a real cross-origin GET.** Three
artifacts, one row each. `public/_headers` and `vercel.json` both ship because they are
not interchangeable, and **neither is evidence** — on the wrong host each is a silent
no-op with every local test green.

| Artifact | `Access-Control-Allow-Origin` as sent | Status |
|---|---|---|
| `/agent-manifest.json` | `PLACEHOLDER` | NOT MEASURED |
| `/vouch.network.json` | `PLACEHOLDER` | NOT MEASURED |
| `/links.json` | `PLACEHOLDER` | NOT MEASURED |

---

## 1. Our own conformance CLI, run against our own artifacts

`tools/conformance` reports **20 checks** in every state: 14 it can make from a shell
and 6 it declines because a command line has no browser, no agent loop and no model
credential. The set is held by a type for its membership and by a test for its
completeness, so a run cannot silently omit one.

### 1.1 The run

Two runs are recorded, because they measure different things and neither is a
substitute for the other.

**Run A — the built deli served on loopback, by the controller, 24 November 2026.**
This is the run that exercised the real HTTP path.

```
14 checks made, 6 not checked.
Result: 1 failed, 13 passed, 6 NOT CHECKED - exit 1
```

**Run B — the same CLI against the current `dist/`, 24 November 2026, through an
injected fetch.** Run because Run A predates the commits since, and because this
session cannot bind a loopback port (`EPERM: listen 127.0.0.1`). It uses the real tool
via its exported `runChecksOn`; only the transport is substituted, and **no header is
synthesised from `public/_headers` or `vercel.json`**, which is why CORS fails here
exactly as it did in Run A.

```
20 checks reported.  13 pass, 1 fail, 6 not-demonstrated.
```

Run A and Run B agree on all 20 checks.

### 1.2 Per check

| Check | Spec | Status | Offending value / reason |
|---|---|---|---|
| Site manifest published and readable by a public GET | §3.3 | **pass** | — |
| The requested network name matches a manifest entry exactly | §3.2 | **pass** | — |
| Resolved network definition published and readable by a public GET | §3.3 | **pass** | — |
| Peer-network link map published (`links.json`) | §3.3 | **pass** | — |
| Network identity: stable name, short description, named front agent | §2.1 | **pass** | — |
| Agent definitions: unique name, description, instructions when it uses an LLM | §2.1 | **pass** | — |
| A two-agent network is published | §6 | **pass** | four agents, not two |
| Invocation schemas are JSON-Schema compatible in the honoured form | §2.1 | **pass** | — |
| Private-context fields are named, not allowed in bulk | §2.1 | **pass** | every `allow` list is `[]` |
| Published definition is portable data: no includes, substitutions, env or publisher paths | §2.2 | **pass** | — |
| Every reference resolves: front agent, in-network agents, link-map bindings, URLs, MCP | §3.1 | **pass** | — |
| Served over HTTPS (loopback HTTP allowed for local development) | §3.3 | **pass** | passes on loopback by the development allowance; **re-run deployed** |
| **CORS header present on the real response for every public artifact** | §3.4 | **FAIL** | **no `Access-Control-Allow-Origin` on any of the three artifacts.** A `vite preview` server and a static file read both apply host-level configuration, so this is the expected result off a host — and it is the one check that passes locally in every wrong configuration and fails deployed. **B2.** |
| No credential in the published artifacts this run could read | §4 | **pass** | — |
| Run the network with the published default router, and the BYOK path too | §6 | **not-demonstrated** | *"The manifest declares a default router, but nothing in it says that router works without a visitor-supplied key (no `requires_key: false`, no `publisher_funded: true`, no `mock: true`). §4's level is MAY … this tool will not resolve that silence in either direction."* Disclosed in `LIMITS.md` §2.5a. Never scored `pass`. |
| Call an internal agent and a grounded capability through MCP or a site action | §6 | **not-demonstrated** | no browser; 4 site actions declared |
| After approval, load an exact named network from a second origin and run it locally | §6 | **not-demonstrated** | no browser; 1 allowed peer origin declared |
| With a user key active, the second site never receives it and cannot change the router | §6 | **not-demonstrated** | no browser, no credential |
| Private context is absent at the peer unless a named field is explicitly allowed | §6 | **not-demonstrated** | no browser |
| An invalid network, a cycle, an over-budget request and a denied origin all stop visibly | §6 | **not-demonstrated** | *"it will not read the presence of a broken fixture on a site as evidence that anything refuses it."* We publish three broken networks at `/broken/`; the tool correctly declines to credit us for them. |

**The one failure is the honest answer to what was measured.** The checker read the
absent header off a real response to a GET carrying
`Origin: https://agentic-web-conformance.invalid`, and named all three artifacts. For a
stranger's site that is a true failure; for ours it means only that loopback is not a
host. It is settled by **B2** and by nothing else.

### 1.3 The checker's own coverage, stated because the test count would imply more

1. The five tests that assert on a real CORS response prove **the checker reads a real
   header correctly**. They say nothing whatever about our deployed site.
2. `.github/workflows/ci.yml` has **never run**: the repository has no remote. Every
   "CI runs it" claim in this project is about the file, not about a run that happened.

---

## 2. Spec drift: zero, against a hash rather than an assurance

The entry was built against a pinned copy of the specification,
`docs/mvp-spec-2026-11-23.md`. "We checked for drift" is not a verifiable claim, so the
digest is recorded instead.

```
$ shasum -a 256 docs/mvp-spec-2026-11-23.md
050c86cd2b884127f00a09e94b31a9968bcc44da66d869f0f9730a3aaf383763
```

| | Value |
|---|---|
| Upstream repository | `cognizant-ai-labs/agentic-web` |
| Upstream path | `docs/worldwide_agentic_web_mvp_spec.md` |
| SHA-256, both copies | `050c86cd2b884127f00a09e94b31a9968bcc44da66d869f0f9730a3aaf383763` |
| Checked at upstream commit `d67755e76` | 2026-11-24T00:52Z — **identical** |
| Re-checked at upstream commit `05a665edcf11bac1eb6ab29c085040a7a4838182` | 2026-11-24T08:56:58-08:00 — **identical** |

**The repository has moved; the specification document has not.** `main` advanced from
`d67755e76` to `05a665e` between the two checks and the digest is unchanged, so no
section this entry cites has changed under it.

Reproduce:

```
git clone --depth 1 https://github.com/cognizant-ai-labs/agentic-web /tmp/aw
diff /tmp/aw/docs/worldwide_agentic_web_mvp_spec.md docs/mvp-spec-2026-11-23.md && echo "zero drift"
```

**Re-run this on the submission date.** The claim is dated and the check is one
command.

---

## 3. The vendored reference: every digest still matches

`docs/vendor/PROVENANCE.md` pins upstream at
`486ecf26aa8775963f9b765f894734bef1ac9817` (`cognizant-ai-lab/nsdeploy`). A SHA pin
cannot drift, which is the point of using one — but the recorded digests can be wrong,
so they were re-checked rather than assumed.

### 3.1 The six adapted sources — all six match, at the pin and at today's `main`

Re-fetched at the pinned SHA and hashed. Every digest equals the one recorded in
`PROVENANCE.md` and `docs/vendor/upstream-pins.json`:

| Upstream file | SHA-256 | At pin | At `main` `71b5037` |
|---|---|---|---|
| `nsdeploy/runtime/generated/graph.gen.mjs` | `d3344326…b624af` | match | match |
| `nsdeploy/runtime/generated/validation.gen.mjs` | `fc56d298…a59b3a` | match | match |
| `nsdeploy/runtime/generated/sly_data.gen.mjs` | `653d3d69…c3e70c04` | match | match |
| `nsdeploy/runtime/engine.js` | `69331a83…723bb3` | match | match |
| `nsdeploy/runtime/actions.js` | `899a1eb4…c013fca` | match | match |
| `nsdeploy/runtime/runner.js` | `ebca618b…2fceac` | match | match |

**Upstream has moved and none of the six changed.** `cognizant-ai-lab/nsdeploy` `main`
is now `71b5037746a5b40e8c096a098e2ecaf8ad1f6adf`, ahead of the pin, and all six
sources are byte-identical at both revisions. **Nothing was re-vendored**; the pin
stands.

Reproduce one:

```
curl -sL https://raw.githubusercontent.com/cognizant-ai-lab/nsdeploy/486ecf26aa8775963f9b765f894734bef1ac9817/nsdeploy/runtime/actions.js | shasum -a 256
```

### 3.2 The four reference documents — all four match upstream today

These carry a fetch date rather than a SHA, so they were compared against upstream
directly. All four are byte-identical to upstream apart from the one-or-two-line
provenance comment our copy prepends, which is the only difference `diff` reports:

| Our file | Upstream | Result |
|---|---|---|
| `neuro-san-agent-hocon-reference.md` | `neuro-san` `docs/agent_hocon_reference.md` @ `a5537db` | identical + 2 header lines |
| `neuro-san-agent_network_schema.hocon` | `neuro-san` `docs/agent_network_schema.hocon` @ `a5537db` | identical + 1 header line |
| `neuro-san-example-hello_world.hocon` | `neuro-san` `neuro_san/registries/hello_world.hocon` @ `a5537db` | identical + 1 header line |
| `nsdeploy-build_manifest-excerpt.md` | `nsdeploy` `nsdeploy/generate.py` lines 440-512 @ `71b5037` | **byte-identical** to those lines |
| `LICENSE-Apache-2.0.txt` | `nsdeploy` `LICENSE.txt` @ `71b5037` | `a6cba85b…bf3ff9`, **identical** |

**One inaccuracy found, and it is in our file, not upstream's.** `PROVENANCE.md` gives
the hello-world example's source path as `registries/hello_world.hocon`; upstream's
path is `neuro_san/registries/hello_world.hocon`. The vendored file's own header
comment has the correct path. Cosmetic, recorded rather than quietly fixed.

**The gap this leaves, stated rather than closed on the deadline:** these four are
pinned by a *date*, not a SHA, so "identical today" is a measurement and not a
guarantee. They should carry digests in `upstream-pins.json` as the six runtime
sources do.

### 3.3 The reference consumer, run against our published manifest

Upstream's real `selectTopRouter` — not our paraphrase of it, which has already cost
this project one defect — run against `public/agent-manifest.json` in five
configurations. None throws:

| Configuration | Result |
|---|---|
| no router override, no key | `https://api.openai.com/v1`, `upgradedToByok: false` |
| real visitor key, no override | `https://api.openai.com/v1`, **`upgradedToByok: true`** |
| key + explicit router override | the override is honoured |
| explicit model, no key | upgrades to the BYOK route |
| key `"demo"` (sentinel) | correctly **not** treated as a real key |

And the published peer policy, through upstream's own `manifestAllowsPeer`: the bakery
origin is permitted, an unlisted third origin is refused.

**One claim withdrawn.** An earlier note in this project said upstream's current
runtime gates publisher funding behind `llm_router.publisher_funded === true` and
reports `publisherFunded: false` against our manifest. That could not be reproduced:
`publisher_funded` / `publisherFunded` appears nowhere in `cognizant-ai-lab/nsdeploy`
at the pin or at `main` `71b5037`, nor in `cognizant-ai-lab/neuro-san` at `main`
`a5537db`. `publisher_funded` **is** a key our *own* conformance CLI looks for, which
is the likeliest source of the mix-up. The substance survives by a checkable route:
our manifest publishes no such key, so it makes no claim that this site funds
inference. See `LIMITS.md` §2.5a.

---

## 4. Widths, contrast and the no-JavaScript path

Measured on the **built** output in a real browser, 24 November 2026, with ratios
**computed in the page** rather than judged from a screenshot. **All of §4 is a
measurement of the built site on loopback, not of the deployed site — B4 and B5.** It
is recorded because it localises a future failure: if the deployed build fails one of
these, the cause is the deployment, not the code.

### 4.1 Widths — pass at all five

No horizontal scroll and no element extending past the viewport at **320, 375, 570,
900 or 1440px**. The single element found outside the viewport is the skip link at
`left: -999px`, which is the correct pattern for one.

This is the measurement that most needed repeating: the responsive bug this project
already shipped had three independent causes, one visible only at 320px and two only
at 375px.

### 4.2 Contrast — every verdict card passes WCAG AAA

Foreground computed against the nearest opaque background, walking up the tree, for all
three verdict states:

| Element | Size | Unsafe | We don't know | No conflict found |
|---|---|---|---|---|
| Icon and headline | 16.8 / 15.2px bold | 8.67 | 7.47 | 8.50 |
| The deciding reason | 14.08px | 13.56 | 14.34 | 13.87 |
| "Checked against" and the caption | 11.84px | **7.36** | 7.78 | 7.53 |

**Lowest ratio anywhere on a verdict card: 7.36**, against a AAA threshold of 7.0 and
an AA threshold of 4.5. A verdict card that cannot be read is a safety failure rather
than a style nit, which is why this was measured rather than eyeballed.

**One judgement call, raised and decided.** The caption carrying *"Not a statement
about the kitchen, and not medical advice"* renders at **11.84px** (0.74rem against a
16px root). It passes AAA on contrast and is repeated on 34 cards, so small is
defensible — but it is below the 12px most guidance treats as a floor, and it is the
one sentence that limits what the verdict means. **The owner's decision, 24 November
2026: leave it as designed.** Recorded so that it is a choice rather than an oversight,
and so anyone who disagrees is disagreeing with a decision.

### 4.3 The runtime, checked on the built site

Four things that had never been seen in a browser after Task 6's second fix round, all
confirmed on the built site:

| | Result |
|---|---|
| The standing note — *"The assistant does not decide whether food is safe for you, and is not permitted to"* — on screen **before anyone types** | **yes** |
| 34 verdict slots genuinely empty with a status line explaining why, before any restriction is ticked | **yes** |
| Slots fill on *Dairy-free* to **15 unsafe / 3 unknown / 16 no conflict** | **yes** |
| Console silent on load and across a replayed turn | **yes — no errors** |
| The demo's central shot — a labelled replayed reply with three withheld claims beside the turkey club's *"Contains dairy, through Brioche bun → Brioche → Butter → Dairy."* — rendering as **one frame** | **yes** |

The 15 / 3 / 16 figure was independently reproduced from the checker itself in this
session — `verdictFor` over all 34 items for `dairy_free` returns exactly
`{unsafe: 15, unknown: 3, safe: 16}` — so what the page showed is what the checker
computes, by two routes.

### 4.4 The no-JavaScript path — correct by construction

Checked against the built `dist/index.html`, **22,911 bytes**, rather than in jsdom:

- All **34 dishes and 34 ingredient blocks** are in the static markup, "Turkey club"
  and "Butter" among them, so the ingredient data a person would check is readable
  with scripts off.
- **None** of the agent panel's text is in the static HTML: not its heading, not the
  standing note, not the restriction controls, not the key panel. With scripting off
  the page promises no assistant rather than showing a dead one.
- The 34 verdict slots are in the static markup and collapse via
  `.verdict-slot:empty { display: none }` — no empty boxes, no unexplained
  placeholders.
- One element is hidden in the static markup: the confirmation dialog's
  `role="status"` container. One script tag. No `<noscript>` block is needed, because
  nothing is missing.

---

## 5. Build and test, exit codes read from `$?` with no pipes

Run 24 November 2026, Node v26.13.1:

| Command | Exit | Result |
|---|---|---|
| `npm test` | **0** | 494 passed, 5 skipped (499) across 12 files |
| `npm run typecheck` | **0** | `tsc --noEmit`, strict |
| `npm run build` | **0** | `dist/` — `index.html` 22,911 bytes |
| `npm run build:peer` | **0** | `peer-dist/` |

The working tree was clean before and after; `dist/` points where it always points.

**The 5 skipped tests are the conformance CLI's CORS tests, and they are skipped
loudly rather than quietly.** This environment refuses to bind a loopback port
(`EPERM: listen 127.0.0.1`) and those five assert on a real HTTP response from a real
server by design. The suite prints a block saying so and saying that **nothing about
CORS has been verified by that run** — because a suite expected to be red is how a real
failure gets ignored. `npm run test:cors` fails rather than skipping. **B6.**

---

## 6. What this file does not claim

- That CORS works. It is configured twice and measured zero times. **B2.**
- That the site is reachable over HTTPS. There is no host. **B1.**
- That the layout and contrast hold on the real site at a real width through a CDN.
  §4 measured the built output on loopback. **B4.**
- That `.github/workflows/ci.yml` has ever run. It has not.
- That §6 check 2 is met. It is met BYOK-only, our own checker scores it
  `not-demonstrated`, and the specification is silent on whether that conforms —
  `LIMITS.md` §2.5a.
