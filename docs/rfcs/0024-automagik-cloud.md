# RFC 0024: Automagik Cloud

| Field | Value |
|---|---|
| Status | Accepted (2026-11-10, by the owner; council review 2026-11-09: proceed with conditions, folded in; owner's answers: Q1 and Q9, 2026-11-09; amends RFC 0008; amended 2026-11-09 by [RFC 0025][25]) |
| Goal | First goal (owner, 2026-11-10): by 23 Nov, the owner signs in and opens one hosted workspace in test mode, with no real charges: RFC 0024 deliveries 0-4 and RFC 0025 phase A. |
| Milestone | none (ships outside the five milestones) |
| Lanes | none here (docs); desktop (3.N) for secure storage, sign-in and the rail; the server image and plugin (3.N.P) for the self-hosted gate and the web rail; the Cloud service outside this repository |
| Created | 2026-11-09 |

## Summary

Automagik has two identity models, and plugins see one principal from either.

- **Self-hosted** (open source, free): one instance, one human. A web instance or the server
  image is claimed by its owner on first run, with a one-time code shown only on the host, and
  then signed in with passkeys that an Automagik gate in front of a loopback DSH checks itself.
  No account and no outside service. The desktop app's own local DSH keeps the trust it has
  today (the OS user and a per-launch token on loopback) and asks for no passkey. Nothing
  self-hosted calls Cloud.
- **Automagik Cloud**: our sign-in for customers, companies with people or individuals who
  invite others. A single new identity service (a self-hosted Pocket ID, an OpenID Connect
  provider with passkeys) serves Cloud and only authenticates; Tactu may move to it later, while
  Arca keeps its own sign-in. Cloud's own database holds organisations, members, roles,
  invitations and the workspace rail, keyed by issuer and subject, never by email. Each workspace
  is a hosted instance with its own Bots,
  people, Omni channels, data and terminals; a rail lists them and its `+` creates one, on the
  web and on the desktop. Until three safeguards exist ((f), "Before anyone but an owner
  joins"), a Cloud workspace is for its owners only.

This RFC decides the principal contract, the claim and its recovery, the origin rules, the
desktop's sign-ins (RFC 8252, with secure token storage first), Cloud's organisations and
invitations, the rail by entitlement rather than a fork, which Bots each person may talk to,
where workspaces run, how Cloud users reach the identity service, what is paid, how a
self-hosted instance may be linked to Cloud, and the phases. It amends RFC 0008 (its web sign-in,
its desktop client, its questions 2, 6 and 7 and its threat model). The owner answered two
questions on 2026-11-09: the identity service is one new instance for Cloud, which Tactu may join
later (Decided 13, corrected 2026-11-10: Arca keeps its own sign-in), and billing is Stripe
directly, agentic payments included (Decided 14).

## Motivation

Owner direction (2026-11-09, verbatim): "now we need to brainstorm about automagik cloud, which
will allow creating new projects workspace, and even having the left bar. the open source will
not have it multi instance this way, its free for one instance. web or desktop, as is... how
would we do it? first of all human authentication, i want to use the same id system im using for
tactu and arca", then: "cloud login system is on ssh server > tactu project and arca", then:
"i want to do 2 things out of this. 1. each self hosted automagik is claimed and authenticated
on self hosted instance, for one human, and the automagik cloud is out authentication system for
our customers, which will be companies with people, or individual who might also invite other
humans".

Today:

- **A self-hosted web instance has a bearer link, not an owner.** The server image (`server/`,
  `server-image.yml`) runs the `automagik-web` profile bound to loopback inside its container,
  behind DSH's token fence, and writes the launch URL, token included, to a `0600` file on the
  volume. Whoever holds that URL is in: no person, no passkey, no way to end one session.
- **The desktop app trusts its OS user.** It starts a local DSH and opens it with the launch URL
  DSH prints. Any process of the same user can already read that token and the window's cookies,
  as RFC 0022's threat model records. A passkey there would add a prompt and no protection.
- **RFC 0008 ("Platform and web instances", Queued)** recommended any standard OIDC provider the
  instance owner configures (its question 2), and one instance at a time, never local and remote
  together (questions 6 and 7). The two models here change all three; this RFC amends it.
- **The left bar mockup (v7, private, not in the repository)** puts a rail of workspaces at the
  far left: only workspaces, "Add workspace" and the person; the bar beside it has four modes
  (Pulse, Team, Channels, Routines). Nothing draws a rail today.
- **Other people are out of scope so far.** RFC 0022 left "other people in the view (teams of
  humans, an instance rail)" to its own RFC (its Decided 7), with Buzz's author gate as the
  model. This is that RFC for people and the rail.
- **Tactu already signs people in** through the identity service it uses today, as a plain OIDC
  relying party: authorization code with PKCE, `state` and `nonce`, a person keyed by issuer and
  subject, sliding sessions with rotation and reuse detection, and a setup code that only the
  host's command line can mint. Its notes also show the limits of the deployed Pocket ID: flat
  groups, signup links that are bearer links not tied to an email, and one full-admin API key
  with no narrower scope. Its waitlist work decided how outsiders reach the identity service (a
  public edge, below).

## Decided

From the owner (2026-11-09, above):

1. **Two identity models.** A self-hosted instance is claimed by its one human and authenticated
   on the instance. Automagik Cloud is the authentication system for customers: companies with
   people, or individuals who may invite other people.
2. **The open-source product is one instance, free**, on the web or the desktop, as it is. Cloud
   is where many workspaces, creating one, and the rail live.
3. **Cloud uses the same identity system as Tactu and Arca**: Pocket ID. Which instance is
   Decided 13.

From the council review (2026-11-09; five lenses, proceed with conditions; relayed by the
Automagik Orchestrator). Nine conditions, numbered 4 to 12:

4. **RFC 0008 is amended here, not bypassed**: its questions 2, 6 and 7, and its threat
   model's Authentication line (Amendments to RFC 0008).
5. **The claim covers web instances and the server image only.** The desktop's local DSH stays on
   OS-user trust with its per-launch token on loopback, with no claim and no passkey.
6. **Pocket ID only authenticates.** Cloud's database holds organisations, members, roles,
   invitations and the rail, keyed by `(issuer, sub)`, never by email. Authorization is checked
   on every request, never taken from group claims in a token.
7. **One principal contract**, `{ issuer, subject, roles, workspace }`, everywhere. Plugins never
   branch on which provider signed the person in.
8. **Authentication lives in an Automagik gate in front of a loopback DSH**, covering every route
   and WebSocket. No DSH runtime patch.
9. **Origins: `localhost`, or a stable HTTPS name.** IP origins are refused, with the reason.
10. **Recovery is out of the Bots' reach**, or the RFC says plainly that local sign-in does not
    guard against the instance's own Bots. It says both ((c), "What it does not guard").
11. **Desktop OIDC per RFC 8252, with secure token storage, ships first**, as its own delivery.
12. **Tenant compute isolation is its own review gate**, separate from identity.

From the owner's answers (2026-11-09, asked by the Automagik Orchestrator):

13. **One new identity service for Cloud** (open question 1). A single new identity service (a
    self-hosted Pocket ID): Cloud uses it, and Tactu may move to it later, as its own project's
    decision. It is a new instance, not the one Tactu uses today. Isolation between products
    comes from a separate OIDC client and separate groups per product, and from Cloud's own
    database for organisations and roles. Standing the instance up waits on the owner's separate
    OK. Moving Tactu to it is its own work, later, and not a delivery of this RFC.
    *Corrected 2026-11-10 (Arca's orchestrator, via Automagik Chat):* Arca keeps its own sign-in
    (its own passkey approvals) and does not move to the new identity service.
14. **Billing is Stripe, directly** (open question 9), "including support to agentic payments"
    (the owner, verbatim). Cloud uses Stripe Billing itself, a subscription per workspace, and
    Stripe's signed webhooks update Cloud's entitlements; no other billing app. Agentic payments
    are a direction, to be detailed by a follow-up RFC ((i)).
    *Amended by [RFC 0025][25] (2026-11-09):* "being paid" is deferred; the inbound direction,
    Bots paying Cloud for Cloud's own resources, comes first, and outbound payments to
    third-party merchants wait for a legal review and their own RFC (0025, (j)).

Carried, not new:

- From RFC 0022: Decided 7 (other people follow Buzz's gate: owner-only by default, an allowlist,
  never "anyone" for the main bot, stop and cancel owner-only), kept as it is, stop and cancel
  included; its provenance rule; its threat model's same-user reach; delivery H's mask, which
  this RFC asks for on the desktop too ((d)).
- From RFC 0019: Arca's GitLab on the build host, and the root-equivalent risk recorded there.
- From RFC 0011: one version, lanes, two-slot key rotation.
- From Tactu's login and waitlist decisions (read-only): the host-only setup code; one-use
  invitations minted by the product; no general admin key of the identity service in a tenant's
  reach; a dedicated, allowlisted public ingress for the identity service.

Proposed here: everything else.

## Design

### Words

- **Instance**: one DSH runtime with Automagik's plugins and its own data.
- **Self-hosted**: an instance a person runs themselves: the desktop app's local DSH, or a web
  instance (the server image, or a host install). One human.
- **The owner** (self-hosted): the one human who claimed the instance, or, on the desktop, the OS
  user running it.
- **The gate**: Automagik's authentication front, in front of a DSH bound to loopback. It is the
  only thing a browser talks to.
- **Workspace**: one hosted instance in Cloud, with its own Bots, people, Omni channels, data and
  terminals; one tile on the rail. (RFC 0005's "workspace" is a folder inside an instance, shown
  as the repos base; the two never meet in the interface.)
- **Organisation**: a Cloud customer with people. **Personal account**: one Cloud person, who may
  still invite others into their workspaces. Every workspace belongs to exactly one of the two.
- **The Cloud service**: the control plane: accounts, organisations, memberships, invitations,
  entitlements and the rail; the only relying party of the identity service; mints workspace
  tokens. It runs no Bot.
- **The identity service**: the single new Pocket ID that Cloud signs people in with (Decided 13;
  corrected 2026-11-10: Tactu may move to it later, Arca keeps its own sign-in). Its address,
  client ids and group names are not written in this repository.
- **Principal**: who is acting, as plugins see it ((b)). Not DSH's own `principal` caller field
  (RFC 0015), which DSH writes only for a caller other than its owner; (b) says how they meet.

### (a) The product split: one codebase, the rail by entitlement

**Self-hosted is the product as it is, plus an owner on the web.** One instance, one human, every
plugin, the Herdr pack, am and Pocket. No account, no call to Cloud, no rail. In one plain
sentence, shown where a self-hosted owner looks for "invite": *one human per instance; to invite
people, use Cloud.* There is no hidden multi-user path in the free edition.

**Cloud is the same app, signed in.** No fork, no second build, no closed module in the client.

| State | What the person sees |
|---|---|
| Not signed in to Cloud (the default) | today's app, no rail; one "Sign in to Automagik Cloud" entry in settings that calls nothing until used |
| Signed in, no workspace entitlement | the same, plus the account and a "Get workspaces" link |
| Signed in, entitled | the rail: one tile per workspace, grouped by organisation; on the desktop a "This computer" tile first; `+`; the person's avatar |

**The rail is a view of the Cloud service's answer, not a gate.** Anyone can force the open client
to draw it, and that buys nothing: tiles come from the Cloud service, `+` is a request it grants or
refuses, and a workspace accepts only tokens minted for it. Every limit is enforced on the server.

**Where the rail is drawn.** On the desktop, by the shell, beside the bar: a tile switches the
window between this computer's local DSH and a workspace's origin (RFC 0008's "the desktop app as
a client", with the rail as its switcher). On the web, by the bots-dsh client inside each
workspace; a tile is a top-level move to that workspace's origin, which the Cloud session turns
into a silent sign-in. One renderer serves both, after mockup v7.

**This computer beside Cloud workspaces.** One tile is active, its name is in the window's header,
and nothing runs in two places at once; that keeps RFC 0008's concern (the person always knows
where the work runs) while changing its answer (Amendments to RFC 0008).

### (b) One principal contract

Every request a plugin sees carries one principal, whoever proved it:

```text
{ issuer, subject, roles, workspace }
```

| Where | `issuer` | `subject` | `roles` | `workspace` |
|---|---|---|---|---|
| Desktop, its own local DSH | `local:<instance-id>` | the owner record's local id | `owner` | the instance id |
| Self-hosted web instance, claimed | `local:<instance-id>` | the owner record's local id | `owner` | the instance id |
| Cloud workspace | the identity service's issuer | the person's subject there | from Cloud's database: `owner`, `admin`, `member` or `guest` | the workspace id |
| Self-hosted instance linked to Cloud ((j)) | the identity service's issuer | the owner's Cloud subject | `owner` | the instance id |

- A person is keyed by `(issuer, subject)`, never by email or display name.
- Plugins read the principal and never branch on how it was proved (OS user, passkey, OIDC). A
  check that needs "is this the owner" asks the roles.
- The gate (or, on the desktop, the shell) is the only place a principal is made. DSH and the
  plugins receive it from the gate, never from a header a browser can set.
- **The channel matters.** Today the gate can only reach DSH as DSH's owner, through DSH's launch
  token, so DSH and its own routes would see every person as the owner, and any Bot shell that
  reads that token is owner-equivalent. For one human (self-hosted) that is the documented limit
  of (c). For anyone else it is not enough: (f)'s precondition asks for a channel no Bot can
  forge, carrying the principal into DSH's own caller field (`principal`, RFC 0015) or an
  equivalent that DSH's routes filter on.
- **The owner record** holds a stable local id, made at the claim (or at the desktop's first
  run), plus an optional linked `(issuer, subject)` ((j)). Linking later rewrites nothing. A
  record written by a newer build never reads as "unclaimed" in an older one: a downgrade test
  pins it, because a downgrade that forgot the owner would reopen the claim.

### (c) Self-hosted web instances: the gate, the claim and passkeys

**Scope.** Web instances and the server image: anything a browser reaches over a network. Not the
desktop's own local DSH ((d)).

**The gate, not a DSH patch.** An Automagik-owned process in front of a DSH bound to loopback,
the shape `server/entrypoint.mjs` and Omni's UI front already have. It covers every route and
every WebSocket; a request without a session gets `401`, and `401` stays the healthy answer for
the image's smoke and health check. DSH and its token fence stay as they are, behind it. The gate
holds DSH's launch token on the server side; once the instance is claimed, the bearer launch URL
is no longer a sign-in path for a browser, a QR code or a file reader. If DSH upstream later
offers an authentication hook, moving to it is its own change (open question 11). The gate checks
passkeys itself (WebAuthn, through a maintained server library such as SimpleWebAuthn, MIT,
pinned exact).

**The claim fails closed.**

1. Until it is claimed, the gate serves only on loopback, reached on the host or through an SSH
   tunnel; it listens on its published address only after the claim. Every route but the claim
   page answers `401`.
2. On first start the gate makes a claim code: 128 bits, single use, valid 15 minutes, kept only
   as a hash, compared in constant time, rate-limited. It is shown on the host console when the
   gate runs in an interactive terminal, else only written to a `0600` file in the gate's own
   store; in the image, with no terminal, stdout is the container's log, so the file is the only
   place. It is **never logged**, never sent over the network, never in a URL, and no page can
   read it. A code that expires is replaced only from the host side: the next start, or the host
   command of "Recovery", makes a new one.
3. The claim page takes the code (posted, never in a URL) and registers a passkey. The first
   claim wins atomically and cannot be replayed; a test pins that two concurrent claims leave
   exactly one owner.
4. The claim offers a second passkey at once, and shows one-time recovery codes, stored as slow
   hashes.

**Signing in afterwards.** A passkey on the instance's own origin. The owner adds and removes
passkeys from settings. One human, several devices: a phone and a second computer are more
passkeys of the same owner, not more people.

**Origins.** Passkeys bind to a host name, and the browser allows them only in a secure context:

- **Loopback**: served as `localhost` (a valid passkey host; `127.0.0.1` is not).
- **LAN or remote**: a stable HTTPS host name.
- **An IP origin is refused** for enrolment and sign-in, with the reason on the page. There is no
  bearer-link fallback for IP-only installs. The supported paths are an SSH tunnel to loopback
  (RFC 0008's) or pairing a new device from a session that is already signed in. A TOTP-style
  fallback is not offered; it would need its own review.
- The gate pins the passkey host (RP ID) and checks the exact origin, port included. It records
  the host the passkeys are bound to and, when the host name changes, offers re-enrolment through
  a recovery code or the host reset.

**Sessions.** `__Host-` cookies, `HttpOnly`, `Secure` under TLS, `SameSite=Lax`, no `Domain`,
bound on the server to the origin they were made for. Short-lived and sliding, rotated on
renewal, a reused old secret revoking the family, a session list and "sign out everywhere".
**Every passkey change and every recovery revokes every session.** One limit, said plainly:
loopback cookies ignore the port, so a cookie can leak to any other loopback service (a dev
server a Bot started included), and a local process that holds it can replay it with any
`Origin` it likes; the origin binding does not stop that. On loopback, local processes are
inside the host's trust, as on the desktop.

**Recovery for a lost passkey.** No email reset (there is no email and no outside service).

- **A recovery code**: one use, logged, rate-limited like the claim, then straight to adding a
  passkey.
- **A host reset**: a command run by the host's operator. It talks to the gate only through a
  local socket or file, never HTTP; it removes every passkey and session and starts a fresh claim,
  with the gate back on loopback only until that claim.

**What it does not guard: the instance's own Bots.** The gate guards the instance against the
network. Bots run commands on the same host, and in today's server image as the same user as DSH
(the image has one `USER 1000:1000`).
A Bot led by a page or a prompt could read DSH's launch token and call DSH on loopback as the
owner, or read the gate's store and the reset command, and so register its own passkey. Host-shell
recovery proves ownership only where the Bots cannot reach it. So:

- the gate runs apart from DSH: in the server image, as its own container sharing only the network
  namespace, with its store on its own volume that the DSH container never mounts (the gate reads
  DSH's volume read-only, for the launch token), and the reset command run in the gate's container
  by the host operator; on a host install, as a separate OS user; on other systems, behind a
  delivery-H-style mask (RFC 0022) once one exists there;
- DSH's own token stays reachable by its Bots until DSH or the sandbox (RFC 0010) masks it; that is
  outside this RFC.

Until both hold on a given platform, the gate's settings say it plainly: *sign-in protects this
instance from the network, not from its own Bots.*

### (d) The desktop: OS-user trust, secure storage and RFC 8252

**Its own local DSH: no claim, no passkey.** The app starts DSH on loopback with a per-launch
token and opens it, as today. The OS user is the owner: any process of that user can already read
the token and the window's cookies (RFC 0022's threat model), so a passkey would add a prompt and
no protection. The shell makes the principal `{ local:<instance-id>, <owner id>, owner, <instance>
}` and hands it to DSH over the process boundary, never a browser. If a launch token must reach a
window at all, it goes over IPC to the app's own host process, never as a URL a browser or QR code
can carry.

**Secure token storage, first.** Nothing in the app stores a secret securely today. Delivery 1
adds it through Electron's `safeStorage`: the Keychain on macOS, DPAPI on Windows, the Secret
Service on Linux. Where Linux has no secret store, `safeStorage` falls back to a fixed key; the app
detects that, keeps refresh tokens in memory only, asks for a sign-in at each launch and says why.

**Secure storage is not out of the Bots' reach.** It keeps tokens off plain files, not away from
the user's own processes. The desktop's DSH Bots run commands as the same user: on Linux, the
Secret Service and the `safeStorage` key answer any process of that user; on every OS, a
workspace's cookies sit in the app's own data folder. A local Bot led by a page could take the
person's Cloud session, with owner or admin power over every workspace. So **desktop Cloud sign-in
is off on an OS until a delivery-H-style mask exists there** (RFC 0022's delivery H, widened): DSH
Bots' commands run with the secret store, the session bus and the app's data folder masked, as H
masks hc and `~/.ssh`. Recommended: build the mask. The alternative, an explicit written owner
acceptance of the risk per OS, is recorded only if the owner chooses it (open question 17). The
same applies to a remote self-hosted instance's session held by the desktop.

**Sign-ins to anything remote: RFC 8252.** For Cloud and for a remote self-hosted instance, the
app never shows a sign-in page in its own window and never embeds a browser for it:

- it opens the system browser with the authorization code flow, PKCE (S256), `state` and `nonce`,
  and an exact loopback redirect, `http://127.0.0.1:<port>/callback`, on a port the app bound
  before opening the browser and closes after one request or a few minutes;
- it checks `state`, `nonce`, issuer and audience, and trades the code and verifier for tokens;
- a short access token stays in the main process's memory; the refresh token, rotated on each use
  (a rotated one presented again revokes the family), goes to secure storage; the page never holds
  either;
- against a remote self-hosted instance, the gate implements only this code exchange for its own
  owner, after a passkey sign-in in the browser;
- both servers (the Cloud service and a remote gate) accept any loopback port, as RFC 8252 (7.3)
  requires, and publish the same contract: discovery, the issuer, the audience, and who issues the
  ID token.

**The deep link was weighed and is not used for it.**

| | Loopback redirect (chosen) | Deep link (`automagik://`) |
|---|---|---|
| Who can catch the code | only a process that bound that exact port first | any app that registers the scheme; on Linux the last desktop entry wins |
| With PKCE | a caught code is useless without the verifier | the same, but a hijacked scheme still breaks sign-in |
| The link contract | unchanged | broken: `deeplink.js` says an `automagik://` link "only ever opens", because any page can fire it |
| Works where | every OS, no registration | packaged builds only |

`automagik://` stays open-only and never carries an authorization code.

### (e) Cloud identity: organisations, people and sign-in

**Pocket ID authenticates; Cloud authorizes.** The identity service proves who the person is
(passkeys) and returns an ID token. The Cloud service is its one confidential client (its secret in
a `0600` file or a secret store), with PKCE, `state`, `nonce`, issuer and audience checks. From the
token Cloud takes `(issuer, sub)` and nothing else it trusts: an email the token carries is
self-asserted, so it is shown, never used as a key. Group claims are not used for authorization.
Organisations, members, roles, invitations, workspaces and the rail live in Cloud's own database,
and every request and every workspace session is checked against it.

**Organisations and personal accounts.** Every Cloud person has a personal account and may create
an organisation or be invited into one. A workspace belongs to one organisation or one personal
account and moves only by an owner's transfer.

| Role | What it may do |
|---|---|
| Owner | everything: billing and plan, delete or transfer the organisation and its workspaces, manage admins; at least one per organisation |
| Admin | people and roles below owner, create and delete workspaces, connect Omni channels, set model keys; no billing, no deleting the organisation |
| Member | the workspaces they are added to: the Bots the gate allows, their own work, the team |
| Guest | one workspace; only the Bots allowlisted for guests; no terminals, Code mode or settings |

Owners and admins see every workspace of the organisation; members and guests see the ones they
are added to. Someone an individual invites joins that personal account's workspace as a member
or a guest, never as its owner.

**Invitations are Cloud records.** Single use, with an expiry, revocable, and checked on the
server when accepted. An email may address an invitation, but membership binds to the `(issuer,
sub)` of the person who accepts it, never to the email. If the person has no account at the
identity service yet, they need one first. The identity service is Cloud's (Decided 13), and
Tactu may join it later, so its admin key reaches Cloud's accounts and, if Tactu moves, Tactu's
too; Arca keeps its own sign-in, outside it. Cloud's web tier never holds it. A one-use signup
link comes from a narrow, audited backend job in the operator's control, which takes only "one
link, one use, Cloud's group, this expiry" and is never reachable from a workspace or a page.
Cloud's client and groups are Cloud's own, separate from Tactu's and Arca's, so an account made
for Cloud gets nothing in another product.

The organisation shows each member with the invitation they used, and an owner or admin can remove
them at once.

**On the web.** The Cloud service's pages sign the person in and keep a server-side session behind
a `__Host-` cookie on the Cloud origin, under the session rules of (c). Opening a workspace goes
through the Cloud service, which mints a workspace token for that one workspace ((g)).

**On the desktop.** RFC 8252, as (d) describes, against the Cloud service.

**Revocation is bounded for sign-in, not for what a shell left behind.** Workspace tokens live 5
minutes at most; refresh tokens rotate; the gate's own session lasts no longer than a workspace
token, or rechecks the role with the Cloud service when it renews. The Cloud service tells a
workspace to drop a person's sessions at once when they are removed or their role is lowered (a
signed call, with a poll of a revocation list as the fallback). So a removed person can no longer
**sign in** to any workspace within 5 minutes at worst, and at once when the call lands. That is
not the end of their reach if they had a shell: through a Bot with shell tools they could have
left a reverse tunnel over the workspace's internet access, a scheduled job or a copied secret.
Removing someone who had a shell is followed by rotating the workspace's secrets and reviewing its
processes, or by a restore from before they joined. "Sign out everywhere", and the identity
service's own end-session where its discovery document offers one; the Cloud session is revoked
either way.

### (f) Workspaces, people and Bots

**One workspace is one hosted instance**: its own DSH, plugins, Bots and Bot registry, Omni and
channels, volume, terminals and herdr-core. Not a shared multi-tenant runtime. Nothing in one
workspace reads another's. A workspace never holds hc machine links to a member's own computers
(RFC 0014's "Other machines"); reaching a person's machines from a workspace is out of scope.

**Before anyone but an owner joins.** Inside a workspace, DSH sees whoever the gate sends as DSH's
owner, because the gate reaches it with DSH's launch token ((b)). Universal Bots have shell tools
by default, so a member or guest allowed to talk to one could have it read that token and call DSH
directly, as the owner: past the role table, past "no terminals" for guests. No member or guest
joins a workspace until all three hold:

1. **An unforgeable principal channel.** The principal reaches DSH and the plugins on a channel no
   Bot can forge (not the launch token on loopback).
2. **Role-filtered DSH routes.** DSH's own routes are filtered by role, at the gate or through a DSH
   hook (open question 11).
3. **The launch token out of the Bots' reach.** DSH's token is masked from Bot commands.

**Until all three exist, Cloud workspaces are owner-only**: only the organisation's owners and
admins (or the individual of a personal account), who are owner-equivalent inside DSH anyway. The
roles, invitations and Buzz's gate below are built and tested behind that line, and switched on for
members and guests only when the three hold.

**Which Bots a person may talk to.** Buzz's author gate (RFC 0022), per Bot. In a workspace,
"owners" means the organisation's owners and admins, or the individual of a personal account:

- **Owner-only**: the default for every Bot, and for the main bot unless an owner widens it to an
  allowlist.
- **Allowlist**: owners plus named members or guests.
- **Anyone in the workspace**: every member; guests still need the allowlist. Never offered for the
  main bot (RFC 0022, Decided 7).
- **Fail closed**: a Bot whose gate cannot be read answers owners only.
- **Stop and cancel are owner-only**, whatever the mode, as RFC 0022's Decided 7 has it; a member
  cannot stop even a turn they started.
- **Provenance**: every message in a shared chat carries its author's principal (RFC 0022's rule,
  widened to named people); a Bot is told who wrote it, as data.

Terminals and Code mode are owners' by default; an owner may grant them to a member per Bot,
because Code mode is the raw terminal. Guests never get them.

### (g) Hosting: where workspaces run

**On Arca**, the Incus-based kernel the team runs (RFC 0010), on Arca nodes that are **not the
build host**, from the server image the release already builds, scans and smokes
(`server-image.yml`), with the gate of (c) in its Cloud mode: it accepts workspace tokens instead
of a claim. One image, no second one for Cloud. Each workspace pins the image by the digest the
release itself recorded, never `:latest` (RFC 0019 notes the published image is not signed), and
the Cloud service rolls releases one workspace first.

**The identity service and the first test workspace VMs** run in a restricted Incus project on
Arca's own hosting, operated by Arca; no host name is written in this repository.

**Builds stay where RFC 0019 put them** (GitHub Actions for the image; Arca's GitLab, on the build
host, for the Linux gates). The build host runs no workspace and holds no Cloud key and no
identity-service admin key: team agents run there, with the root-equivalent reach RFC 0019
records. On a workspace node, no agent account holds `incus-admin` or any group equal to root.

**Isolation is its own review gate** (Decided 12), before any outside person joins. The unit is
decided (Q3: one Incus VM per workspace); the gate reviews this shape:

- one Incus virtual machine per workspace, not a shared kernel, since each runs arbitrary commands
  for people other than the operator (Tactu's rule: any non-owner is a tenant, paying or not); an
  unprivileged system container only for the operator's own workspaces; never a privileged one;
- its own volume and network; the internet and the Cloud service's public key and revocation
  endpoints are reachable, the private network, the build host, Arca's control socket, the
  identity service's admin routes and other workspaces are not; reached only through the Cloud
  edge, on its own origin;
  *Amended by [RFC 0025][25] (2026-11-09):* the model gateway, including its quote route, is
  also reachable as a named Cloud route; the workspace's gateway token can call only that
  gateway (0025, (i)).
- its own secrets (model keys, Omni credentials, Bot secrets), valid nowhere else;
- CPU, memory and disk limits from its plan.

**Workspace tokens.** Issuer the Cloud service, audience one workspace id, the principal's
subject, roles and workspace, 5 minutes at most, signed with the Cloud service's key (two slots,
rotated as RFC 0011 rotates lane keys). The gate accepts only its own audience, checks the Cloud
service's published public keys, and sets its own session on its own origin. A token for one
workspace is refused by every other; the workspace holds no Cloud credential. A rail tile hands the
workspace a single-use code that the gate exchanges with the Cloud service on the server side,
never a token in a URL.
*Amended by [RFC 0025][25] (2026-11-09):* a Cloud workspace may also hold a scoped, short-lived,
revocable gateway token, minted per workspace or per Bot, and the control-plane identity that
renews it, held by the gate outside DSH's routes. The token can call only the model gateway,
never Stripe or Cloud's control plane. A per-Bot token is a budget and an attribution label, not
isolation inside the VM; the workspace's total grants and caps are the bound (0025, (i)).

**Backups.** Per workspace: scheduled snapshots of the volume, an encrypted copy off the host
under a per-workspace key the workspace never holds; a restore makes a new instance and keeps the
old one stopped until an owner confirms; a restore drill before the first outside person and then
on a schedule; deletion stops at once and destroys everything after a retention window shown to
the owner (recommended 30 days). The identity service and Cloud's database get the same: backups,
a restore drill, a documented break-glass admin.

### (h) Reach: the identity service off the private network

Today's identity service, the one Tactu uses, answers only on a private network. The new one
(Decided 13) is built for customers from the start, on the pattern Tactu's waitlist decided for
its outside adopters:

- **a dedicated ingress for the identity service only**, through its own tunnel, with an exact
  allowlist of host name, paths and methods (sign-in pages, signup-link pages and the OIDC
  endpoints a relying party needs); admin routes denied there and reached only from the private
  network;
- **never routed into a reverse proxy shared with other sites**;
- Cloud's own pages and the workspace origins on a public edge of their own; the Cloud service
  reaches the token endpoint over the private path.

Standing the new instance up, its ingress included, waits on the owner's separate OK. Tactu's
current instance stays as it is until Tactu moves.

### (i) Billing and entitlements

**Free**: the self-hosted product, complete, one instance, one human; a Cloud personal account
with no workspace. **Paid**: hosted workspaces. Recommended: per workspace per month, seats
included up to a limit, model usage on the workspace's own keys at first (open question 8).
*Amended by [RFC 0025][25] (2026-11-09):* model access is free on the customer's own keys or
plan sign-in; managed tokens are an opt-in through Cloud's gateway at a published margin;
compute is metered from the host lifecycle (0025, (a) and (c)).

**Entitlements are the Cloud service's; the app only reads them.** A plan sets an organisation's or
a personal account's workspaces, seats and host size. The Cloud service refuses `+` and invitations
past the limits, returns the entitlements signed and short-lived so the app can draw the rail and
explain a greyed `+`, and stops a workspace whose plan ended only after a notice and a grace
period, keeping its data for the retention window.

**Stripe, directly** (Decided 14). Cloud uses Stripe Billing itself: a subscription per workspace,
seats as quantities. Stripe's signed webhooks, checked by the Cloud service, update Cloud's
entitlements; no other billing app sits between them, and no app or workspace talks to Stripe.
Card details stay with Stripe's own pages.

**Agentic payments: a direction, to be detailed by a follow-up RFC.** The owner asked for "support
to agentic payments": Bots paying, or being paid, on a customer's behalf through Stripe's
agent-payment features, within limits the human sets. A follow-up brainstorm on the economics
(from the owner's Tactu economic system) comes first. What this RFC fixes now: a Bot never holds a
Stripe secret key or a stored card; every limit (amount, merchant, period) is set by an owner and
enforced by the Cloud service, never by the Bot; every payment is recorded with the Bot and the
human who set its limit.
*Amended by [RFC 0025][25] (2026-11-09):* inbound first; outbound to third-party merchants is
deferred to phase E, after a legal review and its own RFC; the ledger, grants, caps and go-live
gates are in 0025.

### (j) How the two meet

**An unlinked self-hosted instance never calls Cloud**: no sign-in, licence check, telemetry,
heartbeat or entitlement fetch. Updates come from the release lanes (RFC 0011), which are not
Cloud. A test pins that neither the server image nor the desktop, unlinked and not signed in,
opens a connection to the Cloud service.

**Linking is the owner's explicit step** (a late phase, optional). From the instance's settings,
signed in with the local passkey (or, on the desktop, as the OS user) and then to Cloud, the owner
confirms. The instance then:

- accepts exactly one more principal: the owner's own Cloud `(issuer, sub)`, with the role
  `owner`; this is the only reason it ever talks to Cloud (to fetch the public keys that check
  that principal);
- keeps the local claim and passkeys as break-glass;
- gives no one else access: organisation members get nothing on it, its shell least of all
  (RFC 0022, Decided 7); sharing it later goes through Buzz's gate, owner-only by default;
- appears on the owner's Cloud rail as a "Self-hosted" tile that opens its own address.

Unlinking removes that principal and the tile and restores local-only sign-in. Linking never merges
accounts by email. **Identity does not move data**: importing a self-hosted instance into a Cloud
workspace is a separate step with its own decision (open question 10).

### (k) Omni's own sign-in

Omni has its own: a passkey or a WhatsApp code on Omni's page, and one-time grants that
`omni://connect` carries (`deeplink.js`). With this RFC the product would have three sign-ins.
Boundary (Decided by Automagik Chat, 2026-11-10; open question 12): Omni's sign-in stays Omni's,
for an Omni a person connects to from outside; inside a Cloud workspace or behind a self-hosted
gate, Omni's UI sits behind the gate and takes the gate's principal, with its own sign-in off, so
one person signs in once per instance.

## Amendments to RFC 0008

This RFC amends RFC 0008 (Queued); each amended line is marked there.

- **Summary, and Web instances (its two sign-in bullets).** Was: web instances sign in with OIDC.
  Now: a self-hosted web instance stays on loopback until claimed, then the gate signs its owner in
  with passkeys; OIDC is Cloud's ((c), (e)).
- **The desktop app as a client.** Was: a remote instance replaces the local DSH. Now: the local
  DSH stays, as "This computer", beside remote instances (question 7 below); remote sign-in is RFC
  8252 ((d)).
- **Contracts.** Was: an OIDC client registration for web instances. Now: none for self-hosted;
  Cloud's one client.
- **Threat model, Undo.** Was: revoke the OIDC client. Now: the gate's host reset, or a release
  without the gate, for self-hosted; revoking the client is Cloud's undo.

- **Question 2 (which sign-in provider).** Was: any standard OIDC provider the instance owner
  configures. Now: a self-hosted web instance signs its owner in with the local claim and passkeys
  through the gate ((c)); Cloud signs people in through Pocket ID ((e)). An optional external OIDC
  provider for self-hosters stays possible later through the principal contract, but is not
  planned (open question 13).
- **Question 6 (several instances).** Was: one at a time, a switcher later. Now: the Cloud rail is
  that switcher, for a signed-in, entitled person ((a)).
- **Question 7 (local and remote together).** Was: no. Now: yes on the desktop, with "This computer"
  as the first tile and one tile active at a time ((a)).
- **Threat model, Authentication.** Was: "OIDC as above". Now: the gate in front of a loopback DSH
  on every route and WebSocket, with a passkey session after the claim, or a Cloud workspace token;
  the desktop's own local DSH on OS-user trust.

What stands in RFC 0008: `install.sh`, Windows builds, shell-like relays off until sign-in is
reviewed, tokens in the OS's secure storage, and TLS in front of anything off the machine (now in
front of the gate).

## Contracts introduced

All new; nothing existing is renamed or moved.

- **The principal** `{ issuer, subject, roles, workspace }`, version 1; `issuer` is
  `local:<instance-id>` or the identity service's issuer. A new field is additive; a changed
  meaning is a change to this RFC.
- **The owner record**: a stable local id and an optional linked `(issuer, subject)`, in the gate's
  own store (on the desktop, the app's own home), outside every Bot's folder. A newer record never
  reads as unclaimed in an older build. The instance id in `local:<instance-id>` is random, made
  once, never derived from the host, so two instances never share an issuer.
- **The gate** (server image and host installs): the claim page, passkey routes, session routes,
  the claim code's `0600` file, the host reset's local socket or file, its Cloud mode.
  Compatibility: an existing server-image deployment keeps its launch URL until its first start with
  the gate, which then stays on loopback until claimed. The image's health contract (only `401` is
  healthy) holds. DSH's token fence stays behind it, unchanged.
- **Desktop secure storage**: items under the app's name, one per Cloud account or remote
  instance. A downgrade leaves them unused; the Cloud service can revoke its own.
- **The loopback redirect** `http://127.0.0.1:<ephemeral port>/callback`, per sign-in.
- **`automagik://`** keeps its open-only contract; no authorization code is ever carried on it.
- **The workspace token**: issuer the Cloud service, audience one workspace, the principal, 5
  minutes at most; the Cloud service's public keys in two slots. Version 1.
- **The entitlements document**: signed, short-lived, version 1, additive.
- **The Cloud client** in the identity service: one confidential client and Cloud's own groups,
  separate from every other product's. Their ids, the secret and the group names are not in this
  repository; tests and default configs use placeholders.
- **Stripe**: Cloud's webhook endpoint and its signing secret, in the Cloud service only.
- **The desktop rail's state**: the active tile and order, in the app's own home.
- No new plugin id, route prefix or storage prefix in existing plugins.

## Threat model

**Self-hosted web instance.**

- **Reach.** Loopback until claimed; then its published `localhost` or HTTPS name. Nothing without a
  session, on every route and WebSocket.
- **Claiming someone else's instance.** The code is shown only on the host, never logged, single
  use, 15 minutes, constant-time, rate-limited; the gate is loopback-only until claimed; the first
  claim wins atomically.
- **The bearer link.** Retired as a browser sign-in once claimed; DSH's token stays server-side.
- **Lost passkey.** A recovery code (one use, logged) or the host reset; every change revokes every
  session. No email reset.
- **Stolen session.** `__Host-` cookies bound to the origin on the server, short, rotated, reuse
  detection, "sign out everywhere".
- **The instance's own Bots.** Not guarded until the gate's store and reset are out of their reach
  on that platform and DSH's token is masked; said plainly in settings ((c)).
- **A cookie leaked on loopback.** Replayable by a local process with any `Origin`; local processes
  are inside the host's trust ((c), "Sessions").
- **Calls out.** None to Cloud unless linked; a test fails otherwise.

**Desktop.** Its own local DSH: the OS user, as today; same-user processes are inside that trust.
Remote sign-ins: RFC 8252, a loopback port bound first, PKCE, `state`, `nonce`, issuer and audience
checked; refresh tokens in secure storage or in memory only; the page holds no token. **Local Bots
can read the Cloud credential**: secure storage and the app's data folder answer any process of the
same user, so a Bot led by a page could take the person's Cloud session, with owner or admin power
over every workspace. Desktop Cloud sign-in stays off on an OS until the mask of (d) exists there,
or the owner accepts the risk in writing for that OS.

**Cloud.**

- **Reach.** The Cloud service's pages and the identity service's allowlisted sign-in routes are
  public. A workspace is reached only with a session from a token minted for it. Admin routes of the
  identity service, Arca's control socket, the build host and any admin-key job are unreachable from
  the internet and from every workspace.
- **Authorization.** Cloud's database, checked on every request; never email, never group claims.
- **Account takeover.** Passkeys only. An admin of the identity service can mint a login code for
  any account in it, Cloud's and, if Tactu moves, Tactu's (Decided 13): one admin, the owner, with
  its audit log reviewed; the admin key only in the operator's narrow, audited signup job.
- **One workspace against another.** Its own review gate ((g)): a VM each, one-audience tokens, no
  shared volume, network or credential.
- **A member against an owner.** Inside DSH, every person the gate lets through is the owner, and a
  Bot shell that reads DSH's token is owner-equivalent ((b), (f)). So no member or guest joins until
  the three safeguards of (f) hold; until then workspaces are owner-only. After that: roles from
  Cloud's database in the token; Buzz's gate per Bot, fail closed; stop and cancel owner-only;
  terminals and Code mode owners' unless granted; authorship from the principal.
- **Removal.** Sign-in ends within 5 minutes at worst, at once on the revocation call, and on a
  lowered role too. What a person with a shell left running (a reverse tunnel, a job, a copied
  secret) is not ended by that: secrets are rotated and processes reviewed, or the workspace is
  restored.
- **Payments.** Bots hold no Stripe key or card; limits are an owner's and enforced by the Cloud
  service; details in [RFC 0025][25] ((i)).
- **The Cloud service.** Holds the client secret and token keys, never on the build host, in two
  slots; any admin key of the identity service only in a narrow, audited backend job.

**Undo.** Self-hosted: the host reset, or an image without the gate (DSH's fence is still behind
it). Cloud: turn off Cloud sign-in (apps fall back to not signed in), revoke sessions, stop
workspaces, remove the client, close the ingress. No Cloud step touches a self-hosted instance.

## Deliveries

Each phase is one PR per lane; a PR never mixes lanes. The Cloud service and Arca's setup are
outside this repository. **The test bar for every identity delivery**: sign-in end to end under a
virtual WebAuthn authenticator in CI; negative tests for a wrong origin or port, a replayed or
expired code, a second claimer, and every route and WebSocket without a session; OIDC negative tests
(bad `state`, `nonce`, issuer or audience, a missing verifier) against a throwaway provider; no real
host name, issuer or client id in a test or a default config.

0. **This RFC and its evidence gaps** (docs; no release). Answer before acceptance: whether DSH's
   web server offers an authentication hook; Pocket ID's capabilities beyond the version Tactu used
   (organisations, scoped API keys, email-bound invitations, federation, SCIM); passkeys on
   `localhost` and platform authenticators per OS and browser; `safeStorage` without a Linux secret
   store; what a desktop mask needs per OS ((d)). *Check:* a written record, private where it names
   hosts. *Rollback:* none needed.
1. **Desktop secure storage and RFC 8252 sign-in** (desktop, 3.N; first, Decided 11; behind a
   setting, with no Cloud yet). `safeStorage` with the Linux fallback detected; the system-browser
   flow with PKCE, `state`, `nonce`, issuer and audience checks and the exact loopback redirect.
   *Check:* against a throwaway provider, a sign-in completes; each OIDC negative case is refused; a
   second loopback request is refused and the port closes; with no secret store nothing is written;
   `automagik://` still only opens. *Rollback:* a desktop release without the setting; stored items
   go unused.
   *Acceptance (from review):*
   - the contract the desktop meets is pinned, for the Cloud service and for a remote gate's code
     exchange alike: discovery, the issuer, the audience and who issues the ID token;
   - both servers accept any loopback port (RFC 8252, 7.3);
   - the setting is off by default.
2. **The self-hosted gate** (server image; plugin lane if the gate ships as a module). The gate in
   front of loopback DSH, the claim, passkeys, origins, sessions, recovery codes, the host reset,
   the owner record and the principal, the gate as its own container with its own volume.
   *Check:* the test bar; loopback-only until claimed; the code in no log and no response; two
   concurrent claims leave one owner; an IP origin is refused with its reason; the launch URL signs
   no browser in after the claim; every passkey or recovery change revokes every session; a newer
   owner record is not "unclaimed" to the older build; the DSH container cannot read the gate's
   volume; the smoke still sees `401`; no request leaves for Cloud. *Rollback:* an image without the
   gate; DSH's fence is in front again, as today.
   *Acceptance (from review):*
   - an expired claim code is replaced only from the host side (a restart, or the host command);
   - in the image, with no terminal, the code goes to the `0600` file only, never to stdout;
   - the recovery-code route is rate-limited;
   - after a host reset, the gate is loopback-only again until claimed;
   - the instance id is random, never derived from the host;
   - the gate reads DSH's volume read-only, and DSH never mounts the gate's;
   - the settings and the RFC say that a cookie leaked on loopback can be replayed by a local
     process, or the session is bound to something besides the cookie.
3. **The Cloud service and web sign-in** (outside this repository). Personal accounts,
   organisations, roles, invitations, sessions, revocation; the new identity service and its
   ingress (Decided 13), once the owner gives his separate OK. *Check:* an invitation binds to the
   accepting `(issuer, sub)`, not the email; a reused rotated secret revokes the family; a request
   after removal is refused. *Rollback:* take the service down and close the ingress; no app depends
   on it yet.
4. **One workspace, made by the operator** (server image Cloud mode; Arca outside), after the
   isolation review gate passes (Decided 12). Owner-only ((f)). Workspace tokens, the VM, volume,
   network, limits, backups and a restore drill. *Check:* workspace A's token is refused by B; a
   removed person cannot sign in after 5 minutes, and at once on the call; a restore opens with the
   same Bots and chats; the private network, the build host and other workspaces are unreachable
   from inside. *Rollback:* stop the workspace; the image without Cloud mode is a self-hosted
   instance.
   *Acceptance (from review):*
   - the gate's session lasts no longer than a workspace token, or rechecks the role; a lowered
     role drops sessions as a removal does;
   - a rail tile hands over a single-use code exchanged on the server, never a token in a URL;
   - the workspace node is not the build host, and no agent account on it holds `incus-admin` or a
     group equal to root;
   - the image digest comes from the release's own record.
5. **The rail, `+` and people** (desktop, 3.N; plugin, 3.N.P, for the web rail; Stripe billing
   outside). Desktop Cloud sign-in is switched on per OS only where the mask of (d) exists, or the
   owner accepted the risk in writing for that OS. Members and guests are switched on only when the
   three safeguards of (f) hold; until then the people features ship behind that line.
   *Check:* no rail when not signed in or not entitled; tiles by organisation and "This computer"
   first; `+` refused past the limit with the reason; an admin cannot reach billing; a Stripe
   webhook with a bad signature changes nothing; with members switched on, a guest sees only
   allowlisted Bots, the main bot is never "anyone", and stop and cancel are refused to every
   member and guest. *Rollback:* a release without the rail; workspaces stay reachable by their
   origins.
   *Acceptance (from review):*
   - a workspace origin opened in the desktop window gets none of the shell's privileged preload
     or IPC, and a partition separate from the local DSH;
   - who sets per-person choices in a shared workspace is decided (RFC 0014's `shown[]`, RFC
     0022's `front`).
6. **Linking a self-hosted instance** (later, optional; desktop and server image). *Check:* linking
   needs the local passkey (or the OS user on the desktop) and adds exactly one principal; members
   get nothing; unlinking restores local-only; an unlinked instance opens no connection to Cloud.
   *Rollback:* a release without linking; the instance drops the linked principal.

No outside person joins a workspace before the isolation review has passed and a restore has worked
once, and no member or guest before the three safeguards of (f) hold.

**Later, outside this RFC's deliveries:** Tactu may move to the new identity service (Decided 13),
as its own project's decision: a new client and groups there, and its people re-bound, since
principals are keyed by `(issuer, sub)`. Arca keeps its own sign-in (its own passkey approvals).

## Open questions

1. **Which identity service.** *Decided by the owner, 2026-11-09 (Decided 13):* a single new
   identity service (a self-hosted Pocket ID) that Cloud uses; Tactu may move to it later, as its
   own project's decision. *Corrected 2026-11-10 (Arca's orchestrator, via Automagik Chat):* Arca
   keeps its own sign-in (its own passkey approvals) and does not move. The trade-offs, as they
   now stand:
   - *Blast radius.* Shared by Cloud and, if it moves, Tactu: an incident in the identity
     service, or its admin, reaches their people. Isolation between products comes from a
     separate OIDC client and separate groups per product, and from Cloud's own database for
     organisations and roles, not from separate instances.
   - *Operations.* One instance to run, back up, restore and upgrade, with one break-glass admin
     and one public ingress. Its admin key reaches Cloud and, if it moves, Tactu, so it lives only
     in the operator's narrow, audited signup job.
   - *Branding.* One sign-in page and passkey host for Cloud and, if it moves, Tactu; Arca keeps
     its own.
   - *Later.* Tactu re-binds its people to the new issuer if it moves; Arca keeps its own sign-in.
   Standing it up waits on the owner's separate OK.
2. **Where Cloud roles live.** Decided by the council: Cloud's database ((e)). Kept for the record.
3. **Isolation unit.** *Decided by the owner, 2026-11-10: one Incus VM per workspace.* An
   unprivileged container only for the operator's own; never privileged. The isolation review
   gate ((g)) reviews how it is built.
4. **Who may invite.** Recommended: owners and admins, and the individual of a personal account;
   members and guests cannot ((e)).
5. **Recovery.** Recommended: a second passkey at the claim, plus recovery codes as slow hashes,
   plus the host reset out of the Bots' reach; no email reset ((c)).
6. **Session lifetimes.** Recommended: self-hosted sessions sliding with a 12-hour idle limit; Cloud
   workspace tokens 5 minutes; whether DSH's own multi-day cookie can stay behind the gate unchanged
   is an evidence gap for delivery 0.
7. **IP-only LAN installs.** *Decided by Automagik Chat, 2026-11-10:* no passkeys there; an SSH
   tunnel or pairing from a signed-in session; no TOTP fallback without its own review ((c)).
8. **What is paid.** Recommended: hosted workspaces, per workspace per month, seats up to a limit,
   model usage on the workspace's keys at first; personal accounts free; self-hosted free and
   complete for one instance ((i)).
   *Amended by [RFC 0025][25] (2026-11-09):* BYO model access is free; managed tokens are an
   opt-in through Cloud's gateway at a published margin; compute is metered from the host
   lifecycle. The workspace subscription and seats stand; 0025's Open questions carry the
   included seats and host shape under RFC 0024 Q8.
9. **The billing system.** *Decided by the owner, 2026-11-09 (Decided 14):* Stripe directly, Stripe
   Billing with a subscription per workspace and signed webhooks into Cloud's entitlements,
   "including support to agentic payments": Bots paying or being paid on a customer's behalf
   through Stripe's agent-payment features, within limits the human sets. To be detailed by a
   follow-up RFC, after the brainstorm on the economics ((i)).
   *Amended by [RFC 0025][25] (2026-11-09):* 0025 is that follow-up; inbound first, "being paid"
   deferred (0025, (j)).
10. **Moving a self-hosted instance into Cloud.** *Decided by Automagik Chat, 2026-11-10:* a
    separate, later decision; linking moves no data ((j)).
11. **DSH's authentication hook.** *Decided by Automagik Chat, 2026-11-10:* the gate now; propose
    a hook upstream (as RFC 0023 does for its pieces) and move to it only once DSH ships one.
12. **Omni's sign-in.** *Decided by Automagik Chat, 2026-11-10:* a defined boundary: Omni keeps
    its own for outside Omnis; behind a gate it takes the gate's principal with its own sign-in
    off ((k)).
13. **An optional external OIDC provider for self-hosters** (RFC 0008's old question 2).
    *Decided by Automagik Chat, 2026-11-10:* not planned; the principal contract leaves room for
    it later.
14. **Federation for company customers** (Google or Entra sign-in, SAML, SCIM). The council's
    dissent expects customers to ask; Pocket ID's support is unverified. Recommended: delivery 0
    checks it; if it is missing, decide before the first company customer, since a later issuer move
    re-binds every person.
15. **Pocket and Pocket Link with a claimed instance.** *Decided by Automagik Chat, 2026-11-10:*
    unchanged; Pocket pairs through Pocket Link's own keys, outside the gate; any phone sign-in
    to a web instance is a passkey of the same owner.
16. **Is the Cloud service open source?** *Decided by Automagik Chat, 2026-11-10:* its contracts
    (the principal, the workspace token, the entitlements document, the rail's API) are public
    here; the service starts private.
17. **The desktop's Cloud credential and local Bots.** Recommended: build a delivery-H-style mask
    per OS (the secret store, the session bus, the app's data folder) and keep desktop Cloud sign-in
    off on an OS until it exists there. The alternative is the owner's written acceptance of the
    risk for that OS ((d)).
18. **Until the three safeguards hold.** Recommended: Cloud workspaces stay owner-only. The
    reviewer's narrower alternative, members and guests limited to Bots with no shell or file tools
    in the meantime, is not recommended: a Bot's tools change over time, and one mistake makes a
    member owner-equivalent ((f)).

## Tracking

Ledger pass (2026-11-10): the board links this RFC from its file.

- Open issues: #902, #903, #904, #905, #906, #907, #908, #909, #910, #911, #912.
- Merged changes that cite this RFC: #866, #888, #913 (last merged 2026-11-10).

## Links

- RFCs: [0008](0008-platform-and-web-instances.md) (amended here: its web sign-in, the desktop
  client, contracts, questions 2, 6, 7, the threat model); [0022](0022-desktop-chat-view.md)
  (Decided 7, Buzz's gate, provenance, delivery H, the same-user reach, `front`);
  [0014](0014-shared-bot-registry.md) (each workspace's Bot registry, `shown[]`, "Other
  machines"); [0015](0015-live-chat-projection.md) (DSH's `principal` caller field);
  [0019](0019-gitlab-mirror.md) (Arca's GitLab, the build host); [0010](0010-desktop-sandbox.md)
  (Arca, masks); [0011](0011-monorepo-parts-and-releases.md) (lanes, key rotation);
  [0023](0023-dsh-upstream-agent-context-and-chat-rows.md) (proposals to DSH);
  [0005](0005-workspace-and-genie-projects.md) (the repos base, a different "workspace");
  [0025](0025-cloud-economics.md) (amends open question 8, Decided 14's "being paid", and the
  workspace credential in (g)).
- Code: `server/` (`Dockerfile`, `entrypoint.mjs`, `README.md`),
  `.github/workflows/server-image.yml`; `apps/desktop/src/dsh.js` (the launch URL, loopback),
  `apps/desktop/src/deeplink.js`, `apps/desktop/src/identity.js`.
- Outside, read-only and summarised: Tactu's login and waitlist decisions; Arca's owner note; Buzz's
  author gate (Apache-2.0, read, not copied); SimpleWebAuthn (MIT, an example, not chosen); Stripe
  Billing and its agent-payment features (a direction, detailed later); the left-bar mockup v7
  (private); the council report on this split (private). Concrete addresses, client ids and group
  names are kept in a private note, not here.

[25]: 0025-cloud-economics.md
