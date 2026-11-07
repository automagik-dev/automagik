#!/usr/bin/env bun
/**
 * The plugin lane: plugins have a route of their own, apart from the desktop app's releases
 * and from Omni's and Genie's. A merge into dev that changes only the plugins (the Bot team,
 * the welcome) is released as a patch (3.N.P) with the plugin tarballs alone, no desktop build;
 * every release, full or patch, then updates one signed manifest that every consumer reads:
 *
 *   https://github.com/automagik-dev/automagik/releases/download/plugin-lane/lane.json
 *   https://github.com/automagik-dev/automagik/releases/download/plugin-lane/lane.json.sig
 *
 * The rolling `plugin-lane` release holds only those two files; the tarballs stay on their own
 * versioned release (immutable, so a consumer that cached a version can still serve it). The
 * desktop app installs the plugins from it without a new build (apps/desktop src/lane.js), and
 * Omni's market serves them without an Omni release. The signature is ed25519 over the exact
 * bytes of lane.json, detached, base64; the public keys are plugin-lane/keys.json.
 *
 *   bun scripts/lane.ts kind <last-full-tag> [<last-tag>]       am | herdr | pocket | plugins | full: what the commits since need
 *   bun scripts/lane.ts herdr <last-tag>                         yes | no: whether the release rebuilds the herdr pack
 *   bun scripts/lane.ts pocket <tag>                             yes | no: whether the release rebuilds Pocket's app
 *   bun scripts/lane.ts pocket-since <last-tag> [<lane-version>] the tag Pocket's changes are measured from
 *   bun scripts/lane.ts ships <last-tag>                         yes | no: whether anything since it reaches an install
 *   bun scripts/lane.ts next-patch                               the next patch release: 3.N.(P+1) on the newest 3.N
 *   bun scripts/lane.ts pack-addons <dir>                          pack the add-ons the lane carries into dir, with addons.json
 *   bun scripts/lane.ts manifest <plugins.json> <base> <issuedAt> [addons.json]  print lane.json for a release's plugins.json
 *   bun scripts/lane.ts sign <lane.json>                         print its signature (the key in PLUGIN_LANE_KEY, PEM)
 *   bun scripts/lane.ts verify <lane.json> <lane.json.sig>       check it against plugin-lane/keys.json
 *
 * The herdr pack (herdr/, docs/rfcs/0011-monorepo-parts-and-releases.md) is a part of its own: no
 * desktop build or plugin reads it, and Herdr installs it from its own tarball. A release whose
 * shipping changes since the last release (any tag) are all under herdr/ is a `herdr` patch, 3.N.P
 * with the pack alone: no desktop build, no plugin tarballs, no new lane. Any release that has a
 * shipping herdr/ change since the last release attaches the pack (`herdr`), whatever its kind.
 *
 * Pocket's phone app (apps/pocket/, same RFC, "Pocket") is a part the same way: no desktop build or
 * plugin reads it, and phones update from latest.json on the rolling pocket-lane release. A release
 * whose shipping changes since the last release are all under apps/pocket/, or under apps/pocket/ and
 * herdr/, is a `pocket` patch: the app (and the pack, when herdr/ shipped too), no desktop build, no
 * plugin tarballs, no new lane. Any release with a shipping apps/pocket/ change since the build phones
 * have (the version pocket-lane names, `pocket-since`) builds the signed APK and its latest.json
 * (`pocket`), whatever its kind: a Pocket change that shipped only in a prerelease, or whose lane post
 * failed, is built again by the next release. Pocket Link
 * (herdr/mods/pocket-link) is under herdr/ and goes with the pack's lane.
 *
 * am, the one command (am/, docs/rfcs/0012-am-cli-and-parts.md), is the part every release carries:
 * every kind attaches automagik-am-<v>.tgz. A release whose shipping changes since the last release
 * are all am's (its part.json `paths`) is an `am` patch, 3.N.P with am alone. am's changes never
 * make a release more than it is otherwise: herdr/ and am/ together (a herdr change resyncing
 * am's copies of the pack's CLI) is a `herdr` patch, and an am change beside plugin changes is
 * still a plugin patch.
 */
import { createHash, createPrivateKey, createPublicKey, sign as signBytes, verify as verifyBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { ReleasePlugins } from './release-plugins';
import { FIELDS, MAX_PART, VERSION } from './version';

export const ROOT = join(import.meta.dir, '..');
export const LANE_RELEASE = 'plugin-lane';
export const SCHEMA_VERSION = 1;
export const KEY_ID = 'automagik-2026-10';
const DOWNLOADS = 'https://github.com/automagik-dev/automagik/releases/download/';
const PLUGINS = ['acp-dsh', 'bots-dsh', 'locale-pt-br-dsh', 'unfold-bot-dsh', 'unfold-bridge-dsh', 'unfold-capabilities-dsh', 'unfold-events-dsh', 'unfold-mind-dsh', 'unfold-session-dsh', 'unfold-settings-dsh', 'unfold-sse-dsh', 'unfold-trajectory-dsh', 'welcome-dsh'];
const PROFILE = 'apps/desktop/profile/package.json';
// The add-ons the desktop profile pins that the lane carries too, so a pin move is a patch: each
// a reviewed fork with no dependencies of its own (its folder alone is the add-on) that declares
// engines.dsh. They go in lane.json's `addons`, apart from `plugins` (the ones Omni serves).
// None today: Oh My Claude, the one it carried, left the profile (Claude comes through pi-ai),
// and dsh-subscriptions has dependencies of its own.
export const LANE_ADDONS: string[] = [];
// What a plugin's own package.json may change in a plugin-only release: nothing it is
// installed or admitted by.
const INSTALL_FIELDS = ['name', 'dependencies', 'peerDependencies', 'optionalDependencies', 'bundleDependencies', 'engines', 'dsh', 'main', 'exports', 'files'];
// What no build of the desktop app reads (its build reads apps/desktop and the plugins
// alone): the repository's release tooling and CI, the lane's own keys and notes, tests,
// and the notes at the root. A change there ships nothing to an installed app. The headless pet
// bake (apps/automagik-pets) is no plugin and no app build reads it; it ships on its own.
// The RFCs and notes under docs/ ship nothing either. In the herdr part: its notes (*.md at its top,
// docs/, .genie/ plans, the mockup) and its catalog, which installed mod managers read from dev
// directly, not from a release; and the layout entry's RECIPE.md and preview.png.
// In Pocket: its notes (*.md at its top) and docs/, and the Android project's scripts (the terminal
// page's test and the vendoring script), which no APK carries. Meter's local tools (meter/: the Claude
// status line and the limits logger it wraps) run from a checkout on the owner's machine; no release carries them.
// The vendored scheduler (herdr/scheduler/, a byte-identical copy of DnzzL/herdr-automations, its own
// UPSTREAM.md) is Go source, not pack code: its binary ships from its own release lane
// (.github/workflows/scheduler-release.yml), so no release here packs or rebuilds it, and a scheduler
// refresh alone cuts nothing. Its check scripts (herdr/scripts/scheduler-upstream.mjs,
// herdr/scripts/scheduler-pin.mjs) are tooling and ship nowhere either.
// The Windows helper's Linux image and its guest launcher (apps/desktop/wslc/: the Dockerfile,
// dsh-launch, the CI smoke and their tests; RFC 0016 delivery 2) are built by CI alone, and no
// shipped app reads them yet: the desktop build packages src/ and the build/ resources only. When
// Windows ships the helper (RFC 0016 delivery 6) this rule changes on purpose.
// The landing page (apps/landing: the page, its styles, assets and checks; #177) is static and
// ships from the site, never from a release: no app build and no plugin reads it (#370).
// herdr/NOTICE never ships: pack.mjs archives only PACK_MODS and the layout files.
const NEVER_SHIPPED = [/^am\/[^/]+\.md$/, /^\.github\//, /^scripts\//, /^plugin-lane\//, /(^|\/)test\//, /^[^/]+\.md$/, /^apps\/automagik-pets\//, /^docs\//,
  /^herdr\/[^/]+\.md$/, /^herdr\/NOTICE$/, /^herdr\/(\.genie|docs|mockup|catalog)\//, /^herdr\/scheduler\//, /^herdr\/scripts\/scheduler-upstream\.mjs$/, /^herdr\/scripts\/scheduler-pin\.mjs$/,
  /^herdr-layout\/(RECIPE\.md|preview\.png)$/,
  /^apps\/pocket\/[^/]+\.md$/, /^apps\/pocket\/(docs|android\/scripts)\//, /^meter\//, /^apps\/desktop\/wslc\//,
  /^apps\/landing\//];
/**
 * The herdr part: everything under herdr/ (the pack's mods, installer and tooling) and its layout's
 * own entry folder, herdr-layout/ (the pack ships its automagik.json; RFC 0011).
 */
export const HERDR = /^herdr(-layout)?\//;
/** A part.json `paths` glob as a pattern: `**` any path, `*` any name. */
export const globPattern = (glob: string) =>
  new RegExp(`^${glob.split('**').map(part => part.split('*').map(text => text.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*')).join('.*')}$`);
/** The am part (RFC 0012): the paths its part.json names. */
export const amPaths = (manifest = JSON.parse(readFileSync(join(ROOT, 'am', 'part.json'), 'utf8')) as { paths: string[] }) => manifest.paths.map(globPattern);
const AM_PATHS = amPaths();
export const AM = { test: (path: string) => AM_PATHS.some(pattern => pattern.test(path)) };
/** The Pocket part: the phone app and its docs. Pocket Link is under herdr/. */
export const POCKET = /^apps\/pocket\//;

export interface LanePlugin {
  name: string;
  version: string;
  url: string;
  integrity: string;
  sha256: string;
  size: number;
  engines: { dsh: string };
}
export interface Lane {
  schemaVersion: number;
  publisher: 'automagik';
  keyId: string;
  /** Monotonic across releases: a consumer refuses a lane older than the last it took. */
  sequence: number;
  issuedAt: string;
  repository: string;
  version: string;
  commit: string;
  /** The desktop release line these plugins run on: an app of another 3.N waits for its own. */
  base: string;
  plugins: LanePlugin[];
  /** The profile's add-ons at this release's pins (LANE_ADDONS), tarballs on the same release. */
  addons?: LanePlugin[];
}
export interface LaneAddon {
  version: string;
  file: string;
  integrity: string;
  size: number;
  engines: { dsh: string };
  /** The fork and commit the profile pins, as `github:<owner>/<repo>#<commit>`. */
  source: string;
}

/** A release's place in the lane's order: 3.N.P as N·10000 + P. */
export function sequenceOf(version: string): number {
  const match = /^3\.(\d+)\.(\d+)$/.exec(version);
  if (!match) throw new Error(`not a release version: ${version}`);
  return Number(match[1]) * 10_000 + Number(match[2]);
}

const LOCKFILE = /(^|\/)(bun\.lock|package-lock\.json|pnpm-lock\.yaml)$/;
const neverShipped = (path: string) => path === 'marketplace/automagik.json' || NEVER_SHIPPED.some(pattern => pattern.test(path));

/**
 * A file inside a plugin that its package does not carry (not in its package.json `files`), such
 * as its dev tools and lint script: no install sees it. A plugin's dev/harness and lockfile still
 * count (the app's build reads them), and so does any file of a plugin whose `files` has a glob.
 */
export function unpackedIn(files: Record<string, string[]>) {
  return (path: string) => {
    const plugin = PLUGINS.find(name => path.startsWith(`apps/${name}/`));
    const carried = plugin ? files[plugin] : undefined;
    if (!plugin || !carried || carried.some(entry => /[*?![{]/.test(entry))) return false;
    const inside = path.slice(`apps/${plugin}/`.length);
    if (inside === 'package.json' || inside.startsWith('dev/harness/') || LOCKFILE.test(inside)) return false;
    return !carried.some(entry => (entry.endsWith('/') ? inside.startsWith(entry) : inside === entry || inside.startsWith(`${entry}/`)));
  };
}

/** Whether any of `changed` reaches an install: one that is neither never shipped nor `inert`. */
export const ships = (changed: string[], inert: (path: string) => boolean) => changed.some(path => !neverShipped(path) && !inert(path));

/** Whether any of `changed` (since the last release) ships in the herdr pack: the release rebuilds it. */
export const herdrShips = (changed: string[], inert: (path: string) => boolean = () => false) =>
  changed.some(path => HERDR.test(path) && !neverShipped(path) && !inert(path));

/** Whether any of `changed` (since the last release) ships in Pocket's app: the release rebuilds it. */
export const pocketShips = (changed: string[], inert: (path: string) => boolean = () => false) =>
  changed.some(path => POCKET.test(path) && !neverShipped(path) && !inert(path));

/**
 * The tag Pocket's changes are measured from: the release whose build phones have, the version
 * pocket-lane's latest.json names, when that is a tag here; else `last`, the last release (before
 * the first Pocket release, or when the lane can't be read). A prerelease never moves pocket-lane, so
 * a Pocket change in one is still ahead of the lane and the next release builds it.
 */
export function pocketSince(last: string, laneVersion: string | undefined, tags: string[]): string {
  const tag = laneVersion && VERSION.test(laneVersion) ? `v${laneVersion}` : '';
  return tag && tags.includes(tag) ? tag : last;
}

/**
 * `herdr` when everything shipping in `sinceLast` (the changes since the last release, any tag) is
 * under herdr/: the pack alone, no app and no plugin. `pocket` when it is all under apps/pocket/,
 * or under apps/pocket/ and the herdr part (herdr/, herdr-layout/): Pocket's app (the pack along when herdr/ shipped). Otherwise whether the changes since the last
 * full release are the plugins' alone: every changed path inside a plugin, or under herdr/ or apps/pocket/ (no app
 * build reads it), or one no app build reads (the market index and the version bumps the releases
 * themselves write, the release tooling, tests, `inert` ones), none in a plugin's dev/harness (that
 * moves DSH), no lockfile, and no field a plugin is installed or admitted by.
 */
export function kindOf(changed: string[], installChanged: (plugin: string) => boolean, inert: (path: string) => boolean = () => false, sinceLast?: string[]): 'am' | 'herdr' | 'pocket' | 'plugins' | 'full' {
  const shipping = (sinceLast ?? []).filter(path => !neverShipped(path) && !inert(path));
  if (shipping.length > 0 && shipping.every(path => AM.test(path))) return 'am';
  if (shipping.length > 0 && shipping.every(path => HERDR.test(path) || AM.test(path))) return 'herdr';
  if (shipping.length > 0 && shipping.every(path => HERDR.test(path) || POCKET.test(path) || AM.test(path))) return 'pocket';
  if (changed.length === 0) return 'full';
  for (const path of changed) {
    if (neverShipped(path) || inert(path) || HERDR.test(path) || POCKET.test(path) || AM.test(path)) continue;
    const plugin = PLUGINS.find(name => path.startsWith(`apps/${name}/`));
    if (!plugin) return 'full';
    const inside = path.slice(`apps/${plugin}/`.length);
    if (inside.startsWith('dev/harness/') || LOCKFILE.test(inside)) return 'full';
  }
  return PLUGINS.some(installChanged) ? 'full' : 'plugins';
}

const pick = (json: Record<string, unknown>) => JSON.stringify(INSTALL_FIELDS.map(field => json[field] ?? null));

/**
 * The next patch: 3.N.(highest P of the newest 3.N + 1). Refused past 3.N.999 (Pocket's versionCode,
 * scripts/version.ts): the next release is then a full one, 3.(N+1).0.
 */
export function nextPatch(tags: string[]): string {
  const releases = tags.map(tag => /^v3\.(0|[1-9]\d{0,3})\.(0|[1-9]\d{0,3})$/.exec(tag)).filter(match => match !== null).map(match => [Number(match[1]), Number(match[2])] as const);
  if (releases.length === 0) throw new Error('no release to patch');
  const minor = Math.max(...releases.map(([n]) => n));
  const patch = Math.max(...releases.filter(([n]) => n === minor).map(([, p]) => p));
  if (patch + 1 > MAX_PART) throw new Error(`3.${minor}.${patch + 1}: a patch stops at ${MAX_PART} (Pocket's versionCode); cut 3.${minor + 1}.0 instead`);
  return `3.${minor}.${patch + 1}`;
}

/**
 * Whether a change to the desktop profile is only the pins of the add-ons the lane carries:
 * their dependency lines and their omni.addonVersions entries.
 */
export function addonPinsOnly(before: string, after: string): boolean {
  const blank = (text: string) => {
    const json = JSON.parse(text);
    for (const name of LANE_ADDONS) {
      delete json.dependencies?.[name];
      delete json.omni?.addonVersions?.[name];
    }
    return JSON.stringify(json);
  };
  return blank(before) === blank(after);
}

/**
 * npm-packs each add-on the lane carries at the commit the profile pins, into `dir`, and writes
 * dir/addons.json. Refuses one that has dependencies or no engines.dsh: swapping its folder
 * alone would not install it.
 */
export function packAddons(into: string, profile = JSON.parse(readFileSync(join(ROOT, PROFILE), 'utf8'))): Record<string, LaneAddon> {
  // npm pack runs in the add-on's checkout: the destination must not be relative to it.
  const dir = resolve(into);
  mkdirSync(dir, { recursive: true });
  const addons: Record<string, LaneAddon> = {};
  for (const name of LANE_ADDONS) {
    const source = profile.dependencies?.[name] as string | undefined;
    const match = /^github:([\w.-]+\/[\w.-]+)#([0-9a-f]{40})$/.exec(source ?? '');
    if (!match) throw new Error(`${name}: the profile pins ${source}, not github:<owner>/<repo>#<commit>`);
    const checkout = mkdtempSync(join(tmpdir(), 'lane-addon-'));
    try {
      const run = (...args: string[]) => execFileSync(args[0], args.slice(1), { cwd: checkout, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
      run('git', 'init', '-q');
      run('git', 'fetch', '-q', '--depth', '1', `https://github.com/${match[1]}.git`, match[2]);
      run('git', 'checkout', '-q', 'FETCH_HEAD');
      const json = JSON.parse(readFileSync(join(checkout, 'package.json'), 'utf8'));
      if (json.name !== name) throw new Error(`${source} is ${json.name}, not ${name}`);
      if (Object.keys(json.dependencies ?? {}).length > 0) throw new Error(`${name} has dependencies; it cannot ride the lane`);
      const dsh = json.engines?.dsh as string | undefined;
      if (!dsh) throw new Error(`${name} declares no engines.dsh`);
      const file = run('npm', 'pack', '--silent', '--ignore-scripts', '--pack-destination', dir).trim().split('\n').at(-1)!;
      const bytes = readFileSync(join(dir, file));
      addons[name] = { version: json.version, file, integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`, size: bytes.byteLength, engines: { dsh }, source };
    } finally {
      rmSync(checkout, { recursive: true, force: true });
    }
  }
  writeFileSync(join(dir, 'addons.json'), `${JSON.stringify(addons, null, 2)}\n`);
  return addons;
}

/** lane.json for a release: its plugins.json, each tarball's sha256 and its engines, and its add-ons. */
export function manifest(plugins: ReleasePlugins, { base, issuedAt, dir, engines, addons = {} }: { base: string; issuedAt: string; dir: string; engines: (name: string) => string; addons?: Record<string, LaneAddon> }): Lane {
  const sha256 = (file: string) => createHash('sha256').update(readFileSync(join(dir, file))).digest('hex');
  return {
    schemaVersion: SCHEMA_VERSION,
    publisher: 'automagik',
    keyId: KEY_ID,
    sequence: sequenceOf(plugins.version),
    issuedAt,
    repository: plugins.repository,
    version: plugins.version,
    commit: plugins.commit,
    base,
    plugins: Object.entries(plugins.packages).map(([name, entry]) => ({
      name,
      version: entry.version,
      url: `${DOWNLOADS}v${plugins.version}/${entry.file}`,
      integrity: entry.integrity,
      sha256: sha256(entry.file),
      size: entry.size,
      engines: { dsh: engines(name) },
    })),
    addons: Object.entries(addons).map(([name, entry]) => ({
      name,
      version: entry.version,
      url: `${DOWNLOADS}v${plugins.version}/${entry.file}`,
      integrity: entry.integrity,
      sha256: sha256(entry.file),
      size: entry.size,
      engines: entry.engines,
    })),
  };
}

export const signLane = (bytes: Buffer, privatePem: string) => signBytes(null, bytes, createPrivateKey(privatePem)).toString('base64');

/** The keys a consumer trusts: plugin-lane/keys.json, { keys: [{ keyId, publicKey (PEM) }] }. */
export function verifyLane(bytes: Buffer, signature: string, keys: { keyId: string; publicKey: string }[]): Lane {
  const lane = JSON.parse(bytes.toString('utf8')) as Lane;
  const key = keys.find(entry => entry.keyId === lane.keyId);
  if (!key) throw new Error(`lane: no key ${lane.keyId}`);
  if (!verifyBytes(null, bytes, createPublicKey(key.publicKey), Buffer.from(signature.trim(), 'base64'))) throw new Error('lane: the signature does not match');
  if (lane.schemaVersion !== SCHEMA_VERSION) throw new Error(`lane: schema ${lane.schemaVersion}`);
  return lane;
}

const git = (...args: string[]) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

if (import.meta.main) {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'kind' || command === 'ships' || command === 'herdr' || command === 'pocket') {
    const last = args[0];
    if (!last) { console.log(command === 'kind' ? 'full' : 'yes'); process.exit(0); }
    const diff = (from: string) => git('diff', '--name-only', `${from}..HEAD`).split('\n').filter(Boolean);
    const changed = diff(last);
    const before = (path: string) => git('show', `${last}:${path}`);
    const unpacked = unpackedIn(Object.fromEntries(PLUGINS.map(plugin => [plugin, JSON.parse(readFileSync(join(ROOT, 'apps', plugin, 'package.json'), 'utf8')).files ?? []])));
    // A file only the version fields of changed in (a release's own bump).
    const versionOnly = (path: string) => {
      const fields = FIELDS.filter(field => field.file === path);
      if (fields.length === 0) return false;
      // A plain-text field (the herdr pack's VERSION) is the version alone, before and after.
      if (fields.some(field => field.path.length === 0)) {
        try { return [before(path), readFileSync(join(ROOT, path), 'utf8')].every(text => /^\d+\.\d+\.\d+$/.test(text.trim())); } catch { return false; }
      }
      const blank = (text: string) => {
        const json = JSON.parse(text);
        for (const { path: at } of fields) {
          const parent = at.slice(0, -1).reduce((node, key) => node?.[key], json);
          if (parent) delete parent[at[at.length - 1]];
        }
        return JSON.stringify(json);
      };
      try { return blank(before(path)) === blank(readFileSync(join(ROOT, path), 'utf8')); } catch { return false; }
    };
    if (command === 'ships') {
      console.log(ships(changed, path => versionOnly(path) || unpacked(path)) ? 'yes' : 'no');
    } else if (command === 'herdr') {
      console.log(herdrShips(changed, versionOnly) ? 'yes' : 'no');
    } else if (command === 'pocket') {
      console.log(pocketShips(changed, versionOnly) ? 'yes' : 'no');
    } else {
      const installChanged = (plugin: string) => {
        const path = `apps/${plugin}/package.json`;
        let was: Record<string, unknown>;
        try { was = JSON.parse(before(path)); } catch { return true; }
        return pick(was) !== pick(JSON.parse(readFileSync(join(ROOT, path), 'utf8')));
      };
      // The profile with only the lane's add-on pins moved needs no app: the lane carries them.
      const addonPins = (path: string) => {
        try { return path === PROFILE && addonPinsOnly(before(path), readFileSync(join(ROOT, path), 'utf8')); } catch { return false; }
      };
      // The changes since the last release of any kind: a herdr-only run of them is a herdr patch, and
      // a run under apps/pocket/ (with herdr/ or alone) a pocket patch.
      const sinceLast = args[1] ? diff(args[1]) : undefined;
      console.log(kindOf(changed, installChanged, path => versionOnly(path) || addonPins(path) || unpacked(path), sinceLast));
    }
  } else if (command === 'pocket-since' && (args.length === 1 || args.length === 2)) {
    console.log(pocketSince(args[0], args[1], git('tag', '--list', 'v3.*').split('\n').filter(Boolean)));
  } else if (command === 'next-patch') {
    console.log(nextPatch(git('tag', '--list', 'v3.*').split('\n').filter(Boolean)));
  } else if (command === 'pack-addons' && args.length === 1) {
    console.log(JSON.stringify(packAddons(args[0]), null, 2));
  } else if (command === 'manifest' && (args.length === 3 || args.length === 4)) {
    const [file, base, issuedAt, addonsFile] = args;
    const addons = addonsFile ? (JSON.parse(readFileSync(addonsFile, 'utf8')) as Record<string, LaneAddon>) : {};
    const plugins = JSON.parse(readFileSync(file, 'utf8')) as ReleasePlugins;
    const engines = (name: string) => {
      const dir = PLUGINS.find(plugin => name === `@automagik/${plugin}`);
      const range = dir ? (JSON.parse(readFileSync(join(ROOT, 'apps', dir, 'package.json'), 'utf8')).engines?.dsh as string | undefined) : undefined;
      if (!range) throw new Error(`${name} declares no engines.dsh`);
      return range;
    };
    console.log(JSON.stringify(manifest(plugins, { base, issuedAt, dir: join(file, '..'), engines, addons }), null, 2));
  } else if (command === 'sign' && args.length === 1) {
    const key = process.env.PLUGIN_LANE_KEY;
    if (!key) throw new Error('PLUGIN_LANE_KEY is not set');
    console.log(signLane(readFileSync(args[0]), key));
  } else if (command === 'verify' && args.length === 2) {
    const keys = JSON.parse(readFileSync(join(ROOT, 'plugin-lane', 'keys.json'), 'utf8')).keys;
    const lane = verifyLane(readFileSync(args[0]), readFileSync(args[1], 'utf8'), keys);
    console.log(`lane ${lane.version} (sequence ${lane.sequence}) is signed by ${lane.keyId}`);
  } else {
    console.error('usage: bun scripts/lane.ts kind <last-full-tag> [<last-tag>] | ships <last-tag> | herdr <last-tag> | pocket <tag> | pocket-since <last-tag> [<lane-version>] | next-patch | pack-addons <dir> | manifest <plugins.json> <base> <issuedAt> [addons.json] | sign <lane.json> | verify <lane.json> <sig>');
    process.exit(2);
  }
}
