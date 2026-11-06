import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { apply } from '../index.js'
import { DENY_MAX, DENY_NAME_MAX, cleanDenyTools } from '../src/host/tool-deny.js'
import { fakeContext } from './fake-ctx.js'

const flush = async () => { for (let index = 0; index < 8; index += 1) await Promise.resolve() }
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))

const SERVED = ['bash', 'read', 'write', 'edit', 'omni_send', 'omni_messages', 'omni_chats']

// Enough of the host for the roster and the tool-deny module: Sessions resolve to an agent
// whose `ctx.tools.restrict` records the deny list and hands back a lift.
function bench({ served = SERVED } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'ds-bot-tool-deny-'))
  const ctx = fakeContext()
  const restricted = []
  const lifted = []
  const warnings = []
  const agents = new Map()
  let sessions = 0
  ctx.logger.warn = (...args) => warnings.push(args.map(value => String(value)).join(' '))
  ctx.tools.schemas = () => served.map(name => ({ name }))
  Object.assign(ctx, {
    workspaceRegistry: {
      get: () => undefined,
      resolveByPath: async () => undefined,
      create: async path => ({ id: `w${sessions}`, path }),
      archiveSession: async () => {},
    },
    sessionController: {
      create: async options => ({ sessionId: options.sessionId ?? `s${++sessions}` }),
      resolveAgent: async (sessionId) => {
        if (!agents.has(sessionId)) {
          agents.set(sessionId, {
            session: { id: sessionId },
            ctx: {
              tools: {
                restrict: (filter) => {
                  restricted.push({ sessionId, deny: [...filter.deny] })
                  return () => lifted.push(sessionId)
                },
              },
              // Other modules' agent/created listeners (capabilities) mount effects.
              effect: execute => execute(),
            },
          })
        }
        // ds-bot's own resolveAgent unwraps `{ agent }`, as DSH's controller answers.
        return { agent: agents.get(sessionId) }
      },
      selectModel: async () => {},
    },
    sessionTitle: { rename: async () => {} },
    sessions: { flush: async () => {} },
  })
  apply(ctx, { home })
  const stop = () => {
    ctx.dispose()
    rmSync(home, { recursive: true, force: true, maxRetries: 5 })
  }
  return { ctx, home, stop, restricted, lifted, warnings, agents }
}

const team = (t, options) => {
  const board = bench(options)
  t.after(board.stop)
  return board
}

test('cleanDenyTools trims, deduplicates and drops empty names', () => {
  assert.deepEqual(cleanDenyTools([' bash ', 'bash', '', 'omni_send']), ['bash', 'omni_send'])
  assert.equal(cleanDenyTools([]), null)
  assert.equal(cleanDenyTools(null), null)
  assert.equal(cleanDenyTools(undefined), undefined)
  assert.throws(() => cleanDenyTools('bash'), /list of tool names/)
  assert.throws(() => cleanDenyTools(['bash', 7]), /is a tool name/)
  assert.throws(() => cleanDenyTools(Array.from({ length: DENY_MAX + 1 }, (_, index) => `t${index}`)), /at most/)
  assert.throws(() => cleanDenyTools(['x'.repeat(DENY_NAME_MAX + 1)]), /at most/)
})

test('a Bot created with a deny list keeps it, and the list is enforced on its Session', async (t) => {
  const { ctx, restricted } = team(t)
  const rt = ctx.provided.get('omniTeam')
  const bot = await rt.createBot({ name: 'Analista', denyTools: ['omni_send', 'bash'], pickModel: true, instructions: 'Read only.' })
  assert.deepEqual(bot.denyTools, ['omni_send', 'bash'])
  await flush()
  const applied = restricted.filter(entry => entry.sessionId === bot.id)
  assert.ok(applied.length > 0, 'the deny list reached the Session')
  assert.deepEqual(applied.at(-1).deny.sort(), ['bash', 'omni_send'])
})

test('a create that names a tool this DSH does not serve refuses, and leaves no Bot', async (t) => {
  const { ctx, home } = team(t)
  const rt = ctx.provided.get('omniTeam')
  await assert.rejects(
    () => rt.createBot({ name: 'Typo', denyTools: ['Bash', 'nope'], pickModel: true, instructions: 'Read only.' }),
    /Bash, nope are not tools this DSH serves/,
  )
  assert.equal(rt.findBot('Typo'), undefined)
  const stored = JSON.parse(readFileSync(join(home, 'state.json'), 'utf8'))
  assert.equal(Object.values(stored.bots ?? {}).some(bot => bot.name === 'Typo'), false)
})

test('an update that names a tool this DSH does not serve refuses and keeps the old list', async (t) => {
  const { ctx, restricted } = team(t)
  const rt = ctx.provided.get('omniTeam')
  const bot = await rt.createBot({ name: 'Analista', denyTools: ['bash'], pickModel: true, instructions: 'Read only.' })
  const before = restricted.filter(entry => entry.sessionId === bot.id).length
  await assert.rejects(() => rt.updateBot(bot.id, { denyTools: ['nope'] }), /nope is not a tool this DSH serves/)
  assert.deepEqual(bot.denyTools, ['bash'])
  assert.equal(restricted.filter(entry => entry.sessionId === bot.id).length, before)
})

test('a Bot without a deny list is unchanged', async (t) => {
  const { ctx, restricted } = team(t)
  const rt = ctx.provided.get('omniTeam')
  const bot = await rt.createBot({ name: 'Plain', pickModel: true, instructions: 'Free.' })
  assert.equal(bot.denyTools, undefined)
  await rt.applyToolDeny(bot)
  assert.deepEqual(restricted.filter(entry => entry.sessionId === bot.id), [])
})

test('an update adds, replaces and clears the list, lifting what it set before', async (t) => {
  const { ctx, home, restricted, lifted } = team(t)
  const rt = ctx.provided.get('omniTeam')
  const bot = await rt.createBot({ name: 'Analista', denyTools: ['bash'], pickModel: true, instructions: 'Read only.' })
  const first = restricted.filter(entry => entry.sessionId === bot.id).at(-1)
  assert.deepEqual(first.deny, ['bash'])

  await rt.updateBot(bot.id, { denyTools: ['omni_send', 'write'] })
  assert.deepEqual(bot.denyTools, ['omni_send', 'write'])
  assert.ok(lifted.includes(bot.id), 'the earlier restriction was lifted')
  const second = restricted.filter(entry => entry.sessionId === bot.id).at(-1)
  assert.deepEqual(second.deny.sort(), ['omni_send', 'write'])

  await rt.updateBot(bot.id, { denyTools: [] })
  assert.equal(bot.denyTools, undefined)
  assert.equal(restricted.filter(entry => entry.sessionId === bot.id).length, 2)

  const stored = JSON.parse(readFileSync(join(home, 'state.json'), 'utf8'))
  assert.equal(stored.bots[bot.id].denyTools, undefined)
})

test('a list set on the record reaches a Session that resolves later', async (t) => {
  const { ctx, restricted } = team(t)
  const rt = ctx.provided.get('omniTeam')
  const bot = await rt.createBot({ name: 'Analista', pickModel: true, instructions: 'Read only.' })
  bot.denyTools = ['omni_send']
  await rt.save()
  const resolve = ctx.sessionController.resolveAgent
  const { agent } = await resolve(bot.id)
  ctx.emit('agent/created', { agent })
  // The listener loads the team before it acts; a turn of the loop is enough here.
  await wait(100)
  const applied = restricted.filter(entry => entry.sessionId === bot.id)
  assert.ok(applied.length > 0)
  assert.deepEqual(applied.at(-1).deny, ['omni_send'])
})

test('a call that reaches the executor for a denied tool is refused', async (t) => {
  const { ctx } = team(t)
  const rt = ctx.provided.get('omniTeam')
  const bot = await rt.createBot({ name: 'Analista', denyTools: ['bash', 'omni_send'], pickModel: true, instructions: 'Read only.' })
  const guard = (ctx.listeners.get('tools/execute') ?? [])[0]
  assert.equal(typeof guard, 'function')
  await assert.rejects(
    () => guard({ name: 'bash', agent: { id: bot.id } }, async () => 'ran'),
    /does not have the bash tool/,
  )
  assert.equal(await guard({ name: 'omni_messages', agent: { id: bot.id } }, async () => 'ran'), 'ran')

  const other = await rt.createBot({ name: 'Free', pickModel: true, instructions: 'Free.' })
  assert.equal(await guard({ name: 'bash', agent: { id: other.id } }, async () => 'ran'), 'ran')
})

test('a name this DSH stops serving is reported once and left out of the restriction', async (t) => {
  const { ctx, restricted, warnings } = team(t)
  const rt = ctx.provided.get('omniTeam')
  const bot = await rt.createBot({ name: 'Analista', denyTools: ['bash'], pickModel: true, instructions: 'Read only.' })
  // A tool the profile served when the list was saved can disappear with its plugin.
  bot.denyTools = ['bash', 'gone-tool']
  await rt.save()
  await rt.applyToolDeny(bot)
  const applied = restricted.filter(entry => entry.sessionId === bot.id).at(-1)
  assert.deepEqual(applied.deny, ['bash'])
  assert.match(warnings.join('\n'), /gone-tool/)
})

test('a task run gets the list, and the executor guard refuses there too', async (t) => {
  const { ctx, restricted } = team(t)
  const rt = ctx.provided.get('omniTeam')
  const bot = await rt.createBot({ name: 'Analista', denyTools: ['bash'], pickModel: true, instructions: 'Read only.' })
  // start_task writes its Session into state.tasks only; applyToolDeny is called with it.
  const taskSession = 'task-run-1'
  rt.state.tasks = { ...(rt.state.tasks ?? {}), [taskSession]: { title: 'work', from: bot.id, at: Date.now(), status: 'working' } }
  await rt.save()
  await rt.applyToolDeny(bot, [taskSession])
  const applied = restricted.filter(entry => entry.sessionId === taskSession)
  assert.ok(applied.length > 0, 'the task Session was restricted')
  assert.deepEqual(applied.at(-1).deny, ['bash'])
  const guard = (ctx.listeners.get('tools/execute') ?? [])[0]
  await assert.rejects(
    () => guard({ name: 'bash', agent: { id: taskSession } }, async () => 'ran'),
    /does not have the bash tool/,
  )
})

test('a group keeps its earlier parts under the room, and those are re-applied too', async (t) => {
  const { ctx, restricted } = team(t)
  const rt = ctx.provided.get('omniTeam')
  const bot = await rt.createBot({ name: 'Analista', denyTools: ['bash'], pickModel: true, instructions: 'Read only.' })
  rt.state.rooms = {
    ...(rt.state.rooms ?? {}),
    'room-1': { id: 'room-1', name: 'Grupo', members: [bot.id], sessions: { [bot.id]: 'group-session-1' }, segments: { [bot.id]: [{ sessionId: 'group-part-1' }] } },
  }
  await rt.save()
  await rt.applyToolDeny(bot)
  const part = restricted.filter(entry => entry.sessionId === 'group-part-1').at(-1)
  assert.ok(part !== undefined, 'the room part was restricted')
  assert.deepEqual(part.deny, ['bash'])
})
