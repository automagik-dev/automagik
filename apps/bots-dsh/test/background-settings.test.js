import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import { build } from 'esbuild'

const compiled = await build({ entryPoints: [new URL('../src/client/settings.js', import.meta.url).pathname], bundle: true, format: 'cjs', platform: 'node', write: false, external: ['react', 'react-dom', '@deepseek-ai/dsh-client-ui-primitives'] })
const module = { exports: {} }
const react = { createElement: () => null, Fragment: 'Fragment', useState: v => [v, () => {}], useEffect: () => {}, useLayoutEffect: () => {}, useRef: v => ({ current: v }), useCallback: f => f, useMemo: f => f(), useSyncExternalStore: (_s, snap) => snap() }
runInNewContext(compiled.outputFiles[0].text, { module, exports: module.exports, document: { body: {} }, window: { innerWidth: 1280, innerHeight: 800, matchMedia: () => ({ matches: false, addEventListener() {} }) }, require: name => (name === 'react-dom' ? { createPortal: n => n } : react) })
const { backgroundChoices } = module.exports

// Settings → Background jobs offers only a model that answers beside the chats and can run.
test('the background model choices leave out ACP agents, models without their key, and older Claude', () => {
  const models = [
    { ref: 'acp-codex/default', provider: 'acp-codex' },
    { ref: 'acp-claude/opus', provider: 'acp-claude' },
    { ref: 'deepseek/deepseek-flash', provider: 'deepseek' },
    { ref: 'openai/gpt-5.5', provider: 'openai', needsKey: true },
    { ref: 'anthropic/claude-opus-5-5', provider: 'anthropic' },
    { ref: 'anthropic/claude-opus-4-7', provider: 'anthropic', superseded: true },
  ]
  assert.deepEqual(Array.from(backgroundChoices(models), model => model.ref), ['deepseek/deepseek-flash', 'anthropic/claude-opus-5-5'])
  assert.equal(backgroundChoices(undefined).length, 0)
})
