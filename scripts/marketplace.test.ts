import { describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { INDEX_PATH, REPO_URL, VETTED, checkIndex, pinIndex } from './marketplace';
import { pluginNames } from './release-plugins';

const repoDir = join(import.meta.dir, '..');
const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoDir, encoding: 'utf8' }).trim();
const team = JSON.parse(readFileSync(join(repoDir, 'apps/bots-dsh/package.json'), 'utf8'));
const indexWith = (source: Record<string, unknown>, version = team.version, engines = team.engines) => ({
  format: 1,
  title: { en: 'Test' },
  plugins: [{ name: team.name, versions: [{ version, publishTimestamp: 1, source, ...(engines ? { engines } : {}) }] }],
});

type IndexPlugin = { name: string; versions: { source: { url: string; path?: string } }[] };

describe('market index', () => {
  test('lists every plugin of this repository, by its folder, and otherwise only vetted forks', () => {
    const index = JSON.parse(readFileSync(INDEX_PATH, 'utf8'));
    const ours = index.plugins.filter((plugin: IndexPlugin) => plugin.versions[0]?.source.url === REPO_URL);
    const listed = ours.map((plugin: IndexPlugin) => plugin.name);
    // A plugin not released yet is listed by its first release's pin, from its automagik.market.
    for (const name of pluginNames().filter((name) => !listed.includes(name))) {
      const market = JSON.parse(readFileSync(join(repoDir, 'apps', name.replace('@automagik/', ''), 'package.json'), 'utf8')).automagik?.market;
      expect(typeof market?.title?.en).toBe('string');
      expect(typeof market?.description?.en).toBe('string');
      expect(Object.keys(index.metadata.categories)).toContain(market.category);
    }
    expect(listed.filter((name: string) => !pluginNames().includes(name))).toEqual([]);
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

  test('an entry lists the DSH range its package.json declares, which covers the DSH its tests run on', () => {
    const source = { type: 'git', url: REPO_URL, commit: head, path: 'apps/bots-dsh' };
    expect(checkIndex(indexWith(source, team.version, { dsh: '>=0.2.1-rc.2 <0.3.0' }), repoDir)[0]).toMatch(/lists dsh >=0\.2\.1-rc\.2 <0\.3\.0 but its package\.json declares/);
    expect(checkIndex(indexWith(source, team.version, null), repoDir)[0]).toMatch(/lists dsh \(none\)/);
    // Each plugin of ours declares a tested range, and the DSH its tests run on is in it.
    for (const name of pluginNames()) {
      const folder = join(repoDir, 'apps', name.replace('@automagik/', ''));
      const range = JSON.parse(readFileSync(join(folder, 'package.json'), 'utf8')).engines?.dsh;
      const tested = JSON.parse(readFileSync(join(folder, 'dev/harness/package.json'), 'utf8')).dependencies['@deepseek-ai/dsh'];
      expect(typeof range).toBe('string');
      expect(Bun.semver.satisfies(tested, range)).toBe(true);
    }
  });

  test('a wrong version, a missing folder, another repository or an unknown commit fail', () => {
    expect(checkIndex(indexWith({ type: 'git', url: REPO_URL, commit: head, path: 'apps/bots-dsh' }, '9.9.9'), repoDir)[0]).toMatch(/is @automagik\/bots-dsh@/);
    expect(checkIndex(indexWith({ type: 'git', url: REPO_URL, commit: head, path: 'apps/nothing' }), repoDir)[0]).toMatch(/has no apps\/nothing\/package\.json/);
    expect(checkIndex(indexWith({ type: 'git', url: 'https://github.com/automagik-dev/omni', commit: head, path: 'apps/bots-dsh' }), repoDir)[0]).toMatch(/every source is a commit of/);
    expect(checkIndex(indexWith({ type: 'git', url: REPO_URL, commit: 'f'.repeat(40), path: 'apps/bots-dsh' }), repoDir)[0]).toMatch(/not reachable/);
  });

  test('lists Genie at the commit the welcome installs it from', () => {
    const index = JSON.parse(readFileSync(INDEX_PATH, 'utf8'));
    const genie = JSON.parse(readFileSync(join(repoDir, 'apps/welcome-dsh/package.json'), 'utf8')).automagik.genie;
    const listed = index.plugins.find((plugin: IndexPlugin) => plugin.name === '@automagik/genie-dsh');
    expect(listed.versions[0]).toMatchObject({
      version: genie.version,
      source: { type: 'git', url: genie.repository.replace(/\.git$/, ''), commit: genie.commit, path: genie.path },
    });
  });

  test('a release lists a plugin of ours that is not listed yet, from its package.json automagik.market', () => {
    const index = JSON.parse(readFileSync(INDEX_PATH, 'utf8'));
    const pinned = pinIndex({ ...index, plugins: [] }, repoDir, 'HEAD');
    const bridge = pinned.plugins.find((plugin) => plugin.name === '@automagik/unfold-bridge-dsh');
    const manifest = JSON.parse(execFileSync('git', ['show', 'HEAD:apps/unfold-bridge-dsh/package.json'], { cwd: repoDir, encoding: 'utf8' }));
    expect(bridge).toMatchObject({
      title: manifest.automagik.market.title,
      description: manifest.automagik.market.description,
      author: 'Automagik',
      homepage: `${REPO_URL}/tree/dev/apps/unfold-bridge-dsh#readme`,
      repository: { url: REPO_URL, directory: 'apps/unfold-bridge-dsh' },
      metadata: { category: manifest.automagik.market.category, keywords: manifest.automagik.market.keywords, labels: ['official'] },
      versions: [{ version: manifest.version, source: { type: 'git', url: REPO_URL, commit: head, path: 'apps/unfold-bridge-dsh' }, engines: { dsh: manifest.engines.dsh } }],
    });
    // only plugins with a market block join (the bridge, the pt-BR pack and the Unfold plugins); the
    // Bot team and the welcome are listed by hand
    expect(pinned.plugins.map((plugin) => plugin.name)).toEqual(['@automagik/locale-pt-br-dsh', '@automagik/unfold-bridge-dsh', '@automagik/unfold-capabilities-dsh', '@automagik/unfold-mind-dsh', '@automagik/unfold-settings-dsh']);
    expect(checkIndex(pinned, repoDir)).toEqual([]);
  });

  test('a vetted fork passes at its commit, proven by dsh-marketplace', () => {
    expect(checkIndex(indexWith({ type: 'git', url: VETTED[0], commit: 'a'.repeat(40) }, '1.0.0'), repoDir)).toEqual([]);
  });
});
