# Logo

The triskle is Automagik's mark, and Automagik's alone. It is the owner's clay render with one clear line along the seams. Genie and Omni each have their own flat mark, a lamp and a tentacle vortex; Mykes shows as its word until its mark's file is confirmed (the README's rules 1, 9 and 10).

## The mark: `svg/` and `png/`

- **`triskle-three-colours` is the mark.** `triskle-ink` (for light grounds) and `triskle-cream` (for dark grounds) are the fallback where colour cannot be used.
- `svg/triskle-<colour>.svg`: the large drawing, from about 100px up. `-64`, `-32`, `-16`: the drawings for those sizes, with a wider line.
- `png/triskle-<colour>-1024.png` and `-512.png`: clear ground. Other sizes: `../export-png.mjs`.
- All the triskle's files share one square frame, so they line up when swapped.
- These are pictures, not single-ink shapes: CSS `color` does not change them. Pick the colour by file.

## Genie's and Omni's marks: `svg/`

Flat and one colour, approved by the owner on 12 November 2026 and confirmed on 13 November 2026. Neither carries the triskle.

- `genie-lamp-ink.svg`, `-cream.svg`: Genie's mark, a flat lamp. One drawing.
- `omni-mark-ink.svg`, `-cream.svg`: Omni's mark, a tentacle vortex: eight tapered arms from the rim, their tips curling round the open centre, with suckers as holes. For about 56px and up.
- `omni-mark-ink-32.svg`, `-cream-32.svg`: the same vortex drawn for small sizes, about 32px: no suckers, thicker tips.
- Each file is one filled shape. `-ink` is `#3c3049`, for light grounds; `-cream` is `#f3e9dd`, for dark grounds. The colour is in the file: CSS `color` does not change it. Pick the colour by file.
- No masks and no blur: any tool draws them.
- Each mark has its own frame, cut to its ink: the lamp is wide (392 by 200), the vortex is square. They do not share the triskle's square frame.
- Neither is drawn for 16px (the README's "Which logo file").

## Lockups: `lockups/`

The mark with the wordmark: the triskle for `automagik`, and their own mark for `genie` and `omni`.

- `genie-lamp-lockup-ink.svg`, `-cream.svg`: the lamp with the genie word.
- `omni-mark-lockup-ink.svg`, `-cream.svg`: the vortex with the omni word, for about 56px high and up.
- `omni-mark-lockup-ink-header.svg`, `-cream-header.svg`: the same with the vortex's small drawing, for a header and anything under about 56px high.
- They share Automagik's frame: 264 units high, the small letters 136 high on a baseline at 18, and the same space from the mark to the word. At one height the letters are the same size in all of them.
- The vortex fills the box Automagik's triskle fills. The lamp is wide and short, so it is centred on the small letters, and its foot sits a little under their baseline.
- The genie and omni words are the files in `wordmark/`, placed whole and unchanged, with their sparkle.

**The `genie-lockup-*` and `omni-lockup-*` files are RETIRED.** They carry the triskle, which is Automagik's alone. Do not use them: Genie's lockup is `genie-lamp-lockup-*` and Omni's is `omni-mark-lockup-*`. The files stay here for older work that points at them, and they are not to be changed.

The notes below are for Automagik's lockup; the retired files were built the same way, in the same frame.

- **`automagik-lockup-three-colours-ink` and `-three-colours-cream` are the lockups.** Ink letters for light grounds, cream letters for dark grounds.
- `-header`: the same with the wider seam line, for a lockup under about 56px high.
- `automagik-lockup-ink` and `-cream`: the one-colour fallback.
- The dot on the i is a sparkle in the product's colour: Automagik's is violet, Genie's is pink and Omni's is cyan. It is 60 units across where the small letters are 100 high.

## Wordmark: `wordmark/`

The name alone, in the approved round lowercase lettering, with the product's sparkle on the i. The letters are outlines; no font is needed. A product's word alone is a correct form, as Automagik's name without its mark is (the README's rule 10). Mykes shows as its word, and no file holds that word yet.

- One file per name and letter colour: `-ink` for light grounds, `-cream` for dark grounds.
- The files are as high as the lockup frame, so a wordmark and a lockup at one height have letters of one size.
- **This is the one place the lettering is drawn.** The lockups are built from these files. To change the wordmark, replace these files under the same names and rebuild the lockups.

## Where Genie's and Omni's files came from

They are we unfold's drawings, from its logo sheets `logo-family-05` (the lamp) and `logo-family-06` (the vortex, the lockups), handed over on 13 November 2026 as the package `family-marks`. Its `SHA256SUMS` file has the sha256 `f33b22b143bf88ac62c611d83ab5edcab64a7bcb184e244d319207c9f0a1ac58`, and every file was checked against it before it was copied. The package's four Mykes files (`marks/mykes-clean-*`, `lockups/mykes-clean-lockup-*`) were not copied: their drawing is not confirmed to be the approved clean forks.

Each file here is a byte copy of the package's file. Only the name changed, to this folder's naming: `-day` is `-ink`, `-night` is `-cream`, the size comes last, the small lockup is `-header`, and a lockup carries its mark's name so that it is not taken for a retired file.

| File | In the package | sha256 |
| --- | --- | --- |
| `svg/genie-lamp-ink.svg` | `marks/genie-lamp-ink.svg` | `a837a92a18fb4a319ce17b1d91e0f3f347c2feb3e8c49aaa696ea1e5154b6914` |
| `svg/genie-lamp-cream.svg` | `marks/genie-lamp-cream.svg` | `ef94842939a9219c21d1c75b6570605500e9dcb03ec133b3e9a2b527d5514724` |
| `svg/omni-mark-ink.svg` | `marks/omni-mark-ink.svg` | `3d3d701164ff71440a9d812872d792e3fe7a0059d416c89153fda82260be8470` |
| `svg/omni-mark-cream.svg` | `marks/omni-mark-cream.svg` | `b97e2e775edf3ffce1936bea85d7fc6d7512f108cc88978bc6712d9998cda674` |
| `svg/omni-mark-ink-32.svg` | `marks/omni-mark-32-ink.svg` | `d2a53a02b594c5cb40ce07a503f6b5695b8565f3de81b59fb5ec3439ddfcecac` |
| `svg/omni-mark-cream-32.svg` | `marks/omni-mark-32-cream.svg` | `9d74dc072235f4941d1534d644570a48cc3db779a31d7921bbc607bfa794fbec` |
| `lockups/genie-lamp-lockup-ink.svg` | `lockups/genie-lockup-day.svg` | `5efc6f5a6a109638a98dd69730e67361c4617f3ccdd60d79546d6712abbb9335` |
| `lockups/genie-lamp-lockup-cream.svg` | `lockups/genie-lockup-night.svg` | `3bce670e43c4293f5e2617b8f56aeebd820448a66ba88cec7686c7e4f226cc60` |
| `lockups/omni-mark-lockup-ink.svg` | `lockups/omni-lockup-day.svg` | `1103d79dc9d20c08db2a0804816b0924b5f430eb2c0c5cecefcce22043a13c4b` |
| `lockups/omni-mark-lockup-cream.svg` | `lockups/omni-lockup-night.svg` | `84fa92c2e5179ddb8809c7f9bd388982888c557a9d2a5067ae37c51c54a7426c` |
| `lockups/omni-mark-lockup-ink-header.svg` | `lockups/omni-lockup-small-day.svg` | `9ec00aa8dd301e3f1948afc4450cf0d6df138531f4afe8951e631b0eec18f665` |
| `lockups/omni-mark-lockup-cream-header.svg` | `lockups/omni-lockup-small-night.svg` | `d61327bd465e7233302dd46fa512fd5fd20b249584f777c43007ae118d6ef9c4` |

A file whose sha256 is not the one in this table was changed: put the package's file back (`scripts/brand-marks.test.ts` checks it).
