# RFC 0027: README, launch film and automagik.si

| Field | Value |
|---|---|
| Status | Accepted (2026-11-10, by the owner: the story, the site base and the 2026-11-16 deadline; he OKs the exact README text and a site preview before either goes live) |
| Goal | By 2026-11-16: a stranger opens the repository, watches the film in the README, and reaches a live automagik.si that shows every building block with one working call to action. |
| Milestone | none (ships outside the five milestones) |
| Lanes | none here (docs and a static site: `README.md` and `apps/landing/` are in `NEVER_SHIPPED`, so they ship to no install) |
| Created | 2026-11-10 |

## Summary

This RFC writes down one launch's front door: one README, one film and one site. The README
leads with the product and the film, then the seven open building blocks; the site is the Genie's
draft extended to the same seven; the film is the storyboard rendered, embedded in both. It fixes
the claims the current READMEs make that the source does not support, sets the tone rules that
keep the page honest, and names four deliveries to 2026-11-16. Nothing goes public before the
owner reads the exact README text in its PR and OKs a site preview.

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
  Herdr, Genie, Omni, Pocket, the meter and Cloud.
- **The site starts from the Genie's draft** ("Your own agent force") and its brand brief,
  extended to the whole set and moved into this repository.
- **The film follows the storyboard**: HyperFrames, 16:9, under a minute, music only, embedded
  in the README and on the site.
- **The deadline is 2026-11-16.**
- **Nothing goes public before two OKs**: he reads the exact README text in a PR, and he opens a
  site preview. Both happen before D4.

Owner's words on the scope (2026-11-10): "automagik is one product with the team mode dsh, herdr
code... genie omni."

## Design

### The one story

- **The site's headline stays the draft's:** "Your own agent force." The line under it carries
  the umbrella: "Superintelligence, in open building blocks. Use one, or all of them."
- **The README's first line:** "Automagik is superintelligence, in open building blocks: a team
  of AI agents in your chats, and each part usable on its own." The tagline stays: "A team of AI
  helpers that lives in your chats."
- **Free and open source, Apache-2.0**, said exactly that way, in the first screen's small print
  and the footer.
- **The film is the proof of the team at work**, not a second origin story: the film is "Our own
  GTM team", the team launching Automagik, and the site and README present it as that.

### The seven blocks

The seven are the owner's list. Each line is drawn from the repo, cut to one line; nothing here
comes from automagik.dev or from a deck.

| Block | One line (README and site) | Source |
|---|---|---|
| **Team mode (DSH)** | The Bot team on DeepSeek Harness: long-lived Bots with their own name, role, model and memory, group chats, schedules and the Bot browser. | `README.md`'s table; `apps/bots-dsh/README.md` |
| **Code mode (Herdr)** | Your code agents in the real Herdr window with the Automagik pack; nothing in Herdr is rebuilt. | RFC [0013](0013-work-code-switch.md); `herdr/README.md` |
| **Genie** | A wish becomes a branch, a test run and a report you approve; `genie desktop` opens it on the team. | `apps/landing/README.md`; `apps/landing/assets/CAPTURES.md`; `marketplace/automagik.json` |
| **Omni** | The service that links your chat apps to Automagik, with its channels and canvases in the same window. | `apps/desktop/README.md`; `README.md` |
| **Pocket** | Your coding agents on your Android phone, paired to your own machines. | `apps/pocket/README.md` |
| **The meter** | usagemeter, the Rust token meter that records usage and cost on the machine and answers `usagemeter query`. | RFCs [0017](0017-usagemeter-crate.md), [0018](0018-meter-query-contract.md) |
| **Cloud** | One sign-in, organisations and hosted workspaces, with a rail that opens each. | RFCs [0024](0024-automagik-cloud.md), [0025](0025-cloud-economics.md) |

Two caveats stay in the small print, never as status chips:

- **Cloud is accepted, not shipped.** RFC 0024 is the design; there is no Cloud to sign in to
  yet. The block says what Cloud is, and the footnote says it is not live.
- **The app's switch still says Work.** The owner calls the mode Team; RFC 0013 ships the
  switch as Work/Code. Until the rename ships, the copy says "Team mode" and the screenshot
  keeps the app's own label, Work.

Unfold is not one of the seven: it is a separate product and the owner's list does not include
it (RFC [0020](0020-unfold-plugins-leave.md)). Arca and Vox are Q3 below.

Each block links to its own README or RFC, all under the `automagik-si` org: Team and Pocket to
their app folders, Code to `herdr/`, Genie to `genie`, Omni to `omni`, the meter to
`meter/usagemeter/`, and Cloud to RFC 0024, since there is no Cloud page yet. The landing test's
allow-list carries exactly these destinations.

### The README

The order, top to bottom:

1. **First screen:** the title, the one line, the film (poster, player, and a link for a client
   that does not play it), **Download for Mac** and **Download for Linux**, and the small print
   (free and open source, Apache-2.0; Mac with Apple silicon, macOS 13+; Linux 64-bit; Windows
   not yet).
2. **Two modes:** Team and Code, in two short paragraphs, with the corrections from "The claims
   to fix".
3. **The seven blocks:** the table above as a list, one line and a link each.
4. **What makes it yours:** your model, local files and memory, secrets the Bots never see, and
   the corrected approval sentence with its exceptions.
5. **Install:** the current release, the Mac and Linux steps, and the platform line.
6. **This repository:** the existing developer sections move below the product story and keep
   their content: the plugin table, installing into your own DSH, history, versions and
   releases, develop, license.

The film is one file in the repo. The README embeds it from its live site URL, so there is one
copy and one player; D1 proves the player in a browser on github.com. If GitHub refuses it, the
poster links to the film and the PR says so. No second upload, no YouTube embed, no third-party
player.

### The site

**Where it lives:** `apps/landing/`, the folder and the test that already exist. One page, no
build step, no JavaScript, no analytics, no cookies, no form.

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
   beside it, and a real capture as the visual. The poster belongs with the film.
2. **The film:** the player, click to play, with a one-paragraph description under it.
3. **The seven blocks:** each its own block, its one line, a link, and an anchor (`#team`,
   `#code`, `#genie`, `#omni`, `#pocket`, `#meter`, `#cloud`). Cloud's line carries the
   footnote that it is not live.
4. **Two modes, shown working:** Team's screen is a recorded capture. Code's is a fresh capture
   of herdr-app with the pack, or the pack's own share image for the bot view
   (`herdr/mods/am-sidebar/preview.png`) if that is a capture of the running mod; whichever is
   used is recorded in `CAPTURES.md`. Never a mock dashboard.
5. **What makes it yours:** your model, your files, secrets, and what the Bots ask before they
   do.
6. **Your first five minutes:** the draft's three steps, cut to what the app really does.
7. **Made by this team:** the draft's line, made true of this page: "This page started as a
   Genie's draft, in a group chat with the rest of the launch team, inside Automagik."
8. **Footer:** download, the repository, "Free and open source · Apache-2.0", the licence note
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
one link to the repository. Q1 covers the old domain.

### The film

- **Source:** the storyboard, scene for scene, exactly as written: 16:9, 1920×1080, 30 fps,
  0:58, music only, no voice-over and no sound effects on top of the track.
- **One file:** H.264 and AAC, faststart, under 25 MB, at `apps/landing/assets/film/` with a
  poster frame. No LFS in this repository, so the web encode is the file; no master in the repo.
- **Metadata stripped** before the file is committed: the privacy matcher reads the mp4's
  and the poster's readable strings.
- **The end card** names `github.com/automagik-si/automagik`; #921 moves the live URLs from
  `automagik-dev` and the film follows it.
- **The storyboard's open items are resolved or cut, never filled in:** the group's name before
  the rename (fallback: start on "Automagik Launch"), each Bot's real colour and avatar from the
  app (never a new pet), the music (Q2), and the page version the film shows (D3's page,
  re-pulled at build).
- **Music:** one cleared instrumental, roughly 100-110 BPM, sparse to full and easing before the
  end card. The track, artist, licence and its scope go in `LICENSES.md`; no track without a
  written licence.

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
- **One primary action:** download the app, from this repository's release.

### The claims to fix

The 2026-11-08 source read flags ten claims the source does not support. These are the ones the
current text states exactly; D1 applies the same rule to every line it writes: if the repo or
the owner's words do not support it, it does not ship.

| Where | The claim today | What the source shows | D1's fix |
|---|---|---|---|
| `apps/desktop/README.md:27` | "Before it sends anything as you, deletes something or disconnects a channel, it shows you exactly what it will do and asks first, every time." | It asks before it acts as you, but WhatsApp group and channel sends, and Main or Omni Bots, do not go through that step (the source read). | Name the exceptions; drop "every time". The site uses the corrected sentence. |
| `apps/desktop/README.md:28` | "lists, boards and forms that keep themselves up to date." | Only Main-Bot canvases keep themselves up to date. | Say "in a Main Bot's canvas". |
| `apps/desktop/README.md:32-34` | "You need two things," then "you can skip either and come back later." | Both can wait; the app itself says so. | "Two things to connect when you are ready", not needs. |
| `apps/desktop/README.md:39` | "It's about 330 MB." | The 2026-11-08 Mac build was 297 MB. | Measure the dmg D1 links, on the day, and state that number, or drop it. |
| `README.md:1-3` | "Automagik's plugins for DeepSeek Harness (DSH), and the Automagik desktop app that runs them." | That is the repository's contents, not the product a stranger meets. | Lead with the product; keep this as the developer section's first line. |
| Naming | The app's switch says **Work**; the owner calls the mode **Team**. | RFC 0013: the shipped switch is Work/Code; the owner's rename to Team is not in the code. | "Team mode (the app's switch still says Work)" in the small print; screenshots keep the app's label. |

The source read's other flags are the same kind of thing: a claim stated more broadly than the
source supports. D1 rewrites the page, so the class goes; its PR body lists what it checked,
claim by claim, so the owner can see none was dropped.

### Where it is checked

| Check | Command | What it proves |
|---|---|---|
| **Page contract** | `node --test apps/landing/landing.test.mjs` | One `h1`; the sections and anchors; every image is a capture, a brand mark or the film's poster, and every screen capture matches its digest; every `href` is local or on the reviewed allow-list; exactly one film element; no script, iframe, form or analytics; the privacy scan of the page files; the responsive rules. |
| **Browser** | `node apps/landing/verify-browser.mjs` (with `LANDING_CHROME` on Linux/CI) | 1440, 1024, 390 and 320 px: no sideways scroll, every image answers 200 and decodes, no request outside the page. D3 adds `video/mp4` and the poster to its types and its checks. |
| **Privacy matcher** | `node herdr/scripts/privacy-check.mjs` from the root | No home path, private name, account, email, secret or database file in the new text, or in the film's and the poster's readable strings. Run before every push. |
| **Link check** | The landing test's allow-list, then `curl -fsSIL` on each destination at D4 | No unreviewed outbound link; the film and the one CTA answer 200 on the live site. |
| **Release** | `bun scripts/lane.ts ships <last tag>` | No. `README.md` and `apps/landing/` are in `NEVER_SHIPPED`; the deliveries cut no release. |
| **CI** | D3 adds a `landing` job to `.github/workflows/ci.yml` | The page contract and the browser check run on every PR, not only by hand. |
| **Owner** | D1's PR text and D3's preview | The two OKs that gate D4. |

## Contracts introduced

- **`https://automagik.si`** is the site's canonical origin. Q1 decides the `www` redirect and
  what happens to `https://automagik.dev`; the rest of this contract stands either way.
- **`apps/landing/`** is the site's source of truth: one `index.html`, `styles.css`, and
  `assets/{brand,screens,film}`. Its anchors are `#film`, `#blocks`, `#team`, `#code`, `#genie`,
  `#omni`, `#pocket`, `#meter`, `#cloud` and `#install`.
- **The film paths:** `apps/landing/assets/film/automagik-launch.mp4` and
  `apps/landing/assets/film/automagik-launch-poster.webp`, plus `LICENSES.md` beside them.
- **The README's first screen** contains the film and the download link; the developer sections
  stay below it.
- **The reviewed destinations** are exactly the landing test's allow-list; a new outbound link
  is a test change, reviewed like any other.
- **No app contract changes:** no app id, plugin id, route, storage key or version is touched;
  both paths ship nothing (`NEVER_SHIPPED`). An installed app is unaffected by every delivery.

## Threat model

- **Who can reach it:** anyone, on a static page. There is no server, no form, no cookie, no
  analytics and no account; the only action is a link and a download. No visitor data is
  collected, so there is none to leak.
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
  without one. A licence that requires credit gets its credit in the footer.
- **A bad deploy or a lost domain:** deploys come from the repository only, under the owner's
  hosting account; no credential is in the page or the repo. Undo is redeploying the previous
  commit and removing the custom domain or DNS record. The film and the page stay in history;
  installed apps are untouched.

## Deliveries

Each delivery is one pull request against `dev`, except D4, which is the hosting change and the
merge of D1's PR. None cuts a release. The dates run to the owner's 2026-11-16 deadline; Q1 and
Q2 block the deliveries they are named in and are asked on 2026-11-10.

**D1, Wednesday 2026-11-11: the README PR.**

- *What ships:* the rewritten `README.md` in the order above, with the film, the seven blocks,
  the corrected claims and the developer sections below; links follow #921's `automagik-si`
  org, with no new `automagik-dev` URL; the player points at the film's live site URL (D4), and
  D2 adds the poster the README shows before the PR merges.
- *Check:* the owner reads the exact text in the PR and OKs it; `bun scripts/lane.ts ships <last
  tag>` says no; the privacy matcher is clean; every link that is live answers 200, and the film
  and the site URL are checked at D4; the rendered page on github.com has one `h1` and the player
  (or the poster fallback).
- *Rollback:* close or revert the PR. Nothing is released; no install changes. The PR stays open
  until his OK and merges at D4.

**D2, Friday 2026-11-13: the film.**

- *What ships:* the rendered film and its poster in `apps/landing/assets/film/`, from the
  storyboard, with its music cleared (Q2) and the end card on the `automagik-si` URL.
- *Check:* the owner watches the cut and OKs it; `ffprobe` says 0:58 (under a minute),
  1920×1080, 30 fps, one audio track and no voice; the file is under 25 MB; the privacy matcher
  is clean on the mp4 and the poster; the storyboard's frame rules hold; its `[TBD]`s are
  resolved or cut.
- *Rollback:* delete the two assets; D3 ships without the player, or with a link to the file,
  and names the gap; nothing is public until D4.

**D3, Saturday 2026-11-14: the site in the repo, with a preview.**

- *What ships:* `apps/landing/` becomes the automagik.si page, from the Genie's draft, extended
  to the seven blocks, with the real captures, the film, the brand assets and the updated
  `CAPTURES.md`; `landing.test.mjs` allows exactly one film element and the new sources and
  anchors; the `landing` CI job; a Cloudflare Pages preview (Q1), unlisted and `noindex`.
- *Check:* the page test is green; the browser check passes at 1440, 1024, 390 and 320 px; the
  privacy matcher is clean; every `href` is local or allow-listed; the film plays in the
  preview; the preview is not linked from any committed file; the owner opens it and OKs it.
- *Rollback:* revert the page and CI commits; delete the preview deployment. No DNS yet; no
  release.

**D4, Monday 2026-11-16: go-live, after both OKs.**

- *What ships:* `automagik.si` is attached to the Pages project and its DNS record added; the
  preview's `noindex` is removed; HTTPS and the canonical URL are checked; `automagik.dev`
  redirects to the new site if Q1 says so; then D1's README PR merges, so no committed link is
  dead for a moment.
- *Check, the happy delivery by hand in a clean browser:* open the repository, watch the film in
  the README, click through to automagik.si, see the seven blocks, and use the one CTA to
  download the current build. `curl -fsSI https://automagik.si` answers 200 with HTTPS; the
  film answers `video/mp4`; every block link answers 200; the page has no `noindex`, no
  analytics and no cookie.
- *Rollback:* remove the custom domain and DNS record; revert the README merge; the preview
  stays available to the owner; installed apps are untouched.

## Open questions

**Q1. Where does automagik.si live, and what happens to automagik.dev?**
*Recommended:* Cloudflare Pages from this repository, no build command, output `apps/landing`,
previews for D3 and production from `dev` after D4. Add the apex and `www`, redirect `www` to
the apex, and 301 `automagik.dev` to `automagik.si` so there is one canonical site. The zone is
already the owner's; the only missing piece is the record. The owner keeps the account and the
domain; no credential enters the repository.

**Q2. Which music track, and under what licence?**
*Recommended:* one instrumental, 100-110 BPM, cleared in writing before 2026-11-11, with the
track, artist, licence and scope in `apps/landing/assets/film/LICENSES.md`. A CC0 track avoids a
credit line, and a paid one-off can be licensed without one; if the licence needs attribution,
the footer carries it.
If no track is cleared by 11-11, the owner picks a CC0 track the same day; no unlicensed track
ships.

**Q3. Do Arca and Vox appear?**
*Recommended:* no, not on this page. Arca's transfer to Automagik has not happened (2026-11-07,
"arca will be transfered to automagik"), and Vox is a private app with no public page. Showing
either would claim a product that a stranger cannot use. The seven blocks are the owner's list;
Arca can join when its transfer lands and it has its own announcement, and Vox can join when it
has a public page and the owner says so. Until then, neither gets a block, a logo or a line.

**Q4. Download or a Cloud waitlist as the one call to action?**
*Recommended:* download. The app ships today, free and Apache-2.0, and the draft's one move is
the download; it is the only action that works for a stranger on 2026-11-16. A Cloud waitlist
would need a real form, an email store, a privacy note and a Cloud date, and Cloud is accepted,
not shipped (RFC 0024); it is its own decision and its own RFC, not a static-page button. If the
owner wants it, the site ships download now and the waitlist becomes a second, clearly separate
action in a later delivery, never a dead or fake button.

## Links

- **The owner's answers, 2026-11-10** (the story, the site base, the deadline and the two OKs)
  and the 2026-11-08 source read behind "The claims to fix"; the Genie's draft and its brand
  brief. These are working notes, not repository files.
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
- **The parts' words:** `README.md`, `apps/bots-dsh/README.md`, `apps/desktop/README.md`,
  `apps/pocket/README.md`, `apps/welcome-dsh/README.md`, `herdr/README.md`,
  `marketplace/automagik.json`.
- **The checks and the lanes:** `herdr/scripts/privacy-check.mjs`,
  `herdr/scripts/privacy-list.json`, `scripts/lane.ts` (`NEVER_SHIPPED`),
  `.github/workflows/ci.yml`.
