#!/usr/bin/env bun
/**
 * Automagik's DSH plugin market index (marketplace/automagik.json, format 1): this repository's
 * plugins, each a git source pinned to a release commit with the plugin's folder, and the outside
 * plugins Automagik vetted (VETTED), each pinned to the commit that was reviewed.
 *
 *   bun scripts/marketplace.ts check        DSH's own parser, then every entry proven against this repository
 *   bun scripts/marketplace.ts pin <ref>    list the plugins at <ref> (a release tag), at its version
 *
 * `check` proves that each pinned commit of this repository is reachable from HEAD and holds, at
 * the entry's path, a package.json with the entry's name and version: a market installs exactly
 * that commit. A vetted plugin's commit is proven against its fork by dsh-marketplace's check.
 * automagik-dev/dsh-marketplace reads this file at each release (`v<version>`) for the titles,
 * categories and paths, and lists the plugins at that release's commit.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseMarketIndex } from '@deepseek-ai/dsh-plugin-market-index';
import { VERSION } from './version';

export const REPO_URL = 'https://github.com/automagik-dev/automagik';
export const INDEX_PATH = join(import.meta.dir, '..', 'marketplace', 'automagik.json');
export const INDEX_URL = 'https://raw.githubusercontent.com/automagik-dev/automagik/main/marketplace/automagik.json';
/** The outside plugins' repositories this index may list: forks Automagik reviewed. */
export const VETTED = [
  'https://github.com/automagik-genie/dsh-oh-my-claude',
  'https://github.com/automagik-genie/dsh-subscriptions',
];

interface GitSource {
  type: 'git';
  url: string;
  commit: string;
  path?: string;
}
interface IndexVersion {
  version: string;
  publishTimestamp: number;
  source: GitSource | { type: 'npm' };
  engines?: { dsh?: string };
}
interface IndexPlugin {
  name: string;
  versions: IndexVersion[];
}
interface Index {
  plugins: IndexPlugin[];
}

const isOurs = (source: IndexVersion['source']): source is GitSource =>
  source.type === 'git' && source.url.replace(/\.git$/, '') === REPO_URL;
const isVetted = (source: IndexVersion['source']): source is GitSource =>
  source.type === 'git' && VETTED.includes(source.url.replace(/\.git$/, ''));

function git(cwd: string, args: string[], timeout?: number): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout }).trim();
}
function gitOk(cwd: string, args: string[], timeout?: number): boolean {
  try {
    git(cwd, args, timeout);
    return true;
  } catch {
    return false;
  }
}
function packageAt(cwd: string, commit: string, path: string): { name?: string; version?: string } | null {
  try {
    return JSON.parse(git(cwd, ['show', `${commit}:${path === '.' ? '' : `${path}/`}package.json`]));
  } catch {
    return null;
  }
}

/** Every problem with the index, empty when it is fit to serve. */
export function checkIndex(value: unknown, repoDir: string): string[] {
  try {
    parseMarketIndex(value, INDEX_URL);
  } catch (error) {
    return [`index: ${(error as Error).message}`];
  }
  const problems: string[] = [];
  for (const plugin of (value as Index).plugins) {
    if (plugin.versions.length === 0) problems.push(`${plugin.name}: lists no version`);
    for (const entry of plugin.versions) {
      const at = `${plugin.name}@${entry.version}`;
      if (isVetted(entry.source)) continue;
      if (!isOurs(entry.source)) {
        problems.push(`${at}: every source is a commit of ${REPO_URL} or of a vetted fork`);
        continue;
      }
      const { commit, path = '.' } = entry.source;
      if (!/^[0-9a-f]{40}$/.test(commit) || !gitOk(repoDir, ['merge-base', '--is-ancestor', commit, 'HEAD'])) {
        const shallow = git(repoDir, ['rev-parse', '--is-shallow-repository']) === 'true';
        problems.push(`${at}: commit ${commit} is not reachable from HEAD${shallow ? ' (this clone is shallow)' : ''}`);
        continue;
      }
      const manifest = packageAt(repoDir, commit, path);
      if (!manifest) problems.push(`${at}: ${commit} has no ${path}/package.json`);
      else if (manifest.name !== plugin.name || manifest.version !== entry.version)
        problems.push(`${at}: ${commit.slice(0, 9)}:${path}/package.json is ${manifest.name}@${manifest.version}`);
    }
  }
  return problems;
}

/**
 * List every plugin at `ref`, at the version its package.json carries there. A version already
 * listed is re-pointed only when its folder is byte-identical at `ref`: what a listed version
 * installs never changes. Versions whose commit is not a release (`v<version>` tag) are
 * dropped: the index lists releases only, and only 3.N.0 ones: the first releases' calendar
 * versions (3.YYMMDD.N) sort above every 3.N, so a market would take one for the newest.
 */
export function pinIndex(value: Index, repoDir: string, ref: string): Index {
  const commit = git(repoDir, ['rev-parse', `${ref}^{commit}`]);
  const publishTimestamp = Number(git(repoDir, ['show', '-s', '--format=%ct', commit]));
  const released = (entry: IndexVersion) =>
    VERSION.test(entry.version) && isOurs(entry.source) && gitOk(repoDir, ['rev-parse', '--verify', '--quiet', `refs/tags/v${entry.version}`]) &&
    git(repoDir, ['rev-parse', `v${entry.version}^{commit}`]) === entry.source.commit;
  for (const plugin of value.plugins) {
    const latest = plugin.versions.find((entry) => isOurs(entry.source));
    if (!latest || !isOurs(latest.source)) continue;
    const manifest = packageAt(repoDir, commit, latest.source.path ?? '.');
    if (!manifest?.version) throw new Error(`${plugin.name}: ${ref} has no package.json at ${latest.source.path}`);
    const source: GitSource = { ...latest.source, commit };
    const same = plugin.versions.find((entry) => entry.version === manifest.version);
    if (same && isOurs(same.source) && same.source.commit !== commit) {
      const unchanged = gitOk(repoDir, ['diff', '--quiet', same.source.commit, commit, '--', same.source.path ?? '.']);
      if (!unchanged)
        throw new Error(`${plugin.name}@${same.version} changed since ${same.source.commit.slice(0, 9)}: bump the version first`);
    }
    const kept = plugin.versions.filter((entry) => entry !== same && released(entry));
    plugin.versions = [{ ...latest, version: manifest.version, publishTimestamp, source }, ...kept];
  }
  return value;
}

if (import.meta.main) {
  const [command, ref] = process.argv.slice(2);
  const repoDir = join(import.meta.dir, '..');
  const index = JSON.parse(readFileSync(INDEX_PATH, 'utf8'));
  if (command === 'check') {
    const problems = checkIndex(index, repoDir);
    for (const problem of problems) console.error(`marketplace: ${problem}`);
    if (problems.length > 0) process.exit(1);
    console.log(`marketplace: ${index.plugins.length} plugins ok`);
  } else if (command === 'pin' && ref) {
    writeFileSync(INDEX_PATH, `${JSON.stringify(pinIndex(index, repoDir, ref), null, 2)}\n`);
    console.log(`marketplace: pinned to ${ref}`);
  } else {
    console.error('usage: bun scripts/marketplace.ts check | pin <ref>');
    process.exit(2);
  }
}
