#!/usr/bin/env bun
/**
 * Automagik's one version: the repository, the Bot team, the welcome, the Unfold bridge and the desktop app all
 * carry it. Each release is 3.N (semver 3.N.0, tagged v3.N.0), N one above the highest release
 * tag, numbers compared as numbers, as Tactu numbers its v1.N: above every Omni desktop build
 * (2.YYMMDD.N, from automagik-dev/omni-desktop), so an installed app updates into this one.
 * Until the first release the repository carries 3.0.0, which is never released. The calendar
 * tags of the first releases (v3.YYMMDD.N, 2026-10-23 and 24) are not release tags.
 *
 *   bun scripts/version.ts check            every field carries the root version; exit 1 when not
 *   bun scripts/version.ts set <version>    write it everywhere
 *   bun scripts/version.ts next             the next release: 3.(highest v3.N.0 + 1).0, 3.1.0 first
 *
 * A plugin-only merge is released as a patch on the newest 3.N instead (scripts/lane.ts next-patch).
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const ROOT = join(import.meta.dir, '..');
export const MAJOR = 3;
// A release: 3.N.0, or a plugin-only patch on it, 3.N.P (scripts/lane.ts). N and P are at most
// four digits, so a calendar tag's 3.YYMMDD.N is never taken for one.
export const VERSION = /^3\.(0|[1-9]\d{0,3})\.(0|[1-9]\d{0,3})$/;
/** A release tag: `v3.N.0`, N a whole number without leading zeros. */
export const RELEASE_TAG = /^v3\.(0|[1-9]\d*)\.0$/;

/** Every file and JSON path that carries the version. */
export const FIELDS: { file: string; path: string[] }[] = [
  { file: 'package.json', path: ['version'] },
  { file: 'apps/bots-dsh/package.json', path: ['version'] },
  { file: 'apps/welcome-dsh/package.json', path: ['version'] },
  { file: 'apps/unfold-bridge-dsh/package.json', path: ['version'] },
  { file: 'apps/locale-pt-br-dsh/package.json', path: ['version'] },
  { file: 'apps/unfold-capabilities-dsh/package.json', path: ['version'] },
  { file: 'apps/unfold-settings-dsh/package.json', path: ['version'] },
  { file: 'apps/unfold-events-dsh/package.json', path: ['version'] },
  { file: 'apps/unfold-sse-dsh/package.json', path: ['version'] },
  { file: 'apps/unfold-trajectory-dsh/package.json', path: ['version'] },
  { file: 'apps/desktop/package.json', path: ['version'] },
  { file: 'apps/desktop/package-lock.json', path: ['version'] },
  { file: 'apps/desktop/package-lock.json', path: ['packages', '', 'version'] },
];

const read = (root: string, file: string) => JSON.parse(readFileSync(join(root, file), 'utf8'));
const at = (value: unknown, path: string[]) =>
  path.reduce<unknown>((node, key) => (node as Record<string, unknown> | undefined)?.[key], value);

/** The fields that do not carry `version`, as `file:path = value`. */
export function drift(version: string, root = ROOT): string[] {
  return FIELDS.flatMap(({ file, path }) => {
    const value = at(read(root, file), path);
    return value === version ? [] : [`${file}:${path.join('.') || '.'} = ${String(value)}`];
  });
}

export function setVersion(version: string, root = ROOT): void {
  if (!VERSION.test(version)) throw new Error(`not a version: ${version} (want ${MAJOR}.N.P)`);
  for (const file of new Set(FIELDS.map((field) => field.file))) {
    const json = read(root, file);
    for (const field of FIELDS.filter((candidate) => candidate.file === file)) {
      const parent = at(json, field.path.slice(0, -1)) as Record<string, unknown>;
      parent[field.path.at(-1) as string] = version;
    }
    writeFileSync(join(root, file), `${JSON.stringify(json, null, 2)}\n`);
  }
}

/** The release after the highest `v3.N.0` in `tags` (3.1.0 when there is none); others are ignored. */
export function nextVersion(tags: string[]): string {
  const taken = tags.map((tag) => RELEASE_TAG.exec(tag)?.[1]).filter((n): n is string => n !== undefined).map(Number);
  return `${MAJOR}.${Math.max(0, ...taken) + 1}.0`;
}

if (import.meta.main) {
  const [command, arg] = process.argv.slice(2);
  const root = read(ROOT, 'package.json').version as string;
  if (command === 'check') {
    const problems = drift(root);
    for (const problem of problems) console.error(`version: ${problem}, not ${root}`);
    if (problems.length > 0) process.exit(1);
    console.log(`version: ${root} everywhere`);
  } else if (command === 'set' && arg) {
    setVersion(arg);
    console.log(`version: ${arg}`);
  } else if (command === 'next') {
    const tags = execFileSync('git', ['tag', '--list', `v${MAJOR}.*`], { cwd: ROOT, encoding: 'utf8' }).split('\n');
    console.log(nextVersion(tags));
  } else {
    console.error('usage: bun scripts/version.ts check | set <version> | next');
    process.exit(2);
  }
}
