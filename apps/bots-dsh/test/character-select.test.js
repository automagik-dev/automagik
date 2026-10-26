import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const bundle = await build({
  stdin: { contents: "export { automagikRoster, currentKey } from './src/client/character-select.js'\nexport { lookOf } from './src/client/mark.js'", resolveDir: dirname(dirname(fileURLToPath(import.meta.url))) },
  bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent', external: ['react', 'react-dom'],
})
const select = { exports: {} }
const react = { createElement: () => null, useEffect: () => {}, useLayoutEffect: () => {}, useMemo: f => f(), useRef: () => ({}), useState: v => [v, () => {}], Fragment: 'f' }
runInNewContext(bundle.outputFiles[0].text, { module: select, exports: select.exports, URLSearchParams, require: name => (name === 'react' ? react : { createPortal: x => x }) })
const { automagikRoster, currentKey, lookOf } = select.exports

test('Automagik\'s own come first: Genie, Omni, then every character but the octopus Omni wears', () => {
  const roster = automagikRoster()
  assert.deepEqual([...roster.slice(0, 2).map(entry => entry.key)], ['pet:builtin:genie-cosmic', 'omni'])
  assert.ok(roster.slice(2).every(entry => entry.kind === 'shape'))
  assert.ok(!roster.some(entry => entry.key === 'shape:octopus'))
  assert.equal(roster.find(entry => entry.key === 'shape:gumdrop').name, 'Gumdrop')
})

test('the cursor starts on what the Bot wears now', () => {
  const key = bot => currentKey(bot, lookOf(bot))
  assert.equal(key({ id: 'b', avatar: { shape: 'star' } }), 'shape:star')
  assert.equal(key({ id: 'b', color: 'deepseek', avatar: { shape: 'octopus' } }), 'omni')
  assert.equal(key({ id: 'g', kind: 'genie' }), 'pet:builtin:genie-cosmic')
  assert.equal(key({ id: 'b', avatar: { pet: { source: 'team', id: 'sayo', version: 2 } } }), 'pet:team:sayo')
  assert.equal(key({ id: 'b', avatar: { image: 'data:image/png;base64,AA==' } }), 'photo')
})
