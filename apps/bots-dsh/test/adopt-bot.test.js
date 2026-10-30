import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { apply } from '../index.js'
import { TEAM_TOOLS } from '../src/host/constants.js'
import { fakeContext } from './fake-ctx.js'

// A DSH bot is a plain dsh entry: it is listed under the Bots but is not one, so the team
// tools are denied on its Sessions and `list_bots` never names it. Adopting it makes it a
// Bot of the team, keeping its own Session, folder and name (issue #143).

const TEAM = {
  version: 1,
  mainBotIds: ['m1'],
  revision: 2,
  bots: { m1: { id: 'm1', sessionId: 'm1', name: 'Omni', role: 'Channel orchestrator', instructions: '', createdAt: 1 } },
  rooms: {},
  exchanges: [],
  exchangeTurns: {},
  questions: {},
}

function start(team = TEAM) {
  const home = mkdtempSync(join(tmpdir(), 'ds-bot-adopt-'))
  writeFileSync(join(home, 'state.json'), JSON.stringify(team))
  const ctx = fakeContext()
  const workspaces = new Map()
  const created = []
  const restricted = []
  const lifted = []
  let sessions = 0
  ctx.tools.schemas = () => [...TEAM_TOOLS, 'read', 'write'].map(name => ({ name }))
  Object.assign(ctx, {
    workspaceRegistry: {
      get: id => workspaces.get(id),
      resolveByPath: async path => [...workspaces.values()].find(workspace => workspace.path === path),
      create: async (path) => {
        const workspace = { id: `w${workspaces.size + 1}`, path }
        workspaces.set(workspace.id, workspace)
        return workspace
      },
      archiveSession: async () => {},
    },
    sessionController: {
      create: async (options) => {
        created.push(options)
        return { sessionId: `s${++sessions}` }
      },
      resolveAgent: async (sessionId) => {
        const agent = {
          session: { id: sessionId },
          ctx: {
            tools: {
              restrict: (filter) => {
                restricted.push({ sessionId, filter })
                return () => lifted.push(sessionId)
              },
            },
            effect: execute => execute(),
          },
          followup() {},
        }
        return { agent }
      },
      selectModel: async () => {},
    },
    sessionTitle: { rename: async () => {} },
    sessions: { flush: async () => {} },
  })
  let route
  const register = ctx.connection.fetch.register
  ctx.connection.fetch.register = (options) => {
    route = options
    return register(options)
  }
  apply(ctx, { home })
  const call = async (endpoint, payload) => {
    const response = await route.fetch(new Request('http://localhost/api/bot', { method: 'POST', body: JSON.stringify({ endpoint, payload }) }))
    return response.json()
  }
  const stop = async () => {
    await ctx.dispose()
    rmSync(home, { recursive: true, force: true, maxRetries: 5 })
  }
  return { call, stop, home, ctx, created, restricted, lifted }
}

test('adopting a DSH bot makes it a Bot of the team, keeping its Session, folder and name', async (t) => {
  const { call, stop, home, ctx, lifted } = start()
  t.after(stop)
  await call('state', {})
  const project = realpathSync(mkdtempSync(join(tmpdir(), 'ds-bot-adopt-folder-')))
  t.after(() => rmSync(project, { recursive: true, force: true }))
  const rt = ctx.provided.get('omniTeam')
  const agent = (await call('add-agent', { name: 'Cogna Brain', workDir: project })).value
  // A second Session becomes the Bot's own chat; the first one its earlier part.
  const second = (await call('agent-session', { agentId: agent.id })).value

  const adopted = (await call('agent-bot-adopt', { agentId: agent.id })).value
  assert.deepEqual(adopted, { botId: second.sessionId })

  const view = (await call('state', {})).value
  // It is a Bot now, so the roster every team tool reads (list_bots, message_bot, the
  // groups, capabilities and tasks) holds it; the DSH bot row is gone.
  assert.deepEqual(view.agents, [])
  const bot = view.bots.find(entry => entry.id === second.sessionId)
  assert.equal(bot.name, 'Cogna Brain')
  assert.equal(bot.workDir, project)
  assert.deepEqual(bot.capabilities, [])
  assert.deepEqual(bot.parts, [agent.sessions[0]])
  // Its own chat is the Session it already had, and the earlier one stays readable as
  // its earlier part: both resolve back to the Bot, as every part of a chat does.
  assert.equal(rt.findBot('Cogna Brain').id, second.sessionId)
  assert.equal(rt.chatOf(second.sessionId), second.sessionId)
  assert.equal(rt.selfOf(second.sessionId), second.sessionId)
  assert.equal(rt.selfOf(agent.sessions[0]), second.sessionId)
  // The team tools it had denied are back on that Session, without a restart.
  assert.deepEqual(lifted.sort(), [agent.sessions[0], second.sessionId].sort())
  assert.deepEqual(rt.dshBots.list(), [])
  // The record is written, so a restart reads the Bot and not the DSH bot.
  const saved = JSON.parse(readFileSync(join(home, 'state.json'), 'utf8'))
  assert.equal(saved.bots[second.sessionId].name, 'Cogna Brain')
  assert.equal(saved.agents[agent.id].adoptedBotId, second.sessionId)
  assert.equal(saved.bots[second.sessionId].dshAgentId, agent.id)
  assert.equal(saved.bots[second.sessionId].kind, 'dsh')
  assert.deepEqual(saved.agents[agent.id].sessions, [agent.sessions[0], second.sessionId])
})

test('adopting refuses a name a Bot already has, a tasks record, a missing Session and an unknown id', async (t) => {
  const { call, stop, ctx } = start()
  t.after(stop)
  await call('state', {})
  const rt = ctx.provided.get('omniTeam')
  // A DSH bot may share a Bot's name; adopting it must not rename the Bot.
  const same = (await call('add-agent', { name: 'Omni' })).value
  assert.equal((await call('agent-bot-adopt', { agentId: same.id })).error.message, 'A Bot named Omni already exists')
  // The tasks record is not a DSH bot.
  await rt.startTask({ title: 'Wish', text: 'Do it', from: 'm1' })
  const tasks = Object.values(rt.state.agents).find(agent => agent.kind === 'tasks')
  assert.equal((await call('agent-bot-adopt', { agentId: tasks.id })).error.message, 'Only a DSH bot can become a Bot')
  assert.equal((await call('agent-bot-adopt', { agentId: 'none' })).ok, false)
  // A DSH bot whose Session DSH can no longer open keeps its record: nothing moved.
  const gone = (await call('add-agent', { name: 'Gone' })).value
  ctx.sessionController.resolveAgent = async () => ({ error: { message: 'Session unavailable', code: 'ENOENT' } })
  const failed = await call('agent-bot-adopt', { agentId: gone.id })
  assert.equal(failed.ok, false)
  const view = (await call('state', {})).value
  assert.deepEqual(view.agents.filter(agent => agent.kind === 'dsh').map(agent => agent.name).sort(), ['Gone', 'Omni'])
  assert.equal(view.bots.some(bot => bot.name === 'Gone'), false)
})

test('an adopted original refuses delete until adoption is rolled back; rollback restores the DSH bot and ordinary delete still works', async (t) => {
  const { call, stop, ctx } = start()
  t.after(stop)
  await call('state', {})
  const project = realpathSync(mkdtempSync(join(tmpdir(), 'ds-bot-adopt-folder-')))
  t.after(() => rmSync(project, { recursive: true, force: true }))
  const rt = ctx.provided.get('omniTeam')
  const agent = (await call('add-agent', { name: 'Cogna Brain', workDir: project })).value
  const second = (await call('agent-session', { agentId: agent.id })).value
  const adopted = (await call('agent-bot-adopt', { agentId: agent.id })).value
  const botId = adopted.botId
  assert.equal(botId, second.sessionId)

  // The host guard still refuses the plain delete, so the menu must not pretend it works.
  const refused = await call('delete-bot', { id: botId })
  assert.equal(refused.ok, false)
  assert.equal(refused.error.message, 'Roll back DSH adoption before deleting the original DSH bot')
  let view = (await call('state', {})).value
  assert.equal(view.bots.some(bot => bot.id === botId), true)

  // Rollback refuses while the Bot is Main, and the record is unchanged.
  assert.equal((await call('set-main', { id: botId, main: true })).ok, true)
  const mainRefused = await call('agent-bot-rollback', { agentId: agent.id })
  assert.equal(mainRefused.ok, false)
  assert.match(mainRefused.error.message, /Remove Main Bot\/group roles and resolve new team history/)
  assert.equal((await call('set-main', { id: botId, main: false })).ok, true)

  // Membership in any group also blocks rollback, even without an admin role.
  rt.state.rooms.synthetic = { id: 'synthetic', name: 'Synthetic group', members: [botId], admin: null, mode: 'chat', sessions: {}, log: [], seq: 0 }
  const groupRefused = await call('agent-bot-rollback', { agentId: agent.id })
  assert.equal(groupRefused.ok, false)
  assert.match(groupRefused.error.message, /Remove Main Bot\/group roles and resolve new team history/)
  delete rt.state.rooms.synthetic

  // A task from the adopted Bot is new team history too.
  await rt.startTask({ title: 'Synthetic task', text: 'Synthetic instructions', from: botId })
  const taskRefused = await call('agent-bot-rollback', { agentId: agent.id })
  assert.equal(taskRefused.ok, false)
  assert.match(taskRefused.error.message, /Remove Main Bot\/group roles and resolve new team history/)

  // A fresh adoption with no roles, changed history or tasks rolls back cleanly.
  const clean = (await call('add-agent', { name: 'Cogna Two', workDir: project })).value
  const cleanSession = (await call('agent-session', { agentId: clean.id })).value
  await call('agent-bot-adopt', { agentId: clean.id })
  const rolled = await call('agent-bot-rollback', { agentId: clean.id })
  assert.equal(rolled.ok, true)
  view = (await call('state', {})).value
  assert.equal(view.bots.some(bot => bot.id === cleanSession.sessionId), false)
  assert.equal(view.agents.some(entry => entry.id === clean.id && entry.kind === 'dsh'), true)

  // An ordinary Bot is still deletable.
  const ordinary = (await call('create-bot', { name: 'Ordinary', role: 'Helper' })).value
  assert.equal((await call('delete-bot', { id: ordinary.id })).ok, true)
  view = (await call('state', {})).value
  assert.equal(view.bots.some(bot => bot.id === ordinary.id), false)
})
