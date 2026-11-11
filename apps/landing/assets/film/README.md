# Our own GTM team

RFC 0027 delivery D2. Review cut; the owner approves the picture and music before publication.
No GitHub attachment or YouTube upload has been made. The README's player is a later change,
after the owner uploads the prepared small encode and its downloaded bytes are checked.

## Deliverables

| File | Purpose | SHA-256 |
|---|---|---|
| [automagik-launch.mp4](automagik-launch.mp4) | Site encode; H.264 + AAC, 1920×1080, 30 fps, 58 seconds, faststart | `9aaddd2443ad9ebfc65f0a2b73168a435abeffe95e627428bf40c43b29b82707` |
| [automagik-launch-poster.webp](automagik-launch-poster.webp) | End-card frame at 54.5 seconds; 1920×1080 | `83d51fe6c685bfae6b199c0ec0989c5e16c1f414bfb2452de28a55d90e20ebfe` |
| Owner's prepared GitHub encode (outside this repository) | Same cut, under 10,000,000 bytes; not an uploaded attachment | `9dc33828479d884d24faad18254b1b995c3a47fadad8611b8878c9f24ae7cbbb` |

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

The storyboard and draft were read as data. Their full files and private source locations are
not copied into the repository. Source digests identify the versions used:

- Storyboard SHA-256: `e5f2e39e076ddcc5887e42cb2979009dfdec65ae84eff10b1b02bf7eb36c25fd`.
- Genie's supplied draft HTML SHA-256: `2b4b98f9c5c54e2ebecbf92758c6db9dc29536de1b9133c991ebff1b8afcdd7b`.
- App artwork and fonts: this repository at `a6221926fae0fd85d4af8d03d71aad6370fc0317`,
  `apps/bots-dsh/src/client/art/`; dark Bot inks from `src/client/inks.js`.

| Scene | Time | Source and resolution |
|---|---|---|
| The question | 0–7 s | Only the storyboard's greeting and question. The unknown pre-rename name is cut; “Automagik Launch” is used from the start. The person is “You”. |
| The call | 7–13 s | The storyboard's supplied shortened Automagik reply and “devs and builders first.” No unsupplied long reply is invented. |
| The hires | 13–24 s | Genie, GTM, group-name confirmation, Video Maker, in that order. Genie and Automagik use the app's existing expression sprites. GTM and Video Maker use neutral initials; their saved individual looks were not supplied. The unverified model-version chips are cut. The confirmation keeps the fallback group name rather than inventing a former one. |
| The Genie's page | 24–36 s | Selected literal excerpts of the current supplied draft, shown in its own styles: hero, group-chat heading and points, approval example, and its “Made by this team” line. The film visibly says “The Genie's current draft · selected sections · awaiting D3”. D3 has not landed at build time. Quill, Iris, Scout, the sample chats, numbers, channel-connection instructions and stale blanket-approval claims are cut. No URL-bar text. |
| GTM's drafts | 36–47 s | The first three cards quoted by the storyboard, stamped “DRAFT · NOT POSTED”, with no social-media interface, metrics or timestamps. Their product claims are supported by the READMEs. Separate original draft files were not supplied; the storyboard is the source of these exact lines. The fourth, broad approval claim is cut following D1's correction. |
| You stay the boss | 47–52 s | The storyboard's “nothing gets published, I approve the cut”, attributed to “You”, with the remaining interface dimmed. |
| End card | 52–58 s | The app's own lockup, the storyboard's title and repository tagline, Mac/Linux line, and `github.com/automagik-si/automagik`. The licence line is scoped to this repository, Genie and Omni; Cloud's caveat stays in small print. Fade to black and silence at 58 seconds. |

No captured live profile, account email, credential, QR code, home path, real personal chat,
metric or invented character is used. The only chat lines shown are the storyboard's selected
launch dialogue and the draft's explicitly fictional approval example.

## Verification and remaining owner steps

The delivery report contains fresh ffprobe and privacy-matcher results for all three full
encodes, the poster, contact sheet and YouTube thumbnail. The matcher checks binary readable
strings; the authored text and draft excerpts are scanned separately, and representative frames
from each scene are read visually. This does not substitute for the owner's watch and music OK.

1. Review the full site cut and music, the scene contact sheet and the 20-second preview.
2. If approved, upload the prepared small encode as a GitHub attachment in a PR comment.
3. Download that attachment, compare SHA-256 with the prepared-file digest above, then add
   the attachment URL and verified digest to the root README and RFC 0027's film table.
4. Review the separate YouTube encode, frame-derived 1280×720 thumbnail, title and description;
   the owner approves and uploads to his channel. Nothing here publishes or triggers a release.
