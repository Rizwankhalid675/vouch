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
    ], 6.0),
    ("shot", "f01.jpg", "NOTHING TICKED", [
        "Nothing is being checked yet, so no dish carries a verdict.",
        "The site does not pretend to have checked something you never asked about.",
    ], 5.5),
    ("shot", "f02.jpg", "THE MENU", [
        "Thirty-four dishes, each with its published ingredient list.",
        "No account, no key, no assistant — this all works with JavaScript off.",
    ], 5.0),
    ("shot", "f03.jpg", "TICK DAIRY-FREE", [
        "Checked 34 dishes: 15 unsafe, 3 we cannot tell, 16 with no conflict found.",
        "Where an ingredient list was never published, the answer is “We don’t know”.",
    ], 6.5),
    ("shot", "f04.jpg", "TWO OF THE THREE VERDICTS", [
        "Reuben: unsafe, through Swiss cheese → Dairy.",
        "Pastrami: “No conflict found”. There is no verdict in this system called safe.",
    ], 6.5),
    ("shot", "f05.jpg", "THE FIND THAT JUSTIFIES THE PROJECT", [
        "Turkey club: dairy, through Brioche bun → Brioche → Butter → Dairy.",
        "Butter three steps down a derivation chain, inside a bun, invisible in the line you read.",
    ], 7.5),
    ("card", None, "NOW LET A MODEL ANSWER", [
        "The model proposes.",
        "A deterministic gate decides what reaches the guest.",
    ], 4.5),
    ("shot", "f06.jpg", "A REPLAYED REPLY GIVING A FALSE ALL-CLEAR", [
        "Three claims withheld. One because the checker found a conflict;",
        "two it could not derive — and each says so: “That does not mean it is false.”",
    ], 8.0),
    ("shot", "f07.jpg", "A REFUSAL, WATCHED RATHER THAN TAKEN ON TRUST", [
        "A deliberately broken network is published so the refusal can be demonstrated.",
        "The validator’s words are quoted exactly, kept apart from ours.",
    ], 6.5),
    ("shot", "f08.jpg", "COMPOSING WITH ANOTHER SITE", [
        "Running a stranger’s agents asks first, names the origin, and says what it does:",
        "“This runs their code in this browser.” Nothing is fetched before you answer.",
    ], 7.5),
    ("shot", "f09.jpg", "APPROVED", [
        "The bakery’s network loads from its own origin and its agents join the conversation.",
        "Nothing it says can change the verdict beside a dish.",
    ], 6.0),
    ("shot", "f10.jpg", "WHAT THIS RAN", [
        "Sixteen events, written down: every router choice, every action, every receipt —",
        "the refusal and the consent among them. The evidence survives the answer.",
    ], 7.5),
    ("term", None, "THE PART THAT IS USEFUL TO OTHER PEOPLE", [
        "A dependency-light CLI that checks any agentic site against the spec — and names",
        "the six checks it did not make, because “I did not look” and “this cannot be",
        "checked from here” are different statements.",
    ], 9.0),
    ("card", None, "VOUCH", [
        "Model proposes. Gate decides. Evidence survives.",
        "vouch-deli.netlify.app · conformance CLI: 14 of 14 machine-checkable checks, exit 0",
    ], 6.5),
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
NARRATION = [
    "This is Vouch. A deli site whose assistant may never tell you food is safe to eat.",
    "Nothing is ticked, so nothing is checked. No dish carries a verdict it was not asked for.",
    "Thirty-four dishes, every ingredient published. All of this works with JavaScript off.",
    "Tick dairy-free. Thirty-four dishes checked: fifteen unsafe, three we cannot tell, "
    "sixteen with no conflict found.",
    "The Reuben is unsafe, through Swiss cheese. The Pastrami says no conflict found. "
    "Nothing here is ever called safe.",
    "And the Turkey club: dairy, through brioche bun, brioche, butter. Three steps down a "
    "chain, inside a bun, invisible in the line you would read.",
    "Now let a model answer. The model proposes; a deterministic gate decides.",
    "Here is a replayed reply giving a false all-clear. Three claims withheld: one the checker "
    "contradicted, two it could not derive. The gate suppresses true statements too.",
    "A deliberately broken network, refused. The validator's words are quoted exactly, "
    "kept apart from ours.",
    "Running another site's agents asks first. It names the origin and says plainly: "
    "this runs their code in your browser.",
    "Approved. The bakery's network loads from its own origin, and nothing it says "
    "changes a verdict.",
    "Sixteen events, written down: every router choice, every action, every receipt. "
    "The refusal and the consent among them.",
    "The conformance CLI checks any agentic site against the spec. Fourteen of fourteen "
    "here, and it names the six checks it did not make.",
    "Model proposes. Gate decides. Evidence survives. Apache-2.0, and live now.",
]


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

    segments: list[tuple[pathlib.Path, float]] = []
    for i, (kind, src, label, lines, secs) in enumerate(SHOTS):
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
    write_srt(srt, [secs for _, _, _, _, secs in SHOTS])

    total = sum(s for _, s in segments)
    print(f"{out}  {out.stat().st_size/1_000_000:.1f} MB  {total:.1f}s  {len(segments)} shots")
    print(f"{srt}  narration for {len(NARRATION)} shots")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
