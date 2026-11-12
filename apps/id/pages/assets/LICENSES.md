# Art and fonts on the Automagik ID pages

Everything the sign-in and allow-access pages show is served from this folder. Nothing is
loaded from another origin.

- The logo: Automagik's approved logo set of 2026-11-12, the lockup for small sizes (the
  triskle in three colours with its seam line, and the lowercase wordmark), copied unchanged
  under the set's file names: ink letters for the light page, cream letters for the dark
  one. Never recolour, stretch or redraw these files; a newer set replaces them at the same
  paths, with new digests here. The old capitals wordmark is retired and its file is gone.
  Apache-2.0, Namastex Labs and the Automagik contributors.

| File | In the set | SHA-256 |
| --- | --- | --- |
| `automagik-lockup-three-colours-ink-header.svg` | `lockups/svg/automagik-lockup-three-colours-ink-header.svg` | `4d0f87696e31e5f889e2e60d98c7814d515a85f2f60918f4bd999f298338af2f` |
| `automagik-lockup-three-colours-cream-header.svg` | `lockups/svg/automagik-lockup-three-colours-cream-header.svg` | `e8dd0d21e42d7b2722386738972d46432f083895fb2bf00a990ee7588d3561f7` |

- `genie-faces.webp` and `omni-faces.webp`: Genie and Omni, the two hosts of these pages.
  Genie is the approved clay figure, whole body, in seven poses; Omni is seven faces. Copied
  unchanged from `apps/bots-dsh/src/client/art/genie-expressions.webp` (the approved strip,
  SHA-256 `9df7083cca4a14afc804875b87d9f9cdd18c032f725084f2424434e502bac926`; its record is
  `apps/bots-dsh/dev/art/genie-approved-v5`) and
  `apps/bots-dsh/src/client/art/omni-expressions.webp`: seven cells side by side in each
  (Genie's are 192 x 208, Omni's 192 x 192). The pages show one cell at a time and never
  redraw them. The earlier head-only Genie is retired and no file of it is left here.
  Apache-2.0, Namastex Labs and the Automagik contributors.
- `icon.png`: the Automagik app icon, `apps/desktop/assets/icon.png` scaled to 192 x 192.
  Apache-2.0.
- `manrope-latin.woff2`: Manrope, Copyright 2018 The Manrope Project Authors. SIL Open Font
  License 1.1, in `OFL-Manrope.txt`.
- `dm-sans-latin.woff2`: DM Sans, Copyright 2014 The DM Sans Project Authors. SIL Open Font
  License 1.1, in `OFL-DMSans.txt`.

The fonts and their licence texts are copied unchanged from
`apps/bots-dsh/src/client/art/fonts/`.
