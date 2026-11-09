# RFC 0025: Automagik Cloud economics: billing, managed tokens and agentic payments

| Field | Value |
|---|---|
| Status | Draft (council 2026-11-09: revise; owner decisions 2026-11-09; amends 0024) |
| Milestone | none (ships outside the five milestones) |
| Lanes | none here (docs); desktop (3.N) or plugin (3.N.P) for a link; the Cloud service outside |
| Created | 2026-11-09 |

## Summary

RFC 0024 fixed the free and paid split and chose Stripe, then left model usage and agentic
payments to a follow-up. This RFC is that follow-up. Customers keep their own model keys or
plan sign-ins, free; managed tokens through a Cloud-run gateway are an opt-in at a published
margin. Compute is metered from the host lifecycle. Bots pay Cloud for Cloud's own resources
first, from the organisation's card or prepaid credit, inside grants an owner sets; payments to
third-party merchants wait for a legal review and their own RFC. One append-only ledger, outside
the workspace, is the record; caps are hard and real-time; grants reserve, settle and release
atomically; each phase opens only behind its own go-live gate. This RFC is docs only: it opens
no checkout, starts no service and writes no billing code. It amends RFC 0024's open question 8
and Decided 14's "being paid".

## Motivation

RFC 0024's (i) recommended "model usage on the workspace's own keys at first" (its open question
8) and recorded the owner's answer on billing: Stripe directly, "including support to agentic
payments" (its Decided 14), "Bots paying, or being paid, on a customer's behalf ... within limits
the human sets", to be detailed by a follow-up RFC after a brainstorm on the economics. This is
that follow-up, and the owner's decisions of 2026-11-09 (Decided 1 to 4) settle the direction.

The obvious implementation, bill from the workspace's own meter, fails on the evidence this
repository already has:

- **The meter is local evidence, not a bill.** usagemeter is a file on the machine (RFC 0017);
  its doc is truncated to stay under its byte budget, so a missing row is not zero, and its
  provenance rows are "not a bill" (RFC 0018, (c)). Its store has no tenant and no billing
  identity, and RFC 0021 keeps session ids machine-local. A Bot with a shell can edit or delete
  it. None of that is a basis for charging a customer.
- **Billing truth has to be outside the workspace VM.** The gateway that serves managed tokens
  sees every call it bills, and Arca's host lifecycle sees every VM start and stop. The workspace
  sees neither as an authority, so it cannot write, alter or suppress the record.
- **A spend approval cannot be a terminal key.** RFC 0022's Decided 6 shows that a late key can
  answer the next, unseen approval dialog. A payment approval typed into a Bot's terminal has the
  same race. Money needs a passkey step-up in Cloud's own page, not a key.
- **Stripe is outside the workspace.** RFC 0024 already says no app or workspace talks to Stripe,
  a Bot holds no Stripe key or card, and every limit is the owner's and enforced by Cloud. The
  adapter, the webhook path and the ledger are Cloud's control plane, not a tenant's.

A council reviewed this direction on 2026-11-09 and returned a revise verdict: build the truth
and the ledger before the money paths, phase every charge behind its own go-live gate, and make
the safeguards acceptance tests rather than prose. Its conditions are Decided 5 to 13 below.

The public repository rule is part of the design: this RFC names no country, entity, Stripe
account, Stripe id or price. It says "the existing entity" and "a later second account"; the
values live in the Cloud service's private configuration.

## Decided

From the owner (2026-11-09):

1. **Model access is the customer's by default, at no charge.** A customer uses their own API
   keys or plan sign-ins. Managed tokens, through a Cloud-run gateway, are opt-in, per
   workspace, and sold at a published margin.
2. **Agentic payments start inbound.** Bots pay Cloud for Cloud's own resources (managed
   tokens, compute, new workspaces) from the organisation's card or prepaid credit, within
   grants an owner sets. Outbound payments to third-party merchants come later, after a legal
   review, in their own RFC.
3. **Billing-path changes need the owner's review before merge.** The ledger, the Stripe
   adapter, grants, quote signing and margins are billing-path changes; they are excluded from
   the normal merge rule.
4. **The existing entity and plain Stripe Billing.** Billing starts with the existing entity, in
   its local currency, on plain Stripe Billing for phases A to D. The Stripe adapter is keyed by
   `(Stripe account, customer)`, so a later second account can be added for USD and the agent
   rails. No country, entity, Stripe account, Stripe id or price is written in this repository or
   any other public text.

From the council review (2026-11-09; verdict revise; conditions folded in):

5. **Six phases, each behind its own go-live gate.** A: entitlements and a per-workspace
   subscription with seats as quantities; B: compute metered from the host lifecycle; C: managed
   tokens through the gateway, opt-in; D: Bot spend grants, inbound; E: external agent rails;
   F: outcome pricing. Earning money is a later owner decision; no phase charges before its gate
   and the owner's written GO-LIVE record.
6. **Billing truth comes only from outside the workspace VM**: the gateway for tokens, the host
   lifecycle for compute. The tenant is taken from the authenticated source, never from the
   payload. A test proves that a Bot with a shell cannot write, alter or suppress a billable
   event.
7. **One append-only ledger in Cloud's control plane.** An idempotency key includes the tenant,
   the tenant tuple, a price-version id, a server timestamp and the funding source. Each event
   goes to the Stripe meter or is debited from credit, never both. Reconcile with Stripe every
   period, with recorded true-ups; an event is corrected by a compensating event, never edited.
8. **Hard real-time caps per workspace and per paying account**, enforced by Cloud, not by
   Stripe, with alerts at set fractions.
9. **Money grants.** Amounts plus currency; reserve, then settle, then release, atomic under
   concurrency (a test with N parallel calls). Each grant is bound to one signed quote with a
   single-use nonce. Only an organisation Owner, after a passkey step-up, creates or raises a
   grant. Defaults: Never for payments and card entry; spend is Ask, or Pre-approve with a low
   cap and a TTL of 24 h at most. One page lists grants with one-click revoke; every charge gets
   a receipt.
10. **Tactu-style safeguards are acceptance tests**: one adapter file; webhook signatures
    verified; deduplication by event id; state re-fetched from Stripe; 503 without secrets; live
    keys refused until a GO-LIVE record exists; the outbox drained before deprovision. Test-clock
    evidence (a full month, failure through grace through hold, replayed and out-of-order
    webhooks, a reconciliation) comes before any live key.
11. **Outcome pricing uses a verifier outside the workspace.** A workspace never certifies its
    own outcome.
12. **The open-source image and an unlinked instance contain no billing call path.** Neither has
    a Stripe client, a ledger writer, a billing route or a call to Cloud's billing or gateway
    service.
13. **RFC 0024 is amended explicitly**: its open question 8 on tokens, and Decided 14's "being
    paid", which is deferred.

Carried, not new:

- From RFC 0024: the free and paid split; a subscription per workspace with seats as quantities;
  entitlements from signed, re-fetched Stripe state; owner-only billing (an admin never reaches
  it); card details stay on Stripe's pages; no workspace talks to Stripe; a Bot holds no Stripe
  key or stored card; every limit is an owner's and enforced by Cloud; notice and a grace period
  before a workspace is stopped, with its data kept for the retention window.
- From RFC 0024's Decided 13 and (e): the identity service only authenticates; billing roles,
  grants and caps live in Cloud's database, keyed by the tenant, never in a group claim.
- From RFC 0017: the meter is a part on its own lane and is never on a billing path; its local
  store, doc and attribution are read-only evidence for display and reconciliation signals.
- From RFC 0018: the doc cannot be the source; provenance rows are not a bill; a read never
  writes; null or unknown is never shown as zero.
- From RFC 0021: attribution stays machine-local and is never a billing identity.
- From RFC 0022: approvals are shown, never answered by typing keys (Decided 6). A spend approval
  is a passkey step-up in Cloud's page, never an approval key in a terminal.
- From RFC 0011: two-slot key rotation for anything this RFC signs, and one version.

Proposed here: everything else.

## Design

### Words

- **Billable event**: one usage, one-off resource purchase, credit movement or true-up that Cloud
  records in its ledger. A Stripe Billing subscription invoice is Stripe's object, not a ledger
  event; it is reconciled and receipted.
- **Billing truth**: an event made from an authenticated source outside the workspace VM, with
  the tenant from that source, a price version and one funding source.
- **Tenant**: the paying organisation or personal account. **Tenant tuple**: `(tenant, workspace,
  bot)` where a Bot is the cause, else `(tenant, workspace, platform)`.
- **Funding source**: `stripe_meter` or `credit`. A metered event has exactly one.
- **Managed tokens**: model tokens Cloud buys from a provider and serves through its gateway.
  **BYO**: the customer's own API key or plan sign-in, which Cloud never proxies or bills.
- **The gateway**: Cloud's model proxy: it authenticates the workspace, checks caps and grants,
  forwards the call with Cloud's provider credentials, counts what the provider reports, writes
  the ledger event and returns the response. A workspace never sees a provider key.
- **Host lifecycle**: Arca's record of a workspace VM's start, stop, resize and delete. It is the
  compute truth, not the meter inside the VM.
- **Price version**: an immutable id for a unit price, currency and margin. An event names one;
  a change makes a new version.
- **Grant**: an owner's currency-denominated authorization for Bot spend, created from one
  signed quote, drawn down by charges.
- **Quote**: Cloud's signed offer of an amount, currency, scope, price version and expiry, with
  a single-use nonce.
- **Reserve, settle, release**: hold an amount against a grant, charge the actual, return the
  remainder, all in one ledger transaction.
- **Cap**: a hard limit per workspace and per paying account, enforced before the billable
  action.
- **GO-LIVE record**: Cloud's control-plane record that a phase may charge real money, naming
  the owner's decision, the evidence, the Stripe mode and the rollback.
- **Existing entity**, **later second account**: the billing entity and Stripe account in use
  at the start, and an additive account for USD and the agent rails. Their names, ids and
  country are not public.
- **Period**: the account's billing period, at least a month, closed for reconciliation.
- **True-up**: a compensating ledger event that records a difference found in reconciliation.
- **Receipt**: the immutable, human-readable record of one charge, its grant and quote, its
  funding source and its ledger event.
- **Outcome**: a result Cloud prices directly (phase F), verified outside the workspace.

### (a) The money map

**Free, complete and unchanged**: the self-hosted product, one instance, one human (RFC 0024);
a Cloud personal account with no workspace; and model access on the customer's own API keys or
plan sign-ins. BYO model access has no Cloud charge, no margin and no billing event. It is the
default and stays first-class.

**Paid**: a hosted workspace's subscription (phase A), its compute (B), managed tokens if the
workspace opts in (C), and Bot spend on Cloud's resources inside grants (D). Phase E (outbound
agent rails) and phase F (outcome pricing) are later and are not built here.

**Managed tokens are opt-in, not a trap.** They are off by default at the organisation and the
workspace, the owner turns them on with a passkey step-up, the published margin is shown before
the first call, and turning them off stops new managed calls at once. Usage already served
settles. BYO resumes without a change to the workspace's data.

**Earning money is a later owner decision.** This RFC designs the paths and their gates; it
turns none on. Each phase's GO-LIVE record is the owner's decision to charge for that phase.
A phase may merge behind a flag and run in test mode before that record; it may not charge.

### (b) Phases and go-live gates

| Phase | What it adds | Gate before it charges |
|---|---|---|
| A | Entitlements; a workspace subscription with seats | A full test-clock month and GO-LIVE |
| B | Compute metered from the host lifecycle | The shell test, a reconciled period, GO-LIVE |
| C | Managed tokens through the gateway | The shell test, a margin, GO-LIVE |
| D | Bot spend grants, inbound | Atomicity, step-up and receipt tests, GO-LIVE |
| E | External agent rails, outbound | Its own RFC, a legal review, the owner's decision |
| F | Outcome pricing | A verifier outside the workspace, the owner's decision |

**A GO-LIVE record is required, not implied.** It is written in Cloud's control plane and holds
the phase, the scope, the owner's decision, links to the evidence, the Stripe mode, the date and
the rollback. The adapter reads it. No record means no live key and no real charge; test keys and
a test clock are allowed. A record can be withdrawn, which stops new charges at once.

**The order is a safety order, not a preference.** A and B give Cloud a correct bill for things
it already does. C adds a new trust boundary (the gateway). D adds owner-authorized Bot spend.
E and F add third-party and outcome risk and are not attempted until A to D have run a full
period in reconciliation.

**Each phase is behind its own gate.** A later phase never turns on an earlier one, and a phase
that fails its gate stays in test mode. A shared gate would let a strong phase hide a weak one.

### (c) Billing truth: outside the workspace VM

Only these sources can make a billable event, and all are outside the workspace VM:

1. **The gateway, for tokens.** It authenticates a short-lived gateway token minted from the
   workspace session, with the gateway as its audience (RFC 0024's workspace token keeps its
   one-workspace audience), reads the tenant and workspace from that token, and ignores any
   tenant in the request body. A token for another workspace or audience is refused. The gateway
   counts the provider-reported usage after the call; a stream that ends early is still counted
   for what the provider reports. If the provider reports no usage, the gateway records an
   estimate, marks its precision, and the period's reconciliation may true it up. It never reads
   the workspace's meter.
2. **The host lifecycle, for compute.** Arca emits VM start, stop, resize and delete events.
   Cloud maps the VM id to a workspace and tenant in its own database; a label or payload from
   inside the VM is ignored. A missed stop is reconciled from Arca's authoritative VM state, so
   a crashed agent cannot leave a workspace running free or a stop unrecorded.
3. **Cloud's own system, for credit and reconciliation.** A prepaid credit purchase is a Stripe
   charge then a ledger credit; a credit debit is a ledger event. A subscription invoice is
   Stripe Billing's object and is reconciled, never copied in as a second charge.

**The tenant comes from the authenticated source, never from the payload.** A gateway request's
body may name a tenant; it is ignored. A host lifecycle event's payload may carry a name; it is
ignored. A mismatch between the authenticated mapping and a claimed tenant is refused and
alerted. The Stripe customer is chosen from Cloud's `(tenant, Stripe account)` mapping, not from
a value a workspace sends.

**No write path from the workspace.** The workspace can call the gateway as a client and can ask
Cloud for a quote, but it cannot insert a ledger row, change a price, stop a host lifecycle
event, or mark a charge settled. The ledger's writer is the Cloud service. The gateway and the
host lifecycle are separate services with their own credentials; neither trusts a workspace
payload for identity.

**The shell test.** A named acceptance test starts a Bot with a shell inside a workspace and has
it try every write, alter and suppress path: edit and delete the local meter store, forge a
gateway usage request, replay a settlement, stop the VM to hide running time, delay a stop, and
send a fake host event. The test proves the ledger, the gateway's count and the host lifecycle
still bill the true usage; no event is written, changed or lost. A second assertion proves no
billing code reads the meter's store or doc.

**The meter is never billing truth.** RFC 0017, 0018 and 0021 keep the meter local, attributable
and useful for display, capacity and as a reconciliation signal. It is editable by the same user
and truncated by its byte budget. A billing decision that reads it is a defect, and a test
pins that no billing path imports it.

### (d) One append-only ledger, one funding source

Cloud's control plane keeps one ledger for every billable event it records: token usage, compute,
one-off resource purchases, credit movements and true-ups. It is append-only. A correction is a
new compensating event that names the one it corrects; no row is updated or deleted. The
workspace has no writer and no reader beyond the owner's receipts and summaries.

| Field | Meaning |
|---|---|
| Event id | Immutable id of this event |
| Idempotency key | Unique; a retry returns the first event |
| Tenant | The paying organisation or personal account |
| Tenant tuple | `(tenant, workspace, bot)` or `(tenant, workspace, platform)` |
| Kind | `tokens`, `compute`, `resource`, `credit`, `true_up` |
| Resource | Model and unit, VM shape and unit, or the one-off resource |
| Quantity and unit | What was consumed, in the price version's unit |
| Amount and currency | The charge in the funding source's currency |
| Price-version id | The immutable price and margin this event settles at |
| Server timestamp | The source's time, assigned once and reused on retry |
| Funding source | `stripe_meter` or `credit` |
| Quote and grant | The authorizing quote id and nonce, and the grant id, when any |
| Receipt id | The receipt issued when the event settles |
| Source | `gateway`, `host_lifecycle`, `credit` or `reconciliation` |
| Source event id | The source's own id, for replay and reconciliation |

**Idempotency.** The key is a hash of the tenant, the tenant tuple, the price-version id, the
source's server timestamp and the funding source. A retry carries the same timestamp and key;
the insert is a no-op that returns the original event. A new event gets a new timestamp. The key
is unique in the ledger, so a duplicated delivery, a replayed webhook or a retried gateway call
cannot charge twice.

**One funding source, never both.** Every event names `stripe_meter` or `credit`; a constraint
and the same transaction that writes the event enforce one value. A metered event is sent to the
Stripe meter **or** debited from credit, never both. A failed card path does not silently fall
back to credit: it is retried on its own source, or the owner's decision creates a new event on
credit with its own id, and the failed one is closed by a compensating event. A subscription
invoice is Stripe Billing's and is never also debited from credit.

**Credit is funding, not a second usage event.** A credit purchase is a card charge that adds
credit; it is not a usage event and never also posts to the meter as usage. A credit debit is the
usage event's funding. They are separate ledger events, and neither is ever both.

**Price versions.** An event settles at the price version it names, even after a later price or
margin change. A change is a new immutable version with its own id; it applies only to events
that name it. A retroactive change is a true-up event, never an edit. A price or margin change
is a billing-path change (Decided 3).

**Reconciliation every period.** At each period close, Cloud compares, per tenant, price version
and funding source, the ledger's sum with the Stripe meter, the subscription invoices and the
credit balance. A difference is written as a true-up event with the evidence and a reason, and
the reconciliation report is kept. A true-up can be positive or negative; it is never an edit to
an old event. The report is available to the owner and is part of the next phase's go-live
evidence.

**Outbox and deprovision.** The ledger event is the source; the Stripe meter post and the credit
debit are an outbox that retries. Before a workspace is deprovisioned, the outbox is drained, so
its last usage is billed or credited; if it cannot drain, deprovision waits and reports the
reason. A late event after deprovision is a true-up, not a lost charge.

### (e) Hard caps, enforced by Cloud

Every paying account and every workspace has a cap per period. Both apply; the lower remaining
amount wins. A cap is a currency amount in the account's currency.

- **Real time, before the action.** The gateway checks the remaining cap before forwarding a
  managed call; the host lifecycle checks it before a VM start or resize; a quote checks it
  before a reserve. A request at or past the cap is refused with a reason; it is never admitted
  and billed later.
- **In flight.** Calls already admitted settle. A cap is not an estimate and not an overage
  allowance; new work stops at the line.
- **Cloud enforces it, not Stripe.** Stripe's meters and invoices are billing systems with their
  own delays. The cap is checked in Cloud's control plane, where the action is admitted, so a
  delayed Stripe update cannot let spend through.
- **Alerts at set fractions.** The owner sets the fractions; recommended are one half, four
  fifths and the cap. An alert goes to the organisation's owners (and the individual of a
  personal account) once per fraction per period, with the remaining amount and the workspace
  that crossed it.
- **Safe defaults.** A new paying account starts with a low cap, and managed tokens start at
  zero until an owner opts in and sets a cap. An owner can change a cap with a passkey step-up;
  an admin cannot.
- **A cap is not a grant.** A grant can only lower what a Bot may spend inside the cap. Revoking
  a grant never raises a cap, and raising a cap never raises a grant.

**Test.** Concurrent requests at the cap admit exactly the remaining amount, the next one is
refused, alerts are recorded once per fraction, and a delayed Stripe state changes none of it.

### (f) Grants, quotes and approvals

**A grant.** A grant holds an amount and a currency, a scope (`managed_tokens`, `compute` or
`new_workspace`), a period, an expiry, a state (`active`, `exhausted`, `revoked`, `expired`) and
its owner; its reservations carry `reserved`, `settled` or `released`. It is created from one
signed quote; the quote fixes the amount, currency, scope, price-version id and expiry, and its
nonce is single-use. A second grant from the same quote is refused. A quote may describe an
envelope (for example, managed tokens up to the grant's amount in its period), so one grant can
fund more than one charge; the quote itself is never reused to create a second grant. A charge
draws on the grant only inside that quote's scope; a grant never spans scopes. A charge without
a grant is refused for a Bot; a human's own use is bounded by the cap.

**Reserve, settle, release, atomically.** A charge begins with a reserve that checks the grant's
available amount, the workspace cap and the paying account's cap, then holds the estimate in one
ledger transaction. On completion, settle writes the actual and releases the remainder; on
failure or expiry, release returns the hold. The three steps are atomic per grant under
concurrency: a test issues N parallel reserves against a grant that can fund only K of them, and
exactly K succeed, the available amount never goes negative, the sum of reserved and settled
never exceeds the grant, and no reservation is orphaned. Concurrent settle and release calls are
idempotent by key.

**Only an organisation Owner (or a personal account's individual), after a passkey step-up.**
Creating or raising a grant needs a fresh WebAuthn assertion with user verification, valid for
that one action and at most five minutes. A session cookie, an admin, a member, a guest or a Bot
is refused. The step-up is Cloud's own page; RFC 0022's rule holds, so no approval or answer key
in a terminal can create or raise a grant.

**Defaults.** For payments and card entry: **Never**. A Bot never enters card details and no
payment is made by default. For spend: **Ask**, the owner answers each spend in Cloud's page.
The owner may choose **Pre-approve**, with a low cap and a TTL of 24 h at most; after the TTL the
grant expires and the remainder is released.

**One page, one click.** One page lists every grant with its scope, amount, remaining, expiry,
state and last charge, and revokes it in one click. Revoking stops new reserves at once,
settles what is in flight and releases the remainder; it is audited. The page shows the cap next
to the grant so an owner sees the outer bound.

**Every charge gets a receipt.** A receipt names the amount and currency, the resource, the
grant and quote, the funding source, the ledger event, the timestamp and the state. It is
immutable and shown in the same page; a Stripe invoice is linked where the funding source is the
card. A receipt is not a second charge.

**One event, one receipt.** A reserve is not a charge and gets no receipt until it settles. A
released hold shows as released, not as a charge. A true-up gets its own receipt and names the
event it corrects.

### (g) The Stripe adapter and its safeguards

**One adapter file.** All Stripe SDK calls, secrets, webhook verification and idempotency live in
one adapter module. No other module in the Cloud service imports the Stripe SDK or holds a
secret; a test enforces it. The adapter is keyed by `(Stripe account, customer)`.

**Webhooks.** The endpoint verifies the signature with its signing secret and answers a bad
signature with `400` and no state change. It deduplicates by event id. After verification it
re-fetches the subscription, invoice, meter or charge from Stripe and updates Cloud from that
state; the event payload is a hint, never the truth. Replayed and out-of-order events converge
on the same state. A missed event is repaired by a scheduled re-fetch, not by trusting a later
payload.

**503 without secrets.** A billing route with a missing or unreadable secret answers `503` with
a reason; it never fakes success and never returns a `500` that reads as a code bug. The health
check distinguishes "not configured" from "broken".

**Live keys are refused until a GO-LIVE record exists.** The adapter reads the phase's record
and refuses a live key at start and per call when the record is absent or names another phase or
mode. Test keys and a test clock are allowed without it. A test proves no live charge can be
made without the record, and that withdrawing the record stops new charges.

**The outbox is drained before deprovision.** Deprovisioning a workspace waits for the outbox to
post its last events to the Stripe meter or the credit ledger. If it cannot drain, deprovision
waits, alerts and keeps the data; it never deletes the only record of a charge.

**Test-clock evidence before any live key.** On a Stripe test clock, Cloud runs a full month:
sign-up, seats added and removed, a failed payment through notice, grace and hold, a recovery, a
cancel, replayed webhooks, out-of-order webhooks and a reconciliation with a true-up. The
evidence is linked from the GO-LIVE record. No live key is used until it passes.

**Grace and hold.** A failed payment gets a notice and a grace period in which the workspace
runs; then the workspace is held (stopped, data kept for the retention window) and its
entitlements come from the re-fetched Stripe state, not from the failed event. A payment that
recovers before the hold restores the workspace without a new charge.

**No card, no key, no direct call.** Card details stay on Stripe's pages; Cloud stores no card.
No workspace and no Bot holds a Stripe key or calls Stripe. A Bot's inbound payment is a grant
and a receipt, not a card charge it makes itself.

### (h) The existing entity and a later second account

Phases A to D bill through the existing entity, in its local currency, on plain Stripe Billing:
a subscription per workspace, seats as quantities, and Stripe's meters and invoices. No custom
billing engine sits between the ledger and Stripe.

The adapter's `(Stripe account, customer)` key is the seam for a later second account. Adding
one for USD and the agent rails is additive: existing customers and subscriptions stay on the
first account, new charges go to the second, and the ledger's amount plus currency keeps them
apart without conversion. A tenant can hold a customer in each account.

The names, ids, country, currency details and prices are private. Public text says "the existing
entity" and "a later second account"; tests, fixtures and defaults use placeholders. No Stripe
id, account name or price appears in a commit, a log, an example or this RFC.

### (i) Managed tokens and the gateway

**Default: BYO.** The customer's own API keys or plan sign-ins, unchanged, with no Cloud charge.
Cloud does not proxy or count that traffic, and no billing path is opened for it.

**Opt-in: managed tokens.** An organisation Owner enables managed tokens for one workspace after
a passkey step-up and sees the published margin first. The workspace then points its model
client at Cloud's gateway, authenticated with a short-lived gateway token minted from the
workspace session. The gateway checks the cap and any grant, forwards the call with Cloud's provider
credentials, counts the provider-reported usage, writes the ledger event and returns the
response. The workspace never sees a provider key.

**The published margin.** The gateway's price is the provider cost plus a margin, published per
model and unit in a price version before opt-in. The same margin applies to every customer on
that version. A change is a new version with its own id and a published date; it is never
retroactive, and it is a billing-path change.

**Accounting and privacy.** The gateway stores no prompt or answer text beyond the transient
proxy; it keeps metadata for billing and reconciliation only. Retries are idempotent by request
id, so a retried call is counted once. A model's reported usage wins; an estimate is marked and
can be trued up. The gateway is the only token truth; the local meter is not read.

**Opting out.** Turning managed tokens off stops new gateway calls at once; calls already in
flight settle; BYO resumes. A workspace never loses its data or its BYO configuration.

**No billing call path outside Cloud.** The gateway and the ledger live in Cloud's control
plane. The open-source image and an unlinked instance have no Stripe client, no ledger writer,
no billing route and no call to Cloud's billing or gateway service; a test runs both and fails
on any such call. The workspace's model client may point at the gateway only when a Cloud
workspace has opted in.

### (j) Inbound now, outbound later

**Inbound.** A Bot may ask Cloud for a quote for its own Cloud resources: managed tokens,
compute, or a new workspace. The quote is signed and carries a single-use nonce. The owner's
grant authorizes it; Cloud reserves, then settles by charging the card or debiting credit, then
releases the remainder and issues a receipt. The Bot never holds a card or a Stripe key. Funding
is the organisation's card (through Stripe) or its prepaid credit; every event has exactly one of
the two.

**Prepaid credit.** An owner buys credit through Stripe; the ledger credits the organisation's
balance in the account's currency. A Bot charge debits that balance, with no per-event card
charge. Credit is not transferable and is not a second card; a refund or an expiry is an owner
decision recorded as a compensating event, never a silent edit.

**Outbound is not built here.** Bots paying third-party merchants is phase E, after a legal
review, in its own RFC. This RFC builds no merchant path, no merchant allowlist, no outbound
credential and no card entry by a Bot. The default is Never, and there is nothing to switch on
until that RFC and its gate exist.

**"Being paid" is deferred.** RFC 0024's Decided 14 said "Bots paying, or being paid". The
inbound direction is decided here; the "being paid" direction, and any agent rail that receives
money for a customer, waits for phase E and its own RFC.

### (k) Outcome pricing (phase F)

An outcome price charges for a verified result, not for tokens or hours. The verifier runs
outside the workspace VM, holds its own credentials and signs its result; Cloud writes the
ledger event from that signed result and the workspace cannot certify its own outcome. A dispute
is a compensating event, never an edit. Phase F is not built here: it waits for A to D to run a
period in reconciliation, a verifier design, and the owner's decision to earn on outcomes.

## Amendments to RFC 0024

This RFC amends RFC 0024 (Draft) in four places, each marked there:

- **Open question 8 (What is paid).** Was: model usage on the workspace's own keys at first.
  Now: BYO model access is free; managed tokens are an opt-in through Cloud's gateway at a
  published margin; compute is metered from the host lifecycle; the workspace subscription and
  seats stay as recommended. The remaining shape is carried as open question 6 below.
- **Decided 14 ("being paid").** Was: Bots paying, or being paid, on a customer's behalf. Now:
  inbound first; outbound to third-party merchants is deferred to phase E, after a legal review
  and its own RFC.
- **Question 9 (the billing system).** It records the follow-up RFC; 0025 is that RFC, and
  "being paid" is deferred (0025, (j)).
- **(i) Billing and entitlements.** Its sentence "Bots paying, or being paid" now reads with
  that deferral; the rest of (i) stands.

Nothing else in RFC 0024 changes: its identity models, workspaces, rail, entitlements, Stripe
directly, no workspace talks to Stripe, owner-only billing and grace period stand.

## Contracts introduced

- **The ledger event, version 1.** The fields in (d), append-only, one funding source. A new
  field is additive; a changed field meaning is a change to this RFC.
- **The price version, version 1.** An immutable id, unit, currency and margin, with a published
  date. Old events keep their version; a new version is additive.
- **The gateway contract, version 1.** A short-lived gateway token minted from the workspace
  session for the gateway's audience; a request that names no tenant as authority; a response
  with the model output and the usage Cloud counted; errors for cap, grant and auth. No provider
  key ever leaves the gateway.
- **The host lifecycle event, version 1.** VM id, workspace id (from Cloud's mapping), state,
  shape, start and stop times, and the source's own event id. A payload's tenant is ignored.
- **The quote, version 1.** A signed amount, currency, scope, price-version id, expiry and
  single-use nonce. A quote is used once, for one grant.
- **The grant, version 1.** Amount, currency, scope, period, expiry, state, quote id and nonce.
  A change of amount is a new grant or a raise, never an edit of a settled one.
- **The cap document, version 1.** A per-workspace and per-account amount and currency, the
  alert fractions and the period. Additive.
- **The receipt, version 1.** The charge's amount, currency, resource, grant, quote, funding
  source, ledger event, timestamp and state. Immutable.
- **The GO-LIVE record, version 1.** Phase, scope, owner decision, evidence, Stripe mode, date
  and rollback. The adapter reads it before a live key.
- **The Stripe adapter key.** `(Stripe account, customer)`, with the webhook endpoint and signing
  secret in the Cloud service only. No value is written here.
- **The entitlements document, additive.** New fields for managed tokens, compute and grants;
  older readers ignore them. A changed meaning is a change to this RFC.
- **No new plugin id, route prefix or storage prefix in existing plugins.** A customer-facing
  link or a field read is additive; billing routes are Cloud's.

## Threat model

**A Bot with a shell.**

- It can edit or delete the local meter. That changes no bill: the ledger reads the gateway and
  the host lifecycle, and a test pins that no billing path reads the meter.
- It can forge a gateway request. The gateway trusts only the gateway token's tenant and
  audience, checks the cap and grant, and counts the provider's usage; the forged request is
  either refused or billed as its own call, not as another tenant's.
- It can try to suppress compute. The host lifecycle is Arca's, outside the VM; a missed stop is
  reconciled from the VM's state. The shell test proves no write, alter or suppress succeeds.
- It can call Cloud's public routes. It cannot write the ledger, sign a quote, create a grant or
  mark a charge settled.

**Double charging.**

- A retried event is one ledger row by idempotency key.
- A metered event has one funding source; a card failure never silently becomes a credit debit.
- A replayed webhook is deduplicated by event id and converges by re-fetch.
- A period's reconciliation writes a true-up, not a second charge.

**Webhook forgery, replay and order.**

- A bad signature is `400` and changes nothing.
- Deduplication and re-fetch make a replay and an out-of-order delivery converge on Stripe's
  current state.
- A missed event is repaired by a scheduled re-fetch; the payload is never the entitlement truth.

**Keys and live mode.**

- Stripe secrets live only in Cloud's control plane, never in a workspace, a Bot, a client or
  this repository.
- One adapter holds them; a test fails any other import.
- A live key is refused without a matching GO-LIVE record; withdrawing the record stops new
  charges.
- A missing secret is a `503`, not a fake success.

**Grants and approvals.**

- A grant race is closed by the atomic reserve/settle/release and the N-parallel test.
- A quote replay is refused by its single-use nonce.
- A grant is created or raised only by an organisation Owner after a passkey step-up; an admin,
  a member, a guest and a Bot are refused.
- A spend approval is never a terminal key (RFC 0022); a late key cannot approve a charge.
- A stolen session cannot raise a grant without a fresh step-up.
- The default is Never for payments and card entry; spend is Ask or a low-cap, 24-hour
  Pre-approve.

**Caps.**

- Enforced in Cloud before the action; a delayed Stripe update cannot admit spend.
- A cap is per workspace and per paying account, and the lower wins.
- A cap change needs an owner's step-up; a grant never raises it.

**Managed tokens.**

- The gateway holds the provider credentials; the workspace never sees them.
- Prompt and answer text is not stored beyond the transient proxy; billing metadata is kept.
- The published margin and its price version are visible before opt-in; a change is a new
  version, never retroactive.
- Opting out stops new calls; served usage settles.

**Outbound payments.**

- Not built here. There is no merchant path, merchant credential or card entry by a Bot; the
  default is Never. Phase E needs a legal review, its own RFC and its own gate.

**Outcome pricing.**

- The verifier is outside the workspace and signs its result; a workspace cannot forge a
  successful outcome. A dispute is a compensating event.

**Deprovision and retention.**

- The outbox drains before deprovision; if it cannot, deprovision waits and the data stays.
- A late event is a true-up, not a lost charge.
- Deletion follows RFC 0024's retention window; the ledger's billing records are kept as long as
  the law and the reconciliation require, and a receipt stays available to the owner.

**Undo.**

- Stop charging a phase by withdrawing its GO-LIVE record; new charges stop, in-flight settles.
- Cancel a subscription at Stripe; the entitlement follows the re-fetched state and the grace
  period.
- Revoke a grant in one click; release the remainder.
- Turn off managed tokens; the workspace returns to BYO.
- A bad charge is corrected by a true-up or a refund, never by editing the ledger.
- No undo step reaches into a self-hosted instance; it never had a billing path.

## Deliveries

This RFC is docs only. Its deliveries are listed for the Cloud service and Arca, outside this
repository; a delivery that needs a customer-facing link or an entitlement field here is its own
plugin or desktop PR and never mixes lanes. Each phase has its own go-live gate; a phase may
merge behind a flag and run in test mode before the gate, but it may not charge.

**Phase A: entitlements and the workspace subscription.**

- *What ships:* the per-workspace subscription with seats as quantities, on plain Stripe Billing
  through the existing entity in its local currency; entitlements from signed, re-fetched Stripe
  state; the owner-only billing page; notice, grace and hold.
- *Go-live gate:* the owner's GO-LIVE record plus a full test-clock month: sign-up, seat changes,
  a failed payment through notice, grace and hold, a recovery, a cancel, replayed and
  out-of-order webhooks, and a reconciliation.
- *Check:* an admin cannot reach billing; a bad webhook signature changes nothing; a missing
  secret is `503`; a live key is refused without the record; no workspace or Bot talks to Stripe;
  no price or account value is in the repository.
- *Rollback:* stop new subscriptions and withdraw the record; existing entitlements run to the
  period end; data is kept.

**Phase B: compute metered from the host lifecycle.**

- *What ships:* Arca's VM lifecycle events into the ledger, mapped to the tenant in Cloud's
  database; the workspace and account caps for compute; alerts; the period reconciliation.
- *Go-live gate:* the shell test, a full period of compute events reconciled with recorded
  true-ups, and the owner's GO-LIVE record.
- *Check:* a Bot with a shell cannot write, alter or suppress a compute event; a missed stop is
  reconciled from Arca's state; the cap refuses the next start; a delayed Stripe state admits no
  extra compute.
- *Rollback:* stop metering compute and withdraw the record; the workspace keeps running on its
  plan; a true-up records the period's actual use.

**Phase C: managed tokens through the gateway, opt-in.**

- *What ships:* the gateway, the published margin and price version, the workspace opt-in, the
  gateway audience token, the ledger path for tokens, and the cap and grant checks.
- *Go-live gate:* BYO is the default; the shell test; a full period of token events reconciled;
  the margin published before opt-in; the owner's GO-LIVE record.
- *Check:* a workspace with BYO makes no Cloud billing call; a gateway call without a valid
  audience token is refused; a token for another tenant is refused; an edited local meter changes
  no bill; opting out stops new calls; the open-source image and an unlinked instance have no
  billing call path.
- *Rollback:* turn managed tokens off and withdraw the record; workspaces return to BYO; served
  usage settles.

**Phase D: Bot spend grants, inbound.**

- *What ships:* grants, quotes and the single-use nonce; reserve, settle and release; the owner's
  passkey step-up; the defaults; the one-page grant list and revoke; receipts; card and prepaid
  credit funding.
- *Go-live gate:* the N-parallel atomicity test, the step-up and revocation tests, the receipt
  test, a full period reconciled, and the owner's GO-LIVE record.
- *Check:* only an organisation Owner after a step-up can create or raise a grant; N parallel
  reserves admit exactly K; a quote replay is refused; a revoke stops new reserves and releases
  the remainder; every settled charge has a receipt; a Bot holds no card or Stripe key; the
  default is Never for payments and card entry.
- *Rollback:* revoke grants and withdraw the record; in-flight charges settle; the card and
  credit paths stop for new Bot spend.

**Phase E: external agent rails, outbound.**

- *Not delivered here.* Its own RFC, after a legal review of merchant payments in the relevant
  jurisdictions, sets the merchant path, the limits, the receipts and the disputes.
- *Go-live gate:* that RFC's gate, the legal review and the owner's decision; no merchant
  credential or outbound path exists before it.
- *Check:* none in this RFC; the default is Never and there is no switch.
- *Rollback:* nothing to roll back here; the phase does not exist.

**Phase F: outcome pricing.**

- *Not delivered here.* It waits for A to D to run a period in reconciliation, a verifier outside
  the workspace, and the owner's decision to earn on outcomes.
- *Go-live gate:* the verifier's acceptance, the owner's decision and the same test-clock and
  reconciliation bar.
- *Check:* a workspace cannot certify its own outcome; a dispute is a compensating event.
- *Rollback:* nothing to roll back here; the phase does not exist.

**Every billing-path change.** A pull request touching the ledger, the Stripe adapter, grants,
quote signing or margins needs the owner's review before merge and is excluded from the normal
merge rule. The rule covers a schema, a migration, a webhook handler, a key, a grant state, a
quote format and a price or margin. It is not waived by a phase's gate or by an automated merge.

## Open questions

### Carried from RFC 0024

1. **RFC 0024, question 3: the isolation unit.** Recommended: one Incus VM per workspace; an
   unprivileged container only for the operator's own workspaces; never a privileged one. Settled
   at the isolation review gate, before any outside person joins.
2. **RFC 0024, question 4: who may invite.** Recommended: owners and admins, and the individual
   of a personal account; members and guests cannot.
3. **RFC 0024, question 5: recovery.** Recommended: a second passkey at the claim, recovery codes
   stored as slow hashes, and the host reset out of the Bots' reach; no email reset.
4. **RFC 0024, question 6: session lifetimes.** Recommended: self-hosted sessions sliding with a
   12-hour idle limit; Cloud workspace tokens 5 minutes; whether DSH's own multi-day cookie can
   stay behind the gate unchanged is an evidence gap for RFC 0024's delivery 0.
5. **RFC 0024, question 7: IP-only LAN installs.** Recommended: no passkeys there; an SSH tunnel
   or pairing from a signed-in session; no TOTP fallback without its own review.
6. **RFC 0024, question 8: what is paid (amended).** The owner's decision 1 settles model access:
   BYO is free; managed tokens are opt-in at a published margin. Recommended for the rest: a
   per-workspace subscription with seats as quantities, compute metered from the host lifecycle,
   personal accounts free, and the self-hosted product free and complete for one instance. The
   open part is the subscription's included seats and host shape, which the owner sets at each
   phase's GO-LIVE.
7. **RFC 0024, question 10: moving a self-hosted instance into Cloud.** Recommended: a separate,
   later decision; linking moves no data.
8. **RFC 0024, question 11: DSH's authentication hook.** Recommended: the gate now; propose a
   hook upstream (as RFC 0023 does for its pieces) and move to it only once DSH ships one.
9. **RFC 0024, question 12: Omni's sign-in.** Recommended: a defined boundary: Omni keeps its own
   for outside Omnis; behind a gate it takes the gate's principal with its own sign-in off.
10. **RFC 0024, question 13: an optional external OIDC provider for self-hosters.** Recommended:
    not planned; the principal contract leaves room for it later.
11. **RFC 0024, question 14: federation for company customers.** Recommended: RFC 0024's delivery
    0 checks it; if it is missing, decide before the first company customer, since a later issuer
    move re-binds every person.
12. **RFC 0024, question 15: Pocket and Pocket Link with a claimed instance.** Recommended:
    unchanged; Pocket pairs through Pocket Link's own keys, outside the gate; a phone sign-in to
    a web instance is a passkey of the same owner.
13. **RFC 0024, question 16: is the Cloud service open source?** Recommended: its contracts (the
    principal, the workspace token, the entitlements document, the rail's API) are public here;
    the service starts private.
14. **RFC 0024, question 17: the desktop's Cloud credential and local Bots.** Recommended: build
    a delivery-H-style mask per OS (the secret store, the session bus, the app's data folder) and
    keep desktop Cloud sign-in off on an OS until it exists there; the alternative is the owner's
    written acceptance of the risk for that OS.
15. **RFC 0024, question 18: until the three safeguards hold.** Recommended: Cloud workspaces
    stay owner-only. The narrower alternative, members and guests limited to Bots with no shell
    or file tools, is not recommended: a Bot's tools change over time.

### New here

16. **The cap fractions and the starting cap.** Recommended: alerts at one half, four fifths and
    the cap, and a new paying account starts with a low cap and managed tokens at zero until an
    owner opts in and raises it. The owner sets the actual amounts at each GO-LIVE.
17. **Prepaid credit terms.** Recommended: credit is bought in the account's currency, is not
    transferable and earns no interest; a refund or an expiry is the owner's written decision and
    a compensating ledger event, shown before a purchase.
18. **The outbound legal review's scope (phase E).** Recommended: the later RFC names the
    jurisdictions, tax, consumer protection, sanctions and dispute rules before any merchant
    path is built; this RFC builds none of it.

## Links

- RFCs: [0024](0024-automagik-cloud.md) (amended here: open question 8 and Decided 14's "being
  paid"); [0017](0017-usagemeter-crate.md) (the meter part, its lane and build rule);
  [0018](0018-meter-query-contract.md) (the doc cannot be the source, provenance is not a bill);
  [0021](0021-meter-attribution.md) (machine-local attribution, never a billing identity);
  [0022](0022-desktop-chat-view.md) (Decided 6: approvals shown, never answered by keys);
  [0011](0011-monorepo-parts-and-releases.md) (lanes, one version, two-slot key rotation);
  [0010](0010-desktop-sandbox.md) (Arca, masks).
- Code: none in this repository is on the billing path. The Cloud service, the gateway and the
  host lifecycle are outside it; the meter (`meter/usagemeter/`) is evidence only.
- Outside, read-only and summarised: Stripe Billing, Billing Meters, test clocks and webhook
  signatures (the adapter's references); the council review of this direction (private); the
  owner's economic notes (private). Concrete entity, account, country and price values are kept
  in a private note, not here.
