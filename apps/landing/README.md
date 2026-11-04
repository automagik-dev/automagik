# Automagik landing page

A static page for automagik.dev (`index.html`, `styles.css`, local fonts). It has no
JavaScript, no build step and no analytics, and nothing on it is deployed from here. It
shows the product with screens of the real app, captured from the released plugins in a
fixture of their own. Where those screens come from: [assets/CAPTURES.md](assets/CAPTURES.md).

The page shows, in order:

1. Pip, the Main Bot, handing a request to Genie.
2. The welcome's team step.
3. Genie's wish → branch → report, in three screens: report, test run, diff.
4. Everything is a plugin: the three plugins behind the screens and the Automagik market
   index, crediting DeepSeek Harness.
5. The two developer commands: the Genie CLI installer and `genie desktop`.

It leaves out Omni at work and the market's one-click install, which is not verified. The
reasons are in CAPTURES.md.

It follows the predecessor prototype (`wish/build-automagik-launch-landing-page`) for its
type, colours and lockup. Its character art is gone: every picture is a capture.

## Commands

From the checkout root:

```sh
node apps/landing/capture/capture.mjs --run   # re-capture assets/screens and manifest.json (see CAPTURES.md)
node --test apps/landing/landing.test.mjs     # the page's contract: digests, links, claims, privacy
node apps/landing/verify-browser.mjs          # headless Chrome at 1440/1024/390/320px; screenshots in .cache/landing-evidence
python3 -m http.server -d apps/landing 4178   # local preview
```

The desktop download links of the earlier prototype (`releases/latest/download/Automagik-*.{dmg,deb,AppImage}`)
answered 404 on 2026-10-31: the latest release (v3.52.0) carries plugin tarballs, not app
builds. The page therefore points developers to `genie desktop`, which picks the newest
release that has a build for the machine.
