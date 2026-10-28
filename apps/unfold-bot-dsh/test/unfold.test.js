// The Unfold Bot against a stand-in team runtime: what the Bot team provides (createBot, its
// bootstrap and the Main Bot maker it calls) is recorded, the way bots-dsh roster.js does it.
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, test } from 'node:test'
import { createRuntime, inject, name } from '../index.js'
import { UNFOLD_BOT, UNFOLD_KIND, UNFOLD_NAME, UNFOLD_PLUGINS, unfoldLeads } from '../src/host/unfold.js'
import { createWatch } from '../../unfold-bridge-dsh/src/host/watch.js'

let dir
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'unfold-bot-dsh-')) })
afterEach(() => rmSync(dir, { recursive: true, force: true }))

// A team as bots-dsh keeps it: bootstrap makes the first Main Bot, through the Main Bot maker
// a plugin set when there is one, else the default "Omni".
function fakeTeam({ bots = {}, mainBotIds = [], readOnly, model } = {}) {
  const home = join(dir, 'home')
  mkdirSync(home, { recursive: true })
  const record = { created: [], sessions: [] }
  const state = { bots: { ...bots }, mainBotIds: [...mainBotIds] }
  let bootstrapping = null
  const team = {
    home,
    state,
    record,
    load: async () => {},
    readOnly: () => readOnly,
    defaultModel: async () => model,
    findBot: name => Object.values(state.bots).find(bot => bot.name === name),
    botOf: id => state.bots[id],
    createBot: async (options) => {
      if (team.findBot(options.name)) throw new Error(`A Bot named ${options.name} already exists`)
      record.created.push(options)
      const id = `bot-${record.created.length}`
      // The Bot's Session is titled with its name (roster.js createSession).
      record.sessions.push({ id: `s-${id}`, title: options.name })
      const bot = { id, sessionId: `s-${id}`, ...options }
      state.bots[id] = bot
      if (options.main) state.mainBotIds.push(id)
      return bot
    },
    async bootstrap() {
      if (state.mainBotIds.some(id => team.botOf(id))) return
      const makeDefault = () => team.createBot({ name: 'Omni', main: true, pickModel: true })
      bootstrapping ??= (team.mainBotMaker ? Promise.resolve(team.mainBotMaker()).then(bot => (state.mainBotIds.some(id => team.botOf(id)) ? bot : makeDefault())) : makeDefault())
        .finally(() => { bootstrapping = null })
      await bootstrapping
    },
    warn: () => {},
  }
  return team
}

// Unfold's own instance, where Unfold leads the team; elsewhere is no host kind and no preload.
const LEADS = { AUTOMAGIK_HOST: 'unfold' }
const ELSEWHERE = {}

const ctx = () => {
  const disposers = []
  return { effect: (run) => { const off = run(); if (typeof off === 'function') disposers.push(off) }, dispose: () => disposers.splice(0).forEach(off => off()) }
}

test('the plugin waits for the Bot team and names itself', () => {
  assert.equal(name, 'unfold-bot')
  assert.deepEqual(inject, ['omniTeam'])
})

test('Unfold leads only in Unfold\'s own instance: host kind or preload unfold', () => {
  for (const env of [LEADS, { AUTOMAGIK_PRELOAD: 'unfold' }, { AUTOMAGIK_HOST: ' Unfold ' }]) assert.equal(unfoldLeads(env), true, JSON.stringify(env))
  for (const env of [ELSEWHERE, { AUTOMAGIK_PRELOAD: 'genie' }, { AUTOMAGIK_HOST: 'omni' }]) assert.equal(unfoldLeads(env), false, JSON.stringify(env))
})

test('in Unfold\'s instance, a team with no Main Bot gets Unfold as its Main Bot and only Bot', async () => {
  const team = fakeTeam()
  const rt = createRuntime(ctx(), team, {}, LEADS)
  await rt.unfoldReady
  // The browser's first state read bootstraps the team too: it finds its Main Bot.
  await team.bootstrap()
  assert.equal(team.record.created.length, 1)
  const [bot] = Object.values(team.state.bots)
  assert.deepEqual([bot.name, bot.kind, bot.main], [UNFOLD_NAME, UNFOLD_KIND, true])
  assert.deepEqual(team.state.mainBotIds, [bot.id])
  assert.equal(bot.instructions, UNFOLD_BOT.instructions)
  // No model yet: the greeting waits for Connect AI.
  assert.equal(bot.pickModel, true)
})

test('in Unfold\'s instance, a browser bootstrap racing the plugin\'s start still makes one Bot, Unfold', async () => {
  const team = fakeTeam()
  const rt = createRuntime(ctx(), team, {}, LEADS)
  await Promise.all([team.bootstrap(), rt.unfoldReady, team.bootstrap()])
  assert.deepEqual(team.record.created.map(bot => bot.name), [UNFOLD_NAME])
})

test('elsewhere, a team with no Main Bot gets its default Main Bot first, and Unfold beside it', async () => {
  const team = fakeTeam()
  const rt = createRuntime(ctx(), team, {}, ELSEWHERE)
  assert.equal(team.mainBotMaker, undefined)
  await rt.unfoldReady
  await team.bootstrap()
  assert.deepEqual(team.record.created.map(bot => [bot.name, bot.main]), [['Omni', true], [UNFOLD_NAME, false]])
})

test('beside a Main Bot already there, Unfold joins as one more Bot', async () => {
  const team = fakeTeam({ bots: { m: { id: 'm', name: 'Omni' } }, mainBotIds: ['m'], model: { provider: 'p', model: 'm' } })
  const rt = createRuntime(ctx(), team, {}, ELSEWHERE)
  await rt.unfoldReady
  assert.equal(team.record.created.length, 1)
  assert.equal(team.record.created[0].main, false)
  assert.equal(team.record.created[0].kind, UNFOLD_KIND)
  // A model is served: it greets at once.
  assert.equal(team.record.created[0].pickModel, false)
  assert.deepEqual(team.state.mainBotIds, ['m'])
})

test('Unfold is made once: kept when there, not made again once deleted', async () => {
  const team = fakeTeam()
  await createRuntime(ctx(), team, {}, LEADS).unfoldReady
  await createRuntime(ctx(), team, {}, LEADS).unfoldReady
  assert.equal(team.record.created.length, 1)
  assert.equal(JSON.parse(readFileSync(join(team.home, 'unfold.json'), 'utf8')).unfoldCreated, true)
  // The person deleted it (and made another Main Bot).
  team.state.bots = { x: { id: 'x', name: 'Mine' } }
  team.state.mainBotIds = ['x']
  await createRuntime(ctx(), team, {}, LEADS).unfoldReady
  assert.equal(team.record.created.length, 1)
  // With no Main Bot left either, the team's own default comes back, not Unfold.
  team.state.bots = {}
  team.state.mainBotIds = []
  await createRuntime(ctx(), team, {}, LEADS).unfoldReady
  assert.deepEqual(team.record.created.map(bot => bot.name), [UNFOLD_NAME, 'Omni'])
})

test('a read-only team (another DSH holds it) gets no Bot', async () => {
  const team = fakeTeam({ readOnly: 'held elsewhere' })
  await createRuntime(ctx(), team, {}, LEADS).unfoldReady
  assert.deepEqual(team.record.created, [])
})

test('the Main Bot maker goes when the plugin does', () => {
  const context = ctx()
  const team = fakeTeam({ bots: { m: { id: 'm', name: 'Omni' } }, mainBotIds: ['m'] })
  createRuntime(context, team, {}, LEADS)
  assert.equal(typeof team.mainBotMaker, 'function')
  context.dispose()
  assert.equal(team.mainBotMaker, undefined)
})

test('its defaults are the Unfold bridge and the seven Unfold plugins, all of this repository', () => {
  assert.deepEqual(UNFOLD_PLUGINS.map(plugin => plugin.name), [
    '@automagik/unfold-bridge-dsh',
    ...['sse', 'events', 'capabilities', 'settings', 'mind', 'trajectory', 'session'].map(part => `@automagik/unfold-${part}-dsh`),
  ])
  for (const plugin of UNFOLD_PLUGINS) assert.equal(`@automagik/${plugin.dir}`, plugin.name)
})

// Unfold watches its Bot by name through the Unfold bridge's work view: a subscription it holds
// before the Bot exists passes the Bot's Session from its creation and its first turn on.
test('a fake Unfold watching by name sees the Unfold Bot\'s Session from its first turn', async () => {
  const team = fakeTeam()
  await createRuntime(ctx(), team, {}, LEADS).unfoldReady
  const watch = createWatch({ newId: () => 'c1', names: { title: session => team.record.sessions.find(entry => entry.id === session?.id)?.title } })
  const seen = []
  watch.on('event', event => seen.push([event.kind, event.agent_name]))
  watch.connect([{ id: 'unfold', match: { names: [UNFOLD_NAME] }, kinds: ['created', 'turn_done'] }])
  const [unfoldSession] = team.record.sessions
  const session = { id: unfoldSession.id }
  watch.agentCreated(session.id, session)
  watch.sessionEvent(session, { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'Hi, Unfold here.' }] } } })
  watch.sessionEvent(session, { type: 'turn/end', data: {} })
  // Another Bot's Session is not Unfold's to see.
  const other = { id: 's-other' }
  watch.agentCreated(other.id, other)
  assert.deepEqual(seen, [['created', UNFOLD_NAME], ['turn_done', UNFOLD_NAME]])
})
