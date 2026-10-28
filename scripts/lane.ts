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
 *   bun scripts/lane.ts kind <last-full-tag>                    plugins | full: what the commits since it need
 *   bun scripts/lane.ts ships <last-tag>                         yes | no: whether anything since it reaches an install
 *   bun scripts/lane.ts next-patch                               the next patch release: 3.N.(P+1) on the newest 3.N
 *   bun scripts/lane.ts pack-addons <dir>                          pack the add-ons the lane carries into dir, with addons.json
 *   bun scripts/lane.ts manifest <plugins.json> <base> <issuedAt> [addons.json]  print lane.json for a release's plugins.json
 *   bun scripts/lane.ts sign <lane.json>                         print its signature (the key in PLUGIN_LANE_KEY, PEM)
 *   bun scripts/lane.ts verify <lane.json> <lane.json.sig>       check it against plugin-lane/keys.json
 */
import { createHash, createPrivateKey, createPublicKey, sign as signBytes, verify as verifyBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { ReleasePlugins } from './release-plugins';
import { FIELDS } from './version';

export const ROOT = join(import.meta.dir, '..');
export const LANE_RELEASE = 'plugin-lane';
export const SCHEMA_VERSION = 1;
export const KEY_ID = 'automagik-2026-10';
const DOWNLOADS = 'https://github.com/automagik-dev/automagik/releases/download/';
const PLUGINS = ['bots-dsh', 'locale-pt-br-dsh', 'unfold-bridge-dsh', 'unfold-capabilities-dsh', 'unfold-events-dsh', 'unfold-settings-dsh', 'unfold-sse-dsh', 'unfold-trajectory-dsh', 'welcome-dsh'];
const PROFILE = 'apps/desktop/profile/package.json';
// The add-ons the desktop profile pins that the lane carries too, so a pin move is a patch: each
// a reviewed fork with no dependencies of its own (its folder alone is the add-on) that declares
// engines.dsh. They go in lane.json's `addons`, apart from `plugins` (the ones Omni serves).
export const LANE_ADDONS = ['dsh-oh-my-claude'];
// What a plugin's own package.json may change in a plugin-only release: nothing it is
// installed or admitted by.
const INSTALL_FIELDS = ['name', 'dependencies', 'peerDependencies', 'optionalDependencies', 'bundleDependencies', 'engines', 'dsh', 'main', 'exports', 'files'];
// What no build of the desktop app reads (its build reads apps/desktop and the plugins
// alone): the repository's release tooling and CI, the lane's own keys and notes, tests,
// and the notes at the root. A change there ships nothing to an installed app.
const NEVER_SHIPPED = [/^\.github\//, /^scripts\//, /^plugin-lane\//, /(^|\/)test\//, /^[^/]+\.md$/];

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

/**
 * Whether the changes since the last full release are the plugins' alone: every changed path
 * inside a plugin, or one no app build reads (the market index and the version bumps the
 * releases themselves write, the release tooling, tests, `inert` ones), none in a plugin's
 * dev/harness (that moves DSH), no lockfile, and no field a plugin is installed or admitted by.
 */
export function kindOf(changed: string[], installChanged: (plugin: string) => boolean, inert: (path: string) => boolean = () => false): 'plugins' | 'full' {
  if (changed.length === 0) return 'full';
  for (const path of changed) {
    if (neverShipped(path) || inert(path)) continue;
    const plugin = PLUGINS.find(name => path.startsWith(`apps/${name}/`));
    if (!plugin) return 'full';
    const inside = path.slice(`apps/${plugin}/`.length);
    if (inside.startsWith('dev/harness/') || LOCKFILE.test(inside)) return 'full';
  }
  return PLUGINS.some(installChanged) ? 'full' : 'plugins';
}

const pick = (json: Record<string, unknown>) => JSON.stringify(INSTALL_FIELDS.map(field => json[field] ?? null));

/** The next patch: 3.N.(highest P of the newest 3.N + 1). */
export function nextPatch(tags: string[]): string {
  const releases = tags.map(tag => /^v3\.(0|[1-9]\d{0,3})\.(0|[1-9]\d{0,3})$/.exec(tag)).filter(match => match !== null).map(match => [Number(match[1]), Number(match[2])] as const);
  if (releases.length === 0) throw new Error('no release to patch');
  const minor = Math.max(...releases.map(([n]) => n));
  const patch = Math.max(...releases.filter(([n]) => n === minor).map(([, p]) => p));
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

const git = (...args: string[]) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' });

if (import.meta.main) {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'kind' || command === 'ships') {
    const last = args[0];
    if (!last) { console.log(command === 'kind' ? 'full' : 'yes'); process.exit(0); }
    const changed = git('diff', '--name-only', `${last}..HEAD`).split('\n').filter(Boolean);
    const before = (path: string) => git('show', `${last}:${path}`);
    const unpacked = unpackedIn(Object.fromEntries(PLUGINS.map(plugin => [plugin, JSON.parse(readFileSync(join(ROOT, 'apps', plugin, 'package.json'), 'utf8')).files ?? []])));
    // A file only the version fields of changed in (a release's own bump).
    const versionOnly = (path: string) => {
      const fields = FIELDS.filter(field => field.file === path);
      if (fields.length === 0) return false;
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
      console.log(kindOf(changed, installChanged, path => versionOnly(path) || addonPins(path) || unpacked(path)));
    }
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
    console.error('usage: bun scripts/lane.ts kind <last-full-tag> | ships <last-tag> | next-patch | pack-addons <dir> | manifest <plugins.json> <base> <issuedAt> [addons.json] | sign <lane.json> | verify <lane.json> <sig>');
    process.exit(2);
  }
}
