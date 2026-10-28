import { describe, expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// The browser bundles the plugins build and commit (client.js) name no build machine: no Linux or
// macOS home directory, whether the bundler or an upstream bundle put it there.
const APPS = join(import.meta.dir, '..', 'apps');
const HOMES = ['home', 'Users'].map((dir) => `/${dir}/`);
const apps = (file: string) => readdirSync(APPS).filter((app) => existsSync(join(APPS, app, file))).sort();

describe('the built client bundles', () => {
  test('every plugin that builds a client commits its client.js', () => {
    expect(apps('client.js')).toEqual(apps(join('scripts', 'build-client.mjs')));
    expect(apps('client.js').length).toBeGreaterThan(0);
  });

  test('no bundle names a home directory', () => {
    const hits = apps('client.js').flatMap((app) => {
      const text = readFileSync(join(APPS, app, 'client.js'), 'utf8');
      return HOMES.map((home) => [home, text.split(home).length - 1] as const)
        .filter(([, count]) => count > 0)
        .map(([home, count]) => `${app}/client.js: ${count} × ${home}`);
    });
    expect(hits).toEqual([]);
  });
});
