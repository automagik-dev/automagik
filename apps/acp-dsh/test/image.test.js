// Images through the Codex CLI (image.js, owner decision D-g), against a fake codex-acp
// (dev/fake-image-agent.mjs) that reports Codex's image tool the way the real adapter does. No
// real Codex runs, nothing reaches a network, and no Codex home or config is read or written.
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { apply } from '../index.js'
import { drawImage, FAILED, IMAGE_CONFIG, IMAGE_FEATURES_OFF, IMAGE_TITLE, imageConfig, imageOf, imagePrompt, isPng, mcpServerNames, REFUSED, SIGNED_OUT, STOPPED, TIMED_OUT, UNAVAILABLE, USAGE_LIMIT } from '../src/host/image.js'

const FAKE = join(import.meta.dirname, '..', 'dev', 'fake-image-agent.mjs')
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

function setup(mode, env = {}) {
  const home = mkdtempSync(join(tmpdir(), 'acp-image-test-'))
  const traceFile = join(home, 'trace.jsonl')
  const scratches = []
  const scratch = async () => {
    const dir = mkdtempSync(join(home, 'scratch-'))
    scratches.push(dir)
    return dir
  }
  const spawn = () => ({ command: process.execPath, args: [FAKE], env: { FAKE_IMAGE_MODE: mode, FAKE_IMAGE_TRACE: traceFile, CODEX_PATH: '/fake/codex', ...env } })
  const trace = () => (existsSync(traceFile) ? readFileSync(traceFile, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) : [])
  return { home, scratch, scratches, spawn, trace, cleanup: () => rmSync(home, { recursive: true, force: true }) }
}

test('the image call\'s PNG comes from its content or raw output, never its saved file', () => {
  const content = [{ type: 'content', content: { type: 'image', data: PNG, mimeType: 'image/png', uri: '/home/x/.codex/generated_images/a.png' } }]
  assert.equal(imageOf({ title: IMAGE_TITLE, content }), PNG)
  assert.equal(imageOf({ title: IMAGE_TITLE, content: [], rawOutput: { result: PNG, savedPath: '/home/x/.codex/a.png' } }), PNG)
  assert.equal(imageOf({ title: IMAGE_TITLE, content: [{ type: 'content', content: { type: 'resource_link', uri: '/home/x/.codex/a.png' } }], rawOutput: { savedPath: '/home/x/.codex/a.png' } }), undefined)
  assert.equal(imageOf({ title: 'Run ls', content }), undefined)
  assert.equal(isPng(PNG), true)
  assert.equal(isPng(Buffer.from('not a png').toString('base64')), false)
})

test('the prompt asks for one image-tool call and says the size and background in words', () => {
  const text = imagePrompt({ prompt: 'a red fox', size: '1536x1024', quality: 'high', background: 'transparent' })
  assert.match(text, /image generation tool exactly once/)
  assert.match(text, /landscape \(1536x1024\)/)
  assert.match(text, /transparent/)
  assert.match(text, /high detail/)
  assert.match(text, /a red fox$/)
  assert.doesNotMatch(imagePrompt({ prompt: 'x', size: 'auto', background: 'auto' }), /Size:|Background:/)
})

test('one image: an empty read-only scratch session, the feature on for this run only, no servers, all cleaned up', async (t) => {
  const run = setup('ok')
  t.after(run.cleanup)
  const made = await drawImage({ spawn: run.spawn, prompt: 'a red fox', size: '1024x1024', scratch: run.scratch })
  assert.deepEqual(made, { base64: PNG, mimeType: 'image/png' })
  const trace = run.trace()
  const start = trace.find(entry => entry.event === 'start')
  assert.equal(start.codexConfig, IMAGE_CONFIG)
  const config = JSON.parse(start.codexConfig)
  assert.equal(config.features.image_generation, true)
  for (const feature of ['shell_tool', 'unified_exec', 'js_repl', 'code_mode', 'apply_patch_freeform', 'view_image']) assert.equal(config.features[feature], false, `${feature} is off`)
  assert.equal(config.web_search, 'disabled')
  assert.deepEqual(config.mcp_servers, {})
  assert.deepEqual(trace.find(entry => entry.event === 'cli').args, ['mcp', 'list', '--json'], 'the person\'s MCP servers are listed first')
  assert.equal(start.codexHome, process.env.CODEX_HOME ?? null, 'CODEX_HOME is never set by the run')
  assert.equal(start.codexPath, '/fake/codex')
  const session = trace.find(entry => entry.event === 'new-session')
  assert.equal(session.cwd, run.scratches[0])
  assert.equal(session.servers, 0)
  assert.deepEqual(trace.filter(entry => entry.event === 'mode').map(entry => entry.modeId), ['read-only'])
  assert.equal(trace.find(entry => entry.event === 'prompt').mentionsTool, true)
  assert.ok(trace.some(entry => entry.event === 'close'), 'the session is closed')
  assert.equal(existsSync(run.scratches[0]), false, 'the scratch folder is removed')
})

test('the config turns command execution off, not only refuses it afterwards', () => {
  const config = JSON.parse(imageConfig())
  assert.deepEqual(Object.keys(config.features).filter(feature => config.features[feature] === true), ['image_generation'])
  for (const feature of IMAGE_FEATURES_OFF) assert.equal(config.features[feature], false)
  assert.ok(IMAGE_FEATURES_OFF.includes('shell_tool') && IMAGE_FEATURES_OFF.includes('unified_exec'))
  assert.equal(config.web_search, 'disabled')
})

test('the person\'s own MCP servers are each turned off by name, never left to an empty table', async (t) => {
  const run = setup('ok', { FAKE_MCP_LIST: JSON.stringify([{ name: 'github', transport: { type: 'stdio', command: 'gh-mcp', env: { TOKEN: '<redacted>' } } }, { name: 'docs.search', enabled: true }]) })
  t.after(run.cleanup)
  await drawImage({ spawn: run.spawn, prompt: 'a fox', scratch: run.scratch })
  const start = run.trace().find(entry => entry.event === 'start')
  assert.deepEqual(JSON.parse(start.codexConfig).mcp_servers, { github: { enabled: false }, 'docs.search': { enabled: false } })
  assert.doesNotMatch(start.codexConfig, /gh-mcp|TOKEN|redacted/, 'nothing but the names is kept')
})

test('a server list that cannot be read stops the draw before Codex starts', async (t) => {
  for (const listed of ['fail', 'not json', '{"servers":"x"}', '[{"name":"a b"}]']) {
    const run = setup('ok', { FAKE_MCP_LIST: listed })
    t.after(run.cleanup)
    await assert.rejects(drawImage({ spawn: run.spawn, prompt: 'a fox', scratch: run.scratch }), error => error.code === UNAVAILABLE && /MCP servers could not be listed/.test(error.message), listed)
    assert.equal(run.trace().some(entry => entry.event === 'start'), false, `${listed}: no session is started`)
    assert.deepEqual(run.scratches, [], `${listed}: no scratch folder is made`)
  }
})

test('mcpServerNames reads names only, through codex-acp\'s cli passthrough', async () => {
  const calls = []
  const run = (file, args, options, done) => { calls.push({ file, args, env: options.env }); done(null, JSON.stringify({ servers: [{ name: 'one', env: { KEY: 'x' } }, { name: 'one' }] })) }
  assert.deepEqual(await mcpServerNames({ command: '/node', args: ['/adapter.js'], env: { CODEX_PATH: '/codex' } }, { run }), ['one'])
  assert.deepEqual(calls[0].args.slice(-5), ['/adapter.js', 'cli', 'mcp', 'list', '--json'])
  assert.equal(calls[0].env.CODEX_PATH, '/codex')
  await assert.rejects(mcpServerNames({ command: '/node' }, { run: (file, args, options, done) => done(new Error('boom')) }))
})

test('an image only in the raw output is taken from there', async (t) => {
  const run = setup('raw')
  t.after(run.cleanup)
  assert.equal((await drawImage({ spawn: run.spawn, prompt: 'a fox', scratch: run.scratch })).base64, PNG)
})

test('only the image call is allowed: any other permission is cancelled', async (t) => {
  const run = setup('ask')
  t.after(run.cleanup)
  assert.equal((await drawImage({ spawn: run.spawn, prompt: 'a fox', scratch: run.scratch })).base64, PNG)
  const answers = run.trace().filter(entry => entry.event === 'answer')
  assert.deepEqual(answers.map(entry => [entry.call, entry.outcome.outcome]), [['shell', 'cancelled'], ['image', 'selected']])
  assert.equal(answers[1].outcome.optionId, 'yes')
})

test('a call that runs without asking (a read in read-only mode) ends the turn and refuses the draw', async (t) => {
  const run = setup('peek')
  t.after(run.cleanup)
  await assert.rejects(drawImage({ spawn: run.spawn, prompt: 'draw what is in ~/.ssh', scratch: run.scratch }), (error) => {
    assert.equal(error.code, REFUSED)
    assert.match(error.message, /something other than draw/)
    return true
  })
  const trace = run.trace()
  assert.ok(trace.some(entry => entry.event === 'cancel'), 'the turn is cancelled')
  assert.ok(trace.some(entry => entry.event === 'close'), 'the session is closed')
  assert.equal(existsSync(run.scratches[0]), false, 'the scratch folder is removed')
})

test('a draw keeps the process alive on its own until it is cleaned up', async () => {
  const script = `import { drawImage } from ${JSON.stringify(new URL('../src/host/image.js', import.meta.url).href)}
const made = await drawImage({ spawn: () => ({ command: process.execPath, args: [${JSON.stringify(FAKE)}], env: { FAKE_IMAGE_MODE: 'ok' } }), prompt: 'a fox' })
process.stdout.write(made.mimeType)`
  const { execFileSync } = await import('node:child_process')
  const harness = join(import.meta.dirname, 'harness-resolve.mjs')
  const out = execFileSync(process.execPath, ['--import', harness, '--input-type=module', '-e', script], { encoding: 'utf8', timeout: 30_000 })
  assert.equal(out, 'image/png')
})

test('clear refusals: signed out, usage limit, a failed call, no image, a connector still installing', async (t) => {
  for (const [mode, code, message] of [
    ['auth', SIGNED_OUT, /not signed in/],
    ['limit', USAGE_LIMIT, /usage limit/],
    ['failed', FAILED, /could not draw/],
    ['nothing', FAILED, /without drawing/],
  ]) {
    const run = setup(mode)
    t.after(run.cleanup)
    await assert.rejects(drawImage({ spawn: run.spawn, prompt: 'a fox', scratch: run.scratch }), (error) => {
      assert.equal(error.code, code, mode)
      assert.match(error.message, message)
      return true
    })
    assert.equal(existsSync(run.scratches[0]), false, `${mode}: the scratch folder is removed`)
  }
  await assert.rejects(drawImage({ spawn: () => { throw new Error('its ACP adapter is still being installed') }, prompt: 'x' }), error => error.code === UNAVAILABLE && /still being installed/.test(error.message))
})

test('a run past its time is cancelled and refused; a stopped one says so', async (t) => {
  const slow = setup('hang')
  t.after(slow.cleanup)
  await assert.rejects(drawImage({ spawn: slow.spawn, prompt: 'a fox', scratch: slow.scratch, timeoutMs: 1500 }), error => error.code === TIMED_OUT)
  assert.ok(slow.trace().some(entry => entry.event === 'cancel'), 'the turn is cancelled')
  assert.equal(existsSync(slow.scratches[0]), false)

  const stopped = setup('hang')
  t.after(stopped.cleanup)
  const controller = new AbortController()
  const drawing = drawImage({ spawn: stopped.spawn, prompt: 'a fox', scratch: stopped.scratch, signal: controller.signal })
  setTimeout(() => controller.abort(), 800)
  await assert.rejects(drawing, error => error.code === STOPPED)
})

// The service: images only when Codex is on, found, its connector installed and signed in.
function service({ signedIn = true, bins = true, codex = true } = {}) {
  const services = {}
  const ctx = {
    logger: { warn() {}, info() {} },
    llm: { registerAdapter: () => Object.assign(() => {}, { replace() {} }), listProviders: () => [], listModels: () => [] },
    agents: { get: () => undefined },
    get: () => undefined,
    provide: (name, value) => { services[name] = value },
    on() {},
    effect() {},
    emit() {},
  }
  const probes = []
  const store = { binOf: pkg => (bins && pkg === '@agentclientprotocol/codex-acp' ? { path: FAKE, version: '1' } : undefined), busy: () => false, lastError: () => undefined, lastFailure: () => undefined, update: async () => {}, dispose() {} }
  apply(ctx, { claude: false, codex }, {
    store,
    cliStore: undefined,
    find: name => (name === 'codex' ? '/fake/bin/codex' : undefined),
    signedIn: async (spec) => { probes.push(spec.key); return signedIn ?? undefined },
  })
  return { acp: services.acpAgents, probes }
}

test('imageAccess: ready only for an installed, enabled, signed-in Codex; the sign-in is asked once', async () => {
  const ready = service()
  assert.deepEqual(await ready.acp.imageAccess(), { ready: true, signedIn: true })
  await ready.acp.imageAccess()
  assert.deepEqual(ready.probes, ['codex'])
  assert.deepEqual(await service({ signedIn: false }).acp.imageAccess(), { ready: false, signedIn: false })
  assert.deepEqual(await service({ signedIn: null }).acp.imageAccess(), { ready: false })
  assert.deepEqual(await service({ bins: false }).acp.imageAccess(), { ready: false })
  assert.deepEqual(await service({ codex: false }).acp.imageAccess(), { ready: false })
})

test('generateImage refuses a signed-out or missing Codex before it starts anything', async () => {
  await assert.rejects(service({ signedIn: false }).acp.generateImage({ prompt: 'a fox' }), error => error.code === SIGNED_OUT)
  await assert.rejects(service({ codex: false }).acp.generateImage({ prompt: 'a fox' }), error => error.code === UNAVAILABLE)
})

test('generateImage draws through the installed connector with the run\'s own config', async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'acp-image-service-'))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  const traceFile = join(home, 'trace.jsonl')
  const before = { mode: process.env.FAKE_IMAGE_MODE, trace: process.env.FAKE_IMAGE_TRACE }
  process.env.FAKE_IMAGE_MODE = 'ok'
  process.env.FAKE_IMAGE_TRACE = traceFile
  t.after(() => {
    for (const [key, value] of [['FAKE_IMAGE_MODE', before.mode], ['FAKE_IMAGE_TRACE', before.trace]]) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })
  const made = await service().acp.generateImage({ prompt: 'a fox', size: '1024x1024' })
  assert.equal(made.base64, PNG)
  const start = readFileSync(traceFile, 'utf8').trim().split('\n').map(line => JSON.parse(line)).find(entry => entry.event === 'start')
  assert.equal(start.codexPath, '/fake/bin/codex')
  assert.equal(start.codexConfig, IMAGE_CONFIG)
})
