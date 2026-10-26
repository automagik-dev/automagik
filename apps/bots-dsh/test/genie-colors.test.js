import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const bundle = await build({
  stdin: { contents: "export { genieTint, hueOf } from './src/client/genie-tint.js'\nexport { freeGenieColors } from './src/client/genie-new.js'", resolveDir: dirname(dirname(fileURLToPath(import.meta.url))) },
  bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent', external: ['react', 'react-dom'],
})
const loaded = { exports: {} }
const react = { createElement: () => null, useEffect: () => {}, useLayoutEffect: () => {}, useMemo: f => f(), useRef: () => ({}), useState: v => [v, () => {}], Fragment: 'f' }
runInNewContext(bundle.outputFiles[0].text, { module: loaded, exports: loaded.exports, URLSearchParams, require: name => (name === 'react' ? react : { createPortal: x => x }) })
const { genieTint, hueOf, freeGenieColors } = loaded.exports

// genie-dsh's GENIE_COLORS (plugins/genie-dsh/src/host/genie.js in the genie repository).
const GENIE_COLORS = ['violet', 'blue', 'cyan', 'green', 'yellow', 'orange', 'red', 'magenta', 'aurora', 'brown', 'gray', 'black']

test('magenta, and a Genie saved before Genies had colors, are Genie as painted', () => {
  assert.equal(genieTint('magenta'), undefined)
  assert.equal(genieTint(undefined), undefined)
  assert.equal(genieTint('no-such-color'), undefined)
})

test('every Genie color turns the painting, and no two Genie colors look the same', () => {
  const tints = GENIE_COLORS.filter(color => color !== 'magenta').map(genieTint)
  assert.ok(tints.every(tint => typeof tint === 'string' && tint !== ''))
  assert.equal(new Set(tints).size, tints.length)
  assert.match(genieTint('gray'), /^saturate\(0\)/)
  assert.match(genieTint('black'), /brightness\(\.42\)/)
  assert.match(genieTint('blue'), /^hue-rotate\(-?\d+deg\)$/)
  assert.equal(genieTint('aurora'), 'aurora')
  assert.equal(Math.round(hueOf('#ff0000')), 0)
  assert.equal(Math.round(hueOf('#0000ff')), 240)
})

test('a new Genie is offered only the colors no Genie wears', () => {
  assert.deepEqual([...freeGenieColors({ colors: GENIE_COLORS, taken: ['violet', 'cyan'] })].slice(0, 2), ['blue', 'green'])
  assert.deepEqual([...freeGenieColors({ colors: GENIE_COLORS, taken: GENIE_COLORS })], [])
  assert.deepEqual([...freeGenieColors(undefined)], [])
})
