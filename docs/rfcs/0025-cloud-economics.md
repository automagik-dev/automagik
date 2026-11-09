# RFC 0025: Automagik Cloud economics: billing, managed tokens and agentic payments

| Field | Value |
|---|---|
| Status | Draft (council 2026-11-09: revise; platform owner decisions 2026-11-09; amends 0024) |
| Milestone | none (ships outside the five milestones) |
| Lanes | none here (docs); desktop (3.N) or plugin (3.N.P) for a link; the Cloud service outside |
| Created | 2026-11-09 |

## Summary

RFC 0024 fixed the free and paid split and chose Stripe, then left model usage and agentic
payments to a follow-up. This RFC is that follow-up. Customers keep their own model keys or
plan sign-ins, free; managed tokens through a Cloud-run gateway are an opt-in at a published
margin. Compute is metered from the host lifecycle. Bots pay Cloud for Cloud's own resources
first, from the organisation's card or prepaid credit, inside grants an organisation Owner sets;
third-party merchants wait for a legal review and their own RFC. One append-only ledger, outside
the workspace, records each source event once and funds it one way; caps reserve a maximum or a
lease before the work; grants charge the authenticated token's scope, a budget and attribution,
within the workspace's total grants and caps; quotes bind the tenant, workspace and Bot; every
money approval is a passkey step-up in Cloud's page. Each phase opens only behind its own go-live
gate. This RFC is docs only: it opens no checkout, starts
no service and writes no billing code. It amends RFC 0024's open question 8, Decided 14's "being
paid", and its (g) workspace credential.

## Motivation

RFC 0024's (i) recommended "model usage on the workspace's own keys at first" (its open question
8) and recorded the platform owner's answer on billing: Stripe directly, "including support to
agentic payments" (its Decided 14), "Bots paying, or being paid, on a customer's behalf ... within
limits the human sets", to be detailed by a follow-up RFC after a brainstorm on the economics.
This is that follow-up, and the platform owner's decisions of 2026-11-09 (Decided 1 to 4) settle
the direction.

The obvious implementation, bill from the workspace's own meter, fails on the evidence this
repository already has:

- **The meter is local evidence, and this RFC never treats it as a bill.** usagemeter is a file
  on the machine (RFC 0017); RFC 0018 says its doc cannot be the source because it is truncated
  to its byte budget, so a missing row is not zero, and its evidence contract is for task
  linking. The one "not a bill" line in 0018 is about mikro's counters, not the meter's rows.
  Its store has no tenant and no billing identity, and RFC 0021 keeps session ids machine-local.
  A Bot with a shell can edit or delete it. None of that is a basis for charging a customer.
- **Billing truth has to be outside the workspace VM.** The gateway that serves managed tokens
  sees every call it bills, and Arca's host lifecycle sees every VM start and stop. The workspace
  sees neither as an authority, so it cannot write, alter or suppress the record.
- **A spend approval cannot be a terminal key.** RFC 0022's Decided 6 stops the rendered chat
  view from answering approval dialogs with keys until herdr-core#122 lands. That is a temporary
  stopgap for the view, not a rule for money: the person still answers in Code mode, the real
  terminal. The same late-key race, and the phone's (#852), is why money gets a stronger,
  permanent rule: a chat message, an hc message, terminal keys, or a desktop or Pocket tap are
  never an approval; the organisation Owner uses a passkey step-up in Cloud's own page.
- **Stripe is outside the workspace.** RFC 0024 already says no app or workspace talks to Stripe,
  a Bot holds no Stripe key or card, and every limit is an organisation Owner's and enforced by
  Cloud. The adapter, the webhook path and the ledger are Cloud's control plane, not a tenant's.

A council reviewed this direction on 2026-11-09 and returned a revise verdict: build the truth
and the ledger before the money paths, phase every charge behind its own go-live gate, and make
the safeguards acceptance tests rather than prose. Its conditions are Decided 5 to 13 below.

The public repository rule is part of the design: this RFC names no country, entity, Stripe
account, Stripe id or price. It says "the existing entity" and "a later second account"; the
values live in the Cloud service's private configuration.

## Decided

From the platform owner (2026-11-09):

1. **Model access is the customer's by default, at no charge.** A customer uses their own API
   keys or plan sign-ins. Managed tokens, through a Cloud-run gateway, are opt-in, per
   workspace, and sold at a published margin.
2. **Agentic payments start inbound.** Bots pay Cloud for Cloud's own resources (managed
   tokens, compute, new workspaces) from the organisation's card or prepaid credit, within
   grants an organisation Owner sets. Outbound payments to third-party merchants come later,
   after a legal review, in their own RFC.
3. **Billing-path changes need the platform owner's review before merge.** The ledger, the
   Stripe adapter, grants, quote signing and margins are billing-path changes; they are excluded
   from the normal merge rule.
4. **The existing entity and plain Stripe Billing.** Billing starts with the existing entity, in
   its local currency, on plain Stripe Billing for phases A to D. The Stripe adapter is keyed by
   `(Stripe account, customer)`, so a later second account can be added for a second currency
   and the agent rails. No country, entity, Stripe account, Stripe id or price is written in this
   repository or any other public text.

From the council review (2026-11-09; verdict revise; conditions folded in):

5. **Six phases, each behind its own go-live gate.** A: entitlements and a per-workspace
   subscription with seats as quantities; B: compute metered from the host lifecycle; C: managed
   tokens through the gateway, opt-in; D: Bot spend grants, inbound; E: external agent rails;
   F: outcome pricing. Earning money is a later platform-owner decision; no phase charges before
   its gate and the platform owner's written GO-LIVE record.
6. **Billing truth comes only from outside the workspace VM**: the gateway for tokens, the host
   lifecycle for compute. The tenant is taken from the authenticated source, never from the
   payload. A test proves that a Bot with a shell cannot write, alter or suppress a billable
   event.
7. **One append-only ledger in Cloud's control plane.** A usage event is keyed by
   `(source, source event id)`: `(gateway, request id)` or `(host lifecycle, VM event id)`. That
   pair is unique, and the usage gets exactly one appended funding event, unique on its usage
   event, whose state is `metered` or `credited`; it goes to the Stripe meter or is debited from
   credit, never both. Reconcile with Stripe every period, with recorded true-ups; an event is
   corrected by a compensating event, never edited.
8. **Hard real-time caps per workspace and per paying account**, enforced by Cloud, not by
   Stripe, with alerts at set fractions.
9. **Money grants.** Amounts plus currency; reserve, then settle, then release, each step atomic
   under concurrency (a test with N parallel calls). Each grant is bound to one signed quote with
   a single-use nonce; the quote names the tenant, workspace, Bot scope, merchant, amount,
   currency and expiry. The Bot scope comes from the authenticated token, never a payload name;
   it is a budget and an attribution label, not isolation, and the workspace's total grants and
   caps are the bound. Only an organisation Owner, after a passkey step-up on Cloud's page,
   creates or raises a
   grant; a chat message, an hc message, terminal keys, or a desktop or Pocket tap are never an
   approval. Defaults: Never for payments and card entry; spend is Ask,
   or Pre-approve with a low cap and a TTL of 24 h at most. One page lists grants with one-click
   revoke; every charge gets a receipt.
10. **Tactu-style safeguards are acceptance tests**: one adapter file; webhook signatures
    verified; deduplication by event id; state re-fetched from Stripe; 503 without secrets; live
    keys refused until a GO-LIVE record exists; the outbox drained before deprovision. Test-clock
    evidence (a full month, failure through grace through hold, replayed and out-of-order
    webhooks, a reconciliation) comes before any live key.
11. **Outcome pricing uses a verifier outside the workspace.** A workspace never certifies its
    own outcome.
12. **The open-source image and an unlinked instance contain no billing call path and no
    gateway path without Cloud's configuration.** The image carries no billing code and no
    built-in gateway address; Cloud supplies only configuration, and managed tokens exist only
    in Cloud workspaces. Without that configuration, the open-source image and an unlinked
    instance have no gateway address or credential. A static scan of the image's dependencies
    and imports and the no-connection test prove it.
13. **RFC 0024 is amended explicitly**: open question 8 on tokens, Decided 14's "being paid",
    and (g)'s "the workspace holds no Cloud credential", which now admits a scoped, short-lived,
    revocable gateway token and the control-plane identity that renews it. The amendments are
    listed below.

Carried, not new:

- From RFC 0024: the free and paid split; a subscription per workspace with seats as quantities;
  entitlements from signed, re-fetched Stripe state; owner-only billing (an admin never reaches
  it); card details stay on Stripe's pages; no workspace talks to Stripe; a Bot holds no Stripe
  key or stored card; every limit is an organisation Owner's and enforced by Cloud; notice and a
  grace period before stopping a workspace whose plan ended, with its data kept for the retention
  window.
- From RFC 0024's Decided 6 and (e): the identity service only authenticates; billing roles,
  grants and caps live in Cloud's database, keyed by the tenant, never in a group claim.
- From RFC 0017: the meter is a part on its own lane; this RFC adds that it is not on a billing
  path. Its local store, doc and attribution are evidence for display and reconciliation
  signals, never billing truth.
- From RFC 0018: the doc cannot be the source; its evidence contract is for task linking; this
  RFC keeps it away from money; a read never writes; null or unknown is never shown as zero.
- From RFC 0021: attribution stays machine-local; this RFC adds that it is not a billing
  identity.
- From RFC 0022: a rendered chat view never answers approval dialogs by typing keys until
  herdr-core#122; that is a temporary view rule, and the person still answers in Code mode. This
  RFC's money rule is permanent and wider: no chat message, hc message, terminal key, desktop
  tap or Pocket tap is an approval (see #852 for the phone race).
- From RFC 0011: two-slot key rotation for anything this RFC signs, and one version.

Proposed here: everything else.

## Design

### Words

- **Billable event**: one usage, one-off resource purchase, credit movement or true-up that Cloud
  records in its ledger. A Stripe Billing subscription invoice is Stripe's object, not a ledger
  event; it is reconciled and receipted.
- **Billing truth**: an event made from an authenticated source outside the workspace VM, with
  the tenant from that source, a price version and one funding event.
- **Platform owner**: the human who operates Cloud and may write or withdraw a GO-LIVE record;
  not an organisation Owner.
- **Organisation Owner**: the role in RFC 0024 that owns billing, grants and caps; an admin,
  member or guest is not one. The individual of a personal account is owner-equivalent.
- **Tenant**: the paying organisation or personal account. **Tenant tuple**: `(tenant, workspace,
  bot)`, where `bot` is self-reported attribution only, never authorisation; else
  `(tenant, workspace, platform)`.
- **Funding source**: `stripe_meter` or `credit`. **Funding state**: `metered` or `credited`, set
  once on the funding event and never both.
- **Source event id**: the gateway's request id or the host lifecycle's VM event id, unique per
  source. The pair `(source, source event id)` is the ledger's dedup key.
- **Managed tokens**: model tokens Cloud buys from a provider and serves through its gateway.
  **BYO**: the customer's own API key or plan sign-in, which Cloud never proxies or bills.
- **The gateway**: Cloud's model proxy and quote route: it authenticates the gateway token, checks
  caps and the token's grant, reserves a maximum, forwards the call with Cloud's provider
  credentials, counts what the provider reports, settles, writes the ledger event and returns
  the response. A workspace never sees a provider key.
- **Gateway token**: a scoped, short-lived, revocable credential minted by Cloud for a workspace,
  or for one Bot in it, with the gateway as its only audience. It cannot call Stripe or Cloud's
  control plane. A per-Bot token is a budget and an attribution label, not isolation inside the
  VM; the workspace's total grants and caps are the bound.
- **Host lifecycle**: Arca's record of a workspace VM's start, stop, resize and delete. It is the
  compute truth, not the meter inside the VM.
- **Price version**: an immutable id for a unit price, currency and margin. An event names one;
  a change makes a new version.
- **Merchant (payee)**: Cloud for an inbound purchase of Cloud's resources; a third party only in
  phase E.
- **Grant**: an organisation Owner's currency-denominated authorization, created from one signed
  quote, for charges inside the quote's authenticated scope. A per-Bot grant is a budget and an
  attribution label, not isolation; the workspace's total grants and caps are the bound.
- **Quote**: Cloud's signed offer of the tenant, workspace, Bot scope, merchant, amount,
  currency, price version and expiry, with a single-use nonce.
- **Reserve, settle, release**: hold an amount against a grant, charge the actual, return the
  remainder. Each step is its own ledger transaction; reserve and release are atomic with the
  grant state, and settle may arrive after the call.
- **Cap**: a hard limit per workspace and per paying account, enforced by a reservation before
  the billable action.
- **GO-LIVE record**: Cloud's control-plane record that a phase may charge real money, naming
  the platform owner's decision, the evidence, the Stripe mode and the rollback.
- **Existing entity**, **later second account**: the billing entity and Stripe account in use at
  the start, and an additive account for a second currency and the agent rails. Their names, ids
  and country are not public.
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
workspace; an organisation Owner turns them on with a passkey step-up; the published margin is
shown before the first call; turning them off stops new managed calls at once. Usage already
served settles. BYO resumes without a change to the workspace's data.

**Earning money is a later platform-owner decision.** This RFC designs the paths and their
gates; it turns none on. Each phase's GO-LIVE record is the platform owner's decision to charge
for that phase. A phase may merge behind a flag and run in test mode before that record; it may
not charge.

### (b) Phases and go-live gates

| Phase | What it adds |
|---|---|
| A | Entitlements; a workspace subscription with seats |
| B | Compute metered from the host lifecycle |
| C | Managed tokens through the gateway |
| D | Bot spend grants, inbound |
| E | External agent rails, outbound |
| F | Outcome pricing |

The full go-live gate for each phase is its Deliveries entry; this table is the order, not a
second gate list.

**A GO-LIVE record is required, not implied.** It is written in Cloud's control plane and holds
the phase, the scope, the platform owner's decision, links to the evidence, the Stripe mode, the
date and the rollback. The adapter reads it. No record means no live key and no real charge;
test keys and a test clock are allowed. Only the platform owner, after a passkey step-up, may
write or withdraw a record, and every write or withdrawal is audited; no Bot and no operator
account can. A record can be withdrawn, which stops new charges at once.

**The order is a safety order, not a preference.** A and B give Cloud a correct bill for things
it already does. C adds a new trust boundary (the gateway). D adds spend an organisation Owner
authorized. E and F add third-party and outcome risk and are not attempted until A to D have run
a full period in reconciliation.

**Each phase is behind its own gate.** A later phase never turns on an earlier one, and a phase
that fails its gate stays in test mode. A shared gate would let a strong phase hide a weak one.

### (c) Billing truth: outside the workspace VM

Only these sources can make a billable event, and all are outside the workspace VM:

1. **The gateway, for tokens.** It authenticates a short-lived gateway token minted from the
   workspace session or for a Bot seat, with the gateway as its audience (RFC 0024's workspace
   token keeps its one-workspace audience), reads the tenant and workspace from that token, and
   ignores any tenant or Bot in the request body. A token for another workspace, Bot or audience
   is refused. The gateway counts the provider-reported usage after the call; a stream that ends
   early is still counted for what the provider reports, and a cancelled stream is read to its
   end for the provider's final usage. If the provider reports no usage, the gateway records an
   estimate, marks its precision, and the period's reconciliation may true it up. It never reads
   the workspace's meter. The gateway mints the request id server-side and returns it; a
   client-supplied id is scoped to the token's tenant and workspace, and a repeat returns the
   stored result without forwarding the call again.
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

**The Bot field is attribution only, never authorisation.** The gateway token is minted for a
workspace, or for one Bot in it. Its scope, not a Bot name in a payload, selects which grant is
charged: a workspace grant covers the workspace's token; a per-Bot grant covers a token minted
for that Bot. That is budgeting and attribution, not isolation. Inside one VM any Bot with a
shell is owner-equivalent until RFC 0024's three safeguards hold: it can read another Bot's
token or ask the gate to mint one. The real bound is the workspace's total grants plus its caps,
enforced at the gateway. A payload's Bot name never selects, raises or bypasses a grant.

**No write path from the workspace.** The workspace can call the gateway as a client, its quote
route included, but it cannot insert a ledger row, change a price, stop a host lifecycle event,
or mark a charge settled. The ledger's writer is the Cloud service. The gateway and the
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
and truncated by its byte budget. A billing decision that reads it is a defect, and a test pins
that no billing path imports it.

### (d) One append-only ledger, one funding event

Cloud's control plane keeps one ledger for every billable event it records: usage, funding, holds,
credit movements, one-off resources and true-ups. It is append-only: no row is updated or deleted.
A correction is a new compensating event that names the one it corrects. The workspace has no
writer and no reader beyond the tenant's receipts and summaries.

| Field | Meaning |
|---|---|
| Event id | Immutable id of this event |
| Event type | `usage`, `funding`, `hold`, `credit`, `true_up` |
| Key | usage `(source, source event id)`; funding `usage_event_id`; hold `(hold_id, step)` |
| Source | `gateway`, `host_lifecycle`, `cloud`, `grant` or `reconciliation` |
| Tenant | The paying organisation or personal account |
| Tenant tuple | `(tenant, workspace, bot)`; `bot` is attribution only |
| Resource | Model and unit, VM shape and unit, or the one-off resource |
| Quantity and unit | What was consumed, in the price version's unit |
| Amount and currency | The charge in the funding event's currency |
| Price-version id | The immutable price and margin this event settles at |
| Server timestamp | The source's time, a field, not a key |
| Funding | `stripe_meter` or `credit`, and `metered` or `credited` on a funding event |
| Quote and grant | The authorizing grant and its quote, when any |
| Receipt id | The receipt issued when the event settles |

**One usage event, one funding event.** A usage event is immutable and unique on
`(source, source event id)`: the gateway's request id or the host lifecycle's VM event id. It gets
exactly one funding event, appended once and unique on `usage_event_id`; that event names
`stripe_meter` or `credit` and carries state `metered` or `credited`. A second funding event for
the same usage is refused, not written, so one usage goes to the Stripe meter or is debited from
credit, never both. Nothing updates a row: a retry of the usage returns the stored event, and a
retry of the funding returns the stored funding event. A server timestamp and a price version are
fields, not keys.

**Holds are their own events.** A reserve, settle or release appends an event keyed
`(hold_id, step)` and references the grant and charge; it is not a usage event and does not use
the source pair. A credit purchase, credit debit or true-up has its own event id and source
(`cloud` or `reconciliation`). Holds are rebuilt into the grant projection, never edited in it.

**Test.** A test delivers the same usage twice, attempts a second funding event from the other
source, and exercises the hold keys independently: one usage row, one funding event, one state,
and no updated row.

**Credit is funding, not a second usage event.** A credit purchase is a card charge that adds
credit; it is not a usage event and never also posts to the meter as usage. A credit debit is a
funding event. They are separate ledger events, and neither is ever both.

**Price versions.** An event settles at the price version it names, even after a later price or
margin change. A change is a new immutable version with its own id; it applies only to events
that name it. A retroactive change is a true-up event, never an edit. A price or margin change
is a billing-path change (Decided 3).

**Reconciliation every period.** At each period close, Cloud compares, per tenant, price version
and funding state, the funding events' sum with the Stripe meter, the subscription invoices and the
credit balance. A difference is written as a true-up event with the evidence and a reason, and
the reconciliation report is kept. A true-up can be positive or negative; it is never an edit to
an old event. The report is available to the organisation Owner and is part of the next phase's
go-live evidence.

**Outbox and deprovision.** The ledger event is the source; the Stripe meter post and the credit
debit are an outbox that retries. The outbox uses the funding event id as the Stripe meter
event's identifier or idempotency key, so a retried post is not counted twice at Stripe.
Stripe's identifier dedup window is checked before relying on it; a retry beyond the window is
closed by reconciliation and a true-up, not assumed to be deduplicated. Before a workspace is
deprovisioned, the outbox is drained, so its last usage is billed or credited; if it cannot
drain, deprovision waits and reports the reason. A late event after deprovision is a
true-up, not a lost charge.

### (e) Caps: reserve before the work

Every paying account and every workspace has a cap per period. Both apply; the lower remaining
amount wins. A cap is a currency amount in the account's currency. Cloud reserves against it
before the billable action, because the final cost is not known until afterwards.

- **Tokens: a maximum reservation.** Every managed call declares its maximum output tokens; if
  the request omits it, the gateway applies its own ceiling before forwarding. The gateway
  computes a maximum charge (the maximum output times the output price, plus the input estimate
  at the price version) and reserves it against both caps, and the grant when one applies,
  before forwarding. On completion it settles the actual cost and releases the rest. If the
  reserve does not fit, the call is refused before forwarding; no call runs unbounded. The
  gateway counts input tokens exactly before forwarding where the provider exposes them;
  otherwise it estimates, and any overrun settles against the cap, never forgiven. A provider
  response that would exceed the reserved maximum is stopped, and its usage is still counted.
- **Compute: a time lease.** The host lifecycle reserves compute in short time chunks (a lease)
  against the cap before a start or a renewal. The VM runs only inside a leased chunk. Before the
  lease ends, Cloud renews it if the cap remains; if it does not, the VM is paused (or suspended
  where pause is unavailable) after a short grace, with a notice to the organisation Owner. It is
  never deleted. Raising the cap or a new period resumes it. This is the cap path, separate from
  RFC 0024's notice and grace before a plan ends; both keep the data.
- **Cloud enforces it, not Stripe.** Stripe's meters and invoices have their own delays. The
  reservation is checked in Cloud's control plane, where the action is admitted, so a delayed
  Stripe update cannot let spend through.
- **Alerts at set fractions.** The organisation Owner sets the fractions; recommended are one
  half, four fifths and the cap. An alert goes to the organisation's owners (and the individual
  of a personal account) once per fraction per period, with the remaining amount and the
  workspace that crossed it.
- **Safe defaults.** A new paying account starts with a low cap, and managed tokens start at
  zero until an organisation Owner opts in and sets a cap. An organisation Owner can change a
  cap with a passkey step-up; an admin cannot.
- **A cap is not a grant.** A grant can only lower what a token may spend inside the cap.
  Revoking a grant never raises a cap, and raising a cap never raises a grant.

**Test.** Concurrent calls at the cap reserve exactly the remaining amount, the next one is
refused, a running VM at the cap pauses after the grace and is not deleted, alerts are recorded
once per fraction, and a delayed Stripe state changes none of it.

### (f) Grants, quotes and approvals

**A grant.** A grant holds an amount and a currency, a scope (`managed_tokens`, `compute` or
`new_workspace`), a period, an expiry, a state (`active`, `exhausted`, `revoked`, `expired`) and
its owner; its reservations carry `reserved`, `settled` or `released`. It is created from one
signed quote; the quote fixes the tenant, workspace, Bot scope, merchant, amount, currency,
price-version id and expiry, and its nonce is single-use. A second grant from the same quote is
refused. A quote may describe an envelope (for example, managed tokens up to the grant's amount
in its period), so one grant can fund more than one charge; the quote itself is never reused to
create a second grant. A charge draws on the grant only inside the quote's authenticated scope;
a grant never spans scopes.

**The token scope selects the grant to charge; it is not isolation.** The gateway token is
minted for a workspace, or for one Bot in it; the grant must match its tenant, workspace and Bot
scope for accounting. A payload Bot name is attribution only. But any Bot with a shell inside the
same VM is owner-equivalent until RFC 0024's three safeguards hold: it can read another Bot's
token or ask the gate to mint one. A per-Bot token or grant is therefore a budget and an
attribution label, not a security boundary; the workspace's total grants plus its caps, enforced
at the gateway, are the bound. A charge without a matching grant is refused once phase D is on;
before D, phase C is owner-only and the cap is the bound.

**Holds live as events.** A reserve, settle or release appends a ledger event, and the mutable
grant projection (available, reserved, settled) is rebuilt from those events. The projection is
updated in the same transaction as the event; if it is lost, it is rebuilt, not trusted. Each
hold has a time limit, and a sweeper releases an expired hold. A crash between reserve and
settle leaves the hold, and the sweeper releases it; a settle that arrives after a release is
recorded as a true-up.

**Reserve, settle, release, atomically.** A charge begins with a reserve that checks the grant's
available amount, the workspace cap and the paying account's cap, then holds the estimate in its
own ledger transaction. On completion, settle writes the actual and releases the remainder; on
failure or expiry, release returns the hold. The three steps are atomic per grant under
concurrency: a test issues N parallel reserves against a grant that can fund only K of them, and
exactly K succeed, the available amount never goes negative, the sum of reserved and settled
never exceeds the grant, and no reservation is orphaned. Concurrent settle and release calls are
idempotent by key, and a revoke while a reserve is in flight is tested.

**Only an organisation Owner (or a personal account's individual), after a passkey step-up.**
Creating or raising a grant needs a fresh WebAuthn assertion with user verification, valid for
that one action and at most five minutes. A session cookie, an admin, a member, a guest or a Bot
is refused. The step-up is Cloud's own page. This RFC's money rule is permanent and wider than
RFC 0022's view rule: a chat message, an hc message, terminal keys, or a desktop or Pocket tap
are never an approval, even after herdr-core#122 lands; #852 tracks the phone's late-tap race.

**Defaults.** For payments and card entry: **Never**. A Bot never enters card details and no
payment is made by default. For spend: **Ask**, the organisation Owner answers each spend with a
passkey step-up in Cloud's page. The organisation Owner may choose **Pre-approve**, with a low
cap and a TTL of 24 h at most; after the TTL the grant expires and the remainder is released.

**One page, one click.** One page lists every grant with its scope, amount, remaining, expiry,
state and last charge, and revokes it in one click. Revoking stops new reserves at once, settles
what is in flight and releases the remainder; it is audited. The page shows the cap next to the
grant so an organisation Owner sees the outer bound.

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
mode. Test keys and a test clock are allowed without it. The check catches restricted live keys
as well as secret live keys. A test proves no live charge can be made without the record, and
that withdrawing the record stops new charges.

**The outbox is drained before deprovision.** Deprovisioning a workspace waits for the outbox to
post its last events to the Stripe meter or the credit ledger. If it cannot drain, deprovision
waits, alerts and keeps the data; it never deletes the only record of a charge.

**Test-clock evidence before any live key.** On a Stripe test clock, Cloud runs a full month:
sign-up, seats added and removed, a failed payment through notice, grace and hold, a recovery, a
cancel, replayed webhooks, out-of-order webhooks and a reconciliation with a true-up. It first
confirms that Billing Meters work on the test clock, because the month's evidence depends on
them. The evidence is linked from the GO-LIVE record. No live key is used until it passes.

**Grace and hold.** A failed payment gets a notice and a grace period in which the workspace
runs; then the workspace is held (stopped, data kept for the retention window) and its
entitlements come from the re-fetched Stripe state, not from the failed event. A payment that
recovers before the hold restores the workspace without a new charge.

**No card, no key, no direct call.** Card details stay on Stripe's pages; Cloud stores no card.
No workspace and no Bot holds a Stripe key or calls Stripe. A Bot's inbound payment is a grant
and a receipt, not a card charge it makes itself.

**The signing keys stay in Cloud's control plane.** The quote-signing key, the gateway-token key
and the phase F verifier key live only there, never on a workspace node or the build host, in two
slots rotated as RFC 0011 rotates lane keys. A workspace holds only the gateway token, which can
call only the gateway.

### (h) The existing entity, a later second account and the review rule

Phases A to D bill through the existing entity, in its local currency, on plain Stripe Billing:
a subscription per workspace, seats as quantities, and Stripe's meters and invoices. No custom
billing engine sits between the ledger and Stripe.

The adapter's `(Stripe account, customer)` key is the seam for a later second account. Adding
one for a second currency and the agent rails is additive: existing customers and subscriptions
stay on the first account, new charges go to the second, and the ledger's amount plus currency
keeps them apart without conversion. A tenant can hold a customer in each account.

The names, ids, country, currency details and prices are private. Public text says "the existing
entity" and "a later second account"; tests, fixtures and defaults use placeholders. No Stripe
id, account name or price appears in a commit, a log, an example or this RFC.

**The review rule (Decided 3) has a named scope.** It covers every repository that carries a
billing path: the Cloud service, wherever it lives, and any billing piece that lands in this
repository. The platform owner is a required reviewer on a change to the ledger, the Stripe
adapter, grants, quote signing or margins; the normal merge rule does not apply, and an automated
merge cannot waive it.

### (i) Managed tokens and the gateway token

**Default: BYO.** The customer's own API keys or plan sign-ins, unchanged, with no Cloud charge.
Cloud does not proxy or count that traffic, and no billing path is opened for it.

**Opt-in: managed tokens.** An organisation Owner enables managed tokens for one workspace after
a passkey step-up and sees the published margin first. The workspace then points its model
client at Cloud's gateway, authenticated with a gateway token. The gateway checks the cap and the
token's grant, reserves a maximum, forwards the call with Cloud's provider credentials, counts
the provider-reported usage, settles and writes the ledger event. The workspace never sees a
provider key.

**The gateway token is scoped, short-lived and revocable; per-Bot is not isolation.** Cloud
mints it for one workspace, or for one Bot in it, with the gateway as its only audience. It lives
minutes. Renewal is authenticated by a workspace control-plane identity minted by Cloud at VM
start and held by the gate on its own volume, outside DSH's routes and Bot commands; the
organisation Owner's session is the fallback. That identity inherits the same limit: until RFC
0024's three safeguards hold, anything that can reach the gate's store can renew, so the
workspace is the boundary, not the Bot. The token is revoked at once on opt-out, removal, role
loss or grant revoke. It cannot call Stripe or Cloud's control plane, and it cannot be exchanged
for another workspace's token. A stolen token can spend inside the workspace's total grants and
caps, not one Bot's, until it is revoked or the workspace loses its entitlement; if the gate's
store is reachable it can also be renewed. The gateway binds calls to the workspace's attested
network identity where Arca provides it, so a token presented from outside the VM is refused. A
Bot's unattended run uses a token minted for its scope; it never holds a Cloud control
credential.

**The published margin.** The gateway's price is the provider cost plus a margin, published per
model and unit in a price version before opt-in. The same margin applies to every customer on
that version. A change is a new version with its own id and a published date; it is never
retroactive, and it is a billing-path change.

**Accounting and privacy.** The gateway stores no prompt or answer text beyond the transient
proxy; it keeps metadata for billing and reconciliation only. Retries are idempotent by request
id, so a retried call is counted once. A model's reported usage wins; an estimate is marked and
can be trued up. A caller that cancels a stream does not end the gateway's read: it keeps reading
the provider's stream for the final usage count, then settles. The gateway is the only token
truth; the local meter is not read.

**Opting out.** Turning managed tokens off stops new gateway calls at once; calls already in
flight settle; BYO resumes. A workspace never loses its data or its BYO configuration.

**No billing or gateway path without Cloud's configuration.** The gateway and the ledger live in
Cloud's control plane. The image carries no billing code and no built-in gateway address; Cloud
supplies only configuration. In a Cloud workspace, the gate holds the workspace control-plane
identity and the model client's gateway address, renews the gateway token, and Bots call the
gateway and its quote route. Without that configuration, the open-source image and an unlinked
instance have no gateway address, credential or billing code. A static scan of the image's
dependencies and imports (`server/secrecy.mjs` in `server-image.yml` will hold it) proves no
Stripe client, ledger writer, billing route or gateway default, and the no-connection test
proves the unconfigured image and an unlinked instance make no such call.

### (j) Inbound now, outbound later

**Inbound.** A Bot may ask the gateway, through its quote route, for a quote for a purchase or an
envelope of its own Cloud resources: managed tokens, compute, or a new workspace. The quote
route spends nothing; it checks the token's scope and the cap and returns a signed quote. The
quote names the tenant, workspace, Bot scope, merchant, amount, currency and expiry, and carries
a single-use nonce. The organisation Owner's grant is created from that one quote; the
grant funds the charge or charges inside the quote's scope. Cloud reserves, then settles by
charging the card or debiting credit, then releases the remainder and issues a receipt. A charge
names the grant and its quote; a quote is never reused for another grant, tenant or workspace.
The Bot never holds a card or a Stripe key. Funding is the organisation's card (through Stripe)
or its prepaid credit; every event has exactly one of the two.

**Prepaid credit.** An organisation Owner buys credit through Stripe; the ledger credits the
organisation's balance in the account's currency. A Bot charge debits that balance, with no
per-event card charge. Credit is not transferable and is not a second card; a refund or an expiry
is an organisation Owner decision recorded as a compensating event, never a silent edit.

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
period in reconciliation, a verifier design, and the platform owner's decision to earn on
outcomes.

## Amendments to RFC 0024

This RFC amends RFC 0024 (Draft) at each place marked there:

- **Open question 8 (What is paid).** Was: model usage on the workspace's own keys at first.
  Now: BYO model access is free; managed tokens are an opt-in through Cloud's gateway at a
  published margin; compute is metered from the host lifecycle; the workspace subscription and
  seats stay as recommended. The remaining shape is carried below as RFC 0024's question 8.
- **Decided 14 ("being paid").** Was: Bots paying, or being paid, on a customer's behalf. Now:
  inbound first; outbound to third-party merchants is deferred to phase E, after a legal review
  and its own RFC.
- **Question 9 (the billing system).** It records the follow-up RFC; 0025 is that RFC, and
  "being paid" is deferred (0025, (j)).
- **(i) Billing and entitlements, first paragraph.** Its model-usage sentence now reads as the
  platform owner's decision 1: BYO free, managed tokens opt-in at a published margin, compute
  metered.
- **(i) Billing and entitlements, agentic-payments paragraph.** Its "Bots paying, or being paid"
  sentence now reads with the deferral; the rest of (i) stands.
- **(g) Hosting, the workspace credential and its network.** A Cloud workspace may hold a
  scoped, short-lived, revocable gateway token, minted per workspace or per Bot, and the
  control-plane identity that renews it; the token can call only the model gateway, never
  Stripe or the control plane. A per-Bot token is a budget and an attribution label, not
  isolation; the workspace's total grants and caps are the bound. The gateway, including its
  quote route, is reachable from the workspace; the image carries no billing code, and Cloud
  supplies only configuration (0025, (i)).

Nothing else in RFC 0024 changes: its identity models, workspaces, rail, entitlements, Stripe
directly, no workspace talks to Stripe, owner-only billing and grace period stand.

## Contracts introduced

- **The ledger event, version 1.** The fields in (d), append-only; a usage event unique on
  `(source, source event id)`; one funding event per usage event, with state `metered` or
  `credited`; holds keyed `(hold_id, step)`. A new field is additive; a changed field meaning is a
  change to this RFC.
- **The price version, version 1.** An immutable id, unit, currency and margin, with a published
  date. Old events keep their version; a new version is additive.
- **The gateway token, version 1.** Scoped to one workspace; a Bot label is budget and
  attribution, not isolation. Audience the gateway, minutes long, renewable, revocable, and
  unable to call Stripe or the control plane.
- **The gateway contract, version 1.** A short-lived gateway token; no tenant as authority; the
  quote route; a maximum reservation before forwarding; a response with the model output and the
  usage Cloud counted; errors for cap, grant and auth. No provider key ever leaves the gateway.
- **The host lifecycle event, version 1.** VM id, workspace id (from Cloud's mapping), state,
  shape, start and stop times, and the source's own event id. A payload's tenant is ignored.
- **The quote, version 1.** A signed tenant, workspace, Bot scope, merchant, amount, currency,
  price-version id, expiry and single-use nonce. A quote is used once, for one grant.
- **The grant, version 1.** Amount, currency, scope, period, expiry, state, quote id and nonce.
  A change of amount is a new grant or a raise, never an edit of a settled one.
- **The cap document, version 1.** A per-workspace and per-account amount and currency, the
  alert fractions, the period and the lease chunk. Additive.
- **The receipt, version 1.** The charge's amount, currency, resource, grant, quote, funding
  source, ledger event, timestamp and state. Immutable.
- **The GO-LIVE record, version 1.** Phase, scope, platform owner decision, evidence, Stripe
  mode, date and rollback. The platform owner writes it with a passkey step-up; the adapter reads
  it before a live key.
- **The Stripe adapter key.** `(Stripe account, customer)`, with the webhook endpoint and signing
  secret in the Cloud service only; the outbox uses the funding event id as the meter event's
  identifier or idempotency key. No value is written here.
- **The signing keys.** Quote signing, gateway tokens and phase F verification, in Cloud's
  control plane only, in two slots; never on a workspace node or the build host.
- **The entitlements document, additive.** New fields for managed tokens, compute and grants;
  older readers ignore them. A changed meaning is a change to this RFC.
- **No new plugin id, route prefix or storage prefix in existing plugins.** A customer-facing
  link or a field read is additive; billing routes are Cloud's.

## Threat model

**A Bot with a shell.**

- It can edit or delete the local meter. That changes no bill: the ledger reads the gateway and
  the host lifecycle, and a test pins that no billing path reads the meter.
- It can forge a gateway request. The gateway trusts only the gateway token's tenant, workspace,
  Bot label and audience, checks the cap and the token's grant, and counts the provider's usage;
  the forged request is either refused or billed as its own call, not as another tenant's.
- A Bot name in the payload is attribution only. It cannot select, raise or bypass a grant; the
  token's scope selects the budget.
- Any Bot with a shell can read another Bot's token or ask the gate to mint one until RFC 0024's
  three safeguards hold. A per-Bot token or grant is a budget and an attribution label, not
  isolation; the workspace's total grants and caps are the bound.
- It can try to suppress compute. The host lifecycle is Arca's, outside the VM; a missed stop is
  reconciled from the VM's state. The shell test proves no write, alter or suppress succeeds.
- It can call Cloud's public routes. It cannot write the ledger, sign a quote, create a grant or
  mark a charge settled.

**Double charging.**

- A retried source event is one ledger row by `(source, source event id)`.
- A usage event has one funding event and one state; a card failure never silently becomes a
  credit debit, and a second funding attempt is refused.
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
- A live key, restricted or not, is refused without a matching GO-LIVE record; only the platform
  owner can write or withdraw the record, with a passkey step-up and an audit trail.
- A missing secret is a `503`, not a fake success.
- Quote-signing, gateway-token and verifier keys stay in Cloud's control plane, in two slots.

**Grants and approvals.**

- A grant race is closed by the atomic reserve, settle and release and the N-parallel test.
- A quote replay is refused by its single-use nonce; a quote from another tenant, workspace or
  Bot is refused.
- A grant is created or raised only by an organisation Owner after a passkey step-up; an admin,
  a member, a guest and a Bot are refused.
- A spend approval is never a chat message, an hc message, a terminal key, or a desktop or
  Pocket tap; even after herdr-core#122 lands, this RFC's permanent money rule holds (#852).
- A stolen session cannot raise a grant or approve an Ask without a fresh step-up.
- The default is Never for payments and card entry; spend is Ask, or a low-cap, 24-hour
  Pre-approve.

**Caps.**

- A token call reserves its maximum before forwarding; the actual settles and the rest releases.
- Compute runs inside a leased chunk; at the cap it pauses after a short grace, is never deleted,
  and the organisation Owner is notified.
- Enforced in Cloud before the action; a delayed Stripe update cannot admit spend.
- A cap is per workspace and per paying account, and the lower wins.
- A cap change needs an organisation Owner's step-up; a grant never raises it.

**Managed tokens.**

- The gateway holds the provider credentials; the workspace never sees them.
- The gateway token is scoped to one workspace, with an optional Bot label for budget and
  attribution, not isolation; exfiltration is bounded by the workspace's total grants and caps,
  and a stolen token can be renewed if the gate's store is reachable.
- Prompt and answer text is not stored beyond the transient proxy; billing metadata is kept.
- A cancelled stream is read to the end for the provider's usage, so cancellation is not free.
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
  the law and the reconciliation require, and a receipt stays available to the organisation Owner.

**The open-source image and an unlinked instance.**

- No Stripe client, ledger writer, billing route or gateway default; a static scan of the image's
  dependencies and imports (`server/secrecy.mjs` in `server-image.yml`) fails on one.
- No connection to Cloud's billing or gateway service; the no-connection test fails on one.
- Managed tokens exist only in Cloud workspaces; a Cloud workspace's gateway token can call only
  the gateway.

**Undo.**

- Stop charging a phase by withdrawing its GO-LIVE record; new charges stop, in-flight settles.
- Cancel a subscription at Stripe; the entitlement follows the re-fetched state and the grace
  period.
- Revoke a grant in one click; release the remainder.
- Turn off managed tokens; the workspace returns to BYO, and its gateway token is revoked.
- A bad charge is corrected by a true-up or a refund, never by editing the ledger.
- No undo step reaches into a self-hosted instance; it never had a billing or gateway path.

## Deliveries

This RFC is docs only. Its deliveries are listed for the Cloud service and Arca, outside this
repository; a delivery that needs a customer-facing link or an entitlement field here is its own
plugin or desktop PR and never mixes lanes. Each phase has its own go-live gate; a phase may
merge behind a flag and run in test mode before the gate, but it may not charge.

**The ledger contract (acceptance for every phase).**

- One usage event per `(source, source event id)`; one funding event per usage event; no row
  updated or deleted; hold events keyed `(hold_id, step)`; credit and true-up events with their
  own ids; `source` includes `cloud` and `grant`.
- The gateway mints the request id and returns it; a client-supplied id is scoped to the token's
  tenant and workspace, and a repeat returns the stored result without forwarding the call.
- Stripe's meter-event dedup window is checked before relying on it; a retry beyond the window is
  closed by reconciliation and a true-up.
- Input tokens are counted exactly before reserving where the provider exposes them; otherwise
  an estimate is used and any overrun settles against the cap.
- Without Cloud's configuration, the image has no billing code, gateway address or credential;
  an unlinked instance has no gateway path.
- The gateway binds a token to the workspace's attested network identity where Arca provides
  it; a token presented from outside the VM is refused.

**Phase A: entitlements and the workspace subscription.**

- *What ships:* the per-workspace subscription with seats as quantities, on plain Stripe Billing
  through the existing entity in its local currency; entitlements from signed, re-fetched Stripe
  state; the owner-only billing page; notice, grace and hold.
- *Go-live gate:* the platform owner's GO-LIVE record plus a full test-clock month: sign-up, seat
  changes, a failed payment through notice, grace and hold, a recovery, a cancel, replayed and
  out-of-order webhooks, and a reconciliation.
- *Check:* only the platform owner, after a passkey step-up and with an audit trail, can write or
  withdraw a GO-LIVE record; no Bot or operator account can. An admin cannot reach billing; a bad
  webhook signature changes nothing; a missing secret is `503`; a live key, restricted or not, is
  refused without the record; no workspace or Bot talks to Stripe; no price or account value is
  in the repository.
- *Rollback:* stop new subscriptions and withdraw the record; existing entitlements run to the
  period end; data is kept.

**Phase B: compute metered from the host lifecycle.**

- *What ships:* Arca's VM lifecycle events into the ledger, mapped to the tenant in Cloud's
  database; the workspace and account caps for compute, with a time lease; alerts; the period
  reconciliation.
- *Go-live gate:* the shell test, a full period of compute events reconciled with recorded
  true-ups, Billing Meters confirmed on the test clock, and the platform owner's GO-LIVE record.
- *Check:* a Bot with a shell cannot write, alter or suppress a compute event; a missed stop is
  reconciled from Arca's state; a running VM at the cap pauses after the grace and is not
  deleted; the outbox posts with the funding event id and a retry is not double-counted; a delayed
  Stripe state admits no extra compute.
- *Rollback:* stop metering compute and withdraw the record; the workspace keeps running on its
  plan; a true-up records the period's actual use.

**Phase C: managed tokens through the gateway, opt-in.**

- *What ships:* the gateway, the published margin and price version, the workspace opt-in, the
  gateway token and its renewal, the ledger path for tokens, and the cap and grant checks.
- *Go-live gate:* BYO is the default; the shell test; a full period of token events reconciled;
  the margin published before opt-in; the platform owner's GO-LIVE record.
- *Check:* a workspace with BYO makes no Cloud billing or gateway call; a gateway call without a
  valid token is refused; a token for another tenant, workspace or Bot is refused; a revoked
  token stops at once; a token expires and renews only while the workspace is entitled, and a
  stolen one is bounded by the workspace's total grants and caps, not one Bot; a Bot with a shell
  can use another Bot's token until RFC 0024's safeguards hold; an edited local meter changes no
  bill; a cancelled stream still settles the provider's usage; opting out stops new calls;
  without Cloud's configuration, the open-source image has no billing code, gateway address or
  credential, and an unlinked instance has no gateway path, proven by the static scan and the
  no-connection test.
- *Rollback:* turn managed tokens off and withdraw the record; workspaces return to BYO; served
  usage settles; tokens are revoked.

**Phase D: Bot spend grants, inbound.**

- *What ships:* grants, quotes and the single-use nonce; holds as events with a sweeper;
  reserve, settle and release; the organisation Owner's passkey step-up; the defaults; the
  one-page grant list and revoke; receipts; card and prepaid credit funding.
- *Go-live gate:* the N-parallel atomicity test, the step-up, revocation and receipt tests, a
  crash between reserve and settle, a full period reconciled, and the platform owner's GO-LIVE
  record.
- *Check:* only an organisation Owner after a step-up can create or raise a grant; N parallel
  reserves admit exactly K; a quote replay, or a quote from another tenant, workspace or Bot, is
  refused; a payload Bot name never selects a grant; a Bot with a shell can use another Bot's
  token, and the workspace's total grant and cap bound it; a revoke while a reserve is in flight
  is safe; a hold expires and the sweeper releases it; a settle after release is a true-up;
  every settled charge has a receipt; a Bot
  holds no card or Stripe key; the default is Never for payments and card entry; a chat message,
  an hc message, a terminal key, or a desktop or Pocket tap is never an approval.
- *Rollback:* revoke grants and withdraw the record; in-flight charges settle; the card and
  credit paths stop for new Bot spend.

**Phase E: external agent rails, outbound.**

- *Not delivered here.* Its own RFC, after a legal review of merchant payments in the relevant
  jurisdictions, sets the merchant path, the limits, the receipts and the disputes.
- *Go-live gate:* that RFC's gate, the legal review and the platform owner's decision; no merchant
  credential or outbound path exists before it.
- *Check:* none in this RFC; the default is Never and there is no switch.
- *Rollback:* nothing to roll back here; the phase does not exist.

**Phase F: outcome pricing.**

- *Not delivered here.* It waits for A to D to run a period in reconciliation, a verifier outside
  the workspace, and the platform owner's decision to earn on outcomes.
- *Go-live gate:* the verifier's acceptance, the platform owner's decision and the same
  test-clock and reconciliation bar.
- *Check:* a workspace cannot certify its own outcome; a dispute is a compensating event.
- *Rollback:* nothing to roll back here; the phase does not exist.

**Every billing-path change.** A pull request touching the ledger, the Stripe adapter, grants,
quote signing or margins needs the platform owner's review before merge and is excluded from the
normal merge rule. The rule covers the Cloud service and any billing piece in this repository. It
covers a schema, a migration, a webhook handler, a key, a grant state, a quote format and a price
or margin. The platform owner is a required reviewer; a phase's gate and an automated merge
cannot waive it.

## Open questions

### Carried from RFC 0024

The full question text stays in RFC 0024, and the platform owner's answer is recorded there.
This list is the pointer and the recommendation, so the two RFCs do not drift into two homes.

- **RFC 0024 Q3, the isolation unit.** Recommended: one Incus VM per workspace; an unprivileged
  container only for the operator's own; never privileged; settled at the isolation gate.
- **RFC 0024 Q4, who may invite.** Recommended: owners and admins, and the individual of a
  personal account; members and guests cannot.
- **RFC 0024 Q5, recovery.** Recommended: a second passkey at the claim, recovery codes as slow
  hashes, and the host reset out of the Bots' reach; no email reset.
- **RFC 0024 Q6, session lifetimes.** Recommended: self-hosted sessions slide with a 12-hour idle
  limit; Cloud workspace tokens 5 minutes; DSH's multi-day cookie is the delivery 0 evidence gap.
- **RFC 0024 Q7, IP-only LAN installs.** Recommended: no passkeys there; an SSH tunnel or pairing
  from a signed-in session; no TOTP fallback without its own review.
- **RFC 0024 Q8, what is paid (amended).** Recommended: BYO free; managed tokens opt-in at a
  published margin; a per-workspace subscription with seats; compute metered; personal and
  self-hosted free; included seats and host shape at GO-LIVE.
- **RFC 0024 Q10, moving a self-hosted instance into Cloud.** Recommended: a separate, later
  decision; linking moves no data.
- **RFC 0024 Q11, DSH's authentication hook.** Recommended: the gate now; propose a hook
  upstream (RFC 0023) and move to it only once DSH ships one.
- **RFC 0024 Q12, Omni's sign-in.** Recommended: Omni keeps its own for outside Omnis; behind a
  gate it takes the gate's principal with its own sign-in off.
- **RFC 0024 Q13, an optional external OIDC provider.** Recommended: not planned; the principal
  contract leaves room later.
- **RFC 0024 Q14, federation for company customers.** Recommended: RFC 0024's delivery 0 checks
  it; decide before the first company customer, since a later issuer move re-binds everyone.
- **RFC 0024 Q15, Pocket and Pocket Link.** Recommended: unchanged; Pocket pairs through Pocket
  Link's keys; a phone sign-in to a web instance is a passkey of the same owner.
- **RFC 0024 Q16, is the Cloud service open source?** Recommended: its contracts (principal,
  workspace token, entitlements, rail API) are public here; the service starts private.
- **RFC 0024 Q17, the desktop's Cloud credential and local Bots.** Recommended: a
  delivery-H-style mask per OS; keep desktop Cloud sign-in off until it exists; or the platform
  owner's written acceptance.
- **RFC 0024 Q18, until the three safeguards hold.** Recommended: Cloud workspaces stay
  owner-only; the narrower no-shell-Bots alternative is not recommended.

### New here

1. **The cap fractions and the starting cap.** Recommended: alerts at one half, four fifths and
   the cap; a new paying account starts with a low cap and managed tokens at zero until an
   organisation Owner opts in and raises it. The organisation Owner sets the actual amounts at
   each GO-LIVE.
2. **Prepaid credit terms.** Recommended: credit is bought in the account's currency, is not
   transferable and earns no interest; a refund or an expiry is the organisation Owner's written
   decision and a compensating ledger event, shown before a purchase.
3. **The outbound legal review's scope (phase E).** Recommended: the later RFC names the
   jurisdictions, tax, consumer protection, sanctions and dispute rules before any merchant
   path is built; this RFC builds none of it.
4. **Unattended spend beyond a day.** Recommended: keep the 24-hour maximum on Pre-approve; a
   longer unattended run needs a fresh owner step-up or a separate design, not a longer TTL.

## Links

- RFCs: [0024](0024-automagik-cloud.md) (amended here: open question 8, Decided 14's "being
  paid", and (g)'s workspace credential); [0017](0017-usagemeter-crate.md) (the meter part and
  its lane); [0018](0018-meter-query-contract.md) (the doc cannot be the source; its evidence
  contract is for task linking; this RFC keeps it away from money);
  [0021](0021-meter-attribution.md) (machine-local attribution; this RFC adds it is not a
  billing identity); [0022](0022-desktop-chat-view.md)
  (Decided 6: the chat view does not type approval keys until herdr-core#122; this RFC's money
  rule is permanent); [0011](0011-monorepo-parts-and-releases.md) (lanes, one version, two-slot
  key rotation); [0010](0010-desktop-sandbox.md) (Arca, masks).
- Code: none in this repository is on the billing path. The Cloud service, the gateway and the
  host lifecycle are outside it; the meter (`meter/usagemeter/`) is evidence only. The image's
  static scan will live in `server/secrecy.mjs`, run by `server-image.yml`.
- Outside, read-only and summarised: Stripe Billing, Billing Meters, test clocks and webhook
  signatures (the adapter's references); the council review of this direction (private); the
  platform owner's economic notes (private). Concrete entity, account, country and price values
  are kept in a private note, not here.
