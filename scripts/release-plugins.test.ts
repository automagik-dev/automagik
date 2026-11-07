import { describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pluginNames, releasePlugins, unshipped, tarballOf } from './release-plugins';

const root = join(import.meta.dir, '..');

describe("a release's plugins.json", () => {
  test('lists this repository\'s plugins, and none of Unfold\'s', () => {
    expect(pluginNames()).toEqual(['@automagik/acp-dsh', '@automagik/bots-dsh', '@automagik/locale-pt-br-dsh', '@automagik/welcome-dsh']);
    // Every Unfold plugin is built and tested here, but Unfold's own release ships it
    // (Refs marketplace/unfold): this repository's releases never attach one.
    expect(pluginNames().filter(unshipped)).toEqual([]);
    expect(tarballOf('@automagik/bots-dsh', '3.261024.1')).toBe('automagik-bots-dsh-3.261024.1.tgz');
  });

  test('every Unfold package still resolves as a git source, though no release carries it', () => {
    const folders = readdirSync(join(root, 'apps')).filter((name) => name.startsWith('unfold-')).sort();
    expect(folders.length).toBe(9);
    for (const folder of folders) {
      const path = `apps/${folder}`;
      const manifest = JSON.parse(readFileSync(join(root, path, 'package.json'), 'utf8'));
      expect(manifest.name).toBe(`@automagik/${folder}`);
      // The source a market pins is this folder at a release commit.
      expect(manifest.repository).toEqual({
        type: 'git',
        url: 'git+https://github.com/automagik-dev/automagik.git',
        directory: path,
      });
      expect(execFileSync('git', ['ls-tree', '--name-only', 'HEAD', `${path}/package.json`], { cwd: root, encoding: 'utf8' }).trim()).toBe(`${path}/package.json`);
      if (manifest.dsh?.bundle?.patch) expect(existsSync(join(root, path, manifest.dsh.bundle.patch))).toBe(true);
      // A listing takes its title and description from the package where it has them; the SSE
      // library is not a plugin and has neither.
      if (manifest.dsh) {
        expect(manifest.automagik?.market?.title?.en).toBeTruthy();
        expect(manifest.automagik?.market?.description?.en).toBeTruthy();
      } else {
        expect(manifest.automagik?.market).toBeUndefined();
      }
    }
  });

  test('carries each tarball\'s integrity, as npm computes it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'automagik-release-'));
    writeFileSync(join(dir, 'automagik-bots-dsh-3.261024.1.tgz'), 'team');
    writeFileSync(join(dir, 'automagik-welcome-dsh-3.261024.1.tgz'), 'welcome');
    const commit = 'a'.repeat(40);
    const plugins = releasePlugins('3.261024.1', commit, dir, ['@automagik/bots-dsh', '@automagik/welcome-dsh']);
    expect(plugins.repository).toBe('https://github.com/automagik-dev/automagik');
    expect(plugins.commit).toBe(commit);
    expect(plugins.packages['@automagik/bots-dsh']).toEqual({
      version: '3.261024.1',
      file: 'automagik-bots-dsh-3.261024.1.tgz',
      integrity: `sha512-${createHash('sha512').update('team').digest('base64')}`,
      size: 4,
    });
    expect(() => releasePlugins('3.261024.2', commit, dir, ['@automagik/bots-dsh'])).toThrow(/has no automagik-bots-dsh-3\.261024\.2\.tgz/);
    expect(() => releasePlugins('3.261024.1', 'main', dir, [])).toThrow(/not a commit/);
  });
});
