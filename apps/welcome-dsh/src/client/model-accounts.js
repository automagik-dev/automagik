import { createElement as h, useCallback, useEffect, useRef, useState } from 'react'
import { call } from './api.js'
import { Setup, PROVIDER_OF, providerOf, subscriptionRows } from './connect-ai.js'
import { AcpAgentRow, useAcp } from './acp-agents.js'
import { LoginTerminal } from './terminal.js'
import { t } from './i18n.js'

// Shared with the conversation picker through a slot, without a dependency on the Bot
// surface. Only metadata crosses that seam; keys stay in the form and DSH's credential API.
export const ACCOUNT_SLOT = 'conversation.model.accounts'
const COMPANY_OF = { anthropic: 'Anthropic', 'acp-claude': 'Anthropic', openai: 'OpenAI', 'openai-codex': 'OpenAI', 'acp-codex': 'OpenAI', deepseek: 'DeepSeek', 'kimi-coding': 'Moonshot', moonshotai: 'Moonshot', 'github-copilot': 'GitHub', xai: 'xAI' }
const CLI_IDS = ['acp-claude', 'acp-codex']
const accountRows = reply => [...(reply?.rows ?? []), ...subscriptionRows(reply?.subscriptions)]
const rowProvider = row => row.kind === 'subscription' ? row.tile.provider : providerOf(row)

// Describe the setup this DSH actually offers. A vendor name or an existing account does
// not imply a browser login: several subscription tiles only accept a pasted token.
function authMethodsOf(row) {
  if (row.kind === 'local') return []
  if (row.kind === 'key' || row.kind === 'gateway') return ['key']
  if (row.kind === 'signin') {
    const methods = [...(row.signIn === true ? ['login'] : []), ...(row.keyUrl ? ['key'] : [])]
    return methods.length ? methods : undefined
  }
  if (row.kind === 'subscription') {
    if (['browser', 'device'].includes(row.tile?.kind)) return ['login']
    if (row.tile?.kind === 'token') return ['key']
  }
  return undefined
}

export function providerAccounts(ais, acp) {
  return [
    ...accountRows(ais).map(row => {
      const authMethods = authMethodsOf(row)
      return { provider: rowProvider(row), name: row.name, company: COMPANY_OF[rowProvider(row)] ?? row.name, ready: row.ready === true && row.on === true, kind: row.kind, ...(authMethods === undefined ? {} : { authMethods }) }
    }),
    ...(acp?.available ? acp.agents ?? [] : []).map(agent => ({ provider: agent.id, name: agent.id === 'acp-claude' ? 'Claude Code' : 'Codex', company: COMPANY_OF[agent.id] ?? agent.name, kind: 'cli', authMethods: ['login'], ready: agent.on === true && agent.signedIn === true && agent.connector.state === 'ready' && !agent.restartNeeded })),
  ]
}

export async function listProviderAccounts(request = call) {
  const [ais, acp] = await Promise.all([request('ais'), request('acp', { refresh: true }).catch(() => null)])
  return providerAccounts(ais, acp)
}

export function installModelAccounts(ctx) {
  return ctx.slots.inject(ACCOUNT_SLOT, () => ctx.slots.register({
    name: ACCOUNT_SLOT, id: 'automagik-welcome', order: 0,
  }, ProviderAccountSetup)) ?? (() => {})
}

// A newly connected account updates the catalog only. Finishing onboarding assigns default
// models and can send held greetings; this flow deliberately never calls that endpoint.
export function ProviderAccountSetup({ provider, onConnected, onClose }) {
  return h('div', { className: 'oai-account oai-card', 'data-provider': provider },
    h('p', { className: 'oai-muted' }, t('Connect here, then choose a model. Your current model stays selected.')),
    CLI_IDS.includes(provider)
      ? h(CliAccount, { key: provider, provider, onConnected, onClose })
      : h(ApiAccount, { key: provider, provider, onConnected, onClose }))
}

// SlotCore keeps its documented registration fields only. Attach the descriptor to the
// component, which survives registration unchanged, instead of custom register options.
ProviderAccountSetup.accounts = Object.freeze({
  providers: listProviderAccounts,
  matches: provider => CLI_IDS.includes(provider) || Object.values(PROVIDER_OF).includes(provider) || ['cliproxy', 'ollama', 'antigravity', 'glm', 'cursor', 'kiro', 'qwen', 'ernie', 'spark', 'jetbrains', 'perplexity', 'replit', 'cody'].includes(provider),
})

export function ApiAccount({ provider, onConnected, onClose, request = call }) {
  const [row, setRow] = useState(null)
  const [problem, setProblem] = useState(null)
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const load = useCallback(async () => {
    const reply = await request('ais')
    return accountRows(reply).find(item => rowProvider(item) === provider)
  }, [provider, request])
  useEffect(() => {
    let live = true
    void load().then(next => {
      if (!live) return
      if (next) setRow(next)
      else setProblem(t('This provider is not available in this DSH.'))
    }).catch(error => { if (live) setProblem(error.message) })
    return () => { live = false }
  }, [load])
  const saved = async () => {
    setEditing(false)
    setBusy(true)
    try {
      setRow(await load())
      await onConnected?.()
    } catch (error) { setProblem(error.message) }
    setBusy(false)
  }
  const enable = async () => {
    setBusy(true)
    setProblem(null)
    try {
      await request(row.kind === 'subscription' ? 'ai-subscription' : 'ai-switch', row.kind === 'subscription' ? { provider: row.tile.provider, on: true } : { id: row.id, on: true })
      await saved()
    } catch (error) { setProblem(error.message); setBusy(false) }
  }
  // SignIn starts on mount, so show it only after the person chooses Sign in. Key forms
  // have no mount-time writes and can be offered immediately when no credential exists.
  const showForm = row && (editing || (!row.ready && row.kind !== 'signin' && row.kind !== 'subscription'))
  const methods = row ? authMethodsOf(row) ?? [] : []
  const setupLabel = methods.includes('login')
    ? methods.includes('key') ? t('Sign in or use an API key') : t('Sign in to {name}', { name: row.name })
    : row?.kind === 'subscription' ? t('Use a key or token') : t('Use an API key')
  return h('div', { className: 'oai-account-body' },
    problem ? h('p', { className: 'oai-error', role: 'alert' }, problem) : null,
    !row && !problem ? h('p', { className: 'oai-muted' }, t('Looking at what this computer has…')) : null,
    row ? h('strong', null, row.name) : null,
    showForm ? h(Setup, { row, onSaved: saved, onClose: () => setEditing(false), cancelOnUnmount: true }) : null,
    row && !showForm ? h('div', { className: 'oai-account-actions' },
      row.ready ? h('p', { className: 'oai-muted', role: 'status' }, row.on ? t('Connected. Choose a model to use it.') : t('This account is connected and turned off.')) : null,
      row.ready && !row.on ? h('button', { type: 'button', className: 'oai-primary', disabled: busy, onClick: enable }, t('Turn on')) : null,
      methods.length > 0 ? h('button', { type: 'button', className: 'oai-ghost', disabled: busy, onClick: () => setEditing(true) }, setupLabel) : null,
      !row.ready && row.kind === 'signin' && methods.length === 0 ? h('p', { className: 'oai-muted' }, t('This DSH offers no {name} sign-in.', { name: row.name })) : null) : null,
    h('p', { className: 'oai-muted' }, t('Keys and sign-in details are kept out of the conversation.')),
    h('button', { type: 'button', className: 'oai-quiet', onClick: onClose }, t('Back to models')))
}

export function CliAccount({ provider, onConnected, onClose }) {
  const acp = useAcp()
  const [login, setLogin] = useState(false)
  const agent = acp.view?.agents?.find(row => row.id === provider)
  const connected = async () => {
    await acp.check(agent)
    await onConnected?.()
  }
  return h('div', { className: 'oai-account-body' },
    agent ? h(AcpAgentRow, { agent, inlineLogin: true, acp: { ...acp, check: async row => { await acp.check(row); await onConnected?.() } } })
      : h('p', { className: 'oai-muted' }, acp.view === null ? t('Looking at what this computer has…') : t('The ACP agents plugin is not running in this DSH.')),
    login ? h(CliLogin, { provider, onConnected: connected, onClose: () => setLogin(false) })
      : agent?.cli.found ? h('button', { type: 'button', className: 'oai-primary', onClick: () => setLogin(true) }, t('Sign in to {name}', { name: agent.name })) : null,
    h('button', { type: 'button', className: 'oai-quiet', onClick: onClose }, t('Back to models')))
}

export function CliLogin({ provider, onConnected, onClose, request = call }) {
  const [attempt, setAttempt] = useState(null)
  const [problem, setProblem] = useState(null)
  const [complete, setComplete] = useState(false)
  const live = useRef(false)
  const terminal = useRef(null)
  const connected = useRef(onConnected)
  connected.current = onConnected
  useEffect(() => {
    live.current = true
    let timer
    const close = () => {
      const id = terminal.current
      terminal.current = null
      if (id) void request('acp-login-close', { terminal: id }).catch(() => {})
    }
    const show = async (next) => {
      if (!live.current) {
        if (next.terminal) void request('acp-login-close', { terminal: next.terminal }).catch(() => {})
        return
      }
      terminal.current = next.terminal
      setAttempt(next)
      if (next.status === 'running') timer = setTimeout(poll, 700)
      else {
        close()
        const status = await request('acp', { refresh: true })
        if (!live.current) return
        if (status.agents?.find(row => row.id === provider)?.signedIn === true) {
          setComplete(true)
          await connected.current?.()
        }
        else setProblem(t('The sign-in did not finish. Try again.'))
      }
    }
    const fail = error => { if (live.current) setProblem(error.message) }
    const poll = () => void request('acp-login-read', { terminal: terminal.current }).then(show).catch(fail)
    void request('acp-login-start', { id: provider, cols: 72, rows: 10 }).then(show).catch(fail)
    // Leaving the conversation or cancelling closes the private auth process. The host also
    // expires abandoned attempts, including a window disappearing before cleanup is sent.
    const leave = () => { live.current = false; clearTimeout(timer); close() }
    globalThis.addEventListener?.('pagehide', leave)
    return () => { leave(); globalThis.removeEventListener?.('pagehide', leave) }
  }, [provider, request])
  const write = async data => {
    if (!terminal.current || attempt?.status !== 'running') return
    try { await request('acp-login-write', { terminal: terminal.current, data }) }
    catch (error) { if (live.current) setProblem(error.message) }
  }
  const resize = (cols, rows) => {
    if (terminal.current && attempt?.status === 'running') void request('acp-login-resize', { terminal: terminal.current, cols, rows }).catch(() => {})
  }
  return h('div', { className: 'oai-account-login' },
    h('p', { className: 'oai-muted', role: 'status' }, complete ? t('Connected. Choose a model to use it.') : t('Finish signing in below or on the page opened by your CLI.')),
    attempt ? h(LoginTerminal, { text: attempt.text, label: t('Private sign-in terminal'), onData: write, onResize: resize, disabled: attempt.status !== 'running' || Boolean(problem) }) : null,
    problem ? h('p', { className: 'oai-error', role: 'alert' }, problem) : null,
    h('button', { type: 'button', className: 'oai-quiet', onClick: onClose }, complete ? t('Done') : t('Cancel')))
}

export const MODEL_ACCOUNTS_CSS = `
.oai-account.oai-card{width:100%;min-width:0;max-width:none;margin:0;padding:16px;box-shadow:none;border-radius:12px;font-size:13px}
.oai-account-body,.oai-account-actions,.oai-account-login{display:grid;gap:12px;min-width:0}
.oai-account-body{margin-top:14px}
.oai-account .oai-acp-lines{padding-left:14px}
.oai-account .oai-field{flex-wrap:wrap}
.oai-account .oai-field input{min-width:0;flex:1 1 180px}
.oai-account .oai-account-actions button{margin:0}
.oai-account .oai-term{min-width:0;max-width:100%}
`
