#!/usr/bin/env node
// The DSH sandbox runner wrapper (apps/dsh-sandbox; issue #631, the DSH lane's part of #624).
// Linux/bwrap first cut: it hides the herdr-core runtime folder, the user's ~/.ssh and the
// known container runtime sockets from a sandboxed pane, and binds the pane's filtering proxy
// at the exact real core socket path inside the sandbox. macOS (Seatbelt) and Windows (ACL /
// named pipe) need their own rule; see README.md.
//
// The local sandbox provider composes its runner argv as
// [...runnerCommand, ...bwrapProfileArgs(policy), '--', ...argv]. This wrapper finds that '--',
// inserts the mask mounts after the profile args and before it, and execs bwrap. Off unless
// DSH_SANDBOX_MASK=1: then bwrap runs with exactly the arguments it received (today's behavior).
//
// Every line this wrapper prints starts with MSG_PREFIX, which is also the profile's
// runnerFailureSignatures entry: 'hc-socket-mask: '.
import { spawn } from 'node:child_process';
import { realpathSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Pane-start switch: '1' enables the mask; absent (or anything else) is off. */
export const SWITCH = 'DSH_SANDBOX_MASK';
/** The pane's real core socket, from the shim (HC_TERMINAL_SOCKET fallback). */
export const REAL_SOCKET = 'AM_HC_REAL_SOCKET';
/** The host-side proxy socket the Herdr lane binds at the real path inside the sandbox. */
export const PROXY_SOCKET = 'AM_HC_PROXY_SOCKET';
/** Every line the wrapper prints starts with this; the profile's runnerFailureSignatures entry. */
export const MSG_PREFIX = 'hc-socket-mask: ';

/**
 * The fixed container runtime sockets this cut knows. The pure helper in the tests receives its
 * own explicit list, so a test never looks at (or needs) a live docker.sock.
 */
export const CONTAINER_RUNTIME_SOCKETS = Object.freeze([
  '/var/run/docker.sock',
  '/run/docker.sock',
  '/run/containerd/containerd.sock',
  '/run/podman/podman.sock',
]);

/**
 * The fixed container runtime sockets, plus the per-uid rootless Docker and Podman sockets when
 * the platform has a uid. The wrapper masks only those that exist inside this host's namespace.
 */
export function containerSocketPaths(uid = process.getuid?.()) {
  const paths = [...CONTAINER_RUNTIME_SOCKETS];
  if (typeof uid === 'number' && Number.isInteger(uid) && uid >= 0) {
    paths.push(`/run/user/${uid}/docker.sock`);
    paths.push(`/run/user/${uid}/podman/podman.sock`);
  }
  return paths;
}

/** Split the provider's argv at the first '--': the bwrap profile args, then the command. */
export function splitRunnerArgs(args) {
  const at = args.indexOf('--');
  if (at === -1) return { profileArgs: [...args], command: null };
  return { profileArgs: args.slice(0, at), command: args.slice(at + 1) };
}

/** Whether `dir` is `target` itself or one of its ancestors (both absolute paths). */
export function isSameOrAncestor(dir, target) {
  const rel = relative(dir, target);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

const failed = (args, message) => ({ args: [...args], fatal: message, notices: [], masked: false });

/** The one line the wrapper prints when it starts a pane with no core socket at all. */
export function proxyNotice(proxy) {
  const tail = 'starting the pane with no herdr-core socket (hc will fail closed)';
  if (!proxy) return `${PROXY_SOCKET} is not set: ${tail}`;
  if (!isAbsolute(proxy)) return `${PROXY_SOCKET} is not an absolute path: ${tail}`;
  let info;
  try {
    info = statSync(proxy);
  } catch {
    return `${PROXY_SOCKET} ${proxy} does not exist: ${tail}`;
  }
  if (!info.isSocket()) return `${PROXY_SOCKET} ${proxy} is not a Unix socket: ${tail}`;
  return null;
}

/**
 * The pure helper the tests drive: given the runner argv and an environment, return the argv to
 * run, the fatal line (no bwrap run), or the one non-fatal notice (bwrap still runs, without a
 * proxy). `options.containerSockets` must be explicit in tests: the default only reads fixed
 * paths, and a test passes fake ones under its temp folder. `fatal` is a single unprefixed line;
 * the CLI adds MSG_PREFIX.
 */
export function maskArgs(args, env = process.env, options = {}) {
  const {
    containerSockets = containerSocketPaths(options.uid),
    stat = statSync,
    realpath = realpathSync,
  } = options;
  if (env[SWITCH] !== '1') return { args: [...args], fatal: null, notices: [], masked: false };
  const { profileArgs, command } = splitRunnerArgs(args);
  if (!command) {
    return failed(args,
      "the runner arguments have no '--' separator; refusing to guess the command");
  }
  if (!env.HOME || !isAbsolute(env.HOME)) {
    return failed(args, 'HOME is not set to an absolute path: cannot hide ~/.ssh');
  }
  const real = env[REAL_SOCKET] || env.HC_TERMINAL_SOCKET;
  if (!real) {
    return failed(args,
      `${REAL_SOCKET} is not set (and HC_TERMINAL_SOCKET is absent): cannot hide the core socket`);
  }
  if (!isAbsolute(real)) return failed(args, `the real core socket path is not absolute: ${real}`);
  const realDir = dirname(real);
  if (realDir === real || realDir === '/') {
    return failed(args, `the real core socket path has no folder of its own to hide: ${real}`);
  }
  // Order matters: hide the real runtime folder; when the proxy path is absolute, hide its
  // host folder too (after the bind, when the socket is live, so the bind resolved its source
  // first); then ~/.ssh and the container sockets, which are independent masks.
  const mounts = ['--tmpfs', realDir];
  const notices = [];
  const proxy = env[PROXY_SOCKET];
  const notice = proxyNotice(proxy);
  if (notice) notices.push(notice);
  if (proxy && isAbsolute(proxy)) {
    const proxyDir = dirname(proxy);
    if (isSameOrAncestor(proxyDir, real)) {
      return failed(args,
        `the proxy folder ${proxyDir} holds the real socket path: the mask would hide the proxy`);
    }
    if (!notice) mounts.push('--bind', proxy, real);
    mounts.push('--tmpfs', proxyDir);
  }
  // ~/.ssh exists on most machines, but a fresh one may have none: then there is nothing to
  // hide. A directory (following symlinks) is shadowed; anything else is bound over.
  const ssh = join(env.HOME, '.ssh');
  try {
    const canonical = realpath(ssh);
    mounts.push(...(stat(canonical).isDirectory()
      ? ['--tmpfs', canonical]
      : ['--bind', '/dev/null', canonical]));
  } catch {
    // No ~/.ssh (or no readable one): add no mask.
  }
  const seen = new Set();
  for (const candidate of containerSockets) {
    if (typeof candidate !== 'string' || !isAbsolute(candidate)) continue;
    let canonical;
    try {
      canonical = realpath(candidate);
      stat(canonical);
    } catch {
      continue;
    }
    if (seen.has(canonical)) continue;
    seen.add(canonical);
    mounts.push('--bind', '/dev/null', canonical);
  }
  return {
    args: [...profileArgs, ...mounts, '--', ...command],
    fatal: null,
    notices,
    masked: true,
  };
}

/** Exec bwrap with inherited stdio, forwarding signals and the child's exit code. */
export function runBwrap(args) {
  const child = spawn('bwrap', args, { stdio: 'inherit', env: process.env });
  const signals = ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGQUIT'];
  const forward = (signal) => {
    try {
      child.kill(signal);
    } catch {
      // The child is already gone; the exit handler below forwards its status.
    }
  };
  for (const signal of signals) process.on(signal, forward);
  const stop = () => {
    for (const signal of signals) process.off(signal, forward);
  };
  child.on('error', (error) => {
    stop();
    process.stderr.write(`${MSG_PREFIX}cannot start bwrap: ${error.message}\n`);
    process.exit(127);
  });
  child.on('exit', (code, signal) => {
    stop();
    if (signal) process.kill(process.pid, signal);
    else process.exit(code ?? 1);
  });
  return child;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = maskArgs(process.argv.slice(2), process.env);
  for (const notice of result.notices) process.stderr.write(`${MSG_PREFIX}${notice}\n`);
  if (result.fatal) {
    process.stderr.write(`${MSG_PREFIX}${result.fatal}\n`);
    process.exit(1);
  }
  runBwrap(result.args);
}
