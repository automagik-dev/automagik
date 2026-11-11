import { spawn as spawnChild } from 'node:child_process'
import { randomBytes as cryptoRandomBytes } from 'node:crypto'
import net from 'node:net'
import { HERMES_DEADLINES } from './hermes-transport.js'

const messages = Object.freeze({
  'host-key-changed': 'SSH host key is unknown or has changed. Connect once in a terminal and verify the host key before trying again.',
  'auth-failed': 'SSH key authentication failed. Check the SSH alias or identity file and load your key into your SSH agent.',
  'interactive-auth': 'SSH requires an interactive check. Complete it once in a terminal, then try this connection again.',
  'hermes-not-found': 'Hermes was not found on the remote computer. Install it there or check the Hermes executable path.',
  'update-required': 'Update Hermes on the remote computer. SSH connections require the isolated server ownership and token-file options.',
  'unsupported-platform': 'This SSH connection requires a Linux or macOS remote with Python 3 and an existing Hermes installation.',
  timeout: 'SSH did not become ready within the connection deadline. Check the remote computer and try again.',
  unreachable: 'SSH could not reach the remote computer. Check the SSH alias, network, port, and installed SSH client.',
  unknown: 'SSH could not start the remote Hermes connection. Check the connection details and try again.',
})
const publicCodes = { 'host-key-changed': 'bot/hermes-ssh-host-key', 'auth-failed': 'bot/hermes-ssh-auth', 'hermes-not-found': 'bot/hermes-ssh-missing' }
const cleanupMessage = 'Remote Hermes cleanup could not be confirmed. Check the remote computer before connecting again; background remote work may continue.'
const failure = (kind, text = messages[kind] ?? messages.unknown) => Object.assign(new Error(text), { code: publicCodes[kind] ?? 'bot/hermes-ssh', sshError: kind })
const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  // Startup can be cancelled before its next stage begins awaiting this promise.
  void promise.catch(() => {})
  return { promise, resolve, reject }
}
const quote = value => `'${String(value).replaceAll("'", "'\\''")}'`
const safeField = value => typeof value === 'string' && value.length <= 4096 && !/[\x00-\x1f\x7f]/.test(value)

function destination(input) {
  if (!input || typeof input !== 'object') throw failure('unknown', 'Enter an SSH host or config alias.')
  let host = typeof input.host === 'string' ? input.host.trim() : ''
  let user = typeof input.user === 'string' ? input.user.trim() : ''
  if (host.includes('@')) {
    const parts = host.split('@')
    if (parts.length !== 2) throw failure('unknown', 'Enter a valid SSH host or config alias.')
    user ||= parts[0]
    host = parts[1]
  }
  if (!host || host.startsWith('-') || !/^[a-zA-Z0-9_.:[\]-]+$/.test(host)
    || (user && (!/^[a-zA-Z0-9_.-]+$/.test(user) || user.startsWith('-')))) throw failure('unknown', 'Enter a valid SSH host or config alias and user.')
  const args = []
  if (input.port !== undefined && input.port !== null && input.port !== '') {
    if (!/^\d+$/.test(String(input.port)) || !Number.isSafeInteger(Number(input.port)) || Number(input.port) < 1 || Number(input.port) > 65535) throw failure('unknown', 'Enter a valid SSH port.')
    args.push('-p', String(Number(input.port)))
  }
  for (const name of ['identityFile', 'hermesPath']) if (input[name] !== undefined && input[name] !== '' && !safeField(input[name])) throw failure('unknown', 'Enter a valid identity file or remote Hermes path.')
  if (input.identityFile) {
    if (input.identityFile.startsWith('-')) throw failure('unknown', 'Enter a valid identity file path.')
    args.push('-i', input.identityFile)
  }
  return { args, target: user ? `${user}@${host}` : host, hermesPath: input.hermesPath || '' }
}

// This is our POSIX remote supervisor, not upstream code. Its private stdin owns the
// lease: EOF, close, a signal or expired heartbeats stops the child it launched.
// Never forward Hermes output: only bounded protocol records reach the local host.
const supervisor = String.raw`
import json, os, re, select, shutil, signal, subprocess, sys, tempfile, time
class Stop(Exception): pass
class Fault(Exception):
    def __init__(self, code): self.code = code
child = None
folder = None
nonce = ""
clean = True
last_ping = time.monotonic()
control = 15.0
grace = 3.0

def emit(kind, **values):
    try:
        print(json.dumps(dict(type=kind, nonce=nonce, **values)), flush=True)
    except (BrokenPipeError, OSError):
        pass

def interrupted(signum, frame): raise Stop()
for sig in (signal.SIGTERM, signal.SIGHUP, signal.SIGINT): signal.signal(sig, interrupted)

def check_input():
    global last_ping
    while select.select([sys.stdin.fileno()], [], [], 0)[0]:
        data = os.read(sys.stdin.fileno(), 8192)
        if not data or b"close" in data: raise Stop()
        last_ping = time.monotonic()
    if time.monotonic() - last_ping > control: raise Stop()

def probe(argv):
    check_input()
    try:
        result = subprocess.run(argv, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                                stderr=subprocess.DEVNULL, timeout=control, check=False)
    except subprocess.TimeoutExpired:
        raise Fault("timeout")
    check_input()
    return result.stdout[:65536].decode("utf-8", "replace").strip() if result.returncode == 0 else ""

try:
    initial = bytearray()
    while not initial.endswith(b"\n"):
        part = os.read(sys.stdin.fileno(), 1)
        if not part: raise Stop()
        initial.extend(part)
        if len(initial) > 16384: raise Fault("unknown")
    options = json.loads(initial)
    nonce = options["nonce"]
    token = options["credential"]
    if not re.fullmatch(r"[0-9a-f]{16}", nonce) or not re.fullmatch(r"[0-9a-f]{64}", token): raise Fault("unknown")
    control = max(0.05, float(options["controlMs"]) / 1000)
    grace = max(0.05, float(options["cancelMs"]) / 1000 * 0.6)
    until = time.monotonic() + float(options["startMs"]) / 1000
    if sys.platform not in ("linux", "darwin"): raise Fault("unsupported-platform")
    explicit = options.get("hermesPath", "")
    if explicit:
        candidates = [os.path.expanduser(explicit)]
    else:
        located = probe(["bash", "-lc", "command -v hermes"])
        candidates = ([located.splitlines()[-1]] if located else []) + [os.path.expanduser("~/.local/bin/hermes"), "/usr/local/bin/hermes", os.path.expanduser("~/.hermes/hermes-agent/venv/bin/hermes")]
    hermes = next((p for p in candidates if os.path.isfile(p) and os.access(p, os.X_OK)), None)
    if not hermes: raise Fault("hermes-not-found")
    help_text = probe([hermes, "serve", "--help"])
    if "--ssh-session-token-file" not in help_text or "--ssh-owner-nonce" not in help_text: raise Fault("update-required")
    check_input()
    folder = tempfile.mkdtemp(prefix="automagik-hermes-")
    token_path = os.path.join(folder, "session.token")
    fd = os.open(token_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w") as handle: handle.write(token)
    env = os.environ.copy()
    env["HERMES_DESKTOP"] = "1"
    env.pop("HERMES_DESKTOP_DEV_SERVER", None)
    check_input()
    child = subprocess.Popen([hermes, "serve", "--isolated", "--host", "127.0.0.1", "--port", "0", "--ssh-session-token-file", token_path, "--ssh-owner-nonce", nonce], stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, start_new_session=True, env=env)
    output = b""
    ready = False
    output_open = True
    while child.poll() is None:
        check_input()
        if not ready and time.monotonic() >= until: raise Fault("timeout")
        readable, _, _ = select.select([sys.stdin] + ([child.stdout] if output_open else []), [], [], min(control / 4, 0.25))
        if sys.stdin in readable: check_input()
        if child.stdout in readable:
            data = os.read(child.stdout.fileno(), 8192)
            if not data: output_open = False
            output = (output + data)[-65536:]
            if not ready:
                found = re.search(rb"HERMES_DASHBOARD_READY port=([0-9]+)(?:\r?\n)", output)
                if found:
                    port = int(found.group(1))
                    if not 0 < port < 65536: raise Fault("unknown")
                    ready = True
                    emit("ready", port=port)
    if not ready: raise Fault("unknown")
except Stop:
    pass
except Fault as error:
    emit("error", code=error.code)
except Exception:
    emit("error", code="unknown")
finally:
    for sig in (signal.SIGTERM, signal.SIGHUP, signal.SIGINT): signal.signal(sig, signal.SIG_IGN)
    if child is not None and child.poll() is None:
        try:
            os.killpg(child.pid, signal.SIGTERM)
            try: child.wait(timeout=grace)
            except subprocess.TimeoutExpired:
                os.killpg(child.pid, signal.SIGKILL)
                child.wait(timeout=max(0.05, grace / 4))
        except (OSError, subprocess.TimeoutExpired): clean = child.poll() is not None
    if folder:
        try: shutil.rmtree(folder)
        except OSError: clean = False
    emit("closed", clean=clean)
`

function sshFailure(stderr) {
  if (/REMOTE HOST IDENTIFICATION HAS CHANGED|Host key verification failed|No .*host key is known|strict checking/i.test(stderr)) return failure('host-key-changed')
  if (/interactive|verification|two.factor|tailscale.*check/i.test(stderr)) return failure('interactive-auth')
  if (/Permission denied|Authentication failed|no supported authentication/i.test(stderr)) return failure('auth-failed')
  if (/python3.*(not found|not recognized)|No such file.*python3/i.test(stderr)) return failure('unsupported-platform')
  if (/timed out|timeout/i.test(stderr)) return failure('timeout')
  if (/resolve hostname|Connection refused|Network is unreachable|No route to host|ENOENT/i.test(stderr)) return failure('unreachable')
  return failure('unknown')
}

async function allocateLoopbackPort() {
  const server = net.createServer()
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
    return server.address().port
  } finally { if (server.listening) await new Promise(resolve => server.close(resolve)) }
}

/** A trusted factory: callers may allow its numeric-loopback HTTP address only. */
export async function startHermesSsh(ssh, {
  signal, deadlines = HERMES_DEADLINES, spawn = spawnChild, allocatePort = allocateLoopbackPort,
  sshCommand = 'ssh', env = process.env, randomBytes = cryptoRandomBytes,
} = {}) {
  const config = destination(ssh)
  const limits = { ...HERMES_DEADLINES, ...deadlines }
  const until = Date.now() + limits.start
  const credential = randomBytes(32).toString('hex'), nonce = randomBytes(8).toString('hex')
  const ready = deferred(), forwarded = deferred(), cancelled = deferred()
  const children = []
  let remote, tunnel, heartbeat, closing, stopping = false, clean = false, sawProtocol = false, noRemote = false
  let inputSent = false, readySeen = false
  const common = ['-T', '-v', '-o', 'BatchMode=yes', '-o', 'PasswordAuthentication=no', '-o', 'KbdInteractiveAuthentication=no', '-o', 'PreferredAuthentications=publickey', '-o', 'StrictHostKeyChecking=yes', '-o', 'ExitOnForwardFailure=yes', '-o', 'ControlMaster=no', '-o', 'ControlPath=none', '-o', 'ControlPersist=no', '-o', 'ConnectionAttempts=1', '-o', `ConnectTimeout=${Math.max(1, Math.ceil(limits.control / 1000))}`, '-o', `ServerAliveInterval=${Math.max(1, Math.floor(limits.control / 3000))}`, '-o', 'ServerAliveCountMax=2', ...config.args]
  const bounded = async (promise, ms, interruptible = true) => {
    let timer
    try { return await Promise.race([promise, ...(interruptible ? [cancelled.promise] : []), new Promise((_, reject) => { timer = setTimeout(() => reject(failure('timeout')), Math.max(1, ms)) })]) }
    finally { clearTimeout(timer) }
  }
  const fail = error => {
    cancelled.reject(error); ready.reject(error); forwarded.reject(error)
    if (!stopping) void close().catch(() => {})
  }
  const launch = args => {
    const child = spawn(sshCommand, args, { env: { ...env, LC_ALL: 'C' }, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    const ended = deferred()
    const entry = { child, ended: ended.promise, stderr: '', commandSent: false }
    children.push(entry)
    child.on('error', () => { noRemote ||= child === remote && !child.pid; ended.resolve(); fail(failure('unreachable')) })
    child.on('close', code => {
      ended.resolve()
      if (!stopping) {
        const error = sshFailure(entry.stderr)
        if (child === remote && !sawProtocol && !entry.commandSent && code === 255 && ['host-key-changed', 'auth-failed', 'interactive-auth', 'unreachable', 'unsupported-platform'].includes(error.sshError)) noRemote = true
        fail(error)
      }
    })
    // Authentication failure can close stdin before SSH's actionable stderr/exit.
    // The close handler (or the bounded stage deadline) owns that verdict.
    child.stdin.on('error', () => {})
    child.stderr.on('data', data => {
      const text = String(data)
      entry.commandSent ||= /Sending command:/.test(text)
      entry.stderr = (entry.stderr + text).slice(-65536)
      if (child === tunnel && /Local forwarding listening on 127\.0\.0\.1 port (\d+)\./.test(entry.stderr)) {
        const port = Number(/Local forwarding listening on 127\.0\.0\.1 port (\d+)\./.exec(entry.stderr)[1])
        if (port === entry.localPort) forwarded.resolve()
      }
    })
    return entry
  }
  const exit = () => {
    try { remote?.stdin.destroy(); remote?.kill('SIGTERM'); tunnel?.kill('SIGTERM') } catch {}
  }
  function close() {
    if (closing) return closing
    stopping = true
    clearInterval(heartbeat)
    signal?.removeEventListener('abort', abort)
    process.removeListener('exit', exit)
    closing = (async () => {
      try { remote?.stdin.end('close\n') } catch {}
      try { tunnel?.kill('SIGTERM') } catch {}
      const stopUntil = Date.now() + limits.cancel
      const ended = Promise.all(children.map(entry => entry.ended))
      let stopped = false
      try { await bounded(ended, limits.cancel * 0.8, false); stopped = true } catch {}
      if (!stopped) {
        for (const entry of children) { try { entry.child.kill('SIGKILL') } catch {} }
        try { await bounded(ended, stopUntil - Date.now(), false); stopped = true } catch {}
      }
      if (!stopped || (inputSent && !clean && !noRemote)) throw Object.assign(failure('unknown', cleanupMessage), { cleanupUnknown: true })
    })()
    return closing
  }
  const abort = () => { fail(failure('unknown', 'SSH connection was cancelled.')) }
  if (signal?.aborted) throw failure('unknown', 'SSH connection was cancelled.')
  signal?.addEventListener('abort', abort, { once: true })
  process.once('exit', exit)
  try {
    const remoteEntry = launch([...common, '--', config.target, `exec python3 -u -c ${quote(supervisor)}`])
    remote = remoteEntry.child
    let carry = ''
    remote.stdout.on('data', chunk => {
      carry += String(chunk)
      if (Buffer.byteLength(carry) > 65536) { carry = ''; fail(failure('unknown')); return }
      let newline
      while ((newline = carry.indexOf('\n')) >= 0) {
        const line = carry.slice(0, newline); carry = carry.slice(newline + 1)
        let frame
        try { frame = JSON.parse(line) } catch { continue } // Ignore login-shell banners.
        if (!frame || typeof frame !== 'object' || frame.nonce !== nonce) { fail(failure('unknown')); return }
        sawProtocol = true
        if (frame.type === 'ready' && !readySeen && Number.isSafeInteger(frame.port) && frame.port > 0 && frame.port < 65536) { readySeen = true; ready.resolve(frame.port) }
        else if (frame.type === 'closed' && typeof frame.clean === 'boolean') clean = frame.clean
        else if (frame.type === 'error' && Object.hasOwn(messages, frame.code)) fail(failure(frame.code))
        else { fail(failure('unknown')); return }
      }
    })
    inputSent = true
    remote.stdin.write(`${JSON.stringify({ nonce, credential, hermesPath: config.hermesPath, startMs: limits.start, controlMs: limits.control, cancelMs: limits.cancel })}\n`)
    heartbeat = setInterval(() => { if (!stopping) { try { remote.stdin.write('ping\n') } catch { fail(failure('unknown')) } } }, Math.max(10, Math.floor(limits.control / 3)))
    const remotePort = await bounded(ready.promise, until - Date.now())
    const localPort = await bounded(Promise.resolve(allocatePort()), Math.min(limits.control, until - Date.now()))
    if (stopping || signal?.aborted) throw failure('unknown', 'SSH connection was cancelled.')
    if (!Number.isSafeInteger(localPort) || localPort < 1 || localPort > 65535) throw failure('unknown')
    const tunnelEntry = launch([...common, '-N', '-L', `127.0.0.1:${localPort}:127.0.0.1:${remotePort}`, '--', config.target])
    tunnel = tunnelEntry.child
    tunnelEntry.localPort = localPort
    tunnel.stdout.resume()
    await bounded(forwarded.promise, Math.min(limits.control, until - Date.now()))
    if (stopping || remote.exitCode !== null || tunnel.exitCode !== null) throw failure('unknown')
    return { address: `http://127.0.0.1:${localPort}`, credential, close }
  } catch (error) {
    let cleanupUnknown = false
    try { await close() } catch { cleanupUnknown = true }
    const safe = error?.code?.startsWith('bot/hermes-ssh') ? error : failure('unknown')
    if (cleanupUnknown) { safe.message += ` ${cleanupMessage}`; safe.cleanupUnknown = true }
    throw safe
  }
}
