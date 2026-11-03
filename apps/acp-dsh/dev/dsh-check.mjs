#!/usr/bin/env node
// RFC 0003 delivery 2's check on a real DSH: a Session on the fake agent streams text, shows a
// tool card and asks through DSH's approval service. It installs this plugin into a profile in
// a temporary DSH home the way DSH installs any plugin (`dsh plugin install`, pnpm), runs one
// `dsh headless` turn on acp-fake, and reads the proof from the Session's own log: the
// assistant text, a tool/call of the mirror tool with its tool/result, and the approval/asked
// and approval/decided pair for that call. Headless has no dialog, so a test-only answerer
// allows the ask; the web UI's dialog is the same approval/request waterfall.
//
//   node dev/dsh-check.mjs [--agent fake|claude|codex] [--keep <dir>]
//
// --agent claude or codex (delivery 3) runs the person's own CLI through the newest release of its
// ACP adapter, installed first by the plugin's own AdapterStore into the temporary Automagik
// home. The turn asks the agent to run one shell command that writes a file, which the agent
// must ask for; it costs a few of that agent's tokens.
//
// Needs `bun install` and `bun run harness` here, and network for pnpm.
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { zstdDecompressSync } from 'node:zlib'
import { join, resolve } from 'node:path'

const PLUGIN = resolve(import.meta.dirname, '..')
const DSH_BIN = join(PLUGIN, 'dev', 'harness', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
const FAKE = join(PLUGIN, 'test', 'fixtures', 'fake-agent.mjs')
const args = process.argv.slice(2)
const AGENT = args.includes('--agent') ? args[args.indexOf('--agent') + 1] : 'fake'
if (!['fake', 'claude', 'codex'].includes(AGENT)) throw new Error(`--agent fake, claude or codex, not ${AGENT}`)
const keep = args.includes('--keep') ? resolve(args[args.indexOf('--keep') + 1]) : undefined
const say = line => console.log(`[dsh-check] ${line}`)
const env = { ...process.env, DO_NOT_TRACK: '1', npm_config_fund: 'false', npm_config_audit: 'false', npm_config_update_notifier: 'false' }

const work = keep ?? mkdtempSync(join(tmpdir(), 'acp-dsh-check-'))
rmSync(work, { recursive: true, force: true })
const dshHome = join(work, 'dsh')
const profile = join(dshHome, 'profiles', 'acp')
mkdirSync(join(profile, 'vendor'), { recursive: true })

// The test-only answerer: allows every ask, as a person clicking Allow would.
const approver = join(work, 'approver')
mkdirSync(approver, { recursive: true })
writeFileSync(join(approver, 'package.json'), JSON.stringify({ name: 'acp-e2e-approver', version: '1.0.0', type: 'module', main: 'index.js', dsh: { bundle: { patch: './cordis.patch.yml' } } }))
writeFileSync(join(approver, 'index.js'), "export const name = 'acp-e2e-approver'\nexport function apply(ctx) { ctx.on('approval/request', () => Promise.resolve('allowed-once')) }\n")
writeFileSync(join(approver, 'cordis.patch.yml'), "- insert:\n    - id: acp-e2e-approver\n      name: 'acp-e2e-approver'\n")

const [packed] = JSON.parse(execFileSync('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', join(profile, 'vendor')], { cwd: PLUGIN, env, encoding: 'utf8' }))
say(`packed ${packed.name}@${packed.version}`)
writeFileSync(join(profile, 'package.json'), `${JSON.stringify({
  name: 'acp-dsh-check',
  private: true,
  dependencies: { '@automagik/acp-dsh': `file:vendor/${packed.filename}`, 'acp-e2e-approver': `file:${approver}` },
  dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-headless', '@automagik/acp-dsh', 'acp-e2e-approver'] } },
}, null, 2)}\n`)
// The desktop profile's pnpm settings: DSH supplies the @deepseek-ai peers, pnpm must not fetch them.
copyFileSync(join(PLUGIN, '..', 'desktop', 'profile', 'pnpm-workspace.yaml'), join(profile, 'pnpm-workspace.yaml'))
const shims = join(work, 'bin')
mkdirSync(shims, { recursive: true })
writeFileSync(join(shims, 'pnpm'), '#!/bin/sh\nexec npx --yes pnpm@10.34.6 "$@"\n', { mode: 0o755 })
const dshEnv = { ...env, DSH_HOME: dshHome, AUTOMAGIK_HOME: join(work, 'automagik'), PATH: `${shims}:${env.PATH}` }
execFileSync(process.execPath, [DSH_BIN, 'plugin', '--profile', 'acp', 'install', '--prod', '--ignore-scripts'], { cwd: profile, env: dshEnv, stdio: ['ignore', 'inherit', 'inherit'] })

const ROUTE = { fake: { provider: 'acp-fake', model: 'fake' }, claude: { provider: 'acp-claude', model: 'default' }, codex: { provider: 'acp-codex', model: 'default' } }[AGENT]
// Claude Code in Manual mode asks before any write; Codex in its workspace sandbox (DSH's own
// workspace-write level) writes inside the folder (and the temp folders) unasked, as DSH's own
// tools do, and asks for the network.
const TASK = {
  fake: 'hello there',
  claude: 'Use your shell tool to run exactly this one command: touch acp-dsh-ok.txt && echo acp-dsh-ok. Then reply with what it printed and nothing else.',
  codex: "Use your shell tool to run exactly this one command: curl -s -o /dev/null https://example.com && echo acp-dsh-ok. If the sandbox blocks network access, request approval to run it outside the sandbox. Then reply with what it printed and nothing else.",
}[AGENT]
if (AGENT !== 'fake') {
  const { AGENTS } = await import('../src/host/agents.js')
  const { AdapterStore, adaptersHome } = await import('../src/host/install.js')
  const spec = AGENTS[ROUTE.provider]
  const bin = await new AdapterStore({ home: adaptersHome(dshEnv), env: dshEnv }).update(spec.adapter, spec.bin, { force: true })
  say(`installed ${spec.adapter}@${bin.version}`)
}
const overlay = join(work, 'check.patch.yml')
writeFileSync(overlay, [
  '- id: acp-dsh',
  '  config:',
  `    fakeAgent: ${JSON.stringify(FAKE)}`,
  `    claude: ${AGENT === 'claude'}`,
  `    codex: ${AGENT === 'codex'}`,
  '- id: agent-default-model',
  '  config:',
  `    provider: ${ROUTE.provider}`,
  `    model: ${ROUTE.model}`,
  '',
].join('\n'))
const project = join(work, 'project')
mkdirSync(project, { recursive: true })
let failed = []
try {
  const out = execFileSync(process.execPath, [DSH_BIN, '--profile', 'acp', '--patch', overlay, '--json', TASK], { cwd: project, env: dshEnv, encoding: 'utf8', timeout: AGENT === 'fake' ? 120_000 : 300_000, stdio: ['ignore', 'pipe', 'pipe'] })
  say(`headless printed ${out.split('\n').filter(Boolean).length} run events`)
} catch (error) {
  console.error(error.stdout?.slice(-3000), error.stderr?.slice(-3000))
  failed.push(`dsh headless failed: ${error.message.split('\n')[0]}`)
}

// DSH appends one zstd frame per write; Node decodes only the first frame of a buffer, so each
// frame is cut at the next magic number and decoded alone (a cut that lands inside a frame's
// data fails to decode and is joined to the next piece).
const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
function unzstd(raw) {
  const starts = []
  for (let at = raw.indexOf(MAGIC); at !== -1; at = raw.indexOf(MAGIC, at + 1)) starts.push(at)
  const out = []
  let from = 0
  for (let i = 1; i <= starts.length; i++) {
    const end = i < starts.length ? starts[i] : raw.length
    try {
      out.push(zstdDecompressSync(raw.subarray(starts[from], end)))
      from = i
    } catch {}
  }
  return Buffer.concat(out)
}

// The Session's log: the newest session log under the DSH home (zstd-compressed since format v4).
const logs = []
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (name === 'node_modules') continue
    if (statSync(path).isDirectory()) walk(path)
    else if (/\.jsonl(\.zstd)?$/.test(name)) logs.push(path)
  }
}
walk(dshHome)
const log = logs.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0]
if (!log) failed.push('no Session log was written')
else {
  const raw = readFileSync(log)
  const rows = (log.endsWith('.zstd') ? unzstd(raw) : raw).toString('utf8').split('\n').filter(Boolean).map(line => JSON.parse(line))
  const of = type => rows.filter(row => row.type === type)
  // The call the agent asked about (an agent may first try a call its sandbox refuses), else its first.
  const calls = of('tool/call').filter(row => row.data?.name === 'acp_tool')
  const asked = of('approval/asked').find(row => calls.some(c => c.data.callId === row.data?.callId))
  const call = calls.find(c => c.data.callId === asked?.data?.callId) ?? calls[0]
  const result = call && of('tool/result').find(row => row.data?.message?.toolCallId === call.data.callId)
  const decided = asked && of('approval/decided').find(row => row.data?.id === asked.data.id)
  const text = of('assistant/message').flatMap(row => row.data?.message?.content ?? []).filter(block => block.type === 'text').map(block => block.text).join('')
  if (AGENT === 'fake' && !/you said "hello there"/.test(text)) failed.push(`the agent's text is not in the log: ${JSON.stringify(text.slice(0, 200))}`)
  if (!call) failed.push('no tool/call of acp_tool')
  else if (AGENT === 'fake' && JSON.parse(call.data.arguments).title !== 'Run echo hello 1') failed.push(`the card is not the agent's call: ${call.data.arguments}`)
  if (call && !result) failed.push('no tool/result for the call')
  if (!asked) failed.push('no approval/asked for the call')
  if (decided?.data?.outcome !== 'allowed-once') failed.push(`approval/decided is ${decided?.data?.outcome}`)
  const done = AGENT === 'fake' ? /It printed hello 1\./ : /acp-dsh-ok/
  if (!done.test(text)) failed.push('the agent did not go on after the result')
  if (result) say(`tool/result ${JSON.stringify(result.data?.message?.content ?? result.data).slice(0, 300)}`)
  for (const row of of('turn/end')) say(`turn/end ${JSON.stringify(row.data).slice(0, 300)}`)
  say(`log ${log.slice(dshHome.length + 1)}: ${rows.length} rows; text ${JSON.stringify(text)}`)
  if (call) say(`tool/call ${call.data.callId} ${call.data.arguments}`)
  if (asked) say(`approval/asked ${JSON.stringify(asked.data)} -> ${decided?.data?.outcome}`)
}
for (const problem of failed) say(`FAIL ${problem}`)
if (failed.length === 0) say('PASS: text streamed, the tool card is DSH\'s own, and the ask went through DSH\'s approval service')
if (!keep) rmSync(work, { recursive: true, force: true, maxRetries: 3 })
process.exit(failed.length > 0 ? 1 : 0)
