#!/usr/bin/env node
// Smoke the built server image: no network published, so the checks talk to the container the
// way an operator would. It proves the first start seeds /data and nothing was baked there,
// dsh serves the auth fence (401) on 127.0.0.1:3081, the token never reaches the log, the
// container runs as uid 1000, Docker's health check turns healthy, and a restart does not
// reseed the profile.
//
//   node server/smoke.mjs [automagik-server:local]
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)
const image = process.argv[2] || 'automagik-server:local'
const name = `automagik-server-smoke-${process.pid}`
const volume = `${name}-data`
const gateName = `${name}-gate`
const gateVolume = `${name}-gate-data`
const START_TIMEOUT_MS = 240_000

const docker = async (args, options = {}) => {
  const { stdout, stderr } = await run('docker', args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, ...options })
  return { stdout, stderr }
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const check = (condition, message) => {
  if (!condition) throw new Error(message)
}
const say = (message) => console.log(`[smoke] ${message}`)

async function logsOf() {
  try {
    const { stdout, stderr } = await docker(['logs', name])
    return `${stdout}${stderr}`
  } catch (error) {
    return `${error.stdout ?? ''}${error.stderr ?? ''}`
  }
}

async function healthCode() {
  try {
    const { stdout } = await docker(['exec', name, '/nodejs/bin/node', '/opt/automagik/healthcheck.mjs'])
    return stdout.trim()
  } catch (error) {
    return `${error.stdout ?? ''}`.trim() || '000'
  }
}

async function waitForFence() {
  const started = Date.now()
  while (Date.now() - started < START_TIMEOUT_MS) {
    const status = (await docker(['inspect', name, '--format', '{{.State.Status}}'])).stdout.trim()
    check(status === 'running', `container left running (${status})\n${await logsOf()}`)
    const code = await healthCode()
    if (code === '401') return Date.now() - started
    await sleep(500)
  }
  throw new Error(`no 401 within ${START_TIMEOUT_MS} ms\n${await logsOf()}`)
}

async function waitForHealthy() {
  const started = Date.now()
  while (Date.now() - started < 120_000) {
    const status = (await docker(['inspect', name, '--format', '{{if .State.Health}}{{.State.Health.Status}}{{end}}'])).stdout.trim()
    if (status === 'healthy') return status
    await sleep(1000)
  }
  throw new Error(`Docker's health check did not turn healthy\n${await logsOf()}`)
}

async function main() {
  await docker(['image', 'inspect', image, '--format', '{{.Id}}'])

  // Nothing baked into /data: no profile, and the image runs as the non-root uid. Distroless
  // carries no coreutils, so the uid check is node's own.
  await docker(['run', '--rm', '--entrypoint', '/bin/bash', image, '-c', 'test ! -e /data/dsh/profiles'])
  await docker(['run', '--rm', '--entrypoint', '/nodejs/bin/node', image, '-e', 'process.exit(process.getuid() === 1000 ? 0 : 1)'])

  await docker(['volume', 'create', volume])
  await docker(['run', '--detach', '--name', name, '--volume', `${volume}:/data`,
    '--health-interval', '2s', '--health-timeout', '2s', '--health-retries', '60', '--health-start-period', '0s', image])

  const startTo401 = await waitForFence()
  await waitForHealthy()
  say(`401 after ${startTo401} ms; Docker health: healthy`)

  const logs = await logsOf()
  check(/automagik-web: startup: http:\/\/127\.0\.0\.1:3081\//.test(logs), 'no startup line')
  check(!/(?<![A-Za-z0-9_])token=(?!<redacted>)\S+/.test(logs), 'the launch token is in the log')
  check(/automagik-web: seeded \/data\/dsh\/profiles\/automagik-web/.test(logs), 'the first start did not seed the profile')
  check(/automagik-web: profile automagik-web: automagik \d+\.\d+\.\d+, dsh \d+\.\d+\.\d+/.test(logs), 'no version line')
  check(!/failed to import|ERR_MODULE_NOT_FOUND/.test(logs), 'a composed plugin failed to import')
  // The real token from the 0600 launch file must not be in the log, not merely a pattern.
  const launch = (await docker(['exec', name, '/nodejs/bin/node', '-e', 'process.stdout.write(require("fs").readFileSync("/data/dsh/launch-url","utf8"))'])).stdout.trim()
  const token = new URL(launch).searchParams.get('token')
  check(token && token.length >= 16, `launch-url carries no token: ${launch}`)
  check(!logs.includes(token), 'the real launch token is in the log')

  await docker(['exec', name, '/bin/bash', '-c', 'test -f /data/dsh/profiles/automagik-web/package.json'])
  await docker(['exec', name, '/bin/bash', '-c', 'test -f /data/dsh/profiles/automagik-web/node_modules/@automagik/bots-dsh/package.json'])
  await docker(['exec', name, '/bin/bash', '-c', 'test -f /data/dsh/profiles/automagik-web/node_modules/@automagik/welcome-dsh/package.json'])
  await docker(['exec', name, '/bin/bash', '-c', 'test -f /data/dsh/profiles/automagik-web/node_modules/@automagik/acp-dsh/package.json'])
  await docker(['exec', name, '/bin/bash', '-c', 'test -f /data/dsh/launch-url'])
  const mode = (await docker(['exec', name, '/nodejs/bin/node', '-e', 'process.stdout.write((require("fs").statSync("/data/dsh/launch-url").mode & 0o777).toString(8))'])).stdout.trim()
  check(mode === '600', `launch-url is ${mode}, not 600`)
  const uid = (await docker(['exec', name, '/nodejs/bin/node', '-e', 'process.stdout.write(String(process.getuid()))'])).stdout.trim()
  check(uid === '1000', `runs as uid ${uid}, not 1000`)

  // The pruned runtime must still compose the whole automagik-web tree: the five bundles and
  // the entries DSH pulls in beside them, office-to-pdf included.
  const config = (await docker(['exec', name, 'dsh', '--profile', 'automagik-web', '--dump-config'])).stdout
  const entries = (config.match(/^- id:/gm) ?? []).length
  check(entries >= 190, `composed only ${entries} entries`)
  // dsh-base is a bundle patch, not an entry: it shows only through the entries it adds.
  for (const plugin of ['@automagik/bots-dsh', '@automagik/welcome-dsh', '@automagik/acp-dsh',
    '@deepseek-ai/dsh-web-app', '@deepseek-ai/dsh-office-to-pdf']) {
    check(config.includes(`name: '${plugin}'`) || config.includes(`name: "${plugin}"`), `${plugin} is not composed`)
  }
  say(`seeded profile, three plugins, 600 launch URL, uid 1000, ${entries} composed entries`)

  // The distroless base is older glibc than the builder: exercise both native modules.
  const native = "const k=require('/opt/automagik/runtime/node_modules/koffi');const p=require('/opt/automagik/runtime/node_modules/node-pty');const t=p.spawn('/bin/sh',['-c','echo native-ok'],{name:'xterm',cols:80,rows:24,cwd:'/tmp',env:process.env});let o='';t.onData((d)=>{o+=d});t.onExit(()=>process.exit(o.includes('native-ok')&&typeof k.version==='string'?0:1));setTimeout(()=>process.exit(1),5000)"
  await docker(['exec', name, '/nodejs/bin/node', '-e', native])
  say('native modules: koffi and node-pty load and spawn')

  // A restart keeps the user's profile: the seed runs only where nothing is.
  await docker(['restart', name])
  const restarted401 = await waitForFence()
  const after = await logsOf()
  check((after.match(/automagik-web: seeded /g) ?? []).length === 1, 'a restart reseeded the profile')
  check(/automagik-web: profile present at \/data\/dsh\/profiles\/automagik-web/.test(after), 'a restart did not find the profile')
  say(`restart: 401 after ${restarted401} ms, profile kept`)

  // The opt-in gate shares the namespace, never its writable state. No public port.
  await docker(['volume', 'create', gateVolume])
  await docker(['run', '--detach', '--name', gateName, '--network', `container:${name}`,
    '--volume', `${gateVolume}:/data`, '--volume', `${volume}:/dsh:ro`,
    '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true',
    '--env', 'AUTOMAGIK_GATE_ENABLED=1', '--env', 'AUTOMAGIK_GATE_ORIGIN=http://localhost:3082',
    '--health-interval', '2s', '--health-start-period', '0s',
    '--entrypoint', '/nodejs/bin/node', image, '/opt/automagik/gate-entrypoint.mjs'])
  const gateDeadline = Date.now() + 30_000
  let gateHealthy = false
  while (Date.now() < gateDeadline) {
    const status = (await docker(['inspect', gateName, '--format', '{{.State.Health.Status}}'])).stdout.trim()
    if (status === 'healthy') { gateHealthy = true; break }
    check((await docker(['inspect', gateName, '--format', '{{.State.Status}}'])).stdout.trim() === 'running', 'gate stopped')
    await sleep(200)
  }
  check(gateHealthy, 'gate health never reached healthy 401')
  const gateConfig = JSON.parse((await docker(['inspect', gateName])).stdout)[0]
  const dshConfig = JSON.parse((await docker(['inspect', name])).stdout)[0]
  check(gateConfig.HostConfig.NetworkMode === `container:${dshConfig.Id}`, 'gate does not share only the DSH network namespace')
  check(gateConfig.Mounts.some(m => m.Name === volume && m.Destination === '/dsh' && !m.RW), 'gate DSH mount is not read-only')
  check(gateConfig.Mounts.some(m => m.Name === gateVolume && m.Destination === '/data' && m.RW), 'gate has no separate writable store')
  check(!dshConfig.Mounts.some(m => m.Name === gateVolume), 'DSH mounts the gate store')
  await docker(['exec', gateName, '/nodejs/bin/node', '-e', 'const fs=require("fs");fs.accessSync("/dsh/dsh/launch-url");fs.writeFileSync("/data/gate-only", "private");try{fs.writeFileSync("/dsh/gate-write-probe", "bad");process.exit(1)}catch(e){if(e.code!=="EROFS")throw e}'])
  await docker(['exec', name, '/nodejs/bin/node', '-e', 'const fs=require("fs");try{fs.readFileSync("/data/gate-only");process.exit(1)}catch(e){if(e.code!=="ENOENT")throw e}'])
  await docker(['exec', gateName, '/nodejs/bin/node', '/opt/automagik/healthcheck.mjs'])
  say('gate: 401 healthy, separate store invisible to DSH, DSH mount read-only')
  await docker(['rm', '--force', gateName])

  // The key file: 0400 is taken, anything group- or other-readable stops the start.
  await docker(['exec', name, '/nodejs/bin/node', '-e', 'const fs=require("fs"); fs.writeFileSync("/data/secrets/deepseek-api-key", "sk-smoke\\n", { mode: 0o400 }); fs.chmodSync("/data/secrets/deepseek-api-key", 0o400)'])
  await docker(['restart', name])
  await waitForFence()
  check(/automagik-web: model key from \/data\/secrets\/deepseek-api-key/.test(await logsOf()), 'the 0400 key file was not used')
  await docker(['exec', name, '/nodejs/bin/node', '-e', 'require("fs").chmodSync("/data/secrets/deepseek-api-key", 0o644)'])
  await docker(['restart', name])
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const status = (await docker(['inspect', name, '--format', '{{.State.Status}}'])).stdout.trim()
    if (status === 'exited') break
    await sleep(200)
  }
  check((await docker(['inspect', name, '--format', '{{.State.Status}}'])).stdout.trim() === 'exited', 'a 0644 key file did not stop the start')
  check(/the key file must be 0400 or 0600/.test(await logsOf()), 'no explanation for the refused key file')
  say('key file: 0400 used, 0644 refused')

  console.log(`SMOKE OK image=${image} health=401 start_to_401_ms=${startTo401} uid=1000`)
}

try {
  await main()
} catch (error) {
  console.error(`[smoke] FAILED: ${error?.stack ?? error}`)
  try {
    console.error(`[smoke] last logs:\n${(await logsOf()).split('\n').slice(-60).join('\n')}`)
  } catch {}
  process.exitCode = 1
} finally {
  await docker(['rm', '--force', gateName]).catch(() => {})
  await docker(['volume', 'rm', '--force', gateVolume]).catch(() => {})
  await docker(['rm', '--force', name]).catch(() => {})
  await docker(['volume', 'rm', '--force', volume]).catch(() => {})
}
