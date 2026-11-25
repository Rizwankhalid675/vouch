# The demo video

| File | What it is |
|---|---|
| `vouch-demo.mp4` | 1920×1080, 102.5s, **silent**. Fourteen shots of the deployed site. |
| `vouch-demo.srt` | The narration — one line per shot, timed to the cut. |
| `vouch-demo.chapters.txt` | The YouTube chapter list, paste-ready. |
| `vouch-demo.shots.md` | The shot table with timecodes. |

Every frame came from `https://vouch-deli.netlify.app` by clicking the live
site in the order the captions describe, captured on 24 November 2026. Nothing
in it is mocked up, re-rendered or staged. The last three files are **generated
by the build**, so no document restates a timecode that could go stale.

## Adding your voice

```bash
tools/demo-video/add-voice.sh ~/Desktop/narration.m4a
```

Record `vouch-demo.srt` — read aloud, in order, one line per shot — into any
audio file, then run that. It writes `vouch-demo-narrated.mp4` and leaves the
silent cut alone, so a bad take costs nothing: record again and re-run.

**The cut is paced for speaking, not for reading.** Every shot is held as long
as its line takes to say at about 145 words a minute, which is an unhurried
read. The first version of this video was timed for *reading* the captions: ten
of the fourteen lines then needed between 160 and 200 words a minute to fit,
faster than anyone narrates, and the voice would have overrun the picture on
almost every shot. `shot_seconds()` in `build.py` now derives each duration
from its line's word count and refuses to build a cut the narration does not
fit — the subtitles and the chapters come from the same numbers, so the three
cannot drift apart.

If your read runs a little long, `add-voice.sh` holds the closing card to cover
it rather than cutting a sentence off. If it runs more than 120 seconds in
total it refuses to write the file and says so, because the rules ask for under
two minutes.

**The voice has to be yours, and it has to be real.** The hackathon's front
page says the video *"must include the Entrant explaining the Project (not AI
generated)"*; the Official Rules say *"should"*. `docs/EVENT.md` records both
and which governs. Either way the narration is not synthesised and not mine to
record — it is a hundred seconds of reading, in your own voice, and it is the
last thing this entry is waiting on.

## Rebuilding

```bash
python3 tools/demo-video/build.py
python3 tools/demo-video/verify.py
```

Needs `rsvg-convert` (librsvg) and `ffmpeg` with `libx264`. This ffmpeg has no
`drawtext` filter — no freetype — so every card is rendered as SVG and
composited, which is also why the type is the site's own serif rather than a
terminal font.

**Run `verify.py` every time.** The first cut of this video was wrong in a way
the encoder reported as success: fed the stills directly, the concat demuxer
held one shot for twenty seconds and dropped three others, the butter-chain
frame among them. Exit code 0 and the right total duration both looked fine.
`verify.py` samples the midpoint of every shot, compares it to the still that
shot was built from, and insists each sample is measurably closer to its own
source than to any other shot's — so if the comparison could not tell the shots
apart, it fails rather than passing everywhere.

The frames live in `tools/demo-video/frames/`. To re-shoot a beat, replace its
file and rebuild; nothing else in the pipeline reads the site.

## The shots

See [`vouch-demo.shots.md`](vouch-demo.shots.md) — generated, so it is never a
cut behind.

Shot 13 is a terminal card rather than a browser frame, built from the real
output of a run against the live site on 24 November 2026; the full transcript
it was abridged from is `tools/demo-video/conformance-run.txt`.
