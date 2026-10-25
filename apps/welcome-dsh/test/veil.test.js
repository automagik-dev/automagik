import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { build } from 'esbuild'

const bundle = await build({
  entryPoints: [fileURLToPath(new URL('../src/client/veil.js', import.meta.url))],
  bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent',
})
const module = { exports: {} }
runInNewContext(bundle.outputFiles[0].text, { module, exports: module.exports, setTimeout, clearTimeout, fetch: () => Promise.reject(new Error('no host')) })
const { installVeil } = module.exports

// A body that records its children, with the one query the veil makes.
function page() {
  const children = []
  const element = () => {
    const classes = new Set()
    const node = { attrs: {}, classList: { add: name => classes.add(name), has: name => classes.has(name) }, setAttribute: (k, v) => { node.attrs[k] = v }, remove: () => children.splice(children.indexOf(node), 1) }
    Object.defineProperty(node, 'className', { set: value => value.split(' ').forEach(name => classes.add(name)) })
    return node
  }
  const doc = {
    body: { append: node => children.push(node) },
    createElement: element,
    querySelector: () => children.find(node => node.attrs['aria-modal'] === 'true' && !node.classList.has('oai-veil')) ?? null,
  }
  let changed = () => {}
  const observe = (_target, onChange) => { changed = onChange; return () => { changed = () => {} } }
  return { doc, children, observe, changed: () => changed() }
}
const settle = ms => new Promise(done => setTimeout(done, ms))
const pending = () => new Promise(() => {})

test('outside the desktop app there is no veil', () => {
  const { doc, children, observe } = page()
  installVeil({ doc, scope: {}, request: pending, observe })
  assert.equal(children.length, 0)
})

test("in the app, the table covers DSH's first frame until a step is up", async () => {
  const { doc, children, observe, changed } = page()
  installVeil({ doc, scope: { omniDesktop: {} }, request: pending, observe, wait: 10_000 })
  assert.equal(children.length, 1)
  assert.equal(children[0].attrs['aria-hidden'], 'true')
  changed()
  assert.ok(!children[0].classList.has('oai-veil-out'), 'nothing is up yet: it stays')
  const step = doc.createElement('div')
  step.setAttribute('aria-modal', 'true')
  doc.body.append(step)
  changed()
  assert.ok(children[0].classList.has('oai-veil-out'))
  await settle(250)
  assert.deepEqual(children, [step])
})

test('a person who already has a companion and a team gets no veil for long', async () => {
  const { doc, children, observe } = page()
  installVeil({ doc, scope: { omniDesktop: {} }, request: async () => ({ companionDone: true, teamDone: true }), observe, wait: 10_000 })
  await settle(250)
  assert.equal(children.length, 0)
})

test('the veil never outstays its wait, nor a host that cannot answer', async () => {
  const late = page()
  installVeil({ doc: late.doc, scope: { omniDesktop: {} }, request: pending, observe: late.observe, wait: 20 })
  const failed = page()
  installVeil({ doc: failed.doc, scope: { omniDesktop: {} }, request: () => Promise.reject(new Error('down')), observe: failed.observe, wait: 10_000 })
  await settle(260)
  assert.equal(late.children.length, 0)
  assert.equal(failed.children.length, 0)
})
