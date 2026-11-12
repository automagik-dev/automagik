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
scope. Public WebAuthn options use the display name instead. The page contract
uses phone codes for sign-in and does not offer account linking.

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

The owner supplies the sign-in and consent pages. See [PAGES-CONTRACT.md](PAGES-CONTRACT.md).
Until HTML exists in `pages/`, both routes answer plain text `501 page not built yet`.

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
Mutation checks disable PKCE, relax redirects, enable public registration and
move rate limits to memory, one at a time. Each must fail its targeted test;
source files are restored afterward. An optional terminal argument sends each
mutation's name through `hc send` before it runs.
`bun scripts/generate-migration.ts` regenerates the initial schema for review;
never replace an already applied migration when upgrading a deployed database.

See [DEPLOY.md](DEPLOY.md) for the owner's first workers.dev deployment. This
delivery does not deploy, provision infrastructure, or choose a public domain.

Pinned API references: [passkeys](https://www.better-auth.com/docs/plugins/passkey),
[OAuth provider](https://www.better-auth.com/docs/plugins/oauth-provider),
[phone numbers](https://www.better-auth.com/docs/plugins/phone-number).
