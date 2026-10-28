// The plugin in Unfold's own DSH: Unfold names the bridge's state folder and its port in the env
// DSH starts with. Its own file: the first start in a process is the one that reads them.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createServer, request } from 'node:http'
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fakeLlm } from './fake-llm.js'

const freePort = () => new Promise(resolve => {
  const probe = createServer().listen(0, '127.0.0.1', () => {
    const { port } = probe.address()
    probe.close(() => resolve(port))
  })
})

// The host plugin context: ctx.llm, ctx.effect (its disposer runs at unload), ctx.inject for the
// work view, and a logger.
function fakeContext(llm) {
  const disposers = []
  const logs = []
  const injected = []
  return {
    llm,
    logs,
    injected,
    logger: { info: (...args) => logs.push(args), warn: (...args) => logs.push(args) },
    effect(execute) { disposers.push(execute()) },
    inject(names) { injected.push(names) },
    async unload() { for (const dispose of disposers.reverse()) await dispose?.() },
  }
}

const models = (port, key) => new Promise((resolve, reject) => {
  request({ host: '127.0.0.1', port, path: '/v1/models', agent: false, headers: { Host: `127.0.0.1:${port}`, Authorization: `Bearer ${key}` } }, res => {
    res.resume()
    res.on('end', () => resolve(res.statusCode))
  }).on('error', reject).end()
})

async function until(check) {
  for (let i = 0; i < 200; i++) {
    try { if (check()) return } catch {}
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error('timed out')
}

test('the folder and port Unfold names are used, leave the env at start, and stay for a restart', async () => {
  const root = mkdtempSync(join(tmpdir(), 'unfold-bridge-own-'))
  const dir = join(root, 'instances', 'one', 'dsh', 'bridge')
  const xdg = join(root, 'xdg')
  const was = process.env.XDG_STATE_HOME
  const port = await freePort()
  process.env.XDG_STATE_HOME = xdg
  process.env.UNFOLD_BRIDGE_STATE_DIR = dir
  process.env.UNFOLD_BRIDGE_PORT = String(port)
  const file = join(dir, 'endpoint.json')
  try {
    const plugin = await import('../index.js')
    const first = fakeContext(fakeLlm())
    plugin.apply(first)
    assert.equal(process.env.UNFOLD_BRIDGE_STATE_DIR, undefined, 'gone as soon as apply returns')
    assert.equal(process.env.UNFOLD_BRIDGE_PORT, undefined, 'gone as soon as apply returns')
    // a tool DSH spawns from here builds its env from process.env
    const child = spawnSync(process.execPath, ['-e', 'process.stdout.write(JSON.stringify(Object.keys(process.env).filter(k => k.startsWith("UNFOLD_BRIDGE_"))))'], { encoding: 'utf8' })
    assert.equal(child.status, 0, child.stderr)
    assert.deepEqual(JSON.parse(child.stdout), [], 'no UNFOLD_BRIDGE_ variable reaches a subprocess')
    assert.deepEqual(first.injected.length, 1, 'the work view still waits for its services')

    await until(() => statSync(file))
    const endpoint = JSON.parse(readFileSync(file, 'utf8'))
    assert.deepEqual(Object.keys(endpoint), ['v', 'port', 'key', 'pid', 'started'], 'the same JSON as today')
    assert.equal(endpoint.port, port, 'the named port, exactly')
    assert.equal(endpoint.pid, process.pid)
    assert.equal(statSync(dir).mode & 0o777, 0o700)
    assert.equal(statSync(file).mode & 0o777, 0o600)
    assert.equal(await models(port, endpoint.key), 200)
    assert.throws(() => statSync(join(xdg, 'unfold-bridge')), { code: 'ENOENT' }, 'the shared file is never written')

    // a restart in the same process keeps the folder and the port
    await first.unload()
    assert.throws(() => statSync(file), { code: 'ENOENT' })
    const second = fakeContext(fakeLlm())
    plugin.apply(second)
    await until(() => statSync(file))
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).port, port)
    await second.unload()

    // the port taken: no start, no file, one line naming the port, and the plugin's apply
    // returns so DSH goes on booting without the bridge
    const holder = createServer()
    await new Promise(resolve => holder.listen(port, '127.0.0.1', resolve))
    try {
      const third = fakeContext(fakeLlm())
      plugin.apply(third)
      assert.equal(third.injected.length, 1, 'the rest of the plugin still applies')
      await until(() => third.logs.some(([format]) => /not serving/.test(format)))
      const line = third.logs.find(([format]) => /not serving/.test(format))
      assert.match(String(line.slice(1).join(' ')), new RegExp(String(port)))
      assert.deepEqual(readdirSync(dir), [], 'no endpoint file')
      assert.throws(() => statSync(join(xdg, 'unfold-bridge')), { code: 'ENOENT' }, 'and none in the shared place')
      await third.unload()
    } finally { await new Promise(resolve => holder.close(resolve)) }
  } finally {
    delete process.env.UNFOLD_BRIDGE_STATE_DIR
    delete process.env.UNFOLD_BRIDGE_PORT
    if (was === undefined) delete process.env.XDG_STATE_HOME
    else process.env.XDG_STATE_HOME = was
    rmSync(root, { recursive: true, force: true })
  }
})
