# Provenance of third-party material

This project's submission claims only the work in `src/`, `tests/`, `data/` and `public/`.
Anything here came from somewhere else, and this file says where, when, and under what
terms. It exists so that no reviewer has to guess which parts are ours.

## Cognizant AI Lab — Neuro SAN and nsDeploy

**Licence: Apache License 2.0** (`LICENSE-Apache-2.0.txt`, fetched 2026-11-23 from
`https://raw.githubusercontent.com/cognizant-ai-lab/nsdeploy/main/LICENSE.txt`; the
`neuro-san` repository carries a byte-identical Apache 2.0 licence).

Our event spec names both, in two different sections, and the line numbers are given
separately because this file cited one range for both: the **Neuro SAN Agent Network
HOCON File Reference** is the normative working schema for an agent network, at
`docs/mvp-spec-2026-11-23.md` **lines 96-102** (§2, Tenet One), and **nsDeploy** is named
as *one* reference browser runtime, first at **line 187** (§3, Tenet Two). Lines 96-102
name the HOCON reference only. Both are linked rather than included, so the schema had to
be either inferred or fetched. We fetched it.

### Reference material vendored here (documentation and schema only, unmodified)

| File | Source | Fetched |
|---|---|---|
| `neuro-san-agent-hocon-reference.md` | `cognizant-ai-lab/neuro-san` `docs/agent_hocon_reference.md` | 2026-11-23 |
| `neuro-san-agent_network_schema.hocon` | `cognizant-ai-lab/neuro-san` `docs/agent_network_schema.hocon` | 2026-11-23 |
| `neuro-san-example-hello_world.hocon` | `cognizant-ai-lab/neuro-san` `neuro_san/registries/hello_world.hocon` | 2026-11-23 |
| `nsdeploy-build_manifest-excerpt.md` | excerpt of `cognizant-ai-lab/nsdeploy` `nsdeploy/generate.py` | 2026-11-23 |

These are the authority for upstream key names. They settled three questions our spec could
not, and caught one real defect: our `llm_router` nested `base_url` one level deeper than
the runtime reads it, so a visitor supplying their own API key received
"this site publishes no AI provider route" rather than a usable router.

### Runtime code

Upstream runtime JavaScript (`nsdeploy/runtime/*.js`) was first **read and executed during
verification** — against a scratch copy outside this repository — to check our published
artifacts with the real consumer rather than with our own assumptions about it. Specifically
`selectTopRouter`, `validateNetwork`, `find_front_man` and `manifestAllowsPeer` were run
against `public/agent-manifest.json` and `public/vouch.network.json`.

In Task 6 some of it was **adapted into this repository**.

**Pinned upstream revision: `486ecf26aa8775963f9b765f894734bef1ac9817`**
(`cognizant-ai-lab/nsdeploy`, `main` as of 2026-11-23, committed 2026-11-19).

Every line range quoted below resolves against that commit and nothing else, so the
claims in this file are checkable rather than assertable. Each adapted file's own
notice carries the same SHA in a permalink. The six upstream sources were re-fetched at that exact SHA and verified
byte-identical to what was adapted. **The SHA-256 of each is recorded below**, so
"verified byte-identical" is a one-command check rather than a claim you have to
take on trust:

```
sha256  (upstream file at commit 486ecf2)
d3344326b105069bfd7cd2de2bfa42a5e8963f88859a0fc33e678c5113b624af  nsdeploy/runtime/generated/graph.gen.mjs
fc56d29878e18fa94f988311fe60f5f2e7823a45498f43139f87619015a59b3a  nsdeploy/runtime/generated/validation.gen.mjs
653d3d6988109151f3200636ac4f143d66d4e363d4f1ab03af00216ee3c70c04  nsdeploy/runtime/generated/sly_data.gen.mjs
69331a83b9a5bbf3de62fea53d9ff1219a3eb2ff3ce005062b7716f5f0723bb3  nsdeploy/runtime/engine.js
899a1eb474f09ac2521b550eea936ff621ccf42fdd2b74e0729676eeec013fca  nsdeploy/runtime/actions.js
ebca618b329e9d43e6b88ce43dc863e55efb0064a247812e72dcd12d9b2fceac  nsdeploy/runtime/runner.js
```

To check one yourself:

```
curl -sL https://raw.githubusercontent.com/cognizant-ai-lab/nsdeploy/486ecf26aa8775963f9b765f894734bef1ac9817/nsdeploy/runtime/actions.js | shasum -a 256
```

**Re-verified 24 November 2026, and upstream has moved.** All six digests above were
re-fetched at the pinned SHA and match. Both upstream repositories have since advanced
past the revisions these files were fetched at — and **all six adapted sources are
byte-identical at `nsdeploy`'s current head as well**, so nothing adapted here has
changed upstream. The three `neuro-san` reference documents are byte-identical to that
repository's current head apart from the provenance comment our copy prepends; the
`build_manifest` excerpt still matches `nsdeploy/generate.py` lines 440-512 exactly,
and `LICENSE-Apache-2.0.txt` still matches `nsdeploy` `LICENSE.txt`.
**Nothing was re-vendored**; the pin stands, which is the point of pinning.

The two current head revisions are deliberately **not** quoted here, and a test
enforces that: this file must name exactly one 40-hex SHA, the pin, so that nothing in
it can be misread as a second thing we adapted from. The dated measurement, with both
head revisions and the commands, is in [`docs/RESULTS.md`](../RESULTS.md) §3.

One gap this leaves, stated rather than closed on a deadline: the four reference
documents are pinned by a **fetch date, not a SHA**, so "identical today" is a
measurement and not a guarantee. They should carry digests in `upstream-pins.json` as
the six runtime sources do.


| Upstream file | Permalink |
|---|---|
| `nsdeploy/runtime/generated/graph.gen.mjs` | <https://github.com/cognizant-ai-lab/nsdeploy/blob/486ecf26aa8775963f9b765f894734bef1ac9817/nsdeploy/runtime/generated/graph.gen.mjs> |
| `nsdeploy/runtime/generated/validation.gen.mjs` | <https://github.com/cognizant-ai-lab/nsdeploy/blob/486ecf26aa8775963f9b765f894734bef1ac9817/nsdeploy/runtime/generated/validation.gen.mjs> |
| `nsdeploy/runtime/generated/sly_data.gen.mjs` | <https://github.com/cognizant-ai-lab/nsdeploy/blob/486ecf26aa8775963f9b765f894734bef1ac9817/nsdeploy/runtime/generated/sly_data.gen.mjs> |
| `nsdeploy/runtime/engine.js` (lines 22-93) | <https://github.com/cognizant-ai-lab/nsdeploy/blob/486ecf26aa8775963f9b765f894734bef1ac9817/nsdeploy/runtime/engine.js#L22-L93> |
| `nsdeploy/runtime/actions.js` | <https://github.com/cognizant-ai-lab/nsdeploy/blob/486ecf26aa8775963f9b765f894734bef1ac9817/nsdeploy/runtime/actions.js> |
| `nsdeploy/runtime/runner.js` (lines 119-131) | <https://github.com/cognizant-ai-lab/nsdeploy/blob/486ecf26aa8775963f9b765f894734bef1ac9817/nsdeploy/runtime/runner.js#L119-L131> |

Apache 2.0 §4 applies, and these are its conditions as we have met them:

- §4(a) a copy of the licence is in this directory (`LICENSE-Apache-2.0.txt`) and stays there;
- §4(b) **every adapted file carries a prominent notice at the top** naming its source URL,
  the licence, and an itemised list of what we changed;
- §4(c) upstream's files carry no NOTICE attributions in the fetched sources, so there is
  none to reproduce;
- §4(d) nothing upstream was relicensed; our additions are stated as ours in the same notices.

**Everything adapted lives in one directory, `src/runtime/upstream/`, and nothing else in
`src/` is adapted from anyone.** That is the dividing line, and it is a directory boundary so
that a reviewer does not have to take anyone's word for it.

| Our file | Taken from | What we took | What we changed |
|---|---|---|---|
| `src/runtime/upstream/graph.ts` | `nsdeploy/runtime/generated/graph.gen.mjs` | all six functions: `find_front_man`, `agent_names`, `classify_tool`, `is_external_agent`, `is_mcp_ref`, `_spec_for` | JS → TS; upstream's Python-emulating `_get`/`_contains` helpers replaced with direct access; `_spec_for` exported as `spec_for`. No behaviour change. |
| `src/runtime/upstream/validation.ts` | `nsdeploy/runtime/generated/validation.gen.mjs` | `validate_shape`, `validate_missing_nodes`, `validate_front_man`, `validate_network` | JS → TS; error strings kept byte-for-byte so a conformance run reports the same text as the reference; **added `validate_duplicate_names` (ours)**, which upstream's generated module lacks although §3.1 requires rejecting duplicate agent references. |
| `src/runtime/upstream/sly-data.ts` | `nsdeploy/runtime/generated/sly_data.gen.mjs` | `redact_sly_data`, `filter_sly_data` | JS → TS; `undefined` accepted alongside `null`; added `allowed_downstream_sly` / `allowed_upstream_sly`, which mirror helpers in upstream's hand-written `kernel.js` (same repo, same licence). |
| `src/runtime/upstream/router.ts` | `nsdeploy/runtime/engine.js`, lines 22-93 only | `normOrigin`, `sameRouter`, `selectTopRouter`, `manifestAllowsPeer`, `selectPeerRouter` | JS → TS. Logic and the thrown message unchanged. Nothing else from `engine.js`: not the `Engine` class, not `isPublishedMockRouter`. |
| `src/runtime/upstream/action-registry.ts` | `nsdeploy/runtime/actions.js` | `plain`, `cloneData`, the bounded JSON-Schema keyword allow-list, `checkSchema`, `validateData`, and `ActionRegistry`'s `register` / `catalog` / `execute`, including the receipt semantics and the never-retry rule | JS → TS. **Dropped** `actionBindings`, `proposalRefs`, `actionContext`, `validatePresentation`, `prepare` (all CRUSE, which we do not publish). **Added** `dispatch`, `entryFor`, `confirmRequired`, a `commits` field. **Changed** when the user is asked (upstream confirms every plan; we confirm when `effect !== "read"` and fail closed if a committing action has no way to ask) and the receipt status for a failed *read* (upstream records `unknown` for every error; a read commits nothing, so ours records `failed` and keeps `unknown` for writes). |
| `src/runtime/upstream/tool-schema.ts` | `nsdeploy/runtime/runner.js`, lines 119-131 only | `schemaFor` | JS → TS. Behaviour unchanged. Nothing else from `runner.js`: the agent loop in `src/runtime/loop.ts` is ours. |

A later fix round added one more change to `action-registry.ts`, recorded here as
well: **`NoEffectError`**, ours, which lets a handler say it failed *before* changing
anything. Upstream records `unknown` for every error from a non-read action; we keep
`unknown` for writes that may have taken effect and report `failed` for those that
provably did not, so that `unknown` means one thing.

**Ours, written here, not adapted from anything:** `src/runtime/boot.ts`, `actions.ts`,
`loop.ts`, `llm.ts`, `transcript.ts`, `verdict-cards.ts`, `key-store.ts`, `types.ts`,
`errors.ts`,
`src/site/agent.ts`, `data/scripted-replies.json`, and all of `src/safety/`, `src/gate/`,
`src/site/`, `tests/`, `data/` and `public/`.

Two files deserve a word because a reader might assume otherwise:

- `src/runtime/llm.ts` is **not** adapted from `nsdeploy/runtime/llm.js`. Upstream's client
  streams SSE and carries a provider-error taxonomy and model policy; ours is a single
  non-streaming POST. We did read upstream's and deliberately match two *behaviours*, both
  attributed in that file's comments: recording `keySource` in the trace rather than the key
  itself, and stopping a keyless call on a real router with a setup error that names the host.
  The wording of our error is ours.
- `src/runtime/key-store.ts` is **not** adapted from `nsdeploy/runtime/byok.js`, and the
  reason is in that file: upstream mirrors BYOK profiles into a host cookie on loopback
  hosts, which is a wider surface than this site should have.
