// Automagik Herdr's releases over plain data (A14): which GitHub release is newer than the
// installed pack, which files it must carry, and the timing of the mod's check. Taken from
// Automagik's desktop updater (apps/desktop/src/update.js: compareVersions, pickUpdate, the
// 4-hour timing). Pure: no `herdr` and no `node:` imports, so the mod, the CLI and
// `node --test` share it; the download, checksum and swap live in update.mjs. Apache-2.0.
//
// The pack lives in the Automagik monorepo (herdr/) and ships on its releases, `v<version>` with
// the monorepo's one version (docs/rfcs/0010-monorepo-parts-and-releases.md there). A release
// carries the pack only when herdr/ changed since the one before: the newest release (GitHub's
// `latest`) is often a desktop or plugin release without it, so the update is the newest release
// that CARRIES automagik-herdr-pack-<v>.tgz and its .sha256, as the desktop's update.js does.

export const REPO = "automagik-dev/automagik";
/** The repository's releases, newest first: the pack's are among the desktop's and the plugins'. */
export const RELEASES_URL = `https://api.github.com/repos/${REPO}/releases?per_page=100`;
/** Where the pack lived until v0.7.x; the monorepo's release of it is the first above 3.0.0. */
export const OLD_REPO = "automagik-dev/automagik-herdr";
/** The folder that carries the pack's VERSION, update.mjs and the CLI. */
export const PACK_NAME = "am-sidebar";
/**
 * That folder's name before the rename (v0.2.0 to v0.4.x): what a v1 marker installed, where an
 * older install keeps its CLI, its first pack (`<name>.before-install`) and its briefing. Kept
 * here, not imported from migrate.js, because release.yml imports this file on its own.
 */
export const OLD_PACK_NAME = "spaces-agents";
/**
 * Every mod folder the pack ships (D3, D10): the tarball's top level is exactly these plus
 * `layouts/automagik.json`, and release.yml asserts it. It ships inside the tarball it checks, so
 * it guards against packaging bugs, not tampering (the tarball's .sha256 covers integrity). Pocket
 * Link is never one of them: Pocket owns it.
 */
export const PACK_MODS = Object.freeze(["am-automations", "am-footer", "am-markdown", "am-mods", "am-new-menu", "am-quota",
  "am-sidebar", "am-tabs"]);
export const POCKET_LINK = "pocket-link";
/**
 * The usagemeter release install.sh installs to ~/.local/bin/usagemeter (Group 6c): the binary for
 * `<os>-<arch>`, checked against that release's SHA256SUMS. install.sh carries the same version
 * (a test keeps them equal). The binary is shared with Pocket Link: never downgraded.
 */
export const USAGEMETER = Object.freeze({
  repo: "automagik-dev/usagemeter",
  version: "0.2.0",
  assets: Object.freeze({
    "darwin-arm64": "usagemeter-darwin-arm64", "darwin-x86_64": "usagemeter-darwin-x86_64",
    "linux-x86_64": "usagemeter-linux-x86_64", "linux-aarch64": "usagemeter-linux-aarch64",
  }),
});
/** The one layout the pack ships, beside the mod folders in the tarball. */
export const PACK_LAYOUT = "layouts/automagik.json";
/** sha256 of the bots-only layout v0.2.0–v0.2.2 installed: only that copy is replaced (D8). */
export const V020_LAYOUT_SHA256 = "5a479f72db788826acb2413df7d32721fbbb9fd070caaf1c7096c6b84778a8a3";
/** The pack's keys (the repository's keys.json, which a test keeps equal): merged only where free. */
export const PACK_KEYS = Object.freeze({ global: Object.freeze({ "cmd-shift-m": "mod.open:am-mods" }) });
/** What the mod manager lists; mods/am-mods/core.js's CATALOG_URL is kept equal by a test. */
export const CATALOG_URL = "https://raw.githubusercontent.com/automagik-dev/automagik/dev/herdr/catalog/index.json";
/**
 * Every catalog URL a pack has written (the current one first): the monorepo's on `main`, and the
 * old repository's on `dev` and `main`. A copy holding one of them is the pack's to rewrite; any
 * other URL is the person's. core.js keeps the same list (a test keeps them equal).
 */
export const PACK_CATALOG_URLS = Object.freeze([
  CATALOG_URL,
  "https://raw.githubusercontent.com/automagik-dev/automagik/main/herdr/catalog/index.json",
  `https://raw.githubusercontent.com/${OLD_REPO}/dev/catalog/index.json`,
  `https://raw.githubusercontent.com/${OLD_REPO}/main/catalog/index.json`,
]);
/** The pack's tarball on release `version` (release.yml's "Pack the herdr pack" step). */
export const tarballName = (version) => `automagik-herdr-pack-${version}.tgz`;
/** Its sha256, `sha256sum` output for the tarball alone, beside it on the same release. */
export const sumsName = (version) => `${tarballName(version)}.sha256`;

/**
 * The installer's ownership record (`<app home>/automagik-herdr/installed-by-install.sh`) as data.
 * v2: `version=`, `mods=<comma list>`, `layout=added|kept`, `before=kept|none`, and
 * `adopted=<mod>:<path under automagik-herdr/>,…` for folders moved to backup/ on --adopt, and
 * `migrated=backup/<name>,…`, the rename migration's journals (oldest first) that a rollback across
 * the rename reverts, and `usagemeter=<version>` when install.sh put the usagemeter binary in
 * ~/.local/bin (--uninstall removes only that one). A v1 marker (v0.2.x: no `mods=`) installed only OLD_PACK_NAME.
 */
/** Where an adopted folder may be kept: `backup/<name>`, a plain name (install.sh checks the same). */
export const ADOPTED_PATH = /^backup\/[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function parseMarker(text) {
  if (typeof text !== "string") return null;
  const get = (key) => (new RegExp(`^${key}=(.*)$`, "m").exec(text)?.[1] ?? "").trim();
  const list = (value) => value.split(",").map((s) => s.trim()).filter(Boolean);
  const v1 = !/^mods=/m.test(text);
  return {
    v1,
    version: get("version") || null,
    mods: v1 ? [OLD_PACK_NAME] : list(get("mods")),
    layout: get("layout") || null,
    before: get("before") || "none",
    adopted: list(get("adopted")).map((e) => ({ mod: e.slice(0, e.indexOf(":")), path: e.slice(e.indexOf(":") + 1) }))
      .filter((a) => /^[a-z0-9][a-z0-9-]*$/.test(a.mod) && a.mod !== POCKET_LINK && ADOPTED_PATH.test(a.path)),
    migrated: list(get("migrated")).filter((p) => ADOPTED_PATH.test(p)),
    usagemeter: /^\d+\.\d+\.\d+$/.test(get("usagemeter")) ? get("usagemeter") : null,
  };
}

export const formatMarker = ({ version, mods, layout, before = "none", adopted = [], migrated = [], usagemeter = null }) =>
  [`version=${version}`, `mods=${mods.join(",")}`, ...(layout ? [`layout=${layout}`] : []), `before=${before}`,
    ...(adopted.length ? [`adopted=${adopted.map((a) => `${a.mod}:${a.path}`).join(",")}`] : []),
    ...(migrated.length ? [`migrated=${migrated.join(",")}`] : []),
    ...(usagemeter ? [`usagemeter=${usagemeter}`] : [])].join("\n") + "\n";
/** Set to 1 to never ask GitHub (the CLI's update --check, the mod's notice). */
export const NO_UPDATE_ENV = "AUTOMAGIK_HERDR_NO_UPDATE";
export const FIRST_CHECK_MS = 20_000;
export const CHECK_EVERY_MS = 4 * 60 * 60 * 1000;
export const RETRY_MS = 30 * 60 * 1000;
export const TIMEOUT_MS = 15_000;

export const updatesOff = (env = {}) => String(env?.[NO_UPDATE_ENV] ?? "").trim() === "1";

const VERSION = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

/** Semver precedence: negative when `a` is older than `b`, 0 when equal, NaN when either is not a version. */
export function compareVersions(a, b) {
  const x = VERSION.exec(a);
  const y = VERSION.exec(b);
  if (!x || !y) return Number.NaN;
  for (let i = 1; i <= 3; i++) {
    const d = Number(x[i]) - Number(y[i]);
    if (d !== 0) return Math.sign(d);
  }
  if (!x[4] || !y[4]) return x[4] ? -1 : y[4] ? 1 : 0;
  const p = x[4].split(".");
  const q = y[4].split(".");
  for (let i = 0; i < Math.min(p.length, q.length); i++) {
    if (p[i] === q[i]) continue;
    const pn = /^\d+$/.test(p[i]);
    const qn = /^\d+$/.test(q[i]);
    if (pn && qn) return Math.sign(Number(p[i]) - Number(q[i]));
    if (pn !== qn) return pn ? -1 : 1;
    return p[i] < q[i] ? -1 : 1;
  }
  return Math.sign(p.length - q.length);
}

/**
 * A release (GitHub's release JSON) as the pack it carries: `{ version, tag, page, tarball:
 * {name, url}, sums: {name, url} }`, or null when it is a draft or prerelease, its tag is not
 * `v<version>`, or it lacks the pack's tarball or its .sha256 (a desktop or plugin release).
 */
export function packOf(release) {
  const tag = release?.tag_name;
  if (!release || release.draft || release.prerelease === true || typeof tag !== "string" || !tag.startsWith("v")) return null;
  const version = tag.slice(1);
  if (Number.isNaN(compareVersions(version, version))) return null;
  const asset = (name) => {
    const found = Array.isArray(release.assets) ? release.assets.find((a) => a?.name === name) : null;
    return typeof found?.browser_download_url === "string" ? { name, url: found.browser_download_url } : null;
  };
  const tarball = asset(tarballName(version));
  const sums = asset(sumsName(version));
  if (!tarball || !sums) return null;
  const page = typeof release.html_url === "string" ? release.html_url : `https://github.com/${REPO}/releases/tag/${encodeURIComponent(tag)}`;
  return { version, tag, page, tarball, sums };
}

/** The newest pack among `releases` (the releases list, or one release), or null when none carries it. */
export function newestPack(releases) {
  let best = null;
  for (const release of Array.isArray(releases) ? releases : releases ? [releases] : []) {
    const pack = packOf(release);
    if (pack && (!best || compareVersions(pack.version, best.version) > 0)) best = pack;
  }
  return best;
}

/**
 * The update `releases` (GitHub's releases list; one release is taken as a list of one) offer over
 * `current`: the newest release that carries the pack, when it is newer than `current`, else null.
 */
export function pickUpdate(current, releases) {
  const pack = newestPack(releases);
  return pack && compareVersions(pack.version, current) > 0 ? pack : null;
}

/** `sha256sum` output (`<hex>  <name>`, `*<name>` in binary mode) as a Map name → lowercase hex. */
export function parseSums(text) {
  const sums = new Map();
  for (const line of String(text ?? "").split(/\r?\n/)) {
    const m = /^([0-9a-fA-F]{64}) [ *](.+)$/.exec(line.trim());
    if (m) sums.set(m[2], m[1].toLowerCase());
  }
  return sums;
}

/**
 * The repository's releases (GitHub's JSON list, newest first), or null when updates are off or
 * the repository is not there (404). Throws on any other answer. `fetch` is injected: Herdr's
 * runtime has none, so the mod reaches this through `node update.mjs check`.
 */
export async function listReleases({ fetch = globalThis.fetch, env = globalThis.process?.env ?? {}, timeoutMs = TIMEOUT_MS } = {}) {
  if (updatesOff(env)) return null;
  const signal = typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(timeoutMs) : undefined;
  const response = await fetch(RELEASES_URL, {
    headers: { accept: "application/vnd.github+json", "user-agent": "automagik-herdr", "x-github-api-version": "2022-11-28" },
    signal,
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`GitHub answered ${response.status} for ${REPO}'s releases`);
  const list = await response.json();
  return Array.isArray(list) ? list : [];
}

/** The mod's notice for `update` (from pickUpdate). */
export const noticeText = (update) =>
  `Automagik Herdr ${update.version} is out. Run \`automagik-herdr update\` to install it (${update.page}).`;
