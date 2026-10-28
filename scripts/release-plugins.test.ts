import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pluginNames, releasePlugins, tarballOf } from './release-plugins';

describe("a release's plugins.json", () => {
  test('lists this repository\'s plugins', () => {
    expect(pluginNames()).toEqual(['@automagik/bots-dsh', '@automagik/locale-pt-br-dsh', '@automagik/unfold-bot-dsh', '@automagik/unfold-bridge-dsh', '@automagik/unfold-capabilities-dsh', '@automagik/unfold-events-dsh', '@automagik/unfold-mind-dsh', '@automagik/unfold-session-dsh', '@automagik/unfold-settings-dsh', '@automagik/unfold-sse-dsh', '@automagik/unfold-trajectory-dsh', '@automagik/welcome-dsh']);
    expect(tarballOf('@automagik/bots-dsh', '3.261024.1')).toBe('automagik-bots-dsh-3.261024.1.tgz');
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
