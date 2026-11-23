# Open Agentic Web Challenge — submission brief

Read from <https://cognizant-agenticweb.devpost.com/rules> and the specification
repository on **23 Nov 2026**. Quoted text is verbatim. The spec as it read today
is pinned at [`mvp-spec-2026-11-23.md`](mvp-spec-2026-11-23.md) — the repo warns
it "is actively evolving and its content changes frequently", and the rules bind
us to the version published **as of the start of the Submission Period**.

## 1. Eligibility — CLEARED

> "The Hackathon IS open to: Individuals who are at least the age of majority
> where they reside as of the time of entry"

| Test | Our position | Verdict |
|---|---|---|
| Age of majority | 24, California | PASS |
| Residence not excluded | USA. Excluded: Brazil, Quebec, Russia, Crimea, Cuba, Iran, North Korea + OFAC | PASS |
| Organisational gate | **None.** Free Devpost account only | PASS |
| Employee of Cognizant / Mozilla / NANDA / AWS / UT Austin / AI Commons | No — those are eligible for the Employee Prize **only**, so this matters | PASS |
| Judge conflict | No | PASS |

## 2. Dates

| | |
|---|---|
| Submission closes | **11 Jan 2027, 08:00 PT** |
| Judging | 11–18 Jan 2027 |
| Winners announced | ~19 Jan 2027, 08:00 PT |
| Days from 23 Nov | **49** |

## 3. Prizes — and an honest read on the odds

| Prize | Cash | Also | Qty |
|---|---:|---|---:|
| First | $5,000 | $1,500 Otari credits, swag, social promo | 1 |
| Second | $3,000 | $750 credits | 1 |
| Third | $2,000 | $500 credits | 1 |
| Employee Prize | — | $250 credits | 1 (not us) |

**$10,000 cash, but only three winners.** The shortlist scored this event at
$5.8/entrant, which is right on money but flattering on odds: three prizes across
1,737 entrants is **0.17%**, against Reddit's twelve prizes across 2,422 (0.5%).
This is a place-or-nothing event — there are no honorable mentions to land on.
That argues for one distinctive entry, not a safe one.

> "A submission is eligible to receive up to one (1) prize."

## 4. Judging — two stages

**Stage One is pass/fail**, and it is purely about conformance:

> "The first stage will determine via pass/fail whether the Project is a
> conforming open agentic website as described in Submission Requirements"

**Stage Two**, four equally weighted criteria:

| Criterion | What it asks (verbatim) |
|---|---|
| **Technological Implementation** | "How well is the project built, and how effectively does it use the open agentic web specification?" |
| **Design** | "Does the project deliver a complete, coherent product experience not just a technical proof of concept?" |
| **Potential Impact** | "Does the project make a credible, specific case for solving a real problem for a real audience… Does the project include any tools or services the Entrant built and **shared with the community**?" |
| **Quality of the Idea** | "Is this a creative, non-obvious use of an open agentic website and does the team show genuine understanding of the problem space?" |

Note that **Potential Impact explicitly rewards shipping something reusable** for
other entrants, and the rules repeat it under Submission Requirements: *"Optional
but encouraged: Entrants who build additional tools or services… may describe and
link them in their Submission."* That is a scored line item most people will skip.

## 5. What must be submitted

- **A public URL to the agentic website**, which MUST contain:
  - a publicly accessible conforming `.json` describing an agent network and its capabilities
  - a `runtime` file that can run the agent network in the browser
  - an interface letting users or agents interact with the network
  - optionally, an interface to configure LLMs and keys
  - the network should interact with the website, and/or other agentic websites, and/or be callable by them
- A text description of features and functionality
- **A demo video under two (2) minutes**, public on **YouTube**, showing it running
  in a browser — and *"should include the Entrant explaining the Project"*. That
  line means a voice-over by the entrant, not a silent screen capture.
- One or more screenshots

## 6. The specification, in the form that matters

### Minimum public files (§3.3)

| File | Must contain |
|---|---|
| `agent-manifest.json` | one or more networks with `name`, `front_man`, `hocon`; top-site LLM router metadata; peer policy |
| network definition | resolved, data-only Neuro SAN agent-network document, serialized as JSON. Convention is `<network>.network.json` |
| `links.json` | peer-network link map: symbolic names → concrete peer URLs |
| coded-tool bundle | optional; if executed, runs in an isolated Web Worker under CSP |

Public GET with **CORS enabled**; HTTPS in production, loopback HTTP fine locally.

### Minimum network content (§2.1)

Stable network name, description, front agent. Each agent: unique `name`,
`function.description`, `function.parameters` (JSON Schema), `instructions`, and
`tools` it may call. Model settings are **hints** — the caller's router wins.
Private context is **deny-by-default** across site boundaries and a network MUST
name any field allowed to cross.

### The three tenets

1. **Common multi-agent representation** — agent networks described in JSON, not code.
2. **Browser execution** — the network runs in the browser, no server-side code.
3. **Pluggable inference** — the *user* supplies LLM provider and key, so the site
   host never pays for inference.

### §6 Interoperability checks — the real acceptance test

The spec lists what an implementation must demonstrate. Read it as a checklist:

- [ ] Publish a two-agent network and manifest from an ordinary HTTPS host
- [ ] Load and run it in a browser with the published default router; demonstrate BYOK too
- [ ] Call an internal agent **and** at least one grounded capability via MCP or a registered site action
- [ ] After user approval, load an exact named network **from a second origin** and run it locally
- [ ] Show the second site never receives the user's key and cannot change the caller's router
- [ ] Show private context is absent at the peer unless explicitly allowed
- [ ] **"Stop an invalid network, a composition cycle, an over-budget request, and a denied origin with visible errors"**

**That last line is the opening.** Four of the seven checks are about *refusing*
and about what a peer must not get. Most entries will demo the happy path — ask
the pizza agent a question, watch it answer. An entry that makes the refusals
visible, reproducible and testable is answering the specification's own acceptance
criteria, which is precisely what "how effectively does it use the specification"
asks.

## 7. Resources

| | |
|---|---|
| Spec + starter | <https://github.com/cognizant-ai-labs/agentic-web> (Apache-2.0) |
| Agent-facing skill | `skills/agentify-website/SKILL.md` — walks a coding agent through agentifying any site. Needs **Node 22+** |
| Worked examples | `examples/pizza_restaurant_agentified/`, `guesthouse_agentified/`, `harbor_tours_agentified/`, `marrow_point_pizza_agentified/` — the last three call each other across origins |
| Otari (optional) | free credits for the first 100 registrants; hosted endpoint allows browser calls; start with `alibaba/qwen3.8-flash` |
| Neuro SAN | the HOCON agent-network model the spec is built on |

## 8. Decisions taken on day 0

1. **Pin the spec.** Copied to `docs/mvp-spec-2026-11-23.md` because upstream
   changes frequently and conformance is judged against the version at the start
   of the Submission Period.
2. **Conformance before cleverness.** Stage One is pass/fail; a beautiful
   non-conforming site scores zero. The §6 checklist above is the definition of
   done for the engine.
3. **Ship something reusable.** Potential Impact names it explicitly, and almost
   nobody will do it.
