#!/usr/bin/env python3
"""Omni's faces and the lamp, from the owner's clay kit (v4).

    python3 dev/art/clay-kit.py <kit dir> <out dir>

<kit dir> is the kit as delivered (omni/, brand/). Writes:

  expressions/omni.webp
      Omni's seven faces in one row (calm, pleased, delighted, focused, curious, asleep,
      sad), the 192x192 cells the plugins show. A still is the largest connected component
      of its alpha (>= 100, 8-connected); dropped pixels are counted in validation.json.
      Every face keeps the kit's own registration: one crop box and one scale for all seven,
      so the head does not jump when the face changes.
  brand/lamp.webp
      The lamp, for empty states.
  validation.json
      What was checked and what was found.

Genie is not built here. The kit's head-only Genie (its faces and the v1 pet atlas this
script used to compose) is retired: the app's Genie is the approved full-body figure, kept
and built in dev/art/genie-approved-v5.

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
OMNI_CELL = (192, 192)


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


def cell_check(cell):
    alpha = np.array(cell.getchannel('A'))
    visible = alpha > 0
    return {
        'occupied': bool(visible.any()),
        'edgePixels': int(visible[0].sum() + visible[-1].sum() + visible[:, 0].sum() + visible[:, -1].sum()),
    }


def main(kit, out):
    for sub in ('expressions', 'brand'):
        (out / sub).mkdir(parents=True, exist_ok=True)
    report = {'kit': str(kit.name), 'alphaMin': ALPHA_MIN, 'stills': {}}
    cleaned = []
    for face in FACES:
        image, dropped, components = clean(Image.open(kit / 'omni' / f'{face}.png'))
        cleaned.append(image)
        report['stills'][f'omni/{face}'] = {'components': components, 'droppedPixels': dropped}
    row, scale = row_of(cleaned, *OMNI_CELL)
    row.save(out / 'expressions' / 'omni.webp', quality=86, alpha_quality=90, method=6)
    report['omniExpressions'] = {'faces': FACES, 'cell': list(OMNI_CELL), 'scale': round(scale, 5), 'cells': [cell_check(row.crop((OMNI_CELL[0] * i, 0, OMNI_CELL[0] * (i + 1), OMNI_CELL[1]))) for i in range(len(FACES))]}
    lamp, _, _ = clean(Image.open(kit / 'brand' / 'lamp.png'))
    lamp = lamp.crop(lamp.getbbox())
    lamp.thumbnail((256, 256), Image.Resampling.LANCZOS)
    lamp.save(out / 'brand' / 'lamp.webp', quality=86, alpha_quality=90, method=6)
    report['lamp'] = list(lamp.size)
    (out / 'validation.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=1)[:3000])


if __name__ == '__main__':
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)
    main(Path(sys.argv[1]), Path(sys.argv[2]))
