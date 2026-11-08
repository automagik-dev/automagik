// #714: the plugin lane runs lint only when package.json has a lint script. gate_plugin and its
// step/judge helpers are extracted from remote-gate.sh and run as written against fixture apps: a
// no-lint app with green tests gates green, a lint script is still invoked, and a failing lint
// still fails the gate. The fixture's bun is a stand-in; the full remote run is not exercised.
import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const source = readFileSync(join(import.meta.dir, 'remote-gate.sh'), 'utf8');
const work = mkdtempSync(join(tmpdir(), 'remote-gate-lint-'));
afterAll(() => rmSync(work, { recursive: true, force: true }));

// One function body, from its name to its closing brace in the first column.
function fn(name: string): string {
  const start = source.indexOf(`${name}() {`);
  const end = source.indexOf('\n}\n', start);
  if (start < 0 || end < 0) throw new Error(`remote-gate.sh has no ${name}()`);
  return source.slice(start, end + 3);
}

const BUN = `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$CALLS"
case "$1 $2" in
  'install --frozen-lockfile') exit 0 ;;
  'run lint') exit "$LINT_EXIT" ;;
  'run test')
    printf '%s\\n' 'TAP version 13' '1..2' 'ok 1 - one' 'ok 2 - two' \\
      '# tests 2' '# pass 2' '# fail 0' '# skipped 0' '# todo 0' '# cancelled 0'
    exit 0
    ;;
esac
exit 0
`;

let runs = 0;
function gate(packageJson: Record<string, unknown>, lintExit = 0) {
  const dir = join(work, `gate-${runs++}`);
  const app = join(dir, 'apps', 'fixture');
  const bin = join(dir, 'bin');
  const calls = join(dir, 'calls');
  mkdirSync(join(app, 'test'), { recursive: true });
  mkdirSync(bin);
  mkdirSync(join(dir, 'logs'));
  writeFileSync(join(app, 'package.json'), JSON.stringify(packageJson));
  writeFileSync(join(app, 'test', 'fixture.test.js'), '');
  writeFileSync(join(bin, 'node'), '#!/usr/bin/env bash\necho v22.0.0\n');
  writeFileSync(join(bin, 'bun'), BUN);
  chmodSync(join(bin, 'node'), 0o755);
  chmodSync(join(bin, 'bun'), 0o755);

  const harness = join(dir, 'harness.sh');
  writeFileSync(harness, `set -euo pipefail
say() { printf 'remote-gate: %s\\n' "$*"; }
die() { say "$*" >&2; exit 1; }
node_bin() { printf '%s\\n' "$FAKE_BIN"; }
browser() { :; }
${fn('step')}
${fn('node_counts')}
${fn('judge')}
${fn('gate_plugin')}
wt=$PWD
app=fixture
plugin_node=24.9
logs=$PWD/logs
failed=0
summary=()
gate_plugin
printf 'gate failed=%s\\n' "$failed"
exit "$failed"
`);
  const result = spawnSync('bash', [harness], {
    cwd: dir,
    encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '', FAKE_BIN: bin, CALLS: calls, LINT_EXIT: String(lintExit) },
  });
  let called: string[] = [];
  try {
    called = readFileSync(calls, 'utf8').trim().split('\n').filter(Boolean);
  } catch {
    // No bun call at all leaves no log; the assertions below report that.
  }
  return { ...result, calls: called };
}

describe('the plugin gate lint step (#714)', () => {
  test('an app without a lint script says skipped and gates green on green tests', () => {
    const result = gate({ name: 'fixture', scripts: { test: 'node --test' } });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('remote-gate: lint skipped (no lint script)');
    expect(result.stdout).toContain('tests=2 pass=2 fail=0');
    expect(result.stdout).toContain('gate failed=0');
    expect(result.calls).not.toContain('run lint');
    expect(result.calls).toContain('run test');
  });

  test('an app with a lint script still runs it', () => {
    const fixture = { name: 'fixture', scripts: { lint: 'node lint.js', test: 'node --test' } };
    const result = gate(fixture);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('step lint: exit 0');
    expect(result.stdout).not.toContain('lint skipped');
    expect(result.calls).toContain('run lint');
    expect(result.calls).toContain('run test');
  });

  test('a failing lint still fails the gate while the tests are green', () => {
    const fixture = { name: 'fixture', scripts: { lint: 'node lint.js', test: 'node --test' } };
    const result = gate(fixture, 1);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('step lint: exit 1');
    expect(result.stdout).toContain('tests=2 pass=2 fail=0');
    expect(result.stdout).toContain('gate failed=1');
  });
});
