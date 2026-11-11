# automagik.si preview

RFC 0027 D3: a static page, served directly from this directory. No build step or client
JavaScript. It starts from the Genie's draft, carries the shared seven-block story, and uses
recorded product captures. `assets/CAPTURES.md` records the screens and film slot;
`assets/brand/LICENSES.md` records the copied brand assets and font licences.

Download links follow this repository's release aliases. Code mode needs Herdr and the
Automagik pack separately. Cloud is not live; the secondary card leaves room for D3b, with
no form or data collection in D3. D2 replaces the single labelled film placeholder with its
approved poster and committed encode, without adding a second film element.

## Check

From the repository root:

```sh
bun install --frozen-lockfile --ignore-scripts
node --test apps/landing/landing.test.mjs
LANDING_CHROME=/path/to/chrome node apps/landing/verify-browser.mjs
node herdr/scripts/privacy-check.mjs
```

`playwright-core` is a root dev dependency. Chrome must already be installed; on Linux/CI,
set `LANDING_CHROME` to its executable. The browser verifier starts and stops its own
loopback server, blocks remote requests, and checks overflow, decoded images, local fonts,
links, the film slot and reduced motion at 1440, 1024, 390 and 320 px in light and dark.
It writes full-page screenshots and a JSON report under ignored `.cache/landing-evidence/`.
Set `LANDING_EVIDENCE` to an absolute directory to choose another report destination.
A D2 player is checked for its local poster, `video/mp4` response and playable media.

The `landing` CI job runs both checks on every PR and retains the browser evidence.

## Cloudflare Pages preview

The owner connects the existing repository in his Cloudflare account:

- Framework preset: None.
- Repository root directory: `apps/landing`.
- Build command: empty.
- Build output directory: `.` (this directory).
- Select this PR's branch for a preview. Do not attach the production domain in D3.

The preview is unlisted. Both the page's robots meta tag and `_headers` say `noindex,
nofollow`; the latter supplies `X-Robots-Tag` on Pages. These discourage indexing; they do
not provide access control. The owner restricts preview access in his account before
sharing. No account, zone or database identifier is needed in this repository. The preview
URL stays in the private delivery report, never in a committed file. D4 removes the preview
indexing restrictions after the owner's OK. No DNS or production deployment is part of D3.

## Developer entry points

These commands moved off the old developer landing page:

```sh
curl -fsSL https://raw.githubusercontent.com/automagik-si/genie/main/install.sh | bash
genie desktop
```

The Genie CLI supports Linux x64/arm64 and Macs with Apple silicon. `genie desktop` needs
Linux x64 or a Mac with Apple silicon; there is no Linux arm64 desktop build. It downloads
the matching Automagik release and checks its SHA256SUMS. On a Mac, drag the app from the
disk image into Applications. Bring an AI account or API key; provider terms apply.
