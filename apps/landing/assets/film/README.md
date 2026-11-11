# Our own GTM team

RFC 0027 delivery D2. Review cut; the owner approves the picture and music before publication.
No GitHub attachment or YouTube upload has been made. The README's player is a later change,
after the owner uploads the prepared small encode and its downloaded bytes are checked.

## Deliverables

| File | Purpose | SHA-256 |
|---|---|---|
| [automagik-launch.mp4](automagik-launch.mp4) | Site encode; H.264 + AAC, 1920×1080, 30 fps, 58 seconds, faststart | `f3320954cf566799324abb3c8c29e098dd34520ee229fe7906c861ad8812693d` |
| [automagik-launch-poster.webp](automagik-launch-poster.webp) | End-card frame at 54.5 seconds; 1920×1080 | `9de65ef9363e5cd021ba8a80be3108d479ebbfa680da3301c330063450d9d766` |
| Owner's prepared GitHub encode (outside this repository) | Same cut, under 10,000,000 bytes; not an uploaded attachment | `802c2dfd3071c8a4ff10eeb4f3138d16b5542feceaf70509fe3a82b19a87f63f` |

The owner's channel is [Automagik on YouTube](https://www.youtube.com/channel/UCLX2lP-PaCbjDU6ZzgdJbOg).
The film has not been uploaded.

[LICENSES.md](LICENSES.md) records the music's creator, source, download date, scope and saved
CC0 deed. [CC0-1.0.txt](CC0-1.0.txt) saves the complete legal code.

## Provenance and scene decisions

Rendered locally with **HyperFrames 0.9.33**, HTML/CSS and a paused **GSAP 3.15.1** timeline,
headless Chromium, then FFmpeg. The 1,740-frame visual master, authoring project, source music,
small GitHub encode, high-bitrate YouTube encode, thumbnail, proposed YouTube copy, 20-second
review preview and contact sheet stay in the delivery's private scratch, outside git. All three
full encodes derive from that one master and the same continuous music excerpt.

The storyboard was read as data; its full file and private source location are not copied
into the repository. The page comes from the pinned D3 source. Digests identify the versions used:

- Storyboard SHA-256: `e5f2e39e076ddcc5887e42cb2979009dfdec65ae84eff10b1b02bf7eb36c25fd`.
- D3 page from PR #1078, commit `4de231eff59d5b71ed61e5af60eb7dbd2c8ba7b6`.
- D3 HTML SHA-256: `eb58e4daf3b8aacc6250ab3e9208cfc28d7f73f848f6e198db62f5b40ada8ceb`.
- D3 CSS SHA-256: `e07282f0e4c35aea60ec8dd8a1aa804c295fda1a50d40ef64315d932d3bc2739`.
- App artwork and fonts: this repository at `a6221926fae0fd85d4af8d03d71aad6370fc0317`,
  `apps/bots-dsh/src/client/art/`; existing character geometry from `src/client/characters.js`
  and dark Bot inks from `src/client/inks.js`. The character choices are for this film;
  no saved production Bot appearance is asserted.

| Scene | Time | Source and resolution |
|---|---|---|
| The question | 0–7 s | Only the storyboard's greeting and question. The unknown pre-rename name is cut; “Automagik Launch” is used from the start. The person is “You”. |
| The call | 7–13 s | The storyboard's supplied shortened Automagik reply and “devs and builders first.” No unsupplied long reply is invented. |
| The hires | 13–24 s | Genie, GTM, group-name confirmation, Video Maker, in that order. Genie and Automagik use the app's existing expression sprites. GTM uses the app's star in tangerine (`#FF8A2E`); Video Maker uses its saucer in cobalt (`#5C78FF`), rendered by `characterMarkup` from the existing character set, as requested in frame review. The unverified model-version chips are cut. The confirmation keeps the fallback group name rather than inventing a former one. |
| The Genie's page | 24–36 s | Literal viewport excerpts of D3 at `4de231ef` (PR #1078), in its own styles: hero and download actions, blocks, What makes it yours with the corrected permission rules, and its current Made by this team line. No awaiting-D3 label or URL-bar text. Screen/demo chat captures and the film placeholder are outside the selected excerpts. |
| GTM's drafts | 36–47 s | The first three cards quoted by the storyboard, entering from the scene cut without a title-only pause, stamped “DRAFT · NOT POSTED”, with no social-media interface, metrics or timestamps. Their product claims are supported by the READMEs. Separate original draft files were not supplied; the storyboard is the source of these exact lines. The fourth, broad approval claim is cut following D1's correction. |
| You stay the boss | 47–52 s | The storyboard's “nothing gets published, I approve the cut”, attributed to “You”, with the remaining interface dimmed. |
| End card | 52–58 s | The app's own lockup, the storyboard's title and repository tagline, Mac/Linux line, and `github.com/automagik-si/automagik`. The licence line is scoped to this repository, Genie and Omni; Cloud's caveat stays in small print. Fade to black and silence at 58 seconds. |

No captured live profile, account email, credential, QR code, home path, real personal chat,
metric or invented character is used. The chat lines are the storyboard's selected launch
dialogue; the page's text is from D3.

## Verification and remaining owner steps

The delivery report contains fresh ffprobe and privacy-matcher results for all three full
encodes, the poster, contact sheet and YouTube thumbnail. The matcher checks binary readable
strings; the authored text and D3 excerpts are scanned separately, and frames at every
half-second of the timeline are read visually. Message geometry is also checked
at half-second intervals and at 0.1-second intervals around transitions; the original
24-second alignment defect is a failing negative control. This does not substitute for the owner's watch and music OK.

1. Review the full site cut and music, the scene contact sheet and the 20-second preview.
2. If approved, upload the prepared small encode as a GitHub attachment in a PR comment.
3. Download that attachment, compare SHA-256 with the prepared-file digest above, then add
   the attachment URL and verified digest to the root README and RFC 0027's film table.
4. Review the separate YouTube encode, frame-derived 1280×720 thumbnail, title and description;
   the owner approves and uploads to his channel. Nothing here publishes or triggers a release.
