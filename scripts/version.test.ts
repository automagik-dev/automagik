import { describe, expect, test } from 'bun:test';
import { cpSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FIELDS, ROOT, drift, nextVersion, setVersion } from './version';

describe('one version for the repository', () => {
  test('every field carries the root version now', () => {
    const version = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
    expect(drift(version)).toEqual([]);
    expect(version).toMatch(/^3\.\d+\.0$/);
  });

  test('set writes every field and nothing else', () => {
    const root = mkdtempSync(join(tmpdir(), 'automagik-version-'));
    for (const file of new Set(FIELDS.map((field) => field.file))) cpSync(join(ROOT, file), join(root, file));
    setVersion('3.7.0', root);
    expect(drift('3.7.0', root)).toEqual([]);
    const desktop = JSON.parse(readFileSync(join(root, 'apps/desktop/package.json'), 'utf8'));
    expect(desktop.name).toBe('@automagik/omni-desktop');
    for (const bad of ['3.261024.1', '3.7', '3.07.0', '4.1.0']) expect(() => setVersion(bad, root)).toThrow(/not a version/);
  });

  test('the next release is one above the highest v3.N.0, numbers compared as numbers', () => {
    expect(nextVersion([])).toBe('3.1.0');
    expect(nextVersion(['v3.1.0', 'v3.2.0', 'v3.10.0', 'v3.9.0', ''])).toBe('3.11.0');
    // The calendar tags of the first releases, Omni desktop's 2.x and anything else count for nothing.
    expect(nextVersion(['v3.261024.1', 'v3.261023.2', 'v2.261024.5', 'v3.4', 'v3.05.0', 'v3.3.1'])).toBe('3.1.0');
    // Above every Omni desktop build (2.YYMMDD.N), which an installed app updates from.
    expect(Bun.semver.order(nextVersion([]), '2.261023.32')).toBe(1);
  });
});
