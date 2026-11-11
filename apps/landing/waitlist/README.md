# Cloud confirmation setup

The owner performs these steps in Cloudflare; agents do not access the account or its list.
Preview and production are separate configurations. No real message is sent by the test gate.

## Names to configure in each Pages environment

| Kind | Exact name | Value / scope |
|---|---|---|
| D1 binding | `WAITLIST_DB` | A different database for Preview and Production, each created with EU jurisdiction and initialized with `schema.sql`. |
| Secret | `RESEND_API_KEY` | Resend key authorized for the verified `send.automagik.si` sending subdomain. Never commit it. |
| Secret | `OMNI_WAITLIST_SECRET` | A strong random shared Bearer secret; Omni reads the matching value from its server environment, never from an automation definition. Use a different value in Preview. Never commit it. |
| Plain variable | `WAITLIST_WHATSAPP_NUMBER` | The chosen Omni WhatsApp number, international digits without `+`, punctuation or `@` suffix. No real number is hard-coded. |
| Plain variable | `WAITLIST_DATA_JURISDICTION` | `eu`, set only after confirming the bound database was created with EU jurisdiction. |

The exact sending address is `Automagik <confirm@send.automagik.si>`. The owner verifies the
subdomain's Resend DNS requirements and creates the `privacy@automagik.si` role address.
No other email is sent. The owner's existing services/plan and mail limits need checking
before enabling registration; no free-hosting or price claim is made.

D1 jurisdictions are selected **at database creation**, not added to an existing database;
see [Cloudflare's D1 data-location instructions](https://developers.cloudflare.com/d1/configuration/data-location/).
In the dashboard choose Specify jurisdiction → European Union, then apply `schema.sql` in
the SQL console. Bind it to the correct Pages environment. The schema is new; do not apply
it over an older email-only table without a deliberate migration. Keep the existing data
out of previews. Inspect only confirmed entries (`confirmed_at IS NOT NULL`) for owner review.
No agent reads or exports them.

## Deployment

Pages root directory: `apps/landing`. Build command: empty. Output directory: `.`. The
`functions/` folder must be at the project root for Pages to compile it. Merely uploading
`apps/landing` as static output from the repository root can omit the Functions. Confirm
`GET /api/waitlist` returns the form, not 404, after the preview deployment. Save/redeploy
after changing environment bindings. `_headers` covers static assets; function responses
also set their own noindex, no-store and no-referrer headers.

The function fails with 503 when required configuration is missing or the store fails.
Email delivery failure/timeout also returns 503, retaining its quota reservation. A duplicate
email request during the 24-hour cooldown gives the same generic confirmation instruction
without sending another email. Preview uses fake/test contacts and a dedicated database.
Do not use a live list for browser tests.

## Endpoints

- `POST /api/waitlist`, native form encoding: `action=add|remove|confirm`.
- `GET /api/waitlist`: the intent/consent/removal form.
- `GET /api/waitlist/email-confirm?token=...`: displays a POST confirmation button. GET does
  not consume a token; only the button's POST confirms.
- `POST /api/waitlist/whatsapp-confirm`: the **final v2 standard event envelope** in RFC 0027
  D3b. HTTPS + JSON + Bearer. Extract code from `payload.content.text`, external message ID
  from `payload.externalId`, sender from `payload.from`. Message text, sender name, body and
  metadata are never logged or stored. A sender may be an opaque LID, not a phone number.

The callback returns exactly the retained `reply` on a successful first confirmation or a
retry of the same external message ID/code/sender. A new message for a used code, or another
sender, is 409 without a reply. Omni sends a conversation reply only on 2xx and uses that
field; it stops on every failure/timeout. The site makes no WhatsApp request. Omni owns its
instance-scoped automation, excludes its own messages and reads its Bearer from its server
environment. The site cannot prove those Omni-side settings; the Orchestrator coordinates them.

## Quotas, consent and removal

The D1 INSERT triggers atomically reserve five joins per fixed UTC minute and ten per UTC
day per network bucket (IPv4 address / IPv6 /64), and sixty confirmation emails per UTC day.
Email cooldown is one per normalized address per 24 hours and survives removal until expiry.
The function reads the trusted `CF-Connecting-IP` edge header only to derive a daily keyed
counter; raw IPs/user agents are never stored. The callback permits sixty authenticated
calls per fixed UTC minute. The owner can add a production WAF burst filter; it is not the
authoritative quota and does not cover a preview host automatically.

Unconfirmed email entries expire after a day; WhatsApp codes after thirty minutes. They
become ineligible immediately and are deleted on the next human request, along with expired
counters. Confirmed entries remain until launch or removal, with an owner retention review
every six months. No cron or automatic launch mail exists. Token/code values are hashed in
storage. Explicit consent covers only the declared review and confirmation.

Removal accepts the email, normalized WhatsApp sender ID/number, or original WhatsApp code.
It deletes matching waitlist rows, sends nothing, and replies identically for absent contacts.
Keeping the original code lets a WhatsApp user remove an entry even if WhatsApp gave Omni
an opaque identity. Contact removal is intentionally unauthenticated: knowing a contact/code
lets someone delete that row, not read it. The privacy note states all retained fields and
processors. Owner access/correction is through the privacy role address.

## Verification before go-live

Run the local page/waitlist/browser gates, then have the owner check the configured preview:
register one test email, confirm it, and remove it; register WhatsApp, send the prepared code
to the selected Omni instance, see one reply, retry the same delivery ID, try a new message
for the used code (409), then remove the entry. Confirm the list's columns, jurisdiction and
absence of message text/body/name. Check that request-body logging is disabled in any
account-level tooling or proxy. No source code reads or logs the request body on failure.
Local tests mock Resend and use real local SQLite; they do not claim live D1/Resend/Omni proof.
