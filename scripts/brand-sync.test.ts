import { afterAll, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { FOLDERS, RECORD, SOURCE, TOOL, check, staleness, write } from './brand-sync.mjs';

// docs/brand is the brand's source; Genie, Omni and Arca carry a byte copy made by
// scripts/brand-sync.mjs (docs/brand/README.md, "Using this in another repository"). No test here
// reaches the network: Automagik's remote is a repository made for the test.
const ROOT = resolve(import.meta.dir, '..');
const SKILL = '.claude/skills/automagik-brand/SKILL.md';
const made: string[] = [];
afterAll(() => { for (const folder of made) rmSync(folder, { recursive: true, force: true }); });

const sha256 = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const git = (cwd: string, ...args: string[]) => {
  const run = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' });
  if (run.status !== 0) throw new Error(`git ${args.join(' ')}: ${run.stderr}`);
  return run.stdout.trim();
};
const put = (root: string, path: string, content: string | Buffer) => {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
};
const commit = (repo: string, subject: string) => { git(repo, 'add', '-f', '-A', '.'); git(repo, 'commit', '-q', '-m', subject); return git(repo, 'rev-parse', 'HEAD'); };
// The tool itself, run by Node as another repository's CI runs it.
const run = (cwd: string, ...args: string[]) => spawnSync('node', [join(ROOT, TOOL), ...args], { cwd, encoding: 'utf8', env: { ...process.env, GITHUB_ACTIONS: '' } });
const filesUnder = (root: string, folder: string): string[] => readdirSync(join(root, folder), { withFileTypes: true })
  .flatMap(entry => (entry.isDirectory() ? filesUnder(root, `${folder}/${entry.name}`) : [`${folder}/${entry.name}`]));

/** A stand-in for Automagik's repository on `dev` (also the remote), and a repository to carry the copy. */
function repositories(fill: (source: string) => void) {
  const base = mkdtempSync(join(tmpdir(), 'brand-sync-test-'));
  made.push(base);
  const source = join(base, 'automagik');
  const target = join(base, 'genie');
  for (const repo of [source, target]) { mkdirSync(repo); git(repo, 'init', '-q', '-b', 'dev'); }
  // A real remote serves any commit that is reachable; a folder needs to be told to.
  git(source, 'config', 'uploadpack.allowAnySHA1InWant', 'true');
  git(source, 'config', 'uploadpack.allowFilter', 'true');
  fill(source);
  const first = commit(source, 'the brand');
  put(target, 'README.md', '# genie\n');
  commit(target, 'genie');
  return { source, target, first };
}

/** A small brand: a note, a token file, a picture's bytes, the skill and the tool. */
const small = () => repositories(source => {
  put(source, 'docs/brand/README.md', '# Brand\n');
  put(source, 'docs/brand/tokens/tokens.css', ':root{--bt-main:#fff}\n');
  put(source, 'docs/brand/logo/png/mark.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0x0a, 0x0d]));
  put(source, SKILL, '---\nname: automagik-brand\n---\n');
  put(source, TOOL, readFileSync(join(ROOT, TOOL)));
  put(source, 'README.md', '# automagik\n');
});

describe('the brand copy tool (scripts/brand-sync.mjs)', () => {
  test("self-test: Automagik's own brand, skill and tool copy into another repository byte for byte, and --check passes", () => {
    const { source, target, first } = repositories(source => {
      for (const folder of FOLDERS) cpSync(join(ROOT, folder), join(source, folder), { recursive: true });
      put(source, TOOL, readFileSync(join(ROOT, TOOL)));
    });
    const wrote = run(target, '--write', '--from', source, '--remote', source);
    expect(wrote.stderr).toBe('');
    expect(wrote.status).toBe(0);
    const checked = run(target, '--check', '--remote', source);
    expect(checked.stderr).toBe('');
    expect(checked.status).toBe(0);

    const ours = [...FOLDERS.flatMap(folder => filesUnder(ROOT, folder)), TOOL].sort();
    expect(ours).toContain('docs/brand/README.md');
    expect(ours).toContain('docs/brand/tokens/tokens.css');
    expect(ours).toContain(SKILL);
    const record = JSON.parse(readFileSync(join(target, RECORD), 'utf8'));
    expect(record.source).toBe(SOURCE);
    expect(record.commit).toBe(first);
    expect(Object.keys(record.files)).toEqual(ours);
    for (const path of ours) {
      const bytes = readFileSync(join(ROOT, path));
      expect(readFileSync(join(target, path)).equals(bytes)).toBe(true);
      expect(record.files[path]).toBe(sha256(bytes));
    }
    // The copy is exactly those files and its record: nothing else was written.
    expect(git(target, 'status', '--porcelain', '-uall').split('\n').map(line => line.slice(3)).sort()).toEqual([...ours, RECORD].sort());
    expect(checked.stdout).toContain(`${ours.length} files match ${RECORD}`);
    // Automagik's own repository carries no record: it is the source.
    expect(existsSync(join(ROOT, RECORD))).toBe(false);
  }, 60_000);

  test('--check names a drifted file, a missing file, a stale extra file, a drifted skill and a drifted tool, and exits 1', () => {
    const { source, target } = small();
    write({ to: target, from: source });
    expect(check({ to: target }).problems).toEqual([]);

    writeFileSync(join(target, 'docs/brand/tokens/tokens.css'), ':root{--bt-main:#000}\n');
    rmSync(join(target, 'docs/brand/logo/png/mark.png'));
    put(target, 'docs/brand/logo/old-mark.svg', '<svg/>\n');
    writeFileSync(join(target, SKILL), '---\nname: automagik-brand\n---\nUse any colour.\n');
    writeFileSync(join(target, TOOL), '// not the tool\n');
    put(target, '.claude/skills/automagik-brand/extra.md', 'more\n');
    expect(check({ to: target }).problems).toEqual([
      `${SKILL} differs from ${RECORD}`,
      'docs/brand/logo/png/mark.png is missing',
      `docs/brand/tokens/tokens.css differs from ${RECORD}`,
      `${TOOL} differs from ${RECORD}`,
      `.claude/skills/automagik-brand/extra.md is not in ${RECORD}: a stale or added file`,
      `docs/brand/logo/old-mark.svg is not in ${RECORD}: a stale or added file`,
    ]);

    // The command line, as CI runs it (from the source's tool: the target's own is the drifted one).
    const checked = run(target, '--check', '--remote', source);
    expect(checked.status).toBe(1);
    for (const path of [SKILL, 'docs/brand/logo/png/mark.png', 'docs/brand/tokens/tokens.css', TOOL, 'docs/brand/logo/old-mark.svg']) expect(checked.stderr).toContain(`brand-sync: ${path} `);
    expect(checked.stderr).toContain('--write --from');

    // --write repairs all of it, and removes the stale files and the folder one left empty.
    const wrote = run(target, '--write', '--from', source, '--remote', source);
    expect(wrote.status).toBe(0);
    expect(wrote.stdout).toContain('removed docs/brand/logo/old-mark.svg');
    expect(wrote.stdout).toContain('removed .claude/skills/automagik-brand/extra.md');
    expect(existsSync(join(target, 'docs/brand/logo/old-mark.svg'))).toBe(false);
    expect(check({ to: target }).problems).toEqual([]);
    expect(run(target, '--check', '--remote', source).status).toBe(0);
  });

  test('a file the source dropped is removed by the next --write, with its folder', () => {
    const { source, target } = small();
    write({ to: target, from: source });
    git(source, 'rm', '-q', 'docs/brand/logo/png/mark.png');
    const next = commit(source, 'drop the png');
    const done = write({ to: target, from: source });
    expect(done.commit).toBe(next);
    expect(done.removed).toEqual(['docs/brand/logo/png/mark.png']);
    expect(existsSync(join(target, 'docs/brand/logo'))).toBe(false);
    expect(check({ to: target }).problems).toEqual([]);
  });

  test('a record that is missing, broken or names a path outside the brand fails the check', () => {
    const { source, target } = small();
    expect(check({ to: target }).problems).toEqual([`${RECORD} is missing: nothing here says which Automagik commit this copy is`]);
    expect(run(target, '--check', '--remote', source).status).toBe(1);
    write({ to: target, from: source });
    const record = JSON.parse(readFileSync(join(target, RECORD), 'utf8'));
    writeFileSync(join(target, RECORD), JSON.stringify({ ...record, files: { ...record.files, 'docs/brand/../../README.md': sha256('# genie\n'), 'src/app.js': 'x' } }));
    expect(check({ to: target }).problems).toEqual([
      `${RECORD} lists docs/brand/../../README.md, which is outside the brand's folders`,
      `${RECORD} lists src/app.js, which is outside the brand's folders`,
    ]);
    writeFileSync(join(target, RECORD), JSON.stringify({ ...record, commit: 'dev' }));
    expect(check({ to: target }).problems).toEqual([`${RECORD} does not record a commit and its files`]);
    writeFileSync(join(target, RECORD), '{');
    expect(check({ to: target }).problems[0]).toStartWith(`${RECORD} is not JSON`);
  });

  test("the look at Automagik's dev: quiet while the brand there is the copy's, a warning that never fails once it is not", () => {
    const { source, target, first } = small();
    write({ to: target, from: source });
    expect(staleness({ commit: first, remote: source })).toEqual({ state: 'current', dev: first });

    // dev moves, but not the brand: still current.
    put(source, 'README.md', '# automagik, edited\n');
    const unrelated = commit(source, 'an unrelated change');
    expect(staleness({ commit: first, remote: source })).toEqual({ state: 'current', dev: unrelated });
    const quiet = run(target, '--check', '--remote', source);
    expect(quiet.status).toBe(0);
    expect(quiet.stdout).not.toContain('warning');

    // The brand changes on dev: --check warns, names the newer commit, and still passes.
    put(source, 'docs/brand/tokens/tokens.css', ':root{--bt-main:#fffaf0}\n');
    const newer = commit(source, 'a new cream');
    expect(staleness({ commit: first, remote: source })).toEqual({ state: 'behind', dev: newer });
    const warned = run(target, '--check', '--remote', source);
    expect(warned.status).toBe(0);
    expect(warned.stderr).toBe('');
    expect(warned.stdout).toContain('brand-sync: warning: ');
    expect(warned.stdout).toContain(`--write --from ${newer}`);

    // --write from the older commit (read from the remote by its id) prints the newer one, without "warning".
    const older = run(target, '--write', '--from', first, '--remote', source);
    expect(older.stderr).toBe('');
    expect(older.status).toBe(0);
    expect(older.stdout).toContain(`copied 5 files from Automagik ${first}`);
    expect(older.stdout).toContain(`--write --from ${newer}`);
    expect(older.stdout).not.toContain('warning');

    // Copied from dev's commit, the look is quiet again.
    const synced = run(target, '--write', '--from', newer, '--remote', source);
    expect(synced.status).toBe(0);
    expect(synced.stdout).toContain("is the same as this copy's");
    expect(readFileSync(join(target, 'docs/brand/tokens/tokens.css'), 'utf8')).toBe(':root{--bt-main:#fffaf0}\n');
    expect(JSON.parse(readFileSync(join(target, RECORD), 'utf8')).commit).toBe(newer);

    // A skill change on dev counts too.
    put(source, SKILL, '---\nname: automagik-brand\n---\nRead the README.\n');
    const skill = commit(source, 'the skill');
    expect(staleness({ commit: newer, remote: source })).toEqual({ state: 'behind', dev: skill });
  });

  test('on GitHub Actions the warning is an annotation too', () => {
    const { source, target } = small();
    write({ to: target, from: source });
    put(source, 'docs/brand/README.md', '# Brand, edited\n');
    const newer = commit(source, 'the note');
    const warned = spawnSync('node', [join(ROOT, TOOL), '--check', '--remote', source], { cwd: target, encoding: 'utf8', env: { ...process.env, GITHUB_ACTIONS: 'true' } });
    expect(warned.status).toBe(0);
    expect(warned.stdout).toContain(`::warning title=The brand copy is behind Automagik::the brand on Automagik's dev (${newer})`);
  });

  test('with no network both modes say so and go on', () => {
    const { source, target, first } = small();
    const nowhere = join(dirname(source), 'no-such-remote');
    expect(staleness({ commit: first, remote: nowhere }).state).toBe('offline');
    const wrote = run(target, '--write', '--from', source, '--remote', nowhere);
    expect(wrote.status).toBe(0);
    expect(wrote.stdout).toContain("could not reach Automagik's repository (offline?)");
    const checked = run(target, '--check', '--remote', nowhere);
    expect(checked.status).toBe(0);
    expect(checked.stdout).toContain("could not reach Automagik's repository (offline?)");
    expect(checked.stdout).toContain(`5 files match ${RECORD}`);
  });

  test('--write refuses the source itself, a copy as the source, a commit older than the skill, and a linked folder', () => {
    const { source, target, first } = small();
    expect(() => write({ to: source, from: source })).toThrow('this is the source');
    expect(existsSync(join(source, RECORD))).toBe(false);

    write({ to: target, from: source });
    commit(target, 'the copy');
    const other = join(dirname(target), 'omni');
    mkdirSync(other);
    expect(() => write({ to: other, from: target })).toThrow('it is a copy itself');
    expect(readdirSync(other)).toEqual([]);

    git(source, 'rm', '-q', SKILL);
    const noSkill = commit(source, 'no skill');
    expect(() => write({ to: other, from: source })).toThrow(`commit ${noSkill.slice(0, 12)} holds no ${SKILL}`);
    expect(readdirSync(other)).toEqual([]);

    const elsewhere = join(dirname(target), 'elsewhere');
    mkdirSync(join(elsewhere, 'brand'), { recursive: true });
    mkdirSync(join(other, 'docs'));
    symlinkSync(join(elsewhere, 'brand'), join(other, 'docs/brand'));
    expect(() => write({ to: other, from: first, remote: source })).toThrow('docs/brand is a symbolic link');
    expect(readdirSync(join(elsewhere, 'brand'))).toEqual([]);

    const wrong = run(target, '--write');
    expect(wrong.status).toBe(2);
    expect(wrong.stderr).toContain('Usage:');
    expect(run(target, '--check', '--write', '--from', source).status).toBe(2);
  });
});

describe('.gitignore and the .claude folder', () => {
  test('only the skills are ever tracked: local settings and worktrees under .claude are ignored', () => {
    const repo = mkdtempSync(join(tmpdir(), 'brand-sync-ignore-'));
    made.push(repo);
    git(repo, 'init', '-q');
    cpSync(join(ROOT, '.gitignore'), join(repo, '.gitignore'));
    put(repo, '.claude/settings.local.json', '{}\n');
    put(repo, '.claude/settings.json', '{}\n');
    put(repo, '.claude/worktrees/some-branch/README.md', '# a worktree\n');
    put(repo, '.claude/worktrees/some-branch/.claude/skills/automagik-brand/SKILL.md', 'a worktree\'s copy\n');
    put(repo, SKILL, 'the skill\n');
    put(repo, '.claude/skills/another/SKILL.md', 'another\n');
    git(repo, 'add', '-A', '.');
    expect(git(repo, 'ls-files').split('\n')).toEqual(['.claude/skills/another/SKILL.md', SKILL, '.gitignore']);
    expect(git(repo, 'status', '--porcelain', '-uall', '--ignored').split('\n').filter(line => line.startsWith('!! ')).map(line => line.slice(3)).sort()).toEqual([
      '.claude/settings.json', '.claude/settings.local.json',
      '.claude/worktrees/some-branch/.claude/skills/automagik-brand/SKILL.md', '.claude/worktrees/some-branch/README.md',
    ]);
  });
});
