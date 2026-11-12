# The family drawer: where these files come from

Every file in this folder is a byte copy from one package: **the menu drawer and its button,
issue 11c**, written by Arca's designer on 2026-11-12. Issue 11 ("the right names in the
drawer") was approved by the owner that day ("thats better now, approved. coming soon under
mykes"). Issues 11b and 11c are the same piece with answers added, asked from this site: what
the drawer holds when the host is Automagik, who the host is on a page, and which Arca logo
another site uses (all below).

- The package's own `SHA256SUMS` has the sha256
  `d6bad6bedcad6009aac2b8b91275e1bc93d00496712af3de4d7cadfdf150fb52`.
- Issue 11's list had `6dcfbe6f8e6d0737019320ddb883cb85986abe738a68c726b2104f816844bad8` and
  issue 11b's `61c4b94c8ce6c9b21a37ac2c751a2977b57f18c7e7b4172dd86ed9c86f39c8cf`. Across the
  three issues only the package's `README.md`, its `SHA256SUMS` and one new picture
  (`shots/case-host-is-automagik.jpg`) changed: every file taken here has the same digest in
  all three.
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
| `arca-logo-b.svg` | `art/arca-logo-b.svg` | `ea2cfc8b60be3fe0b064e11b6238b290a1545a654e8fe44a190ebc0a623db116` |

## The host is Automagik (issue 11b, "A case of its own")

On Automagik's own pages the "You are here" block and the Automagik row would both show the
Automagik lockup, one under the other. The package's rule, which the builder follows:

- **Automagik appears once**, as the "You are here" block: its lockup (the Automagik row's own
  pictures and classes, inside `.fam-logo`), its line, "You are here".
- **The Automagik row (`.fam-top`) is not in the page.**
- **Desktop and Mobile (`.fam-apps`) stand in that block**, right under the link and above the
  list of pages.
- **Products lists Arca first**, by its own logo: `arca-logo-b.svg`, the ark with its word,
  inline in a `.fam-logo` inside a row with the class `is-logo`; then omni, genie, mykes.
- **Two style rules for this case are in the package's README, not in `family.css`**, for the
  host to add. They are in `styles.css`, word for word:

  ```css
  .fam-here-block .fam-apps { padding: var(--space-8) var(--space-13) 0; }
  .fam-item.is-logo .fam-words > span:last-child { padding-left: calc(var(--lock) * 321.34 / 264); }
  ```

**Who the host is (issue 11c): whoever's logo stands in that page's header.** Every page of
this site wears Automagik's header, the product pages and the stand-in `/arca/` included, so
Automagik is the host on all of them and each product stays a row in Products. A product
moves to the top block only on a page in its own world, with its own logo in the header.

**Which Arca logo (issue 11c): the ark.** Arca's logo is the ark with "arca", in one colour
(it takes the text colour and is never coloured): `arca-logo-b.svg`. The arch is Arca's
earlier logo, and no other site should use it. So the same file is also the heading of this
site's stand-in page for Arca (`arcaLogo` in `scripts/build-pages.mjs`).

The package's picture of this case is a mock on Arca's draft page; its line and section names
are stand-ins. The line here is this site's own ("Open building blocks of
superintelligence."), and the list holds this site's pages with no row of their own.

## The words

- `omni-wordmark-*.svg` and `genie-wordmark-*.svg` are the same bytes as
  `docs/brand/logo/wordmark/` in this repository.
- `mykes-wordmark-*.svg` is the word "mykes" in the same lettering, the file we unfold's live
  deck uses, handed over through the package. Only the two Mykes files are named differently
  here: `-cream` (cream letters, for a dark ground) is the package's `mykes-word-night.svg`,
  and `-ink` (ink letters, for a light ground) is its `mykes-word-day.svg`. The same two files
  are in `docs/brand/logo/wordmark/` under these names.
- No mark is approved for Omni, Genie or Mykes: each shows its word alone. The triskle stands
  in Automagik's lockup and nowhere else in the drawer. Arca's logo is Arca's own: the ark.
  The Genie and Omni lockups, which carry the triskle, are not used here.

## Not taken from the package

- `piece/family-bar-values.css`: Arca's own four colours.
- `art/arca-logo-a.svg`: Arca's other logo, for Arca's own page A.
- `shots/` and the package's `README.md`.
