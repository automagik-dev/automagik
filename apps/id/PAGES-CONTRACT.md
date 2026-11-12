# Sign-in and consent page contract

The owner builds `pages/sign-in.html` and `pages/consent.html`, with any supporting
assets in that directory. The Worker serves them at `/sign-in` and `/consent`.
An absent page returns plain text `501 page not built yet`. No UI is included in
delivery 1. Serve scripts and styles from the same origin. No third-party scripts,
analytics, external fonts, or tokens in browser storage are needed.

## HTTP conventions

All paths below are relative to the identity service's origin. Use same-origin
fetch with `credentials: "include"`, `Accept: application/json`, and for POST
`Content-Type: application/json`. Cookies are HttpOnly; the page never reads them.
Use the browser's normal `Origin` header; never invent one. Request bodies and
responses are JSON unless stated otherwise. Never log challenges, codes, tokens,
cookies, or the provider's signed query.

Errors from authentication endpoints normally have `{code: string, message: string}`
and an HTTP 4xx status. OAuth errors can use `{error: string, error_description?: string}`.
An authorization decision can instead return HTTP 200 with
`{redirect: true, url: string}` where the URL carries an `error` parameter. Always
inspect both status and body. A 429 means wait before retrying; show the wait from
`X-Retry-After` in seconds. Network failures and unexpected responses need a retry
state. Never display raw HTML returned by a failed API call.

## Provider query and continuation

`loginPage` is `/sign-in`; `consentPage` is `/consent`. The provider redirects to
them with the original authorization parameters and signature metadata:

- `client_id`, `redirect_uri`, `response_type=code`, `scope` (space-separated).
- `state`, `nonce`, `code_challenge`, `code_challenge_method=S256` when supplied.
- Optional standard parameters such as `prompt`, `max_age`, `login_hint`,
  `resource` (which can repeat), `claims` (JSON), `ui_locales`, and `acr_values`.
- Provider metadata `exp`, `ba_iat`, `sig`, the repeated `ba_param`
  signed-parameter list, and optional `ba_pl` continuation metadata.
  Treat every unknown parameter as opaque and preserve it as received.

Set `oauth_query = window.location.search.slice(1)` once. Preserve the complete
query, including repeated parameters and signature metadata, without editing,
sorting or rebuilding it. The page never verifies a signature itself. Both pages
can request a verified client name with:

`POST /api/auth/oauth2/public-client-prelogin`

```json
{"client_id":"the client_id from the query","oauth_query":"the complete query without ?"}
```

Success is HTTP 200, with `{client_id, client_name?, client_uri?, logo_uri?,
contacts?, tos_uri?, policy_uri?}`. Only `client_id` and configured public metadata
are returned. Use `client_name` as text, falling back to `client_id`. Do not trust
a name or URL provided directly in the page query. Failed, expired or modified
queries must show an error and ask the user to restart from the product. Do not
load an untrusted logo or turn arbitrary metadata into HTML.

For sign-in requests, include `oauth_query` in the passkey or phone verification
POST body. The provider verifies it and automatically resumes authorization when
the session cookie is set. A successful verification can therefore return
`{redirect: true, url: string}` instead of the ordinary credential/session result.
Navigate to that server-returned URL. This is required for `prompt=login` and
`max_age`: the provider recognizes that the new session satisfied fresh sign-in.

For `prompt=create`, first sign out an existing session, create the account
without `oauth_query` in its verification body, and then call:

`POST /api/auth/oauth2/continue` with `{oauth_query, created: true}`.

To continue an already signed-in session when fresh sign-in is not requested,
use `{oauth_query, selected: true}`. At least one continuation flag is required.

Success is `{redirect: true, url: string}`. Navigate to that URL; the server chooses
the next page or registered product callback. Never navigate directly to a
query's `redirect_uri`. A standalone sign-in without a provider query should show
the signed-in state and no invented destination.

## Sign-in page

On load, call `GET /api/id/config`. Response: `{phoneEnabled: boolean}`.
The phone option must be absent when false. A config failure should leave the
passkey option usable and the phone option hidden.

Optionally call `GET /api/auth/get-session`. Response is `null` when signed out,
or `{session: {id, userId, expiresAt, ...}, user: {id, name, ...}}`. No email
is returned. Existing users can continue the provider flow or use
`POST /api/auth/sign-out` with `{}` (response `{success: true}`) to choose another
account. Treat session fields as data; never persist the returned token.

Offer **Use a passkey** and **Create a passkey**. The latter creates an account
through the authenticator, without a sign-up form, email or prior session.

Authentication:

1. `GET /api/auth/passkey/generate-authenticate-options`, with no body. Response
   is WebAuthn `PublicKeyCredentialRequestOptionsJSON`: `{challenge, rpId,
   timeout?, userVerification, allowCredentials?, extensions?}`. With no session,
   `allowCredentials` is omitted or empty, enabling discoverable credentials.
2. Convert the JSON options' base64url byte fields to ArrayBuffers and call
   `navigator.credentials.get({publicKey})`. For browsers supporting conditional
   mediation, the same endpoint supports `mediation: "conditional"` and a form
   field marked `autocomplete="username webauthn"`. No username is sent to the
   service. Abort the pending conditional request before starting another ceremony.
3. Serialize the credential with `credential.toJSON()` where supported, or the
   equivalent base64url WebAuthn JSON shape. `POST /api/auth/passkey/verify-authentication`
   with `{response: AuthenticationResponseJSON, oauth_query?: string}`. The normal
   response includes `{session: {...}, user: {id, name, ...}}` and sets the session
   cookie. A provider flow can instead return `{redirect: true, url}` as above.
4. Follow the server redirect or use the continuation rules above.

Account creation:

1. `GET /api/auth/passkey/generate-register-options`, no body. Optional query
   `authenticatorAttachment=platform` or `cross-platform`; omit for broad support.
   Response is `PublicKeyCredentialCreationOptionsJSON`: `{challenge, rp: {id,
   name}, user: {id, name, displayName}, pubKeyCredParams, timeout?,
   excludeCredentials?, authenticatorSelection, attestation?, extensions?}`.
   Discoverable credentials and user verification are required. Display names
   contain no internal email address.
2. Convert byte fields and call `navigator.credentials.create({publicKey})`.
3. `POST /api/auth/passkey/verify-registration` with
   `{response: RegistrationResponseJSON, createSession: true, name?: string,
   oauth_query?: string}`. Omit `oauth_query` for `prompt=create` as described above.
   Success includes the stored passkey's `{id, name?, credentialID, ...}`, plus
   `{session: {...}, user: {id, name, ...}}`; a session cookie is set. Never display
   or store the stored public key, session token or internal technical fields.
   A provider flow can instead return `{redirect: true, url}`.
4. Resume the provider query as described above. A cancelled or failed ceremony requires new
   options; challenges are single use. Starting registration creates an internal
   user row before successful verification; there is no signed-in session yet.

For browsers without the WebAuthn JSON conversion helpers, use the matching
Better Auth passkey client or a WebAuthn JSON adapter. Do not send a raw
`PublicKeyCredential` to JSON.stringify; its binary fields will be lost.

Phone flow, only when enabled:

1. Collect an international E.164 number, including `+`, with 8–15 digits.
   `POST /api/auth/phone-number/send-otp` with `{phoneNumber: string}`.
   HTTP 200: `{message: "code sent"}`. This acknowledges queued Omni delivery,
   not receipt on the phone. Show code entry, resend cooldown and delivery retry.
2. `POST /api/auth/phone-number/verify` with `{phoneNumber: string, code: string,
   oauth_query?: string}`. Omit `oauth_query` for `prompt=create`.
   HTTP 200: `{status: true, token: string, user: {id, name, phoneNumber,
   phoneNumberVerified, ...}}`, plus the session cookie. Ignore the body token.
   A provider flow can instead return `{redirect: true, url}`.
   The Worker accepts only `phoneNumber`, `code` and `oauth_query`: it rejects
   `updatePhoneNumber`, `disableSession`, all other extra fields and query
   parameters with HTTP 400 `{code: "UNSUPPORTED_PHONE_OPERATION", message:
   "Phone verification supports sign-in only"}`. The page offers no password or
   account-linking flow. Successful verification can create a separate phone account.
3. Continue the provider query. Show an invalid-code state, an expired-code state,
   and a locked-challenge state after three incorrect guesses. Codes expire after
   five minutes. A locked challenge needs a new send, subject to rate limits.
   Do not promise how many attempts remain; the API does not return a counter.

Required visible states: loading/config, passkey offered, authenticator prompt
pending, conditional mediation pending when supported, passkey cancelled,
passkey unavailable, passkey failed with retry, account created, signed in,
continuing to product, phone offered only when enabled, sending, code entry,
code rejected/expired/locked, resend wait, rate limited, service/network error,
invalid or expired provider request. No email field or social/password buttons.

## Consent page

Require a session through `GET /api/auth/get-session`. If absent, show session
expired and a restart action; do not post consent automatically. Verify client
metadata using `public-client-prelogin` with the signed query before displaying
the client name and requested permissions. Show the space-separated `scope`
entries as individual permissions: `openid` identifies the person, `profile`
shares the display profile, `offline_access` requests continued access. Unknown
scopes must be shown as text, not silently hidden. If `claims` requests UserInfo
claims, show the requested claim names as well; this delivery offers no email scope.

Buttons **Allow** and **Deny** call `POST /api/auth/oauth2/consent`:

```json
{"accept":true,"oauth_query":"complete query without ?"}
```

For denial, set `accept: false`. Optional `scope` is a space-separated accepted
subset; omission accepts all requested scopes. Optional `claims` selects accepted
claims; omit it when accepting all shown claims. Success for both decisions is
`{redirect: true, url: string}`. Navigate to the server-returned URL. Consent-page
queries in this version contain the signed authorization request, not an issued
authorization code. Never invent a `code` body field from an older plugin example.

First-party clients can bypass this page because their seeded `skipConsent`
flag is true. Third-party clients keep it false; explicit `prompt=consent` can
also cause a prompt. Required states: validating request/session, client name and
scopes ready, allow/deny pending, continued, session expired, signature/expiry
failure, permission error, rate limit and network error. Never consent on load.
