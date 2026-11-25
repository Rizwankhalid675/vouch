#!/usr/bin/env python3
"""Check that every shot is actually in the encoded video, at its timecode.

This exists because the first cut was wrong in a way the encoder reported as
success: fed the stills directly, the ffmpeg concat demuxer held one shot for
twenty seconds and dropped three others -- including the butter-chain frame,
which is the whole argument of the project. Exit 0 and the right total duration
both looked fine. Only sampling the picture found it.

So: sample the midpoint of every shot and compare it to the still that shot was
built from. A match alone would not prove much -- two frames of the same site
look alike -- so each sample must also be measurably *closer* to its own source
than to any other shot's. That second test is the positive control: if the
comparison could not tell the shots apart, it would fail here rather than pass
everywhere.

Usage: python3 tools/demo-video/verify.py [--work /tmp/claude/vid]
       (run straight after build.py, which leaves the source stills in --work)
"""
from __future__ import annotations

import argparse
import importlib.util
import pathlib
import subprocess
import sys

SAME = 2.0      # mean grey levels; above this the frame is not the right one
MARGIN = 2.0    # how much closer to its own source than to the nearest other


def load_build(here: pathlib.Path):
    spec = importlib.util.spec_from_file_location("build", here / "build.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def grey(args: list[str]) -> bytes:
    """One frame, downscaled to grey, as raw bytes -- small and encode-robust."""
    r = subprocess.run(
        ["ffmpeg", "-v", "error", *args, "-vf", "scale=240:135",
         "-pix_fmt", "gray", "-frames:v", "1", "-f", "rawvideo", "-"],
        capture_output=True, check=True,
    )
    if not r.stdout:
        raise SystemExit(f"no frame decoded for: {' '.join(args)}")
    return r.stdout


def mad(a: bytes, b: bytes) -> float:
    return sum(abs(x - y) for x, y in zip(a, b)) / len(a)


def main() -> int:
    here = pathlib.Path(__file__).resolve().parent
    ap = argparse.ArgumentParser()
    ap.add_argument("--work", default="/tmp/claude/vid")
    ap.add_argument("--video", default=str(here.parent.parent / "docs" / "demo" / "vouch-demo.mp4"))
    args = ap.parse_args()

    b = load_build(here)
    durations = b.shot_seconds()
    work = pathlib.Path(args.work)

    sources = []
    for i in range(len(durations)):
        p = work / "shots" / f"{i:02d}.png"
        if not p.exists():
            p = work / "cards" / f"{i:02d}.png"
        if not p.exists():
            print(f"no source still for shot {i + 1}: re-run build.py with --work {work}",
                  file=sys.stderr)
            return 2
        sources.append(grey(["-i", str(p)]))

    at, mids = 0.0, []
    for secs in durations:
        mids.append(at + secs / 2)
        at += secs

    bad = 0
    print(f"{'shot':>4} {'at':>7} {'own':>6} {'nearest other':>16}")
    for i, t in enumerate(mids):
        got = grey(["-ss", f"{t:.3f}", "-i", args.video])
        own = mad(got, sources[i])
        other, which = min((mad(got, s), j + 1) for j, s in enumerate(sources) if j != i)
        ok = own < SAME and other > own + MARGIN
        bad += not ok
        print(f"{i + 1:>4} {t:>7.2f} {own:>6.2f} {other:>10.2f} (#{which})"
              f"{'' if ok else '  <-- MISMATCH'}")

    if bad:
        print(f"\n{bad} of {len(durations)} shots are not what the cut says they are",
              file=sys.stderr)
        return 1
    print(f"\n{len(durations)}/{len(durations)} shots present at their timecode, each closer to "
          f"its own source still than to any other")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
