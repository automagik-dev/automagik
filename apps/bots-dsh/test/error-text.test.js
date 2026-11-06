// The /api channel answers a failure by its kind, never by its message: a pet route's
// file system error names the absolute path of the sheet (or of Codex's folder), and a
// provider's error may name its request, its endpoint or its key. Both are logged by
// kind and answered with a fixed sentence. This canary plants one runtime marker in the
// home path and in the provider's text and checks the reply payload and the diagnostics
// log for it, then checks each failure was logged by kind.
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import fsp from 'node:fs/promises'
import { syncBuiltinESMExports } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { apply } from '../index.js'
import { fakeContext } from './fake-ctx.js'

// Built at run time from pieces, so neither the repository nor this file holds a
// credential-shaped string, and no marker can be a secret a redactor already knows.
const MARKER = ['qz', 'sink', String(Date.now() % 1_000_000)].join('-')

function vp8x(width, height) {
  const bytes = Buffer.alloc(40)
  bytes.write('RIFF', 0, 'latin1')
  bytes.write('WEBP', 8, 'latin1')
  bytes.write('VP8X', 12, 'latin1')
  bytes.writeUIntLE(width - 1, 24, 3)
  bytes.writeUIntLE(height - 1, 27, 3)
  return bytes
}

function start() {
  const root = mkdtempSync(join(tmpdir(), `omni-${MARKER}-`))
  const home = join(root, 'team')
  mkdirSync(home, { recursive: true })
  writeFileSync(join(home, 'state.json'), JSON.stringify({ version: 1, mainBotIds: ['m1'], revision: 1, bots: { m1: { id: 'm1', name: 'Omni', role: 'Channel orchestrator', instructions: '', createdAt: 1 } }, rooms: {}, exchanges: [], exchangeTurns: {}, questions: {} }))
  const routes = new Map()
  const ctx = fakeContext({ services: { settings: { describe: () => [] }, credentials: { describe: async () => ({}) } } })
  ctx.llm.listConfigurableProviders = () => []
  const register = ctx.connection.fetch.register
  ctx.connection.fetch.register = (route) => {
    routes.set(route.path, route)
    return register(route)
  }
  // Codex's folder is made from HOME when the channel is built, so a home under the
  // marker turns every path it writes into a marker carrier.
  const savedHome = process.env.HOME
  process.env.HOME = join(root, 'codex-home')
  mkdirSync(process.env.HOME, { recursive: true })
  apply(ctx, { home })
  const call = async (endpoint, payload) => {
    const route = [...routes.values()].find(item => item.path === '/api/omni-ui')
    const response = await route.fetch(new Request('http://localhost/api/omni-ui', { method: 'POST', body: JSON.stringify({ endpoint, payload }) }))
    return response.json()
  }
  const stop = async () => {
    await ctx.dispose()
    if (savedHome === undefined) delete process.env.HOME
    else process.env.HOME = savedHome
    rmSync(root, { recursive: true, force: true, maxRetries: 5 })
  }
  return { ctx, home, routes, call, stop }
}

// A pet the team folder holds, with a valid Codex sheet.
function seedPet(home, id) {
  const dir = join(home, 'pets', id)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'pet.json'), JSON.stringify({ id, displayName: 'Rover', spriteVersionNumber: 1, spritesheetPath: 'spritesheet.webp' }))
  writeFileSync(join(dir, 'spritesheet.webp'), vp8x(1536, 1872))
  return join(dir, 'spritesheet.webp')
}

const diagnostics = home => (existsSync(join(home, 'logs', 'diagnostics.jsonl')) ? readFileSync(join(home, 'logs', 'diagnostics.jsonl'), 'utf8') : '')

test('pet and provider failures answer and log by kind, never by their message', async (t) => {
  const { ctx, home, routes, call, stop } = start()
  const sheet = seedPet(home, 'rover')
  t.after(stop)

  // (a) GET /api/omni-ui/pet: the sheet reads once when the pet is described, then the
  // route's own read fails. Its message names the absolute path, which holds the marker.
  const originalRead = fsp.readFile
  let sheetReads = 0
  fsp.readFile = async (path, ...args) => {
    if (String(path) === sheet && (sheetReads += 1) > 1) {
      throw Object.assign(new Error(`EACCES: permission denied, open '${path}'`), { code: 'EACCES' })
    }
    return originalRead(path, ...args)
  }
  syncBuiltinESMExports()
  t.after(() => {
    fsp.readFile = originalRead
    syncBuiltinESMExports()
  })
  const petRoute = routes.get('/api/omni-ui/pet')
  const petResponse = await petRoute.fetch(new Request(`http://localhost/api/omni-ui/pet?source=team&id=rover`))
  const petReply = await petResponse.text()
  assert.equal(petResponse.status, 500)

  // (b) PUT /api/omni-ui/pet-codex: Codex's own folder cannot be made (a file stands
  // where its parent folder should be), and that message names the path too.
  writeFileSync(join(process.env.HOME, '.codex'), '')
  const codexRoute = routes.get('/api/omni-ui/pet-codex')
  const codexResponse = await codexRoute.fetch(new Request(`http://localhost/api/omni-ui/pet-codex?id=rover`, {
    method: 'PUT',
    body: vp8x(1536, 1872),
  }))
  const codexReply = await codexResponse.text()
  assert.equal(codexResponse.status, 500)

  // (c) POST /api/omni-ui provider-models: a raw provider error, message and all.
  ctx.llm.discoverModels = async () => {
    throw Object.assign(new Error(`request to the provider at ${MARKER} was refused`), { name: 'ProviderError' })
  }
  const provider = await call('provider-models', { baseURL: 'https://example.invalid', key: ['not', 'a', 'real', 'key'].join('-') })

  // The reply payloads: fixed sentences, no marker, nothing of the raw messages.
  assert.deepEqual(JSON.parse(petReply), { error: 'Something went wrong (EACCES).' })
  assert.deepEqual(JSON.parse(codexReply), { error: 'Something went wrong (ENOTDIR).' })
  assert.deepEqual(provider, { ok: false, error: { code: 'bot/refused', message: 'Something went wrong (ProviderError).', details: {} } })
  for (const reply of [petReply, codexReply, JSON.stringify(provider)]) assert.ok(!reply.includes(MARKER), reply)

  // The log: one line per failure, by kind, with the stack's frames and no marker.
  const log = join(home, 'logs', 'diagnostics.jsonl')
  let entries = []
  for (let tries = 0; tries < 100 && entries.length < 3; tries += 1) {
    await new Promise(resolve => setTimeout(resolve, 20))
    entries = diagnostics(home).split('\n').filter(Boolean).map(line => JSON.parse(line)).filter(entry => entry.source === 'api')
  }
  assert.deepEqual(entries.map(entry => [entry.text, entry.code]), [
    ['pet route: EACCES', 'EACCES'],
    ['pet to Codex route: ENOTDIR', 'ENOTDIR'],
    ['provider-models: ProviderError', 'ProviderError'],
  ])
  for (const entry of entries) {
    assert.ok(!JSON.stringify(entry).includes(MARKER), JSON.stringify(entry))
    assert.ok(entry.stack === undefined || entry.stack.split('\n').every(line => !line.includes(MARKER)), entry.stack)
  }
  assert.ok(!readFileSync(log, 'utf8').includes(MARKER))
})
