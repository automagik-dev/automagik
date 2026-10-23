#!/usr/bin/env bun
/**
 * Automagik's one version: the repository, the Bot team, the welcome and the desktop app all
 * carry it. It is a calendar version on a line of its own, 3.YYMMDD.N: above every Omni
 * desktop build (2.YYMMDD.N, from automagik-dev/omni-desktop), so an installed app updates
 * into this one, and apart from Omni's own 2.x.
 *
 *   bun scripts/version.ts check            every field carries the root version; exit 1 when not
 *   bun scripts/version.ts set <version>    write it everywhere
 *   bun scripts/version.ts next [YYYY-MM-DD] the next release: 3.YYMMDD.(tags that day + 1)
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const ROOT = join(import.meta.dir, '..');
export const MAJOR = 3;
export const VERSION = /^\d+\.\d{6}\.\d+$/;

/** Every file and JSON path that carries the version. */
export const FIELDS: { file: string; path: string[] }[] = [
  { file: 'package.json', path: ['version'] },
  { file: 'apps/bots-dsh/package.json', path: ['version'] },
  { file: 'apps/welcome-dsh/package.json', path: ['version'] },
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
  if (!VERSION.test(version)) throw new Error(`not a version: ${version} (want ${MAJOR}.YYMMDD.N)`);
  for (const file of new Set(FIELDS.map((field) => field.file))) {
    const json = read(root, file);
    for (const field of FIELDS.filter((candidate) => candidate.file === file)) {
      const parent = at(json, field.path.slice(0, -1)) as Record<string, unknown>;
      parent[field.path.at(-1) as string] = version;
    }
    writeFileSync(join(root, file), `${JSON.stringify(json, null, 2)}\n`);
  }
}

/** The next release on `date` (YYYY-MM-DD) given the repository's tags. */
export function nextVersion(date: string, tags: string[]): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`not a date: ${date}`);
  const day = date.slice(2).replaceAll('-', '');
  const taken = tags
    .map((tag) => new RegExp(`^v${MAJOR}\\.${day}\\.(\\d+)$`).exec(tag)?.[1])
    .filter((n): n is string => n !== undefined)
    .map(Number);
  return `${MAJOR}.${day}.${Math.max(0, ...taken) + 1}`;
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
    console.log(nextVersion(arg ?? new Date().toISOString().slice(0, 10), tags));
  } else {
    console.error('usage: bun scripts/version.ts check | set <version> | next [YYYY-MM-DD]');
    process.exit(2);
  }
}
