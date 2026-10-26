import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { CODEX_IMAGES, CODEX_RECORD, OPENAI_IMAGES, OPENAI_RECORD, createImageGen, sseEvents } from '../src/host/imagegen.js'

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex').toString('base64')
const PARTIAL = Buffer.from('partial-image').toString('base64')
// A token whose payload names the ChatGPT account, as the sign-in's tokens do.
const tokenFor = account => `x.${Buffer.from(JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: account } })).toString('base64url')}.sig`

const folderOf = (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'bt-images-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}
// A credential store holding `records`, whose modifyRecord runs its callback like DSH's.
const storeOf = (records) => ({
  records,
  readRecord: async key => records[key],
  modifyRecord: async (key, mutate) => { records[key] = await mutate(records[key]); return records[key] },
  resolve: async () => undefined,
})
const sse = events => new Response(events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } })

test('server-sent events are read whole across chunks', async () => {
  const text = 'event: a\ndata: {"x":1}\n\nevent: b\r\ndata: plain\r\n\r\n'
  const chunks = [text.slice(0, 7), text.slice(7, 20), text.slice(20)].map(part => new TextEncoder().encode(part))
  const seen = []
  for await (const item of sseEvents(chunks)) seen.push(item)
  assert.deepEqual(seen, [{ event: 'a', data: { x: 1 } }, { event: 'b', data: 'plain' }])
})

test('with an OpenAI key, the image streams its partials to the card, then is kept by its id', async (t) => {
  const dir = folderOf(t)
  const asked = []
  const fetch = async (url, init) => {
    asked.push({ url: String(url), body: JSON.parse(init.body), auth: init.headers.authorization })
    return sse([
      ['image_generation.partial_image', { type: 'image_generation.partial_image', b64_json: PARTIAL, partial_image_index: 0 }],
      ['image_generation.partial_image', { type: 'image_generation.partial_image', b64_json: PARTIAL, partial_image_index: 1 }],
      ['image_generation.completed', { type: 'image_generation.completed', b64_json: PNG, size: '1024x1024' }],
    ])
  }
  const images = createImageGen({ credentials: () => storeOf({ [OPENAI_RECORD]: { kind: 'api-key', key: 'sk-test' } }), folder: () => dir, fetch })
  assert.deepEqual(await images.access(), { kind: 'openai', model: 'gpt-image-1' })
  const made = await images.generate({ prompt: 'A clay fox', size: '1024x1024', callId: 'call-1' })
  assert.equal(asked[0].url, OPENAI_IMAGES)
  assert.equal(asked[0].auth, 'Bearer sk-test')
  assert.deepEqual(asked[0].body, { model: 'gpt-image-1', prompt: 'A clay fox', size: '1024x1024', quality: 'auto', n: 1, stream: true, partial_images: 2 })
  assert.match(made.file, /images[\\/]img-[a-z0-9-]+\.png$/)
  assert.deepEqual(readFileSync(made.file), Buffer.from(PNG, 'base64'))
  // The card asks for what it has not seen: both partials first, then none.
  const first = images.progress('call-1', 0)
  assert.equal(first.phase, 'done')
  assert.equal(first.id, made.id)
  assert.deepEqual(first.partials.map(partial => partial.index), [0, 1])
  assert.deepEqual(images.progress('call-1', 2).partials, [])
  assert.deepEqual(await images.imageFile(made.id), Buffer.from(PNG, 'base64'))
  assert.equal(await images.imageFile('../state'), undefined)
  // Nothing it answers carries the key.
  assert.doesNotMatch(JSON.stringify([await images.access(), first]), /sk-test/)
})

test('a ChatGPT sign-in that ran out is renewed in its own record, then draws on the Codex backend', async (t) => {
  const dir = folderOf(t)
  const fresh = tokenFor('acct-2')
  const store = storeOf({ [CODEX_RECORD]: { kind: 'grant', payload: { type: 'oauth', access: tokenFor('acct-1'), refresh: 'r-old', expires: 1_000, accountId: 'acct-1' } } })
  const asked = []
  const fetch = async (url, init) => {
    asked.push({ url: String(url), init })
    if (String(url) === 'https://auth.openai.com/oauth/token') return Response.json({ access_token: fresh, refresh_token: 'r-new', expires_in: 3600 })
    // This backend answers in one piece, without partials.
    return Response.json({ data: [{ b64_json: PNG }] })
  }
  const images = createImageGen({ credentials: () => store, folder: () => dir, fetch, now: () => 5_000_000 })
  const made = await images.generate({ prompt: 'A lamp', callId: 'call-2' })
  const refresh = new URLSearchParams(asked[0].init.body)
  assert.equal(refresh.get('grant_type'), 'refresh_token')
  assert.equal(refresh.get('refresh_token'), 'r-old')
  assert.deepEqual(store.records[CODEX_RECORD].payload, { type: 'oauth', access: fresh, refresh: 'r-new', expires: 5_000_000 + 3_600_000, accountId: 'acct-2' })
  assert.equal(asked[1].url, CODEX_IMAGES)
  assert.equal(asked[1].init.headers['chatgpt-account-id'], 'acct-2')
  assert.equal(JSON.parse(asked[1].init.body).model, 'gpt-image-2')
  assert.equal(made.via, 'chatgpt')
  assert.equal(images.progress('call-2').partials.length, 0)
})

test('a backend that will not stream is asked again whole, and not asked to stream again', async (t) => {
  const dir = folderOf(t)
  const bodies = []
  const fetch = async (_url, init) => {
    const body = JSON.parse(init.body)
    bodies.push(body)
    if (body.stream) return Response.json({ error: { message: 'Unknown parameter: stream' } }, { status: 400 })
    return Response.json({ data: [{ b64_json: PNG }] })
  }
  const store = storeOf({ [CODEX_RECORD]: { kind: 'grant', payload: { access: tokenFor('acct'), refresh: 'r', expires: 9e15 } } })
  const images = createImageGen({ credentials: () => store, folder: () => dir, fetch })
  await images.generate({ prompt: 'One', callId: 'a' })
  await images.generate({ prompt: 'Two', callId: 'b' })
  assert.deepEqual(bodies.map(body => body.stream === true), [true, false, false])
})

test('with nothing connected, or a refusal, the tool says why and the card shows it failed', async (t) => {
  const dir = folderOf(t)
  const none = createImageGen({ credentials: () => storeOf({}), folder: () => dir, fetch: async () => { throw new Error('no call') } })
  assert.equal(await none.access(), null)
  await assert.rejects(none.generate({ prompt: 'x', callId: 'c' }), /No image service is connected/)
  const refusing = createImageGen({ credentials: () => storeOf({ [OPENAI_RECORD]: { kind: 'api-key', key: 'k' } }), folder: () => dir, fetch: async () => Response.json({ error: { message: 'Your request was rejected by the safety system.' } }, { status: 400 }) })
  await assert.rejects(refusing.generate({ prompt: 'x', callId: 'd' }), /rejected by the safety system/)
  assert.equal(refusing.progress('d').phase, 'failed')
  await assert.rejects(refusing.generate({ prompt: '   ', callId: 'e' }), /Say what to draw/)
})

// The card's own helpers, bundled with a stand-in React.
const bundle = await build({
  stdin: { contents: "export { imageIdOf, ratioOf, stageOf } from './src/client/image-cell.js'", resolveDir: dirname(dirname(fileURLToPath(import.meta.url))) },
  bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent', external: ['react'],
})
const cell = { exports: {} }
runInNewContext(bundle.outputFiles[0].text, { module: cell, exports: cell.exports, require: () => ({ createElement: () => null, useEffect: () => {}, useRef: () => ({}), useState: v => [v, () => {}] }) })

test('the card finds the image the tool kept, frames it in the asked shape, and says how far it is', () => {
  const { imageIdOf, ratioOf, stageOf } = cell.exports
  assert.equal(imageIdOf('Drew the image with the user\'s OpenAI key and saved it as /w/images/img-1234abcd-ef.png. It is on screen'), 'img-1234abcd-ef')
  assert.equal(imageIdOf('C:\\w\\images\\img-1234abcd-ef.png'), 'img-1234abcd-ef')
  assert.equal(imageIdOf('No image service is connected.'), undefined)
  assert.equal(ratioOf('1536x1024'), '3 / 2')
  assert.equal(ratioOf('auto'), '1 / 1')
  assert.equal(stageOf(0), 'Reading the brief')
  assert.equal(stageOf(20), 'Laying in the color')
  assert.equal(stageOf(200), 'Almost there')
})
