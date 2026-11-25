#!/usr/bin/env bash
# Put the entrant's narration onto the silent demo video.
#
#   tools/demo-video/add-voice.sh ~/Desktop/narration.m4a
#
# Reads any audio file ffmpeg understands and writes
# docs/demo/vouch-demo-narrated.mp4. The silent cut is left untouched, so a
# bad take costs nothing: record again and re-run.
#
# The picture is 102.5s and every shot is held long enough to say its
# narration line in at about 145 words a minute (tools/demo-video/build.py
# derives the cut from the script, so the two cannot drift). If the read runs
# long the closing card is held to cover it rather than cutting the voice off
# mid-sentence -- but the rules ask for a video under two minutes, so this
# script refuses to write one longer than that.
set -euo pipefail

VOICE=${1:-}
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
SILENT="$ROOT/docs/demo/vouch-demo.mp4"
OUT="$ROOT/docs/demo/vouch-demo-narrated.mp4"
LIMIT=120

if [[ -z $VOICE ]]; then
  echo "usage: $0 <audio-file>" >&2
  echo "  the script to read is $ROOT/docs/demo/vouch-demo.srt" >&2
  exit 64
fi
[[ -f $VOICE ]] || { echo "no such file: $VOICE" >&2; exit 66; }
[[ -f $SILENT ]] || { echo "build the picture first: python3 tools/demo-video/build.py" >&2; exit 69; }
command -v ffmpeg >/dev/null || { echo "ffmpeg not found" >&2; exit 69; }

dur() { ffprobe -v error -show_entries format=duration -of csv=p=0 "$1"; }
V=$(dur "$SILENT")
A=$(dur "$VOICE")
printf 'picture %.1fs   voice %.1fs\n' "$V" "$A"

# How much of the closing card to hold, if the read overran the picture.
PAD=$(python3 -c "print(max(0.0, $A - $V))")
TOTAL=$(python3 -c "print(max($A, $V))")

if python3 -c "import sys; sys.exit(0 if $TOTAL > $LIMIT else 1)"; then
  OVER=$(python3 -c "print(f'{$TOTAL - $LIMIT:.1f}')")
  cat >&2 <<EOF
refusing to write a video of $(printf '%.1f' "$TOTAL")s: ${OVER}s over the ${LIMIT}s the rules ask for.
The read is slower than the cut allows for. Either record it again a little
brisker, or shorten the narration in tools/demo-video/build.py and re-run it --
the cut, the subtitles and the chapters all follow from those lines.
EOF
  [[ -f $OUT ]] && echo "Nothing was written: $OUT is still the earlier take." >&2
  exit 1
fi

if python3 -c "import sys; sys.exit(0 if $PAD > 0.05 else 1)"; then
  printf 'the read runs %.1fs past the picture: holding the closing card to cover it\n' "$PAD"
  ffmpeg -y -loglevel error -i "$SILENT" -i "$VOICE" \
    -filter_complex "[0:v]tpad=stop_mode=clone:stop_duration=$PAD[v]" \
    -map "[v]" -map 1:a -c:v libx264 -preset slow -crf 20 -pix_fmt yuv420p \
    -c:a aac -b:a 160k -movflags +faststart -shortest "$OUT"
else
  # The read fits. Keep the encoded picture byte-for-byte and pad the audio
  # with silence to the end of the closing card.
  ffmpeg -y -loglevel error -i "$SILENT" -i "$VOICE" \
    -filter_complex "[1:a]apad[a]" \
    -map 0:v -map "[a]" -c:v copy -c:a aac -b:a 160k \
    -movflags +faststart -shortest "$OUT"
fi

# Say what was actually written, rather than that the command exited 0.
OD=$(dur "$OUT")
STREAMS=$(ffprobe -v error -show_entries stream=codec_type -of csv=p=0 "$OUT" | sort | tr '\n' ' ')
printf '\n%s\n  %.1fs, %s\n' "$OUT" "$OD" "$STREAMS"
python3 - "$OD" "$LIMIT" <<'PY'
import sys
d, limit = float(sys.argv[1]), float(sys.argv[2])
print(f"  {limit - d:.1f}s under the {limit:.0f}s the rules ask for")
PY
echo "  upload this one, Public. The silent cut is still at docs/demo/vouch-demo.mp4"
