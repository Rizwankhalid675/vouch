# Deploy runbook

You said I should handle the hosting. I have done everything I can and found one blocker I could
not reason past, so this is the short version of who does what:

- **You already have a Vercel account.** There is a deliberate `vercel.json` at `~/Desktop/PW`
  with a schema reference and cache headers, which is how webrizz.dev is served. So there is no
  signup, no new account and nothing to pay for. That was the thing I expected to be in the way
  and it is not.
- **Two commands are yours**, below, because of a limit that is working correctly: the deploy needs
  a credential, and this session's sandbox denies me read access to `.env` precisely so that keys
  never pass through me. I could ask for that to be lifted. I would rather not, for a token that
  can create and delete deployments on your account.
- **Everything either side of them is mine**, and there is a lot of it: the measurement pass, the
  CORS proof, the conformance run against the real origins, and the three manifest fields that go
  back in once the peer origin exists.

Total of your time: about two minutes, plus whatever Vercel's prompts ask.

---

## Correction: it is ONE command, not two, and then I do the deploys

I had this wrong when I first wrote it. There is no Vercel CLI session on this machine — I checked
`~/Library/Application Support/com.vercel.cli`, `~/.vercel`, `~/.config/vercel`, the Netlify
locations, and the environment. Nothing. So authentication has to happen once.

**That once is yours, and it is this:**

```bash
npx vercel@latest login
```

It opens a browser or emails you a confirmation. That is the whole of it.

**Why it cannot be me.** Not the sandbox this time — the rule. I do not enter API tokens or
passwords into fields, and that holds even when you tell me to, because a token that can create and
delete deployments on your account should not pass through a chat transcript or my shell history.
A browser login you complete yourself leaves the credential where it belongs: in the CLI's own
store, which I can then *use* without ever seeing.

**After that one command, both deploys are mine.** The session persists, so I run `vercel --prod`
for the deli and settle the peer question by measurement, with no further input from you. Steps 1
and 2 below are then mine to run, not yours — I have left them in because the commands and the
reasoning are still exactly right.

---

## Step 1 — the deli. This one is known-good.

From `~/Desktop/PW/hackathons/agenticweb-2027`:

```bash
npx vercel@latest --prod
```

It will ask to link or create a project; accept the defaults. It then reads the repo's own
`vercel.json`, which sets `buildCommand: npm run build`, `outputDirectory: dist`, and
`Access-Control-Allow-Origin: *` on the three published artifacts and on `/broken/(.*)`.

I have read that config against the build and it is correct: `npm run build` emits `dist/` with
`agent-manifest.json`, `vouch.network.json`, `links.json`, `broken/` and `_headers`.

**Tell me the URL it prints.** That is all I need to start.

## Step 2 — the peer. There is a real question here and the deploy answers it.

The peer is a second site on a second origin, which is the whole point: three of the
specification's seven interoperability checks are about one origin loading another's agents, and a
second path on the same host tests nothing.

**I found a defect in our own config while preparing this**, and it is the same shape this project
keeps catching — a config that looks right and cannot be read:

`peer/vercel.json` has the correct CORS headers. But Vercel only reads a `vercel.json` from a
project's **Root Directory**, and if the Root Directory were `peer/`, that file's own
`buildCommand: npm run build:peer` would run with its install path set to `peer/` — where there is
**no `package.json`** — and its `outputDirectory: peer-dist` would resolve to `peer/peer-dist`,
which does not exist. So as configured, the peer cannot deploy to Vercel.

I went to Vercel's documentation to settle the alternative and **it does not answer the two
questions that matter**: whether a `vercel.json` inside a directory passed to `vercel deploy <dir>`
is honoured, and whether a headers-only config applies to a prebuilt static directory. What *is*
documented is the two-projects-one-repository pattern, each with its own Root Directory.

So rather than guess at Vercel's behaviour and hand you a config I have not tested — which is the
mistake this project has corrected five times in prose and once in a compiler claim — **the first
deploy is the experiment.** Try this:

```bash
cd ~/Desktop/PW/hackathons/agenticweb-2027 && npm run build:peer && cd peer-dist && npx vercel@latest --prod
```

That deploys the already-built peer as a static directory. **Tell me the URL and I will measure
whether the CORS header actually arrives on `/agents/agent-manifest.json`.**

- If it does, we are done and I record the result.
- If it does not, the fix is one file — a headers-only `vercel.json` emitted into `peer-dist/` via
  `peer/public/`, which is exactly how `_headers` already gets there — and a second attempt. I did
  not add it pre-emptively because an untested config file in a published output would itself
  become a published artifact nobody reviewed.

Either way it is settled by a real response rather than by my model of a hosting provider. One
measurement, and the §3.4 check stops being the entry's biggest unknown.

## What I do the moment I have both URLs

1. **Prove CORS from outside**, with a cache-buster, reading the actual
   `Access-Control-Allow-Origin` on each of the three artifacts on each origin. A config file is
   not evidence — `_headers` is a silent no-op on Vercel and `vercel.json` is a silent no-op on
   Netlify, and both leave every local test green.
2. **Run the conformance CLI against both real origins** and record it in `docs/RESULTS.md` beside
   runs A, B and C. Expect the CORS check to flip from its only failure to a pass; if it does not,
   that is the tool working and the site gets fixed, not the checker.
3. **Re-check the measurement pass on the deployed build** — widths at 320/375/570/900/1440,
   contrast computed in the page, the no-JavaScript path. All three pass locally; this project has
   already shipped a layout bug that appeared only on the real site.
4. ~~**Put the three manifest fields back, in one commit**~~ — **done, 24 November 2026.**
   `allowed_peers`, the `links.json` binding and `menu_guide.tools` are pointed at
   `https://tubular-valkyrie-c8b80c.netlify.app`, in one commit, and the peer test's fixture
   origin is now the real one. `public/_headers` gained the `/broken/*` CORS rule in the same
   commit, because the deployed Netlify site was serving those fixtures without one while
   `vercel.json` said otherwise. **Both need a redeploy to take effect**, and steps 1-3 above are
   worth re-running after it: the artifacts they measure are the ones that changed.
5. **Fill the placeholders** in `docs/SUBMISSION-TEXT.md` and re-shoot nothing — the screenshot
   shot list and the video script are both written against states I have confirmed render.

## What stays yours after that

`docs/OWNER-TODO.md` items 2, 3 and 4: the video in your own voice, because the rules ask for the
entrant explaining the project; the Devpost form, because it carries eligibility declarations; and
a public repository, which is optional but is the only thing that makes the "shared with the
community" scoring line true.
