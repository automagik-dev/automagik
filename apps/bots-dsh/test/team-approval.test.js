import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { build } from 'esbuild'

// The card's module as the browser gets it, with stand-ins for the platform it runs on.
const bundle = await build({
  entryPoints: [fileURLToPath(new URL('../src/client/team-approval.js', import.meta.url))],
  bundle: true, format: 'cjs', platform: 'node', write: false,
  external: ['react', 'react-dom', '@deepseek-ai/dsh-client-ui-primitives'],
})
const module = { exports: {} }
runInNewContext(bundle.outputFiles[0].text, {
  module, exports: module.exports,
  require: (name) => {
    const platform = {
      react: { createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }), useState: initial => [initial, () => {}], useEffect: () => {}, useRef: initial => ({ current: initial }), useLayoutEffect: () => {}, useMemo: fn => fn(), useCallback: fn => fn, useSyncExternalStore: () => undefined, Fragment: 'fragment', forwardRef: fn => fn, memo: fn => fn, createContext: () => ({}), useContext: () => undefined },
      'react-dom': { createPortal: node => node },
      '@deepseek-ai/dsh-client-ui-primitives': {},
    }
    if (!(name in platform)) throw new Error(`no platform module ${name}`)
    return platform[name]
  },
  document: undefined, window: undefined, Date, Math, JSON, Intl, setTimeout, clearTimeout,
})
const { approvalView, argsOf, isTeamApproval } = module.exports
const plain = value => JSON.parse(JSON.stringify(value))

test('a Claude Code chat\'s delegation reads as a handoff, with the message as a quote', () => {
  const reason = JSON.stringify({ to: 'Genie', message: 'Create delegation-test.txt, then reply with its path.' })
  const view = approvalView('mcp__dsh__message_bot', argsOf(reason), 'Echo')
  assert.equal(view.title, 'Echo wants to hand work to Genie')
  assert.equal(view.to, 'Genie')
  assert.equal(view.quote, 'Create delegation-test.txt, then reply with its path.')
  assert.equal(view.note, 'Genie works on it in its own chat and reports back.')
})

test('the card takes over only the team\'s own tools, with or without the bridge prefix', () => {
  assert.equal(isTeamApproval({ kind: 'approval', toolName: 'mcp__dsh__message_bot' }), true)
  assert.equal(isTeamApproval({ kind: 'approval', toolName: 'start_task' }), true)
  assert.equal(isTeamApproval({ kind: 'approval', toolName: 'bash' }), false)
  assert.equal(isTeamApproval({ kind: 'question', toolName: 'message_bot' }), false)
})

test('arguments that are not the bridge\'s JSON give no fields, and nothing shows as raw JSON', () => {
  assert.deepEqual(plain(argsOf('escalate sandbox')), {})
  assert.deepEqual(plain(argsOf('[1,2]')), {})
  const view = approvalView('mcp__dsh__save_capability', { name: 'github', spec: { nested: true }, note: ' ' }, undefined)
  assert.equal(view.title, 'This Bot wants to use save_capability')
  assert.deepEqual(plain(view.rows), [['name', 'github']])
})
