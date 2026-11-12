# The family drawer: where these files come from

Every file in this folder is a byte copy from one package: **the menu drawer and its button,
issue 11** ("the right names in the drawer"), written by Arca's designer on 2026-11-12 and
approved by the owner that day ("thats better now, approved. coming soon under mykes").

- The package's own `SHA256SUMS` has the sha256
  `6dcfbe6f8e6d0737019320ddb883cb85986abe738a68c726b2104f816844bad8`.
- Nothing here is edited. A change is asked of the piece's author and arrives as a new issue:
  replace the files, put the new digests in this table and in `landing.test.mjs`.
- `scripts/build-pages.mjs` reads `family.html` and `header-button.html` and writes the
  drawer into every page: comments left out, slots filled, this site's own parts put in the
  places the piece gives a host. `styles.css` holds the host's side of the styling.

| File here | File in the package | sha256 |
| --- | --- | --- |
| `family.html` | `piece/family.html` | `7b0c8e6e8185adad7dfe7bfb8384899e72bc631f7b92c8994966df4398b0c896` |
| `header-button.html` | `piece/header-button.html` | `3d502e338a526ce541f3cef809cd0f33d233f660897294bab9c670260ae9eefe` |
| `family.css` | `piece/family.css` | `9286240cf0d9ca19c3d71c3404c4d40e63cea2a4853c88b0aa02572a94428248` |
| `family.js` | `piece/family.js` | `0cb848a240aba32650c0b95813415f2238ca5a2ab4bd2dfd654f00c2c2bc980d` |
| `automagik-lockup-three-colours-cream-48.png` | `art/automagik-lockup-three-colours-cream-48.png` | `5518af46313bc1678c77f382b85476638fe15dd99e4dbf275e6e21403bc36b37` |
| `automagik-lockup-three-colours-cream-64.png` | `art/automagik-lockup-three-colours-cream-64.png` | `f4a31554d492a201bd123ad149930b24a3a2f4ccb5ba514d522a652d048d26ef` |
| `automagik-lockup-three-colours-cream-128.png` | `art/automagik-lockup-three-colours-cream-128.png` | `f1113affc7f486217330d7ebc4fbce0c9538d63f84ddea88c40680ec79a87e9a` |
| `automagik-lockup-three-colours-ink-48.png` | `art/automagik-lockup-three-colours-ink-48.png` | `b7f32743404095a1b50e56539dd08be79564db5ace2342a0e2f9375e8162ceaa` |
| `automagik-lockup-three-colours-ink-64.png` | `art/automagik-lockup-three-colours-ink-64.png` | `4a4313b88432dc3187c86cb6b64fe00ebd565a172b243b83fd5fa3a4bf337b19` |
| `automagik-lockup-three-colours-ink-128.png` | `art/automagik-lockup-three-colours-ink-128.png` | `89a274a63cf3812a4ff2ecf832204e33236444118c06ece93d5766b58d595380` |
| `omni-wordmark-cream.svg` | `art/omni-wordmark-cream.svg` | `e930250e3797750d6ad118b8a5f7639e2604db3a78d68645666177f69191b5d2` |
| `omni-wordmark-ink.svg` | `art/omni-wordmark-ink.svg` | `e8c21842b9c280fddacfbf20e8ce998a1ea4be5069b47a43002ebf7db40e8e37` |
| `genie-wordmark-cream.svg` | `art/genie-wordmark-cream.svg` | `4bf79674edd489de7172b76b48d64982cbd973e56679a9575d560044b9b8a317` |
| `genie-wordmark-ink.svg` | `art/genie-wordmark-ink.svg` | `481008dcd0b1281308e22474cebef71a20f78b247e51095896bebec9561d647d` |
| `mykes-wordmark-cream.svg` | `art/mykes-word-night.svg` | `9099d9566ebee75e3cc683987f5b69bfc8c1c41873871f5415654a1efbc12752` |
| `mykes-wordmark-ink.svg` | `art/mykes-word-day.svg` | `28c80ac26bea923146094869fafe032a9397d85c4fd0ad6432a885ceb24219dc` |

## The words

- `omni-wordmark-*.svg` and `genie-wordmark-*.svg` are the same bytes as
  `docs/brand/logo/wordmark/` in this repository.
- `mykes-wordmark-*.svg` is the word "mykes" in the same lettering, the file we unfold's live
  deck uses, handed over through the package. Only the two Mykes files are named differently
  here: `-cream` (cream letters, for a dark ground) is the package's `mykes-word-night.svg`,
  and `-ink` (ink letters, for a light ground) is its `mykes-word-day.svg`. The same two files
  are in `docs/brand/logo/wordmark/` under these names.
- No mark is approved for Omni, Genie or Mykes: each shows its word alone. The triskle stands
  in Automagik's lockup and nowhere else in the drawer. The Genie and Omni lockups, which
  carry the triskle, are not used here.

## Not taken from the package

- `piece/family-bar-values.css`: Arca's own four colours.
- `art/arca-logo-a.svg` and `art/arca-logo-b.svg`: Arca's logo for Arca's own top block.
- `shots/` and the package's `README.md`.
