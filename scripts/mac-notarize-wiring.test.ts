// The two CloudKit round-trips of the macOS build (#704). electron-builder's built-in
// notarization calls @electron/notarize 2.5.0, which always staples right after notarytool and
// has no `staple: false`; that unprotected staple is what killed v3.98.0 attempt 2. The build
// turns the integration off (`mac.notarize: false`) and afterSign does the two steps apart:
// notarytool submits the app without stapling, then scripts/staple-retry.sh staples and
// validates the .app before the zip/dmg targets. The workflow keeps the dmg's own submit + retry
// and validates the app extracted from the updater zip. This harness proves the wiring with a
// fake xcrun/ditto, so it runs on Linux; the real notarization is macOS-only.
import { afterAll, describe, expect, test } from 'bun:test';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dir, '..');
const CONFIG = join(ROOT, 'apps/desktop/electron-builder.yml');
const HOOK = join(ROOT, 'apps/desktop/scripts/after-sign.cjs');
const WORKFLOW = join(ROOT, '.github/workflows/desktop-build.yml');
const requireHook = createRequire(import.meta.url);
const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

const readLines = (path: string): string[] => {
  try {
    const text = readFileSync(path, 'utf8');
    return text ? text.replace(/\n$/, '').split('\n') : [];
  } catch {
    return [];
  }
};

// The hook's process: notarytool answers from AFTER_SIGN_TEST_VERDICT, ditto writes the zip it
// is asked for, and both append their argv to one log. The order is then proven, not assumed:
// ditto zip, notarytool submit, then the retry script's staple and validate — no stapler inside
// the notarization step, and the script gets the .app, not the zip.
const XCRUN = `#!/usr/bin/env bash
set -u
printf 'xcrun %s\\n' "$*" >> "\${AFTER_SIGN_TEST_CALLS:?}"
case "$*" in
  "notarytool submit "*)
    printf '%s\\n' "\${AFTER_SIGN_TEST_VERDICT:?}"
    ;;
  "stapler staple "*)
    if [[ "\${AFTER_SIGN_TEST_STAPLE_FAIL:-0}" == 1 ]]; then
      printf 'Error Domain=NSURLErrorDomain Code=-1005 "The network connection was lost."\\n' >&2
      exit 68
    fi
    ;;
esac
exit 0
`;

const DITTO = `#!/usr/bin/env bash
set -u
printf 'ditto %s\\n' "$*" >> "\${AFTER_SIGN_TEST_CALLS:?}"
last="\${!#}"
: > "\${last}"
exit 0
`;

interface HookOptions {
  verdict?: string;
  key?: boolean;
  platform?: string;
  stapleFails?: boolean;
}

function hookHarness(options: HookOptions = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'after-sign-test-'));
  dirs.push(dir);
  const bin = join(dir, 'bin');
  const appOutDir = join(dir, 'dist', 'mac-arm64');
  const app = join(appOutDir, 'Automagik.app');
  mkdirSync(bin);
  mkdirSync(join(app, 'Contents'), { recursive: true });
  writeFileSync(join(app, 'Contents', 'Info.plist'), 'signed app\n');
  writeFileSync(join(bin, 'xcrun'), XCRUN);
  writeFileSync(join(bin, 'ditto'), DITTO);
  chmodSync(join(bin, 'xcrun'), 0o755);
  chmodSync(join(bin, 'ditto'), 0o755);
  const calls = join(dir, 'calls.log');
  writeFileSync(calls, '');
  const key = join(dir, 'AuthKey.p8');
  writeFileSync(key, 'not a real key\n');

  const env: Record<string, string | undefined> = {
    PATH: `${bin}:${process.env.PATH ?? ''}`,
    AFTER_SIGN_TEST_CALLS: calls,
    AFTER_SIGN_TEST_VERDICT: options.verdict ?? '{"id":"test-id","status":"Accepted"}',
    AFTER_SIGN_TEST_STAPLE_FAIL: options.stapleFails ? '1' : undefined,
    STAPLE_RETRY_DELAYS: '0 0 0',
    APPLE_API_KEY: options.key === false ? undefined : key,
    APPLE_API_KEY_ID: options.key === false ? undefined : 'TESTKEYID',
    APPLE_API_ISSUER: options.key === false ? undefined : 'test-issuer',
  };
  const saved = new Map<string, string | undefined>();
  for (const [name, value] of Object.entries(env)) {
    saved.set(name, process.env[name]);
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }

  return {
    app,
    calls: () => readLines(calls),
    async run() {
      try {
        const hook = requireHook(HOOK).default;
        await hook({
          electronPlatformName: options.platform ?? 'darwin',
          appOutDir,
          packager: { appInfo: { productFilename: 'Automagik' } },
        });
        return { error: null };
      } catch (error) {
        return { error: error as Error };
      } finally {
        for (const [name, value] of saved) {
          if (value === undefined) delete process.env[name];
          else process.env[name] = value;
        }
      }
    },
  };
}

describe('afterSign notarizes without stapling, then staples the app through the retry script', () => {
  test('notarytool submit, then the script staple+validate on the .app', async () => {
    const h = hookHarness();
    const { error } = await h.run();
    expect(error).toBeNull();
    const calls = h.calls();
    expect(calls.length).toBe(4);
    expect(calls[0]?.startsWith('ditto -c -k')).toBe(true);
    expect(calls[0]).toContain('Automagik.app');
    expect(calls[1]?.startsWith('xcrun notarytool submit ')).toBe(true);
    expect(calls[1]).toContain('--wait');
    expect(calls[1]).toContain('--key ');
    expect(calls[1]).toContain('--key-id TESTKEYID');
    expect(calls[1]).toContain('--issuer test-issuer');
    expect(calls[1]).not.toContain('Automagik.app');
    expect(calls[2]).toBe(`xcrun stapler staple ${h.app}`);
    expect(calls[3]).toBe(`xcrun stapler validate ${h.app}`);
  });

  test('a rejection (status: Invalid) fails before any staple', async () => {
    const h = hookHarness({ verdict: '{"id":"test-id","status":"Invalid"}' });
    const { error } = await h.run();
    expect(error).not.toBeNull();
    expect(error?.message).toContain('not accepted');
    const calls = h.calls();
    expect(calls.length).toBe(2);
    expect(calls[1]?.startsWith('xcrun notarytool submit ')).toBe(true);
  });

  test('a staple that keeps failing fails the hook after the retries (the build stops before the targets)', async () => {
    const h = hookHarness({ stapleFails: true });
    const { error } = await h.run();
    expect(error).not.toBeNull();
    expect(error?.message).toContain('staple/validate failed');
    expect(h.calls().filter(line => line.startsWith('xcrun stapler staple ')).length).toBe(4);
  });

  test('no API key: the hook does nothing', async () => {
    const h = hookHarness({ key: false });
    const { error } = await h.run();
    expect(error).toBeNull();
    expect(h.calls()).toEqual([]);
  });

  test('another platform: the hook does nothing', async () => {
    const h = hookHarness({ platform: 'linux' });
    const { error } = await h.run();
    expect(error).toBeNull();
    expect(h.calls()).toEqual([]);
  });
});

function configBlock(name: string): string {
  const lines = readFileSync(CONFIG, 'utf8').split('\n');
  const start = lines.findIndex(line => line === `${name}:`);
  expect(start).toBeGreaterThan(-1);
  const block: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^[A-Za-z][A-Za-z0-9_-]*:/.test(lines[i] ?? '')) break;
    block.push(lines[i] ?? '');
  }
  return block.join('\n');
}

describe('the electron-builder config', () => {
  test('turns the built-in notarize (and its unprotected staple) off', () => {
    expect(configBlock('mac')).toMatch(/^\s+notarize: false$/m);
  });

  test('wires afterSign to the hook that delegates the staple to the retry script', () => {
    expect(readFileSync(CONFIG, 'utf8')).toMatch(/^afterSign: scripts\/after-sign\.cjs$/m);
    expect(existsSync(HOOK)).toBe(true);
    const hook = readFileSync(HOOK, 'utf8');
    // The @electron/notarize library is the staple we moved out; requiring it again would
    // bring the unprotected round-trip back.
    expect(/require\(['"]@electron\/notarize['"]\)/.test(hook)).toBe(false);
    expect(hook).toContain("'scripts', 'staple-retry.sh'");
    expect(hook).toContain('notarytool');
  });
});

describe('the workflow', () => {
  test('validates the updater zip’s app before the dmg is notarized', () => {
    const text = readFileSync(WORKFLOW, 'utf8');
    const extract = text.indexOf('ditto -x -k');
    const validate = text.indexOf('xcrun stapler validate "${apps[0]}"');
    const submit = text.indexOf('notarytool submit "${dmg}"');
    const retry = text.indexOf('scripts/staple-retry.sh"');
    expect(extract).toBeGreaterThan(-1);
    expect(validate).toBeGreaterThan(extract);
    expect(submit).toBeGreaterThan(validate);
    expect(retry).toBeGreaterThan(submit);
    expect(text.slice(Math.max(0, extract - 400), extract + 400)).toContain('dist/*-mac-*.zip');
  });
});
