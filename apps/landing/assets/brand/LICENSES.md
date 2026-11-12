# Brand assets

Automagik's own marks and character art, Arca's icon, we unfold's Open Intelligence tag and
the official logos of eleven open projects the products are built on (the last section) are
used. No customer marks or new drawings are included.

- `mark.webp`, `wordmark.webp`, `lockup.webp`, `app-icon.png`: Automagik
  brand files copied from the owner's Genie landing draft for RFC 0027 D3, 2026-11-11.
  Apache-2.0, Namastex Labs and the Automagik contributors; see `LICENSE-Apache-2.0.txt`.
- `automagik-wordmark-ink.svg`, `automagik-wordmark-cream.svg`: the lowercase Automagik
  wordmark with the pink dot, from Automagik's own logo kit of 2026-11-12, copied unchanged
  under the kit's file names (letters as outlines; dark for the light page, cream for the
  dark one). Apache-2.0 as the files above. The header and the footer show it beside the
  triskle. SHA-256, `automagik-wordmark-ink.svg`: `09d2caacb6bf3b98589a26edc430a6e75ccedb98e2588fa57771c32d603eeec0`;
  `automagik-wordmark-cream.svg`: `148ef1cf2c0453378f5ba30712841974914436bed9e87a530f0c637018b3b3c8`.
- `triskle.webp`: the clay triskle of `lockup.webp`, for the header and the footer: that
  file's first 225 of 902 columns, every pixel as a browser decodes it, stored lossless.
  Made with sharp 0.35.4 (libwebp 1.6.0, the decoder browsers use; ffmpeg's own decoder
  gives other colours for the same file, so it is not used here):
  `sharp('lockup.webp').extract({ left: 0, top: 0, width: 225, height: 192 }).webp({ lossless: true, effort: 6 }).toFile('triskle.webp')`.
  The browser gate decodes both files and compares every pixel.
  The cut ends where the triskle's tip ends; the column after it, where the tip's soft edge
  met the first capital's, is left out. SHA-256, `triskle.webp`: `1c846b39f813238fb8d083a110396b0dd5f3725493047ae8539ccec72d57a559`;
  its source `lockup.webp`: `17dfab1ee84cbcdf6b27f877226730dbba68f75439b3337e2df93574749cabda`.
  `lockup.webp`, the triskle with the retired gradient capitals, stays only as the source
  of this file and of the official lockup below; no page shows it.
- `lamp.webp`, `omni-pleased.png`: Automagik's own character art, copied unchanged from the
  same draft. The lamp also lives in `apps/bots-dsh/src/client/art/lamp.webp`; the octopus
  in `apps/desktop/assets/dmg-source/omni-pleased.png`. Apache-2.0. The app's art comes
  from DS Bot, Copyright 2026 Fei2411 and the DS Bot contributors, and Automagik,
  Copyright 2026 Namastex Labs and the Omni contributors (the Bots and welcome NOTICEs).
  These are brand accents, never substitutes for product captures.
- `arca/svg/arca-icon-ink.svg`, `arca/svg/arca-icon-ivory.svg`: Arca's icon, from Arca's logo
  kit (draft 3), copied unchanged under the kit's file names. Arca's mark belongs to Arca;
  it is shown here for Arca with Arca's agreement, by its kit's rules, and is not covered by
  this site's Apache-2.0 grant. A newer kit replaces these files at the same paths.
- `open-intelligence/open-intelligence-tag.svg`: we unfold's horizontal Open Intelligence
  tag, one colour, copied unchanged from Arca's public repository (`automagik-si/arca`,
  commit `7da787e`, `assets/open-intelligence/`). The tag is we unfold's mark, used as the
  owner directs; it is not covered by this site's Apache-2.0 grant, and we unfold's source
  carries no licence file.
- `automagik/automagik-lockup-oi-ink.svg`, `-cream.svg`, `-ink.png`, `-cream.png`: the
  official Automagik lockup, built by `scripts/build-lockup.mjs` from `lockup.webp`
  (unchanged; enlarged from its 902 px in the PNGs), the tag above (unchanged) and IBM Plex
  Mono SemiBold for the tag's words. The logo is Apache-2.0 as the other Automagik brand
  files; the tag inside it stays we unfold's.
- `ibm-plex-mono-latin-600.woff2`: IBM Plex Mono SemiBold, Latin, Copyright 2017 IBM Corp.,
  from `@fontsource/ibm-plex-mono` 5.3.0, unchanged. SIL Open Font License 1.1, reproduced
  in `OFL-IBMPlexMono.txt`. It sets the tag's words.
- `manrope-latin.woff2`: Manrope, Copyright 2018 The Manrope Project Authors.
  SIL Open Font License 1.1, reproduced in `OFL-Manrope.txt`.
- `dm-sans-latin.woff2`: DM Sans, Copyright 2014 The DM Sans Project Authors.
  SIL Open Font License 1.1, reproduced in `OFL-DMSans.txt`.

The fonts are copied unchanged from the draft's brand folder; the OFL text is reproduced with
line endings and trailing whitespace normalized. No private
brief, chat, account information or input directory is part of this site.

## Derived site art (`assets/art/`)

The site's WebP art is cropped and scaled, never redrawn, from Automagik's own files in this
repository, all Apache-2.0: the clay mark (`apps/desktop/assets/mark.png`), Genie
(`apps/desktop/assets/dmg-source/genie.png`), the Omni octopus and app icon (above), the lamp
and the Genie and Omni expression strips (`apps/bots-dsh/src/client/art/`) and the Automagik
pet's first frame (`apps/bots-dsh/src/host/pets/automagik/`). The Bots' art carries the DS Bot
and Automagik notices of `apps/bots-dsh/NOTICE`. Crops of product captures are recorded in
`assets/CAPTURES.md`; `assets/art/manifest.json` lists every source and digest.

## The projects row (`used/`)

The home's row "Things that made our stack possible" shows eleven open projects the products are
built on, in the owner's order, by the owner's decision of 2026-11-12: each project's own
logo, linked to the project's own site, under one line of credit ("Each name and logo belongs
to its project; none endorses Automagik."). The row is a credit, not a claim of partnership,
sponsorship or endorsement.

**If a project's owner asks, its logo comes down the same day.** Remove its entry from `used`
in `scripts/build-pages.mjs`, its files from `used/` and its rows here, and regenerate the
pages; nothing else depends on it.

Every file is an unchanged copy of the project's official file, under the file's own name,
fetched on 2026-11-12 and compared byte for byte with its source. Nothing is recoloured,
cropped, redrawn or filtered; a mark is only scaled, and where a project publishes a file for
dark pages that file is used there. None of these marks is covered by this site's Apache-2.0
grant: each belongs to its project or its owner. DeepSeek Harness is a trademark of DeepSeek;
NATS™ is a trademark of The Linux Foundation (both sentences are in the footer of every page,
and NATS™ is in its mark's alt text).

| File | Project and source | Rule read | SHA-256 |
|---|---|---|---|
| `used/deepseek-harness/favicon.svg` | DeepSeek Harness: `https://deepseek.com/harness/favicon.svg`, the project site's own icon | The project's `BRAND_GUIDELINES.md` (repository `deepseek-ai/deepseek-harness`, MIT): the name may describe what a project is built on; brand material must not suggest endorsement | `d19b62d73c8db53d5a241dfb4adbc7cad259557e5da8da6587a86d7dd4b06382` |
| `used/herdr/herdr.png` | Herdr: `https://herdr.dev/live/icons/herdr.png`, the mark in the site's own header | Repository `herdrdev/herdr` is Apache-2.0, which grants no trademark right; the project publishes no logo rules | `a9e6710a7c41bc2d9cd16b08ae44e0e79fc99fd3ee4494dfa1b3d80c0867f167` |
| `used/agent-client-protocol/light.svg` | Agent Client Protocol: `agentclientprotocol/agent-client-protocol`, `docs/logo/light.svg`, commit `7ace1c84ba96` | Brand page `https://agentclientprotocol.com/brand`: the logomark in pure black or pure white; repository Apache-2.0 | `8af22bf3112cb9b732ef275cdac1ff506096d8561b2d2727563cc17e0a78f9d0` |
| `used/agent-client-protocol/dark.svg` | Agent Client Protocol: same repository and commit, `docs/logo/dark.svg` | as above | `11f5751c5537c549f73e8e01e8d24cd155155b2f9989cc257f622d6b0e186beb` |
| `used/model-context-protocol/favicon.svg` | Model Context Protocol: `modelcontextprotocol/modelcontextprotocol`, `docs/favicon.svg`, commit `3b05e1498d02` | A series of LF Projects, LLC: its trademark policy (`https://lfprojects.org/policies/`) applies; documentation CC-BY-4.0 | `f6f33e24e95846f9ae2582ab72c4eae7beec5ec52c13d767d9f342bf639dd3e6` |
| `used/a2a/a2a_icon_color.svg` | A2A: `a2aproject/A2A`, `docs/assets/a2a_logo/icon/color/SVG/a2a_icon_color.svg`, commit `43bddf8cc15b` | A Linux Foundation project (`https://www.linuxfoundation.org/legal/trademark-usage`); repository Apache-2.0 | `ee46ec740f2180ddd5cc4376c55c5a7cf7bc1756aee72676f2f1b38ee7e07942` |
| `used/a2a/a2a_icon_white.svg` | A2A: same repository and commit, `docs/assets/a2a_logo/icon/white/SVG/a2a_icon_white.svg` | as above | `f59cc9bf320f56410f6b584a9d957231bd539dd833d3c61c2d48637b581998e5` |
| `used/hermes-agent/Square44x44Logo.scale-200.png` | Hermes Agent: `NousResearch/hermes-agent`, `apps/desktop/assets/appx/Square44x44Logo.scale-200.png`, commit `386e31a56f0a`: its app icon | Repository MIT; the project publishes no logo rules | `65b3c46504401c7342a89b9076c199a8cb9ddc33a19a3962208ca4ab17b5bc5c` |
| `used/oh-my-pi/favicon.svg` | Oh My Pi: `https://omp.sh/favicon.svg`, the project site's own icon | Repository `can1357/oh-my-pi` is MIT; the project publishes no logo rules | `9419975a0c24961341221c4cec18703db26a989fa037768f92cda74e3769fe05` |
| `used/pi/logo.svg` | Pi: `https://pi.dev/logo.svg`, the press kit's primary logo (`https://pi.dev/press-kit`) | Press kit: "Vector logo for light/dark usage and editorial placements"; repository `earendil-works/pi` is MIT | `abd66e7868b2d24f0f0895f9237ee8a6dcb22337583b0dc54aeb595acecb4d6b` |
| `used/nats/nats-icon-color.svg` | NATS: `cncf/artwork`, `projects/nats/icon/color/nats-icon-color.svg`, commit `d8ed92555f9a` | CNCF artwork rules and the Linux Foundation's trademark usage page: official artwork only, unchanged, NATS™ at first use, never larger than our own name | `aeac64fac2ef4226a921508afc8097bd6300cdc9361779acdd19ec650a961992` |
| `used/nats/nats-icon-white.svg` | NATS: `cncf/artwork`, `projects/nats/icon/white/nats-icon-white.svg`, commit `c33a8386bce4` | as above | `8cc9d248f1ebf26afe0d018928fd10cf4e993a3c29bb377d9f43fc62c1f05014` |
| `used/iroh/iroh-wordmark-dark.svg` | iroh: `https://www.iroh.computer/img/logo/iroh-wordmark-dark.svg` | The project publishes only a wordmark and no logo rules; its site content is CC BY 4.0 | `f1afda58f6d1a2d0c81ad08eb4ca66b15e037b4f53afba3a0076e822f1e7ff9f` |
| `used/iroh/iroh-wordmark-purple.svg` | iroh: `https://www.iroh.computer/img/logo/iroh-wordmark-purple.svg` | as above | `6d5792a5ac8bba070568425bfcc0be62af6c1d83be9504e41a3f3fbcb5036ef1` |
| `used/better-auth/better-auth-mark-dark.svg` | Better Auth: `https://better-auth.com/branding/svg/better-auth-mark-dark.svg` | Brand page `https://better-auth.com/brand`: "Use the mark at 24px minimum" | `2ec66cc731c512c7393599f60f5bf96b6aba7b120452c7fb0bf3972e906baec6` |
| `used/better-auth/better-auth-mark-light.svg` | Better Auth: `https://better-auth.com/branding/svg/better-auth-mark-light.svg` | as above | `c56f291bcafc69d3de67952e8f93447173062b8d60650fd62c5fad0696b6576b` |
