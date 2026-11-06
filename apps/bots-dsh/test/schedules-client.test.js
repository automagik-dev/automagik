// The Scheduled tasks page's rule text. DSH 0.2.2's own schedule tools create rrule tasks,
// so Settings must show their rule; before the rrule case it showed nothing.
import assert from 'node:assert/strict'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { test } from 'node:test'
import { build } from 'esbuild'

const plugin = dirname(dirname(fileURLToPath(import.meta.url)))
const { outputFiles } = await build({
  stdin: { contents: "export { timingText } from './src/client/schedules.js'", resolveDir: plugin },
  bundle: true,
  format: 'cjs',
  platform: 'node',
  write: false,
  logLevel: 'silent',
  external: ['react', 'react-dom', '@deepseek-ai/dsh-client-ui-primitives'],
})
const module = { exports: {} }
const react = {
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }),
  Fragment: 'fragment',
  useEffect() {},
  useState: value => [value, () => {}],
}
runInNewContext(outputFiles[0].text, {
  module,
  exports: module.exports,
  require: name => ({ react, 'react-dom': { createPortal: node => node } })[name] ?? {},
  Intl,
  Date,
})

test('an rrule task shows its rule line, without the DTSTART header', () => {
  const task = { kind: 'rrule', rrule: 'DTSTART:20300101T090000Z\nRRULE:FREQ=DAILY;INTERVAL=2' }
  assert.equal(module.exports.timingText(task), 'On the schedule FREQ=DAILY;INTERVAL=2')
})
