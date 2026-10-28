#!/bin/sh
# Composes Unfold's expression strip (src/client/art/unfold-expressions.webp, copied to
# welcome-dsh's vendor/art) from the seven 256x256 stills of the Unfold pet's dsh/expressions:
# one row of seven 192x208 cells, faces in clay-art.js FACES order. Each still is scaled to fit
# its cell (aspect kept, centred, transparent padding), the row is stacked to PNG with ffmpeg,
# then encoded lossless with cwebp, so the same stills always give the same bytes.
#
#   FFMPEG=<ffmpeg 8.0.1> CWEBP=<cwebp 1.6.0> sh dev/art/unfold-expressions.sh <pet>/dsh/expressions <out.webp>
set -eu
: "${FFMPEG:?set FFMPEG to ffmpeg 8.0.1}"
: "${CWEBP:?set CWEBP to cwebp 1.6.0}"
src=${1:?the folder of the seven stills}
out=${2:?the strip to write}
faces="calm pleased delighted focused curious asleep sad"
inputs=""
filter=""
i=0
for face in $faces; do
  [ -f "$src/$face.webp" ] || { echo "missing $src/$face.webp" >&2; exit 1; }
  inputs="$inputs -i $src/$face.webp"
  filter="$filter[$i:v]format=rgba,scale=192:208:force_original_aspect_ratio=decrease:flags=lanczos,pad=192:208:(ow-iw)/2:(oh-ih)/2:color=0x00000000[c$i];"
  i=$((i + 1))
done
png="$(mktemp -d)/strip.png"
# shellcheck disable=SC2086
"$FFMPEG" -v error -y $inputs -filter_complex "${filter}[c0][c1][c2][c3][c4][c5][c6]hstack=inputs=7,format=rgba[out]" -map "[out]" -frames:v 1 -fflags +bitexact -flags +bitexact "$png"
"$CWEBP" -quiet -lossless -exact "$png" -o "$out"
rm -rf "$(dirname "$png")"
