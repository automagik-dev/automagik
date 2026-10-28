import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { apply } from '../index.js'
import { fakeContext } from './fake-ctx.js'

// Real plugin routes and disk persistence, with no installed profile or live service.
function start(home) {
  const ctx = fakeContext()
  const workspaces = new Map()
  let sessions = 0
  Object.assign(ctx, {
    llm: { listProviders: () => [], listModels: async () => [] },
    workspaceRegistry: {
      get: id => workspaces.get(id),
      resolveByPath: async path => [...workspaces.values()].find(w => w.path === path),
      create: async path => {
        const workspace = { id: `w${workspaces.size + 1}`, path }
        workspaces.set(workspace.id, workspace)
        return workspace
      },
    },
    sessionController: {
      create: async () => ({ sessionId: `s${++sessions}` }),
      resolveAgent: async sessionId => ({ agent: { session: { id: sessionId }, followup() {} } }),
    },
    sessionTitle: { rename: async () => {} },
    sessions: { flush: async () => {} },
  })
  let route
  ctx.connection.fetch.register = options => { route = options; return () => {} }
  apply(ctx, { home })
  return {
    stop: () => ctx.dispose(),
    call: async (endpoint, payload = {}) => {
      const response = await route.fetch(new Request('http://localhost/api/bot', {
        method: 'POST', body: JSON.stringify({ endpoint, payload }),
      }))
      const answer = await response.json()
      assert.equal(answer.ok, true, JSON.stringify(answer))
      return answer.value
    },
  }
}

test('selecting Automagik persists through plugin reload without changing other saved looks', async t => {
  const home = await mkdtemp(join(tmpdir(), 'automagik-pet-selection-'))
  let app = start(home)
  t.after(async () => { await app.stop(); await rm(home, { recursive: true, force: true }) })
  const initial = await app.call('state')
  const main = initial.bots.find(bot => bot.id === initial.mainBotId)
  const logo = await app.call('create-bot', { name: 'Logo', role: 'Tests the logo' })
  const genie = await app.call('create-bot', { name: 'Existing pet', role: 'Keeps Genie' })
  await app.call('pet-use', { botId: genie.id, source: 'builtin', id: 'genie-cosmic' })
  const worn = await app.call('pet-use', { botId: logo.id, source: 'builtin', id: 'automagik' })
  const expected = { pet: { source: 'builtin', id: 'automagik', version: 2, sleep: true } }
  assert.deepEqual(worn.avatar, expected)
  await app.stop()
  const disk = JSON.parse(await readFile(join(home, 'state.json'), 'utf8'))
  assert.deepEqual(disk.bots[logo.id].avatar, expected)
  app = start(home)
  const restored = await app.call('state')
  assert.deepEqual(restored.bots.find(bot => bot.id === logo.id).avatar, expected)
  assert.deepEqual(restored.bots.find(bot => bot.id === genie.id).avatar, { pet: { source: 'builtin', id: 'genie-cosmic', version: 2, sleep: true } })
  assert.deepEqual(restored.bots.find(bot => bot.id === main.id).avatar, main.avatar)
})
