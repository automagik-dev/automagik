# Remote Hermes wizard — static design frames

PR #1075 stays **draft and held**. These are mock frames for the orchestrator to check before
the owner's look. They are not an implemented wizard. No product source, transport, auth flow,
route icon or generated client bundle changed in this round. Keep the earlier `1070-shots`
folder too. Remove this mock folder in a later commit before merging, after review.

Start with the [light overview](light-overview.png) or [dark overview](dark-overview.png).
Each numbered state also has a full-size PNG below.

| Frame | Light | Dark |
| --- | --- | --- |
| 01 · First click | [Light](light-01-first-click.png) | [Dark](dark-01-first-click.png) |
| 02 · Choose how | [Light](light-02-choose-how.png) | [Dark](dark-02-choose-how.png) |
| 03a · Remote address / token | [Light](light-03a-address-token.png) | [Dark](dark-03a-address-token.png) |
| 03a · Remote address / sign in | [Light](light-03a-address-sign-in.png) | [Dark](dark-03a-address-sign-in.png) |
| 03b · Through SSH | [Light](light-03b-ssh.png) | [Dark](dark-03b-ssh.png) |
| 04a · Testing | [Light](light-04a-testing.png) | [Dark](dark-04a-testing.png) |
| 04b · Connected | [Light](light-04b-connected.png) | [Dark](dark-04b-connected.png) |
| 04c · Sign-in error | [Light](light-04c-sign-in-error.png) | [Dark](dark-04c-sign-in-error.png) |
| 04d · SSH error | [Light](light-04d-ssh-error.png) | [Dark](dark-04d-ssh-error.png) |
| 05 · Pick a profile | [Light](light-05-pick-profile.png) | [Dark](dark-05-pick-profile.png) |
| 06a · Done | [Light](light-06a-done.png) | [Dark](dark-06a-done.png) |
| 06b · Later clicks | [Light](light-06b-returning-click.png) | [Dark](dark-06b-returning-click.png) |

Frame 1 illustrates the click and the opened choice screen together; Frame 2 enlarges that
same screen. It is not an extra welcome step. Frame 3a has both supported sign-in choices.
Frame 4 includes progress, success, a token error and an SSH error. Frame 5 shows a profile
listed by the instance. Frame 6 shows completion and the later single-click route behavior.

## Source research and proposed behavior

Read the [short issue note](https://github.com/automagik-si/automagik/issues/1070#issuecomment-6800171391)
and [cited research](../../research/remote-hermes-desktop-setup.md). The inspected upstream
connection sources match at pinned `3bcd071226d3d605a2bb3b4f3933e7d583e189d6` and current-main
snapshot `5df966a97a2d5fe37a309266ea97acb0c856942d`.

The frames propose a Remote address / Through SSH choice, masked token or password input,
optional SSH overrides, a connection test, instance-scoped profile selection, and a remembered
connection. Passwords are used only for sign-in. The DSH design keeps standing credentials in
the existing Bot secret store, out of URLs, and uses fresh one-use ticket subprotocols. Exact
sign-in integration and SSH ownership behavior still require an implementation design after
the owner picks the frames; these images do not broaden the tested contract pin.

## Render provenance

These are offline HTML/CSS drawings. The temporary renderer lives outside the repository and
has no event handlers, API calls or connection implementation. Headless Chromium opened local
files with external requests blocked, exported the PNGs, then closed. No app service, Hermes,
SSH, remote command or real account was used.

Colors, type and shapes follow the app's current Automagik theme in
[stage.js](../../../apps/bots-dsh/src/client/stage.js), using its bundled DM Sans and Manrope.
The blurred backdrop is the existing approved, sample-only `1070-shots` route capture.
Native, ACP and Herdr glyphs reuse the app's existing artwork. Inputs use `example.invalid`
and `sample-profile`; user, port, key and path overrides are blank. The masked token is a
synthetic sample. The private reference images were never opened, copied or used as assets.
Visible text, input placeholders, PNG metadata and the public notes were privacy-scanned.

## Original Hermes girl mark

The mock uses the exact themed upstream PNGs selected by
[Desktop BrandMark](https://github.com/NousResearch/hermes-agent/blob/3bcd071226d3d605a2bb3b4f3933e7d583e189d6/apps/desktop/src/components/brand-mark.tsx#L6-L18),
generated from [the original girl SVGs](https://github.com/NousResearch/hermes-agent/blob/3bcd071226d3d605a2bb3b4f3933e7d583e189d6/scripts/generate_icons.py#L1-L10).
The upstream repository distributes those assets under its root MIT terms; no adjacent asset
exception was found. This license application is an inference from that distribution, not an
express trademark or endorsement grant. Retain the full upstream notice in
[HERMES-MIT-LICENSE.txt](HERMES-MIT-LICENSE.txt). Existing app artwork notices remain in the
[Bot NOTICE](../../../apps/bots-dsh/NOTICE).
