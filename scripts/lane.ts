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
 *   bun scripts/lane.ts next-patch                               the next patch release: 3.N.(P+1) on the newest 3.N
 *   bun scripts/lane.ts manifest <plugins.json> <base> <issuedAt>  print lane.json for a release's plugins.json
 *   bun scripts/lane.ts sign <lane.json>                         print its signature (the key in PLUGIN_LANE_KEY, PEM)
 *   bun scripts/lane.ts verify <lane.json> <lane.json.sig>       check it against plugin-lane/keys.json
 */
import { createHash, createPrivateKey, createPublicKey, sign as signBytes, verify as verifyBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ReleasePlugins } from './release-plugins';

export const ROOT = join(import.meta.dir, '..');
export const LANE_RELEASE = 'plugin-lane';
export const SCHEMA_VERSION = 1;
export const KEY_ID = 'automagik-2026-10';
const DOWNLOADS = 'https://github.com/automagik-dev/automagik/releases/download/';
const PLUGINS = ['bots-dsh', 'welcome-dsh'];
// What a plugin's own package.json may change in a plugin-only release: nothing it is
// installed or admitted by.
const INSTALL_FIELDS = ['name', 'dependencies', 'peerDependencies', 'optionalDependencies', 'bundleDependencies', 'engines', 'dsh', 'main', 'exports', 'files'];

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
}

/** A release's place in the lane's order: 3.N.P as N·10000 + P. */
export function sequenceOf(version: string): number {
  const match = /^3\.(\d+)\.(\d+)$/.exec(version);
  if (!match) throw new Error(`not a release version: ${version}`);
  return Number(match[1]) * 10_000 + Number(match[2]);
}

/**
 * Whether the changes since the last full release are the plugins' alone: every changed path
 * inside a plugin (or the market index the releases themselves write), none in a plugin's
 * dev/harness (that moves DSH), no lockfile, and no field a plugin is installed or admitted by.
 */
export function kindOf(changed: string[], installChanged: (plugin: string) => boolean): 'plugins' | 'full' {
  if (changed.length === 0) return 'full';
  for (const path of changed) {
    if (path === 'marketplace/automagik.json') continue;
    const plugin = PLUGINS.find(name => path.startsWith(`apps/${name}/`));
    if (!plugin) return 'full';
    const inside = path.slice(`apps/${plugin}/`.length);
    if (inside.startsWith('dev/harness/') || /(^|\/)(bun\.lock|package-lock\.json|pnpm-lock\.yaml)$/.test(inside)) return 'full';
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

/** lane.json for a release: its plugins.json, each tarball's sha256 and its engines. */
export function manifest(plugins: ReleasePlugins, { base, issuedAt, dir, engines }: { base: string; issuedAt: string; dir: string; engines: (name: string) => string }): Lane {
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
      sha256: createHash('sha256').update(readFileSync(join(dir, entry.file))).digest('hex'),
      size: entry.size,
      engines: { dsh: engines(name) },
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
  if (command === 'kind') {
    const last = args[0];
    if (!last) { console.log('full'); process.exit(0); }
    const changed = git('diff', '--name-only', `${last}..HEAD`).split('\n').filter(Boolean);
    const installChanged = (plugin: string) => {
      const path = `apps/${plugin}/package.json`;
      let before: Record<string, unknown>;
      try { before = JSON.parse(git('show', `${last}:${path}`)); } catch { return true; }
      return pick(before) !== pick(JSON.parse(readFileSync(join(ROOT, path), 'utf8')));
    };
    console.log(kindOf(changed, installChanged));
  } else if (command === 'next-patch') {
    console.log(nextPatch(git('tag', '--list', 'v3.*').split('\n').filter(Boolean)));
  } else if (command === 'manifest' && args.length === 3) {
    const [file, base, issuedAt] = args;
    const plugins = JSON.parse(readFileSync(file, 'utf8')) as ReleasePlugins;
    const engines = (name: string) => {
      const dir = PLUGINS.find(plugin => name === `@automagik/${plugin}`);
      const range = dir ? (JSON.parse(readFileSync(join(ROOT, 'apps', dir, 'package.json'), 'utf8')).engines?.dsh as string | undefined) : undefined;
      if (!range) throw new Error(`${name} declares no engines.dsh`);
      return range;
    };
    console.log(JSON.stringify(manifest(plugins, { base, issuedAt, dir: join(file, '..'), engines }), null, 2));
  } else if (command === 'sign' && args.length === 1) {
    const key = process.env.PLUGIN_LANE_KEY;
    if (!key) throw new Error('PLUGIN_LANE_KEY is not set');
    console.log(signLane(readFileSync(args[0]), key));
  } else if (command === 'verify' && args.length === 2) {
    const keys = JSON.parse(readFileSync(join(ROOT, 'plugin-lane', 'keys.json'), 'utf8')).keys;
    const lane = verifyLane(readFileSync(args[0]), readFileSync(args[1], 'utf8'), keys);
    console.log(`lane ${lane.version} (sequence ${lane.sequence}) is signed by ${lane.keyId}`);
  } else {
    console.error('usage: bun scripts/lane.ts kind <last-full-tag> | next-patch | manifest <plugins.json> <base> <issuedAt> | sign <lane.json> | verify <lane.json> <sig>');
    process.exit(2);
  }
}
