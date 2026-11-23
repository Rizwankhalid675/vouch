# Vouch — product specification

**An open agentic website where no language model is allowed to vouch for
anything. A deterministic checker owns every safety claim, and every answer
carries the evidence it was checked against.**

Written 23 Nov 2026. Conformance target: [`mvp-spec-2026-11-23.md`](mvp-spec-2026-11-23.md).
Event constraints: [`EVENT.md`](EVENT.md).

---

## 1. The problem, and why it is a real one

The specification's own flagship example is a pizza restaurant whose agent
answers:

> "I'm lactose intolerant, what can I eat?"

That is a question with a **medical consequence and a confident-sounding wrong
answer**. An LLM reading a menu will cheerfully say a dish is dairy-free because
the description does not mention cheese. The ingredient list says otherwise. The
upstream example mitigates this by grounding instructions in menu data and
telling the model not to invent — but instructions are not a guarantee, and the
spec says so plainly:

> "Instructions alone do not supply live data or execute website operations."

Someone with a severe allergy cannot audit the model's reasoning, and the site
operator carries the liability. This is not a hypothetical weakness: it is the
single most dangerous question the canonical example invites.

**Audience:** people ordering food with an allergy or intolerance, and the
operators who would otherwise be trusting a model with that answer.

## 2. The rule everything follows from

> **A language model may describe, rank, summarise and converse. It may never
> assert that something is safe. Only the checker may do that, and only from
> published ingredient data.**

Concretely: the model proposes a candidate set; a pure function
`verdictFor(item, restrictions)` returns `safe | unsafe | unknown` with the
exact ingredient that decided it; the interface renders the verdict, never the
model's opinion of it. A model answer that contains a safety claim the checker
did not produce is **suppressed and shown as a refusal**, not quietly dropped.

`unknown` is a first-class answer. "We don't have ingredient data for this" is
the honest output for incomplete data, and it is the one an LLM will never give
you on its own.

## 3. Why this is the right shape for *this* hackathon

Stage Two asks "how effectively does it use the open agentic web specification".
The spec's §6 interoperability checks are, four times out of seven, about
**refusing**:

| §6 check | How Vouch demonstrates it |
|---|---|
| Stop an **invalid network** with visible errors | A deliberately malformed network is published alongside the good one; loading it shows a structured validation failure, not a blank page |
| Stop a **composition cycle** | Two networks that reference each other; the runtime halts with the cycle path displayed |
| Stop an **over-budget request** | A per-conversation call budget; exceeding it stops with the budget shown |
| Stop a **denied origin** | A peer origin absent from `allowed_peers`; the attempt is refused and named |
| Peer never receives the user's key | Shown live: the key panel, the peer call, and a transcript of exactly what crossed |
| Private context absent at the peer unless named | A `private` block with one allowed field; the peer sees that field and nothing else |
| Internal agent + one grounded capability | The checker is the grounded capability, registered as a site action |

Most entries will demo the happy path, because a successful answer films better
than a refusal. Every one of those refusals is a scored line in the
specification's own acceptance test.

## 4. What gets built

### 4.1 The site

A deli — **Vouch & Co.** — with a real menu whose items carry structured
ingredients, each tagged with allergens and derivations (e.g. `butter → dairy`,
`semolina → gluten`). Ordinary HTML/CSS/JS, no framework, no backend. Browsable
and orderable without ever speaking to an agent, because the spec requires the
site to work as a site.

### 4.2 The agent network (`vouch.network.json`)

Data-only, resolved, conforming to the Neuro SAN model. Four agents:

| Agent | Role | May assert safety? |
|---|---|---|
| `front_of_house` | entry point (`front_man`); routes and summarises | **No** |
| `menu_guide` | describes dishes, ingredients, prices | **No** |
| `restriction_reader` | turns "I'm lactose intolerant and avoid pork" into a structured restriction set | **No** |
| `order_builder` | proposes cart operations | **No** |

No agent's `tools` list includes a way to emit a verdict. The verdict arrives
only from the site action below.

### 4.3 The checker — a registered site action, and the only authority

```ts
type Verdict = "safe" | "unsafe" | "unknown";

interface Finding {
  item: string;
  verdict: Verdict;
  /** The exact ingredient and rule that decided it. Present unless safe. */
  because?: { ingredient: string; allergen: string; via: string[] };
}

function verdictFor(item: MenuItem, restrictions: Restriction[]): Finding;
```

Pure: no clock, no network, no model. Exhaustively tested against the whole menu
× the whole restriction set, the same way Hearsay's solver is — if the menu has
24 items and 9 restrictions, all 216 combinations are checked, not sampled.

### 4.4 The gate

Every model response passes `gate(response, findings)` before rendering.
It detects safety assertions in prose and requires each to be backed by a
`Finding`. Unbacked claims are replaced by a visible refusal naming what was
claimed and why it could not be shown. **The gate is the only path to the
screen**, exactly as `gateSuggestions()` is in Fearless.

### 4.5 The peer

A second origin, **Marrow Point Bakery**, publishing its own conforming network
and ingredient data. Vouch calls it for items it does not make. The same rule
applies across the boundary: a peer's *prose* about safety is never trusted —
only its published, fetchable ingredient data is, and if that is absent the
answer is `unknown`. This is the cross-origin half of §6, and it makes the point
that trust does not transit a hyperlink.

### 4.6 The community tool — `agentic-web-conformance`

A standalone, MIT-licensed CLI that takes the URL of any agentic website and
runs the §6 checks against it, printing pass / fail / not-demonstrated per check.
Published as its own repo, usable by every other entrant.

Potential Impact names this explicitly — *"any tools or services the Entrant
built and shared with the community"* — and the README's own Testing section
currently reads **"TODO Run the validation script to check your submission is
compliant."** The validator does not exist yet. Building it is both a scored line
item and a genuine contribution.

## 5. Explicit non-goals

- **Not medical advice.** The site states plainly that it reports published
  ingredient data and cannot know about cross-contamination in a kitchen.
  `unknown` is returned wherever data is absent, and the limits are published.
- **No payment, no real orders.** A demo checkout, as upstream's examples do.
- **No server.** The spec requires browser execution; a backend would break
  conformance.
- **We do not pay for inference.** BYOK per Tenet Three; the user's key, the
  user's router.

## 6. Definition of done

1. All seven §6 checks demonstrable in the browser, each with a visible outcome.
2. `verdictFor` exhaustively tested across the full menu × restriction matrix.
3. The gate has tests proving an unbacked safety claim cannot reach the screen.
4. The site is usable with no agent at all.
5. Deployed to two real origins over HTTPS with CORS, for the peer check.
6. `agentic-web-conformance` published, and run against our own site in CI.
7. A demo video **under two minutes** with the entrant speaking.
8. `docs/LIMITS.md` filled before the README claims anything.

## 7. The risk I am watching

The upstream repo "is actively evolving". Conformance is judged against the spec
as published at the start of the Submission Period — which is what
`mvp-spec-2026-11-23.md` pins. If upstream changes materially, the conformance
suite must be re-run against the pinned copy **and** the current one, and any
divergence recorded rather than silently followed.
