// The welcome's clay: the same material as the Bot team's theme (apps/bots-dsh
// src/client/clay.js), restated here because this plugin installs on its own. Light first;
// DSH's dark palette (body[data-ds-dark-theme], set from its Appearance setting, which
// follows the system unless the person chose) turns it to the same clay at night.
//
// Every surface is a piece of clay lit from the upper left: a highlight bevel on its upper
// left, a shade bevel on its lower right, a ledge (its own side, seen below it) and a soft
// contact shadow. A piece at rest stands on its ledge; lifted, it rises and its shadow
// spreads; pressed, it sinks onto the ledge; recessed, it is a hollow pressed into the clay.
// The colours below are proposed values sampled from the owner's clay landing page, not
// brand standards.

export const CLAY_TOKENS = `
.oai-overlay{
  --oai-bg:#f6eee2;--oai-card:#fbf5ec;--oai-clay:#f2e6d5;--oai-niche:#ebdecb;
  --oai-ink:#3c3049;--oai-ink2:#6c5f71;--oai-line:#e0d0bd;
  --oai-accent:#1b7f96;--oai-accent-2:#b4498f;--oai-bad:#b93a32;--oai-ok:#2f8a63;--oai-warn:#a8700f;
  --oai-cyan:#8fdcec;--oai-cyan-ink:#1d4753;--oai-pink:#f0bddf;--oai-pink-ink:#5a2550;--oai-lilac:#e0cff3;--oai-lilac-ink:#45305e;
  --oai-shine:#fff;--oai-umber:#5b3b22;--oai-hi:42%;--oai-lo:80%;--oai-ledge:72%;
  --oai-cast:rgba(111,81,53,.2);--oai-cast-far:rgba(121,91,53,.1);--oai-ring:#b4498f;
  --oai-r:19px 22px 18px 21px;--oai-r-sm:12px 14px 12px 13px;
  --oai-font:"DM Sans",ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  --oai-head:Manrope,"DM Sans",ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;
  color-scheme:light}
body[data-ds-dark-theme] .oai-overlay{
  --oai-bg:#1e1923;--oai-card:#2a2330;--oai-clay:#322a39;--oai-niche:#16121a;
  --oai-ink:#f3e9dd;--oai-ink2:#bcadb8;--oai-line:#40364a;
  --oai-accent:#7fd8ea;--oai-accent-2:#f2a6dc;--oai-bad:#ff9a8f;--oai-ok:#7ad9a8;--oai-warn:#f2c25b;
  --oai-cyan:#5cbdd1;--oai-cyan-ink:#0d262c;--oai-pink:#b76aa1;--oai-pink-ink:#fff2fa;--oai-lilac:#55456b;--oai-lilac-ink:#f4ecff;
  --oai-shine:#fff;--oai-umber:#000;--oai-hi:84%;--oai-lo:62%;--oai-ledge:50%;
  --oai-cast:rgba(0,0,0,.42);--oai-cast-far:rgba(0,0,0,.28);--oai-ring:#f2a6dc;
  color-scheme:dark}
`

// A raised piece of `fill`, standing `depth` px on its ledge.
export const raised = (fill, depth = 4) => `background:${fill};box-shadow:inset 2px 3px 4px color-mix(in srgb,${fill} var(--oai-hi),var(--oai-shine)),inset -3px -4px 6px color-mix(in srgb,${fill} var(--oai-lo),var(--oai-umber)),0 ${depth}px 0 color-mix(in srgb,${fill} var(--oai-ledge),var(--oai-umber)),0 ${depth + 3}px ${depth + 5}px var(--oai-cast),0 ${depth * 3 + 4}px ${depth * 5 + 8}px var(--oai-cast-far)`
// The same piece pressed down onto its ledge.
export const pressed = (fill, depth = 4) => `transform:translateY(${depth - 1}px);box-shadow:inset 3px 4px 6px color-mix(in srgb,${fill} var(--oai-lo),var(--oai-umber)),inset -1px -2px 3px color-mix(in srgb,${fill} var(--oai-hi),var(--oai-shine)),0 1px 0 color-mix(in srgb,${fill} var(--oai-ledge),var(--oai-umber)),0 2px 3px var(--oai-cast)`
// A hollow pressed into the clay around it (fields, tracks, niches).
export const recessed = fill => `background:${fill};box-shadow:inset 3px 4px 6px color-mix(in srgb,${fill} var(--oai-lo),var(--oai-umber)),inset -2px -2px 3px color-mix(in srgb,${fill} var(--oai-hi),var(--oai-shine)),0 1px 0 color-mix(in srgb,var(--oai-bg) var(--oai-hi),var(--oai-shine))`
