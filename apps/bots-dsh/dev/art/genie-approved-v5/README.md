# Genie: the approved figure

Genie is one figure: the full-body clay Genie the owner approved on 2026-10-25 (arms open, a
tail filled with a starry sky), delivered as `genie-approved-v5`. Every Genie in the app comes
from that delivery. The head-only Genie from the clay kit (the `genie-pet-v1` atlas and its
faces) is retired and no longer in the repository.

## What is kept, and where

The delivery's files are kept byte for byte. `SOURCE.json` records each one's path here, its
name in the delivery and its SHA-256 (the delivery's own `SHA256.json` lists the same digests):

| In the repository | In the delivery | What it is |
|---|---|---|
| `dev/art/genie-approved-v5/approved-genie.png` | `approved-genie.png` | The figure: 1254 px, transparent |
| `src/host/pets/genie-clay/spritesheet.webp` | `dsh/spritesheet.webp` | The pet: a Codex v2 atlas, 1536×2288, 8×11 cells of 192×208, lossless |
| `src/host/pets/genie-clay/sleep.webp` | `dsh/sleep.webp` | Its sleep strip: six cells, 1152×208 |
| `dev/art/genie-approved-v5/state-map.json` | `dsh/pet.json` | The delivery's rows, frame counts and state map, for reference |

The pet keeps the id teams already store, `genie-clay`; only its atlas changed, from v1 (nine
rows) to v2 (eleven: the last two are the sixteen directions it looks in). A Bot that kept
`genie-clay` with the old version is read as the Genie shipped now (`src/host/pets.js`
`shippedPet`, `src/client/mark.js` `servedPet`).

## What is built from it

`build.py` makes two pictures from those files and nothing else. Nothing is drawn: each is the
delivery's own pixels, cropped or scaled.

```sh
uv run --no-project --with 'Pillow==11.3.0' python -I dev/art/genie-approved-v5/build.py           # writes
uv run --no-project --with 'Pillow==11.3.0' python -I dev/art/genie-approved-v5/build.py --check   # compares pixels
```

- `src/client/art/genie-expressions.webp` (copied to `apps/welcome-dsh/src/client/vendor/art`):
  the seven faces the marks and the welcome show, one row of 192×208 cells, lossless. Each
  face is one frame of the atlas:

  | Face | Frame | Shown for |
  |---|---|---|
  | calm | idle, frame 0 | idle, work handed on |
  | pleased | waving, frame 2 | a poke, a pointer over an idle mark |
  | delighted | jumping, frame 2 (the peak) | the settle after a run, ready |
  | focused | running (active work), frame 0 | every kind of work |
  | curious | waiting, frame 0 | a question or an approval waits for the person |
  | asleep | sleep strip, frame 0 | asleep, powered off |
  | sad | failed, frame 0 | a failed turn |

  The cells are the atlas's, whole. The jump's peak is the one exception: the atlas draws it
  smaller and high in its cell to leave room for the hop, so as a still it is scaled by 1.15
  (Lanczos, premultiplied alpha) and stood on the idle floor.
- `apps/desktop/assets/dmg-source/genie.png`: the figure on a 1024 px transparent square, for
  the Mac install window (`apps/desktop/assets/dmg-source/background.svg`).

`build.py` writes each output's SHA-256 into `SOURCE.json`; `test/genie-art.test.js` holds
every source and output to it, and the atlas, the strip and the faces to their sizes. After a
change to the faces, run `node scripts/inline-art.mjs` and `node scripts/build-client.mjs` in
`apps/bots-dsh` and `apps/welcome-dsh`, and `node apps/landing/scripts/build-art.mjs` (the
site crops these files).

## States

The player (`src/client/pet.js`) plays the delivery's map: idle is the idle row; thinking,
working, sending and orbit run; searching reviews; work handed on waits as a quiet idle; an
alert is the waiting row; done jumps once; a poke waves once; failed is the sad row; asleep is
the sleep strip. Reduced motion shows one frame.
