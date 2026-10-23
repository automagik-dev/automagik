import { describe, expect, test } from 'bun:test';
import { cpSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FIELDS, ROOT, drift, nextVersion, setVersion } from './version';

describe('one version for the repository', () => {
  test('every field carries the root version now', () => {
    const version = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
    expect(drift(version)).toEqual([]);
    expect(version).toMatch(/^3\.\d{6}\.\d+$/);
  });

  test('set writes every field and nothing else', () => {
    const root = mkdtempSync(join(tmpdir(), 'automagik-version-'));
    for (const file of new Set(FIELDS.map((field) => field.file))) cpSync(join(ROOT, file), join(root, file));
    setVersion('3.261231.7', root);
    expect(drift('3.261231.7', root)).toEqual([]);
    const desktop = JSON.parse(readFileSync(join(root, 'apps/desktop/package.json'), 'utf8'));
    expect(desktop.name).toBe('@automagik/omni-desktop');
    expect(() => setVersion('3.2610.1', root)).toThrow(/not a version/);
  });

  test('the next release counts that day\'s tags, on the 3.x line', () => {
    expect(nextVersion('2026-10-24', [])).toBe('3.261024.1');
    expect(nextVersion('2026-10-24', ['v3.261024.1', 'v3.261024.2', 'v3.261023.9', 'v2.261024.5', ''])).toBe('3.261024.3');
    // Above every Omni desktop build (2.YYMMDD.N), which an installed app updates from.
    expect(Bun.semver.order(nextVersion('2026-10-24', []), '2.261023.32')).toBe(1);
  });
});
