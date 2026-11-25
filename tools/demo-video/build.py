#!/usr/bin/env python3
"""Build the Vouch demo video from screenshots of the deployed site.

Every frame in `frames/` was captured from https://vouch-deli.netlify.app by
clicking the live site; nothing here is mocked up or re-rendered. This script
only lays them out, writes the captions, and encodes.

Requires: rsvg-convert (librsvg) and ffmpeg with libx264.
Usage: python3 tools/demo-video/build.py [--frames DIR] [--out FILE]
"""
from __future__ import annotations

import argparse
import json
import os
import pathlib
import shutil
import subprocess
import sys
from xml.sax.saxutils import escape

W, H = 1920, 1080
SHOT_X, SHOT_Y, SHOT_W = 80, 44, 1760          # placement of the screenshot
RULE_Y, LABEL_Y, CAP_Y, CAP_LEAD = 915, 962, 1012, 44

INK = "#14110E"        # the dark field the screenshots sit on
PAPER = "#FAF6EC"      # the site's own paper colour, used for the cards
CREAM = "#F5EEDF"
GOLD = "#C8A96A"
RED = "#9E2A1E"
SERIF = "Georgia, 'Times New Roman', serif"
MONO = "'SF Mono', Menlo, monospace"

# (kind, source frame, label, caption lines, seconds)
SHOTS = [
    ("card", None, "OPEN AGENTIC WEB CHALLENGE", [
        "Vouch",
        "A deli whose assistant may describe the food, rank it and talk about it —",
        "but may never tell you it is safe to eat.",
    ]),
    ("shot", "f01.jpg", "NOTHING TICKED", [
        "Nothing is being checked yet, so no dish carries a verdict.",
        "The site does not pretend to have checked something you never asked about.",
    ]),
    ("shot", "f02.jpg", "THE MENU", [
        "Thirty-four dishes, each with its published ingredient list.",
        "No account, no key, no assistant — this all works with JavaScript off.",
    ]),
    ("shot", "f03.jpg", "TICK DAIRY-FREE", [
        "Checked 34 dishes: 15 unsafe, 3 we cannot tell, 16 with no conflict found.",
        "Where an ingredient list was never published, the answer is “We don’t know”.",
    ]),
    ("shot", "f04.jpg", "TWO OF THE THREE VERDICTS", [
        "Reuben: unsafe, through Swiss cheese → Dairy.",
        "Pastrami: “No conflict found”. There is no verdict in this system called safe.",
    ]),
    ("shot", "f05.jpg", "THE FIND THAT JUSTIFIES THE PROJECT", [
        "Turkey club: dairy, through Brioche bun → Brioche → Butter → Dairy.",
        "Butter three steps down a derivation chain, inside a bun, invisible in the line you read.",
    ]),
    ("card", None, "NOW LET A MODEL ANSWER", [
        "The model proposes.",
        "A deterministic gate decides what reaches the guest.",
    ]),
    ("shot", "f06.jpg", "A REPLAYED REPLY GIVING A FALSE ALL-CLEAR", [
        "Three claims withheld. One because the checker found a conflict;",
        "two it could not derive — and each says so: “That does not mean it is false.”",
    ]),
    ("shot", "f07.jpg", "A REFUSAL, WATCHED RATHER THAN TAKEN ON TRUST", [
        "A deliberately broken network is published so the refusal can be demonstrated.",
        "The validator’s words are quoted exactly, kept apart from ours.",
    ]),
    ("shot", "f08.jpg", "COMPOSING WITH ANOTHER SITE", [
        "Running a stranger’s agents asks first, names the origin, and says what it does:",
        "“This runs their code in this browser.” Nothing is fetched before you answer.",
    ]),
    ("shot", "f09.jpg", "APPROVED", [
        "The bakery’s network loads from its own origin and its agents join the conversation.",
        "Nothing it says can change the verdict beside a dish.",
    ]),
    ("shot", "f10.jpg", "WHAT THIS RAN", [
        "Sixteen events, written down: every router choice, every action, every receipt —",
        "the refusal and the consent among them. The evidence survives the answer.",
    ]),
    ("term", None, "THE PART THAT IS USEFUL TO OTHER PEOPLE", [
        "A dependency-light CLI that checks any agentic site against the spec — and names",
        "the six checks it did not make, because “I did not look” and “this cannot be",
        "checked from here” are different statements.",
    ]),
    ("card", None, "VOUCH", [
        "Model proposes. Gate decides. Evidence survives.",
        "vouch-deli.netlify.app · conformance CLI: 14 of 14 machine-checkable checks, exit 0",
    ]),
]


def headline_size(text: str, maximum: int = 92, room: int = 1700) -> int:
    """Shrink a headline until it fits the card.

    Georgia Bold averages about 0.55em per character, so this is an estimate
    rather than a measurement -- but it errs small, and without it the longest
    headline ran off both edges of the frame.
    """
    return max(40, min(maximum, int(room / (0.55 * max(len(text), 1)))))


def card_svg(label: str, lines: list[str]) -> str:
    """A full-bleed title card on the site's own paper colour."""
    head = escape(lines[0])
    size = headline_size(lines[0])
    body = "".join(
        f'<text x="{W//2}" y="{640 + i*56}" font-family="{SERIF}" font-size="34" '
        f'fill="#3A332A" text-anchor="middle">{escape(l)}</text>'
        for i, l in enumerate(lines[1:])
    )
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}">
<rect width="{W}" height="{H}" fill="{PAPER}"/>
<text x="{W//2}" y="420" font-family="{MONO}" font-size="22" letter-spacing="6"
      fill="{RED}" text-anchor="middle">{escape(label)}</text>
<text x="{W//2}" y="540" font-family="{SERIF}" font-size="{size}" font-weight="bold"
      fill="{INK}" text-anchor="middle">{head}</text>
<rect x="{W//2 - 60}" y="578" width="120" height="3" fill="{RED}"/>
{body}
</svg>'''


def plate_svg(label: str, lines: list[str]) -> str:
    """The dark plate a screenshot is laid onto, with its caption already set."""
    body = "".join(
        f'<text x="{SHOT_X}" y="{CAP_Y + i*CAP_LEAD}" font-family="{SERIF}" '
        f'font-size="33" fill="{CREAM}">{escape(l)}</text>'
        for i, l in enumerate(lines)
    )
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}">
<rect width="{W}" height="{H}" fill="{INK}"/>
<rect x="{SHOT_X}" y="{RULE_Y}" width="{W - 2*SHOT_X}" height="2" fill="{RED}"/>
<text x="{SHOT_X}" y="{LABEL_Y}" font-family="{MONO}" font-size="19" letter-spacing="4"
      fill="{GOLD}">{escape(label)}</text>
{body}
</svg>'''


# Real output, abridged for the frame, from a run against the deployed site.
# `tools/demo-video/conformance-run.txt` holds the full transcript it came from.
TERMINAL = [
    "$ node tools/conformance/cli.ts https://vouch-deli.netlify.app/vouch",
    "",
    "  PASS         §3.3  Site manifest published and readable by a public GET",
    "  PASS         §3.2  The requested network name matches a manifest entry exactly",
    "  PASS         §3.3  Resolved network definition published and readable by a public GET",
    "  PASS         §3.3  Peer-network link map published (links.json)",
    "  PASS         §2.1  Network identity: a stable name, a description, a named front agent",
    "  PASS         §6    A two-agent network is published (§6's first interoperability check)",
    "  PASS         §2.1  Private-context fields are named, not allowed in bulk",
    "  PASS         §2.2  Published definition is portable data: no includes, env or publisher paths",
    "  PASS         §3.1  Every reference resolves: front agent, agents, link-map bindings, URLs, MCP",
    "  PASS         §3.4  CORS header present on the real response for every public artifact",
    "  PASS         §4    No credential in the published artifacts this run could read",
    "               … and three more",
    "",
    "  NOT CHECKED  §6    Private context is absent at the peer unless a named field is allowed",
    "                       blocked by the checker: a command line cannot observe this",
    "                       What the network declares is checked above. Whether the runtime",
    "                       honours it is a property of a live invocation, and a declaration",
    "                       is not the behaviour.",
    "",
    "Result: 0 failed, 14 passed, 6 NOT CHECKED — exit 0",
]


def term_svg(label: str, lines: list[str]) -> str:
    """A terminal transcript with its caption, for a beat the browser cannot show."""
    def colour(line: str) -> tuple[str, str]:
        if line.startswith("$"):
            return "#E8734F", "normal"
        if line.lstrip().startswith("PASS"):
            return "#7FB069", "normal"
        if "NOT CHECKED" in line:
            return GOLD, "normal"
        if line.startswith("Result:"):
            return CREAM, "bold"
        return "#8C8377", "normal"

    body = ""
    for i, line in enumerate(TERMINAL):
        fill, weight = colour(line)
        body += (
            f'<text x="{SHOT_X}" y="{150 + i*31}" font-family="{MONO}" font-size="23" '
            f'xml:space="preserve" font-weight="{weight}" fill="{fill}">{escape(line)}</text>'
        )
    cap = "".join(
        f'<text x="{SHOT_X}" y="{CAP_Y - 70 + i*CAP_LEAD}" font-family="{SERIF}" '
        f'font-size="33" fill="{CREAM}">{escape(l)}</text>'
        for i, l in enumerate(lines)
    )
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}">
<rect width="{W}" height="{H}" fill="#0C0A08"/>
{body}
<rect x="{SHOT_X}" y="{RULE_Y - 70}" width="{W - 2*SHOT_X}" height="2" fill="{RED}"/>
<text x="{SHOT_X}" y="{LABEL_Y - 70}" font-family="{MONO}" font-size="19" letter-spacing="4"
      fill="{GOLD}">{escape(label)}</text>
{cap}
</svg>'''


# One line of narration per shot, in the same order and emitted as a subtitle
# file timed from the durations above -- so a change to a shot's length moves
# its line with it, and the script a person reads can never drift from the cut.
# One line per shot, and the cut is derived from them: see shot_seconds().
NARRATION = [
    "Vouch is a deli site whose assistant may never tell you food is safe to eat.",
    "Nothing is ticked, so nothing is checked. No dish carries a verdict nobody asked for.",
    "Thirty-four dishes, every ingredient published. All of this works with JavaScript off.",
    "Tick dairy-free. Thirty-four dishes: fifteen unsafe, three we can't tell, "
    "sixteen with no conflict found.",
    "The Reuben: unsafe, through Swiss cheese. The Pastrami: no conflict found. "
    "Nothing here is ever called safe.",
    "The Turkey club: dairy, through brioche bun, brioche, butter. Three steps down, "
    "inside a bun, invisible in the line you'd read.",
    "Now let a model answer. The model proposes; a deterministic gate decides.",
    "A replayed reply giving a false all-clear. Three claims withheld: one the checker "
    "contradicted, two it couldn't derive. The gate suppresses true statements too.",
    "A deliberately broken network, refused. The validator's words are quoted exactly, "
    "kept apart from ours.",
    "Running another site's agents asks first, names the origin, and says plainly: "
    "this runs their code in your browser.",
    "Approved. The bakery's network loads from its own origin. Nothing it says "
    "changes a verdict.",
    "Sixteen events, written down: every router choice, every action, every receipt. "
    "The refusal and the consent among them.",
    "The conformance CLI checks any agentic site against the spec. Fourteen of fourteen "
    "here, and it names the six it didn't make.",
    "Model proposes. Gate decides. Evidence survives. Apache-2.0, and live now.",
]

# The entrant reads the narration over the picture, so every shot must be long
# enough to say its line in. The first cut was timed for *reading* captions:
# ten of the fourteen lines then needed between 160 and 200 words a minute to
# fit, faster than anyone narrates, so the voice would have overrun the picture
# on almost every shot. These numbers make the cut a consequence of the script
# rather than a claim made beside it.
WORDS_PER_MINUTE = 145   # an unhurried read; 160+ is a rush, 120 is a drawl
AIR = 0.5                # a breath at each shot boundary
MIN_SECONDS = 4.0        # below this a caption cannot be read at all
MAX_TOTAL = 115.0        # the rules ask for under two minutes; this is the margin


def shot_seconds() -> list[float]:
    """How long each shot holds: as long as its narration line takes to say.

    Raises rather than returning a cut the narration does not fit, because a
    video whose voice runs past its picture is the failure this function
    exists to prevent, and a comment saying so would not stop a build.
    """
    secs = [
        round(max(MIN_SECONDS, len(line.split()) / WORDS_PER_MINUTE * 60 + AIR), 1)
        for line in NARRATION
    ]
    total = sum(secs)
    if total > MAX_TOTAL:
        raise SystemExit(
            f"narration needs {total:.1f}s at {WORDS_PER_MINUTE} wpm, over the "
            f"{MAX_TOTAL:.0f}s budget: shorten the lines, do not raise the rate"
        )
    return secs


# YouTube chapters, as (index of the first shot, title). Generated rather than
# written down beside the video, because the timecodes are a consequence of the
# durations: the hand-written list in YOUTUBE.md was already one cut out of date.
# YouTube's own rules: the first chapter starts at 0:00, there are at least
# three, and none is shorter than ten seconds.
CHAPTERS = [
    (0, "The claim, and a menu with nothing checked"),
    (3, "Tick dairy-free: 34 dishes, three kinds of answer, butter three steps down"),
    (6, "A false all-clear, and a refusal you can watch"),
    (9, "Consent before a stranger's code runs"),
    (11, "Evidence that survives, and a CLI for any agentic site"),
]
MIN_CHAPTER_SECONDS = 10.0


def write_chapters(path: pathlib.Path, durations: list[float]) -> None:
    """Write the paste-ready chapter list, and refuse to write an invalid one."""
    if not CHAPTERS or CHAPTERS[0][0] != 0:
        raise SystemExit("the first chapter must start at the first shot")
    if len(CHAPTERS) < 3:
        raise SystemExit("YouTube wants at least three chapters")
    starts = [sum(durations[:i]) for i, _ in CHAPTERS]
    bounds = starts[1:] + [sum(durations)]
    lines = []
    for (i, title), start, end in zip(CHAPTERS, starts, bounds):
        if end - start < MIN_CHAPTER_SECONDS:
            raise SystemExit(
                f"chapter {title!r} runs {end - start:.1f}s, under YouTube's "
                f"{MIN_CHAPTER_SECONDS:.0f}s minimum: merge it with a neighbour"
            )
        lines.append(f"{int(start) // 60}:{int(start) % 60:02d} {title}")
    path.write_text("\n".join(lines) + "\n")


def srt_time(seconds: float) -> str:
    ms = round(seconds * 1000)
    h, ms = divmod(ms, 3_600_000)
    m, ms = divmod(ms, 60_000)
    sec, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{sec:02d},{ms:03d}"


def write_srt(path: pathlib.Path, durations: list[float]) -> None:
    assert len(NARRATION) == len(durations), "one narration line per shot"
    out, at = [], 0.0
    for i, (line, secs) in enumerate(zip(NARRATION, durations), start=1):
        out.append(f"{i}\n{srt_time(at)} --> {srt_time(at + secs)}\n{line}\n")
        at += secs
    path.write_text("\n".join(out))


def check_listing(doc: pathlib.Path, chapter_text: str) -> None:
    """Fail the build if the pasteable listing disagrees with the real cut.

    YOUTUBE.md has to carry the chapter lines inside its description block --
    the point of that file is that it pastes in one go -- so the lines exist in
    two places. The hand-written copy went stale the first time a shot was
    re-timed, and the document itself carried a sentence warning that it would.
    A warning is not a mechanism; this is.
    """
    if not doc.exists():
        raise SystemExit(f"{doc} is missing: the submission listing is part of the build")
    body = doc.read_text()
    missing = [ln for ln in chapter_text.strip().splitlines() if ln not in body]
    if missing:
        raise SystemExit(
            f"{doc} does not carry this cut's chapters. Missing:\n  "
            + "\n  ".join(missing)
            + "\nCopy them from the generated chapters file into its description block."
        )


def write_script(path: pathlib.Path, durations: list[float]) -> None:
    """The narration as something to read, rather than as subtitle data.

    The .srt is the right artifact for an editor and the wrong one for a
    person: three quarters of its lines are indices and timecodes, and the
    first thing anyone does is try to read around them.
    """
    out = [
        "VOUCH - narration script",
        "",
        f"{sum(len(l.split()) for l in NARRATION)} words, {sum(durations):.1f} seconds, "
        f"about {WORDS_PER_MINUTE} words a minute. One line per shot, in order.",
        "Read it in your own voice: the hackathon requires the entrant's narration",
        "and says in as many words that it must not be AI generated.",
        "",
        "Open tools/demo-video/teleprompter.html to read along with the picture.",
        "",
        "-" * 72,
        "",
    ]
    at = 0.0
    for i, (line, secs) in enumerate(zip(NARRATION, durations), start=1):
        out.append(f"{i:>2}.  [{int(at) // 60}:{int(at) % 60:02d}, {secs:.1f}s]")
        out.append(f"    {line}")
        out.append("")
        at += secs
    path.write_text("\n".join(out))


def write_teleprompter(path: pathlib.Path, durations: list[float], video: str) -> None:
    """A page that plays the silent cut and shows the line due over each shot.

    The video element is the clock, so the words cannot drift from the picture
    however the browser schedules anything. Self-contained: the lines are built
    into the page rather than fetched, because a page opened from the
    filesystem cannot read a sibling file.
    """
    at, cues = 0.0, []
    for line, secs in zip(NARRATION, durations):
        cues.append({"t": round(at, 2), "d": secs, "text": line})
        at += secs
    data = json.dumps(cues, ensure_ascii=False)
    path.write_text(f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Vouch narration teleprompter</title>
<style>
  :root {{ color-scheme: dark; --ink: #FAF6EC; --dim: #7E776B; --gold: #C8A96A; }}
  * {{ box-sizing: border-box; }}
  body {{ margin: 0; background: #14110E; color: var(--ink);
         font: 400 17px/1.5 Georgia, 'Times New Roman', serif;
         min-height: 100vh; display: flex; flex-direction: column; }}
  header {{ display: flex; gap: 1rem; align-items: baseline; flex-wrap: wrap;
            padding: 14px 16px; border-bottom: 1px solid #2B251D;
            font-family: 'SF Mono', Menlo, monospace; font-size: 12px;
            letter-spacing: .14em; text-transform: uppercase; color: var(--dim); }}
  header b {{ color: var(--gold); font-weight: 400; }}
  main {{ flex: 1; display: grid; grid-template-columns: minmax(0,1fr) 340px;
          gap: 24px; padding: 24px 16px; align-items: start; }}
  @media (max-width: 860px) {{ main {{ grid-template-columns: 1fr; }} }}
  #line {{ font-size: clamp(26px, 4.4vw, 50px); line-height: 1.25; min-height: 4.4em;
           display: flex; align-items: center; }}
  #next {{ color: var(--dim); font-size: clamp(15px, 1.7vw, 20px); min-height: 3em;
           border-top: 1px solid #2B251D; padding-top: 14px; }}
  video {{ width: 100%; border: 1px solid #2B251D; background: #000; }}
  #bar {{ height: 3px; background: #2B251D; }}
  #fill {{ height: 3px; width: 0; background: var(--gold); transition: width .1s linear; }}
  .note {{ font-family: 'SF Mono', Menlo, monospace; font-size: 12px; line-height: 1.7;
           color: var(--dim); margin-top: 14px; }}
  kbd {{ font-family: inherit; color: var(--ink); border: 1px solid #3A332A;
         border-radius: 3px; padding: 0 4px; }}
  button {{ font: inherit; letter-spacing: .14em; text-transform: uppercase;
            color: var(--ink); background: #221D17; border: 1px solid #3A332A;
            border-radius: 3px; padding: 5px 12px; cursor: pointer; }}
  button:hover {{ border-color: var(--gold); color: var(--gold); }}
  #lead {{ position: fixed; inset: 0; display: none; place-items: center;
           background: #14110Eee; font-size: 22vw; color: var(--gold); }}
</style></head><body>
<header>
  <span>Shot <b id="n">-</b> of <b>{len(cues)}</b></span>
  <span><b id="clock">0.0</b>s / {sum(durations):.1f}s</span>
  <button id="go">start &middot; pause</button>
  <button id="again">back to the top</button>
  <span>or <kbd>space</kbd> and <kbd>r</kbd></span>
</header>
<div id="bar"><div id="fill"></div></div>
<main>
  <div>
    <div id="line">Press <kbd>space</kbd>. Three seconds of lead-in, then read.</div>
    <div id="next"></div>
  </div>
  <div>
    <video id="v" src="{video}" muted playsinline preload="auto"></video>
    <p class="note">
      The video is silent on purpose &mdash; this page shows you what to say over
      it. Start your recorder first (Voice Memos, QuickTime), then press
      <kbd>space</kbd> here and read each line as it comes up. One take is
      enough; the line is always on screen before the shot it belongs to ends.
      <br><br>
      Then: <b>tools/demo-video/add-voice.sh &lt;your-file&gt;</b>
    </p>
  </div>
</main>
<div id="lead"></div>
<script>
const CUES = {data};
const v = document.getElementById('v'), line = document.getElementById('line'),
      next = document.getElementById('next'), n = document.getElementById('n'),
      clock = document.getElementById('clock'), fill = document.getElementById('fill'),
      lead = document.getElementById('lead');
let shown = -1;
function paint() {{
  const t = v.currentTime;
  let i = CUES.length - 1;
  while (i > 0 && CUES[i].t > t) i--;
  if (i !== shown) {{
    shown = i;
    line.textContent = CUES[i].text;
    next.textContent = CUES[i + 1] ? 'next: ' + CUES[i + 1].text : '(last line)';
    n.textContent = i + 1;
  }}
  clock.textContent = t.toFixed(1);
  fill.style.width = (100 * (t - CUES[i].t) / CUES[i].d).toFixed(1) + '%';
}}
setInterval(paint, 100);          // not rAF: that stops with the video, and a
v.addEventListener('seeked', paint);  // seek then leaves the page showing a
v.addEventListener('timeupdate', paint);  // line that is no longer due
async function start() {{
  if (v.paused) {{ if (v.currentTime === 0) await countIn(); await v.play(); }}
  else v.pause();
  paint();
}}
function restart() {{ v.pause(); v.currentTime = 0; shown = -1; paint(); }}
async function countIn() {{
  for (const k of [3, 2, 1]) {{
    lead.textContent = k; lead.style.display = 'grid';
    await new Promise(r => setTimeout(r, 1000));
  }}
  lead.style.display = 'none';
}}
addEventListener('keydown', e => {{
  if (e.key === ' ') {{ e.preventDefault(); start(); }}
  if (e.key === 'r') restart();
}});
document.getElementById('go').addEventListener('click', start);
document.getElementById('again').addEventListener('click', restart);
paint();
v.addEventListener('ended', () => {{
  line.textContent = 'Done. Stop your recorder.';
  next.textContent = 'tools/demo-video/add-voice.sh <your-file>';
}});
</script></body></html>
""")


def write_shots(path: pathlib.Path, durations: list[float]) -> None:
    """Write the shot table, so no document has to restate the timecodes."""
    rows = ["| # | Start | Held | Shot |", "|---|-------|------|------|"]
    at = 0.0
    for i, ((_, _, label, _), secs) in enumerate(zip(SHOTS, durations), start=1):
        rows.append(f"| {i} | {int(at)//60}:{int(at)%60:02d} | {secs:.1f}s | {label} |")
        at += secs
    path.write_text(
        "<!-- Generated by tools/demo-video/build.py. Do not edit by hand. -->\n\n"
        + "\n".join(rows)
        + f"\n\nFourteen shots, {at:.1f}s in all.\n"
    )


def run(cmd: list[str]) -> None:
    subprocess.run(cmd, check=True, capture_output=True)


def main() -> int:
    here = pathlib.Path(__file__).resolve().parent
    ap = argparse.ArgumentParser()
    ap.add_argument("--frames", default=str(here / "frames"))
    ap.add_argument("--work", default="/tmp/claude/vid")
    ap.add_argument("--out", default=str(here.parent.parent / "docs" / "demo" / "vouch-demo.mp4"))
    args = ap.parse_args()

    for tool in ("rsvg-convert", "ffmpeg"):
        if shutil.which(tool) is None:
            print(f"missing required tool: {tool}", file=sys.stderr)
            return 1

    frames = pathlib.Path(args.frames)
    work = pathlib.Path(args.work)
    (work / "cards").mkdir(parents=True, exist_ok=True)
    (work / "shots").mkdir(parents=True, exist_ok=True)

    durations = shot_seconds()
    assert len(durations) == len(SHOTS) == len(NARRATION), "one line and one duration per shot"

    segments: list[tuple[pathlib.Path, float]] = []
    for i, ((kind, src, label, lines), secs) in enumerate(zip(SHOTS, durations)):
        svg = work / "cards" / f"{i:02d}.svg"
        png = work / "cards" / f"{i:02d}.png"
        maker = {"card": card_svg, "term": term_svg}.get(kind, plate_svg)
        svg.write_text(maker(label, lines))
        run(["rsvg-convert", "-w", str(W), "-h", str(H), "-o", str(png), str(svg)])

        if kind in ("card", "term"):
            segments.append((png, secs))
            continue

        frame = frames / src
        if not frame.exists():
            print(f"missing frame: {frame}", file=sys.stderr)
            return 1
        composed = work / "shots" / f"{i:02d}.png"
        run([
            "ffmpeg", "-y", "-loglevel", "error", "-i", str(png), "-i", str(frame),
            "-filter_complex",
            f"[1:v]scale={SHOT_W}:-2[s];[0:v][s]overlay={SHOT_X}:{SHOT_Y}",
            "-frames:v", "1", str(composed),
        ])
        segments.append((composed, secs))

    # Encode one clip per shot. Feeding the stills straight to the concat
    # demuxer silently mangles the durations -- it held one shot for twenty
    # seconds and dropped three others entirely -- so each shot gets its own
    # fixed-length encode and only finished clips are concatenated.
    (work / "clips").mkdir(parents=True, exist_ok=True)
    clips: list[pathlib.Path] = []
    for i, (png, secs) in enumerate(segments):
        clip = work / "clips" / f"{i:02d}.mp4"
        run([
            "ffmpeg", "-y", "-loglevel", "error", "-loop", "1", "-framerate", "30",
            "-t", f"{secs}", "-i", str(png),
            "-vf", "format=yuv420p", "-r", "30",
            "-c:v", "libx264", "-preset", "slow", "-crf", "20", str(clip),
        ])
        clips.append(clip)

    listing = work / "concat.txt"
    listing.write_text("".join(f"file '{c}'\n" for c in clips))

    out = pathlib.Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    run([
        "ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0",
        "-i", str(listing), "-c", "copy", "-movflags", "+faststart", str(out),
    ])
    srt = out.with_suffix(".srt")
    write_srt(srt, durations)
    chapters = out.with_name(out.stem + ".chapters.txt")
    write_chapters(chapters, durations)
    shots = out.with_name(out.stem + ".shots.md")
    write_shots(shots, durations)
    script = out.with_name(out.stem + ".read-aloud.txt")
    write_script(script, durations)
    prompter = here / "teleprompter.html"
    write_teleprompter(prompter, durations, os.path.relpath(out, prompter.parent))
    check_listing(out.parent / "YOUTUBE.md", chapters.read_text())

    total = sum(s for _, s in segments)
    print(f"{out}  {out.stat().st_size/1_000_000:.1f} MB  {total:.1f}s  {len(segments)} shots")
    print(f"{srt}  narration for {len(NARRATION)} shots")
    print(f"{chapters}  {len(CHAPTERS)} YouTube chapters")
    print(f"{shots}  shot table")
    print(f"{script}  the narration as a script to read")
    print(f"{prompter}  teleprompter")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
