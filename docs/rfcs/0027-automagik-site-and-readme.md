# RFC 0027: README, launch film and automagik.si

| Field | Value |
|---|---|
| Status | Accepted (2026-11-10, by the owner: the story, the site base and the 2026-11-16 deadline; Q1-Q4 answered 2026-11-10, Q5 open; he OKs the exact README text, the film cut and a site preview before go-live) |
| Goal | By 2026-11-16: a stranger opens the repository, watches the film in the README, and reaches a live automagik.si that shows every building block with one working call to action. |
| Milestone | none (ships outside the five milestones) |
| Lanes | none here (docs and a static site: `README.md` and `apps/landing/` are in `NEVER_SHIPPED`, so they ship to no install) |
| Created | 2026-11-10 |

## Summary

This RFC writes down one launch's front door: one README, one film and one site, with a real
Cloud waitlist. The README leads with the product and the film, then the seven building blocks;
the site is the Genie's draft extended to the same seven, with the download as its one primary
action and the waitlist as a second, optional one; the film is the storyboard rendered, embedded
in both. It fixes the claims the current READMEs make that the source does not support, sets the
tone rules that keep the page honest, and names five deliveries to 2026-11-16. Nothing goes
public before the owner reads the exact README text in its PR, OKs the film cut, and OKs a site
preview.

**Happy delivery, which the owner can check himself:** a stranger opens the repository, watches
the film in the README, and reaches a live automagik.si that shows every building block with one
working call to action.

The RFC is docs only: it writes no page, renders no film and changes no code.

## Motivation

Owner's words (2026-11-10): "Automagik needs a proper readme, the gtm video embedded in it, also
it needs to finish the automagik.si webpage showcasing everything in it."

The front door does not do that today:

- **The root README is a developer index.** Its first screen is a plugin table, and a stranger
  meets the repository's contents before the product. It has no film, no link to a site, and no
  picture of what Automagik is.
- **The site exists only as a draft outside this repository.** The Genie's page ("Your own agent
  force") was written for automagik.dev before the 2026-11-07 umbrella story. It is one page,
  uncommitted, with no remote, and it shows one product, not the whole set.
- **The film is a storyboard.** Nothing is rendered; the music is unchosen and uncleared, and
  the storyboard still has `[TBD]`s.
- **The parts are spread out.** Omni and Genie live in their own repositories, Herdr the app in
  its own, and the pack and the DSH plugins here. The one place to show them together, as one
  set, is the new front door.
- **The READMEs claim what the source does not support.** The 2026-11-08 source read flags ten;
  the ones the current text states exactly are in "The claims to fix" below.
- **automagik.si has no address.** The DNS zone exists and the domain is the owner's; no A or
  AAAA record points at a page.

The repository already carries a landing page (`apps/landing/`, #177): a developer page for
automagik.dev, built from real captured screens, with a capture pipeline, a provenance file and a
contract test. The new site keeps that machinery and replaces the story and the look with the
Genie's draft. That is the cheapest honest path: the product story is new, the evidence is
already recorded.

## Decided by the owner, 2026-11-10

- **The story is "open building blocks".** automagik.si is the superintelligence open building
  blocks; each part is shown as its own block, usable alone: Team mode on DSH, Code mode on
  Herdr, Genie, Omni, Pocket, the meter and Cloud. Open, in this RFC's reading of his answer,
  means the set is open to use and compose, each block on its own; it does not mean every block
  is open source. This repository,
  Genie and Omni are Apache-2.0; Cloud is the private, paid hosted service (RFC 0024).
- **The site starts from the Genie's draft** ("Your own agent force") and its brand brief,
  extended to the whole set and moved into this repository.
- **The film follows the storyboard**: HyperFrames, 16:9, under a minute, music only, embedded
  in the README and on the site.
- **The deadline is 2026-11-16.**
- **Nothing goes public before his OKs**: he reads the exact README text in a PR, OKs the film
  cut, and opens a site preview. All three happen before D4.

The four questions, answered 2026-11-10:

- **Q1, hosting: Cloudflare Pages**, as recommended. The site is served from `apps/landing` with
  no build step; previews first; `automagik.dev` 301s to `automagik.si`.
- **Q2, music: a CC0 instrumental.** The team picks it, and the track, licence and scope go in
  `apps/landing/assets/film/LICENSES.md`; he OKs it with the cut.
- **Q3, no additional product blocks.** None appears on the page.
- **Q4, the call to action: Download and a Cloud waitlist** on the first screen. Download stays
  the primary button; the waitlist is a real form, designed in "The waitlist" and delivered as
  D3b by 2026-11-15.

Owner's words on the seven blocks (2026-11-10): "Open building blocks: automagik.si =
superintelligence open building blocks; each part shown as its own block you can use alone
(DSH team mode, Herdr code mode, Genie, Omni, Pocket, the meter/usagemeter, Cloud)."

Owner's words on the scope (2026-11-10): "automagik is one product with the team mode dsh, herdr
code... genie omni."

## Design

### The one story

- **The site's headline stays the draft's:** "Your own agent force." The line under it carries
  the umbrella: "Superintelligence, in open building blocks. Use one, or all of them." The small
  print under it says what open covers: this repository, Genie and Omni are Apache-2.0; Cloud is
  a private, paid service, and its contracts are public.
- **The README's first line:** "Automagik is superintelligence, in open building blocks: a team
  of AI agents in your chats, and each part usable on its own once it ships; Cloud is still in
  design." The
  tagline stays: "A team of AI helpers that lives in your chats."
- **Free and open source, Apache-2.0, for this repository, Genie and Omni**, said exactly that
  way, in the first screen's small print and the footer. Cloud is never called free or open: it
  is the private, paid hosted service, and only its contracts are public (RFC 0024).
- **The film is the proof of the team at work**, not a second origin story: the film is "Our own
  GTM team", the team launching Automagik, and the site and README present it as that.

### The seven blocks

The seven are the owner's list, quoted in Decided (2026-11-10). Each line is drawn from the
repo, cut to one line; nothing here comes from automagik.dev or from a deck.

| Block | One line (README and site) | Source |
|---|---|---|
| **Team mode (DSH)** | The Bot team on DeepSeek Harness: long-lived Bots with their own name, role, model and memory, group chats, schedules and the Bot browser. | `README.md`'s table; `apps/bots-dsh/README.md` |
| **Code mode (Herdr)** | Your code agents in the real Herdr window with the Automagik pack; nothing in Herdr is rebuilt. | RFC [0013](0013-work-code-switch.md); `herdr/README.md` |
| **Genie** | A wish becomes a branch, a test run and a report you approve; `genie desktop` opens it on the team. | `apps/landing/README.md`; `apps/landing/assets/CAPTURES.md`; `marketplace/automagik.json` |
| **Omni** | The service that links your chat apps to Automagik, with its channels and canvases in the same window. | `apps/desktop/README.md`; `README.md` |
| **Pocket** | Your coding agents on your Android phone, paired to your own machines. | `apps/pocket/README.md` |
| **The meter** | usagemeter, the Rust token meter that records usage and cost on the machine and answers `usagemeter query`. | RFCs [0017](0017-usagemeter-crate.md), [0018](0018-meter-query-contract.md) |
| **Cloud** | One sign-in, organisations and hosted workspaces, with a rail that opens each. | RFCs [0024](0024-automagik-cloud.md), [0025](0025-cloud-economics.md) |

Caveats stay in the small print, never as status chips:

- **Cloud is accepted, not shipped; when it ships it is private and paid.** RFC 0024 is the
  design, and it says the hosted service starts private, billed per workspace, with only its
  contracts public. The block says what Cloud is; the footnote says it is not live, not free and
  not open source.
- **The app's switch still says Work.** The owner calls the mode Team; RFC 0013 ships the
  switch as Work/Code. Until the rename ships, the copy says "Team mode" and the screenshot
  keeps the app's own label, Work.
- **Code mode is not part of the app download.** It needs Herdr and the Automagik pack; RFC 0013
  delivery 7 ("one install") is still open. The copy says so, and the Code block links to the
  pack's install.

Unfold is not one of the seven: it is a separate product and the owner's list does not include
it (RFC [0020](0020-unfold-plugins-leave.md)). No additional product blocks: Q3 in Decided.

Each block links to its own README or RFC, all under the `automagik-si` org: Team and Pocket to
their app folders, Code to `herdr/`, Genie to `genie`, Omni to `omni`, the meter to
`meter/usagemeter/`, and Cloud to RFC 0024, since there is no Cloud page yet. The landing test's
allow-list carries exactly these destinations.

### The README

The order, top to bottom:

1. **First screen:** the title, the one line, the film (poster, player, and a link for a client
   that does not play it), **Download for Mac** and **Download for Linux**, a line to the site's
   Cloud waitlist ("Cloud is coming; no date yet"), and the small print (this repository, Genie
   and Omni are free and open source, Apache-2.0; Cloud is a private, paid service; Mac with
   Apple silicon, macOS 13+; Linux 64-bit; Windows not yet).
2. **Two modes:** Team and Code, in two short paragraphs, with the corrections from "The claims
   to fix"; Code mode names Herdr and the pack, and says the app download alone does not set it
   up.
3. **The seven blocks:** the table above as a list, one line and a link each.
4. **What makes it yours:** your model, local files and memory, secrets the Bots never see, and
   the corrected approval sentence with its exceptions.
5. **Install:** the current release, the Mac and Linux steps, and the platform line.
6. **This repository:** the existing developer sections move below the product story and keep
   their content: the plugin table, installing into your own DSH, history, versions and
   releases, develop, license.

The film is one cut in two encodes. The site plays the committed file, which may be larger; the
README plays a GitHub attachment of the same cut, 10 MB or under: at D2 the owner drags that
encode into a PR comment, the attachment URL and the attachment's sha256 go in "The film" below
and in the README, and the README's player points at the attachment. The poster in the repo is
the fallback. github.com's CSP only plays media from GitHub's own hosts and caps video
attachments at 10 MB, so the site's URL cannot be the README player.

The app's README (`apps/desktop/README.md`) gets the same corrected sentences for the four
claims in "The claims to fix"; the root README and the app README do not disagree.

### The site

**Where it lives:** `apps/landing/`, the folder and the test that already exist. One page, no
build step, no JavaScript, no analytics, no cookies. The only forms are the waitlist's, and the
only server-side code is the waitlist function; both are "The waitlist" below.

- `apps/landing/index.html` and `styles.css`: the one page and its styles.
- `apps/landing/assets/screens/`: the recorded captures and their manifest (existing).
- `apps/landing/assets/brand/`: the marks, wordmark, lockup, app icon, the app's own character
  art (copied, with its licence note) and the fonts already in the draft's brand folder; the OFL
  files stay beside them.
- `apps/landing/assets/film/`: the film and its poster, with `LICENSES.md`.
- `apps/landing/assets/CAPTURES.md`: extended with every new screen and the film's provenance.
- `apps/landing/README.md`: rewritten for the new page and its commands.
- `apps/landing/landing.test.mjs`, `verify-browser.mjs`, `capture/`: kept and extended.

**The sections, top to bottom:**

1. **Hero:** the headline and line above, **Download for Mac** as the one primary action, Linux
   beside it, a real capture as the visual, and the Cloud waitlist card below the buttons. The
   poster belongs with the film.
2. **The film:** the player, click to play, with a one-paragraph description under it.
3. **The seven blocks:** each its own block, its one line, a link, and an anchor (`#team`,
   `#code`, `#genie`, `#omni`, `#pocket`, `#meter`, `#cloud`). Cloud's line carries the
   footnote that it is not live, not free and not open source.
4. **Two modes, shown working:** Team's screen is a recorded capture. Code's is a fresh capture
   of herdr-app with the pack, or the pack's own share image for the bot view
   (`herdr/mods/am-sidebar/preview.png`) if that is a capture of the running mod; whichever is
   used is recorded in `CAPTURES.md`. Never a mock dashboard. Code mode says it needs Herdr and
   the pack; the app download alone does not set it up.
5. **What makes it yours:** your model, your files, secrets, and what the Bots ask before they
   do.
6. **Your first five minutes:** the draft's three steps, cut to what the app really does.
7. **Install:** the current release, the Mac and Linux steps, the platform line, and the same
   download links as the hero, under `#install`.
8. **Made by this team:** the draft's line, made true of this page: "This page started as a
   Genie's draft, in a group chat with the rest of the launch team, inside Automagik."
9. **Footer:** download, the repository, "This repository, Genie and Omni: free and open source,
   Apache-2.0. Cloud: a private, paid service; its contracts are public", and the licence note
   for the music if it needs one.

**The base and what changes:** the Genie's draft supplies the copy, the section order, the look
and the brand brief. The existing page supplies the evidence: real captures, their provenance
and the checks. Where they disagree, the capture rule wins; the draft's rebuilt sidebar becomes
a real capture. The characters come from the app's own art, used as brand accents, never as a
stand-in for a screen; no new drawings, no invented pets.

The page keeps the existing no-script rule: the draft's little JavaScript is not carried over.
The only motion is CSS (one rise per section, `prefers-reduced-motion` respected) and the film.
The draft's cursor-following pets are cut for this page.

**The old page:** `apps/landing/` stops being the automagik.dev developer page. The developer
commands it carried (`genie desktop`, the Genie installer) move to the README; the site keeps
one link to the repository. Q1 is answered: `automagik.dev` 301s to `automagik.si`.

### The waitlist

The first screen carries the second action: a small card under the download buttons, visually
secondary, with the honest line "Cloud is coming. There is no date yet. Leave your email and we
will use it only to tell you when Cloud opens." Download stays the primary button; the waitlist
never outranks it in the DOM, the colour or the space. Until Q5 is answered, it only stores: no
email is sent and no mail service is integrated.

- **The form.** One native HTML form, no JavaScript: `method="post"`, `action="/api/waitlist"`,
  `input type="email" name="email" autocomplete="email" required maxlength="254"`, a hidden
  `action=add`, and a submit button. Under the button, one visible line: "By joining, I agree to
  one email when Cloud opens. See the privacy note." The function returns a small HTML page, so
  the page still has no script.
- **The privacy note.** Under the form, short and expandable: the controller (Namastex Labs, the
  owner's entity) and the `privacy` role address at automagik.si for access and correction; what
  is kept (the email and the UTC time it was added); why (the one email when Cloud opens); the
  legal basis (your consent, withdrawn by removing the row); how long (until Cloud launches or
  you remove it, reviewed every six months); who processes it and where (Cloudflare, as the
  processor, with the transfer abroad and the D1 jurisdiction named); no sharing beyond that
  processor; no analytics, no cookies; and the rights: confirmation, access, correction,
  deletion, to withdraw consent, and to complain to the ANPD or, in the EU, the local
  supervisory authority. It says the address is not verified and there is no double opt-in.
  Removal is a second small form in the same `details`, posting `action=remove`; it deletes the
  row and answers the same whether or not the email was there. Only the owner can read or
  export the list; no agent does.
- **The function.** `apps/landing/functions/api/waitlist.js`, one Pages Function, POST only:
  `application/x-www-form-urlencoded`; trim and lowercase the email; reject over 254 characters
  or a malformed address with 400; accept `action=add` or `action=remove` only. Add:
  `INSERT INTO waitlist(email, created_at) VALUES (?, ?) ON CONFLICT(email) DO NOTHING`;
  remove: `DELETE FROM waitlist WHERE email = ?`; both return the same small HTML page. It never
  sends email, never calls `fetch`, never redirects to a caller's URL, does no rate limiting and
  logs no email, IP or user agent. That is the "no open relay" rule: it can only write or delete
  one row.
- **The store.** D1, not KV: a unique email, a timestamp, one statement to delete, and an easy
  export for a privacy request. The binding `WAITLIST_DB`; the table
  `waitlist(email TEXT PRIMARY KEY, created_at TEXT NOT NULL)`; the schema in
  `apps/landing/waitlist/schema.sql`; the setup steps in `apps/landing/waitlist/README.md`. It
  holds only the email and the timestamp: no IP, no user agent, no referrer, no source. Its D1
  jurisdiction is set in the owner's account (a jurisdiction, not a location hint) and named in
  the note. Preview and production use separate databases; no test row reaches production.
- **The limits.** A Cloudflare WAF rate rule on the production domain, path `/api/waitlist`, is
  the limiter (Cloudflare counts per location, so the limit is approximate). It is account
  configuration, not a Pages Functions binding: the function has no limiter, sees no IP and
  never rate-limits in code. The preview is a `*.pages.dev` host not
  covered by the domain rule; it is unlisted, `noindex` and owner-only, with its own database,
  so the block is checked on production at D4. A missing D1 binding or a failed write is a 503
  with the failure page, never a success.
- **The failure rule.** The success page is returned only after the D1 write resolves. If the
  write throws or the binding is missing, the function answers 503 with "We could not save that.
  Try again in a minute"; it never returns the success text. `apps/landing/waitlist.test.mjs`
  injects a D1 that throws and asserts exactly that; `verify-browser.mjs` submits the form
  against a 503 and asserts the success text is absent, then against a 200 and asserts it is
  present.
- **The owner's part.** The database, the database bindings (preview and production), the WAF
  rate rule and the `privacy` role address are created in his Cloudflare account by him, or with
  his OK. The bindings are made in the dashboard: no `wrangler.toml` with an account, database
  or zone id is committed, and the setup steps use placeholders. Only the owner can read or
  export the list; an access request is answered from that export. The agent does not touch the
  account.
- **Not Cloud.** A waitlist row never becomes a Cloud account, a Pocket ID user or a billing
  customer, and is never imported into Cloud's identity service. It is an announcement list,
  not a sign-up.
- **The test bar.** A row is exactly `(email, created_at)`; a duplicate is one row; an invalid
  address is 400; a non-POST is 405; a wrong content type is 415; a store failure is 503 with no
  success text; a missing binding is 503; a remove deletes and gives the same page; no
  `Set-Cookie`; no third-party request; no email in any log; no email is sent. The WAF block is
  a production check at D4, not a function test. No account or database id is committed.

### The film

- **Source:** the storyboard, scene for scene, exactly as written: 16:9, 1920×1080, 30 fps,
  0:58, music only, no voice-over and no sound effects on top of the track.
- **Two encodes of one cut.** The site plays the committed
  `apps/landing/assets/film/automagik-launch.mp4` (H.264 and AAC, faststart, no LFS, no master in
  the repo); it may be the larger file. The README plays a GitHub attachment, which GitHub caps
  at 10 MB on this plan, so D2 makes a 10 MB-or-under encode of the same cut and uploads that.
- **The README player is that 10 MB attachment.** At D2 the owner drags the encode into a PR
  comment; the attachment URL and the attachment's sha256 go in the table below and in the
  README, next to the poster. The poster is the fallback. The site's committed file is the same
  cut, may be larger, and is not the attachment.
- **Metadata stripped** before either file is committed or uploaded: the privacy matcher reads
  both mp4s' and the poster's readable strings.
- **The end card** names `github.com/automagik-si/automagik`; #921 moves the live URLs from
  `automagik-dev` and the film follows it.
- **The storyboard's open items are resolved or cut, never filled in:** the group's name before
  the rename (fallback: start on "Automagik Launch"), each Bot's real colour and avatar from the
  app (never a new pet), the music (Q2: a CC0 track, picked by the team), and the page version
  the film shows (D3's page, re-pulled at build).
- **Music:** one CC0 instrumental, picked by the team, roughly 100-110 BPM, sparse to full and
  easing before the end card. `LICENSES.md` records the track's source URL, the creator, the
  download date and a saved copy of the CC0 deed; he OKs it with the cut. No track without a
  written licence.

| Item | Value |
|---|---|
| Site file | `apps/landing/assets/film/automagik-launch.mp4`, the site's encode (may be larger) |
| README player | the GitHub attachment URL, a 10 MB-or-under encode, uploaded by the owner at D2 |
| sha256 | the attachment's sha256, taken from the downloaded attachment at D2, in this table and the README |

**Frame rules:** no account emails, keys, QR codes, home-folder paths or anyone's real chats; the
person is "You"; no metrics, users or dates beyond the sources; a missing fact is cut, not
invented. This is the storyboard's own rule, kept.

### Tone rules

These apply to the README, the site and the film's copy (his deck rules, 2026-11-08):

- **Confident, never self-deprecating.** No "just", "soon", "we hope", "small project".
- **No unverified numbers.** No size, minutes, users, downloads, stars, percentages, "fastest"
  or "only". A number ships only with the line that proves it, and a date.
- **No vanity metrics.** No npm downloads, stars, follower counts.
- **No logos, customers or testimonials.** The only marks are Automagik's own.
- **No status chips.** A caveat is small print or a footnote.
- **Real UI and motion.** Screens are recorded captures or the app's own share image; the film
  is rendered from the storyboard. No mock dashboards, no stock screenshots, no plain boxes.
- **Every claim traceable** to this repository or the owner's words. Never automagik.dev.
- **One primary action:** download the app, from this repository's release. The Cloud waitlist
  is second: a small card on the first screen, never the loudest button.

### The claims to fix

The 2026-11-08 source read flags ten claims the source does not support. These are the ones the
current text states exactly; D1 and the site apply the same rule to every line they write: if
the repo or the owner's words do not support it, it does not ship.

| Where | The claim today | What the source shows | The fix |
|---|---|---|---|
| `apps/desktop/README.md:27` | "Before it sends anything as you, deletes something or disconnects a channel, it shows you exactly what it will do and asks first, every time." | It asks before it acts as you, but WhatsApp group and channel sends, and Main or Omni Bots, do not go through that step (the source read). | Name the exceptions; drop "every time". D1's PR cites the code behind each exception (`omni_send` lives outside this repo; `apps/bots-dsh/src/host/constants.js:92` only names it); if it cannot cite one, the sentence is cut. The site uses the corrected sentence. |
| `apps/desktop/README.md:28` | "lists, boards and forms that keep themselves up to date." | Only Main-Bot canvases keep themselves up to date. | Say "in a Main Bot's canvas". |
| `apps/desktop/README.md:32-34` | "You need two things," then "you can skip either and come back later." | Both can wait; the app itself says so. | "Two things to connect when you are ready", not needs. |
| `apps/desktop/README.md:39` | "It's about 330 MB." | The 2026-11-08 Mac build was 297 MB. | Measure the dmg D1 links, on the day, and state that number, or drop it. |
| `README.md:1-3` | "Automagik's plugins for DeepSeek Harness (DSH), and the Automagik desktop app that runs them." | That is the repository's contents, not the product a stranger meets. | Lead with the product; keep this as the developer section's first line. |
| Whole set | "Free and open source, Apache-2.0" about the set, and Cloud among the open blocks. | This repository, Genie and Omni are Apache-2.0; Cloud is the private, paid hosted service, with only its contracts public (RFC 0024). | Scope the Apache line to the three; Cloud's footnote says private, paid, not live, not open source. |
| Two modes | The app download alone gives both modes. | Code mode needs Herdr and the pack; RFC 0013 delivery 7 ("one install") is open. | D1 and the site say Code needs Herdr and the pack; the app download alone does not set it up. |
| README film | The README plays the film from the site's URL. | github.com's CSP only plays media from GitHub's own hosts and caps video attachments at 10 MB. | One GitHub attachment, 10 MB or under, its URL and sha256 recorded, the poster as the fallback (M2). |
| Naming | The app's switch says **Work**; the owner calls the mode **Team**. | RFC 0013: the shipped switch is Work/Code; the owner's rename to Team is not in the code. | "Team mode (the app's switch still says Work)" in the small print; screenshots keep the app's label. |

The source read's other flags are the same kind of thing: a claim stated more broadly than the
source supports. D1 rewrites the page, so the class goes; its PR body lists what it checked,
claim by claim, so the owner can see none was dropped.

### Where it is checked

| Check | Command | What it proves |
|---|---|---|
| **Page contract** | `node --test apps/landing/landing.test.mjs` | One `h1`; the sections and anchors; every image is a capture, a brand mark or the film's poster, and every screen capture matches its digest; every `href` is local or on the reviewed allow-list; exactly one film element; no script, iframe or analytics; only the two waitlist forms, with their action and method; the privacy scan of the page files; the responsive rules. |
| **Browser** | `node apps/landing/verify-browser.mjs` (with `LANDING_CHROME` on Linux/CI) | 1440, 1024, 390 and 320 px: no sideways scroll, every image answers 200 and decodes, no request outside the page. D3 adds `video/mp4` and the poster; D3b submits the form against a 503 and a 200. |
| **Waitlist** | `node --test apps/landing/waitlist.test.mjs` | One row of exactly `(email, created_at)`; a duplicate is one row; an invalid email is 400; a non-POST is 405; a wrong type is 415; a store failure is 503 with no success text; a missing binding is 503; remove deletes and answers the same; no `Set-Cookie`, no third-party request, no email in a log; no email is sent. The WAF block is a D4 production check. |
| **Rendered README** | a screenshot attached to D1's PR by its author | The rendered github.com page at 1440 px: one `h1`, the film player (or the poster fallback) and the download buttons. |
| **Privacy matcher** | `node herdr/scripts/privacy-check.mjs` from the root | No home path, private name, account, email, secret or database file in the new text, or in the film's and the poster's readable strings. Run before every push. |
| **Link check** | The landing test's allow-list, then `curl -fsSIL` on each destination at D4 | No unreviewed outbound link; the README attachment, the poster, the download and the waitlist answer as expected on the live site. |
| **Release** | `bun scripts/lane.ts ships <last tag>` | No. `README.md` and `apps/landing/` are in `NEVER_SHIPPED`; the deliveries cut no release. |
| **CI** | D3 adds a `landing` job (with Chrome and `LANDING_CHROME`) and D3b adds the waitlist test | The page contract, the browser check and the waitlist test run on every PR. |
| **Owner** | D1's PR text and screenshot, D2's cut and attachment line, D3b's preview | The OKs that gate D4. |

## Contracts introduced

- **`https://automagik.si`** is the site's canonical origin. Q1 is answered: `www` redirects to
  the apex, and `https://automagik.dev` 301s to `https://automagik.si`.
- **`apps/landing/`** is the site's source of truth: one `index.html`, `styles.css`, and
  `assets/{brand,screens,film}`. Its anchors are `#film`, `#blocks`, `#team`, `#code`, `#genie`,
  `#omni`, `#pocket`, `#meter`, `#cloud` and `#install`.
- **The film paths:** `apps/landing/assets/film/automagik-launch.mp4` (the site's encode) and
  `apps/landing/assets/film/automagik-launch-poster.webp`, plus `LICENSES.md` beside them. The
  README's film is a GitHub attachment URL, a 10 MB-or-under encode of the same cut; its sha256
  is recorded in "The film" and in the README, and the poster is the fallback.
- **`POST /api/waitlist`** is the site's one endpoint: `application/x-www-form-urlencoded`,
  `action=add|remove`, `email` up to 254 characters. It answers 200 (the same page for add and
  remove), 400, 405, 415 or 503; it never sends email, redirects or sets a cookie. The store is
  the D1 table `waitlist(email TEXT PRIMARY KEY, created_at TEXT NOT NULL)`, through the
  `WAITLIST_DB` binding; its jurisdiction is set and named in the note. The production domain's
  WAF rate rule on `/api/waitlist` bounds the path; it is account configuration, not a code
  binding. No `wrangler.toml` with an account, database or zone id is committed. The `privacy`
  role address at automagik.si is the contact; D3b adds it to the privacy list's allowed emails.
- **The waitlist is not Cloud:** a row never becomes a Cloud account, Pocket ID user or billing
  customer, and is never imported into Cloud's identity service.
- **The README's first screen** contains the film, the download links and the link to the site's
  Cloud waitlist; the developer sections stay below it.
- **The reviewed destinations** are exactly the landing test's allow-list; a new outbound link
  is a test change, reviewed like any other.
- **No app contract changes:** no app id, plugin id, route, storage key or version is touched;
  both paths ship nothing (`NEVER_SHIPPED`). An installed app is unaffected by every delivery.

## Threat model

- **Who can reach it:** anyone. The page is static; the waitlist is one server endpoint
  (`POST /api/waitlist`) with a D1 binding. It accepts one email and a timestamp, never sends
  email, never fetches another site, sets no cookie and uses no analytics or third party. The
  download is a link; the waitlist is a row.
- **Waitlist abuse:** a Cloudflare WAF rate rule on the production domain bounds the path; the
  function has no limiter and no IP. Validation bounds the field; the D1 unique key makes a
  duplicate a no-op; there is no open relay (no email, no fetch, no redirect) and no CAPTCHA or
  third party. A bot within the rule can add addresses; the list is not an email sender, and the
  owner can delete rows.
- **Consent cannot be proven:** there is no double opt-in; anyone can add or remove any address.
  The list is an announcement list, not a verified or transactional list, and is not used for
  anything that needs proven consent.
- **Enumeration and removal:** add and remove answer the same page whether or not the email
  exists; the success page shows no timestamp; the remove page says "If that email was on the
  list, it's removed"; the remove form deletes the row. Only the owner can read or export the
  list; an access request is answered from that export; no agent reads it.
- **A false success:** the success page is written only after the D1 write resolves. A throw or
  a missing binding is a 503 with the failure page; the unit and browser tests cover it.
- **The waitlist data:** only email and timestamp; no IP, user agent or referrer; no cookie; no
  analytics; no third party; the controller is Namastex Labs; Cloudflare is the processor, the
  transfer abroad and the D1 jurisdiction are named; the database is in the owner's account,
  reached only through the binding; preview and production are separate; the privacy note states
  purpose, consent, retention, sharing, the rights (including withdrawal and the ANPD or an EU
  authority) and removal; the `privacy` role address handles access and correction. A row never
  becomes a Cloud account, Pocket ID user or billing customer, and is never imported into
  Cloud's identity service.
- **Private data in a public front door:** the privacy matcher scans the new text, the film's
  readable strings and the poster; the film's frame rules keep out emails, keys, QR codes, home
  paths and real chats; the screens are captures from the isolated fixture, never a live
  profile. The capture rule and its manifest are the evidence.
- **A claim that is not true:** every line is sourced above or cut; the owner reads the exact
  README text and the preview; the link test keeps unreviewed destinations out. A wrong claim
  that ships is fixed in the next deploy, and the deploy is one commit.
- **A dead or wrong download:** the CTA is checked live at D4 against the file it names; no
  third-party binary and no redirect shortener.
- **The music licence:** a written licence and its scope in `LICENSES.md`; no track ships
  without one. The CC0 deed is saved with it; a licence that requires credit gets its credit in
  the footer.
- **A bad deploy or a lost domain:** deploys come from the repository only, under the owner's
  hosting account; no credential is in the page or the repo. Undo is redeploying the previous
  commit and removing the custom domain or DNS record. The film and the page stay in history;
  installed apps are untouched.

## Deliveries

Each delivery is one pull request against `dev`, except D4, which is the hosting change and the
merge of D1's PR. None cuts a release. The dates run to the owner's 2026-11-16 deadline; Q1-Q4
are answered, Q5 (the launch email) is open and blocks no delivery here, since D3b only stores.

**D1, Wednesday 2026-11-11: the README PR.**

- *What ships:* the rewritten `README.md` in the order above and the corrected
  `apps/desktop/README.md`, with the film section, the seven blocks, the corrected claims and
  the developer sections below; the Apache-2.0 line scoped to this repository, Genie and Omni;
  Cloud's footnote private and paid; Code mode names Herdr and the pack; the link to the site's
  Cloud waitlist; links follow #921's `automagik-si` org, with no new `automagik-dev` URL. The
  film section carries the poster and the film text; D2 adds the 10 MB player, its sha256 line
  and the README line.
- *Check:* the owner reads the exact text of both READMEs in the PR and OKs it; `bun
  scripts/lane.ts ships <last tag>` says no; the privacy matcher is clean; every link that is
  live answers 200 (the site, the waitlist and the film are checked at D4); each approval
  exception cites its code (or is cut); GitHub's licence detection says Apache-2.0 on automagik,
  Genie and Omni (the owner fixes it there if not); the D1 author attaches a 1440 px screenshot
  of the rendered page on github.com with one `h1`, the player or poster and the download
  buttons.
- *Rollback:* close or revert the PR. Nothing is released; no install changes. The PR stays open
  until his OK, D2's attachment line and D4.

**D2, Friday 2026-11-13: the film.**

- *What ships:* the site's encode and the poster in `apps/landing/assets/film/`, from the
  storyboard, with the team's CC0 track and its licence in `LICENSES.md` (source URL, creator,
  download date and the saved CC0 deed); a 10 MB-or-under encode of the same cut, uploaded by the
  owner as a GitHub attachment in a PR comment; the attachment URL and the attachment's sha256
  in "The film" table and in the README.
- *Check:* the owner watches the cut and OKs it, the music with it; `ffprobe` says 0:58 (under a
  minute), 1920x1080, 30 fps, one audio track (the owner's watch covers no voice-over and no
  SFX); the attachment is 10 MB or under; `curl -L` the attachment and compute its sha256: it
  equals the recorded value, which also proves GitHub did not re-encode it; the site's file is
  the same cut and may be larger; the privacy matcher is clean on both files and the poster; the
  storyboard's frame rules hold; its `[TBD]`s are resolved or cut.
- *Rollback:* delete the site file and the poster; remove the attachment line; the GitHub
  comment can stay; D3 ships without the player, or with the poster linking to the site film, and
  names the gap; nothing is public until D4.

**D3, Saturday 2026-11-14: the site in the repo, with a preview.**

- *What ships:* `apps/landing/` becomes the automagik.si page, from the Genie's draft, extended
  to the seven blocks, with the real captures, the film (the committed site encode), the brand
  assets, the Install section and the updated `CAPTURES.md`; `landing.test.mjs` allows exactly
  one film element and the new sources and anchors; the `landing` CI job (`bun install` for
  playwright-core, the runner's Chrome or an installed one, `LANDING_CHROME`); a Cloudflare
  Pages preview, unlisted and `noindex`. The waitlist card is D3b.
- *Check:* the page test is green; the browser check passes at 1440, 1024, 390 and 320 px; the
  privacy matcher is clean; every `href` is local or allow-listed; the film plays in the
  preview; the preview is not linked from a committed file; `#film`, `#blocks`, `#install` and
  the seven block anchors exist; the page says Code needs Herdr and the pack.
- *Rollback:* revert the page and CI commits; delete the preview deployment. No DNS yet; no
  release.

**D3b, Sunday 2026-11-15: the Cloud waitlist.**

- *What ships:* the waitlist card on the first screen (Download stays the primary button), the
  native form with the consent line and the remove form, the short LGPD-aware privacy note
  (controller, contact, transfer, D1 jurisdiction, rights, ANPD/EU, removal), the Pages Function
  `apps/landing/functions/api/waitlist.js`, the D1 schema and setup steps, the page test's
  allowance of exactly those two forms, and the `privacy` role address's allowed entry in
  `herdr/scripts/privacy-list.json`. The owner creates the database, the preview and production
  bindings, the WAF rate rule and the `privacy` role address in his account, in the dashboard;
  no `wrangler.toml` with an account, database or zone id is committed; the preview uses its own
  database. The waitlist only stores: no email is sent and no mail service is integrated.
- *Check:* the test bar above; the owner submits a test email on the preview, sees exactly one
  row `(email, created_at)`, removes it and sees it gone; no email is sent; a D1 that throws is
  503 and never the success text; the WAF rule is set for production and the preview is
  owner-only (the block is checked at D4); the page has no cookie, no third-party request, no
  analytics and no email in a log; the privacy matcher is clean on the page and the function; the
  privacy note names the controller, the transfer, the D1 jurisdiction, the rights and removal;
  the consent line shows by the button; a row never becomes a Cloud account; no account or
  database id is committed; Download is the first action in the DOM; the owner OKs the preview.
- *Rollback:* revert the PR; remove the form, the function, the schema, the bindings and the WAF
  rule; delete the D1 database, the only copy of the waitlist (no email was ever sent, so no one
  is waiting on a message); the site returns to Download only.

**D4, Monday 2026-11-16: go-live, after the OKs.**

- *What ships:* `automagik.si` is attached to the Pages project and its DNS record added; the
  preview's `noindex` is removed; HTTPS and the canonical URL are checked; `automagik.dev` 301s
  to the new site; the README PR merges with the 10 MB GitHub attachment player and the waitlist
  line; the first screen's Apache line stays scoped and Cloud's footnote stays private and paid.
- *Check, the happy delivery by hand in a clean browser:* open the repository, watch the film in
  the README (the GitHub attachment), click through to automagik.si, see the seven blocks, use
  the download and try the waitlist with a test email, then remove it. `curl -fsSI
  https://automagik.si` answers 200 with HTTPS; the film answers `video/mp4`; every block link
  answers 200; the WAF rule blocks a burst on `/api/waitlist`; the waitlist row is exactly the
  test email and a timestamp, and is gone after the remove, and no email was sent; the page has
  no `noindex`, no analytics, no cookie and no third party.
- *Rollback:* remove the custom domain and DNS record; revert the README merge; apply D3b's
  rollback if the waitlist is the failure; the preview stays available to the owner; installed
  apps are untouched.

## Open questions

**Q5. The launch email, and who sends it.**
*Recommended:* one email only, when Cloud opens, sent by the owner from his own account or a
transactional service he picks; the privacy note names the sender and the processor before the
first send; the email has the removal path; the list is deleted after that send. Until he
answers, the waitlist only stores: no email is sent and no mail service is integrated.

Q1-Q4 are answered 2026-11-10, in Decided; Q4's design is "The waitlist" and D3b.

## Links

- **The owner's answers, 2026-11-10** (the story, the site base, the deadline, Q1-Q4 and the
  three OKs) and the 2026-11-08 source read behind "The claims to fix"; the Genie's draft and
  its brand brief. These are working notes, not repository files.
- **PR #933** carries this RFC's review, the FIX-FIRST and this revision.
- **Issues:** #921 (the org rename and live URLs; this RFC adds no new `automagik-dev` URL), #177
  (the landing page, its captures and its test).
- **RFCs:** [0011](0011-monorepo-parts-and-releases.md) parts and releases;
  [0013](0013-work-code-switch.md) the Work/Code switch (the shipped labels);
  [0017](0017-usagemeter-crate.md), [0018](0018-meter-query-contract.md) and
  [0021](0021-meter-attribution.md) the meter; [0024](0024-automagik-cloud.md) and
  [0025](0025-cloud-economics.md) Cloud; [0020](0020-unfold-plugins-leave.md) why Unfold is not
  a block; [0001](0001-roadmap-and-milestones.md) docs never ship.
- **The page's machinery:** `apps/landing/README.md`, `apps/landing/landing.test.mjs`,
  `apps/landing/verify-browser.mjs`, `apps/landing/capture/capture.mjs`,
  `apps/landing/assets/CAPTURES.md`, `apps/landing/assets/screens/manifest.json`.
- **The waitlist:** `apps/landing/functions/api/waitlist.js`, `apps/landing/waitlist.test.mjs`,
  `apps/landing/waitlist/schema.sql`, `apps/landing/waitlist/README.md`.
- **The parts' words:** `README.md`, `apps/bots-dsh/README.md`, `apps/desktop/README.md`,
  `apps/pocket/README.md`, `apps/welcome-dsh/README.md`, `herdr/README.md`,
  `marketplace/automagik.json`.
- **The checks and the lanes:** `herdr/scripts/privacy-check.mjs`,
  `herdr/scripts/privacy-list.json`, `scripts/lane.ts` (`NEVER_SHIPPED`),
  `.github/workflows/ci.yml`.
