# automagik.si preview

RFC 0027, revised by the owner on 2026-11-11: the umbrella home plus Desktop, Mobile,
Omni, Genie, Cloud, Arca and Mykes pages. The app's current default Stage theme supplies
the colours, type and component treatment. Every product screen is a provenance-backed
capture; brand/font licences are in `assets/brand/LICENSES.md`.

The committed HTML needs no Pages build step and contains no client JavaScript. The home
has one labelled D2 film slot. Cloud is coming soon and carries intent, consent and removal
forms, with email or inbound-first WhatsApp confirmation. No launch or marketing email.
The meter is not a product or page. Herdr and DSH are Desktop installation channels.

## Source and checks

Edit public page copy in `scripts/build-pages.mjs`; shared Cloud form/response copy in
`waitlist/lib/ui.js`; layout/components in `styles.css`. `theme.css` derives directly from
`apps/bots-dsh/src/client/stage.js`. Regenerate and commit the HTML and CSS:

```sh
node apps/landing/scripts/sync-theme.mjs
node apps/landing/scripts/build-pages.mjs
bun install --frozen-lockfile --ignore-scripts
node --test apps/landing/landing.test.mjs apps/landing/waitlist.test.mjs
LANDING_CHROME=/path/to/chrome node apps/landing/verify-browser.mjs
node herdr/scripts/privacy-check.mjs
```

The browser gate checks all pages at 1440, 1024, 390 and 320 px, light and dark. It checks
images/fonts, overflow, failed/external loads and native form 503/200 responses against an
isolated SQLite fixture. It writes full-page images and a JSON report to ignored
`.cache/landing-evidence/`; set `LANDING_EVIDENCE` to another absolute report directory.
At 1440 and 390 it also renders equal-width side-by-side site/app comparisons in each theme.
The `landing` CI job runs the same gates and retains the images/report as an artifact.
No real confirmation is sent by a test. Resend is mocked; WhatsApp rendering/callbacks
make no third-party request. The live account integration is an owner check.

`assets/screens/manifest.json` and `assets/CAPTURES.md` record each capture. New Stage
reference shots come from `capture/theme.mjs --run`, a fresh isolated DSH profile without
an AI model or live chat. Set `LANDING_CHROME` to an installed matching Chrome/headless-shell
binary; install the declared Bot harness/dependencies and the desktop runtime's pinned
pnpm first. The original Northwind capture pipeline remains under `capture/`.

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
schema, EU jurisdiction, Resend sender and final Omni event-envelope contract. Missing
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
