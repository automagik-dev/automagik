#!/usr/bin/env bun
/**
 * plugins.json, the file a release carries beside its plugin tarballs: what each one is and
 * how to check it. Omni copies it as its apps/automagik.json to fetch exactly these files
 * (its market, its admin UI image) and refuse any other bytes.
 *
 *   bun scripts/release-plugins.ts release <version> <commit> [dir]   print it for dir/*.tgz (default release/)
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_URL } from './marketplace';

export interface ReleasedPlugin {
  version: string;
  file: string;
  /** Subresource integrity of the tarball (sha512), as npm and pnpm check it. */
  integrity: string;
  size: number;
}
export interface ReleasePlugins {
  repository: string;
  version: string;
  commit: string;
  packages: Record<string, ReleasedPlugin>;
}

/** npm pack's file name for a package: the scope's @ dropped and its / made a dash. */
export const tarballOf = (name: string, version: string) => `${name.replace(/^@/, '').replace('/', '-')}-${version}.tgz`;

export function releasePlugins(version: string, commit: string, dir: string, names: string[]): ReleasePlugins {
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error(`not a commit: ${commit}`);
  const present = new Set(readdirSync(dir));
  const packages: Record<string, ReleasedPlugin> = {};
  for (const name of names) {
    const file = tarballOf(name, version);
    if (!present.has(file)) throw new Error(`${dir} has no ${file}`);
    const bytes = readFileSync(join(dir, file));
    packages[name] = {
      version,
      file,
      integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
      size: bytes.byteLength,
    };
  }
  return { repository: REPO_URL, version, commit, packages };
}

/**
 * The plugins this repository's releases attach, by package name: every apps/*-dsh but the
 * Unfold bridge, which stays here to be built and tested until Unfold's own release carries it
 * (Refs marketplace/unfold). No release here packs it, names it in plugins.json, lists it in
 * PLUGINS.SHA256SUMS or carries it in the plugin lane's manifest.
 */
export const UNSHIPPED: Record<string, true> = { '@automagik/unfold-bridge-dsh': true };

export function pluginNames(root = join(import.meta.dir, '..')): string[] {
  return readdirSync(join(root, 'apps'))
    .filter((name) => name.endsWith('-dsh'))
    .map((name) => JSON.parse(readFileSync(join(root, 'apps', name, 'package.json'), 'utf8')).name as string)
    .filter((name) => !UNSHIPPED[name])
    .sort();
}

if (import.meta.main) {
  const [command, version, commit, dir = 'release'] = process.argv.slice(2);
  if (command !== 'release' || !version || !commit) {
    console.error('usage: bun scripts/release-plugins.ts release <version> <commit> [dir]');
    process.exit(2);
  }
  console.log(JSON.stringify(releasePlugins(version, commit, dir, pluginNames()), null, 2));
}
