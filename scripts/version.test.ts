import { describe, expect, test } from 'bun:test';
import { cpSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FIELDS, ROOT, drift, nextVersion, setVersion, versionCode } from './version';

describe('one version for the repository', () => {
  test('every field carries the root version now', () => {
    const version = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
    expect(drift(version)).toEqual([]);
    expect(version).toMatch(/^3\.\d+\.\d+$/);
  });

  test('set writes every field and nothing else', () => {
    const root = mkdtempSync(join(tmpdir(), 'automagik-version-'));
    for (const file of new Set(FIELDS.map((field) => field.file))) cpSync(join(ROOT, file), join(root, file));
    setVersion('3.7.0', root);
    expect(drift('3.7.0', root)).toEqual([]);
    const desktop = JSON.parse(readFileSync(join(root, 'apps/desktop/package.json'), 'utf8'));
    expect(desktop.name).toBe('@automagik/omni-desktop');
    // The herdr pack's VERSION is the version alone, on one line: its updater reads it so.
    expect(readFileSync(join(root, 'herdr/mods/am-sidebar/VERSION'), 'utf8')).toBe('3.7.0\n');
    expect(JSON.parse(readFileSync(join(root, 'herdr/package.json'), 'utf8')).name).toBe('automagik-herdr');
    setVersion('3.7.2', root);
    expect(drift('3.7.2', root)).toEqual([]);
    for (const bad of ['3.261024.1', '3.7', '3.07.0', '3.7.01', '4.1.0']) expect(() => setVersion(bad, root)).toThrow(/not a version/);
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
    const root = mkdtempSync(join(tmpdir(), 'automagik-version-'));
    for (const file of new Set(FIELDS.map((field) => field.file))) cpSync(join(ROOT, file), join(root, file));
    for (const bad of ['3.1000.0', '3.0.1000']) expect(() => setVersion(bad, root)).toThrow(/stop at 999/);
    setVersion('3.999.999', root);
    expect(drift('3.999.999', root)).toEqual([]);
    // The release after 3.999.0 is refused, not cut: the next one is a major's.
    expect(() => nextVersion(['v3.999.0'])).toThrow(/stop at 999/);
    expect(nextVersion(['v3.998.0'])).toBe('3.999.0');
  });
});
