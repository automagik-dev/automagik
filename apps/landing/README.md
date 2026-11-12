# automagik.si preview

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
Pages carries exactly one Arca page, the stand-in at `/arca/` (name, one line, Get Arca, the
way back), and nothing under it; Arca's own site takes that address over later.

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
sitemap on a phone. The footer is the sitemap with the same groups (without the capture
notes). Every product page shows where it is (the header's Products button and a breadcrumb
back to all products) and links to the previous and next product. Products keep one order
everywhere; it is the `products` list in `scripts/build-pages.mjs`.

## we unfold and Open Intelligence

Automagik is part of we unfold. The link and both lines of wording are one constant,
`weUnfold` in `scripts/build-pages.mjs`: change them there and regenerate. They appear in the
footer's brand line, in the Company menu and once on the home page. The contract test holds
the rules from the we unfold team: Open Intelligence keeps both capitals and is never
shortened; we unfold is lower case in running text; "part of" means the movement, never
ownership; no logo, the text is the link. The owner approves both lines before the site
goes live.

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
close it, a link in it goes to its page). It writes full-page images and a JSON report to ignored
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

Owner's Cloudflare Pages settings: root `apps/landing`, no build, output `.`. The root must
include `functions/` for the confirmation routes to compile. Preview is unlisted and noindex
through meta and `X-Robots-Tag`; account-level access control is the owner's. No preview URL,
account ID, zone ID, database ID or key belongs in the repository. D4 removes indexing
restrictions and attaches the production domain after the owner's OK. No agent changes DNS.

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
`Allow: /`, and explicit `Allow: /arca`. This crawling rule does not remove preview noindex
headers/meta; production becomes indexable only after the owner's preview OK.

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
