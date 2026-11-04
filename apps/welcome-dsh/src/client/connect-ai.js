import { createElement as h, useCallback, useEffect, useMemo, useState } from 'react'
import { call } from './api.js'
import { Stage, useFinish, useGate, useGlitch } from './stage.js'
import { SUBSCRIPTION_TILES, SubscriptionSignIn, signedInCount } from './subscriptions.js'
import { AcpAgents, useAcp } from './acp-agents.js'
import { t } from './i18n.js'

// Step omni-connect-ai (order -200): every AI is a row with a switch, and several can be on.
// What this computer already has comes first, on (src/host/ais.js finds it). A row that is not
// set up opens its setup in place: a key, the provider's own sign-in in DSH (or, where the
// provider takes both, a choice of the two), a gateway. Off stops using an AI and keeps its
// key or sign-in.
//
// Claude Code and Codex (acp-dsh's agents) have their own section, Coding agents, after what
// was found: acp-agents.js. They are not counted as an AI on: the companions' model comes from
// the rows above.
//
// One way to reach each AI: DSH's own sign-ins and keys (Claude: pi-ai's anthropic route, a
// Claude Pro or Max sign-in or an Anthropic API key), and dsh-subscriptions for what nothing
// else covers.
//
// The copy follows the DSH language (i18n.js). The host's rows stay English (src/host/ais.js)
// and read in the DSH language here, through aiText.

export const VENDOR_TERMS = 'Personal use under the vendor\'s terms'
// How many "Add another" rows show before "Show N more".
export const FIRST_OTHERS = 4
export const LOGOS = { claude: 'C', chatgpt: 'G', deepseek: 'D', kimi: 'K', copilot: 'P', grok: 'X', openai: 'O', openrouter: 'R', zai: 'Z', moonshot: 'M', opencode: 'OC', cliproxy: '⇄', ollama: 'L' }

// dsh-subscriptions' vendors as rows, when that plugin is here.
export function subscriptionRows(subscriptions) {
  if (!subscriptions) return []
  return SUBSCRIPTION_TILES.map((tile) => {
    const count = signedInCount(subscriptions.accounts.map(account => ({ ...account, configured: true })), tile.provider)
    const on = count > 0 && !subscriptions.hidden.includes(tile.provider)
    return { id: `sub:${tile.provider}`, name: tile.name, via: `${tile.note} · dsh-subscriptions`, kind: 'subscription', tile, ready: count > 0, on, found: count > 1 ? `${count} accounts` : count === 1 ? 'Signed in' : null }
  })
}

// The two sections: what was found (on by default, or set up already), then the rest.
export function sections(rows) {
  const found = rows.filter(row => row.found || row.on)
  const others = rows.filter(row => !found.includes(row))
  return { found, others }
}

export const onCount = rows => rows.filter(row => row.on).length

// What the host and subscriptionRows say about a row, in the DSH language: each part between
// ' · ', with the value kept where a row names one.
const AI_ROWS = [
  [/^Signed in to (.+)$/, name => t('Signed in to {name}', { name })],
  [/^(\S+) found$/, ref => t('{ref} found', { ref })],
  [/^(\d+) accounts$/, count => t('{count} accounts', { count })],
]
export function aiText(text) {
  if (typeof text !== 'string') return text
  return text.split(' · ').map((part) => {
    for (const [pattern, of] of AI_ROWS) {
      const match = pattern.exec(part)
      if (match) return of(match[1])
    }
    return t(part)
  }).join(' · ')
}

// What a switch does when flipped: turn it off, turn on what is set up, or open its setup.
export function flipAction(row) {
  if (row.on) return 'off'
  return row.ready ? 'on' : 'setup'
}

function KeyForm({ row, provider, onSaved }) {
  const [apiKey, setApiKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState(null)
  const submit = async (event) => {
    event.preventDefault()
    setBusy(true)
    setProblem(null)
    try {
      await call('provider-key', { provider, apiKey })
      setApiKey('')
      onSaved()
    } catch (error) {
      setProblem(error.message)
      setBusy(false)
    }
  }
  return h('form', { onSubmit: submit, className: 'oai-setup-form' },
    h('div', { className: 'oai-field' },
      h('input', { type: 'password', required: true, autoComplete: 'off', spellCheck: false, autoFocus: true, placeholder: t('Paste your {name} key', { name: row.name }), 'aria-label': t('{name} key', { name: row.name }), value: apiKey, onChange: e => setApiKey(e.target.value) }),
      h('button', { type: 'submit', className: 'oai-primary', disabled: busy }, busy ? t('Turning on…') : t('Turn on'))),
    h('p', { className: 'oai-muted' }, t('It stays on this computer, in DSH\'s own credential store.'), row.keyUrl ? [' ', h('a', { key: 'k', className: 'oai-link', href: row.keyUrl, target: '_blank', rel: 'noreferrer' }, t('Get a {name} key', { name: row.name }))] : null),
    problem ? h('p', { className: 'oai-error', role: 'alert' }, problem) : null)
}

// A sign-in running in DSH: its latest notice (a page to open, a code to type), its open
// question, and how it ended. Polled, so a reload finds it again. The route is written by the
// host only once the sign-in succeeds.
function SignIn({ row, provider, onSaved, onCancel }) {
  const [attempt, setAttempt] = useState(null)
  const [problem, setProblem] = useState(null)
  const [answer, setAnswer] = useState('')
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    let live = true
    let timer = 0
    const poll = async (first) => {
      try {
        const next = await call(first ? 'signin-start' : 'signin-status', { provider })
        if (!live) return
        setAttempt(next)
        if (next.status === 'authorized') return onSaved()
        if (next.status === 'running') timer = setTimeout(() => poll(false), 1000)
      } catch (error) {
        if (live) setProblem(error.message)
      }
    }
    poll(true)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [provider])
  const reply = async (value) => {
    setProblem(null)
    try {
      setAttempt(await call('signin-answer', { provider, promptId: attempt.prompt.id, value }))
      setAnswer('')
    } catch (error) {
      setProblem(error.message)
    }
  }
  const cancel = async () => {
    await call('signin-cancel', { provider }).catch(() => {})
    onCancel()
  }
  const notice = attempt?.notice
  const prompt = attempt?.prompt
  const ended = attempt && ['cancelled', 'failed', 'none'].includes(attempt.status)
  const endedText = {
    failed: () => t('The sign-in did not finish: {error}', { error: attempt?.error }),
    cancelled: () => t('The sign-in was cancelled. Nothing was turned on.'),
    none: () => t('The sign-in stopped before it finished. Flip the switch to start again.'),
  }
  return h('div', { className: 'oai-signin' },
    !attempt && !problem ? h('p', { className: 'oai-muted' }, t('Starting the {name} sign-in…', { name: row.name })) : null,
    notice?.message ? h('p', null, notice.message) : null,
    notice?.code ? h('div', { className: 'oai-code' },
      h('code', null, notice.code),
      h('button', { type: 'button', className: 'oai-ghost', onClick: () => navigator.clipboard?.writeText(notice.code).then(() => setCopied(true)) }, copied ? t('Copied') : t('Copy code'))) : null,
    notice?.url ? h('a', { className: 'oai-primary oai-button', href: notice.url, target: '_blank', rel: 'noreferrer' }, t('Sign in with {name}', { name: row.name })) : null,
    prompt?.kind === 'select' ? h('div', { className: 'oai-choices', role: 'group', 'aria-label': prompt.message },
      h('p', null, prompt.message),
      prompt.options.map(option => h('button', { key: option.id, type: 'button', onClick: () => reply(option.id) }, h('strong', null, option.label), option.description ? h('span', null, option.description) : null))) : null,
    prompt && prompt.kind !== 'select' ? h('form', { onSubmit: (event) => { event.preventDefault(); reply(answer) } },
      h('label', { htmlFor: `oai-answer-${row.id}` }, prompt.message),
      h('input', { id: `oai-answer-${row.id}`, type: prompt.kind === 'secret' ? 'password' : 'text', required: true, autoComplete: 'off', spellCheck: false, autoFocus: true, placeholder: prompt.placeholder, value: answer, onChange: e => setAnswer(e.target.value) }),
      h('button', { type: 'submit', className: 'oai-primary' }, t('Continue'))) : null,
    attempt?.status === 'running' && !prompt ? h('p', { className: 'oai-muted oai-waiting' }, t('Finish signing in on their page…')) : null,
    ended ? h('p', { className: 'oai-error', role: 'alert' }, endedText[attempt.status]()) : null,
    problem ? h('p', { className: 'oai-error', role: 'alert' }, problem) : null,
    !ended && !problem ? h('button', { type: 'button', className: 'oai-quiet', onClick: cancel }, t('Cancel')) : null)
}

function CliproxyForm({ onSaved }) {
  const [baseURL, setBaseURL] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState(null)
  const submit = async (event) => {
    event.preventDefault()
    setBusy(true)
    setProblem(null)
    try {
      await call('cliproxy', { baseURL, apiKey })
      setApiKey('')
      onSaved()
    } catch (error) {
      setProblem(error.message)
      setBusy(false)
    }
  }
  return h('form', { onSubmit: submit, className: 'oai-setup-form' },
    h('input', { type: 'url', required: true, placeholder: 'http://localhost:8317/v1', 'aria-label': t('Gateway address'), autoComplete: 'off', value: baseURL, onChange: e => setBaseURL(e.target.value) }),
    h('div', { className: 'oai-field' },
      h('input', { type: 'password', required: true, placeholder: t('Gateway key'), 'aria-label': t('Gateway key'), autoComplete: 'off', spellCheck: false, value: apiKey, onChange: e => setApiKey(e.target.value) }),
      h('button', { type: 'submit', className: 'oai-primary', disabled: busy }, busy ? t('Turning on…') : t('Turn on'))),
    h('p', { className: 'oai-muted' }, t('Omni lists the gateway\'s models with your key and keeps the key in DSH\'s credential store.')),
    problem ? h('p', { className: 'oai-error', role: 'alert' }, problem) : null)
}

// A provider that takes both a sign-in and a key (Claude: a Pro or Max plan or an Anthropic API
// key; Grok): the person picks one before anything starts.
function SignInOrKey({ row, provider, onSaved, onClose }) {
  const [way, setWay] = useState(null)
  if (way === 'signin') return h(SignIn, { row, provider, onSaved, onCancel: onClose })
  if (way === 'key') return h(KeyForm, { row, provider, onSaved })
  return h('div', { className: 'oai-choices', role: 'group', 'aria-label': t('How to connect {name}', { name: row.name }) },
    h('button', { type: 'button', onClick: () => setWay('signin') }, h('strong', null, t('Sign in to {name}', { name: row.name })), h('span', null, t('With your plan, in the browser'))),
    h('button', { type: 'button', onClick: () => setWay('key') }, h('strong', null, t('Use an API key')), h('span', null, t('Billed per use'))))
}

function Setup({ row, onSaved, onClose }) {
  if (row.kind === 'key') return h(KeyForm, { row, provider: providerOf(row), onSaved })
  if (row.kind === 'signin') {
    if (row.signIn && row.keyUrl) return h(SignInOrKey, { row, provider: providerOf(row), onSaved, onClose })
    if (row.signIn) return h(SignIn, { row, provider: providerOf(row), onSaved, onCancel: onClose })
    if (row.keyUrl) return h(KeyForm, { row, provider: providerOf(row), onSaved })
    return h('p', null, t('This DSH offers no {name} sign-in.', { name: row.name }))
  }
  if (row.kind === 'gateway') return h(CliproxyForm, { onSaved })
  if (row.kind === 'local') return h('p', { className: 'oai-muted' }, t('Ollama is not running on this computer. Start it, then flip this again.'))
  if (row.kind === 'subscription') return h(SubscriptionSignIn, { tile: row.tile, onBack: onClose, onSaved, glitch: () => {} })
  return null
}

export const PROVIDER_OF = { claude: 'anthropic', chatgpt: 'openai-codex', kimi: 'kimi-coding', copilot: 'github-copilot', grok: 'xai', openai: 'openai', openrouter: 'openrouter', zai: 'zai', moonshot: 'moonshotai', opencode: 'opencode', deepseek: 'deepseek' }
const providerOf = row => PROVIDER_OF[row.id] ?? row.id

// "Also connected through …": the other ways this row's AI is connected, which Omni does not use.
function Duplicates({ row, onDedupe }) {
  if (!row.duplicates?.length) return null
  const shown = row.duplicates.filter(duplicate => !duplicate.hidden)
  return h('div', { className: 'oai-dupes' },
    row.duplicates.map(duplicate => h('p', { key: `${duplicate.via}:${duplicate.provider}`, className: 'oai-muted' },
      t('Also connected through {via}; Omni uses {name} here.', { via: duplicate.via, name: row.name }),
      duplicate.hidden ? t(' Its models are hidden.') : null)),
    shown.length && row.on ? h('button', { type: 'button', className: 'oai-ghost', onClick: onDedupe }, t('Use only this {name}', { name: row.name })) : null)
}

export function Row({ row, open, busy, problem, onFlip, onSaved, onClose, onDedupe }) {
  const logo = LOGOS[row.id] ?? row.name.slice(0, 1)
  return h('div', { className: `oai-ai${row.on ? ' oai-ai-on' : ''}` },
    h('div', { className: 'oai-ai-row' },
      h('div', { className: 'oai-logo', 'aria-hidden': true }, logo),
      h('div', { className: 'oai-ai-what' },
        h('strong', null, row.name),
        h('span', null, aiText(row.detail ? `${row.via} · ${row.detail}` : row.via))),
      row.found ? h('em', { className: 'oai-found' }, aiText(row.found)) : null,
      h('button', { type: 'button', role: 'switch', className: 'oai-switch', 'aria-checked': row.on ? 'true' : 'false', 'aria-label': row.name, disabled: busy, onClick: onFlip })),
    open && !row.on ? h('div', { className: 'oai-ai-setup' }, h(Setup, { row, onSaved, onClose })) : null,
    problem ? h('p', { className: 'oai-error oai-ai-problem', role: 'alert' }, problem) : null,
    h(Duplicates, { row, onDedupe }))
}

export function ConnectAiStep(props) {
  const state = useGate(props)
  const finish = useFinish(props)
  // Continue with an AI on: the host gives the companions their model (endpoint.js).
  const proceed = useFinish(useMemo(() => ({ ...props, connected: true }), [props]))
  const [glitching, glitch] = useGlitch()
  const [rows, setRows] = useState(null)
  const [subs, setSubs] = useState(null)
  const [open, setOpen] = useState(null)
  const [busy, setBusy] = useState(null)
  const [problems, setProblems] = useState({})
  const [showAll, setShowAll] = useState(false)
  const acp = useAcp()

  const refresh = useCallback(async () => {
    const reply = await call('ais').catch(() => ({ rows: [], subscriptions: null }))
    setRows(reply.rows ?? [])
    setSubs(reply.subscriptions ?? null)
  }, [])
  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => { if (state) glitch() }, [state, glitch])
  if (!state) return null

  const say = (id, message) => setProblems(previous => ({ ...previous, [id]: message }))

  const flip = async (row) => {
    const action = flipAction(row)
    say(row.id, null)
    if (action === 'setup') {
      setOpen(current => (current === row.id ? null : row.id))
      return
    }
    setBusy(row.id)
    try {
      if (row.kind === 'subscription') await call('ai-subscription', { provider: row.tile.provider, on: action === 'on' })
      else await call('ai-switch', { id: row.id, on: action === 'on' })
      if (action === 'on') glitch()
      await refresh()
    } catch (error) {
      say(row.id, error.message)
    }
    setBusy(null)
  }
  const saved = row => async () => {
    setOpen(null)
    glitch()
    // A row set up just now stops its duplicates, as turning it on does.
    if (row.kind !== 'subscription') await call('ai-dedupe', { id: row.id }).catch(() => {})
    await refresh()
  }
  const dedupe = row => async () => {
    say(row.id, null)
    try {
      await call('ai-dedupe', { id: row.id })
      await refresh()
    } catch (error) {
      say(row.id, error.message)
    }
  }

  return h(ConnectAiView, {
    state,
    rows,
    subscriptions: subs,
    acp,
    open,
    showAll,
    glitching,
    rowProps: row => ({ busy: busy !== null, problem: problems[row.id], onFlip: () => flip(row), onSaved: saved(row), onClose: () => setOpen(null), onDedupe: dedupe(row) }),
    onShowAll: () => setShowAll(true),
    onSkip: () => finish(),
    onModels: () => finish('models'),
    onContinue: () => proceed(),
  })
}

// What the step draws, from its state: `rows` is null while the host looks, `rowProps` a row's
// handlers.
export function ConnectAiView({ state, rows, subscriptions, acp, open, showAll, glitching, rowProps, onShowAll, onSkip, onModels, onContinue }) {
  const all = rows === null ? null : [...rows, ...subscriptionRows(subscriptions)]
  const count = all ? onCount(all) : 0
  const { found, others } = sections(all ?? [])
  const visible = showAll ? others : others.slice(0, FIRST_OTHERS)
  const rowOf = row => h(Row, { key: row.id, row, open: open === row.id, ...rowProps(row) })
  const another = found.length ? t('Add another') : t('Your AIs')

  return h(Stage, {
    title: t('Turn on your AIs'),
    speech: count > 0 ? t('Turn on everything you have. More brains, more {name}.', { name: state.companionName ?? 'Omni' }) : t('Now give me a brain. Turn on every AI you have; you can change it any time.'),
    at: 'omni-connect-ai',
    glitching,
  },
  all === null ? h('p', { className: 'oai-muted' }, t('Looking at what this computer has…')) : [
    found.length ? h('section', { key: 'found', className: 'oai-group', 'aria-label': t('Found on this computer') },
      h('h2', null, t('Found on this computer')),
      h('div', { className: 'oai-list' }, found.map(rowOf))) : null,
    h(AcpAgents, { key: 'acp', acp }),
    h('section', { key: 'others', className: 'oai-group', 'aria-label': another },
      h('h2', null, another),
      h('p', { className: 'oai-terms oai-muted' }, t('Subscriptions: {terms}.', { terms: t(VENDOR_TERMS).toLowerCase() })),
      h('div', { className: 'oai-list' }, visible.map(rowOf),
        !showAll && others.length > FIRST_OTHERS ? h('button', { type: 'button', className: 'oai-more', onClick: onShowAll }, t('Show {count} more', { count: others.length - FIRST_OTHERS })) : null)),
    h('p', { key: 'more', className: 'oai-muted oai-every' }, t('Every other provider DSH knows is in '), h('button', { type: 'button', className: 'oai-inline', onClick: onModels }, t('Settings → Models')), '.'),
  ],
  h('div', { className: 'oai-actions' },
    h('button', { type: 'button', className: 'oai-quiet', onClick: onSkip }, t('Skip for now')),
    h('span', { className: 'oai-count' }, count > 0 ? t('{count} on', { count }) : t('Turn on at least one')),
    h('button', { type: 'button', className: 'oai-primary', disabled: count === 0, onClick: onContinue }, count > 0 ? t('Continue →') : t('Continue'))))
}
