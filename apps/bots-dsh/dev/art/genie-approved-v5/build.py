#!/usr/bin/env python3
"""Genie's faces and install-window figure, from the approved full-body Genie (genie-approved-v5).

    uv run --no-project --with 'Pillow==11.3.0' python -I dev/art/genie-approved-v5/build.py [--check]

Reads the approved delivery's three files where the repository keeps them, byte for byte
(SOURCE.json names each, its name in the delivery and its SHA-256, and this stops when one
differs): approved-genie.png beside this script (the figure, 1254 px, transparent), and the
pet the plugin ships, src/host/pets/genie-clay/spritesheet.webp (the Codex v2 atlas,
1536x2288) with its sleep.webp (1152x208). Nothing is drawn: every output is those files'
own pixels, cropped or scaled. Writes, from the repository root:

  apps/bots-dsh/src/client/art/genie-expressions.webp (and welcome-dsh's vendored copy)
      Seven 192x208 cells in clay-art.js FACES order, each one frame of the atlas (FACE_CELLS
      below), whole and where the atlas put it. One is not: `delighted` is the jump's peak,
      which the atlas draws smaller and high in its cell to leave room for the hop; as a still
      it is scaled to the idle figure's size (LIFT, Lanczos on premultiplied alpha) and stood
      on the idle floor, so the figure does not shrink when its face changes.
  apps/desktop/assets/dmg-source/genie.png
      The figure on a 1024x1024 transparent square, trimmed, scaled to fit with a margin and
      centred, for the Mac install window's background (background.svg).

and records each output's SHA-256 in SOURCE.json (test/genie-art.test.js holds the files to
it). --check writes nothing and exits 1 when a source is not the approved file or an output's
pixels differ from what this would write (pixels, not bytes, so another libwebp or zlib does
not fail it).
"""
import hashlib
import io
import json
import sys
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[4]
SOURCE = json.loads((HERE / 'SOURCE.json').read_text())
CELL_W, CELL_H = 192, 208
ROW = {'idle': 0, 'waving': 3, 'jumping': 4, 'failed': 5, 'waiting': 6, 'running': 7, 'review': 8}
# clay-art.js FACES, and the atlas frame each face is: (row, frame); 'sleep' is the sleep strip.
FACE_CELLS = [
    ('calm', 'idle', 0),
    ('pleased', 'waving', 2),
    ('delighted', 'jumping', 2),
    ('focused', 'running', 0),
    ('curious', 'waiting', 0),
    ('asleep', 'sleep', 0),
    ('sad', 'failed', 0),
]
# The jump's peak as a still: scaled up to the idle figure's size, its foot on the idle floor.
LIFT = 1.15
FLOOR = 201
DMG_SIZE = 1024
DMG_FIT = 900

sha = lambda data: hashlib.sha256(data).hexdigest()


def source(entry):
    data = (REPO / entry['path']).read_bytes()
    if sha(data) != entry['sha256']:
        raise SystemExit(f"{entry['path']} is not the approved {entry['delivery']}: sha256 {sha(data)}")
    return Image.open(io.BytesIO(data)).convert('RGBA')


def scaled(image, size):
    """Lanczos on premultiplied alpha, so transparent pixels do not bleed a fringe."""
    return image.convert('RGBa').resize(size, Image.Resampling.LANCZOS).convert('RGBA')


def box_of(image):
    return image.getchannel('A').point(lambda a: 255 if a > 8 else 0).getbbox()


def expressions(sheet, sleep):
    row = Image.new('RGBA', (CELL_W * len(FACE_CELLS), CELL_H))
    for index, (face, name, frame) in enumerate(FACE_CELLS):
        strip, top = (sleep, 0) if name == 'sleep' else (sheet, ROW[name] * CELL_H)
        cell = strip.crop((frame * CELL_W, top, (frame + 1) * CELL_W, top + CELL_H))
        if face == 'delighted':
            left, upper, right, lower = box_of(cell)
            figure = cell.crop((left, upper, right, lower))
            figure = scaled(figure, (round(figure.width * LIFT), round(figure.height * LIFT)))
            centre = (left + right) / 2
            cell = Image.new('RGBA', (CELL_W, CELL_H))
            cell.paste(figure, (round(centre - figure.width / 2), FLOOR - figure.height))
            if box_of(cell)[0] <= 0 or box_of(cell)[1] <= 0 or box_of(cell)[2] >= CELL_W:
                raise SystemExit('the delighted still does not fit its cell')
        row.paste(cell, (index * CELL_W, 0))
    return row


def dmg_figure(approved):
    figure = approved.crop(box_of(approved))
    scale = DMG_FIT / max(figure.size)
    figure = scaled(figure, (round(figure.width * scale), round(figure.height * scale)))
    square = Image.new('RGBA', (DMG_SIZE, DMG_SIZE))
    square.paste(figure, ((DMG_SIZE - figure.width) // 2, (DMG_SIZE - figure.height) // 2))
    return square


def encoded(image, kind):
    out = io.BytesIO()
    if kind == 'webp':
        # Lossless at the encoder's full effort: the smallest file. The plugins inline this file
        # as base64, where a run of letters can read as a name by chance and stop the
        # repository's privacy check: a rebuild that trips it takes another effort (quality),
        # which changes the bytes and no pixel.
        image.save(out, 'WEBP', lossless=True, exact=True, method=6, quality=100)
    else:
        image.save(out, 'PNG', optimize=True)
    return out.getvalue()


def same_pixels(path, image):
    try:
        there = Image.open(path).convert('RGBA')
    except OSError:
        return False
    return there.size == image.size and there.tobytes() == image.tobytes()


def main(check):
    approved, sheet, sleep = (source(entry) for entry in SOURCE['source'])
    if sheet.size != (1536, 2288) or sleep.size != (1152, 208):
        raise SystemExit(f'atlas {sheet.size}, sleep strip {sleep.size}')
    faces = expressions(sheet, sleep)
    pictures = {
        'apps/bots-dsh/src/client/art/genie-expressions.webp': (faces, 'webp'),
        'apps/welcome-dsh/src/client/vendor/art/genie-expressions.webp': (faces, 'webp'),
        'apps/desktop/assets/dmg-source/genie.png': (dmg_figure(approved), 'png'),
    }
    if check:
        stale = [path for path, (image, _) in pictures.items() if not same_pixels(REPO / path, image)]
        if stale:
            raise SystemExit('not what the approved figure gives: ' + ', '.join(stale))
        print("Genie's faces and install-window figure are the approved figure's")
        return
    strip = encoded(faces, 'webp')
    for path, (image, kind) in pictures.items():
        (REPO / path).write_bytes(strip if kind == 'webp' else encoded(image, kind))
    SOURCE['derived'] = {path: sha((REPO / path).read_bytes()) for path in pictures}
    (HERE / 'SOURCE.json').write_text(json.dumps(SOURCE, indent=2) + '\n')
    print('wrote', ', '.join(pictures))


if __name__ == '__main__':
    args = sys.argv[1:]
    if args not in ([], ['--check']):
        raise SystemExit(__doc__)
    main(args == ['--check'])
