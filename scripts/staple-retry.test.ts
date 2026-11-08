// scripts/staple-retry.sh (#673): the mac leg's staple/validate round-trip, run as written with a
// fake xcrun and a fake sleep first on PATH. Nothing here waits a real second: the fake sleep
// records the wait and returns at once, so the test asserts the delays Apple's transient network
// errors earn, the order they precede the re-staple pass in, and that no other failure retries.
import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const SCRIPT = join(import.meta.dir, 'staple-retry.sh');
const ROOT = resolve(import.meta.dir, '..');
const WORKFLOW = join(ROOT, '.github/workflows/desktop-build.yml');
const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

interface Reply {
  status?: number;
  output?: string;
}

const ok = (): Reply => ({ status: 0 });
const fail = (output: string, status = 68): Reply => ({ status, output });
const nsurl = (code: number, text = 'The network connection was lost.') =>
  `Error Domain=NSURLErrorDomain Code=${code} "${text}" UserInfo={NSLocalizedDescription=${text}}`;

// xcrun answers from a numbered plan (status line, then output) and logs its whole argv; sleep
// logs its argument and returns immediately. Both append to one event log, so the waits are
// proven to sit between the attempts and before the re-staple, not merely to have happened.
const XCRUN = `#!/usr/bin/env bash
set -u
printf '%s\\n' "$*" >> "\${STAPLE_TEST_CALLS:?}"
printf 'xcrun %s\\n' "$*" >> "\${STAPLE_TEST_EVENTS:?}"
count=0
if [[ -f \${STAPLE_TEST_STATE:?}/count ]]; then
  count=$(<"\${STAPLE_TEST_STATE}/count")
fi
count=$((count + 1))
printf '%s\\n' "\${count}" > "\${STAPLE_TEST_STATE}/count"
reply="\${STAPLE_TEST_PLAN:?}/\${count}"
if [[ ! -f \${reply} ]]; then
  printf 'fake xcrun: unexpected call %s: %s\\n' "\${count}" "$*" >&2
  exit 97
fi
status=$(sed -n '1p' "\${reply}")
output=$(sed -n '2,$p' "\${reply}")
if [[ -n \${output} ]]; then
  printf '%b\\n' "\${output}" >&2
fi
exit "\${status}"
`;

const SLEEP = `#!/usr/bin/env bash
set -u
printf '%s\\n' "$*" >> "\${STAPLE_TEST_SLEEPS:?}"
printf 'sleep %s\\n' "$*" >> "\${STAPLE_TEST_EVENTS:?}"
exit 0
`;

const readLines = (path: string): string[] => {
  try {
    const text = readFileSync(path, 'utf8');
    return text ? text.replace(/\n$/, '').split('\n') : [];
  } catch {
    return [];
  }
};

function harness() {
  const dir = mkdtempSync(join(tmpdir(), 'staple-retry-test-'));
  dirs.push(dir);
  const bin = join(dir, 'bin');
  const state = join(dir, 'state');
  const plan = join(dir, 'plan');
  mkdirSync(bin);
  mkdirSync(state);
  mkdirSync(plan);
  writeFileSync(join(bin, 'xcrun'), XCRUN);
  writeFileSync(join(bin, 'sleep'), SLEEP);
  chmodSync(join(bin, 'xcrun'), 0o755);
  chmodSync(join(bin, 'sleep'), 0o755);

  const artifact = join(dir, 'Automagik-9.9.9-arm64.dmg');
  writeFileSync(artifact, 'already notarized dmg bytes\n');
  const callsPath = join(dir, 'calls.log');
  const sleepsPath = join(dir, 'sleeps.log');
  const eventsPath = join(dir, 'events.log');
  for (const path of [callsPath, sleepsPath, eventsPath]) writeFileSync(path, '');

  return {
    artifact,
    run(replies: Reply[], delays?: string, artifactPath = artifact) {
      replies.forEach((reply, index) => {
        writeFileSync(join(plan, String(index + 1)), `${reply.status ?? 0}\n${reply.output ?? ''}`);
      });
      const env: Record<string, string> = {
        PATH: `${bin}:${process.env.PATH ?? '/usr/bin:/bin'}`,
        LC_ALL: 'C',
        STAPLE_TEST_CALLS: callsPath,
        STAPLE_TEST_SLEEPS: sleepsPath,
        STAPLE_TEST_EVENTS: eventsPath,
        STAPLE_TEST_STATE: state,
        STAPLE_TEST_PLAN: plan,
      };
      if (delays !== undefined) env.STAPLE_RETRY_DELAYS = delays;
      const result = spawnSync('bash', [SCRIPT, artifactPath], { encoding: 'utf8', env, timeout: 20_000 });
      return {
        status: result.status,
        error: result.error?.message,
        stdout: result.stdout ?? '',
        stderr: result.stderr ?? '',
        out: `${result.stdout ?? ''}${result.stderr ?? ''}`,
        calls: readLines(callsPath),
        sleeps: readLines(sleepsPath),
        events: readLines(eventsPath),
      };
    },
  };
}

const staple = (artifact: string) => `xcrun stapler staple ${artifact}`;
const validate = (artifact: string) => `xcrun stapler validate ${artifact}`;
const roundTrip = (artifact: string): Reply[] => [ok(), ok()];
// One transient failure on validate, then a successful round trip.
const oneTransient = (code: number): Reply[] => [ok(), fail(nsurl(code)), ok(), ok()];

describe('the first attempt succeeds', () => {
  test('staple then validate, exit 0, no wait', () => {
    const h = harness();
    const run = h.run(roundTrip(h.artifact));
    expect(run.status).toBe(0);
    expect(run.sleeps).toEqual([]);
    expect(run.events).toEqual([staple(h.artifact), validate(h.artifact)]);
    expect(run.out).toContain('attempt 1/3 succeeded: staple and validate');
  });
});

describe('a transient NSURLErrorDomain failure is retried after 10 s', () => {
  for (const code of [-1001, -1004, -1005, -1009]) {
    test(`Code=${code} then success: the round-trip retries`, () => {
      const h = harness();
      const run = h.run(oneTransient(code));
      expect(run.status).toBe(0);
      expect(run.sleeps).toEqual(['10']);
      expect(run.events).toEqual([
        staple(h.artifact),
        validate(h.artifact),
        'sleep 10',
        staple(h.artifact),
        validate(h.artifact),
      ]);
      expect(run.out).toContain("attempt 1/3 failed at 'stapler validate' (exit 68)");
      expect(run.out).toContain('parsed Domain=NSURLErrorDomain Code=' + code);
      expect(run.out).toContain('transient network failure; retrying in 10s');
      expect(run.out).toContain('attempt 2/3 succeeded: staple and validate');
    });
  }

  test('the parenthesized `(NSURLErrorDomain error -1005.)` form parses and retries', () => {
    const h = harness();
    const run = h.run([ok(), fail('(NSURLErrorDomain error -1005.)'), ok(), ok()]);
    expect(run.status).toBe(0);
    expect(run.sleeps).toEqual(['10']);
    expect(run.out).toContain('parsed Domain=NSURLErrorDomain Code=-1005');
  });

  test('a transient failure on staple, not validate, still retries the whole round-trip', () => {
    const h = harness();
    const run = h.run([fail(nsurl(-1005)), ok(), ok()]);
    expect(run.status).toBe(0);
    expect(run.sleeps).toEqual(['10']);
    expect(run.out).toContain("failed at 'stapler staple'");
  });
});

describe('three transient failures then one re-staple pass', () => {
  const threeTransient = (): Reply[] => [
    ok(), fail(nsurl(-1005)),
    ok(), fail(nsurl(-1005)),
    ok(), fail(nsurl(-1005)),
  ];

  test('a successful re-staple pass waits 10, 30, 90 s in order and exits 0', () => {
    const h = harness();
    const run = h.run([...threeTransient(), ok(), ok()]);
    expect(run.status).toBe(0);
    expect(run.sleeps).toEqual(['10', '30', '90']);
    expect(run.events).toEqual([
      staple(h.artifact), validate(h.artifact), 'sleep 10',
      staple(h.artifact), validate(h.artifact), 'sleep 30',
      staple(h.artifact), validate(h.artifact), 'sleep 90',
      staple(h.artifact), validate(h.artifact),
    ]);
    expect(run.out).toContain('waiting 90s, then one re-staple pass');
    expect(run.out).toContain('re-staple pass succeeded: staple and validate');
  });

  test('the re-staple pass fails at staple: nonzero, after 10 30 90 s', () => {
    const h = harness();
    const run = h.run([...threeTransient(), fail(nsurl(-1005))]);
    expect(run.status).not.toBe(0);
    expect(run.sleeps).toEqual(['10', '30', '90']);
    expect(run.out).toContain('re-staple pass failed at \'stapler staple\'');
    expect(run.out).toContain('giving up after 3 transient attempts and one re-staple pass');
  });

  test('the re-staple pass fails at validate: nonzero, after 10 30 90 s', () => {
    const h = harness();
    const run = h.run([...threeTransient(), ok(), fail(nsurl(-1005))]);
    expect(run.status).not.toBe(0);
    expect(run.sleeps).toEqual(['10', '30', '90']);
    expect(run.out).toContain('re-staple pass failed at \'stapler validate\'');
  });
});

describe('a failure that is not transient fails on the first response', () => {
  const firstResponse = (name: string, output: string, status = 68) => {
    test(name, () => {
      const h = harness();
      const run = h.run([ok(), fail(output, status), ok(), ok()]);
      expect(run.status).not.toBe(0);
      expect(run.sleeps).toEqual([]);
      expect(run.events).toEqual([staple(h.artifact), validate(h.artifact)]);
      expect(run.out).toContain('failing on the first response, not retrying');
    });
  };

  for (const code of [-2, -3, -22000]) {
    firstResponse(`Code=${code} alone`, nsurl(code));
  }
  firstResponse('status: Invalid beside a transient -1005', `${nsurl(-1005)}\nstatus: Invalid`);
  firstResponse('another domain', 'Error Domain=NSCocoaErrorDomain Code=-1005 "no"');
  firstResponse('a mixed transient and non-transient pair', `${nsurl(-1005)}\nError Domain=NSURLErrorDomain Code=-2`);
  firstResponse('free text only', 'The network connection was lost. (NSURLErrorDomain -1005)');
  firstResponse('a missing code', 'Error Domain=NSURLErrorDomain');
  firstResponse('empty output', '');
});

describe('STAPLE_RETRY_DELAYS', () => {
  test('"0 0 0" overrides the default waits with three 0 s sleeps', () => {
    const h = harness();
    const three = [ok(), fail(nsurl(-1005)), ok(), fail(nsurl(-1005)), ok(), fail(nsurl(-1005))];
    const run = h.run([...three, ok(), ok()], '0 0 0');
    expect(run.status).toBe(0);
    expect(run.sleeps).toEqual(['0', '0', '0']);
  });

  for (const delays of ['10 30', '10 30 90 120', '10 30 soon', '10 -30 90']) {
    test(`an invalid override (${JSON.stringify(delays)}) exits nonzero before any xcrun call`, () => {
      const h = harness();
      const run = h.run([], delays);
      expect(run.status).not.toBe(0);
      expect(run.calls).toEqual([]);
      expect(run.sleeps).toEqual([]);
    });
  }
});

// The mac leg runs from the desktop build job, whose working directory is apps/desktop, so a
// bare `scripts/staple-retry.sh` resolves inside apps/desktop (the FIX-FIRST that moved the call
// to ${GITHUB_WORKSPACE}). This resolves the invocation the way the shell would — the workspace
// root when it is anchored with ${GITHUB_WORKSPACE}, else the job's working directory — and
// proves the file it names exists and is executable, while the bare relative form exists nowhere.
function workflowInvocation() {
  const lines = readFileSync(WORKFLOW, 'utf8').split('\n');
  const at = lines.findIndex((line) => /staple-retry\.sh/.test(line));
  expect(at).toBeGreaterThan(-1);
  const token = /(?:"([^"]*staple-retry\.sh)"|'([^']*staple-retry\.sh)'|(\S*staple-retry\.sh))/.exec(lines[at] ?? '');
  const script = token?.[1] ?? token?.[2] ?? token?.[3] ?? '';
  expect(script).not.toBe('');
  // The job that owns the step: the nearest preceding two-space job key, to the next one.
  let start = -1;
  for (let i = at; i >= 0; i--) {
    if (/^ {2}[A-Za-z0-9_-]+:$/.test(lines[i] ?? '')) {
      start = i;
      break;
    }
  }
  expect(start).toBeGreaterThan(-1);
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^ {2}[A-Za-z0-9_-]+:$/.test(lines[i] ?? '')) {
      end = i;
      break;
    }
  }
  const job = lines.slice(start, end);
  const workingDirectory =
    job
      .find((line) => /working-directory:/.test(line))
      ?.split(':')
      .slice(1)
      .join(':')
      .trim() ?? '.';
  const anchored = script.startsWith('${GITHUB_WORKSPACE}/');
  const resolved = anchored
    ? resolve(ROOT, script.slice('${GITHUB_WORKSPACE}/'.length))
    : resolve(ROOT, workingDirectory, script);
  return { script, workingDirectory, anchored, resolved };
}

describe('the workflow calls the script through a path that resolves from the job cwd', () => {
  test('the resolved invocation exists and is executable', () => {
    const { workingDirectory, resolved } = workflowInvocation();
    expect(workingDirectory).toBe('apps/desktop');
    expect(resolved).toBe(join(ROOT, 'scripts/staple-retry.sh'));
    expect(existsSync(resolved)).toBe(true);
    expect(statSync(resolved).mode & 0o111).not.toBe(0);
    // The pre-fix form — the same name resolved from the job's cwd — is a different, absent
    // file; if the invocation ever loses its anchor, `resolved` becomes that path instead.
    expect(existsSync(resolve(ROOT, workingDirectory, 'scripts/staple-retry.sh'))).toBe(false);
  });

  test('notarytool stays outside the retry and spctl/restamp/blockmap follow it', () => {
    const text = readFileSync(WORKFLOW, 'utf8');
    const at = (needle: string) => text.indexOf(needle);
    const script = at('staple-retry.sh');
    expect(script).toBeGreaterThan(-1);
    expect(at('notarytool submit')).toBeGreaterThan(-1);
    expect(at('notarytool submit')).toBeLessThan(script);
    for (const after of ['spctl --assess', 'restamp-feed.mjs', 'rm -f "${dmg}.blockmap"']) {
      expect(at(after)).toBeGreaterThan(script);
    }
    // The script itself cannot re-notarize or rebuild: it only runs xcrun stapler.
    const sh = readFileSync(join(ROOT, 'scripts/staple-retry.sh'), 'utf8');
    expect(sh).not.toContain('notarytool submit');
    expect(sh).not.toContain('electron-builder');
    expect((sh.match(/xcrun stapler/g) ?? []).length).toBeGreaterThan(0);
  });
});
