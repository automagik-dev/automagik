// A capability mounted into one Session (rt.mountCapability) for another plugin's thread, and
// the secret scoped to that Session. The tool registry, its scopes, the tool pipeline and the
// MCP client are DSH's own from the pinned harness; the MCP server is a real stdio process.
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import { SessionStore } from '@deepseek-ai/dsh-session'
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import { ApprovalService } from '@deepseek-ai/dsh-user-approval'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { apply as applyToolExecutor, inject as toolExecutorInject } from '@deepseek-ai/dsh-tool-executor-native'
import { createScope } from '@deepseek-ai/dsh-scope'
import { createRuntime } from '../index.js'
import { fakeContext } from './fake-ctx.js'

const SERVER = fileURLToPath(new URL('./fixtures/mcp-key-server.mjs', import.meta.url))
const KEY = 'person-key-6c1f0e9a-value'
const OTHER_KEY = 'other-person-key-41d2-value'
const TOOL = 'mcp__person-space__read_key'
const PREFIX = 'mcp__person-space__'
const BOT_SESSIONS = ['chief', 'support', 'room-support', 'room-chief']

const secret = (name, value, scope, extra = {}) => ({ name, value, purpose: '', scope, requestedBy: null, createdAt: 1, updatedAt: 1, ...extra })
const team = () => ({
  version: 1,
  mainBotIds: ['chief'],
  bots: {
    chief: { id: 'chief', sessionId: 'chief', name: 'Omni', capabilities: [], createdAt: 1 },
    support: { id: 'support', sessionId: 'support', name: 'Support', capabilities: [], createdAt: 2 },
  },
  rooms: { room: { id: 'room', members: ['chief', 'support'], sessions: { chief: 'room-chief', support: 'room-support' }, admin: 'chief', mode: 'everyone' } },
  agents: {},
  capabilities: { items: {} },
  exchanges: [],
  exchangeTurns: {},
  works: {},
  questions: {},
  prefs: {},
  revision: 1,
  whaleStored: true,
})

function makeHome(secrets = [secret('PERSON_KEY', KEY, []), secret('OTHER_KEY', OTHER_KEY, [])]) {
  const home = mkdtempSync(join(tmpdir(), 'dsb-session-capability-'))
  writeFileSync(join(home, 'state.json'), JSON.stringify(team()))
  writeFileSync(join(home, 'secrets.json'), JSON.stringify({ secrets }))
  return home
}
const savedSecret = (home, name) => JSON.parse(readFileSync(join(home, 'secrets.json'), 'utf8')).secrets.find(entry => entry.name === name)

// DSH's tool registry and native executor, with its Session store.
async function realDsh(t) {
  const dsh = new Context()
  t.after(() => dsh.fiber.dispose())
  for (const plugin of [SessionStore, SessionProjectionRegistry, ApprovalService, SystemPrompt, ToolRuntime]) await dsh.plugin(plugin)
  await dsh.plugin({ apply: applyToolExecutor, inject: toolExecutorInject })
  return dsh
}

// The team's runtime over `home`, whose Agents are real DSH scopes: each Agent is its scope's
// key, as a DSH Agent is, so a tool registered through agent.ctx is that Agent's alone.
async function setup(t, { home = makeHome(), dsh } = {}) {
  dsh ??= await realDsh(t)
  const shellEnv = { registered: [], register(contribution) { this.registered.push(contribution); return () => {} } }
  const loader = { import: () => import('@deepseek-ai/dsh-mcp-client'), unwrapExports: exports => exports }
  const ctx = fakeContext({ services: { loader, shellEnv } })
  const rt = createRuntime(ctx, { home, github: false, diagnosticsFile: false })
  ctx.sessionTitle = { rename: async () => {} }
  const live = new Map()
  rt.resolveAgent = async (sessionId) => {
    const agent = live.get(sessionId)
    if (agent === undefined) throw new Error(`no Session ${sessionId}`)
    return agent
  }
  // The team's tool-result masking runs in DSH's own pipeline, as it does in DSH.
  const offRedaction = dsh.on('tools/execute', ctx.listeners.get('tools/execute').find(listener => listener.name === 'redactToolResult'))
  await rt.load()
  await rt.loadSecrets()
  const prepare = ctx.listeners.get('agent/created').find(listener => listener.name === 'prepareCapabilities')
  const agents = []
  const env = {
    home,
    dsh,
    ctx,
    rt,
    shellEnv,
    // A new Agent for a Session, as DSH makes one on load, a clear or a compaction.
    async open(sessionId) {
      const agent = { id: sessionId, session: dsh.get('sessions').get(sessionId) ?? dsh.get('sessions').create(sessionId) }
      const scope = createScope(dsh, agent)
      agent.ctx = scope.ctx
      agent.close = () => scope.dispose()
      live.set(sessionId, agent)
      agents.push(agent)
      await prepare({ agent })
      return agent
    },
    // DSH closes the Session: its Agent goes, then session/disposed.
    async close(agent) {
      await agent.close()
      live.delete(agent.id)
      ctx.emit('session/disposed', agent.session)
    },
    tools: agent => dsh.tools.definitions(agent).map(definition => definition.name),
    async call(agent, name = TOOL) {
      const batch = await dsh.tools.execute({ calls: [{ id: `call-${agent.id}`, name, arguments: '{}' }], agent, signal: new AbortController().signal })
      return batch.results[0].result
    },
    async stop() {
      offRedaction()
      await ctx.dispose()
      await Promise.all(agents.map(agent => agent.close()))
    },
  }
  t.after(() => env.stop())
  await rt.capabilitySave({
    name: 'person-space', kind: 'mcp', description: 'One person\'s space', transport: 'stdio',
    command: process.execPath, args: [SERVER], env: { PERSON_KEY: '$DSH_SECRET_PERSON_KEY' },
  }, { ui: true })
  return env
}
const textOf = result => (result.content ?? []).map(block => block.text ?? '').join('')
const grant = { secrets: ['PERSON_KEY'] }

test('a Session mount puts its tools in that Session alone; another Session cannot call them or see the key', async (t) => {
  const env = await setup(t)
  t.after(() => rmSync(env.home, { recursive: true, force: true }))
  const a = await env.open('person-a')
  const b = await env.open('person-b')
  assert.deepEqual(await env.rt.mountCapability('person-a', 'person-space', grant),
    { sessionId: 'person-a', name: 'person-space', state: 'ready', toolPrefix: PREFIX })
  assert.ok(env.tools(a).includes(TOOL), 'A lists the mounted tool')
  assert.deepEqual(env.tools(b).filter(name => name.startsWith(PREFIX)), [], 'B lists none of it')
  assert.deepEqual(env.tools().filter(name => name.startsWith(PREFIX)), [], 'nor does the global list')

  const own = await env.call(a)
  assert.notEqual(own.isError, true)
  assert.equal(textOf(own), 'key: [secret:PERSON_KEY]', 'the key reached A\'s server and is masked in A\'s result')
  const other = await env.call(b)
  assert.equal(other.isError, true, 'B naming the tool is refused')
  assert.doesNotMatch(textOf(other), /key:/)
  for (const text of [JSON.stringify(own), JSON.stringify(other), JSON.stringify(b.session.snapshotEvents()), JSON.stringify(a.session.snapshotEvents())]) {
    assert.equal(text.includes(KEY), false)
  }
})

test('the Session\'s key resolves for no Bot, not for Support\'s own Session and not for another Session', async (t) => {
  const env = await setup(t)
  t.after(() => rmSync(env.home, { recursive: true, force: true }))
  await env.open('person-a')
  await env.rt.mountCapability('person-a', 'person-space', grant)
  assert.equal(savedSecret(env.home, 'PERSON_KEY').session, 'person-a')

  await env.open('person-b')
  await assert.rejects(env.rt.mountCapability('person-b', 'person-space', grant), /PERSON_KEY is scoped to another Session/)
  for (const sessionId of BOT_SESSIONS) {
    await env.open(sessionId)
    await assert.rejects(env.rt.mountCapability(sessionId, 'person-space', grant), /belongs to a Bot/, sessionId)
  }
  // A Bot that has the capability attached cannot start it: the key is not the Bot's.
  for (const botId of ['support', 'chief']) await env.rt.changeCapabilityAttachment('attach', { name: 'person-space' }, botId)
  await env.rt.reconcileCapabilities()
  for (const botId of ['support', 'chief']) {
    const status = env.rt.capabilityStatusesView()[botId]['person-space']
    assert.equal(status.state, 'error', botId)
    assert.match(status.error, /PERSON_KEY is missing or unavailable for this Bot/)
    assert.equal(env.rt.canUseSecret('PERSON_KEY', botId), false)
  }
  for (const sessionId of BOT_SESSIONS) assert.equal(env.tools(await env.rt.resolveAgent(sessionId)).includes(TOOL), false, sessionId)

  // No Bot's shell has it or is told of it, list_secrets leaves it out, and no card offers it.
  const shell = env.shellEnv.registered.at(-1)
  assert.equal(Object.hasOwn(shell.variables, 'DSH_SECRET_PERSON_KEY'), false)
  for (const botId of ['support', 'chief']) {
    assert.equal(Object.hasOwn(shell.resolve({ agent: { id: botId }, arguments: { command: 'echo $DSH_SECRET_PERSON_KEY' } }), 'DSH_SECRET_PERSON_KEY'), false)
  }
  const listed = await env.ctx.registeredTools.get('list_secrets').execute({}, { agent: { id: 'support' } })
  assert.doesNotMatch(listed, /PERSON_KEY/)
  const asked = await env.ctx.registeredTools.get('request_secret').execute({ name: 'PERSON_KEY', purpose: 'x' }, { agent: { id: 'support' } })
  assert.match(asked, /scoped to one Session's capability, and no Bot may use it/)
  // Settings keeps the Session scope on a new value and never hands the key to Bots from Add.
  await assert.rejects(env.rt.secretEndpoint('secret-set', { name: 'PERSON_KEY', value: KEY, scope: 'all' }), /scoped to one Session/)
  await env.rt.secretEndpoint('secret-set', { name: 'PERSON_KEY', value: KEY })
  assert.equal(savedSecret(env.home, 'PERSON_KEY').session, 'person-a')
})

test('a Session mount never resolves a Bot\'s secret, even after its capability changes', async (t) => {
  const home = makeHome([secret('PERSON_KEY', KEY, []), secret('SHARED_KEY', 'shared-key-5e7a-value', 'all')])
  const env = await setup(t, { home })
  t.after(() => rmSync(home, { recursive: true, force: true }))
  const a = await env.open('person-a')
  await env.rt.mountCapability('person-a', 'person-space', grant)
  assert.ok(env.tools(a).includes(TOOL))
  await env.rt.capabilitySave({
    name: 'person-space', kind: 'mcp', transport: 'stdio', command: process.execPath, args: [SERVER],
    env: { PERSON_KEY: '$DSH_SECRET_SHARED_KEY' },
  }, { ui: true })
  await env.rt.reconcileCapabilities()
  assert.equal(env.tools(a).includes(TOOL), false, 'the mount stops rather than start with a Bot\'s key')
})

test('a saved Session scope wins over a Bot list in the file', async (t) => {
  const home = makeHome([secret('PERSON_KEY', KEY, 'all', { session: 'person-a' })])
  const env = await setup(t, { home })
  t.after(() => rmSync(home, { recursive: true, force: true }))
  for (const botId of ['support', 'chief']) {
    assert.equal(env.rt.canUseSecret('PERSON_KEY', botId), false, botId)
    assert.equal(Object.hasOwn(env.shellEnv.registered.at(-1)?.resolve({ agent: { id: botId }, arguments: {} }) ?? {}, 'DSH_SECRET_PERSON_KEY'), false)
  }
})

test('a restart restores no Session mount, and the key stays that Session\'s', async (t) => {
  const home = makeHome()
  t.after(() => rmSync(home, { recursive: true, force: true }))
  const first = await setup(t, { home })
  await first.open('person-a')
  await first.rt.mountCapability('person-a', 'person-space', grant)
  await first.stop()

  const env = await setup(t, { home })
  const a = await env.open('person-a')
  assert.equal(env.tools(a).includes(TOOL), false, 'nothing is mounted again by itself')
  await env.open('person-b')
  await assert.rejects(env.rt.mountCapability('person-b', 'person-space', grant), /scoped to another Session/)
  assert.equal((await env.rt.mountCapability('person-a', 'person-space', grant)).state, 'ready')
  assert.ok(env.tools(a).includes(TOOL))
})

test('a Session mount follows its Session to a new Agent and ends when the Session closes', async (t) => {
  const env = await setup(t)
  t.after(() => rmSync(env.home, { recursive: true, force: true }))
  const first = await env.open('person-a')
  await env.rt.mountCapability('person-a', 'person-space', grant)
  // A clear or a compaction: a new Agent for the same Session gets the mount before its first step.
  await first.close()
  const next = await env.open('person-a')
  assert.ok(env.tools(next).includes(TOOL))

  await env.close(next)
  assert.equal(env.tools(next).includes(TOOL), false)
  const reopened = await env.open('person-a')
  assert.equal(env.tools(reopened).includes(TOOL), false, 'a closed Session takes its mount with it')
  assert.equal(savedSecret(env.home, 'PERSON_KEY').session, 'person-a', 'its key stays its own')
})

test('unmountCapability ends the mount and the saved scope, with or without a live mount', async (t) => {
  const home = makeHome()
  t.after(() => rmSync(home, { recursive: true, force: true }))
  const first = await setup(t, { home })
  const a = await first.open('person-a')
  await first.rt.mountCapability('person-a', 'person-space', grant)
  assert.equal(await first.rt.unmountCapability('person-a', 'person-space'), true)
  assert.equal(first.tools(a).includes(TOOL), false)
  assert.equal(savedSecret(home, 'PERSON_KEY').session, undefined)
  assert.equal(await first.rt.unmountCapability('person-a', 'person-space'), false)
  // The key is free again: the next Session's mount scopes it to itself.
  const b = await first.open('person-b')
  assert.equal((await first.rt.mountCapability('person-b', 'person-space', grant)).state, 'ready')
  assert.ok(first.tools(b).includes(TOOL))
  await first.stop()

  // After a restart nothing is live, and the saved scope still ends.
  const env = await setup(t, { home })
  assert.equal(savedSecret(home, 'PERSON_KEY').session, 'person-b')
  assert.equal(await env.rt.unmountCapability('person-b', 'person-space'), true)
  assert.equal(savedSecret(home, 'PERSON_KEY').session, undefined)

  // A deleted capability: every secret still scoped to that Session ends with it.
  await env.open('person-c')
  await env.rt.mountCapability('person-c', 'person-space', grant)
  await env.stop()
  const after = await setup(t, { home })
  await after.rt.capabilityDelete('person-space', { ui: true })
  assert.equal(await after.rt.unmountCapability('person-c', 'person-space'), true)
  assert.equal(savedSecret(home, 'PERSON_KEY').session, undefined)
})

test('mountCapability refuses what it cannot hold to one Session', async (t) => {
  const home = makeHome([
    secret('PERSON_KEY', KEY, []), secret('SHARED_KEY', 'shared-key-5e7a-value', 'all'),
    secret('SUPPORT_KEY', 'support-key-90b3-value', ['support']), secret('SHORT_KEY', 'abc', []),
  ])
  const env = await setup(t, { home })
  t.after(() => rmSync(home, { recursive: true, force: true }))
  await env.open('person-a')
  const save = (name, key) => env.rt.capabilitySave({ name, kind: 'mcp', transport: 'stdio', command: process.execPath, args: [SERVER], env: { PERSON_KEY: `$DSH_SECRET_${key}` } }, { ui: true })
  await save('shared-space', 'SHARED_KEY')
  await save('support-space', 'SUPPORT_KEY')
  await save('short-space', 'SHORT_KEY')
  await save('missing-space', 'NO_SUCH_KEY')
  await env.rt.capabilitySave({ name: 'guide', kind: 'skill', description: 'A guide', content: 'Do it.' }, { ui: true })
  for (const [name, given, reason] of [
    ['nothing', grant, /No capability named nothing/],
    ['guide', {}, /not an MCP server/],
    ['person-space', {}, /uses PERSON_KEY; the grant must name it/],
    ['person-space', { secrets: ['PERSON_KEY', 'OTHER_KEY'] }, /does not use OTHER_KEY/],
    ['person-space', { secrets: 'PERSON_KEY' }, /must be a list/],
    ['shared-space', { secrets: ['SHARED_KEY'] }, /SHARED_KEY is for every Bot/],
    ['support-space', { secrets: ['SUPPORT_KEY'] }, /SUPPORT_KEY is for Support/],
    ['short-space', { secrets: ['SHORT_KEY'] }, /held/],
    ['missing-space', { secrets: ['NO_SUCH_KEY'] }, /No secret named NO_SUCH_KEY/],
  ]) {
    await assert.rejects(env.rt.mountCapability('person-a', name, given), reason, name)
  }
  await assert.rejects(env.rt.mountCapability('nobody', 'person-space', grant), /Session nobody is not available/)
  env.rt.readOnly = () => 'The Bot team is open in another dsh.'
  await assert.rejects(env.rt.mountCapability('person-a', 'person-space', grant), /open in another dsh/)
  assert.equal(savedSecret(home, 'PERSON_KEY').session, undefined)
})
