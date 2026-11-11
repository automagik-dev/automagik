# Where the landing page's screens come from

Every image in `screens/` is a screenshot of the Automagik app's own interface, rendered by
`apps/landing/capture/capture.mjs` from the released plugins. None is drawn, mocked up or
edited afterwards. `screens/manifest.json` records the checkout, the runtime, each plugin's
pinned source and the SHA-256 of every image; `landing.test.mjs` fails if an image no longer
matches its digest.

## What rendered them

| Part | Version | Source |
|---|---|---|
| DeepSeek Harness (`@deepseek-ai/dsh`) | 0.2.1-rc.5 | The runtime the Bot team's harness and the desktop app both declare (`apps/bots-dsh/dev/harness`, `apps/desktop/runtime`) |
| `@automagik/bots-dsh` (the Bot team) | 3.52.1 | This repository at release commit `9f81aeed`; the script refuses to run if any shipped file differs from it |
| `@automagik/welcome-dsh` (the welcome) | 3.52.1 | Same release commit, same check |
| `@automagik/genie-dsh` (Genie) | 0.1.4 | `automagik-si/genie` at `39402fb1`, `plugins/genie-dsh`: the commit `marketplace/automagik.json` pins, exported with `git archive` |

Omni's plugins are not part of the capture (see *Left out*).

## What is real and what is made up

- **Real:** the app and its plugins, every screen and control, the welcome's steps, Pip
  messaging Genie, Genie's `grant_wish` tool, the wish's own copy of the project and its
  `wish/csv-export` branch, every shell command the thread ran and its output, the commit, the
  tests passing, the files in the review pane, and the branch coming back to the project.
- **Made up:** the person, the project and the words. Northwind is a fictional company, after
  Microsoft's classic Northwind sample database, whose customer names the three invented
  orders borrow. The commits are signed `Northwind Demo
  <demo@northwind.invalid>`. The AI is `capture/scripted-model.mjs`, a loopback stand-in
  for the AI provider: it gives every reply and chooses every tool call from a fixed English
  script, so no AI provider was called. The app labels the model `DeepSeek-V4.1-Flash`
  because the capture connects it as DeepSeek, the provider the welcome found. The thread's
  report states the test counts the real `npm test` printed, and the script checks them
  again in a fresh clone of the branch.

## How it runs

```sh
bun install && (cd apps/bots-dsh && bun install && bun run harness) && (cd apps/welcome-dsh && bun install)
node apps/landing/capture/capture.mjs --run    # from the checkout root; GENIE_REPO=<genie clone> if it is not beside the main checkout
```

The run is cut off from the person's own setup:

- Its own folder under `/tmp` (outside the checkout, so no repository `AGENTS.md` reaches the
  Bots).
- Relocated `HOME`, `DSH_HOME`, `AUTOMAGIK_HOME` and every cache.
- An allowlisted environment.
- Sockets fenced to loopback and to the runtime's own ports (`apps/bots-dsh/dev/advanced-fixture/loopback-only.mjs`).
- A fresh headless Chrome profile that blocks every other origin.

It never touches an installed Automagik app, its profile or a live DSH.

It asserts every step before it takes a picture:

- the welcome's team state;
- Pip's hand-off to Genie;
- one commit on the wish branch, adding the four files;
- the branch's tests passing in a fresh clone;
- the project still on `dev`, so nothing was merged;
- Genie's report;
- the test output in the thread;
- the diff in the review pane;
- no host path, token or e-mail address in each captured view, and no real home folder anywhere on the page;
- no browser request outside the runtime.

## The screens

| File | Size | What it shows |
|---|---|---|
| `team-step.png` | 1440×900 @2x | The welcome's **Grow your team** step after the person made their companion, Pip (an orange bunny). Pip says: *Pip here! Omni is asleep. Click its power button to bring it along.* The step reads *Pip leads. Who comes along?* Omni's card shows a sleeping octopus with its power button off. Its *Powered off* label is for screen readers only, and the capture asserts it. Genie's card says *Ready for a wish* and *On your team*: its plugin is installed. |
| `pip-delegates.png` | 1440×900 @2x | Pip's chat. The person asks for a CSV export of the Northwind orders report. Pip says it passes the request on, sends Genie a message (*Messaged Genie*), and, after *Message from Genie*, says the wish is running on `wish/csv-export`. In the sidebar, Genie's finished thread **CSV export** is marked *Done*. |
| `pip-delegates-phone.png` | 390px wide @2x, cropped below the chat's floating header | The same chat at phone width. |
| `genie-report.png` | 1440×900 @2x | Genie's chat. Genie's greeting, the folded exchange with Pip, *Task finished · Wish: CSV export*, and Genie's report: the branch is back in Northwind with one commit, the tests pass, nothing was pushed or merged. |
| `genie-report-phone.png` | 390px wide @2x, cropped like the other phone screen | The same report at phone width. |
| `wish-checks.png` | 1440×860 @2x (bottom status row cropped) | The wish thread **Wish: CSV export**. Its steps are listed, and the test step is open: the command, two passing tests, `pass 2`, `fail 0`, and the CSV that `npm run export` printed. |
| `wish-diff.png` | 1440×860 @2x (bottom status row cropped) | The thread's **Report** and its *Edited 4 files* card (package.json, src/csv.js, src/export.js, test/csv.test.js), with the review pane showing the new `src/csv.js`. |

The two wish captures leave out the status row under the composer. Its throughput figure
comes from the scripted model's instant replies and says nothing about a real model. For the
same reason, *Completed in 1s* at the top of `wish-checks.png` is the scripted turn's time,
not a real model's; the page's provenance note says so.

## Left out, and why

- **Omni at work** (its channels, reminders or approvals). Turning Omni on in the welcome
  installs Omni's plugins and then looks for an Omni server to link. Its chats come from real
  WhatsApp, Telegram or Slack accounts. Neither works offline without a real channel or a
  running service, so Omni appears only as the welcome shows it here: asleep, with its power button off.
- **The desktop window frame.** The captures are the app's web interface in Chrome: the
  interface the desktop app shows inside its window, without the Electron title bar. The
  desktop app also loads Omni's plugins and the AI-subscription add-ons, which add controls
  of their own that these screens do not have.
- **The market's one-click install.** No verified link exists, so the page's button is off
  and marked TODO.

## RFC 0027 D3 additions, 2026-11-11

`code-sidebar.png` (722×668) is a byte-for-byte copy of the pack's own share image,
`herdr/mods/am-sidebar/preview.png`. Commit `6e116024aa760694bfc6af81111eb99c2fa1428a`
introduced it at `herdr/mods/spaces-agents/preview.png`; the folder later moved to
`am-sidebar`. That commit records a **herdr-app shot of a scratch demo project**, cropped to
its bot tree. It also records that the overlay scrollbar was painted out of the original
share image. D3 makes no further edits. RFC 0027 explicitly permits the pack's own captured
share image. The page identifies the crop and the original retouch, rather than presenting
it as a new full-window recording. It shows demo-shop, Main Bot Ada, build and quality
categories and a planned Bot. It does not show an active coding run or the Work/Code switch.
Its source and digest are recorded under `additionalCaptures` and `images` in the manifest.

The Team and Genie pictures retain their original digests and provenance above. No Omni
channel, phone, meter or Cloud screen is fabricated to illustrate the other blocks.

### The film slot

D2 has not supplied the committed encode or poster at D3's implementation. The single film
figure reuses `pip-delegates.png` as a clearly labelled stand-in and says **The film comes in
D2**. It is not a rendered film, play control or new capture. D2 replaces that one figure with
the approved poster/player and records the film's provenance and music licence. There is no
second film element and no off-site player.

### Brand

The draft's fonts, marks and existing app character art are copied selectively into
`brand/`, with the font licences and `brand/LICENSES.md`. No private draft document is
copied. The marks and octopus are brand accents. Every product image still comes from the
recorded capture manifest.

The earlier *market one-click install* note describes the old developer page. The new site
links to this repository's desktop release; the developer commands are in the landing README.
