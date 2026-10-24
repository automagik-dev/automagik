#!/usr/bin/env python3
"""The plugins' clay art, from the owner's clay kit (v4).

    python3 dev/art/clay-kit.py <kit dir> <out dir>

<kit dir> is the kit as delivered (omni/, genie/stills/, genie/motion/, brand/). Writes:

  expressions/genie.webp, expressions/omni.webp
      Each character's seven faces in one row (calm, pleased, delighted, focused, curious,
      asleep, sad), the cells the plugins show (genie 192x208, omni 192x192). A still is the
      largest connected component of its alpha (>= 100, 8-connected), so the specks that
      calm, pleased and delighted carry (the tips of plumes from the sheet they were cut
      from) are dropped; the dropped pixels are counted in validation.json. Every face keeps
      the kit's own registration: one crop box and one scale for all seven, so the head does
      not jump when the face changes. This follows the owner's dsh-genie-pet build.py (alpha
      under 100 is background, a shared scale, a bottom baseline), which cut a fixed grid.
  pet-v1/spritesheet.webp, pet-v1/pet.json
      Genie's Codex-format v1 atlas: 1536x1872, 8x9 cells of 192x208, rows idle 6,
      running-right 8, running-left 8, waving 4, jumping 5, failed 8, waiting 6, running 6,
      review 6; unused cells transparent. The kit's strips have 4 to 6 frames: a row's count
      is filled by holding and playing back frames, never by drawing new ones. The strips
      are drawn at different sizes (jumping much smaller), so each is scaled to the same
      face size (the dark face's longer side, at its largest in the strip), standing on one baseline; a strip's
      lift above its own resting frame (hops, the jump) is kept, scaled with it.
  pet-v1/preview.png
      The atlas on the cream and the night clay, for review.
  brand/lamp.webp
      The lamp, for empty states.
  validation.json
      What was checked and what was found.

Needs Pillow, NumPy and SciPy.
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

FACES = ['calm', 'pleased', 'delighted', 'focused', 'curious', 'asleep', 'sad']
ALPHA_MIN = 100

# Codex v1: rows and frame counts, and which kit frames fill each (1-based, '' = the sad still).
CELL_W, CELL_H, COLS = 192, 208, 8
ROWS = [
    # idle: calm only; the kit's third frame is a wide-eyed reaction and is left out.
    ('idle', 'idle', [1, 2, 6, 6, 2, 1]),
    # The hops ("poim poim"): squash, rise, float (held), land (held).
    ('running-right', 'running-right', [1, 2, 3, 3, 4, 4, 1, 1]),
    ('running-left', 'running-left', [1, 2, 3, 3, 4, 4, 1, 1]),
    ('waving', 'waving', [1, 2, 3, 4]),
    ('jumping', 'jumping', [1, 2, 3, 4, 5]),
    # failed: the kit strip's first two frames smile, so only its worried and sad frames, and
    # the sad still.
    ('failed', 'failed', [3, 4, 4, '', '', '', 4, 4]),
    ('waiting', 'waiting', [1, 2, 3, 4, 3, 2]),
    ('running', 'running', [1, 2, 3, 4, 3, 2]),
    ('review', 'review', [1, 2, 3, 4, 3, 2]),
]
# The resting character's height in a cell, leaving room above it for a hop's lift.
REST_H, BASELINE = 150, 204


def clean(image):
    """The largest connected component of the alpha, alone; and how many pixels were dropped."""
    rgba = np.array(image.convert('RGBA'))
    alpha = rgba[:, :, 3].astype(np.int32)
    solid = alpha >= ALPHA_MIN
    labels, count = ndimage.label(solid, structure=np.ones((3, 3)))
    if count == 0:
        raise SystemExit('an empty image')
    sizes = ndimage.sum(solid, labels, range(1, count + 1))
    keep = labels == int(np.argmax(sizes)) + 1
    dropped = int(solid.sum() - keep.sum())
    alpha = np.where(alpha < ALPHA_MIN, 0, np.minimum(255, np.rint(alpha * 255 / 254))).astype(np.uint8)
    alpha[~keep] = 0
    rgba[:, :, 3] = alpha
    return Image.fromarray(rgba, 'RGBA'), dropped, int(count)


def union_box(images):
    boxes = [image.getbbox() for image in images]
    return (min(b[0] for b in boxes), min(b[1] for b in boxes), max(b[2] for b in boxes), max(b[3] for b in boxes))


def row_of(images, cell_w, cell_h, pad=4):
    """One shared crop and scale for every image; each sits at the same place in its cell."""
    x0, y0, x1, y1 = union_box(images)
    scale = min((cell_w - 2 * pad) / (x1 - x0), (cell_h - 2 * pad) / (y1 - y0))
    out = Image.new('RGBA', (cell_w * len(images), cell_h))
    for index, image in enumerate(images):
        crop = image.crop((x0, y0, x1, y1))
        sized = crop.resize((round(crop.width * scale), round(crop.height * scale)), Image.Resampling.LANCZOS)
        out.alpha_composite(sized, (cell_w * index + (cell_w - sized.width) // 2, cell_h - pad - sized.height))
    return out, scale


def face_width(image):
    """Size of the dark face (the largest dark, opaque component): the head's size."""
    rgba = np.array(image.convert('RGBA')).astype(np.int32)
    dark = (rgba[:, :, 3] > 200) & (rgba[:, :, :3].sum(2) < 150)
    labels, count = ndimage.label(dark, structure=np.ones((3, 3)))
    sizes = ndimage.sum(dark, labels, range(1, count + 1))
    box = ndimage.find_objects(labels)[int(np.argmax(sizes))]
    # The longer side: a face turned aside keeps its height, a squashed one its width.
    return max(box[1].stop - box[1].start, box[0].stop - box[0].start), (box[1].start + box[1].stop) / 2


def cell_check(cell):
    alpha = np.array(cell.getchannel('A'))
    visible = alpha > 0
    return {
        'occupied': bool(visible.any()),
        'edgePixels': int(visible[0].sum() + visible[-1].sum() + visible[:, 0].sum() + visible[:, -1].sum()),
    }


def motion_atlas(kit, sad_still):
    strips = {}
    for _, source, _ in ROWS:
        frames = sorted((kit / 'genie' / 'motion' / source).glob('*.png'))
        strips[source] = [clean(Image.open(path))[0] for path in frames]
    # The face width every strip is scaled to: the stills' (a resting, frontal face).
    target_face = face_width(sad_still)[0]
    rest_h = None
    atlas = Image.new('RGBA', (CELL_W * COLS, CELL_H * len(ROWS)))
    report = {}
    for row, (name, source, picks) in enumerate(ROWS):
        frames = strips[source]
        widths = [face_width(frame) for frame in frames]
        # The widest face of a strip is its most frontal one (hops squash and turn the face).
        strip_scale = target_face / float(max(w for w, _ in widths))
        centre = float(np.median([c for _, c in widths]))
        rest_bottom = max(frame.getbbox()[3] for frame in frames)
        if rest_h is None:
            # The idle strip's resting height sets the cell scale for all of them.
            rest_h = max(frame.getbbox()[3] - frame.getbbox()[1] for frame in frames) * strip_scale
        cell_scale = REST_H / rest_h
        scale = strip_scale * cell_scale
        lifts, fitted = [], []
        for column, pick in enumerate(picks):
            frame = sad_still if pick == '' else frames[pick - 1]
            x0, y0, x1, y1 = frame.getbbox()
            sized = frame.crop((x0, y0, x1, y1))
            sized = sized.resize((max(1, round(sized.width * scale)), max(1, round(sized.height * scale))), Image.Resampling.LANCZOS)
            lift = (rest_bottom - y1) * scale if pick != '' else 0
            # A lift that would leave the cell is pressed down just enough to fit.
            top = BASELINE - lift - sized.height
            if top < 2:
                lift -= 2 - top
                fitted.append(column)
            left = round(CELL_W / 2 + (x0 - (centre if pick != '' else face_width(frame)[1])) * scale)
            left = min(max(left, 2), CELL_W - 2 - sized.width)
            cell = Image.new('RGBA', (CELL_W, CELL_H))
            cell.alpha_composite(sized, (left, round(BASELINE - lift - sized.height)))
            atlas.alpha_composite(cell, (CELL_W * column, CELL_H * row))
            lifts.append(round(lift, 1))
        report[name] = {'frames': len(picks), 'from': [f'{source}/{p:02d}.png' if p != '' else 'stills/sad.png' for p in picks], 'scale': round(scale, 4), 'lift': lifts, 'liftPressedToFit': fitted}
    cells = {}
    for row, (name, _, picks) in enumerate(ROWS):
        for column in range(COLS):
            cell = atlas.crop((CELL_W * column, CELL_H * row, CELL_W * (column + 1), CELL_H * (row + 1)))
            check = cell_check(cell)
            used = column < len(picks)
            if used != check['occupied'] or check['edgePixels']:
                raise SystemExit(f'cell {name} {column}: {check}')
            cells[f'{row}:{column}'] = 'used' if used else 'empty'
    return atlas, report, cells


def preview(atlas):
    out = Image.new('RGBA', (atlas.width, atlas.height * 2), (246, 238, 226, 255))
    night = Image.new('RGBA', atlas.size, (30, 25, 35, 255))
    out.alpha_composite(atlas, (0, 0))
    out.paste(night, (0, atlas.height))
    out.alpha_composite(atlas, (0, atlas.height))
    return out.convert('RGB')


def main(kit, out):
    for sub in ('expressions', 'pet-v1', 'brand'):
        (out / sub).mkdir(parents=True, exist_ok=True)
    report = {'kit': str(kit.name), 'alphaMin': ALPHA_MIN, 'stills': {}}
    rows = {}
    for who, size in (('genie', (192, 208)), ('omni', (192, 192))):
        folder = kit / ('genie/stills' if who == 'genie' else 'omni')
        cleaned = []
        for face in FACES:
            image, dropped, components = clean(Image.open(folder / f'{face}.png'))
            cleaned.append(image)
            report['stills'][f'{who}/{face}'] = {'components': components, 'droppedPixels': dropped}
        row, scale = row_of(cleaned, *size)
        row.save(out / 'expressions' / f'{who}.webp', quality=86, alpha_quality=90, method=6)
        rows[who] = cleaned
        report[f'{who}Expressions'] = {'faces': FACES, 'cell': list(size), 'scale': round(scale, 5), 'cells': [cell_check(row.crop((size[0] * i, 0, size[0] * (i + 1), size[1]))) for i in range(len(FACES))]}
    atlas, motion, cells = motion_atlas(kit, rows['genie'][FACES.index('sad')])
    if atlas.size != (1536, 1872):
        raise SystemExit(f'atlas is {atlas.size}')
    atlas.save(out / 'pet-v1' / 'spritesheet.webp', lossless=True, exact=True)
    check = Image.open(out / 'pet-v1' / 'spritesheet.webp')
    report['petV1'] = {
        'size': list(check.size), 'mode': check.mode, 'transparent': check.getchannel('A').getextrema()[0] == 0,
        'rows': motion, 'cells': cells,
        'usedCells': sum(1 for v in cells.values() if v == 'used'), 'emptyCells': sum(1 for v in cells.values() if v == 'empty'),
    }
    (out / 'pet-v1' / 'pet.json').write_text(json.dumps({
        'id': 'genie-clay', 'displayName': 'Genie', 'description': 'Genie in Automagik clay: the deep-space face, a plume that follows.',
        'spriteVersionNumber': 1, 'spritesheetPath': 'spritesheet.webp',
    }, indent=2) + '\n')
    preview(atlas).save(out / 'pet-v1' / 'preview.png')
    lamp, _, _ = clean(Image.open(kit / 'brand' / 'lamp.png'))
    lamp = lamp.crop(lamp.getbbox())
    lamp.thumbnail((256, 256), Image.Resampling.LANCZOS)
    lamp.save(out / 'brand' / 'lamp.webp', quality=86, alpha_quality=90, method=6)
    report['lamp'] = list(lamp.size)
    (out / 'validation.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({k: v for k, v in report.items() if k != 'petV1'}, indent=1)[:3000])
    print(json.dumps({k: v for k, v in report['petV1'].items() if k != 'cells'}, indent=1))


if __name__ == '__main__':
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)
    main(Path(sys.argv[1]), Path(sys.argv[2]))
