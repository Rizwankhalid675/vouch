# agentic-web-conformance

A command-line conformance checker for the [Open Agentic Web MVP
profile](https://github.com/cognizant-ai-labs/agentic-web/blob/main/docs/worldwide_agentic_web_mvp_spec.md)
— the minimum interoperable behaviour a site needs to publish a portable multi-agent network that
any browser runtime can load and run.

Two organisation names differ by one letter, so this document names each. The profile this tool
checks against is in **`cognizant-ai-labs/agentic-web`** (plural), at
`docs/worldwide_agentic_web_mvp_spec.md`. **`cognizant-ai-lab/nsdeploy`** (singular) is a *reference
runtime*, not the specification; this tool does not check against it and does not depend on it.

Point it at one of your published networks. It reads the artifacts a peer's browser runtime would
read, checks what can be checked from a shell, and **tells you plainly which checks it did not
make.**

```
$ node cli.ts https://example.com/agents/local_services
```

That last part is the point of the tool. Several of the specification's interoperability checks need
a browser and a live model — running the network, loading a peer after consent, proving a visitor's
key never leaves the caller's origin. A command line cannot verify any of them, so this tool reports
them as **NOT CHECKED**, one line each, with whose limitation is in the way. A conformance tool that
implies coverage it does not have is worse than no tool, so:

> **"I did not look", "I looked and it is wrong" and "this cannot be checked from here" are three
> different statements.** The output keeps them apart. Nothing in the NOT CHECKED section has been
> verified by the run that printed it.

---

## Running it

Node 22.18 or later. No build step, no dependencies, nothing to compile.

```bash
# copy this directory anywhere and run it -- that is the whole install
node cli.ts https://example.com/agents/my_network

# machine-readable, for CI
node cli.ts https://example.com/agents/my_network --json
```

**It is not on npm yet.** The package is ready to publish (`npm publish --access public`
from this directory), but whether to take the name is the owner's call and has not been made. Until
it is, `npx agentic-web-conformance` will not resolve — copy the directory, or run it from a
checkout. Nothing about the tool changes either way; it has no dependencies and no build step
precisely so that copying it is enough.

The tool ships TypeScript and is executed directly: Node strips the types on load, which is on by
default from 22.18. That is why there is no `dist/` and no install step.

### The URL is a network, not a site root

`https://example.com/agents/my_network` means: the site base is `https://example.com/agents/` and
the network name is `my_network`. That is the specification's own addressing (§3.2):

> "A peer network is identified by an HTTP or HTTPS URL whose final path component is its published
> network name. In this version, the runtime treats the preceding path as the site base and
> retrieves `agent-manifest.json` from that base."

So the tool fetches `https://example.com/agents/agent-manifest.json`, finds the entry whose `name`
is **exactly** `my_network`, and fetches the network definition from that entry's `hocon` value
resolved against the base.

It never guesses a filename and never lists a directory. §3.3 is explicit that
`<network>.network.json` "is a convention, not an interoperability requirement; runtimes use the
location declared in the site manifest" — so a checker that went looking for `my_network.network.json`
would report a conforming site as broken. And if your site publishes extra networks that discovery
is not meant to find (deliberately broken examples, say), a checker that globbed would find them and
blame you for them.

If no entry matches exactly, the tool fails rather than checking a different network. §3.2: "If no
exact match exists, it MUST fail rather than select another published network." Case is significant.

### Options

| Option | |
|---|---|
| `--json` | Machine-readable output. |
| `--timeout <ms>` | Per-request timeout. Default 10000. |
| `--origin <url>` | The `Origin` header sent with each request, used to read the CORS header off a real cross-origin response. Must not be your own origin. Default `https://agentic-web-conformance.invalid`. |
| `-h`, `--help` | Usage. |
| `-v`, `--version` | Version. |

### Exit codes

| Code | Meaning |
|---|---|
| **0** | Every check the tool was able to make passed. **Not the same as conformance** — see the NOT CHECKED section of the output for what was not verified. |
| **1** | At least one check failed. A finding about your site. |
| **2** | Bad usage, or a URL the tool cannot read as a network URL. |
| **3** | The tool itself hit an error and reached no verdict. Not a verdict about your site. |
| **4** | **The run was incomplete**: at least one artifact never answered — DNS, a refused connection, a proxy, a timeout, a typo in the hostname. The checks that *were* made still stand, and the output says which they are; the ones that could not be made have been verified by nothing. Non-zero, because an incomplete run is not a clean bill of health; distinct from 1, because your site cannot be at fault for a request that never arrived. |

### What it will always tell you

**Every run reports the same 20 checks**, whatever answered. If an artifact never answers, the
checks that needed it are reported as not made, with the reason and the URL — they are never
dropped. A check that is not listed cannot be read as a pass, a failure or a declined item, so the
set is fixed by the types rather than by the code path a particular run happens to take, and a test
asserts it across seven states.

A `not-demonstrated` result never affects the exit code on its own — with one exception, exit 4,
which exists precisely so that "some of this run did not happen" cannot be mistaken for either
answer. The tool is safe to put in CI and will not go red because it cannot drive a browser.

**Triaging in CI: 1 means read the findings. 4 means check the network, and treat the run as
partial — not as a verdict either way.** Exit 4 fires on a *single* unanswered artifact, so it is
perfectly possible to get `0 failed, 12 passed … exit 4`: twelve real passes and two checks that
were never made. The closing banner names the artifacts that got no answer and counts the checks
they cost, so you can see which half you are looking at.

Why this gets a paragraph: an earlier version of this tool reported a refused connection as
`FAIL … not readable` with eleven lines blaming the site, and sent a reader looking for a fault in
hosting that was working perfectly. Telling "I could not look" apart from "I looked and it is
wrong" is what the tool is for, and the exit code is where a machine reads that distinction.

### What it never does

- It sends no credentials. §3.4: "Public artifact requests MUST NOT include the caller's private
  credentials." It accepts no key, token or cookie to send, so it cannot.
- It never writes to your site, and makes only `GET` requests.
- It never reprints a credential it finds. If it spots one in a published file it tells you the
  field and the length, so the report is safe to paste into an issue.

---

## What it checks

14 checks, each labelled with the section of the profile it comes from.

| Section | Check | What it means |
|---|---|---|
| §3.3 | Site manifest published and readable by a public GET | `agent-manifest.json` answers a GET from the derived site base and lists at least one network. |
| §3.2 | The requested network name matches a manifest entry exactly | No fallback to another published network. |
| §3.3 | Resolved network definition published and readable | The `hocon` location the manifest declares answers a GET with a JSON document carrying a `tools` array. May be an absolute URL on another origin. |
| §3.3 | Peer-network link map published (`links.json`) | See *Judgement calls* below. |
| §2.1 | Network identity | "A stable network name, a short description, and the name of its front agent." |
| §2.1 | Agent definitions | Each agent has a unique name in the documented character set, a description (`function.description` **or** a top-level `description`), and `instructions` unless it is a coded tool or a toolbox agent. |
| §6 | A two-agent network is published | §6's first interoperability check asks for two agents. |
| §2.1 | Invocation schemas | Every declared `function.parameters` uses the honoured `type: object` + `properties` form. Declaring none is not a failure. |
| §2.1 | Private-context fields are named, not allowed in bulk | "A network MUST explicitly name fields that may pass downstream or upstream." A blanket `sly_data: true` or a `*` wildcard fails; a named list passes; declaring nothing passes, because deny-by-default is conformant. |
| §2.2 | Published definition is portable data | No HOCON include, no `${...}` substitution, no environment reference, no publisher-only file path — **anywhere in any string**, not only at its start. |
| §3.1 | Every reference resolves | Every front-agent declaration names a real agent and agrees with the others; every tool reference resolves to an in-network agent, a `links.json` binding for *this* network, a URL, an MCP descriptor, or a `/name` network the manifest publishes. |
| §3.3 | Served over HTTPS | "Production deployments MUST use HTTPS; loopback HTTP is acceptable for local development." |
| §3.4 | CORS header present on the **real response** | Read off an actual cross-origin GET, never inferred from a config file. See below. |
| §4 | No credential published in the artifacts | "MUST NOT place it in URLs, manifests, agent network specification, prompts, action arguments, traces, analytics, or peer-site requests." |

### The CORS check deserves its own paragraph

It is the check most likely to pass locally and fail deployed, and the reason is that **a config
file is not a header**. A `_headers` file is a silent no-op on a host that reads `vercel.json`, and
the reverse is equally silent: nothing warns you, the file is right there in your repository, and
the header never arrives.

So this tool reads the header off the response. It sends a real `Origin` on every request, because a
host may only emit `Access-Control-Allow-Origin` when one is present — and it checks the value, not
just the presence, because a header naming one specific caller is not a pass for anybody else.

If you run it against `localhost` the CORS result says so in as many words: it is evidence about the
server on your machine and nothing else. Run it again against the deployed origin.

### Freshness: it asks, and a request header cannot insist

Every GET carries `Cache-Control: no-cache` and `Pragma: no-cache`, because a CDN serving a previous
build would make every result above a statement about the wrong artifact — which is the classic way
to "verify" something that is not deployed.

**That is a request, not a guarantee, and the distinction matters for the CORS check in particular.**
An edge cache configured to ignore client cache directives will serve a stale object anyway, and
nothing a client sends can force otherwise. If a result surprises you right after a deploy, confirm
it by hand before believing either answer:

```
curl -sSI -H "Origin: https://agentic-web-conformance.invalid" \
  "https://example.com/agent-manifest.json?cb=$(date +%s)" | grep -i "^access-control-allow-origin"
```

**This tool will not do that for you, deliberately.** Appending `?cb=…` changes the URL under test,
and §3.2 derives the network name from the final path component — so a cache-buster in the tool
would mean reporting on an address no visitor uses. Changing the thing you are measuring is worse
than measuring it once more by hand.

---

## What it does **not** check

Six of the profile's §6 interoperability checks. Each appears in the output as NOT CHECKED with the
reason, and each says whether the tool or the site is why.

| Section | Not checked | Why |
|---|---|---|
| §6 | Run the network with the published default router, and the BYOK path | Needs a browser, a running agent loop and a model credential. |
| §6 | Call an internal agent and a grounded capability via MCP or a site action | The tool can read what is *declared*; a declaration is not a call. |
| §6 | After approval, load an exact named network from a second origin and run it locally | Consent is a browser interaction; local execution is a browser runtime. |
| §6 | With a user key active, the second site never receives it | A claim about requests a live page makes. The published-file half — no credential in the artifacts — is checked, and is a much weaker statement. |
| §6 | Private context absent at the peer unless a named field is allowed | What the network *declares* is checked. Whether the runtime honours it is a property of a live invocation. |
| §6 | An invalid network, a cycle, an over-budget request and a denied origin all stop visibly | Needs a runtime to refuse something and a page to show it. The tool will not read the presence of a broken example on your site as evidence that anything refuses it. |

Two of these are worth saying twice:

- **The default-router check can be blocked by your site as well as by this tool.** §4's requirement
  level is **MAY**: "A site MAY publish a default router and model that work without a
  visitor-supplied key." If your manifest declares a router but says nothing about working without a
  key, the check is neither a pass nor a failure, and this tool will not resolve that silence in
  either direction. It says so, and names which half is which.
- **A declaration is not a behaviour.** The tool checks that your network *declares* private-context
  rules and *declares* its capabilities. Whether your runtime obeys those declarations is a different
  claim, and this tool makes no part of it.

---

## Judgement calls, stated rather than hidden

Where the specification leaves room, this tool chose — and says so here, so a publisher who reads
the output differently can see exactly what was decided and why.

1. **A missing `links.json` is reported as a failure, always.** §3.3 lists it among the *minimum
   public files*. When your network has symbolic external references, the link map is what binds
   them and its absence is unarguable. When it has none, the file has nothing to bind — and this
   tool still reports the absence rather than waiving it, because §3.3 does not waive it. The detail
   line tells you which of the two cases you are in, so you can judge.
2. **A per-agent `tools` list is optional.** The vendored agent-network schema requires only `name`,
   and the HOCON reference calls `tools` "an optional list". A checker that required one would fail
   every network whose leaf agents are leaves.
3. **A missing `function.parameters` is not a failure.** The reference synthesises a required
   `inquiry` string for a sub-agent that declares none, so a caller's request still gets through. A
   check stricter than the runtime is noise, not strictness.
4. **CORS is checked unconditionally, with the exemption stated.** §3.4 is clear that "Conformance
   does not require a cross-origin deployment", so a site whose artifacts are only ever loaded from
   its own origin does not need the header. The tool still fails the check, and the failure says so
   in its own text — because the failure costs you nothing if the exemption applies, and silence
   would cost you a lot if it does not.
5. **The vendored upstream reference is the authority for key names**, above anything paraphrased
   from the specification's prose. Where a check quotes it, the quote is in the source.

---

## Using it in CI

```yaml
- run: node tools/conformance/cli.ts https://example.com/agents/my_network
# ...or, once this is on npm: npx agentic-web-conformance https://example.com/agents/my_network
```

It exits non-zero on a failure and zero otherwise, so that one line is enough. Add `--json` and keep
the output if you want to track which checks were made over time — the `summary` block gives
`checksMade`, `passed`, `failed` and `notChecked` separately, and never folds the last into a total.

Run it against the **deployed** origin, not a local preview. HTTPS and CORS are the two checks a
local run cannot tell you anything about, and they are the two that break on deployment.

---

## As a library

```ts
import { runChecks, exitCodeFor, renderText, deriveTarget } from "agentic-web-conformance";

const target = deriveTarget("https://example.com/agents/my_network");
const results = await runChecks(target.networkUrl);
// results is a discriminated union on `kind`:
//   { kind: "made",      status: "pass" | "fail",      check, title, section, detail, findings }
//   { kind: "declined",  status: "not-demonstrated",   check, title, section, detail, findings, blockedBy }
//   { kind: "unreached", status: "not-demonstrated",   check, title, section, detail,
//                        blockedBy: "checker", unreachedUrl, transport }   // no findings field
process.exit(exitCodeFor(results));
```

An `unreached` result has **no `findings` field at all**, and that is deliberate rather than an
oversight: it is a check the tool did not make because a request got no answer, so there is no
evidence about the site to put there, and the type makes putting any there a compile error. Use the
`findingsOf`, `blockerOf` and `isUnreached` helpers if you would rather not narrow by hand. In
`--json`, `summary.neverReached` counts the blocked checks and `summary.artifactsNeverAnswered`
counts the distinct artifacts that got no answer — two different numbers with two different units.

`runChecks` takes an optional second argument: `{ fetchImpl, timeoutMs, probeOrigin }`. `fetchImpl`
is there so the checks are testable; the CORS check is tested against a real loopback HTTP server
rather than an injected one, because a fabricated response would test the author's idea of CORS
instead of CORS.

---

## How well tested this is, exactly

109 tests — 75 on the checks, 15 on the command line's exit codes, 10 on CORS, and 9 on the structural invariants: that an unreached check cannot carry a statement about the site, and that the set of checks a run reports is the same in every state, whatever answered. Each one was watched
failing against a named one-line mutation of the implementation before it was kept, because a test
nobody watched fail is not evidence. They run under the repository's root test runner, so
`npm test` covers them and a change to this tool cannot be green in isolation.

**One gap, and it is in the five tests that matter most.** The CORS tests bind a loopback port and
read the header off a real HTTP response — the only place in this tool where a header comes from
something other than an object the tests built themselves. Some environments refuse `listen()`
outright, and there `npm test` **skips** them, loudly: the reason and the command to run them for
real go to stderr, and Vitest counts them as skipped rather than passed, so the output can never be
read as coverage obtained.

```bash
npm run test:cors     # demands a real server; fails rather than skipping
```

**Updated 25 November 2026: CI has now run, and it demands them.** This paragraph previously said
the workflow had never executed, because the repository had no remote. It has one now, and
`.github/workflows/ci.yml` has run twice on `main` — both green — with a step that sets
`CONFORMANCE_CORS_REQUIRED=1` so the five cannot skip. GitHub run `45519525620` shows
`cors.test.ts (10 tests)` passing under that flag, plus a smoke test that starts a real loopback
server and checks the CLI reports against it rather than crashing.

So those five are now verified by a run that happened, on a machine that allows `listen()`, every
time `main` moves — not by a file that describes one. Everything else in the suite runs
everywhere.

A test count is the kind of number that goes stale quietly, so: `npx vitest run tools/conformance`
prints the current one.

---

## Licence

Apache-2.0. See `NOTICE` in this directory and `LICENSE` at the root of the repository.

Bug reports and checks you think are wrong are both welcome — especially the second kind. A
conformance tool bent to flatter its author is worthless, and the one thing worse than failing a
check is publishing a checker that cannot fail.
