import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { build } from 'esbuild'
import { DICTIONARY } from '../src/client/i18n.js'

// Settings → Agent access (#1091), as the owner sees it: a key is shown once, a revoke asks
// first, the log reads in plain words, and the page says how to connect an agent and who can
// reach the address. The page runs here on a small stand-in for React that keeps hook state,
// so a test presses the page's own buttons.
const { outputFiles } = await build({
  stdin: {
    contents: "export * from './src/client/agent-access.js'",
    resolveDir: fileURLToPath(new URL('..', import.meta.url)),
  },
  bundle: true, format: 'cjs', platform: 'browser', write: false, logLevel: 'silent',
  external: ['react', '@deepseek-ai/dsh-client-ui-primitives'],
})

function fakeReact() {
  const instances = new Map()
  let current = null
  let effects = []
  let seen = new Set()
  let dirty = false
  const slot = (make) => {
    const index = current.index++
    if (!(index in current.hooks)) current.hooks[index] = make()
    return [current.hooks, index]
  }
  const react = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useState: (initial) => {
      const [hooks, index] = slot(() => (typeof initial === 'function' ? initial() : initial))
      return [hooks[index], (next) => { hooks[index] = typeof next === 'function' ? next(hooks[index]) : next; dirty = true }]
    },
    useRef: (initial) => { const [hooks, index] = slot(() => ({ current: initial })); return hooks[index] },
    useId: () => 'id',
    useEffect: (run) => { const [hooks, index] = slot(() => null); if (hooks[index] === null) { hooks[index] = true; effects.push(run) } },
    useLayoutEffect: () => { current.index++ },
    useSyncExternalStore: (subscribe, getSnapshot) => getSnapshot(),
  }
  const render = (node, path) => {
    if (Array.isArray(node)) return node.map((child, index) => render(child, `${path}/${child?.props?.key ?? index}`))
    if (!node || typeof node !== 'object') return node
    if (typeof node.type === 'function') {
      const id = `${path}<${node.type.name}>`
      if (!instances.has(id)) instances.set(id, { hooks: [] })
      const instance = instances.get(id)
      seen.add(id)
      instance.index = 0
      const outer = current
      current = instance
      const output = node.type(node.props)
      current = outer
      return render(output, id)
    }
    return { type: node.type, props: { ...node.props, children: render(node.props.children, `${path}/${node.type}`) } }
  }
  // Render until the page rests: effects run after a pass, and what they set starts another.
  const mount = (element) => {
    let tree
    const settle = async () => {
      for (let pass = 0; pass < 20; pass += 1) {
        dirty = false
        seen = new Set()
        tree = render(element, 'root')
        for (const id of instances.keys()) if (!seen.has(id)) instances.delete(id)
        const due = effects
        effects = []
        for (const run of due) run()
        for (let turn = 0; turn < 5; turn += 1) await new Promise(resolve => setImmediate(resolve))
        if (!dirty) return tree
      }
      throw new Error('the page never came to rest')
    }
    return { settle, tree: () => tree }
  }
  return { react, mount }
}

const textOf = (node) => {
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (!node || typeof node !== 'object') return node == null || node === false || node === true ? '' : String(node)
  return textOf(node.props.children)
}
const all = (node, match, found = []) => {
  if (Array.isArray(node)) { for (const child of node) all(child, match, found); return found }
  if (!node || typeof node !== 'object') return found
  if (match(node)) found.push(node)
  return all(node.props.children, match, found)
}
const classed = name => node => String(node.props.className ?? '').split(' ').includes(name)

const HOUR = 3600000
const NOON = Date.UTC(2026, 10, 11, 12)
const TOKEN = `am_agent_${'0'.repeat(64)}`
const writer = { id: 'writer-demo', name: 'Writer' }
const roster = { byId: { 'writer-demo': writer }, roomsById: {}, bots: [writer], rooms: [] }
const Section = ({ title, children }) => ({ type: 'section', props: { children: [{ type: 'h3', props: { children: title } }, children] } })

// One page over a fake host: `state` is what the host would answer, `calls` what was asked.
async function open(state, { place = { protocol: 'http:', hostname: 'localhost', origin: 'http://localhost' }, clipboard = true } = {}) {
  const { react, mount } = fakeReact()
  const copied = []
  const module = { exports: {} }
  runInNewContext(outputFiles[0].text, {
    module, exports: module.exports,
    require: name => (name === 'react' ? react : { MarkdownText: ({ text }) => text }),
    document: { activeElement: null, querySelector: () => null, addEventListener: () => {}, removeEventListener: () => {} },
    location: place,
    navigator: clipboard ? { clipboard: { writeText: async (text) => { copied.push(text) } } } : {},
    setTimeout: () => 0, clearTimeout: () => {},
    HTMLInputElement: class {}, HTMLTextAreaElement: class {}, HTMLSelectElement: class {}, HTMLElement: class {},
    URL, URLSearchParams,
  })
  const calls = []
  const actions = {
    agentAccess: async () => structuredClone(state),
    agentTokenCreate: async (name) => {
      calls.push(['create', name])
      state.url ??= 'http://127.0.0.1:12345/mcp'
      state.tokens.push({ id: 'made', name, createdAt: NOON })
      return { id: 'made', token: TOKEN }
    },
    agentTokenRevoke: async (id) => { calls.push(['revoke', id]); state.tokens.find(row => row.id === id).revokedAt = NOON; return true },
  }
  const run = promise => Promise.resolve(promise).then(() => true, () => false)
  const page = mount(react.createElement(module.exports.AgentAccessPage, { actions, run, roster, Section }))
  await page.settle()
  const button = label => all(page.tree(), node => node.type === 'button' && (node.props['aria-label'] === label || textOf(node) === label))[0]
  return {
    api: module.exports, calls, copied, state,
    text: () => textOf(page.tree()),
    find: match => all(page.tree(), match),
    button,
    press: async (label) => { const node = button(label); assert.ok(node, `no button "${label}"`); node.props.onClick(); await page.settle() },
    type: async (value) => { all(page.tree(), node => node.type === 'input')[0].props.onChange({ target: { value } }); await page.settle() },
    pick: async (value) => { all(page.tree(), node => node.type === 'select')[0].props.onChange({ target: { value } }); await page.settle() },
    section: title => textOf(all(page.tree(), node => node.type === 'section' && textOf(node.props.children[0]).startsWith(title))[0]),
  }
}
const empty = () => ({ url: null, webPath: '/api/omni-mcp', tokens: [], audit: [] })
const call = (id, tokenName, action, at, more = {}) => ({ callId: `call-${id}`, tokenName, action, target: null, outcome: 'allowed', time: NOON + at, ...more })
const withKeys = () => ({
  url: 'http://127.0.0.1:12345/mcp', webPath: '/api/omni-mcp',
  tokens: [
    { id: 'old', name: 'Old laptop', createdAt: NOON - 8 * 24 * HOUR, revokedAt: NOON - 20 * HOUR },
    { id: 'live', name: 'Claude Code', createdAt: NOON - 26 * HOUR },
  ],
  audit: [],
})
const withLog = () => ({
  ...withKeys(),
  audit: [
    call(1, 'Old laptop', 'read_messages', -30 * HOUR, { target: 'writer-demo' }),
    call(2, 'Claude Code', 'initialize', 1000),
    call(3, 'Claude Code', 'notifications/initialized', 1200),
    call(4, 'Claude Code', 'tools/list', 1400),
    call(5, 'Claude Code', 'update_bot', 21000, { target: 'writer-demo', outcome: 'started' }),
    call(5, 'Claude Code', 'update_bot', 21400, { target: 'writer-demo', changes: { bots: { 'writer-demo': { role: { before: 'Writer', after: 'Editor' } } } } }),
    call(6, 'Unknown token', 'http', 190000, { outcome: 'refused', reason: 'Invalid agent token' }),
  ],
})

test('with no key the page says what to do, in each of its three parts', async () => {
  const page = await open(empty())
  assert.match(page.section('Agent keys · 0'), /No keys yet\. Create one for each agent you let in/)
  assert.match(page.section('Connect an agent'), /Create a key first\. The address and an example setup then show here\./)
  assert.match(page.section('Access log'), /Nothing yet\. What an agent does with a key is listed here\./)
  // Plain words: the page's own copy names no protocol, token or audit.
  assert.doesNotMatch(page.text(), /\bMCP\b|token|audit/i)
  // The title is the dialog's: no section repeats it.
  assert.equal(page.find(node => node.type === 'h3' && textOf(node) === 'Agent access').length, 0)
})

test('name and Create key are one row, and the button says what is missing rather than looking off', async () => {
  const page = await open(empty())
  const row = page.find(classed('bt-aa-create'))[0]
  assert.deepEqual(row.props.children.map(node => node.type), ['input', 'button'])
  assert.equal(page.button('Create key').props.disabled, false)
  await page.press('Create key')
  assert.match(page.text(), /Give the key a name first\./)
  await page.type('João')
  await page.press('Create key')
  assert.match(page.text(), /Use plain letters \(a–z\), numbers, spaces, dots and dashes, up to 60\./)
  assert.deepEqual(page.calls, [])
})

test('a new key is shown once, with a copy button and the warning, and is gone after Done', async () => {
  const page = await open(empty())
  await page.type('Claude Code')
  await page.press('Create key')
  assert.deepEqual(page.calls, [['create', 'Claude Code']])
  const card = page.find(classed('bt-aa-new'))[0]
  assert.match(textOf(card), /Key created for Claude Code/)
  assert.match(textOf(card), /Copy it now\. You will not see this key again\./)
  assert.equal(textOf(page.find(classed('bt-aa-code'))[0]), TOKEN)
  await page.press('Copy the key')
  assert.deepEqual(page.copied, [TOKEN])
  assert.equal(textOf(page.button('Copy the key')), 'Copied')
  // The key's row is already listed under the card, and the address is there to connect with.
  assert.match(page.section('Agent keys · 1'), /Claude Code.*Created Nov 11 · Not used yet/)
  assert.match(page.section('Connect an agent'), /http:\/\/127\.0\.0\.1:12345\/mcp/)
  await page.press('Done')
  assert.equal(page.find(classed('bt-aa-new')).length, 0)
  assert.doesNotMatch(page.text(), /am_agent_/)
  // What the host lists never holds the value, so a refresh cannot bring it back.
  await page.press('Refresh')
  assert.doesNotMatch(page.text(), /am_agent_/)
})

test('a window with no clipboard says to copy the key by hand', async () => {
  const page = await open(empty(), { clipboard: false })
  await page.type('Claude Code')
  await page.press('Create key')
  await page.press('Copy the key')
  assert.match(page.text(), /Copying did not work here\. Select the key and copy it by hand\. You will not see it again\./)
  assert.equal(textOf(page.button('Copy the key')), 'Copy')
})

test('keys list when they were made and last used; a revoked key is greyed with its date', async () => {
  const state = withLog()
  const page = await open(state)
  const rows = page.find(classed('bt-aa-key'))
  // The key in use comes first.
  assert.match(textOf(rows[0]), /^Claude CodeCreated Nov 10 · Last used Nov 11, /)
  assert.equal(rows[0].props['data-revoked'], undefined)
  assert.match(textOf(rows[1]), /^Old laptopRevokedCreated Nov 3 · Revoked Nov 10$/)
  assert.equal(rows[1].props['data-revoked'], '')
  assert.equal(all(rows[1], node => node.type === 'button').length, 0)
  assert.match(page.section('Agent keys · 1'), /Old laptop/)
})

test('revoking asks first: Keep leaves the key, Revoke takes it at once', async () => {
  const page = await open(withKeys())
  await page.press('Revoke Claude Code')
  assert.deepEqual(page.calls, [])
  assert.match(page.text(), /Revoke Claude Code\? The agent using it loses access at once\./)
  assert.deepEqual(all(page.find(classed('bt-aa-key'))[0], node => node.type === 'button').map(textOf), ['Keep', 'Revoke'])
  await page.press('Keep')
  assert.deepEqual(page.calls, [])
  assert.doesNotMatch(page.text(), /loses access at once/)
  await page.press('Revoke Claude Code')
  await page.press('Revoke')
  assert.deepEqual(page.calls, [['revoke', 'live']])
  assert.match(page.section('Agent keys · 0'), /Claude CodeRevokedCreated Nov 10 · Revoked Nov 11/)
  assert.equal(page.button('Revoke Claude Code'), undefined)
})

test('a key with no row in a full log says No recent use, never Not used yet', async () => {
  const state = withKeys()
  // 200 records, all from before the key in use was made: its own rows may have dropped out.
  state.audit = Array.from({ length: 200 }, (_, index) => call(index, 'Old laptop', 'list_bots', -40 * HOUR + index))
  const full = await open(state)
  assert.match(textOf(full.find(classed('bt-aa-key'))[0]), /^Claude CodeCreated Nov 10 · No recent useRevoke$/)
  state.audit.pop()
  const partial = await open(state)
  assert.match(textOf(partial.find(classed('bt-aa-key'))[0]), /^Claude CodeCreated Nov 10 · Not used yetRevoke$/)
})

test('older revoked keys fold away behind one row', async () => {
  const state = withKeys()
  for (let index = 0; index < 5; index += 1) state.tokens.push({ id: `gone-${index}`, name: `Gone ${index}`, createdAt: NOON - 40 * 24 * HOUR, revokedAt: NOON - (30 + index) * 24 * HOUR })
  const page = await open(state)
  assert.equal(page.find(classed('bt-aa-key')).length, 4)
  await page.press('Show 3 older revoked keys')
  assert.equal(page.find(classed('bt-aa-key')).length, 7)
})

test('the access log reads in plain words, with a before and after line and a status pill', async () => {
  const page = await open(withLog())
  const rows = page.find(classed('bt-aa-log'))
  const pill = row => textOf(all(row, classed('bt-aa-pill'))[0])
  // Newest first; the wrong key is refused under a name of its own.
  assert.match(textOf(rows[0]), /^Tried to connectUnknown key · Nov 11, .*The key was wrong or already revoked\.Refused$/)
  assert.equal(all(rows[0], classed('bt-aa-pill'))[0].props['data-outcome'], 'refused')
  // A change shows once (its start is not a line of its own), with the Bot's name and the field.
  assert.match(textOf(rows[1]), /^Changed a BotWriterClaude Code · Nov 11, /)
  assert.deepEqual(all(rows[1], node => node.type === 'li').map(textOf), ['Writer: role Writer → Editor'])
  assert.equal(pill(rows[1]), 'Allowed')
  // The three steps of one connection are one line.
  assert.match(textOf(rows[2]), /^Opened a connectionClaude Code · /)
  assert.match(textOf(rows[3]), /^Read messagesWriterOld laptop · Nov 10, /)
  assert.equal(rows.length, 4)
  assert.doesNotMatch(page.section('Access log'), /[{}"]|update_bot|tools\/list|token|audit/)
})

test('the log filters by key', async () => {
  const page = await open(withLog())
  const options = all(page.find(node => node.type === 'select')[0], node => node.type === 'option').map(textOf)
  assert.deepEqual(options, ['All keys', 'Old laptop', 'Claude Code', 'Unknown key'])
  await page.pick('Old laptop')
  assert.deepEqual(page.find(classed('bt-aa-log')).map(row => textOf(row).slice(0, 19)), ['Read messagesWriter'])
  await page.pick('')
  assert.equal(page.find(classed('bt-aa-log')).length, 4)
})

test('a key with nothing in the log says so, and a change cut short is marked', async () => {
  const state = withLog()
  state.tokens.push({ id: 'quiet', name: 'Quiet', createdAt: NOON - HOUR })
  state.audit.push(call(9, 'Claude Code', 'delete_bot', 400000, { target: 'writer-demo', outcome: 'started' }))
  const page = await open(state)
  await page.pick('Quiet')
  assert.match(page.section('Access log'), /Nothing from this key in the latest 200\./)
  await page.pick('Claude Code')
  const first = page.find(classed('bt-aa-log'))[0]
  assert.match(textOf(first), /^Deleted a BotWriter.*This change was cut short\. Check it before the agent tries again\.Did not finish$/)
})

test('connect an agent: the address, who can reach it, and an example with a placeholder key', async () => {
  const local = await open(withKeys())
  const section = local.section('Connect an agent')
  assert.match(section, /Addresshttp:\/\/127\.0\.0\.1:12345\/mcpOnly this computer: agents elsewhere cannot reach this address\./)
  assert.doesNotMatch(section, /Web address/)
  const example = JSON.parse(textOf(local.find(node => node.type === 'pre')[0]))
  assert.deepEqual(example, { mcpServers: { automagik: { type: 'http', url: 'http://127.0.0.1:12345/mcp', headers: { Authorization: 'Bearer YOUR_KEY' } } } })
  assert.match(section, /Put your key in place of YOUR_KEY\./)
  await local.press('Copy the address')
  assert.deepEqual(local.copied, ['http://127.0.0.1:12345/mcp'])

  const shared = await open({ ...withKeys(), url: 'http://100.64.0.7:8123/mcp' })
  assert.match(shared.section('Connect an agent'), /Private network: agents on your private network can connect\./)
  assert.equal(shared.find(classed('bt-aa-reach'))[0].props['data-reach'], 'network')

  // A space on the web: its own address comes first, and the example uses it.
  const place = { protocol: 'https:', hostname: 'space.example', origin: 'https://space.example' }
  const web = await open(withKeys(), { place })
  assert.match(web.section('Connect an agent'), /Web addresshttps:\/\/space\.example\/api\/omni-mcp.*Direct addresshttp:\/\/127\.0\.0\.1:12345\/mcpOnly the computer Automagik runs on/)
  assert.equal(JSON.parse(textOf(web.find(node => node.type === 'pre')[0])).mcpServers.automagik.url, 'https://space.example/api/omni-mcp')
})

test('the pieces the page is built from', async () => {
  const { api } = await open(empty())
  assert.equal(api.reachOf('http://127.0.0.1:1/mcp'), 'local')
  assert.equal(api.reachOf('http://[::1]:1/mcp'), 'local')
  assert.equal(api.reachOf('http://192.168.1.20:1/mcp'), 'network')
  assert.equal(api.reachOf('http://[fd00::1]:1/mcp'), 'network')
  assert.equal(api.reachOf(null), null)
  const row = { name: 'A', createdAt: 100 }
  const at = (time, tokenName = 'A') => ({ tokenName, time })
  // "Not used yet" needs the whole log: no row of the key's, and a window that has not filled.
  assert.equal(api.useOf(row, []).unused, true)
  assert.equal(api.useOf(row, [at(50, 'B')]).unused, true)
  assert.equal(api.useOf(row, [at(150, 'B')]).unused, true)
  const others = count => Array.from({ length: count }, (_, index) => at(150 + index, 'B'))
  assert.equal(api.useOf(row, others(199)).unused, true)
  // A full window may have lost the key's rows: by count (200 records)...
  assert.equal(api.useOf(row, others(200)).unused, false)
  assert.equal(api.logMayHaveRolled(others(200)), true)
  // ...or by size, where the host cuts at 256 KiB before it counts. Bytes, not letters.
  const heavy = (text, count) => Array.from({ length: count }, () => ({ ...at(150, 'B'), changes: { bots: { b: { instructions: { before: text, after: text } } } } }))
  assert.equal(api.useOf(row, heavy('a'.repeat(16000), 3)).unused, true)
  assert.equal(api.useOf(row, heavy('a'.repeat(16000), 5)).unused, false)
  assert.equal(api.useOf(row, heavy('说'.repeat(16000), 2)).unused, false)
  // A row of the key's own wins over either.
  assert.equal(api.useOf(row, [...others(200), at(900)]).last, 900)
  assert.equal(api.useOf(row, [at(150), at(180), at(170, 'B')]).last, 180)
  // Another key of the same name: calls from before this one was made, or after it was revoked, are not its.
  assert.equal(api.useOf({ ...row, revokedAt: 160 }, [at(50), at(150), at(180)]).last, 150)
  // A refused connection step keeps its line, and so does a step a minute later.
  const steps = [call(1, 'A', 'initialize', 0), call(2, 'A', 'tools/list', 500, { outcome: 'refused' }), call(3, 'A', 'tools/list', 900), call(4, 'A', 'ping', 90000)]
  assert.deepEqual(Array.from(api.logRows(steps), entry => entry.callId), ['call-4', 'call-3', 'call-2', 'call-1'])
  // Created, deleted, long instructions, members by name and the Main Bots.
  const lines = api.changeLines({
    bots: {
      'new-bot': { id: { before: null, after: 'new-bot' }, name: { before: null, after: 'Scout' }, role: { before: null, after: 'Research' } },
      'writer-demo': { instructions: { before: 'a'.repeat(900), after: 'b'.repeat(900) }, main: { before: false, after: true }, model: { before: 'x/one', after: null } },
    },
    groups: { crew: { members: { before: ['writer-demo'], after: ['writer-demo', 'new-bot'] } }, gone: { id: { before: 'gone', after: null }, name: { before: 'Old crew', after: null } } },
    mainBotIds: { before: [], after: ['writer-demo'] },
  }, roster)
  assert.deepEqual([...lines], [
    'Scout: created', 'Writer: instructions changed', 'Writer: Main Bot no → yes', 'Writer: model x/one → none',
    'crew: members Writer → Writer, new-bot', 'Old crew: deleted', 'Main Bots: none → Writer',
  ])
})

test('every word the page shows has its Chinese text, and the page ships its own styles', async () => {
  const { api } = await open(empty())
  // The page's module runs in its own realm here: the list is copied into this one to compare.
  assert.deepEqual([...api.LOG_COPY].filter(key => !Object.hasOwn(DICTIONARY.zh, key)), [])
  const css = api.AGENT_ACCESS_CSS
  assert.match(css, /@media \(max-width:640px\)/)
  assert.match(css, /:focus-visible\{outline:2px solid var\(--bt-accent\)/)
  const index = readFileSync(new URL('../src/client/index.js', import.meta.url), 'utf8')
  assert.match(index, /installCompiledStyles\(AGENT_ACCESS_CSS, 'agent-access'\)/)
})
