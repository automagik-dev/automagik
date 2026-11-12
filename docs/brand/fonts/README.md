# Fonts

## Fredoka, the title face

| | |
| --- | --- |
| File | `fredoka-latin.woff2`: Latin and Latin Extended, the weight axis only (300 to 700), 30052 bytes |
| sha256 | `d1ceb16007127919aa1900fb85e4b5d612a4f242404a4068d43f3bc628b2aeca` |
| Licence | SIL Open Font License 1.1, in `OFL-Fredoka.txt`. Copyright 2016 The Fredoka Project Authors. The licence reserves no font name |
| Source | `ofl/fredoka/Fredoka[wdth,wght].ttf` in the Google Fonts repository (`github.com/google/fonts`), commit `2e5fa2e95123`, version 2.001 |
| Source sha256 | `2ba02e68b152868aef9ba28e24b3648c7d457fe6f25c761f2c2c53fb61a73fc8` |

The file is made from the source with `subset-font` 2.9.0 (HarfBuzz): the characters of the Latin and Latin Extended ranges that Google Fonts serves, plus the arrow block where the face has it; the width axis fixed at 100; the weight axis kept whole; written as woff2. Nothing is redrawn. The face has no arrows (→ ↓ ↗): those fall to the next family in the stack.

Keep `OFL-Fredoka.txt` beside the font wherever it is copied. The licence lets you use, embed and bundle the font; it does not let you sell the font by itself.

The site serves its own copy, `apps/landing/assets/brand/fredoka-latin.woff2`. `node apps/landing/scripts/sync-theme.mjs` makes that copy from this folder, and its `--check` fails when the two differ.
