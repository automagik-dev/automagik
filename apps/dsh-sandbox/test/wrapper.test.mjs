// Hermetic tests for bin/hc-socket-mask.mjs: a fake bwrap on PATH records the argv it gets,
// proxy sockets are real Unix sockets in temp folders, and HOME is a temp folder. The pure
// helper receives a fake container-socket list, so no test reads or needs a live docker.sock.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  CONTAINER_RUNTIME_SOCKETS,
  containerSocketPaths,
  maskArgs,
  MSG_PREFIX,
  PROXY_SOCKET,
  REAL_SOCKET,
  splitRunnerArgs,
  SWITCH,
} from '../bin/hc-socket-mask.mjs';

const WRAPPER = fileURLToPath(new URL('../bin/hc-socket-mask.mjs', import.meta.url));
const PROFILE_ARGS = [
  '--ro-bind', '/', '/',
  '--dev', '/dev',
  '--unshare-pid',
  '--proc', '/proc',
  '--die-with-parent',
];
const COMMAND = ['dsh', '--profile', 'dsh-tui', '--resume', 'abc-123'];
const RUNNER_ARGS = [...PROFILE_ARGS, '--', ...COMMAND];

const roots = [];
const servers = [];
after(async () => {
  for (const server of servers) await close(server).catch(() => {});
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function temp() {
  const root = mkdtempSync(join(tmpdir(), 'dsh-sandbox-wrapper-'));
  roots.push(root);
  return root;
}

/** A fake bwrap first on PATH: it records its argv, one argument per line, then exits its code. */
function fakeBwrap(root) {
  const bin = join(root, 'bin');
  mkdirSync(bin, { recursive: true });
  const file = join(bin, 'bwrap');
  const script = [
    '#!/bin/sh',
    ': > "$BWRAP_ARGS_FILE"',
    'for arg in "$@"; do printf \'%s\\n\' "$arg" >> "$BWRAP_ARGS_FILE"; done',
    'exit "${BWRAP_EXIT:-0}"',
  ].join('\n');
  writeFileSync(file, `${script}\n`);
  chmodSync(file, 0o755);
  return bin;
}

function makeFixture({ ssh = 'dir' } = {}) {
  const root = temp();
  const home = join(root, 'home');
  const coreDir = join(root, 'core');
  const proxyDir = join(root, 'proxy');
  const sshPath = join(home, '.ssh');
  mkdirSync(home, { recursive: true });
  if (ssh === 'dir') mkdirSync(sshPath, { recursive: true });
  else if (ssh === 'file') writeFileSync(sshPath, 'not a key');
  else if (ssh === 'symlink') {
    const target = join(root, 'canonical-ssh');
    mkdirSync(target, { recursive: true });
    symlinkSync(target, sshPath);
  }
  mkdirSync(coreDir, { recursive: true });
  mkdirSync(proxyDir, { recursive: true });
  return {
    root,
    home,
    coreDir,
    proxyDir,
    ssh: sshPath,
    real: join(coreDir, 'default.sock'),
    proxy: join(proxyDir, 'pane.sock'),
    bin: fakeBwrap(root),
    argsFile: join(root, 'bwrap-args'),
  };
}

async function listen(path) {
  const server = net.createServer((socket) => socket.end());
  servers.push(server);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(path, resolve);
  });
  return server;
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function environment(fixture, { mask = '1', real, proxy, home, extra = {} } = {}) {
  const env = {
    PATH: `${fixture.bin}:${process.env.PATH}`,
    HOME: home === undefined ? fixture.home : home,
    BWRAP_ARGS_FILE: fixture.argsFile,
    ...extra,
  };
  if (mask !== undefined) env[SWITCH] = mask;
  if (real !== undefined) env[REAL_SOCKET] = real;
  if (proxy !== undefined) env[PROXY_SOCKET] = proxy;
  return env;
}

function run(args, env) {
  return spawnSync(process.execPath, [WRAPPER, ...args], { env, encoding: 'utf8' });
}

function recorded(fixture) {
  const text = readFileSync(fixture.argsFile, 'utf8');
  return text.replace(/\n$/, '').split('\n');
}

function bwrapRan(fixture) {
  try {
    statSync(fixture.argsFile);
    return true;
  } catch {
    return false;
  }
}

/**
 * Drop the host-dependent container masks by shape, so a CLI test never stats a live path.
 * Their exact targets are asserted only by the pure-helper tests with an explicit fake list.
 * `keep` holds one real `--bind /dev/null` target to compare (the ~/.ssh file case).
 */
function withoutContainerBinds(args, keep = null) {
  const kept = [];
  for (let at = 0; at < args.length; at += 1) {
    if (args[at] === '--bind' && args[at + 1] === '/dev/null' && args[at + 2] !== keep) {
      at += 2;
      continue;
    }
    kept.push(args[at]);
  }
  return kept;
}

function assertOneLine(result) {
  const lines = result.stderr.split('\n').filter(Boolean);
  assert.equal(lines.length, 1, `expected one line, got: ${JSON.stringify(result.stderr)}`);
  assert.ok(lines[0].startsWith(MSG_PREFIX), lines[0]);
  return lines[0];
}

test('the fixed container list and the per-uid rootless sockets', () => {
  assert.deepEqual(CONTAINER_RUNTIME_SOCKETS, [
    '/var/run/docker.sock',
    '/run/docker.sock',
    '/run/containerd/containerd.sock',
    '/run/podman/podman.sock',
  ]);
  assert.deepEqual(containerSocketPaths(null), [...CONTAINER_RUNTIME_SOCKETS]);
  assert.deepEqual(containerSocketPaths(1000), [
    ...CONTAINER_RUNTIME_SOCKETS,
    '/run/user/1000/docker.sock',
    '/run/user/1000/podman/podman.sock',
  ]);
});

test('splitRunnerArgs keeps the profile args and the command apart at the first --', () => {
  assert.deepEqual(splitRunnerArgs(RUNNER_ARGS), { profileArgs: PROFILE_ARGS, command: COMMAND });
  assert.deepEqual(splitRunnerArgs(['--', '--']), { profileArgs: [], command: ['--'] });
  assert.deepEqual(splitRunnerArgs(['--ro-bind']), { profileArgs: ['--ro-bind'], command: null });
});

test('switch off runs bwrap with exactly the arguments it was given', () => {
  const fixture = makeFixture();
  for (const mask of [null, '0', 'yes']) {
    const env = environment(fixture, { real: fixture.real, proxy: fixture.proxy });
    if (mask === null) delete env[SWITCH];
    else env[SWITCH] = mask;
    const result = run(RUNNER_ARGS, env);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, '');
    assert.deepEqual(recorded(fixture), RUNNER_ARGS);
  }
});

test('switch on masks the real dir, ~/.ssh and the proxy, and preserves the command', async () => {
  const fixture = makeFixture();
  await listen(fixture.proxy);
  const env = environment(fixture, { real: fixture.real, proxy: fixture.proxy });
  const result = run(RUNNER_ARGS, env);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  const expected = [
    ...PROFILE_ARGS,
    '--tmpfs', dirname(fixture.real),
    '--bind', fixture.proxy, fixture.real,
    '--tmpfs', dirname(fixture.proxy),
    '--tmpfs', realpathSync(fixture.ssh),
    '--', ...COMMAND,
  ];
  assert.deepEqual(withoutContainerBinds(recorded(fixture)), expected);
});

test('a missing proxy still masks everything, says one line and starts bwrap', () => {
  const fixture = makeFixture();
  const env = environment(fixture, { real: fixture.real, proxy: fixture.proxy });
  const result = run(RUNNER_ARGS, env);
  assert.equal(result.status, 0);
  const line = assertOneLine(result);
  assert.match(line, /does not exist/);
  const args = recorded(fixture);
  assert.deepEqual(withoutContainerBinds(args), [
    ...PROFILE_ARGS,
    '--tmpfs', dirname(fixture.real),
    '--tmpfs', dirname(fixture.proxy),
    '--tmpfs', realpathSync(fixture.ssh),
    '--', ...COMMAND,
  ]);
  // The shared proxy host folder is hidden even with no bind; the proxy file is not bound.
  assert.ok(!args.includes(fixture.proxy));
});

test('a proxy that is not a Unix socket is treated as missing', () => {
  const fixture = makeFixture();
  writeFileSync(fixture.proxy, 'not a socket');
  const env = environment(fixture, { real: fixture.real, proxy: fixture.proxy });
  const result = run(RUNNER_ARGS, env);
  assert.equal(result.status, 0);
  const line = assertOneLine(result);
  assert.match(line, /is not a Unix socket/);
  const args = recorded(fixture);
  assert.ok(!args.includes(fixture.proxy));
  assert.ok(args.includes(dirname(fixture.proxy)));
  assert.deepEqual(withoutContainerBinds(args), [
    ...PROFILE_ARGS,
    '--tmpfs', dirname(fixture.real),
    '--tmpfs', dirname(fixture.proxy),
    '--tmpfs', realpathSync(fixture.ssh),
    '--', ...COMMAND,
  ]);
});

test('an unset proxy says one line and still masks the real dir and ~/.ssh', () => {
  const fixture = makeFixture();
  const result = run(RUNNER_ARGS, environment(fixture, { real: fixture.real }));
  assert.equal(result.status, 0);
  const line = assertOneLine(result);
  assert.match(line, /is not set/);
  assert.ok(recorded(fixture).includes(dirname(fixture.real)));
  assert.ok(recorded(fixture).includes(realpathSync(fixture.ssh)));
  assert.ok(!recorded(fixture).includes(dirname(fixture.proxy)));
});

test('a relative proxy says one line, draws no folder tmpfs and still masks the rest', () => {
  const fixture = makeFixture();
  const relativeProxy = 'relative-proxy/pane.sock';
  const result = run(RUNNER_ARGS, environment(fixture, {
    real: fixture.real,
    proxy: relativeProxy,
  }));
  assert.equal(result.status, 0);
  assert.match(assertOneLine(result), /is not an absolute path/);
  const args = recorded(fixture);
  assert.ok(!args.includes(relativeProxy));
  assert.ok(!args.includes('relative-proxy'));
  assert.deepEqual(withoutContainerBinds(args), [
    ...PROFILE_ARGS,
    '--tmpfs', dirname(fixture.real),
    '--tmpfs', realpathSync(fixture.ssh),
    '--', ...COMMAND,
  ]);
});

test('a ~/.ssh directory is shadowed at its canonical path', async () => {
  const fixture = makeFixture();
  await listen(fixture.proxy);
  const result = run(RUNNER_ARGS, environment(fixture, {
    real: fixture.real,
    proxy: fixture.proxy,
  }));
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  assert.ok(recorded(fixture).includes(realpathSync(fixture.ssh)));
});

test('a ~/.ssh symlink to a directory is shadowed at its canonical target', async () => {
  const fixture = makeFixture({ ssh: 'symlink' });
  await listen(fixture.proxy);
  const result = run(RUNNER_ARGS, environment(fixture, {
    real: fixture.real,
    proxy: fixture.proxy,
  }));
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  const canonical = realpathSync(fixture.ssh);
  const args = recorded(fixture);
  assert.deepEqual(args.slice(args.indexOf(canonical) - 1, args.indexOf(canonical) + 1),
    ['--tmpfs', canonical]);
  // The symlink path itself is not a mount target: the canonical directory is what is hidden.
  assert.ok(!args.includes(fixture.ssh));
});

test('a missing ~/.ssh adds no mask and does not fail', async () => {
  const fixture = makeFixture({ ssh: 'absent' });
  await listen(fixture.proxy);
  const result = run(RUNNER_ARGS, environment(fixture, {
    real: fixture.real,
    proxy: fixture.proxy,
  }));
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  const args = recorded(fixture);
  assert.ok(!args.includes(fixture.ssh));
  assert.deepEqual(withoutContainerBinds(args), [
    ...PROFILE_ARGS,
    '--tmpfs', dirname(fixture.real),
    '--bind', fixture.proxy, fixture.real,
    '--tmpfs', dirname(fixture.proxy),
    '--', ...COMMAND,
  ]);
});

test('a non-directory ~/.ssh is bound over /dev/null at its canonical path', async () => {
  const fixture = makeFixture({ ssh: 'file' });
  await listen(fixture.proxy);
  const result = run(RUNNER_ARGS, environment(fixture, {
    real: fixture.real,
    proxy: fixture.proxy,
  }));
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  const ssh = realpathSync(fixture.ssh);
  assert.deepEqual(withoutContainerBinds(recorded(fixture), ssh), [
    ...PROFILE_ARGS,
    '--tmpfs', dirname(fixture.real),
    '--bind', fixture.proxy, fixture.real,
    '--tmpfs', dirname(fixture.proxy),
    '--bind', '/dev/null', ssh,
    '--', ...COMMAND,
  ]);
});

test('HC_TERMINAL_SOCKET is the fallback for the real socket', async () => {
  const fixture = makeFixture();
  await listen(fixture.proxy);
  const env = environment(fixture, {
    real: undefined,
    proxy: fixture.proxy,
    extra: { HC_TERMINAL_SOCKET: fixture.real },
  });
  const result = run(RUNNER_ARGS, env);
  assert.equal(result.status, 0, result.stderr);
  const args = withoutContainerBinds(recorded(fixture));
  assert.deepEqual(args.slice(PROFILE_ARGS.length, PROFILE_ARGS.length + 9), [
    '--tmpfs', dirname(fixture.real),
    '--bind', fixture.proxy, fixture.real,
    '--tmpfs', dirname(fixture.proxy),
    '--tmpfs', realpathSync(fixture.ssh),
  ]);
});

test('no real socket path fails closed: one line, nonzero, bwrap never runs', () => {
  const fixture = makeFixture();
  const result = run(RUNNER_ARGS, environment(fixture, { proxy: fixture.proxy }));
  assert.notEqual(result.status, 0);
  const line = assertOneLine(result);
  assert.match(line, /AM_HC_REAL_SOCKET is not set/);
  assert.equal(bwrapRan(fixture), false);
});

test('a relative real socket fails closed: one line, nonzero, bwrap never runs', () => {
  const fixture = makeFixture();
  const result = run(RUNNER_ARGS, environment(fixture, {
    real: 'core/default.sock',
    proxy: fixture.proxy,
  }));
  assert.notEqual(result.status, 0);
  assert.match(assertOneLine(result), /not absolute/);
  assert.equal(bwrapRan(fixture), false);
});

test('no HOME fails closed: ~/.ssh cannot be hidden', () => {
  const fixture = makeFixture();
  const env = environment(fixture, { real: fixture.real, proxy: fixture.proxy, home: undefined });
  delete env.HOME;
  const result = run(RUNNER_ARGS, env);
  assert.notEqual(result.status, 0);
  const line = assertOneLine(result);
  assert.match(line, /HOME is not set/);
  assert.equal(bwrapRan(fixture), false);
});

test('a relative HOME fails closed: one line, nonzero, bwrap never runs', () => {
  const fixture = makeFixture();
  const result = run(RUNNER_ARGS, environment(fixture, {
    real: fixture.real,
    home: 'relative/home',
  }));
  assert.notEqual(result.status, 0);
  assert.match(assertOneLine(result), /HOME is not set to an absolute path/);
  assert.equal(bwrapRan(fixture), false);
});

test('a proxy folder that holds the real socket path fails closed, socket or not', async () => {
  const live = makeFixture();
  const liveProxy = join(live.coreDir, 'pane.sock');
  await listen(liveProxy);
  const liveResult = run(RUNNER_ARGS, environment(live, { real: live.real, proxy: liveProxy }));
  assert.notEqual(liveResult.status, 0);
  assert.match(assertOneLine(liveResult), /holds the real socket path/);
  assert.equal(bwrapRan(live), false);
  // The folder is still masked when the proxy is missing, so the guard applies just the same.
  const missing = makeFixture();
  const missingProxy = join(missing.coreDir, 'pane.sock');
  const result = run(RUNNER_ARGS, environment(missing, {
    real: missing.real,
    proxy: missingProxy,
  }));
  assert.notEqual(result.status, 0);
  assert.match(assertOneLine(result), /holds the real socket path/);
  assert.equal(bwrapRan(missing), false);
});

test('a proxy folder above the real socket path fails closed, socket or not', async () => {
  const live = makeFixture();
  const liveProxy = join(live.root, 'pane.sock');
  await listen(liveProxy);
  const liveResult = run(RUNNER_ARGS, environment(live, { real: live.real, proxy: liveProxy }));
  assert.notEqual(liveResult.status, 0);
  assert.match(assertOneLine(liveResult), /holds the real socket path/);
  assert.equal(bwrapRan(live), false);
  // The folder is still an ancestor when the proxy is missing, so the guard applies just the same.
  const missing = makeFixture();
  const missingProxy = join(missing.root, 'pane.sock');
  const result = run(RUNNER_ARGS, environment(missing, {
    real: missing.real,
    proxy: missingProxy,
  }));
  assert.notEqual(result.status, 0);
  assert.match(assertOneLine(result), /holds the real socket path/);
  assert.equal(bwrapRan(missing), false);
});

test('the absolute requirement: no core socket without a live proxy, real dir first', async () => {
  for (const state of ['live', 'missing', 'not-a-socket', 'relative', 'unset']) {
    const fixture = makeFixture();
    let proxy;
    if (state === 'live') {
      await listen(fixture.proxy);
      proxy = fixture.proxy;
    } else if (state === 'missing') proxy = fixture.proxy;
    else if (state === 'not-a-socket') {
      writeFileSync(fixture.proxy, 'not a socket');
      proxy = fixture.proxy;
    } else if (state === 'relative') proxy = 'proxy/pane.sock';
    const result = run(RUNNER_ARGS, environment(fixture, { real: fixture.real, proxy }));
    assert.equal(result.status, 0, result.stderr);
    const args = recorded(fixture);
    // The real runtime folder is shut first, before any bind that could expose it.
    assert.deepEqual(args.slice(PROFILE_ARGS.length, PROFILE_ARGS.length + 2),
      ['--tmpfs', dirname(fixture.real)], state);
    // The only bind onto the real path is a live proxy; otherwise the path has no listener.
    for (let at = 0; at + 2 < args.length; at += 1) {
      if (args[at] === '--bind' && args[at + 2] === fixture.real) {
        assert.equal(state, 'live');
        assert.equal(args[at + 1], fixture.proxy);
      }
    }
    if (state !== 'live') assert.ok(!args.includes(fixture.proxy), state);
  }
});

test('the runner args without a -- separator fail closed', () => {
  const fixture = makeFixture();
  const env = environment(fixture, { real: fixture.real, proxy: fixture.proxy });
  const result = run(PROFILE_ARGS, env);
  assert.notEqual(result.status, 0);
  const line = assertOneLine(result);
  assert.match(line, /no '--' separator/);
  assert.equal(bwrapRan(fixture), false);
});

test("bwrap's exit code is forwarded and a missing bwrap is one prefixed line", () => {
  const fixture = makeFixture();
  const env = environment(fixture, { real: fixture.real, extra: { BWRAP_EXIT: '7' } });
  const result = run(RUNNER_ARGS, env);
  assert.equal(result.status, 7);
  const missing = environment(fixture, { real: fixture.real, extra: {} });
  missing.PATH = '/nonexistent';
  const failed = run(RUNNER_ARGS, missing);
  assert.equal(failed.status, 127);
  const lines = failed.stderr.split('\n').filter(Boolean);
  assert.ok(lines.length >= 1);
  for (const line of lines) assert.ok(line.startsWith(MSG_PREFIX), line);
});

test('the pure helper uses only its explicit container list: fake, deduped, existing only', () => {
  const root = temp();
  const fake = join(root, 'runtime');
  mkdirSync(fake, { recursive: true });
  const first = join(fake, 'docker.sock');
  const second = join(fake, 'podman.sock');
  writeFileSync(first, '');
  writeFileSync(second, '');
  const alias = join(fake, 'docker-alias.sock');
  // A relative symlink keeps the alias portable inside the temp folder.
  symlinkSync('docker.sock', alias);
  const missing = join(fake, 'missing.sock');
  const home = join(root, 'home');
  const coreDir = join(root, 'core');
  mkdirSync(join(home, '.ssh'), { recursive: true });
  mkdirSync(coreDir, { recursive: true });
  const real = join(coreDir, 'default.sock');
  const result = maskArgs(RUNNER_ARGS, {
    [SWITCH]: '1',
    HOME: home,
    [REAL_SOCKET]: real,
  }, { containerSockets: [first, second, alias, missing] });
  assert.equal(result.fatal, null);
  assert.equal(result.masked, true);
  assert.equal(result.notices.length, 1);
  assert.deepEqual(result.args, [
    ...PROFILE_ARGS,
    '--tmpfs', coreDir,
    '--tmpfs', realpathSync(join(home, '.ssh')),
    '--bind', '/dev/null', realpathSync(first),
    '--bind', '/dev/null', realpathSync(second),
    '--', ...COMMAND,
  ]);
  // The helper never looked at the fixed host paths: none of them is in its output.
  const text = JSON.stringify(result.args);
  for (const live of CONTAINER_RUNTIME_SOCKETS) assert.ok(!text.includes(live), live);
});

test('the pure helper orders the proxy mounts before ~/.ssh and the container masks', async () => {
  const root = temp();
  const fake = join(root, 'runtime');
  const home = join(root, 'home');
  const coreDir = join(root, 'core');
  const proxyDir = join(root, 'proxy');
  mkdirSync(fake, { recursive: true });
  mkdirSync(join(home, '.ssh'), { recursive: true });
  mkdirSync(coreDir, { recursive: true });
  mkdirSync(proxyDir, { recursive: true });
  const container = join(fake, 'docker.sock');
  writeFileSync(container, '');
  const real = join(coreDir, 'default.sock');
  const proxy = join(proxyDir, 'pane.sock');
  await listen(proxy);
  const result = maskArgs(RUNNER_ARGS, {
    [SWITCH]: '1',
    HOME: home,
    [REAL_SOCKET]: real,
    [PROXY_SOCKET]: proxy,
  }, { containerSockets: [container] });
  assert.equal(result.fatal, null);
  assert.deepEqual(result.notices, []);
  assert.deepEqual(result.args, [
    ...PROFILE_ARGS,
    '--tmpfs', coreDir,
    '--bind', proxy, real,
    '--tmpfs', proxyDir,
    '--tmpfs', realpathSync(join(home, '.ssh')),
    '--bind', '/dev/null', realpathSync(container),
    '--', ...COMMAND,
  ]);
});

test('the pure helper hides an absolute proxy folder even when there is no bind', () => {
  const root = temp();
  const home = join(root, 'home');
  const coreDir = join(root, 'core');
  const proxyDir = join(root, 'proxy');
  mkdirSync(join(home, '.ssh'), { recursive: true });
  mkdirSync(coreDir, { recursive: true });
  mkdirSync(proxyDir, { recursive: true });
  const real = join(coreDir, 'default.sock');
  const proxy = join(proxyDir, 'pane.sock');
  const result = maskArgs(RUNNER_ARGS, {
    [SWITCH]: '1',
    HOME: home,
    [REAL_SOCKET]: real,
    [PROXY_SOCKET]: proxy,
  }, { containerSockets: [] });
  assert.equal(result.fatal, null);
  assert.equal(result.notices.length, 1);
  assert.deepEqual(result.args, [
    ...PROFILE_ARGS,
    '--tmpfs', coreDir,
    '--tmpfs', proxyDir,
    '--tmpfs', realpathSync(join(home, '.ssh')),
    '--', ...COMMAND,
  ]);
});

test('the pure helper cannot hide a proxy folder it cannot name', () => {
  const root = temp();
  const home = join(root, 'home');
  const coreDir = join(root, 'core');
  mkdirSync(join(home, '.ssh'), { recursive: true });
  mkdirSync(coreDir, { recursive: true });
  const real = join(coreDir, 'default.sock');
  const result = maskArgs(RUNNER_ARGS, {
    [SWITCH]: '1',
    HOME: home,
    [REAL_SOCKET]: real,
    [PROXY_SOCKET]: 'proxy/pane.sock',
  }, { containerSockets: [] });
  assert.equal(result.fatal, null);
  assert.equal(result.notices.length, 1);
  assert.match(result.notices[0], /not an absolute path/);
  assert.deepEqual(result.args, [
    ...PROFILE_ARGS,
    '--tmpfs', coreDir,
    '--tmpfs', realpathSync(join(home, '.ssh')),
    '--', ...COMMAND,
  ]);
});

test('the pure helper keeps the switch off and never asks for a socket list then', () => {
  const result = maskArgs(RUNNER_ARGS, { [SWITCH]: '0' }, { containerSockets: ['/nope'] });
  assert.deepEqual(result.args, RUNNER_ARGS);
  assert.equal(result.masked, false);
  assert.equal(result.fatal, null);
  assert.deepEqual(result.notices, []);
});
