# Art and fonts on the Automagik ID pages

Everything the sign-in and allow-access pages show is served from this folder. Nothing is
loaded from another origin.

- `wordmark.webp`: the Automagik wordmark, copied unchanged from
  `apps/bots-dsh/src/client/art/wordmark.webp`. Apache-2.0, Namastex Labs and the Automagik
  contributors.
- `pet.webp`: the Automagik pet. Six rows of the app's own sprite sheet
  (`apps/bots-dsh/src/host/pets/automagik/spritesheet.webp`), cropped, never redrawn: idle,
  waving, jumping, failed, waiting and running (rows 0, 3, 4, 5, 6 and 7; each cell is
  192 x 208). Apache-2.0; the Bots' art carries the DS Bot and Automagik notices of
  `apps/bots-dsh/NOTICE`.
- `icon.png`: the Automagik app icon, `apps/desktop/assets/icon.png` scaled to 192 x 192.
  Apache-2.0.
- `manrope-latin.woff2`: Manrope, Copyright 2018 The Manrope Project Authors. SIL Open Font
  License 1.1, in `OFL-Manrope.txt`.
- `dm-sans-latin.woff2`: DM Sans, Copyright 2014 The DM Sans Project Authors. SIL Open Font
  License 1.1, in `OFL-DMSans.txt`.

The fonts and their licence texts are copied unchanged from
`apps/bots-dsh/src/client/art/fonts/`.

The pet sheet is built with ffmpeg (libwebp, quality 84): each row is a 1536 x 208 crop of
the source at y = 0, 624, 832, 1040, 1248 and 1456, stacked top to bottom in that order.
