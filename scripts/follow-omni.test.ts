// Follow Omni carries at most one Omni a UTC day (#371): its "Once a UTC day" step, run as written
// with a fake gh and a fixed clock, holds a candidate when dev's last omni.json commit was committed
// today (UTC), and the jobs are wired so a held candidate still boots but is never carried.
import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const lines = readFileSync(join(import.meta.dir, '..', '.github', 'workflows', 'follow-omni.yml'), 'utf8').split('\n');
const indent = (line: string) => line.length - line.trimStart().length;

// The `run: |` block of the step named `name`, dedented.
function runOf(name: string): string {
  const step = lines.findIndex(line => line.trim() === `- name: ${name}`);
  if (step < 0) return '';
  const run = lines.findIndex((line, i) => i > step && line.trim() === 'run: |');
  const body: string[] = [];
  for (const line of lines.slice(run + 1)) {
    if (line.trim() !== '' && indent(line) <= indent(lines[run])) break;
    body.push(line);
  }
  const by = Math.min(...body.filter(line => line.trim() !== '').map(indent));
  return body.map(line => line.slice(by)).join('\n');
}

// The lines of the job named `name`, up to the next job.
function jobOf(name: string): string[] {
  const at = lines.indexOf(`  ${name}:`);
  if (at < 0) return [];
  const end = lines.findIndex((line, i) => i > at && /^ {2}[a-z-]+:$/.test(line));
  return lines.slice(at, end < 0 ? undefined : end);
}
const ifOf = (job: string) => jobOf(job).find(line => /^ {4}if: /.test(line))?.trim();

type Hold = { last?: string; ghFails?: boolean; today: string; dryRun?: boolean; skip?: boolean };

function hold({ last = '', ghFails = false, today, dryRun = false, skip = false }: Hold) {
  const dir = mkdtempSync(join(tmpdir(), 'follow-omni-'));
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'gh'), `#!/usr/bin/env bash\necho "$*" >> "${dir}/gh.log"\n${ghFails ? 'echo "HTTP 502" >&2\nexit 1' : `[[ -z "${last}" ]] || echo "${last}"`}\n`);
  writeFileSync(join(bin, 'date'), `#!/usr/bin/env bash\necho "$*" >> "${dir}/date.log"\necho "${today}"\n`);
  chmodSync(join(bin, 'gh'), 0o755);
  chmodSync(join(bin, 'date'), 0o755);
  writeFileSync(join(dir, 'output'), '');
  writeFileSync(join(dir, 'summary'), '');
  const run = spawnSync('bash', ['-c', runOf('Once a UTC day')], {
    encoding: 'utf8',
    env: {
      PATH: `${bin}:${process.env.PATH ?? ''}`,
      VERSION: '2.261105.4',
      DRY_RUN: dryRun ? 'true' : 'false',
      SKIP_HOLD: skip ? 'true' : 'false',
      GITHUB_REPOSITORY: 'owner/repo',
      GITHUB_OUTPUT: join(dir, 'output'),
      GITHUB_STEP_SUMMARY: join(dir, 'summary'),
    },
  });
  const read = (name: string) => readFileSync(join(dir, name), 'utf8');
  const result = { status: run.status, out: run.stdout, err: run.stderr, output: read('output'), summary: read('summary'), gh: read('gh.log').trim(), date: (() => { try { return read('date.log').trim(); } catch { return ''; } })() };
  rmSync(dir, { recursive: true, force: true });
  return result;
}

const SHA = '772af8299f7ac42a476144af620527ef57389388';

describe('Follow Omni once a UTC day', () => {
  test('is found as the workflow writes it', () => {
    expect(runOf('Once a UTC day')).toContain('held=false');
  });

  // The committer date, never the author's: a carry committed yesterday and merged today was
  // committed today by the merge, and spends today.
  test('reads the committer date of dev\'s last omni.json commit from GitHub, and the clock in UTC', () => {
    const run = hold({ last: `${SHA} 2026-11-04T22:31:12Z`, today: '2026-11-05' });
    expect(run.gh).toBe('api repos/owner/repo/commits?path=apps/desktop/omni.json&sha=dev&per_page=1 --jq .[0] // empty | "\\(.sha) \\(.commit.committer.date)"');
    expect(run.date).toBe('-u +%F');
  });

  test('omni.json last moved yesterday: it carries', () => {
    const run = hold({ last: `${SHA} 2026-11-04T22:31:12Z`, today: '2026-11-05' });
    expect(run.status).toBe(0);
    expect(run.output).toBe('held=false\n');
    expect(run.summary).toBe('### omni.json last moved 2026-11-04 at 22:31Z (772af8299), not today (2026-11-05 UTC): carrying Omni 2.261105.4 once it boots\n');
  });

  test('a carry at 23:50Z yesterday, the clock at 00:11Z: a new day, it carries', () => {
    expect(hold({ last: `${SHA} 2026-11-04T23:50:00Z`, today: '2026-11-05' }).output).toBe('held=false\n');
  });

  test('omni.json moved today (a carry by this workflow or merged by hand): it holds, and says until when', () => {
    const run = hold({ last: `${SHA} 2026-11-05T09:12:40Z`, today: '2026-11-05' });
    expect(run.status).toBe(0);
    expect(run.output).toBe('held=true\n');
    expect(run.summary).toBe('### Omni 2.261105.4 held: omni.json moved today at 09:12Z (772af8299); it boots but is not carried. The first run after 00:00 UTC (the 00:11 schedule) carries the newest Omni\n');
  });

  test('omni.json never moved on dev: it carries', () => {
    const run = hold({ today: '2026-11-05' });
    expect(run.status).toBe(0);
    expect(run.output).toBe('held=false\n');
    expect(run.summary).toBe('### omni.json was never moved on dev: carrying Omni 2.261105.4 once it boots\n');
  });

  test('GitHub cannot be read: the run fails and nothing is decided', () => {
    const run = hold({ ghFails: true, today: '2026-11-05' });
    expect(run.status).not.toBe(0);
    expect(run.output).toBe('');
  });

  test('an answer that is not a sha and a UTC date: the run fails', () => {
    for (const last of [`${SHA} 2026-11-05T09:12:40+02:00`, 'nonsense', `${SHA.slice(0, 9)} 2026-11-05T09:12:40Z`]) {
      const run = hold({ last, today: '2026-11-05' });
      expect(run.status).not.toBe(0);
      expect(run.out).toContain('::error ::dev\'s last omni.json commit reads as');
      expect(run.output).toBe('');
    }
  });

  test('a dry run is never held, and reports what a real run would do', () => {
    const today = hold({ last: `${SHA} 2026-11-05T09:12:40Z`, today: '2026-11-05', dryRun: true });
    expect(today.output).toBe('held=false\n');
    expect(today.summary).toBe('### Dry run: a real run would hold Omni 2.261105.4: omni.json moved today at 09:12Z (772af8299)\n');
    const yesterday = hold({ last: `${SHA} 2026-11-04T22:31:12Z`, today: '2026-11-05', dryRun: true });
    expect(yesterday.output).toBe('held=false\n');
    expect(yesterday.summary).toContain('a real run would carry Omni 2.261105.4');
  });

  test('skip_daily_hold carries a second Omni the same day, with a warning', () => {
    const run = hold({ last: `${SHA} 2026-11-05T09:12:40Z`, today: '2026-11-05', skip: true });
    expect(run.output).toBe('held=false\n');
    expect(run.out).toContain('::warning ::Daily hold skipped by hand: carrying Omni 2.261105.4 although omni.json moved today at 09:12Z (772af8299)');
  });
});

describe('Follow Omni\'s inputs', () => {
  // The newest step's input checks, up to where it starts reading anything.
  const newest = runOf('The newest Omni release');
  const checks = newest.slice(0, newest.indexOf('# Dispatch inputs reach GITHUB_OUTPUT'));
  const check = (env: Record<string, string>) => spawnSync('bash', ['-c', checks], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '', WANT_VERSION: '', WANT_COMMIT: '', WANT_DEV: '', ...env } });

  test('skip_daily_hold is refused with dry_run, and taken without it', () => {
    expect(checks).toContain('skip_daily_hold');
    const refused = check({ DRY_RUN: 'true', SKIP_HOLD: 'true' });
    expect(refused.status).toBe(1);
    expect(refused.stdout).toContain('::error ::skip_daily_hold is not taken with dry_run');
    expect(check({ DRY_RUN: 'false', SKIP_HOLD: 'true' }).status).toBe(0);
    expect(check({ DRY_RUN: 'true', SKIP_HOLD: 'false' }).status).toBe(0);
  });

  test('skip_daily_hold is a dispatch input that defaults to off, read into the follow job', () => {
    const at = lines.findIndex(line => line.trim() === 'skip_daily_hold:');
    expect(at).toBeGreaterThan(-1);
    expect(lines.slice(at, at + 4).map(line => line.trim())).toContain('default: false');
    expect(jobOf('follow').map(line => line.trim())).toContain("SKIP_HOLD: ${{ inputs.skip_daily_hold && 'true' || 'false' }}");
  });
});

describe('Follow Omni\'s jobs around the hold', () => {
  test('follow exposes held from the hold step', () => {
    expect(jobOf('follow').map(line => line.trim())).toContain('held: ${{ steps.hold.outputs.held }}');
  });

  test('a held candidate still boots: the boot job does not look at held', () => {
    expect(ifOf('boot')).toBe("if: needs.follow.outputs.version != ''");
  });

  test('a held candidate is never carried', () => {
    expect(ifOf('carry')).toBe("if: needs.follow.outputs.version != '' && needs.follow.outputs.held != 'true'");
  });

  test('the release still follows only a carried bump, never a dry run', () => {
    expect(ifOf('release')).toBe("if: needs.carry.outputs.sha != '' && !inputs.dry_run");
    expect(jobOf('release').map(line => line.trim())).toContain('needs: carry');
  });
});
