// Which account a CLI is signed in to (#869, account.js): read from the CLI's own status, never
// a token. Fakes only: no CLI runs here, and every identity is invented.
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { test } from 'node:test'
import { accountOf, accountView, claudeAccount, codexAccount } from '../src/host/account.js'
import { AGENTS } from '../src/host/agents.js'

const CLAUDE = AGENTS['acp-claude']
const CODEX = AGENTS['acp-codex']
const signedIn = { loggedIn: true, authMethod: 'claude.ai', apiProvider: 'firstParty', email: 'Ana@Work.example', orgId: 'org-1', orgName: 'Acme', subscriptionType: 'team' }

test('Claude Code: the account of a signed-in status, and nothing for one that does not say', () => {
  assert.deepEqual(claudeAccount(JSON.stringify(signedIn)), { kind: 'account', id: 'claude\norg-1\nana@work.example', facets: { kind: 'account', email: 'ana@work.example', org: 'org-1' }, email: 'Ana@Work.example', org: 'Acme', plan: 'team' })
  // The same person in another organisation is another account.
  assert.notEqual(claudeAccount(JSON.stringify({ ...signedIn, orgId: 'org-2' })).id, claudeAccount(JSON.stringify(signedIn)).id)
  assert.equal(claudeAccount(JSON.stringify({ loggedIn: false, email: 'ana@work.example' })), undefined)
  assert.equal(claudeAccount('not json'), undefined)
  assert.equal(claudeAccount('[]'), undefined)
  // An older CLI that says only loggedIn: unknown, never a throw.
  assert.equal(claudeAccount(JSON.stringify({ loggedIn: true })), undefined)
  assert.equal(claudeAccount(JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', apiProvider: 'firstParty' })), undefined)
  // A CLI that prints only one of the two still names the account by what it prints.
  assert.deepEqual(claudeAccount(JSON.stringify({ loggedIn: true, orgId: 'org-1' })).facets, { kind: 'account', org: 'org-1' })
  assert.deepEqual(claudeAccount(JSON.stringify({ loggedIn: true, email: 'ana@work.example' })).facets, { kind: 'account', email: 'ana@work.example' })
})

test('Claude Code: a key, a token or another provider is told apart by its source, with no person', () => {
  assert.deepEqual(claudeAccount(JSON.stringify({ loggedIn: true, authMethod: 'api_key', apiProvider: 'firstParty', apiKeySource: 'ANTHROPIC_API_KEY' })), { kind: 'key', id: 'claude\nkey\nANTHROPIC_API_KEY', facets: { kind: 'key', source: 'key:ANTHROPIC_API_KEY' } })
  assert.deepEqual(claudeAccount(JSON.stringify({ loggedIn: true, authMethod: 'oauth_token' })), { kind: 'token', id: 'claude\nkey\noauth_token', facets: { kind: 'key', source: 'key:oauth_token' } })
  assert.deepEqual(claudeAccount(JSON.stringify({ loggedIn: true, authMethod: 'third_party', apiProvider: 'bedrock' })), { kind: 'key', id: 'claude\nprovider\nbedrock', facets: { kind: 'key', source: 'provider:bedrock' } })
})

test('what is shown is one bounded line each, and never the id', () => {
  const seen = claudeAccount(JSON.stringify({ ...signedIn, orgName: `Ac\u0007me\n${'x'.repeat(400)}` }))
  assert.equal(seen.org.length, 120)
  assert.ok(seen.org.startsWith('Acmex'))
  assert.deepEqual(accountView(claudeAccount(JSON.stringify(signedIn))), { kind: 'account', email: 'Ana@Work.example', org: 'Acme', plan: 'team' })
  assert.deepEqual(accountView({ kind: 'key', id: 'claude\nkey\nX', facets: { kind: 'key', source: 'key:X' } }), { kind: 'key' })
  // A subscription token is a sign-in whose account the CLI does not say, never "an API key".
  assert.deepEqual(accountView(claudeAccount(JSON.stringify({ loggedIn: true, authMethod: 'oauth_token' }))), { kind: 'account' })
  assert.equal(accountView(undefined), undefined)
})

test('Codex: the account of account/read, and nothing for one that does not say', () => {
  assert.deepEqual(codexAccount({ account: { type: 'chatgpt', email: 'Ana@Home.example', planType: 'plus' }, requiresOpenaiAuth: true }), { kind: 'account', id: 'codex\nchatgpt\nana@home.example', facets: { kind: 'account', email: 'ana@home.example' }, email: 'Ana@Home.example', plan: 'plus' })
  assert.deepEqual(codexAccount({ account: { type: 'apiKey' } }), { kind: 'key', id: 'codex\nkey', facets: { kind: 'key' } })
  assert.equal(codexAccount({ account: null, requiresOpenaiAuth: true }), undefined)
  assert.equal(codexAccount({ account: { type: 'chatgpt' } }), undefined)
  assert.equal(codexAccount({ account: { type: 'something-new', email: 'a@b.example' } }), undefined)
  assert.equal(codexAccount(undefined), undefined)
})

test('accountOf asks Claude Code its status with the environment it was given, and survives a failure', async () => {
  const calls = []
  const run = (file, args, options, done) => { calls.push({ file, args, options }); done(null, JSON.stringify(signedIn)) }
  const seen = await accountOf(CLAUDE, '/opt/tools/claude', { env: { PATH: '/usr/bin', MARK: 'same-env' }, run })
  assert.equal(seen.email, 'Ana@Work.example')
  assert.deepEqual(calls[0].args, ['auth', 'status', '--json'])
  assert.equal(calls[0].options.env.MARK, 'same-env')
  assert.equal(calls[0].options.env.DISABLE_UPDATES, '1')
  assert.ok(calls[0].options.env.PATH.startsWith('/opt/tools'))
  // A signed-out CLI exits 1 and still prints its JSON.
  assert.equal(await accountOf(CLAUDE, '/opt/tools/claude', { run: (file, args, options, done) => done(Object.assign(new Error('exit'), { code: 1 }), JSON.stringify({ loggedIn: false })) }), undefined)
  assert.equal(await accountOf(CLAUDE, '/opt/tools/claude', { run: () => { throw new Error('spawn failed') } }), undefined)
  assert.equal(await accountOf(CLAUDE, undefined, { run }), undefined)
  assert.equal(await accountOf({ key: 'other' }, '/bin/other', { run }), undefined)
})

function fakeServer(answer) {
  const children = []
  const spawn = (file, args, options) => {
    const child = new EventEmitter()
    child.stdin = new PassThrough()
    child.stdout = new PassThrough()
    child.killed = false
    child.kill = () => { child.killed = true; return true }
    child.sent = []
    let buffer = ''
    child.stdin.on('data', (chunk) => {
      buffer += chunk
      const lines = buffer.split('\n')
      buffer = lines.pop()
      for (const line of lines) {
        const message = JSON.parse(line)
        child.sent.push(message)
        const reply = answer(message, child)
        if (reply !== undefined) child.stdout.write(`${JSON.stringify(reply)}\n`)
      }
    })
    children.push({ file, args, options, child })
    return child
  }
  return { spawn, children }
}

test('accountOf asks Codex over a short-lived app-server: one account/read, then the process ends', async () => {
  const server = fakeServer((message) => {
    if (message.method === 'initialize') return { id: message.id, result: {} }
    if (message.method === 'account/read') return { id: message.id, result: { account: { type: 'chatgpt', email: 'ana@home.example', planType: 'pro' } } }
    return undefined
  })
  const seen = await accountOf(CODEX, '/opt/tools/codex', { env: { PATH: '/usr/bin', MARK: 'same-env' }, spawn: server.spawn })
  assert.deepEqual(seen, { kind: 'account', id: 'codex\nchatgpt\nana@home.example', facets: { kind: 'account', email: 'ana@home.example' }, email: 'ana@home.example', plan: 'pro' })
  const [{ args, options, child }] = server.children
  assert.deepEqual(args, ['app-server', '--listen', 'stdio://'])
  assert.equal(options.env.MARK, 'same-env')
  // Its stderr is never read: it may hold paths or diagnostics.
  assert.equal(options.stdio[2], 'ignore')
  assert.deepEqual(child.sent.map(message => message.method), ['initialize', 'initialized', 'account/read'])
  assert.deepEqual(child.sent[2].params, { refreshToken: false })
  assert.equal(child.killed, true)
})

test('a Codex account read that fails, exits or never answers is unknown', async (t) => {
  const refusing = fakeServer(message => (message.method === 'initialize' ? { id: message.id, result: {} } : message.method === 'account/read' ? { id: message.id, error: { message: 'no' } } : undefined))
  assert.equal(await accountOf(CODEX, '/opt/tools/codex', { spawn: refusing.spawn }), undefined)
  const exiting = fakeServer((message, child) => { if (message.method === 'initialize') setImmediate(() => child.emit('close', 1)); return undefined })
  assert.equal(await accountOf(CODEX, '/opt/tools/codex', { spawn: exiting.spawn }), undefined)
  // The fake has no OS process handle to keep the loop alive for the unref'ed deadline.
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const silent = fakeServer(() => undefined)
  const waiting = accountOf(CODEX, '/opt/tools/codex', {
    spawn: silent.spawn, timeoutMs: 20,
  })
  t.mock.timers.tick(19)
  assert.equal(silent.children[0].child.killed, false)
  t.mock.timers.tick(1)
  assert.equal(await waiting, undefined)
  assert.equal(silent.children[0].child.killed, true)
  assert.equal(await accountOf(CODEX, '/opt/tools/codex', { spawn: () => { throw new Error('spawn failed') } }), undefined)
})
