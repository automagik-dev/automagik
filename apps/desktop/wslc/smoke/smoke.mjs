#!/usr/bin/env node
// The Linux image's smoke (RFC 0016 delivery 2's check), on a CI runner with Docker, never on a
// person's machine. It plays Electron (driver.mjs) against dsh-launch run in the container with
// `docker exec -i`, as the WSLC helper will, and proves five things:
//   1. the image starts: one long-lived container, as user automagik (uid 1000), with its tools;
//   2. dsh-launch prints a valid `ready` (protocol major 1) for the real DSH on 41700, which serves;
//   3. a scripted browser-endpoint request goes round trip: an ipc frame to DSH (the fake DSH,
//      which sends the Bot team's own ds-bot:browser-endpoint request), the framed answer back
//      to it on the launcher's own port, and a connection there through the CDP tunnel; with the
//      relay's echo and `open` (https: only) on the same run;
//   4. closing stdin stops DSH within 5 s (the real DSH; and the fake);
//   5. a staged plugin tarball handed over in the exchange's lane/ is in the profile before DSH
//      starts, with .lane-prev beside it, and a failed trial puts the previous one back.
// Usage: node smoke.mjs <image>
import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { appendFileSync, chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FakeElectron, RELAY_PORT, TOKEN } from './driver.mjs'

const IMAGE = process.argv[2]
if (!IMAGE) throw new Error('usage: node smoke.mjs <image>')
const NAME = `automagik-smoke-${process.pid}`
const VOLUME = `${NAME}-home`
const SMOKE = dirname(fileURLToPath(import.meta.url))
const HOME = '/home/automagik'
const DESKTOP = `${HOME}/.automagik/desktop`
const PROFILE = `${DESKTOP}/dsh/profiles/omni`
const WELCOME = '@automagik/welcome-dsh'
const READY_MS = 240_000
const STOP_LIMIT_MS = 5_000

const work = mkdtempSync(join(tmpdir(), 'automagik-smoke-'))
const exchange = join(work, 'exchange')
for (const dir of [exchange, join(exchange, 'lane'), join(exchange, 'downloads')]) {
  mkdirSync(dir, { recursive: true })
  // The runner's user is not the guest's (uid 1000): the guest must write here too, as it will
  // on the virtiofs mount.
  chmodSync(dir, 0o777)
}

const say = line => console.log(`[smoke] ${line}`)
const docker = (args, options = {}) => execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options })
const inGuest = (...command) => docker(['exec', NAME, ...command]).trim()
const guestOk = (...command) => { try { inGuest(...command); return true } catch { return false } }
const results = []

async function check(number, name, run) {
  const started = Date.now()
  try {
    const detail = await run()
    results.push({ number, name, ok: true, detail })
    say(`CHECK ${number} PASS (${Date.now() - started} ms): ${name}: ${detail}`)
  } catch (error) {
    results.push({ number, name, ok: false, detail: error.message })
    say(`CHECK ${number} FAIL (${Date.now() - started} ms): ${name}: ${error.stack}`)
  }
}

const expect = (condition, message) => { if (!condition) throw new Error(message) }

// One run of dsh-launch, as the helper runs it: `docker exec -i` with piped stdio.
function launch({ fake = false } = {}) {
  const args = ['exec', '-i', ...(fake ? ['-e', 'DSH_LAUNCH_BIN=/opt/smoke/fake-dsh.mjs'] : []), NAME, '/opt/automagik/bin/dsh-launch']
  const child = spawn('docker', args, { stdio: ['pipe', 'pipe', 'pipe'] })
  const electron = new FakeElectron(child)
  child.stderr.on('data', chunk => process.stderr.write(chunk.toString('utf8').replace(/^/gm, fake ? '  [fake dsh] ' : '  [dsh] ')))
  return electron
}

const readyOf = electron => electron.waitFor(frame => frame.type === 'ready', READY_MS, 'ready')
const laneOf = electron => electron.waitFor(frame => frame.type === 'lane' && 'state' in frame, READY_MS, 'the lane frame')
const welcomeVersion = (dir = `${PROFILE}/node_modules/@automagik/welcome-dsh`) => JSON.parse(inGuest('cat', `${dir}/package.json`)).version
const dshRunning = pattern => guestOk('pgrep', '-f', pattern)

async function stopWithin(electron, pattern) {
  const { code, signal, ms } = await electron.close()
  expect(code === 0, `dsh-launch exited with ${signal ?? code}, not 0`)
  expect(ms < STOP_LIMIT_MS, `dsh-launch took ${ms} ms to stop, not under ${STOP_LIMIT_MS}`)
  expect(!dshRunning(pattern), `a process matching ${pattern} still runs in the container`)
  return ms
}

try {
  await check(1, 'the image starts', async () => {
    docker(['volume', 'create', VOLUME])
    docker(['run', '-d', '--name', NAME,
      '-v', `${VOLUME}:${HOME}`,
      '-v', `${exchange}:/mnt/automagik-exchange`,
      '-v', `${SMOKE}:/opt/smoke:ro`,
      IMAGE])
    const user = `${inGuest('id', '-un')} ${inGuest('id', '-u')}`
    expect(user === 'automagik 1000', `the guest user is ${user}, not automagik 1000`)
    const node = inGuest('node', '--version')
    const [major, minor] = node.slice(1).split('.').map(Number)
    expect(major > 22 || (major === 22 && minor >= 19), `Node ${node} is older than 22.19`)
    const pnpm = inGuest('pnpm', '--version')
    expect(/^10\./.test(pnpm), `pnpm ${pnpm} is not pnpm 10`)
    const tools = {
      hc: inGuest('hc', '--version'),
      git: inGuest('git', '--version'),
      bash: inGuest('bash', '-c', 'echo $BASH_VERSION'),
      rg: inGuest('rg', '--version').split('\n')[0],
      bwrap: inGuest('bwrap', '--version'),
      ssh: docker(['exec', NAME, 'sh', '-c', 'ssh -V 2>&1']).trim(),
      tini: inGuest('sh', '-c', 'command -v tini'),
      certificates: inGuest('sh', '-c', 'test -s /etc/ssl/certs/ca-certificates.crt && echo present'),
    }
    expect(guestOk('test', '-x', '/opt/automagik/bin/dsh-launch'), 'no /opt/automagik/bin/dsh-launch')
    expect(inGuest('sh', '-c', 'command -v xdg-open') === '/opt/automagik/bin/xdg-open', 'xdg-open is not the shim')
    expect(guestOk('test', '-w', HOME), `${HOME} is not writable`)
    expect(guestOk('test', '-d', '/mnt/automagik-exchange/lane'), 'no exchange lane/')
    const versions = inGuest('cat', '/opt/automagik/versions.json').replace(/\s+/g, ' ')
    return `${user}; node ${node}; pnpm ${pnpm}; ${Object.entries(tools).map(([name, value]) => `${name}: ${value}`).join('; ')}; versions ${versions}`
  })

  let realStop
  await check(2, 'dsh-launch prints a valid ready for the real DSH', async () => {
    const electron = launch()
    const lane = await laneOf(electron)
    expect(lane.v === 1 && lane.state === 'none', `the first start's lane frame is ${JSON.stringify(lane)}`)
    const ready = await readyOf(electron)
    expect(ready.v === 1, `ready's v is ${ready.v}`)
    expect(ready.port === 41700, `ready's port is ${ready.port}`)
    expect(/^http:\/\/127\.0\.0\.1:41700\/\S*token=\S+$/.test(ready.url), `ready's url is ${ready.url}`)
    expect(electron.protocolError === null, `stdout carried something that is no frame: ${electron.protocolError?.message}`)
    const status = inGuest('node', '-e', 'fetch(process.argv[1]).then(r => console.log(r.status), e => { console.log(e.message); process.exit(1) })', ready.url)
    expect(status === '200', `DSH answered ${status} at its launch URL`)
    const log = inGuest('cat', `${DESKTOP}/logs/dsh.log`)
    expect(log.includes('dsh web: http://127.0.0.1:41700/'), 'the volume\'s dsh.log lacks DSH\'s launch line')
    expect(electron.stderr.includes('dsh web: http://127.0.0.1:41700/'), 'the launcher\'s stderr lacks DSH\'s launch line')
    realStop = await stopWithin(electron, '@deepseek-ai/dsh/lib/bin.js')
    return `ready ${JSON.stringify({ ...ready, url: ready.url.replace(/token=[^&]+/, 'token=<redacted>') })}; GET 200; dsh.log ${log.split('\n').length} lines; stopped in ${realStop} ms`
  })

  let fakeStop
  await check(3, 'a scripted browser-endpoint request goes round trip (ipc relay, CDP tunnel, open)', async () => {
    const electron = launch({ fake: true })
    await readyOf(electron)
    electron.send({ type: 'ipc', message: { type: 'smoke:echo', payload: { text: 'ação', n: 3 } } })
    const echoed = await electron.ipc('smoke:echoed')
    expect(JSON.stringify(echoed.payload) === JSON.stringify({ text: 'ação', n: 3 }), `echo came back as ${JSON.stringify(echoed)}`)
    electron.send({ type: 'ipc', message: { type: 'smoke:endpoint', botId: 'bot-smoke' } })
    const result = await electron.ipc('smoke:endpoint-result', 30_000)
    expect(!result.error, `the endpoint failed: ${result.error}`)
    const url = new URL(result.url)
    expect(url.hostname === '127.0.0.1' && url.port !== String(RELAY_PORT) && url.pathname === `/devtools/browser/${TOKEN}`, `DSH got ${result.url}`)
    expect(result.reply === `relay ${TOKEN}`, `through the tunnel came ${JSON.stringify(result.reply)}`)
    const opened = electron.frames.find(frame => frame.type === 'tunnel' && frame.op === 'open')
    expect(opened?.port === RELAY_PORT, `the tunnel opened to ${JSON.stringify(opened)}`)
    const link = 'https://example.com/sign-in?state=smoke'
    electron.send({ type: 'ipc', message: { type: 'smoke:open', url: link } })
    const shim = await electron.ipc('smoke:open-result')
    expect(shim.code === 0, `xdg-open ${link} exited ${shim.code}: ${shim.stderr}`)
    const open = await electron.waitFor(frame => frame.type === 'open', 10_000, 'the open frame')
    expect(open.url === link, `the open frame is ${JSON.stringify(open)}`)
    const before = electron.frames.filter(frame => frame.type === 'open').length
    electron.send({ type: 'ipc', message: { type: 'smoke:open', url: 'http://example.com/' } })
    const refused = await electron.waitFor(frame => frame.type === 'ipc' && frame.message?.type === 'smoke:open-result' && frame.message.url === 'http://example.com/', 10_000, 'the refused open')
    expect(refused.message.code === 4, `xdg-open http: exited ${refused.message.code}`)
    expect(electron.frames.filter(frame => frame.type === 'open').length === before, 'an http: link reached Electron')
    fakeStop = await stopWithin(electron, '/opt/smoke/fake-dsh.mjs')
    return `ipc echo both ways; DSH's endpoint ${url.protocol}//127.0.0.1:${url.port}${url.pathname.replace(TOKEN, '<token>')}; tunnel to ${RELAY_PORT} replied; https: opened, http: refused (exit 4); stopped in ${fakeStop} ms`
  })

  await check(4, 'closing stdin stops DSH within 5 s', async () => {
    expect(realStop !== undefined, 'the real DSH run did not get to its stop (check 2)')
    expect(fakeStop !== undefined, 'the fake DSH run did not get to its stop (check 3)')
    return `real DSH ${realStop} ms, fake DSH ${fakeStop} ms, limit ${STOP_LIMIT_MS} ms; no DSH process left in the container`
  })

  await check(5, 'a staged plugin tarball is unpacked into the profile; a failed trial restores it', async () => {
    const before = welcomeVersion()
    const [major, minor, patch] = before.split('-')[0].split('.').map(Number)
    const next = `${major}.${minor}.${patch + 1}`
    const file = `automagik-welcome-dsh-${next}.tgz`
    // The welcome as the profile has it, at the next patch version, packed as npm packs it.
    inGuest('sh', '-c', [
      'set -e', 'd=$(mktemp -d)',
      `cp -rL ${PROFILE}/node_modules/@automagik/welcome-dsh "$d/package"`,
      `node -e 'const f=process.argv[1];const p=JSON.parse(require("fs").readFileSync(f,"utf8"));p.version=process.argv[2];require("fs").writeFileSync(f,JSON.stringify(p,null,2))' "$d/package/package.json" ${next}`,
      `tar -czf /mnt/automagik-exchange/lane/${file} -C "$d" package`, 'rm -rf "$d"',
    ].join('; '))
    const bytes = readFileSync(join(exchange, 'lane', file))
    const handoff = {
      v: 1,
      lanes: { automagik: { version: next, sequence: 1 } },
      plugins: [{
        publisher: 'automagik', name: WELCOME, version: next, file, size: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
      }],
    }
    // Electron writes the handoff last, whole.
    writeFileSync(join(exchange, 'lane', 'handoff.json.tmp'), JSON.stringify(handoff))
    execFileSync('mv', [join(exchange, 'lane', 'handoff.json.tmp'), join(exchange, 'lane', 'handoff.json')])

    // The trial start, on the real DSH.
    const trial = launch()
    const lane = await laneOf(trial)
    expect(lane.state === 'applied' && lane.version === next, `the lane frame is ${JSON.stringify(lane)}`)
    expect(welcomeVersion() === next, `the profile's welcome is ${welcomeVersion()}, not ${next}`)
    expect(welcomeVersion(`${PROFILE}/node_modules/@automagik/welcome-dsh.lane-prev`) === before, 'no .lane-prev with the previous welcome')
    expect(!guestOk('test', '-e', '/mnt/automagik-exchange/lane/handoff.json'), 'the handoff was not taken')
    await readyOf(trial)
    trial.send({ type: 'lane', trial: 'failed' })
    const judged = await trial.waitFor(frame => frame.type === 'lane' && frame.trial === 'failed', 10_000, 'the verdict\'s answer')
    expect(judged.recorded === true, `the failed trial was not recorded: ${JSON.stringify(judged)}`)
    await stopWithin(trial, '@deepseek-ai/dsh/lib/bin.js')

    // The next start puts the previous welcome back before DSH.
    const after = launch({ fake: true })
    const back = await laneOf(after)
    expect(back.state === 'restored', `the next start's lane frame is ${JSON.stringify(back)}`)
    expect(welcomeVersion() === before, `the profile's welcome is ${welcomeVersion()} after the restore, not ${before}`)
    expect(!guestOk('test', '-e', `${PROFILE}/node_modules/@automagik/welcome-dsh.lane-prev`), '.lane-prev is still there after the restore')
    await readyOf(after)
    await stopWithin(after, '/opt/smoke/fake-dsh.mjs')
    return `${before} -> ${next} applied before DSH (.lane-prev kept, handoff taken), real DSH ready on it; trial failed -> restored to ${before}, .lane-prev gone`
  })
} finally {
  try { say(`container log:\n${docker(['logs', NAME], { stdio: ['ignore', 'pipe', 'pipe'] })}`) } catch {}
  try { docker(['rm', '-f', NAME]) } catch {}
  try { docker(['volume', 'rm', '-f', VOLUME]) } catch {}
  rmSync(work, { recursive: true, force: true })
}

const lines = results.map(({ number, name, ok, detail }) => `CHECK ${number}/5 ${ok ? 'PASS' : 'FAIL'}: ${name} — ${detail.split('\n')[0]}`)
say(`summary\n${lines.join('\n')}`)
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Linux image smoke\n\n${lines.map(line => `- ${line}`).join('\n')}\n`)
}
const passed = results.filter(result => result.ok).length
if (passed !== 5 || results.length !== 5) {
  console.error(`[smoke] ${passed} of 5 checks passed`)
  process.exit(1)
}
