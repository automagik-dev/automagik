import { describe, expect, test } from 'bun:test';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CRATES, FIELDS, ROOT, cargoVersionLine, crateFiles, drift, nextVersion, setVersion, versionCode } from './version';

/** A copy of every file that carries the version, in a temporary root. */
function copyRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'automagik-version-'));
  for (const file of new Set([...FIELDS.map((field) => field.file), ...crateFiles()])) cpSync(join(ROOT, file), join(root, file));
  return root;
}

describe('one version for the repository', () => {
  test('every field carries the root version now', () => {
    const version = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
    expect(drift(version)).toEqual([]);
    expect(version).toMatch(/^3\.\d+\.\d+$/);
  });

  test('set writes every field and nothing else', () => {
    const root = copyRoot();
    setVersion('3.7.0', root);
    expect(drift('3.7.0', root)).toEqual([]);
    const desktop = JSON.parse(readFileSync(join(root, 'apps/desktop/package.json'), 'utf8'));
    expect(desktop.name).toBe('@automagik/omni-desktop');
    // The herdr pack's VERSION is the version alone, on one line: its updater reads it so.
    expect(readFileSync(join(root, 'herdr/mods/am-sidebar/VERSION'), 'utf8')).toBe('3.7.0\n');
    // So is am's: the copy of the CLI it carries reads it (`am --version`).
    expect(readFileSync(join(root, 'am/VERSION'), 'utf8')).toBe('3.7.0\n');
    expect(JSON.parse(readFileSync(join(root, 'herdr/package.json'), 'utf8')).name).toBe('automagik-herdr');
    setVersion('3.7.2', root);
    expect(drift('3.7.2', root)).toEqual([]);
    for (const bad of ['3.261024.1', '3.7', '3.07.0', '3.7.01', '4.1.0']) expect(() => setVersion(bad, root)).toThrow(/not a version/);
  });

  test('set writes every file the herdr pack checks its version in', async () => {
    // herdr/scripts/version.mjs is the pack's own gate (the release runs it); a file it checks
    // that set never writes would stop the next herdr release at its gates.
    const { FIELDS: pack } = await import('../herdr/scripts/version.mjs');
    const written = FIELDS.map(({ file, path }) => `${file}:${path.join('.')}`);
    for (const { file, path = [] } of pack as { file: string; path?: string[] }[]) {
      expect(written).toContain(`herdr/${file}:${path.join('.')}`);
    }
  });

  test('the next release is one above the highest v3.N.0, numbers compared as numbers', () => {
    expect(nextVersion([])).toBe('3.1.0');
    expect(nextVersion(['v3.1.0', 'v3.2.0', 'v3.10.0', 'v3.9.0', ''])).toBe('3.11.0');
    // The calendar tags of the first releases, Omni desktop's 2.x and anything else count for nothing.
    expect(nextVersion(['v3.261024.1', 'v3.261023.2', 'v2.261024.5', 'v3.4', 'v3.05.0', 'v3.3.1'])).toBe('3.1.0');
    // Above every Omni desktop build (2.YYMMDD.N), which an installed app updates from.
    expect(Bun.semver.order(nextVersion([]), '2.261023.32')).toBe(1);
  });

  // Pocket's Android versionCode is major·1e6 + minor·1e3 + patch (docs/rfcs/0011, "Pocket"): a minor
  // or patch of 1000 would share a code with the next part's (3.1000.0 and 4.0.0), so it is refused.
  test('Pocket\'s versionCode: one per version, minor and patch at most 999', () => {
    expect(versionCode('3.57.0')).toBe(3_057_000);
    expect(versionCode('3.57.12')).toBe(3_057_012);
    expect(versionCode('3.999.999')).toBe(3_999_999);
    // Above every code the old automagik-pocket builds used (minutes since 2025: about 966 000 in 2026-11).
    expect(versionCode('3.1.0')).toBeGreaterThan(1_000_000);
    for (const bad of ['3.1000.0', '3.0.1000', '3.57.1000']) expect(() => versionCode(bad)).toThrow(/stop at 999/);
    const root = copyRoot();
    for (const bad of ['3.1000.0', '3.0.1000']) expect(() => setVersion(bad, root)).toThrow(/stop at 999/);
    setVersion('3.999.999', root);
    expect(drift('3.999.999', root)).toEqual([]);
    // The release after 3.999.0 is refused, not cut: the next one is a major's.
    expect(() => nextVersion(['v3.999.0'])).toThrow(/stop at 999/);
    expect(nextVersion(['v3.998.0'])).toBe('3.999.0');
  });

  // The meter crate (RFC 0017, "Version"): Cargo.toml's [package] version and the crate's own entry
  // in Cargo.lock, which CI builds with --locked, so a drift between the two fails the build.
  test('the meter crate carries the version in its Cargo.toml and Cargo.lock, one line each', () => {
    expect(CRATES).toEqual([{ dir: 'meter/usagemeter', name: 'usagemeter' }]);
    const root = copyRoot();
    const before = crateFiles().map((file) => readFileSync(join(root, file), 'utf8'));
    setVersion('3.7.1', root);
    expect(drift('3.7.1', root)).toEqual([]);
    for (const [i, file] of crateFiles().entries()) {
      const was = before[i].split('\n');
      const now = readFileSync(join(root, file), 'utf8').split('\n');
      // Only the one version line changed: dependencies, the lock's own `version = 4` and the
      // file's last newline are untouched.
      expect(now.length).toBe(was.length);
      const changed = now.flatMap((line, at) => (line === was[at] ? [] : [line]));
      expect(changed).toEqual(['version = "3.7.1"']);
    }
    expect(readFileSync(join(root, 'meter/usagemeter/Cargo.lock'), 'utf8')).toContain('\nversion = 4\n');
    // A crate left behind is drift, named by its file.
    writeFileSync(join(root, 'meter/usagemeter/Cargo.lock'), before[1]);
    expect(drift('3.7.1', root)).toEqual([expect.stringMatching(/^meter\/usagemeter\/Cargo\.lock:package\[usagemeter\]\.version = /)]);
  });

  test('a crate version line is found by its table, never by its text', () => {
    const toml = ['[package]', 'name = "usagemeter"', 'version = "0.5.0"', '', '[dependencies]', 'x = { version = "0.5.0" }', '[workspace.package]', 'version = "9.9.9"'];
    expect(cargoVersionLine(toml, 'toml', 'usagemeter')).toBe(2);
    expect(cargoVersionLine(['[dependencies]', 'version = "1"'], 'toml', 'usagemeter')).toBe(-1);
    const lock = ['version = 4', '', '[[package]]', 'name = "memchr"', 'version = "0.5.0"', '', '[[package]]', 'name = "usagemeter"', 'version = "0.5.0"', 'dependencies = [', ' "memchr",', ']'];
    expect(cargoVersionLine(lock, 'lock', 'usagemeter')).toBe(8);
    expect(cargoVersionLine(lock, 'lock', 'other')).toBe(-1);
    // A crate whose version line is gone stops set before any file is written.
    const root = copyRoot();
    mkdirSync(join(root, 'meter/usagemeter'), { recursive: true });
    writeFileSync(join(root, 'meter/usagemeter/Cargo.lock'), lock.filter((line) => line !== 'name = "usagemeter"').join('\n'));
    const pkg = readFileSync(join(root, 'package.json'), 'utf8');
    expect(() => setVersion('3.7.2', root)).toThrow(/no package\[usagemeter\]\.version line in meter\/usagemeter\/Cargo\.lock/);
    expect(readFileSync(join(root, 'package.json'), 'utf8')).toBe(pkg);
  });

  test("a crate's lock entry with no version line stops set, never borrows the next entry's", () => {
    const lock = ['version = 4', '', '[[package]]', 'name = "usagemeter"', 'dependencies = [', ' "memchr",', ']', '', '[[package]]', 'name = "memchr"', 'version = "2.8.3"', ''];
    expect(cargoVersionLine(lock, 'lock', 'usagemeter')).toBe(-1);
    const root = copyRoot();
    writeFileSync(join(root, 'meter/usagemeter/Cargo.lock'), lock.join('\n'));
    const pkg = readFileSync(join(root, 'package.json'), 'utf8');
    expect(() => setVersion('3.7.2', root)).toThrow(/no package\[usagemeter\]\.version line in meter\/usagemeter\/Cargo\.lock/);
    // Nothing was written: the root keeps its version and memchr keeps its own.
    expect(readFileSync(join(root, 'package.json'), 'utf8')).toBe(pkg);
    expect(readFileSync(join(root, 'meter/usagemeter/Cargo.lock'), 'utf8')).toBe(lock.join('\n'));
  });
});
