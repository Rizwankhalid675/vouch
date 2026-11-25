# YouTube listing — ready to paste

Upload `vouch-demo.mp4` with your narration recorded over it. Set visibility to
**Public**, not Unlisted: an unlisted video satisfies a link check and is still
invisible to a judge who searches.

---

## Title

```text
Vouch — a deli site whose AI may never tell you food is safe to eat
```

67 characters. Fits YouTube's 100-character limit and is not truncated in
search results or on the Devpost embed.

---

## Description

```text
Vouch is a deli website whose assistant may describe the food, rank it, summarise it and
talk about it — but may never assert that something is safe to eat. A deterministic checker
owns every safety verdict. The model proposes, a gate decides, and the evidence survives.

That is not a prompt instruction. It is enforced by the type system: rendering a
model-supplied verdict does not compile.

Tick "dairy-free" and the Turkey club comes back unsafe — through Brioche bun → Brioche →
Butter → Dairy. Butter three steps down a derivation chain, inside a bun, with nothing in the
ingredient line a person would actually read.

Three things follow from the design:

• There is no "safe". A clear dish reads "No conflict found". Where the data is silent the
  answer is "We don't know" — never a guess in the guest's favour.
• The gate withholds true statements too. A model correctly saying "this is not dairy-free"
  is refused exactly like one saying it is. The verdict is rendered beside the prose, never
  through it.
• It works with no model at all. The menu, the ingredient data and every verdict run with
  JavaScript off and no API key. The assistant is additive.

Built for the Open Agentic Web Challenge. Static hosting, browser execution, visitor-supplied
inference — the site ships no model, no key, and pays for no inference.

Also in the repository: a dependency-light conformance CLI that checks any agentic site
against the spec, reports twenty checks in every run, and tells you which six it did not make.
"I did not look", "I looked and it is wrong" and "this cannot be checked from here" are three
different statements, and a conformance tool that implies coverage it does not have is the
same failure this whole project is about.

Live site: https://vouch-deli.netlify.app
Peer site it composes with: https://marrow-point-bakery.netlify.app
Source (Apache-2.0): https://github.com/Rizwankhalid675/vouch

Chapters
0:00 The claim, and a menu with nothing checked
0:16 Tick dairy-free: 34 dishes, three kinds of answer
0:29 Butter, three steps down a chain
0:41 A false all-clear, and a refusal you can watch
0:56 Consent before a stranger's code runs
1:09 Evidence that survives, and a CLI for any agentic site
```

The chapter list is formatted the way YouTube requires: the first starts at
`0:00`, there are at least three, and none is shorter than ten seconds. Paste
it inside the description and YouTube will render the chapter bar on the
scrubber by itself. If you re-time any shot in `tools/demo-video/build.py`, the
`.srt` regenerates but **this list does not** — re-check it against the shot
table in `README.md`.

---

## Two things worth checking after upload

- **Visibility is Public.** Check it on the video's own page, not the upload
  confirmation, which shows what you selected rather than what was saved.
- **The chapter bar appears on the scrubber.** If it does not, YouTube rejected
  the list — usually a chapter under ten seconds or a missing `0:00`.
