// What a failed turn says of its cause (#970, experience review 7, first part). A turn that
// fails shows the agent's own words in the chat: the end of its stderr when it did not start,
// the error its protocol answered a prompt with. Those were shown as they came, with whatever
// a process writes when it dies: the person's home folder in a path or a stack trace, the odd
// credential. They now pass through the masking every other diagnostic of the plugin gets,
// and the home folder reads `~`. Nothing else of the message changes.
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { markAgentLoopRequest } from '@deepseek-ai/dsh-llm'
import { AcpAdapter } from '../src/host/adapter.js'
import { shownText } from '../src/host/shown-text.js'

const HOME = homedir()
// On a machine whose home is the root there is no home folder to recognise: the rows that
// look for it in a real path are skipped there.
const NO_HOME = { skip: shownText(HOME) === '~' ? false : 'the home folder is a root' }
const SECRET = 'api_key=abcdef0123456789'
const MASKED = /api_key=\[hidden\]/

test('#970.7: shown text masks credential shapes and writes the home folder as ~, and changes nothing else', () => {
  const home = '/home/ada'
  assert.equal(shownText(`Error: Cannot find module '/home/ada/.local/share/x.js'`, home), `Error: Cannot find module '~/.local/share/x.js'`)
  assert.equal(shownText('/home/ada and /home/ada again, "/home/ada/a b.js":12:3, file:///home/ada/x', home), '~ and ~ again, "~/a b.js":12:3, file://~/x')
  assert.match(shownText(`spawn failed with ${SECRET}`, home), MASKED)
  assert.equal(shownText(`spawn failed with ${SECRET}`, home).includes('abcdef0123456789'), false)
  // Ordinary words are untouched, whatever their type.
  for (const plain of ['it exited (1): bad release', 'Internal error', 'it offers no model opus (it offers default, sonnet)', '']) assert.equal(shownText(plain, home), plain)
  assert.equal(shownText(undefined, home), '')
  assert.equal(shownText(42, home), '42')
  assert.equal(shownText(new Error('boom'), home), 'Error: boom')
})

test('#970.7: only the home folder itself is written ~: not another name that starts like it, nor a URL that ends like it', () => {
  const home = '/home/ada'
  // Another person's folder, a longer name, a path inside a URL or a longer path: as they were.
  for (const other of [`${home}a/cache`, `${home}-old/x`, `${home}.bak`, `${home}+backup/config`, `${home}é/config`, 'https://docs.example/home/ada/install', 'https://home/ada/help', 'https://docs.example//home/ada/help', '/srv/home/ada/x', 'x/home/ada']) assert.equal(shownText(other, home), other)
  // Where it does stand alone: after a space, a quote, a bracket, `=`, and before a separator,
  // a colon, a comma, a closing bracket or the end.
  assert.equal(shownText('x=/home/ada, (/home/ada) [/home/ada] \'/home/ada\' at /home/ada/a.js:1:2 /home/ada;', home), 'x=~, (~) [~] \'~\' at ~/a.js:1:2 ~;')
  // A home written with a separator at its end is the same folder.
  assert.equal(shownText("Cannot find module '/home/ada/app.js'", '/home/ada/'), "Cannot find module '~/app.js'")
  assert.equal(shownText('/rooted/config and /root/.x and /root', '/root'), '/rooted/config and ~/.x and ~')
  // No home known, the root, or one character: nothing is replaced.
  assert.equal(shownText('a / b /x', '/'), 'a / b /x')
  assert.equal(shownText('a b', ''), 'a b')
  // A name with characters that mean something to a pattern is still only itself.
  const odd = ['', 'home', 'a.b+c'].join('/')
  const other = ['', 'home', 'aXb+c'].join('/')
  assert.equal(shownText(`${odd}/x and ${other}/x`, odd), `~/x and ${other}/x`)
})

test('#970.7: a Windows home is the same in either case, with either slash, and with its backslashes doubled', () => {
  const home = 'C:\\Users\\someone else'
  assert.equal(shownText('at C:\\Users\\someone else\\app\\index.js', home), 'at ~\\app\\index.js')
  assert.equal(shownText('at c:/users/someone else/app/x.js', home), 'at ~/app/x.js')
  assert.equal(shownText('{"path":"C:\\\\Users\\\\someone else\\\\cfg.json"}', home), '{"path":"~\\\\cfg.json"}')
  assert.equal(shownText('C:\\Users\\someone elsewhere\\x', home), 'C:\\Users\\someone elsewhere\\x')
  // Separators mixed, the home itself written with forward slashes or a separator at its end,
  // and a home on a network share.
  assert.equal(shownText('C:\\Users/someone else/config.json', home), '~/config.json')
  assert.equal(shownText('at C:\\Users\\someone else\\a.js', 'C:/Users/someone else'), 'at ~\\a.js')
  assert.equal(shownText('at C:\\Users\\someone else\\a.js', 'C:\\Users\\someone else\\'), 'at ~\\a.js')
  assert.equal(shownText('at \\\\srv\\share\\ada\\x.js', '\\\\srv\\share\\ada'), 'at ~\\x.js')
  // What a Node stack trace prints: a file URL, with a space written %20.
  assert.equal(shownText('at file:///C:/Users/someone%20else/agent.mjs:12:3 and file:///C:/Users/someone else/x.mjs', home), 'at file:///~/agent.mjs:12:3 and file:///~/x.mjs')
  assert.equal(shownText('at file:///Users/someone%20else/agent.mjs:12:3', '/Users/someone else'), 'at file://~/agent.mjs:12:3')
  assert.equal(shownText('see https://docs.example/C:/Users/someone%20else/x', home), 'see https://docs.example/C:/Users/someone%20else/x')
  // A drive alone is no home.
  assert.equal(shownText('at C:\\x.js', 'C:\\'), 'at C:\\x.js')
  // A POSIX home is not folded by case.
  assert.equal(shownText('/HOME/ANN/x', '/home/ada'), '/HOME/ANN/x')
})

// One turn on an agent that is the script `source`, spoken to over stdio.
function turnOn(t, source, agentFields = {}, model = 'default') {
  const dir = mkdtempSync(join(tmpdir(), 'acp-failure-text-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const script = join(dir, 'agent.mjs')
  writeFileSync(script, source)
  const dshAgent = { session: { id: 's1', header: { cwd: dir } }, ctx: { tools: { register: () => () => {} } } }
  const logs = []
  const ctx = { agents: { get: id => (id === 's1' ? dshAgent : undefined) }, get: () => undefined, logger: { warn: message => logs.push(message), info: () => {} } }
  const agent = {
    name: 'Probe agent',
    catalog: { models: async () => [{ id: 'default', name: 'Probe agent' }], model: async () => undefined, ownEffort: () => undefined, dispose() {} },
    installed: () => true,
    spawn: () => ({ command: process.execPath, args: [script] }),
    ...agentFields,
  }
  const adapter = new AcpAdapter(ctx, new Map([['acp-probe', agent]]), { dshTools: () => false })
  t.after(() => adapter.dispose())
  return (async () => {
    const chunks = []
    for await (const chunk of adapter.stream(markAgentLoopRequest({ provider: 'acp-probe', model, sessionId: 's1', messages: [{ role: 'user', content: [{ type: 'text', text: 'plain' }] }] }))) chunks.push(chunk)
    return chunks.at(-1).reason
  })()
}

// An agent that dies before it answers, with what a broken install writes.
const dying = `console.error(${JSON.stringify(`Error: Cannot find module '${join(HOME, 'adapters', 'node_modules', 'dep', 'index.js')}'`)}); console.error(${JSON.stringify(`    at ${join(HOME, 'adapters', 'dist', 'index.js')}:12:3 ${SECRET}`)}); process.exit(1)\n`

// An agent that speaks just enough ACP to open a session, then answers every prompt with
// \`error\` (a JSON-RPC error object).
const failingPrompt = error => `
import { createInterface } from 'node:readline'
const reply = (id, body) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, ...body }) + '\\n')
createInterface({ input: process.stdin }).on('line', (line) => {
  const { id, method } = JSON.parse(line)
  if (id === undefined) return
  if (method === 'initialize') return reply(id, { result: { protocolVersion: 1, agentCapabilities: {} } })
  if (method === 'session/new') return reply(id, { result: { sessionId: 'probe-session' } })
  if (method === 'session/prompt') return reply(id, { error: ${JSON.stringify(error)} })
  reply(id, { error: { code: -32601, message: 'Method not found' } })
})
`

test('#970.7: an agent that did not start says why without the home folder or a credential', NO_HOME, async (t) => {
  const reason = await turnOn(t, dying)
  assert.equal(reason.kind, 'error')
  const { message } = reason.failure
  assert.match(message, /^Probe agent did not start: /)
  assert.match(message, /Cannot find module '~/)
  assert.match(message, MASKED)
  assert.equal(message.includes(HOME), false, 'the home folder is not spelled out')
  assert.equal(message.includes('abcdef0123456789'), false)
})

test('#970.7: an error the agent answers a prompt with is shown the same way', NO_HOME, async (t) => {
  const reason = await turnOn(t, failingPrompt({ code: -32603, message: `Internal error reading ${join(HOME, '.config', 'agent.json')} with ${SECRET}` }))
  assert.equal(reason.kind, 'error')
  const { message } = reason.failure
  assert.match(message, /^Probe agent: Internal error reading ~/)
  assert.match(message, MASKED)
  assert.equal(message.includes(HOME), false)
  assert.equal(message.includes('abcdef0123456789'), false)
})

test('#970.7: an agent that says it is not signed in, in its own words, is shown the same way', NO_HOME, async (t) => {
  // ACP's auth_required at the prompt: the turn fails as a missing sign-in, with the agent's text.
  const reason = await turnOn(t, failingPrompt({ code: -32000, message: `Authentication required: no token in ${join(HOME, '.agent', 'auth.json')}` }))
  assert.equal(reason.kind, 'error')
  assert.match(reason.failure.message, /^Probe agent is not signed in: /)
  assert.equal(reason.failure.message.includes(HOME), false)
  assert.match(reason.failure.message, /~/)
})

test('#970.7: what the plugin itself puts in a failure is masked too: a model id that is a path', NO_HOME, async (t) => {
  // An agent with no model to choose from, asked for one named by a path under the home folder.
  const model = join(HOME, 'models', 'local')
  const reason = await turnOn(t, failingPrompt({ code: -32603, message: 'unused' }), {}, model)
  assert.equal(reason.kind, 'error')
  assert.match(reason.failure.message, /^Probe agent would not take ~/)
  assert.equal(reason.failure.message.includes(HOME), false, reason.failure.message)
})

test('#970.7: a failure with nothing to mask reads exactly as it did', async (t) => {
  const reason = await turnOn(t, 'console.error("bad release"); process.exit(1)\n')
  assert.match(reason.failure.message, /^Probe agent did not start: Probe agent exited \(1\): bad release$/)
})
