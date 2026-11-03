// The release workflows' shell, run as written with a fake gh: the desktop build keeps the cut's
// signed lane on the release, and the cut retries the lane's upload to its versioned release.
import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const workflow = (name: string) => readFileSync(join(import.meta.dir, '..', '.github', 'workflows', name), 'utf8').split('\n');

function bash(script: string, args: string[] = [], env: Record<string, string> = {}) {
  const run = spawnSync('bash', ['-c', `set -euo pipefail\n${script}`, 'bash', ...args], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '', ...env } });
  return { status: run.status, out: run.stdout, err: run.stderr };
}

describe('the desktop build adding its files to an existing release', () => {
  const lines = workflow('desktop-build.yml');
  const step = lines.findIndex(line => line.includes('name: Add the builds to the release'));
  const keep = lines.slice(step).find(line => /^\s*case "\$\{name\}" in .*\) continue ;; esac$/.test(line));

  test('keeps the cut\'s own files and its signed lane, and lets the rest go', () => {
    expect(step).toBeGreaterThan(-1);
    expect(keep).toBeDefined();
    const names = ['lane.json', 'lane.json.sig', 'automagik-bots-dsh-9.9.9.tgz', 'plugins.json', 'PLUGINS.SHA256SUMS', 'Automagik-9.9.9-arm64.dmg', 'lane.json.old'];
    const run = bash(`for name in "$@"; do\n${keep}\necho "\${name}"\ndone`, names);
    expect(run.status).toBe(0);
    expect(run.out.trim().split('\n')).toEqual(['Automagik-9.9.9-arm64.dmg', 'lane.json.old']);
  });
});

describe('the cut uploading its signed lane to the versioned release', () => {
  const lines = workflow('release.yml');
  const upload = lines.findIndex(line => line.includes('until gh release upload "v${VERSION}" lane/lane.json lane/lane.json.sig'));
  const end = lines.findIndex((line, i) => i > upload && line.trim() === 'done');
  const block = upload > 0 && lines[upload - 1].trim() === 'tries=0' ? lines.slice(upload - 1, end + 1).join('\n') : '';

  // gh fails its first `fails` calls; gh and sleep each log their arguments.
  function cut(fails: number) {
    const dir = mkdtempSync(join(tmpdir(), 'release-upload-'));
    const bin = join(dir, 'bin');
    mkdirSync(bin);
    writeFileSync(join(bin, 'gh'), `#!/usr/bin/env bash\necho "$*" >> "${dir}/gh.log"\nn=$(wc -l < "${dir}/gh.log")\n(( n > ${fails} ))\n`);
    writeFileSync(join(bin, 'sleep'), `#!/usr/bin/env bash\necho "$*" >> "${dir}/sleep.log"\n`);
    chmodSync(join(bin, 'gh'), 0o755);
    chmodSync(join(bin, 'sleep'), 0o755);
    const run = bash(block, [], { PATH: `${bin}:${process.env.PATH ?? ''}`, VERSION: '9.9.9', GITHUB_REPOSITORY: 'owner/repo' });
    const log = (name: string) => { try { return readFileSync(join(dir, name), 'utf8').trim().split('\n').filter(Boolean); } catch { return []; } };
    const result = { ...run, gh: log('gh.log'), sleeps: log('sleep.log') };
    rmSync(dir, { recursive: true, force: true });
    return result;
  }
  const call = 'release upload v9.9.9 lane/lane.json lane/lane.json.sig --repo owner/repo';

  test('is found as the step writes it', () => {
    expect(block).not.toBe('');
  });

  test('one good upload: no wait, never --clobber', () => {
    const run = cut(0);
    expect(run.status).toBe(0);
    expect(run.gh).toEqual([call]);
    expect(run.sleeps).toEqual([]);
  });

  test('two transient errors: the third try goes up, 10 s and then 20 s later', () => {
    const run = cut(2);
    expect(run.status).toBe(0);
    expect(run.gh).toEqual([call, call, call]);
    expect(run.sleeps).toEqual(['10', '20']);
  });

  test('three errors: the cut fails loudly, naming the tag and both files', () => {
    const run = cut(3);
    expect(run.status).toBe(1);
    expect(run.gh).toEqual([call, call, call]);
    expect(run.sleeps).toEqual(['10', '20']);
    expect(run.out).toContain('::error::lane/lane.json and lane/lane.json.sig did not reach v9.9.9 after 3 tries');
  });
});

describe('commitlint over a pull request that imports a repository with its history', () => {
  const lines = workflow('commitlint.yml');
  const start = lines.findIndex(line => line.trim() === 'run: |');
  const script = start > 0 ? lines.slice(start + 1).map(line => line.replace(/^ {10}/, '')).join('\n') : '';

  // A repository with dev at `base`, and a branch on it that merges in an unrelated history (an
  // import, whose commit runs past 100 characters as automagik-herdr's did) and adds its own `own`.
  function lint(own: string) {
    const dir = mkdtempSync(join(tmpdir(), 'commitlint-'));
    const git = (...args: string[]) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { cwd: dir, encoding: 'utf8' }).stdout.trim();
    git('init', '-q', '-b', 'dev');
    git('commit', '-q', '--allow-empty', '-m', 'chore: the base');
    const base = git('rev-parse', 'HEAD');
    git('checkout', '-q', '--orphan', 'imported');
    git('commit', '-q', '--allow-empty', '-m', `docs(old): a line the old repository allowed ${'x'.repeat(80)}`);
    git('commit', '-q', '--allow-empty', '-m', 'Merge-ish subject that is not conventional at all');
    git('checkout', '-q', '-b', 'pr', base);
    git('merge', '-q', '--allow-unrelated-histories', '-m', 'feat(herdr): import it', 'imported');
    git('commit', '-q', '--allow-empty', '-m', own);
    const run = spawnSync('bash', ['-c', `set -euo pipefail\n${script}`], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH ?? '', BASE: base, HEAD: git('rev-parse', 'HEAD') } });
    rmSync(dir, { recursive: true, force: true });
    return { status: run.status, out: run.stdout + run.stderr };
  }

  test('the imported commits are skipped, as the source wrote them; the pull request\'s own are checked', () => {
    expect(script).toContain('git merge-base --is-ancestor "${mb}" "${sha}"');
    const ok = lint('ci(herdr): run the pack in this repository');
    expect(ok.out).toContain('2 imported commit(s) skipped');
    expect(ok.status).toBe(0);
    const bad = lint(`fix: a commit of this pull request ${'y'.repeat(80)}`);
    expect(bad.status).toBe(1);
    expect(bad.out).toContain('has a line over 100 characters');
    expect(bad.out).not.toContain('is not conventional');
  });
});
