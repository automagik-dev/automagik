// The selector's marks are the sources' own artwork, not lookalikes: DSH's official fish,
// Herdr's ram, and each named agent's own icon. The bundle is tested with a React stub.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { build } from 'esbuild'

const bundle = await build({
  entryPoints: [fileURLToPath(new URL('../src/client/marks.js', import.meta.url))],
  bundle: true, format: 'cjs', platform: 'node', write: false, external: ['react'],
})
const module = { exports: {} }
runInNewContext(bundle.outputFiles[0].text, {
  module, exports: module.exports,
  require: name => (name === 'react'
    ? { createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }) }
    : (() => { throw new Error(`no platform module ${name}`) })()),
})
const { DshMarkIcon, HerdrMarkIcon, AgentMark } = module.exports

test('Native draws DSH\'s official fish, not DeepSeek\'s corporate mark', () => {
  const icon = DshMarkIcon({ size: 16 })
  assert.equal(icon.type, 'svg')
  assert.equal(icon.props.viewBox, '0 0 23.16 17.04')
  assert.equal(icon.props.width, 16)
  assert.ok(icon.children[0].props.d.length > 1000)
  assert.equal(icon.children[0].props.fill, 'currentColor')
})

test('Herdr draws the ram and terminal prompt of its own app icon', () => {
  const icon = HerdrMarkIcon({ size: 16 })
  assert.equal(icon.type, 'svg')
  assert.equal(icon.props.viewBox, '0 0 1024 1024')
  assert.ok(icon.children[0].children[0].props.d.length > 1000)
})

test('each named agent gets its own official mark, and an unknown agent gets its initial', () => {
  for (const id of ['acp-claude', 'acp-codex', 'acp-hermes', 'acp-antigravity', 'acp-omp']) {
    const icon = AgentMark({ id, name: id })
    assert.equal(icon.type, 'img', id)
    assert.match(icon.props.src, /^data:image\/svg\+xml;base64,/, id)
    assert.equal(icon.props.width, 16)
    assert.equal(icon.props.alt, '')
  }
  // The same mapping serves Herdr ids without the acp- prefix.
  assert.equal(AgentMark({ id: 'claude' }).props.src, AgentMark({ id: 'acp-claude' }).props.src)
  const unknown = AgentMark({ id: 'acp-later', name: 'Later' })
  assert.equal(unknown.type, 'span')
  assert.equal(unknown.props.className, 'bt-agent-initial')
  assert.deepEqual(unknown.children, ['L'])
})
