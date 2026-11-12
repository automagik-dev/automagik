# Owner-run first deployment

Delivery 1 deploys nothing. Run these steps only when the owner authorizes the
first trial. Use workers.dev; do not add a route, zone, custom domain, or production
product integration. Re-register passkeys when changing the relying-party origin;
a later public-name move requires a separate owner decision.

## Token and local configuration

Use an API token scoped to the deployment account, with these account permissions:

| Permission | Access | Purpose |
|---|---|---|
| Workers Scripts | Edit | Upload Worker and assets, set secrets and workers.dev publication |
| D1 | Edit | Create the database, apply migrations and seed clients |
| Account Settings | Read | Resolve account and workers.dev subdomain metadata |

No zone permissions are needed for this workers.dev-only path. There is no DNS,
Workers Routes, KV, R2 or Cloudflare Access resource. Supply the account explicitly
through `CLOUDFLARE_ACCOUNT_ID` and the token through `CLOUDFLARE_API_TOKEN`, using
the operator's existing secret store. Do not put either in shell history or a
tracked file. Do not print environment variables or run commands with shell tracing.

From `apps/id/`, install and check locally:

```sh
bun install --frozen-lockfile --ignore-scripts
bun run check
bun run test
```

The following commands use Cloudflare only when the operator runs them:

```sh
bun x --no-install wrangler d1 create automagik-id
```

Set `ID_DATABASE_ID` to that result and `ID_WORKER_ORIGIN` to the intended HTTPS
workers.dev origin, through the operator's private environment. Then:

```sh
bun scripts/configure.ts
```

This writes ignored `wrangler.local.toml` from the tracked template and the
environment, with a `DB` D1 binding and `BETTER_AUTH_URL`. It refuses a non-workers.dev
origin. No account, database or zone ID is tracked. Omit `OMNI_OTP_URL` to keep
phone routes off. A later configured value must be the Omni HTTPS send endpoint.

## Secrets, migration and client seed

Create the auth secret directly into Wrangler's secret input. Do not run the
generator by itself, use command substitution, echo it, or save it in a file:

```sh
openssl rand -base64 48 | bun x --no-install wrangler secret put BETTER_AUTH_SECRET --config wrangler.local.toml
```

If Wrangler asks to create the named Worker before its first upload, accept only
the intended trial Worker. That is an operator action, not part of this delivery.
Keep this secret stable: it protects sessions and stored signing keys. Rotate only
with a reviewed session/signing-key plan. When phone rollout is authorized, pass
the existing Omni credential from its secret store straight into
`bun x --no-install wrangler secret put OMNI_API_TOKEN --config wrangler.local.toml`.
No other Worker secret is required. The Cloud confidential-client secret belongs
in the Cloud backend's secret store; the identity database receives only its hash.

Apply the checked-in migration before first traffic:

```sh
bun x --no-install wrangler d1 migrations apply DB --remote --config wrangler.local.toml
```

Review `clients.json`, including Cloud's example callback, before seeding. A real
callback change is a reviewed source change. Feed the existing Cloud client secret
from its backend secret store into `bun scripts/seed-clients.ts --remote` over stdin.
The script requires at least 32 characters, computes the pinned provider's SHA-256
base64url hash, writes an owner-readable temporary SQL file, applies it through
Wrangler and removes it. It never prints the raw secret. Do not invoke it without
stdin or include a secret as an argument. `--local` seeds a local Wrangler D1 for
manual trials. The checked-in list is the only client source; no HTTP registration
or client-management endpoint is exposed.

The seed is repeatable: it updates reviewed policy and the supplied Cloud secret
hash for known IDs. It does not delete unknown rows; investigate any row outside
the reviewed list before taking traffic. Disabled product placeholders stay off.
Only desktop and Cloud skip consent; a third-party entry must set it false. All
entries receive `requirePKCE: true` and the supported grant/scope lists.

## Upload and trial

```sh
bun x --no-install wrangler deploy --config wrangler.local.toml
```

Only run this after the owner supplies the HTML described in PAGES-CONTRACT.md,
or explicitly approves a backend-only trial with 501 pages. Test discovery, a real
passkey, desktop loopback sign-in with S256 and Cloud confidential sign-in on the
trial origin. Confirm D1 migrations and seed records, secure cookies, correct
issuer/audience/nonce checks in each client, and phone-disabled behavior. Never
share operational identifiers or current deployment details in public evidence.

To undo a trial, disable its workers.dev publication or remove the trial Worker
through the operator's deployment workflow. Preserve the database and auth secret
until issued sessions have been deliberately retired. Do not drop D1 as a routine
rollback. This delivery neither changes a product's identity settings nor moves
the public name.
