# Pets

Automagik's Bot avatars are pets in the Codex pet format, the one Codex keeps in
`~/.codex/pets` and [codex-pets.net](https://codex-pets.net) shares: a folder with a
`pet.json` and a `spritesheet.webp` atlas of 192×208 cells, eight to a row. `FORMAT.md` is
the adoption contract (rows, frame counts, look directions, and how a Bot's states map to
rows). New pets are v2 (1536×2288, eleven rows); v1 (1536×1872) still plays.

Where pets come from in the app:

- **Automagik's own**, shipped with the plugin in `src/host/pets`: Genie (`genie-cosmic`, from
  the approved Genie v5 delivery), the Automagik logo, Unfold and Wisp. All but Wisp carry the
  sleep strip Automagik adds (`sleep.webp`, six cells); Wisp sleeps as a slow idle.
- **The team's**, in `<team home>/pets`: picked from codex-pets.net in the avatar editor's
  Pets tab, or copied from Codex's own folder. A Bot never needs the network to wear one.
- **The character catalogue**, baked in the browser from the same art the marks draw
  (`src/client/pet-bake.js`), in each Bot's own color.

`src/client/pet.js` plays them all. The host side (listing, codex-pets.net, the sheet route,
writing a Bot's look into Codex's folder) is `src/host/pets.js`.

## Baking the catalogue

```sh
node dev/pets/bake-catalogue.mjs <out-dir> [--color <ink>] [--only shape,shape]
```

It writes one Codex package per character (and Omni in clay), each ready for
`~/.codex/pets`, and checks every atlas with the toolkit's validator through `uv` and
Pillow.

## Making a new pet

`skills/hatch-pet` is the production and QA harness for drawn pets: prompts and layout guides,
pose extraction, atlas composition, direction checks, chroma cleanup, contact sheets and
previews. It generates art through `skills/imagegen`. Both are copied unchanged from the pet
toolkit export of 2026-10-25, under their Apache-2.0 licenses (`LICENSE.txt` in each).
Their scripts need Python 3.10+ and Pillow:

```sh
uv run --no-project --with 'Pillow>=10' python -I skills/hatch-pet/scripts/validate_atlas.py <spritesheet.webp>
uv run --no-project --with 'Pillow>=10' python -I skills/hatch-pet/scripts/make_contact_sheet.py <spritesheet.webp> --output contact.png
(cd skills/hatch-pet && uv run --no-project --with 'Pillow>=10' python -m unittest discover -s tests)
```

The toolkit's ChatGPT Work Pets snapshot is not here: it came without a license.
