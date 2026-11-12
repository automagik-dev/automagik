import { afterAll, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { FOLDERS, RECORD, SOURCE, TOOL, check, replaceFile, staleness, write } from './brand-sync.mjs';

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

  // The brand folders are copied whole, so tooling has no place in them. The font's rebuild script
  // was first merged under docs/brand/fonts/rebuild and was copied into Genie, Omni and Arca from
  // that commit; it is now in scripts/brand-font. A copy runs the tool it carries, so this test
  // runs the copy's own tool, not this checkout's.
  test("a copy that holds the old docs/brand/fonts/rebuild loses it at the next --write, never gains scripts/brand-font, and --check passes", () => {
    const old = ['rebuild.mjs', 'text.txt', 'package.json', 'package-lock.json'].map(name => `docs/brand/fonts/rebuild/${name}`);
    const { source, target } = repositories(source => {
      put(source, 'docs/brand/README.md', '# Brand\n');
      put(source, 'docs/brand/fonts/fredoka-latin.woff2', Buffer.from([0x77, 0x4f, 0x46, 0x32, 0x00, 0xff]));
      for (const path of old) put(source, path, `${path}\n`);
      put(source, SKILL, '---\nname: automagik-brand\n---\n');
      put(source, TOOL, readFileSync(join(ROOT, TOOL)));
    });
    const own = (...args: string[]) => spawnSync('node', [join(target, TOOL), ...args], { cwd: target, encoding: 'utf8', env: { ...process.env, GITHUB_ACTIONS: '' } });
    write({ to: target, from: source });
    for (const path of old) expect(existsSync(join(target, path))).toBe(true);
    commit(target, 'the brand copy, with the rebuild folder');

    mkdirSync(join(source, 'scripts/brand-font'));
    for (const path of old) git(source, 'mv', path, path === old[3] ? 'scripts/brand-font/bun.lock' : path.replace('docs/brand/fonts/rebuild', 'scripts/brand-font'));
    const moved = commit(source, 'the rebuild tooling leaves the brand folder');
    const wrote = own('--write', '--from', source, '--remote', source);
    expect(wrote.stderr).toBe('');
    expect(wrote.status).toBe(0);
    for (const path of old) expect(wrote.stdout).toContain(path);
    expect(existsSync(join(target, 'docs/brand/fonts/rebuild'))).toBe(false);
    expect(existsSync(join(target, 'docs/brand/fonts/fredoka-latin.woff2'))).toBe(true);
    expect(existsSync(join(target, 'scripts/brand-font'))).toBe(false);
    const record = JSON.parse(readFileSync(join(target, RECORD), 'utf8'));
    expect(record.commit).toBe(moved);
    expect(Object.keys(record.files)).toEqual(['.claude/skills/automagik-brand/SKILL.md', 'docs/brand/README.md', 'docs/brand/fonts/fredoka-latin.woff2', TOOL]);
    const checked = own('--check', '--remote', source);
    expect(checked.stderr).toBe('');
    expect(checked.status).toBe(0);
    expect(check({ to: target }).problems).toEqual([]);
  }, 60_000);

  test("Automagik's brand folders hold no package manifest, lockfile or installed packages: tooling lives under scripts/", () => {
    const tooling = /(^|\/)(package\.json|package-lock\.json|bun\.lock|bun\.lockb|yarn\.lock|pnpm-lock\.yaml|node_modules)(\/|$)/;
    const ours = FOLDERS.flatMap(folder => filesUnder(ROOT, folder));
    expect(ours).toContain('docs/brand/fonts/fredoka-latin.woff2');
    expect(ours.filter(path => tooling.test(path))).toEqual([]);
    // The font's rebuild is that tooling.
    expect(existsSync(join(ROOT, 'scripts/brand-font/rebuild.mjs'))).toBe(true);
    expect(existsSync(join(ROOT, 'scripts/brand-font/bun.lock'))).toBe(true);
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

  test('the record must list the README, the skill and the tool: a copy that drops one, with its lines, fails', () => {
    const { source, target } = small();
    write({ to: target, from: source });
    const whole = readFileSync(join(target, RECORD), 'utf8');
    const without = (path: string) => {
      const record = JSON.parse(whole);
      delete record.files[path];
      writeFileSync(join(target, RECORD), `${JSON.stringify(record, null, 2)}\n`);
    };
    // The skill folder and its line both go: every file still listed matches, and nothing unlisted is left.
    rmSync(join(target, '.claude'), { recursive: true });
    without(SKILL);
    expect(check({ to: target }).problems).toEqual([`${RECORD} does not list ${SKILL}`]);
    expect(run(target, '--check', '--remote', source).status).toBe(1);
    for (const path of ['docs/brand/README.md', TOOL]) {
      write({ to: target, from: source });
      rmSync(join(target, path));
      without(path);
      expect(check({ to: target }).problems).toEqual([`${RECORD} does not list ${path}`]);
    }
  });

  test('--write copies the commit: an edit in the checkout that is not committed is not copied, and a note says so', () => {
    const { source, target, first } = small();
    const clean = run(target, '--write', '--from', source, '--remote', source);
    expect(clean.status).toBe(0);
    expect(clean.stdout).not.toContain('not committed');

    writeFileSync(join(source, 'docs/brand/tokens/tokens.css'), ':root{--bt-main:#123456}\n');
    put(source, 'docs/brand/logo/untracked.svg', '<svg/>\n');
    const wrote = run(target, '--write', '--from', source, '--remote', source);
    expect(wrote.status).toBe(0);
    expect(wrote.stdout).toContain('brand-sync: note: that checkout has brand changes that are not committed. They were not copied: the copy is the commit.');
    expect(readFileSync(join(target, 'docs/brand/tokens/tokens.css'), 'utf8')).toBe(':root{--bt-main:#fff}\n');
    expect(existsSync(join(target, 'docs/brand/logo/untracked.svg'))).toBe(false);
    expect(JSON.parse(readFileSync(join(target, RECORD), 'utf8')).commit).toBe(first);
    expect(check({ to: target }).problems).toEqual([]);
    // An edit outside the brand is not the brand's business: no note.
    git(source, 'checkout', '-q', '--', 'docs/brand/tokens/tokens.css');
    rmSync(join(source, 'docs/brand/logo/untracked.svg'));
    writeFileSync(join(source, 'README.md'), '# automagik, edited\n');
    expect(run(target, '--write', '--from', source, '--remote', source).stdout).not.toContain('not committed');
  });

  test("a copy made from a commit that is not on dev is told so, and is never advised to copy dev over it", () => {
    const { source, target, first } = small();
    // A branch ahead of dev changes the brand; the copy is made from it.
    git(source, 'checkout', '-q', '-b', 'new-cream');
    put(source, 'docs/brand/tokens/tokens.css', ':root{--bt-main:#fffaf0}\n');
    const ahead = commit(source, 'a new cream, not merged yet');
    git(source, 'checkout', '-q', 'dev');
    const wrote = run(target, '--write', '--from', ahead, '--remote', source);
    expect(wrote.status).toBe(0);
    expect(staleness({ commit: ahead, remote: source })).toEqual({ state: 'apart', dev: first });
    for (const said of [wrote, run(target, '--check', '--remote', source)]) {
      expect(said.status).toBe(0);
      expect(said.stdout).toContain(`this copy's commit (${ahead.slice(0, 12)}) is not on Automagik's dev (${first})`);
      expect(said.stdout).not.toContain('--write --from');
      expect(said.stdout).not.toContain('Copy it again');
    }
    expect(run(target, '--check', '--remote', source).stdout).toContain('brand-sync: warning: ');

    // dev moves without the branch: still not on dev, still no advice to copy dev.
    put(source, 'docs/brand/README.md', '# Brand, edited on dev\n');
    const moved = commit(source, 'dev moves');
    expect(staleness({ commit: ahead, remote: source })).toEqual({ state: 'apart', dev: moved });
    // While a copy of dev's own older commit is behind: dev is ahead of it, and that one is advised.
    expect(staleness({ commit: first, remote: source })).toEqual({ state: 'behind', dev: moved });

    // The branch is merged: the copy's commit is on dev now. dev also holds the README edit, so it is ahead.
    git(source, 'merge', '-q', '--no-ff', '-m', 'merge the cream', 'new-cream');
    const merged = git(source, 'rev-parse', 'HEAD');
    expect(staleness({ commit: ahead, remote: source })).toEqual({ state: 'behind', dev: merged });
    const after = run(target, '--check', '--remote', source);
    expect(after.status).toBe(0);
    expect(after.stdout).toContain(`Copy it again: node scripts/brand-sync.mjs --write --from ${merged}`);
  });

  test("the look at dev and a commit's fetch use a scratch repository of their own: the target's refs, remotes and objects are untouched, and the scratch is gone", () => {
    const { source, target, first } = small();
    write({ to: target, from: source });
    commit(target, 'the copy');
    put(source, 'docs/brand/tokens/tokens.css', ':root{--bt-main:#fffaf0}\n');
    const newer = commit(source, 'a new cream');
    // The tool's own temp folder, so what it leaves there can be seen.
    const scratch = join(dirname(target), 'scratch');
    mkdirSync(scratch);
    const tool = (...args: string[]) => spawnSync('node', [join(ROOT, TOOL), ...args], { cwd: target, encoding: 'utf8', env: { ...process.env, GITHUB_ACTIONS: '', TMPDIR: scratch } });
    const gitState = () => [git(target, 'for-each-ref'), git(target, 'config', '--local', '--list'), git(target, 'count-objects', '-v'),
      String(existsSync(join(target, '.git/FETCH_HEAD'))), String(existsSync(join(target, '.git/shallow'))), readdirSync(join(target, '.git')).sort().join(' ')].join('\n--\n');
    const before = gitState();

    // Behind: the look runs both fetches (the two trees, then dev's commits).
    const checked = tool('--check', '--remote', source);
    expect(checked.status).toBe(0);
    expect(checked.stdout).toContain(`--write --from ${newer}`);
    expect(gitState()).toBe(before);
    expect(git(target, 'status', '--porcelain')).toBe('');
    expect(readdirSync(scratch)).toEqual([]);

    // --write from a commit id fetches that commit too, and the look runs again after it.
    const wrote = tool('--write', '--from', first, '--remote', source);
    expect(wrote.status).toBe(0);
    expect(wrote.stdout).toContain(`--write --from ${newer}`);
    expect(gitState()).toBe(before);
    expect(readdirSync(scratch)).toEqual([]);

    // A fetch that fails cleans up as well.
    const failed = tool('--write', '--from', '0'.repeat(40), '--remote', source);
    expect(failed.status).toBe(1);
    expect(failed.stderr).toContain('could not read 0000000000000000000000000000000000000000');
    expect(gitState()).toBe(before);
    expect(readdirSync(scratch)).toEqual([]);
  });

  test("git variables inherited from the caller cannot point the tool's git at the target: its objects, config, shallow file and index are unchanged", () => {
    const { source, target, first } = small();
    write({ to: target, from: source });
    commit(target, 'the copy');
    put(source, 'docs/brand/tokens/tokens.css', ':root{--bt-main:#fffaf0}\n');
    const newer = commit(source, 'a new cream');
    const base = dirname(target);
    const scratch = join(base, 'scratch');
    mkdirSync(scratch);
    // What a hook, a wrapper or a shell may have set. First the variables that name a repository's
    // parts, all pointing at the target; then the ones that change what git reads or reaches.
    const groups: Record<string, string>[] = [{
      GIT_DIR: join(target, '.git'), GIT_WORK_TREE: target, GIT_COMMON_DIR: join(target, '.git'),
      GIT_OBJECT_DIRECTORY: join(target, '.git/objects'), GIT_ALTERNATE_OBJECT_DIRECTORIES: join(target, '.git/objects'),
      GIT_INDEX_FILE: join(target, '.git/index'),
    }, {
      GIT_NAMESPACE: 'planted', GIT_CEILING_DIRECTORIES: base, GIT_CONFIG_GLOBAL: join(target, '.git/config'), GIT_CONFIG_NOSYSTEM: '1',
      // A url rewrite that would send every read of the remote to a folder that does not exist.
      GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: `url.${join(base, 'nowhere')}/.insteadOf`, GIT_CONFIG_VALUE_0: `${base}/`,
    }];
    /** Every file under the target's .git, with its bytes' sha256: objects, config, shallow, index, refs, FETCH_HEAD. */
    const gitFolder = () => Object.fromEntries(readdirSync(join(target, '.git'), { withFileTypes: true, recursive: true })
      .filter(entry => !entry.isDirectory())
      .map(entry => join(entry.parentPath, entry.name))
      .sort()
      .map(path => [path.slice(target.length + 1), sha256(readFileSync(path))]));
    const before = gitFolder();
    expect(Object.keys(before)).toContain('.git/config');
    expect(Object.keys(before).some(path => path.startsWith('.git/objects/'))).toBe(true);

    for (const inherited of groups) {
      const tool = (...args: string[]) => spawnSync('node', [join(ROOT, TOOL), ...args], { cwd: target, encoding: 'utf8', env: { ...process.env, GITHUB_ACTIONS: '', TMPDIR: scratch, ...inherited } });
      // The look runs both fetches. The target's .git first: not one file added, changed or removed.
      const checked = tool('--check', '--remote', source);
      expect(gitFolder()).toEqual(before);
      expect(existsSync(join(target, '.git/shallow'))).toBe(false);
      expect(readdirSync(scratch)).toEqual([]);
      // And it still saw the real remote: dev is ahead.
      expect(checked.stderr).toBe('');
      expect(checked.status).toBe(0);
      expect(checked.stdout).toContain(`Copy it again: node scripts/brand-sync.mjs --write --from ${newer}`);

      // A copy from a commit id (a third fetch), then from the checkout: the files change, the target's .git does not.
      const fromCommit = tool('--write', '--from', first, '--remote', source);
      expect(gitFolder()).toEqual(before);
      expect(fromCommit.stderr).toBe('');
      expect(fromCommit.status).toBe(0);
      expect(fromCommit.stdout).toContain(`copied 5 files from Automagik ${first}`);
      expect(readFileSync(join(target, 'docs/brand/tokens/tokens.css'), 'utf8')).toBe(':root{--bt-main:#fff}\n');
      const fromCheckout = tool('--write', '--from', source, '--remote', source);
      expect(gitFolder()).toEqual(before);
      expect(fromCheckout.status).toBe(0);
      expect(fromCheckout.stdout).toContain(`copied 5 files from Automagik ${newer}`);
      expect(readFileSync(join(target, 'docs/brand/tokens/tokens.css'), 'utf8')).toBe(':root{--bt-main:#fffaf0}\n');
      expect(readdirSync(scratch)).toEqual([]);
      // The source checkout was read, not written: no record there, and its own .git gained no shallow file.
      expect(existsSync(join(source, RECORD))).toBe(false);
      expect(existsSync(join(source, '.git/shallow'))).toBe(false);
      // Back to the first copy for the next group.
      write({ to: target, from: first, remote: source });
    }
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
    expect(warned.stdout).toContain(`::warning title=The brand copy is behind Automagik::the brand changed on Automagik's dev after this copy's commit`);
    expect(warned.stdout).toContain(`dev is at ${newer}. Copy it again: node scripts/brand-sync.mjs --write --from ${newer}`);
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
    // The reason is git's own first `fatal:` line, not the advice it prints after it.
    const why = staleness({ commit: first, remote: nowhere }).why;
    expect(why).toStartWith('fatal: ');
    expect(why).toContain('no-such-remote');
    expect(checked.stdout).toContain(`was skipped: ${why}`);
    expect(checked.stdout).not.toContain('and the repository exists');
  });

  test('--write refuses the source itself, a copy as the source and a commit older than the skill', () => {
    const { source, target } = small();
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

    const wrong = run(target, '--write');
    expect(wrong.status).toBe(2);
    expect(wrong.stderr).toContain('Usage:');
    expect(run(target, '--check', '--write', '--from', source).status).toBe(2);
  });
});

// A copy holds real folders and files only. A link planted in the repository that carries it must
// never make the tool write, or read, somewhere else (PR 1166, review finding H1).
describe('the brand copy tool and symbolic links', () => {
  const LINK = 'is a symbolic link: a copy holds real folders and files only';
  /** Every file and link under `folder`, with a file's bytes or a link's own text: a picture to compare. */
  const picture = (folder: string): Record<string, string> => Object.fromEntries(readdirSync(folder, { withFileTypes: true, recursive: true })
    .filter(entry => !entry.isDirectory() && !`${entry.parentPath}/`.includes('/.git/'))
    .map(entry => join(entry.parentPath, entry.name))
    .sort()
    .map(path => [path.slice(folder.length + 1), lstatSync(path).isSymbolicLink() ? 'a link' : sha256(readFileSync(path))]));
  /** A repository that carries a good copy, and a folder outside it holding files that must never change. */
  const carried = () => {
    const made = small();
    write({ to: made.target, from: made.source });
    commit(made.target, 'the copy');
    const outside = join(dirname(made.target), 'outside');
    put(outside, 'sentinel.txt', 'not the brand\n');
    return { ...made, outside };
  };

  test('a record that is a link: --write refuses, the file it points at keeps its bytes, and --check names the link', () => {
    const { source, target, outside } = carried();
    rmSync(join(target, RECORD));
    symlinkSync(join(outside, 'sentinel.txt'), join(target, RECORD));
    const before = { target: picture(target), outside: picture(outside) };

    expect(() => write({ to: target, from: source })).toThrow(`${RECORD} ${LINK}. Nothing was changed`);
    const wrote = run(target, '--write', '--from', source, '--remote', source);
    expect(wrote.status).toBe(1);
    expect(wrote.stderr).toContain(`brand-sync: ${RECORD} ${LINK}`);
    expect(readFileSync(join(outside, 'sentinel.txt'), 'utf8')).toBe('not the brand\n');
    expect({ target: picture(target), outside: picture(outside) }).toEqual(before);

    // The check does not read a record through a link, even one that points at a true record.
    expect(check({ to: target }).problems).toEqual([`${RECORD} ${LINK}`]);
    rmSync(join(target, RECORD));
    put(outside, 'SOURCE.json', git(target, 'show', `HEAD:${RECORD}`) + '\n');
    symlinkSync(join(outside, 'SOURCE.json'), join(target, RECORD));
    expect(check({ to: target }).problems).toEqual([`${RECORD} ${LINK}`]);
    const checked = run(target, '--check', '--remote', source);
    expect(checked.status).toBe(1);
    expect(checked.stderr).toContain(`brand-sync: ${RECORD} ${LINK}`);
  });

  test('a copied file that is a link: --write refuses with nothing changed, and --check names it even when the bytes match', () => {
    const { source, target, outside } = carried();
    const file = 'docs/brand/tokens/tokens.css';
    // The link points at a file with the very bytes the record holds: only the link gives it away.
    renameSync(join(target, file), join(outside, 'tokens.css'));
    symlinkSync(join(outside, 'tokens.css'), join(target, file));
    expect(check({ to: target }).problems).toEqual([`${file} ${LINK}`]);
    expect(run(target, '--check', '--remote', source).status).toBe(1);

    // The source moves on, so a write through the link would change the outside file.
    put(source, file, ':root{--bt-main:#fffaf0}\n');
    commit(source, 'a new cream');
    const before = { target: picture(target), outside: picture(outside) };
    expect(() => write({ to: target, from: source })).toThrow(`${file} ${LINK}. Nothing was changed`);
    expect(run(target, '--write', '--from', source, '--remote', source).status).toBe(1);
    expect(readFileSync(join(outside, 'tokens.css'), 'utf8')).toBe(':root{--bt-main:#fff}\n');
    expect({ target: picture(target), outside: picture(outside) }).toEqual(before);

    // The same for the skill and for the tool's own copy.
    for (const path of [SKILL, TOOL]) {
      const { source: from, target: to, outside: out } = carried();
      renameSync(join(to, path), join(out, 'moved'));
      symlinkSync(join(out, 'moved'), join(to, path));
      const was = { target: picture(to), outside: picture(out) };
      expect(() => write({ to, from })).toThrow(`${path} ${LINK}`);
      expect({ target: picture(to), outside: picture(out) }).toEqual(was);
      expect(check({ to }).problems).toEqual([`${path} ${LINK}`]);
    }
  });

  test('docs/brand itself, a folder inside it, or a folder on the way that is a link: refused, nothing outside written, and --check names it', () => {
    for (const folder of ['docs/brand', 'docs/brand/tokens', 'docs', '.claude', '.claude/skills/automagik-brand', 'scripts']) {
      const { source, target, outside } = carried();
      // The real folder moves outside and a link takes its place: every byte still matches the record.
      renameSync(join(target, folder), join(outside, 'moved'));
      symlinkSync(join(outside, 'moved'), join(target, folder));
      expect(check({ to: target }).problems).toEqual([`${folder} ${LINK}`]);
      expect(run(target, '--check', '--remote', source).status).toBe(1);

      put(source, 'docs/brand/tokens/tokens.css', ':root{--bt-main:#fffaf0}\n');
      put(source, SKILL, '---\nname: automagik-brand\n---\nRead the README.\n');
      put(source, 'docs/brand/logo/new.svg', '<svg/>\n');
      commit(source, 'the brand moves on');
      const before = { target: picture(target), outside: picture(outside) };
      expect(() => write({ to: target, from: source })).toThrow(`${folder} ${LINK}. Nothing was changed`);
      expect(run(target, '--write', '--from', source, '--remote', source).status).toBe(1);
      expect({ target: picture(target), outside: picture(outside) }).toEqual(before);
    }
  });

  test('a first copy into a repository where docs/brand is already a link is refused, and the linked folder stays empty', () => {
    const { source, target } = small();
    const outside = join(dirname(target), 'outside');
    mkdirSync(join(outside, 'brand'), { recursive: true });
    mkdirSync(join(target, 'docs'));
    symlinkSync(join(outside, 'brand'), join(target, 'docs/brand'));
    expect(() => write({ to: target, from: source })).toThrow(`docs/brand ${LINK}. Nothing was changed`);
    expect(readdirSync(join(outside, 'brand'))).toEqual([]);
    expect(existsSync(join(target, '.claude'))).toBe(false);
    expect(existsSync(join(target, 'scripts'))).toBe(false);
  });

  test('a stale link inside the copy is refused too, not followed and not silently removed', () => {
    const { source, target, outside } = carried();
    symlinkSync(join(outside, 'sentinel.txt'), join(target, 'docs/brand/old-note.md'));
    expect(check({ to: target }).problems).toEqual([`docs/brand/old-note.md ${LINK}`]);
    const before = { target: picture(target), outside: picture(outside) };
    expect(() => write({ to: target, from: source })).toThrow(`docs/brand/old-note.md ${LINK}`);
    expect({ target: picture(target), outside: picture(outside) }).toEqual(before);
  });

  test('the writer itself: a rename over the path, never a write through a link, and never into a folder that resolves outside', () => {
    const { target, outside } = carried();
    // Past the checks (called alone): a link at the path is replaced by the file; what it pointed at keeps its bytes.
    symlinkSync(join(outside, 'sentinel.txt'), join(target, 'docs/brand/late.md'));
    replaceFile(target, 'docs/brand/late.md', 'the new bytes\n');
    expect(lstatSync(join(target, 'docs/brand/late.md')).isFile()).toBe(true);
    expect(readFileSync(join(target, 'docs/brand/late.md'), 'utf8')).toBe('the new bytes\n');
    expect(readFileSync(join(outside, 'sentinel.txt'), 'utf8')).toBe('not the brand\n');
    // No file beside it is left behind.
    expect(readdirSync(join(target, 'docs/brand')).filter(name => name.startsWith('.brand-sync-'))).toEqual([]);

    // Past the checks: a folder on the way that leads outside is refused, and nothing lands there.
    mkdirSync(join(outside, 'folder'));
    symlinkSync(join(outside, 'folder'), join(target, 'docs/brand/linked'));
    expect(() => replaceFile(target, 'docs/brand/linked/file.md', 'x\n')).toThrow('resolves outside this repository');
    expect(readdirSync(join(outside, 'folder'))).toEqual([]);
  });

  test('the writer makes no folder before its checks: a missing parent beneath a link is not created, outside or inside', () => {
    const { target, outside } = carried();
    // Beneath a link that leads outside: the folders that are missing must not appear there.
    mkdirSync(join(outside, 'folder'));
    symlinkSync(join(outside, 'folder'), join(target, 'docs/brand/linked'));
    expect(() => replaceFile(target, 'docs/brand/linked/new/deeper/file.md', 'x\n')).toThrow('docs/brand/linked/new/deeper/file.md resolves outside this repository');
    expect(readdirSync(join(outside, 'folder'))).toEqual([]);

    // Beneath a link that stays inside the repository: containment holds, the link is still refused, and nothing is made.
    mkdirSync(join(target, 'elsewhere'));
    symlinkSync(join(target, 'elsewhere'), join(target, 'docs/brand/inner'));
    expect(() => replaceFile(target, 'docs/brand/inner/new/file.md', 'x\n')).toThrow('docs/brand/inner is a symbolic link');
    expect(readdirSync(join(target, 'elsewhere'))).toEqual([]);

    // A link that leads nowhere is refused as well.
    symlinkSync(join(outside, 'gone'), join(target, 'docs/brand/dangling'));
    expect(() => replaceFile(target, 'docs/brand/dangling/new/file.md', 'x\n')).toThrow('resolves outside this repository');
    expect(existsSync(join(outside, 'gone'))).toBe(false);

    // With real folders all the way, the missing ones are made and the file is written.
    replaceFile(target, 'docs/brand/a/b/file.md', 'made\n');
    expect(readFileSync(join(target, 'docs/brand/a/b/file.md'), 'utf8')).toBe('made\n');
  });

  test('a repository reached through a link is still its real folder: the copy is written and checks', () => {
    const { source, target } = small();
    const alias = join(dirname(target), 'alias');
    symlinkSync(target, alias);
    write({ to: alias, from: source });
    expect(check({ to: alias }).problems).toEqual([]);
    expect(check({ to: target }).problems).toEqual([]);
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
