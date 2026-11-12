# automagik.si

RFC 0027, revised by the owner on 2026-11-11: the umbrella home plus Desktop, Mobile,
Omni, Genie, Cloud and Mykes pages, plus one stand-in page for Arca until Arca's own site is
served at `/arca/`. The app's current default Stage theme supplies
the colours, type and component treatment. Every product screen is a provenance-backed
capture; brand/font licences are in `assets/brand/LICENSES.md`.

Each block has its own visual: the home's stage with Genie and Omni behind the real app's
window; a bento of blocks (the app's review view, Pocket on a phone, the octopus, Genie on
plum, Cloud on the stage); the real Pocket app in its own preview; the three-step wish flow
from real captures. Light and dark both follow the visitor's system, and every app picture
has a dark capture of the same view for the dark theme. Pages show WebP art from `assets/art/`, built at 1x and 2x
by `scripts/build-art.mjs` from Automagik's own art and crops of the captures, each recorded
with its source digest in `assets/art/manifest.json`.

The committed HTML needs no Pages build step and contains no client JavaScript. The home
has one small film slot: a real still with one quiet line until the film exists. Cloud is coming soon and carries intent, consent and removal
forms, with email or inbound-first WhatsApp confirmation. No launch or marketing email.
The meter is not a product or page. Herdr and DSH are Desktop installation channels.
Pages carries exactly one Arca page, the stand-in at `/arca/` (name, one line, Get Arca as
the install command to copy, the way back), and nothing under it; Arca's own site takes that
address over later. The installer's address answers with a shell script, so no link points
at it; Get Arca on the home page and in the menus opens `/arca/`.

## Navigation

It is a website, not one landing page. The header has three menus (Products, Resources,
Company); each entry has a one-line description and its character, mark or glyph. With no
client JavaScript, each menu button opens its panel through the browser's popover: click,
Enter or Space open it, Escape or a click outside close it and return the focus, and the
browser keeps the button's expanded state for assistive technology (so the HTML carries no
`aria-expanded` of its own). Hover opens the same panel in CSS, in the same place. Below
860 px one Menu button opens a sheet under the header with the same three groups; while it
is open the page behind it is hidden from the keyboard and from assistive technology. A
browser without popovers opens the panels on hover or focus and gets a link to the footer's
sitemap on a phone. The footer is the sitemap with the same groups. Every product page shows where it is (the header's Products button and a breadcrumb
back to all products) and links to the previous and next product. Products keep one order
everywhere; it is the `products` list in `scripts/build-pages.mjs`.

## we unfold and Open Intelligence

Automagik is part of we unfold. The link and both lines of wording are one constant,
`weUnfold` in `scripts/build-pages.mjs`: change them there and regenerate. They appear in the
Company menu, once on the home page and once in every footer.

Open Intelligence is applied the way Arca's site applies it. The only mark is we unfold's
horizontal tag, `assets/brand/open-intelligence/open-intelligence-tag.svg`, pasted inline as
given (one colour, the text colour around it; its words are live text in IBM Plex Mono
SemiBold, which `styles.css` loads). No round seal anywhere. In every footer the tag is 170
by 32 px, in the footer's text colour, at the right end of the last row (under it, at the
left, on a phone), and it is a link to we unfold that holds nothing but the tag: no words
in the link, no sentence beside it. The tag is never bigger than the logo it sits with, so
the footer's triskle is never under 34 px tall (its word alone then passes 170 px). Never
redraw, stretch, outline, shadow or recolour the tag; its words never change; it never stands in the header,
a hero, the favicon or a share picture. The tag is we unfold's mark: it is not under this
site's Apache-2.0 grant, and nothing here calls it open-licensed.

The official Automagik lockup is the logo with the tag under it, right edges together, the
tag 62% of the logo's width (Arca's proportion): `assets/brand/automagik/` holds it as SVG
and as PNG at 3000 px wide, in ink for light grounds and cream for dark ones.
`node apps/landing/scripts/build-lockup.mjs --png` rebuilds the files from the logo, the tag
and the font. The home page shows it once, in its brand block. Arca's own lockup files are
not cleared for a public repository and are never committed here. The contract test holds
the rules from the we unfold team: Open Intelligence keeps both capitals and is never
shortened; we unfold is lower case in running text; "part of" means the movement, never
ownership; in a sentence the text is the link. The owner approves both lines before the site
goes live.

## Links out

Guides and help link to the docs site, `https://docs.automagik.dev`, with no deep paths
while that site is being redone. GitHub is linked for the downloads and once, quietly, at
the end of the footer. No page links to an RFC or to the capture notes; both stay in the
repository. The projects row on the home links each of its eleven projects to that
project's own site (the list is `used` in `scripts/build-pages.mjs`).

## The projects row

The home shows one row, "Things that made our stack possible", between the hero and the blocks:
DeepSeek Harness, Herdr, Agent Client Protocol, Model Context Protocol, A2A, Hermes Agent, Oh My
Pi, Pi, NATS, iroh and Better Auth, in that order (`used` in `scripts/build-pages.mjs`). It is a
credit: no ranking, and no partnership, sponsorship or endorsement wording.

- One type system: each project's own standalone mark, an unchanged copy of its official file,
  and the name in this site's type. iroh publishes only a wordmark, so that is its item. Marks
  keep their own colours and are drawn at one optical height, never taller than the site's
  own name in the header; a project's dark file is used on a dark page.
- Each item links to the project's own site, in the same tab, and nowhere else.
- One line of credit under the row; the trademark sentence is in the footer's legal line on
  every page, and NATS™ is in its mark's alt text.
- The row drifts only for a visitor who allows motion (slower on a phone, so every name is
  whole on screen as it passes), stops under the pointer, and is the still, wrapped list with
  reduced motion or with the keyboard in it. The second copy of the list only fills the gap
  while it drifts and is out of reach of the keyboard and of assistive technology.
- `assets/brand/LICENSES.md` lists every file's source, the rule read and its SHA-256, and the
  standing rule: if a project's owner asks, its logo comes down the same day.

## The logo and the browser's icons

The logo is Automagik's logo kit, the approved set: the triskle in three colours with its
seam line, and the lowercase wordmark. The triskle is always shown in colour. Its files are
copied unchanged, and `LICENSES.md` pins each one's SHA-256 (`landing.test.mjs` checks them).

- Header and footer, and the Cloud form's answer pages (`waitlist/lib/ui.js`): the kit's
  lockup for small sizes, `assets/brand/automagik-lockup-three-colours-ink-header.svg`
  (ink letters) on the light page and `-cream-header.svg` (cream letters) on the dark one.
  `styles.css` sizes it by the triskle's height (`--mark`): the file is 264 tall where the
  triskle is 222, and the g's tail hangs under the triskle. The triskle is 32 px tall in the
  header (26 on a phone, 23 under 360 px) and 40 px in the footer (34 on a phone).
- The official lockup with the tag (above) is built from the kit's large lockup.
- The triskle alone (the Mykes entry in the menus, the Cloud and Mykes heroes) is the kit's
  drawing for the size shown: `triskle-three-colours-32.svg` in a menu,
  `triskle-three-colours.svg` from about 100 px up.
- The browser's icons are the kit's favicon set at the site's root, all in three colours:
  `favicon.ico` (16, 32 and 48 px), `favicon.svg` (the drawing for small sizes),
  `apple-touch-icon.png`, and `icon-192.png` and `icon-512.png` (the mark on the ink
  ground) named by `site.webmanifest`.

Never recolour, stretch or redraw a kit file, and never set the word in type. The gradient
capitals and the old clay triskle without its seam line are retired; their files are gone.
A newer kit (a changed wordmark, say) is a file swap: copy its files to the same paths and
put their digests in `LICENSES.md`; no page, style or test names what the files draw.

## Arca's logo

Wherever Arca stands (the two menus, the home card, the heading of `/arca/`) the pages carry
Arca's own icon from Arca's logo kit: `assets/brand/arca/svg/arca-icon-ink.svg` and
`arca-icon-ivory.svg`, copied unchanged under the kit's own names. A newer kit replaces the
files at the same paths; never edit a copy. Ink on Arca's sand ground in light, ivory on its
night ground in dark. Arca's rules hold here: one colour, never redrawn or tinted, never
animated by this site, never locked up with the Open Intelligence tag, no tagline locked to it,
and the small cut for any size under 24 px (no place here is that small). Name any retina
file `name-2x`, since the privacy check reads the usual at-sign form as an address.

## Motion

Motion is CSS only and sits in one block of `styles.css`, for visitors who have not asked
for reduced motion: sections and cards rise as they scroll into view, a card's picture
moves a little within it, the home's cast pops up and peeks higher as the page leaves,
pages cross-fade with a character
travelling to its own page, and the menus ease in. It moves only `translate`, `scale`,
`rotate`, `transform` and `opacity`, so the layout never shifts. With reduced motion, or in
a browser without scroll-driven animation, the page is whole and still.

## Source and checks

Edit public page copy in `scripts/build-pages.mjs`; shared Cloud form/response copy in
`waitlist/lib/ui.js`; layout/components in `styles.css`. `theme.css` derives directly from
`apps/bots-dsh/src/client/stage.js`. Regenerate and commit the HTML and CSS:

```sh
node apps/landing/scripts/sync-theme.mjs
node apps/landing/scripts/build-art.mjs   # only after an art or capture change; needs ffmpeg with libwebp
node apps/landing/scripts/build-pages.mjs
bun install --frozen-lockfile --ignore-scripts
node --test apps/landing/landing.test.mjs apps/landing/waitlist.test.mjs
LANDING_CHROME=/path/to/chrome node apps/landing/verify-browser.mjs
node herdr/scripts/privacy-check.mjs
```

The browser gate checks all pages at 1440, 1024, 390 and 320 px, light and dark. It checks
that no heading word breaks across lines, every image is sized, the film still stays smaller
than the page's main picture and keyboard focus shows. It checks that a dark page shows
the dark captures (and a light page the light ones), that the home's speech bubble stays
off the app window, and that the hero's app capture is shown near its real size. It checks
images/fonts, overflow, failed/external loads and native form 503/200 responses against an
isolated SQLite fixture. It drives the menus with real clicks and keys in both themes: open
and close by click, Enter and Space, Escape with the focus returning to the button, the
expanded state in the accessibility tree, hover in the same place as click, one panel at a
time, the active page, every menu and footer link answering, and the phone sheet (it fills
the screen under the header, the keyboard never lands behind it, Escape and the Menu button
close it, a link in it goes to its page). Every page run is in reduced motion and checks
that no animation runs and the browser's layout-shift score is 0. A separate run with
motion scrolls every page top to bottom at 1440 and 390: something moves, the layout-shift
score stays 0, nothing widens the page, everything that rises ends fully shown down to the
last section, the page-to-page transition runs to its end and the menu's entrance settles.
It writes full-page images and a JSON report to ignored
`.cache/landing-evidence/`; set `LANDING_EVIDENCE` to another absolute report directory.
At 1440 and 390 it also renders equal-width side-by-side site/app comparisons in each theme.
The `landing` CI job runs the same gates and retains the images/report as an artifact.
No real confirmation is sent by a test. Resend is mocked; WhatsApp rendering/callbacks
make no third-party request. The live account integration is an owner check.

`assets/screens/manifest.json` and `assets/CAPTURES.md` record each capture. New Stage
reference shots come from `capture/theme.mjs --run`, a fresh isolated DSH profile without
an AI model or live chat. Set `LANDING_CHROME` to an installed matching Chrome/headless-shell
binary; install the declared Bot harness/dependencies and the desktop runtime's pinned
pnpm first. The app screens come from `capture/capture.mjs --run` (the Northwind scenario,
each view in light and dark; `LANDING_FIXTURE_BASE` names a scratch folder other than
`/tmp`). The Pocket
screens come from `capture/pocket/PocketDemoShotsTest.kt`, run in a scratch copy of Pocket
(steps in `assets/CAPTURES.md`), never inside `apps/pocket`.

## Downloads and hosting

Desktop uses the repository's release aliases. Mobile links directly to the APK named by
Pocket's rolling release manifest. Its verified URL/digest/date are in `assets/releases.json`;
refresh from that manifest before publishing. Windows and iPhone are soon text without links.

### The download hook

The home's hero has one action: a tray of platforms (`getHook` in `scripts/build-pages.mjs`,
from the one `platforms` table). The Desktop and Mobile pages open with the same tray for
their own platforms. Mac, Linux and Android are live: each is a button that opens that
platform's sheet through the browser's popover, with no script. Windows and iPhone say Soon
and are labels: not a link, not a button, and no file is named for them. A platform moves
from soon to live in `platforms`, with a real file, and never before that file exists.

A sheet says what you get, the exact file, what it needs, how to install it, and carries one
download button for that file and one link to the platform's guide on the docs site. On the
home it also links to the product's page. In a wide window the sheet sits in the middle; on
a phone it rises from the bottom edge and the page behind it does not scroll. The page behind
an open sheet is inert, Escape or the close button shuts it and the focus goes back to the
platform. A browser without popovers gets plain links in the tray instead: to the product
page from the home, to the file from a product page.

Herdr and DSH are two short entries on the Desktop page, each with one link to its guide.
The guide links (`guide` in `scripts/build-pages.mjs`) all point at the docs front page
until the docs site has a page for each; a link moves to its page only once that page is
live, and `landing.test.mjs` lists every destination a page may link to.

Owner's Cloudflare Pages settings: root `apps/landing`, no build, output `.`. The root must
include `functions/` for the confirmation routes to compile. The production site is indexable
(the owner's OK, 2026-11-12): the pages carry no robots meta and `_headers` sends no
`X-Robots-Tag`. Previews stay out of search through Cloudflare Pages' own preview header, not
through anything here; the waitlist API's responses keep their own noindex. Account-level
access control is the owner's. No preview URL, account ID, zone ID, database ID or key belongs
in the repository. No agent changes DNS.

See [waitlist setup](waitlist/README.md) for the exact binding, secrets, plain variables,
schema, EU jurisdiction, Resend sender and the v2 event-envelope contract called by our
cx Support Bot using `WAITLIST_CONFIRM_SECRET`. Missing
configuration fails closed with 503. Preview and production databases/credentials are separate.

## Developer entry points

The old developer landing commands live here:

```sh
curl -fsSL https://raw.githubusercontent.com/automagik-si/genie/main/install.sh | bash
genie desktop
```

The Genie CLI supports Linux x64/arm64 and Apple silicon Macs. `genie desktop` needs Linux
x64 or an Apple silicon Mac; there is no Linux arm64 desktop build. It downloads the matching
Automagik release and checks SHA256SUMS. On Mac, drag the app into Applications. Bring an AI
account or API key; provider terms apply. Code mode needs Herdr and the Automagik pack separately.

## Discovery and Arca routing

`robots.txt`, `sitemap.xml` and `llms.txt` live at this Pages root and are generated with the
HTML. The owner allows all crawlers, including AI training crawlers: `User-agent: *`,
`Allow: /`, and explicit `Allow: /arca`. Search engines and AI crawlers may index every page.

The root sitemap and assistant index include Arca's supplied lines verbatim. The home card,
the Products menu and the footer link to `/arca/` in the same tab. Until Arca's own site is
deployed, Pages serves the one stand-in page there. For Arca's site, the owner configures Worker routes **exactly**
`automagik.si/arca` and `automagik.si/arca/*`. A zone Single Redirect matches hostname equal
to `automagik.si` AND URI path equal to `/arca`, returning 301 to
`https://automagik.si/arca/` with the query preserved. Do not match the path alone:
`arca.automagik.si` is the Arca dashboard. `/arcade` and other paths stay with Pages.
No Worker route, redirect or account setting is changed by this source update.

## WhatsApp timing

WhatsApp remains visible beside email. The form warns in English and Portuguese that
confirmation may take a little while. Our support Bot sends the v2 envelope with the original
message receive time in top-level `timestamp` (Unix milliseconds). The callback accepts a
message received at or before the code's 30-minute expiry, even if processed days later.
More than two minutes ahead of processing time is 400; missing/invalid receive time is 400.
Processing more than 180 days after expiry is 404, including retries after that backlog limit.
Pending WhatsApp rows survive cleanup until that limit; email expiry is unchanged. Single
use, message-ID idempotency and every no-text/no-logging rule remain in force.

The owner-approved Support on WhatsApp section is included verbatim in English, with the
same meaning in Portuguese. Its approved source and translation are in `waitlist/privacy-support.*.md`.


The public-copy contract rejects internal delivery labels and product-team jargon in all
HTML, including image alt text. Browser evidence records each hero headline's box and text
rectangles against its card's padded content bounds, in addition to document overflow.
WhatsApp backlog expiry compares processing and receive times in milliseconds in both the
JavaScript guards and the SQL single-use update. The exact deadline is accepted; deadline
plus one millisecond is rejected on first use and replay.
