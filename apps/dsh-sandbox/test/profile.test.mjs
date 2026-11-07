// Hermetic tests for bin/dsh-sandbox.mjs: every profile is a temp file shaped like the live
// dsh-tui profile (a YAML list), every wrapper a temp executable. The live profile is never read
// or written. The helper writes one managed block, backs it up, and check reads only.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  BEGIN,
  checkRow,
  FAILURE_SIGNATURE,
  defaultProfile,
  END,
  findManaged,
  installRow,
  PLACEHOLDER,
  sandboxBlock,
} from '../bin/dsh-sandbox.mjs';
import { MSG_PREFIX } from '../bin/hc-socket-mask.mjs';

const HELPER = fileURLToPath(new URL('../bin/dsh-sandbox.mjs', import.meta.url));

/** A dsh-tui profile patch like the live one: a YAML list of rows. */
const PROFILE = [
  '# a dsh-tui profile patch',
  '- id: sandbox-policy',
  '  config:',
  '    mode: workspace-write',
  '    workspaceRoot: !!js process.cwd()',
  '- id: approval',
  '  config:',
  '    policy: never',
  '',
].join('\n');

const roots = [];
after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function makeFixture() {
  const root = mkdtempSync(join(tmpdir(), 'dsh-sandbox-profile-'));
  roots.push(root);
  const dir = join(root, 'profiles', 'dsh-tui');
  mkdirSync(dir, { recursive: true });
  const profile = join(dir, 'cordis.patch.yml');
  writeFileSync(profile, PROFILE);
  const wrapper = join(root, 'hc-socket-mask.mjs');
  writeFileSync(wrapper, '#!/usr/bin/env node\n', { mode: 0o755 });
  return { root, dir, profile, wrapper };
}

function backupsOf(profile) {
  const prefix = `${basename(profile)}.dsh-sandbox-backup-`;
  return readdirSync(dirname(profile)).filter((name) => name.startsWith(prefix));
}

function runHelper(args, env = process.env) {
  return spawnSync(process.execPath, [HELPER, ...args], { env, encoding: 'utf8' });
}

test('the managed block carries the wrapper path and the failure signature', () => {
  const block = sandboxBlock("/tmp/a b/hc's-wrapper.mjs");
  assert.ok(block.startsWith(`${BEGIN}\n`));
  assert.ok(block.endsWith(`\n${END}`));
  assert.match(block, /^- id: sandbox$/m);
  assert.match(block, /^ {2}config:$/m);
  assert.ok(block.includes("runnerCommand: ['/tmp/a b/hc''s-wrapper.mjs']"));
  assert.ok(block.includes("runnerFailureSignatures: ['hc-socket-mask: ']"));
  assert.equal(block.split(BEGIN).length - 1, 1);
});

test('install writes one managed row and backs the profile up byte for byte', () => {
  const fixture = makeFixture();
  const now = new Date('2026-11-07T20:15:36.123Z');
  const result = installRow({ profile: fixture.profile, wrapper: fixture.wrapper, now });
  assert.equal(result.changed, true);
  assert.equal(result.wrapper, fixture.wrapper);
  assert.equal(result.backup, `${fixture.profile}.dsh-sandbox-backup-2026-11-07T20-15-36-123Z`);
  const text = readFileSync(fixture.profile, 'utf8');
  assert.ok(text.startsWith(PROFILE));
  assert.equal(text.split(BEGIN).length - 1, 1);
  assert.equal(text.split(END).length - 1, 1);
  assert.ok(text.includes(`runnerCommand: ['${fixture.wrapper}']`));
  assert.ok(text.includes("runnerFailureSignatures: ['hc-socket-mask: ']"));
  assert.ok(text.endsWith('\n'));
  assert.equal(readFileSync(result.backup, 'utf8'), PROFILE);
  // The original rows still apply: the block is appended, not a replacement of the file.
  assert.match(text, /- id: sandbox-policy/);
  assert.match(text, /- id: approval/);
  assert.deepEqual(checkRow({ profile: fixture.profile, wrapper: fixture.wrapper }), {
    ok: true,
    message: `the sandbox row in ${fixture.profile} matches ${fixture.wrapper}`,
  });
});

test('re-install is idempotent: one block, no second backup, no rewrite', () => {
  const fixture = makeFixture();
  installRow({ profile: fixture.profile, wrapper: fixture.wrapper, now: new Date(1) });
  const first = readFileSync(fixture.profile, 'utf8');
  const second = installRow({
    profile: fixture.profile,
    wrapper: fixture.wrapper,
    now: new Date(2),
  });
  assert.equal(second.changed, false);
  assert.equal(second.backup, null);
  assert.equal(readFileSync(fixture.profile, 'utf8'), first);
  assert.equal(findManaged(first).begins.length, 1);
  assert.equal(backupsOf(fixture.profile).length, 1);
});

test('install into a profile that does not exist creates it with only the row', () => {
  const fixture = makeFixture();
  const profile = join(fixture.dir, 'fresh.yml');
  const result = installRow({ profile, wrapper: fixture.wrapper, now: new Date(1) });
  assert.equal(result.changed, true);
  assert.equal(result.backup, null);
  assert.equal(readFileSync(profile, 'utf8'), `${sandboxBlock(fixture.wrapper)}\n`);
  assert.equal(checkRow({ profile, wrapper: fixture.wrapper }).ok, true);
});

test('check fails when no managed row is there, and never writes', () => {
  const fixture = makeFixture();
  const result = checkRow({ profile: fixture.profile, wrapper: fixture.wrapper });
  assert.equal(result.ok, false);
  assert.match(result.message, /no managed dsh-sandbox block/);
  assert.equal(readFileSync(fixture.profile, 'utf8'), PROFILE);
  assert.deepEqual(backupsOf(fixture.profile), []);
});

test('check fails on an altered row and on a different wrapper path', () => {
  const fixture = makeFixture();
  installRow({ profile: fixture.profile, wrapper: fixture.wrapper, now: new Date(1) });
  const installed = readFileSync(fixture.profile, 'utf8');
  writeFileSync(fixture.profile, installed.replace(
    "runnerFailureSignatures: ['hc-socket-mask: ']",
    'runnerFailureSignatures: []',
  ));
  const altered = checkRow({ profile: fixture.profile, wrapper: fixture.wrapper });
  assert.equal(altered.ok, false);
  assert.match(altered.message, /altered row or a different wrapper path/);
  writeFileSync(fixture.profile, installed);
  const other = join(fixture.root, 'other-wrapper.mjs');
  writeFileSync(other, '#!/usr/bin/env node\n', { mode: 0o755 });
  const different = checkRow({ profile: fixture.profile, wrapper: other });
  assert.equal(different.ok, false);
  // The file check compares did not change the profile.
  assert.equal(readFileSync(fixture.profile, 'utf8'), installed);
});

test('a duplicated or broken marker pair is refused, never collapsed', () => {
  const fixture = makeFixture();
  installRow({ profile: fixture.profile, wrapper: fixture.wrapper, now: new Date(1) });
  const installed = readFileSync(fixture.profile, 'utf8');
  writeFileSync(fixture.profile, `${installed}\n${sandboxBlock(fixture.wrapper)}\n`);
  const duplicated = checkRow({ profile: fixture.profile, wrapper: fixture.wrapper });
  assert.equal(duplicated.ok, false);
  assert.match(duplicated.message, /keep exactly one block/);
  assert.throws(
    () => installRow({ profile: fixture.profile, wrapper: fixture.wrapper }),
    /keep exactly one block/,
  );
  writeFileSync(fixture.profile, installed.replace(`\n${END}\n`, '\n'));
  const broken = checkRow({ profile: fixture.profile, wrapper: fixture.wrapper });
  assert.equal(broken.ok, false);
  assert.match(broken.message, /end markers/);
});

test('install refuses a missing or non-executable wrapper and leaves the profile alone', () => {
  const fixture = makeFixture();
  assert.throws(
    () => installRow({ profile: fixture.profile, wrapper: join(fixture.root, 'absent.mjs') }),
    /does not exist/,
  );
  chmodSync(fixture.wrapper, 0o644);
  assert.throws(
    () => installRow({ profile: fixture.profile, wrapper: fixture.wrapper }),
    /not executable/,
  );
  assert.equal(readFileSync(fixture.profile, 'utf8'), PROFILE);
  assert.deepEqual(backupsOf(fixture.profile), []);
});

test('the default profile is $DSH_HOME/profiles/dsh-tui/cordis.patch.yml (~/.dsh)', () => {
  assert.equal(defaultProfile({ DSH_HOME: '/opt/dsh', HOME: '/home/a' }),
    '/opt/dsh/profiles/dsh-tui/cordis.patch.yml');
  assert.equal(defaultProfile({ HOME: '/home/a' }),
    '/home/a/.dsh/profiles/dsh-tui/cordis.patch.yml');
  assert.equal(defaultProfile({ DSH_HOME: '/opt/dsh' }),
    '/opt/dsh/profiles/dsh-tui/cordis.patch.yml');
});

test('the CLI installs and checks a temp profile, and exits 0/1 with one clear line', () => {
  const fixture = makeFixture();
  const install = runHelper([
    'install', '--profile', fixture.profile, '--wrapper', fixture.wrapper,
  ]);
  assert.equal(install.status, 0, install.stderr);
  const installLine = install.stdout.trim().split('\n');
  assert.equal(installLine.length, 1);
  assert.ok(installLine[0].startsWith('dsh-sandbox: '));
  assert.ok(installLine[0].includes(fixture.profile));

  const check = runHelper(['check', '--profile', fixture.profile, '--wrapper', fixture.wrapper]);
  assert.equal(check.status, 0, check.stderr);
  assert.equal(check.stdout.trim().split('\n').length, 1);

  writeFileSync(fixture.profile, PROFILE);
  const missing = runHelper(['check', '--profile', fixture.profile, '--wrapper', fixture.wrapper]);
  assert.equal(missing.status, 1);
  const failure = missing.stderr.trim().split('\n');
  assert.equal(failure.length, 1);
  assert.ok(failure[0].startsWith('dsh-sandbox: '));

  const usage = runHelper(['bogus']);
  assert.equal(usage.status, 2);
});

test('the shipped profile row snippet is OFF by default and carries the placeholder', () => {
  const snippet = readFileSync(new URL('../profile/sandbox-row.yml', import.meta.url), 'utf8');
  assert.match(snippet, /^- id: sandbox$/m);
  assert.match(snippet, /^ {2}config:$/m);
  assert.ok(snippet.includes(`runnerCommand: ['${PLACEHOLDER}']`));
  assert.ok(snippet.includes("runnerFailureSignatures: ['hc-socket-mask: ']"));
  assert.doesNotMatch(snippet, /danger-full-access|workspace-write/);
  // The helper and the snippet are one row: only the markers (the helper's) are extra.
  const rows = snippet.split('\n').filter((line) => line.trim() && !line.trim().startsWith('#'));
  const blockRows = sandboxBlock(PLACEHOLDER).split('\n')
    .filter((line) => line !== BEGIN && line !== END);
  assert.deepEqual(rows, blockRows);
  // The runner's own prefix is the row's failure signature, so DSH reports it as a runner failure.
  assert.equal(MSG_PREFIX, FAILURE_SIGNATURE);
});
