# Provenance of third-party material

This project's submission claims only the work in `src/`, `tests/`, `data/` and `public/`.
Anything here came from somewhere else, and this file says where, when, and under what
terms. It exists so that no reviewer has to guess which parts are ours.

## Cognizant AI Lab — Neuro SAN and nsDeploy

**Licence: Apache License 2.0** (`LICENSE-Apache-2.0.txt`, fetched 2026-11-23 from
`https://raw.githubusercontent.com/cognizant-ai-lab/nsdeploy/main/LICENSE.txt`; the
`neuro-san` repository carries a byte-identical Apache 2.0 licence).

Our event spec (`docs/mvp-spec-2026-11-23.md`, lines 96-102) names the Neuro SAN Agent
Network HOCON File Reference as the normative working schema for an agent network, and
names nsDeploy as the reference runtime. Both are linked rather than included, so the
schema had to be either inferred or fetched. We fetched it.

### Reference material vendored here (documentation and schema only, unmodified)

| File | Source | Fetched |
|---|---|---|
| `neuro-san-agent-hocon-reference.md` | `cognizant-ai-lab/neuro-san` `docs/agent_hocon_reference.md` | 2026-11-23 |
| `neuro-san-agent_network_schema.hocon` | `cognizant-ai-lab/neuro-san` `docs/agent_network_schema.hocon` | 2026-11-23 |
| `neuro-san-example-hello_world.hocon` | `cognizant-ai-lab/neuro-san` `registries/hello_world.hocon` | 2026-11-23 |
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
notice carries the same SHA in a permalink. The six upstream sources were re-fetched
at that exact SHA and verified byte-identical to what was adapted:

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
