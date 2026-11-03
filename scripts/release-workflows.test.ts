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
  const long = (what: string) => `${what} ${'x'.repeat(90)}`;

  // A repository whose dev is `base`; `steps` builds a pull request branch `pr` on it. `upstream`
  // is the imported repository's history (an orphan, as filter-repo leaves it), which the steps
  // grow and merge in as scripts/import-herdr.sh does.
  function lint(steps: (git: (...args: string[]) => string) => void) {
    const dir = mkdtempSync(join(tmpdir(), 'commitlint-'));
    const git = (...args: string[]) => {
      const run = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { cwd: dir, encoding: 'utf8' });
      if (run.status !== 0) throw new Error(`git ${args.join(' ')}: ${run.stderr}`);
      return run.stdout.trim();
    };
    try {
      git('init', '-q', '-b', 'dev');
      git('commit', '-q', '--allow-empty', '-m', 'chore: the base');
      git('checkout', '-q', '--orphan', 'upstream');
      git('commit', '-q', '--allow-empty', '-m', long('docs(old): a line the old repository allowed'));
      git('commit', '-q', '--allow-empty', '-m', 'An old subject that is not conventional');
      git('checkout', '-q', '-b', 'pr', 'dev');
      steps(git);
      const run = spawnSync('bash', ['-c', `set -euo pipefail\n${script}`], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH ?? '', BASE: git('rev-parse', 'dev'), HEAD: git('rev-parse', 'pr') } });
      return { status: run.status, out: run.stdout + run.stderr };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  const importIt = (git: (...args: string[]) => string) => git('merge', '-q', '--no-ff', '--allow-unrelated-histories', '-m', 'feat(herdr): import it', 'upstream');
  const commit = (git: (...args: string[]) => string, subject: string) => git('commit', '-q', '--allow-empty', '-m', subject);

  test('the script skips only what an import merge\'s second parent brought', () => {
    expect(script).toContain('git merge-base --is-ancestor "${root}" "${merge}^2"');
    expect(script).toContain('git rev-list --no-merges "${merge}^2" --not "${merge}^1" "${BASE}"');
  });

  test('the first import: its history is skipped; the pull request\'s own commits are checked', () => {
    const ok = lint(git => { commit(git, 'chore(herdr): add the import script'); importIt(git); commit(git, 'ci(herdr): run the pack here'); });
    expect(ok.out).toContain('2 imported commit(s) skipped');
    expect(ok.status).toBe(0);
    const bad = lint(git => { importIt(git); commit(git, long('fix: a commit of this pull request')); });
    expect(bad.status).toBe(1);
    expect(bad.out).toContain('has a line over 100 characters');
    expect(bad.out).not.toContain('is not conventional');
  });

  test('the final re-run adds a second import merge: only its new upstream commits are skipped', () => {
    const rerun = (own: string) => lint(git => {
      importIt(git);
      commit(git, 'feat(herdr): point the pack here');
      git('checkout', '-q', 'upstream');
      commit(git, long('fix(old): a newer upstream commit'));
      git('checkout', '-q', 'pr');
      git('merge', '-q', '--no-ff', '-m', 'feat(herdr): import it again', 'upstream');
      commit(git, own);
    });
    const ok = rerun('fix(herdr): resolve the re-import');
    expect(ok.out).toContain('3 imported commit(s) skipped');
    expect(ok.status).toBe(0);
    const bad = rerun('fixed the re-import');
    expect(bad.status).toBe(1);
    expect(bad.out).toContain('is not conventional: fixed the re-import');
  });

  test('other merges skip nothing: dev merged in, or a branch of this repository merged with --no-ff', () => {
    const devMoves = lint(git => {
      importIt(git);
      commit(git, long('fix: a commit of this pull request'));
      git('checkout', '-q', 'dev');
      commit(git, 'chore(release): v9.9.9');
      git('checkout', '-q', 'pr');
      git('merge', '-q', '--no-ff', '-m', 'chore: merge dev', 'dev');
    });
    expect(devMoves.status).toBe(1);
    expect(devMoves.out).toContain('has a line over 100 characters');
    expect(devMoves.out).toContain('2 imported commit(s) skipped');
    const side = lint(git => {
      git('checkout', '-q', '-b', 'side', 'dev');
      commit(git, 'wip on a side branch');
      git('checkout', '-q', 'pr');
      git('merge', '-q', '--no-ff', '-m', 'chore: merge side', 'side');
    });
    expect(side.status).toBe(1);
    expect(side.out).toContain('is not conventional: wip on a side branch');
    expect(side.out).not.toContain('skipped');
  });
});
