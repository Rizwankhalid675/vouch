# The demo video

`vouch-demo.mp4` — 1920×1080, 92.5 s, silent. Fourteen shots of the **deployed**
site at `https://vouch-deli.netlify.app`, captured on 24 November 2026 by
clicking the live site in the order the captions describe. Nothing in it is
mocked up, re-rendered or staged.

`vouch-demo.srt` — the narration, one line per shot, timed to the cut.

## What is still yours to do

**The voice.** The rules require the Entrant to explain the project, so the
narration has to be read by you, not synthesised. The `.srt` is the script:
fourteen lines, each sized to the shot it sits over. Read it over the silent
video in any screen recorder or editor and export.

If a line runs long, don't fight it — change that shot's duration in
`tools/demo-video/build.py` (the last number in its `SHOTS` row) and re-run the
build. The subtitle timings are generated from the same numbers, so the script
and the cut cannot drift apart.

## Rebuilding

```bash
python3 tools/demo-video/build.py
```

Needs `rsvg-convert` (librsvg) and `ffmpeg` with `libx264`. This ffmpeg has no
`drawtext` filter — no freetype — so every card is rendered as SVG and
composited, which is also why the type is the site's own serif rather than a
terminal font.

The frames live in `tools/demo-video/frames/`. To re-shoot a beat, replace its
file and rebuild; nothing else in the pipeline reads the site.

## The shots

| # | Start | Shot |
|---|-------|------|
| 1 | 0:00 | Title |
| 2 | 0:06 | Nothing ticked — no dish carries a verdict |
| 3 | 0:11 | The menu, every ingredient published |
| 4 | 0:16 | Dairy-free ticked: 15 unsafe, 3 we cannot tell, 16 no conflict |
| 5 | 0:23 | Reuben unsafe; Pastrami "no conflict found" — never *safe* |
| 6 | 0:29 | Turkey club: Brioche bun → Brioche → Butter → Dairy |
| 7 | 0:37 | Card: the model proposes, a gate decides |
| 8 | 0:41 | A replayed false all-clear — three claims withheld |
| 9 | 0:49 | `/broken/invalid` refused, in the validator's own words |
| 10 | 0:56 | The consent card before any peer code runs |
| 11 | 1:03 | Approved — the bakery's network loads from its own origin |
| 12 | 1:09 | "What this ran": sixteen events, refusal and consent among them |
| 13 | 1:17 | The conformance CLI: 14/14, and the six it did not make |
| 14 | 1:26 | Closing |

Shot 13 is a terminal card rather than a browser frame, built from the real
output of a run against the live site on 24 November 2026; the full transcript
it was abridged from is `tools/demo-video/conformance-run.txt`.
