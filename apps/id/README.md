# Automagik ID

One identity for Automagik products, implemented with Better Auth 1.7.21 (MIT),
its matching passkey and OAuth provider plugins, and a Cloudflare Worker with D1.
This service deploys independently; repository releases never package it.

Passkey registration creates an account without a prior session. The authenticator
must support a discoverable credential and user verification. Authentication can
use browser conditional mediation; the API returns discoverable credential options
without requiring a username. No email, password, social login or public OAuth
client registration is exposed. There is no account management or recovery UI in
this delivery. The service does not provide a passkey recovery mechanism.

Better Auth's user schema requires a unique email. Accounts receive a random
address under the reserved `.invalid` domain solely for that database field.
It is never mailed or returned by this service, and the provider offers no email
scope. The JWT plugin's session response header is disabled. Public WebAuthn
options use the display name instead. Phone verification accepts only
`phoneNumber`, `code` and `oauth_query`; the Worker rejects linking flags and all
other extra fields. A phone code cannot add phone authentication to a passkey account.

Phone verification routes are absent until `OMNI_OTP_URL` is configured. Delivery
posts `{phoneNumber, code}` over HTTPS, with an optional `OMNI_API_TOKEN` bearer
credential, through the request's `waitUntil`. The response does not wait for Omni.
Failures emit a generic delivery error without the destination, code or token.
Three wrong codes prevent subsequent use of that challenge, including the correct
code. A new send is separately rate limited.

Sessions, WebAuthn challenges, OTP challenges, OAuth codes, grants, signing keys,
and rate limits live in D1. There is no secondary storage or session cookie cache.
Only Cloudflare's replaced `cf-connecting-ip` header supplies the limiter's IP.
The default limit is 60 requests per rolling minute per IP and path; Better Auth
plugins apply tighter limits to sensitive endpoints. D1's conditional updates
keep rate-limit counters shared between isolates.

`clients.json` is the reviewed client allowlist. Desktop is a native public
client, Cloud is a confidential web client, and the other products remain
disabled. Before a real Cloud login, replace its example callback in a reviewed
change. All seeded clients require S256 PKCE, including confidential clients.
The provider's native redirect matcher permits a new port on the registered
IP loopback URI while preserving its scheme, host, path and query. No origin
wildcard is configured. Consent is skipped only on the two first-party entries;
future third-party entries must keep `skipConsent: false`.

The sign-in and consent pages live in `pages/` and follow [PAGES-CONTRACT.md](PAGES-CONTRACT.md):
`sign-in.html`, `consent.html`, one stylesheet (`id.css`), one script (`id.js`) and
`assets/` (fonts, wordmark, the pet, their licences). They are plain files with no
build step; nothing is loaded from another origin, and a meta Content-Security-Policy
allows same-origin files only. Passkey is the main action; the phone code shows only
when `/api/id/config` reports it on. Copy is English only, in one table in `id.js`.

The Worker serves a page only at `/sign-in` and `/consent`, where it adds
`referrer-policy`, `cache-control: no-store` and `x-frame-options`. Any direct
`.html` path answers 404, so a page never arrives without those headers. Other
files in `pages/` are served as they are. A Worker running without the `PAGES`
binding answers plain text `501 page not built yet` on both routes.

From this directory:

```sh
bun install --frozen-lockfile --ignore-scripts
bun run check
bun run test
node scripts/mutations.mjs
```

Tests bundle the actual Worker and exercise it inside Miniflare/workerd, using
local persistent D1 and a software WebAuthn authenticator. Outbound requests are
denied except for fake Omni delivery and local dispatch of the provider's own
JWKS lookup for logout verification. No Cloudflare credentials are needed.
The cross-runtime limiter test uses two independent workerd runtimes sharing D1.

`test/pages.test.ts` covers the pages in three layers. The files: only the
contract's endpoints, nothing stored or logged, no inline code. A real Chromium
on the real Worker with a virtual authenticator: create a passkey, sign in,
allow, cancel, phone codes. Then every state of both pages with the service's
answers scripted, checked for its words, console errors, the calls it made and
sideways overflow at 390 and 320 wide. The browser layers need a Chromium
(`node node_modules/playwright-core/cli.js install chromium`, or `ID_PAGES_CHROME`
naming one) and skip without it; CI sets `ID_PAGES_BROWSER=required`, which makes
a missing browser a failure. `ID_PAGES_SHOTS=<folder> bun run test -- pages` also
writes a picture of every state (1440 and 390 wide, light and dark; 320 light)
with an `INDEX.md`.

Mutation checks restore the session JWT header, allow phone linking, disable
PKCE, relax redirects, enable public registration, move rate limits to memory,
serve a page file directly as `.html` and let CI skip the page browser tests,
one at a time. Each must fail its targeted test; source files are restored
afterward. Announcements and results are printed to stdout.
`bun scripts/generate-migration.ts` regenerates the initial schema for review;
never replace an already applied migration when upgrading a deployed database.

See [DEPLOY.md](DEPLOY.md) for the owner's first workers.dev deployment. This
delivery does not deploy, provision infrastructure, or choose a public domain.

Pinned API references: [passkeys](https://www.better-auth.com/docs/plugins/passkey),
[OAuth provider](https://www.better-auth.com/docs/plugins/oauth-provider),
[phone numbers](https://www.better-auth.com/docs/plugins/phone-number).
