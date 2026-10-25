import { describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { INDEX_PATH, REPO_URL, VETTED, checkIndex } from './marketplace';
import { pluginNames } from './release-plugins';

const repoDir = join(import.meta.dir, '..');
const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoDir, encoding: 'utf8' }).trim();
const team = JSON.parse(readFileSync(join(repoDir, 'apps/bots-dsh/package.json'), 'utf8'));
const indexWith = (source: Record<string, unknown>, version = team.version) => ({
  format: 1,
  title: { en: 'Test' },
  plugins: [{ name: team.name, versions: [{ version, publishTimestamp: 1, source }] }],
});

type IndexPlugin = { name: string; versions: { source: { url: string; path?: string } }[] };

describe('market index', () => {
  test('lists every plugin of this repository, by its folder, and otherwise only vetted forks', () => {
    const index = JSON.parse(readFileSync(INDEX_PATH, 'utf8'));
    const ours = index.plugins.filter((plugin: IndexPlugin) => plugin.versions[0]?.source.url === REPO_URL);
    expect(ours.map((plugin: IndexPlugin) => plugin.name).sort()).toEqual(pluginNames());
    for (const plugin of ours) {
      for (const entry of plugin.versions) {
        expect(entry.source.url).toBe(REPO_URL);
        expect(entry.source.path).toBe(`apps/${plugin.name.replace('@automagik/', '')}`);
      }
    }
    for (const plugin of index.plugins.filter((plugin: IndexPlugin) => !ours.includes(plugin))) {
      for (const entry of plugin.versions) expect(VETTED).toContain(entry.source.url);
    }
  });

  test('a commit that holds the package passes', () => {
    expect(checkIndex(indexWith({ type: 'git', url: REPO_URL, commit: head, path: 'apps/bots-dsh' }), repoDir)).toEqual([]);
  });

  test('a wrong version, a missing folder, another repository or an unknown commit fail', () => {
    expect(checkIndex(indexWith({ type: 'git', url: REPO_URL, commit: head, path: 'apps/bots-dsh' }, '9.9.9'), repoDir)[0]).toMatch(/is @automagik\/bots-dsh@/);
    expect(checkIndex(indexWith({ type: 'git', url: REPO_URL, commit: head, path: 'apps/nothing' }), repoDir)[0]).toMatch(/has no apps\/nothing\/package\.json/);
    expect(checkIndex(indexWith({ type: 'git', url: 'https://github.com/automagik-dev/omni', commit: head, path: 'apps/bots-dsh' }), repoDir)[0]).toMatch(/every source is a commit of/);
    expect(checkIndex(indexWith({ type: 'git', url: REPO_URL, commit: 'f'.repeat(40), path: 'apps/bots-dsh' }), repoDir)[0]).toMatch(/not reachable/);
  });

  test('a vetted fork passes at its commit, proven by dsh-marketplace', () => {
    expect(checkIndex(indexWith({ type: 'git', url: VETTED[0], commit: 'a'.repeat(40) }, '1.0.0'), repoDir)).toEqual([]);
  });
});
