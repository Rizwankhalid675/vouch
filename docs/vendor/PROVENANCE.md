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

Upstream runtime JavaScript (`nsdeploy/runtime/*.js`) was **read and executed during
verification** — against a scratch copy outside this repository — to check our published
artifacts with the real consumer rather than with our own assumptions about it. Specifically
`selectTopRouter`, `validateNetwork`, `find_front_man` and `manifestAllowsPeer` were run
against `public/agent-manifest.json` and `public/vouch.network.json`.

**No upstream runtime code has been copied into this repository.** If any is adapted later,
Apache 2.0 §4 applies: this file must list the file taken and its source, the licence copy
must stay in the repository, and each modified file must carry a prominent notice of what
was changed. A reviewer should be able to tell our code from theirs by reading this file
alone — if they cannot, this file is wrong and should be fixed before submission.
