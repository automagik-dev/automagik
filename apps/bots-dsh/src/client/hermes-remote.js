import { createElement as h, Fragment, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { call as api } from './api.js'
import { HermesMark, HERMES_MARK_CSS } from './hermes-mark.js'
import { CheckIcon, CloseIcon, GlobeIcon, ShieldIcon, TerminalIcon } from './icons.js'
import { useEscape } from './overlay-hooks.js'
import { t } from './i18n.js'

const EMPTY_SSH = { host: '', user: '', port: '', identityFile: '', hermesPath: '', hermesHome: '' }
const draftOf = view => ({ mode: view?.mode === 'ssh' ? 'ssh' : 'remote', address: view?.address ?? '', authMode: view?.authMode === 'password' ? 'password' : 'token', credentialRef: view?.credentialRef ?? '', credential: '', username: view?.username ?? '', password: '', ssh: { ...EMPTY_SSH, ...view?.ssh } })
const configured = view => view?.enabled === true && Boolean(view?.profile)
const freshSecrets = draft => ({ ...draft, credential: '', password: '' })
const connectionLabel = draft => draft.mode === 'ssh' ? draft.ssh.host : draft.address.replace(/^https?:\/\//, '').replace(/\/$/, '')
const steps = ['Connection', 'Details', 'Test', 'Profile', 'Ready']

function Field({ label, value, onChange, placeholder, hint, secret = false, type = 'text' }) {
  return h('label', { className: 'bt-hw-field' }, h('span', null, label),
    h('input', { type: secret ? 'password' : type, value, onChange: event => onChange(event.target.value), placeholder, 'aria-label': label, autoComplete: secret ? 'new-password' : 'off', spellCheck: false }),
    hint ? h('small', null, hint) : null)
}
const Button = ({ children, primary = false, ...props }) => h('button', { type: 'button', className: `bt-hw-button ${primary ? 'bt-hw-primary' : 'bt-hw-secondary'}`, ...props }, children)
const Note = ({ children, error = false }) => h('div', { className: `bt-hw-note${error ? ' bt-hw-error-note' : ''}` }, h(ShieldIcon), h('span', null, children))
const Pair = ({ label, value, mono = false }) => h('div', { className: 'bt-hw-pair' }, h('span', null, label), h('strong', { className: mono ? 'bt-hw-mono' : undefined }, value))
const Lines = ({ label, lines }) => h('div', { className: 'bt-hw-lines' }, h('span', null, label), h('pre', { tabIndex: 0, 'aria-label': label }, lines.join('\n')))

const sshHostRows = rows => {
  const seen = new Set()
  return (Array.isArray(rows) ? rows : []).slice(0, 2048).flatMap(row => {
    if (!row || typeof row !== 'object') return []
    const item = Object.fromEntries(['alias', 'hostname', 'user', 'port'].map(key => [key, typeof row[key] === 'string' && row[key].length <= 4096 && !/[\x00-\x1f\x7f]/.test(row[key]) ? row[key] : '']))
    if (!item.alias || seen.has(item.alias)) return []
    seen.add(item.alias)
    return [item]
  })
}

function SshHostPicker({ host, onPick }) {
  const [listing, setListing] = useState({ status: 'loading', aliases: [], knownHosts: [] })
  const [search, setSearch] = useState('')
  const [otherOpen, setOtherOpen] = useState(false)
  useEffect(() => {
    let current = true
    const controller = new AbortController()
    // This optional list owns its request. Leaving Details must never abort the
    // wizard's separate connection test or its progress request.
    void api('hermes-remote-ssh-hosts', undefined, controller.signal).then(answer => {
      if (current && !controller.signal.aborted) setListing({ status: 'ready', aliases: sshHostRows(answer?.aliases), knownHosts: sshHostRows(answer?.knownHosts) })
    }).catch(error => {
      if (current && !controller.signal.aborted && error?.name !== 'AbortError') setListing({ status: 'error', aliases: [], knownHosts: [] })
    })
    return () => { current = false; controller.abort() }
  }, [])
  const matches = item => [item.alias, item.hostname, item.user, item.port].some(value => value.toLowerCase().includes(search.trim().toLowerCase()))
  const choices = (rows, label) => {
    const filtered = rows.filter(matches)
    return filtered.length ? h('div', { className: 'bt-hw-host-list', role: 'group', 'aria-label': label }, filtered.map(item => h('button', {
      key: item.alias, type: 'button', className: 'bt-hw-host-choice', 'aria-pressed': host === item.alias,
      'aria-label': t('Use SSH host {host}', { host: item.alias }), onClick: () => onPick(item),
    }, h('span', null, h('strong', null, item.alias), h('small', null, [item.hostname !== item.alias ? item.hostname : '', item.user, item.port].filter(Boolean).join(' · '))), host === item.alias ? h(CheckIcon) : null)))
      : h('p', { className: 'bt-hw-host-hint' }, t('No SSH hosts match your search.'))
  }
  const anyHosts = listing.aliases.length > 0 || listing.knownHosts.length > 0
  return h('section', { className: 'bt-hw-host-picker', 'aria-label': t('SSH hosts from your config') },
    h('strong', { className: 'bt-hw-host-title' }, t('SSH hosts from your config')),
    listing.status === 'loading' ? h('p', { className: 'bt-hw-host-hint', role: 'status' }, t('Loading saved SSH hosts…'))
      : listing.status === 'error' ? h('p', { className: 'bt-hw-host-hint', role: 'status' }, t('Saved SSH hosts could not be listed. Type a host below.'))
      : !anyHosts ? h('p', { className: 'bt-hw-host-hint' }, t('No saved SSH hosts. Type a host below.'))
      : h(Fragment, null,
        h(Field, { label: t('Search SSH hosts'), value: search, onChange: setSearch, placeholder: t('Search by name, address or user') }),
        listing.aliases.length ? choices(listing.aliases, t('SSH hosts from your config')) : null,
        listing.knownHosts.length ? h(Fragment, null,
          h('button', { type: 'button', className: 'bt-hw-other-hosts', 'aria-label': t('Other hosts you have connected to'), 'aria-expanded': otherOpen, onClick: () => setOtherOpen(value => !value) }, t('Other hosts you have connected to'), h('span', { 'aria-hidden': true }, otherOpen ? '−' : '+')),
          otherOpen ? choices(listing.knownHosts, t('Other hosts you have connected to')) : null) : null))
}

// What the host kept of one failed SSH connection, for its own screen. Every field is
// shaped again here: a value the page cannot show safely is dropped, never rendered.
const shortText = (value, max = 255) => typeof value === 'string' && value.length > 0 && value.length <= max && !/[\x00-\x1f\x7f]/.test(value) ? value : ''
const lineRows = value => (Array.isArray(value) ? value : []).map(line => shortText(line, 240)).filter(Boolean).slice(-8)
const release = value => /^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(value ?? '') ? value : ''
// How Hermes is updated where it runs, by the install kind its own "--version" names
// (Hermes's own table: a source install updates itself, an image or a package does not).
function updateStep(install, host) {
  if (['nix', 'nixos', 'home-manager'].includes(install)) return { hint: t('On {host}, update Hermes through the Nix source that installed it (nix profile upgrade, or update your flake input and rebuild), then test again.', { host }) }
  if (install === 'docker') return { command: 'docker pull nousresearch/hermes-agent:latest', hint: t('On {host}, run “{command}” and restart the Hermes container, then test again.', { host, command: 'docker pull nousresearch/hermes-agent:latest' }) }
  const command = install === 'apt' ? 'pkg upgrade hermes-agent' : 'hermes update'
  return { command, hint: t('On {host}, run “{command}”, then test again.', { host, command }) }
}
// The rows of an update screen: what runs there, what is needed, and the command to run.
function updateRows(facts, step) {
  return [facts.version ? { label: t('Hermes there'), value: `v${facts.version}` } : null, facts.minimum ? { label: t('Needed'), value: t('v{version} or newer', { version: facts.minimum }) } : null,
    step.command ? { label: t('Update command'), value: step.command, mono: true } : null].filter(Boolean)
}
function failureFacts(value) {
  if (!value || typeof value !== 'object') value = {}
  const count = key => Number.isSafeInteger(value[key]) ? value[key] : undefined
  return {
    kind: shortText(value.kind, 40), stage: shortText(value.stage, 40), keyType: /^[a-z0-9@.-]{3,64}$/.test(value.keyType ?? '') ? value.keyType : '',
    fingerprint: /^SHA256:[A-Za-z0-9+/]{43}$/.test(value.fingerprint ?? '') ? value.fingerprint : '', fault: /^[A-Za-z_]\w{0,40}$/.test(value.fault ?? '') ? value.fault : '',
    identities: (Array.isArray(value.identities) ? value.identities : []).filter(name => /^[\w.@+-]{1,64}$/.test(name ?? '')).slice(0, 6),
    agentKeys: count('agentKeys') ?? 0, port: count('port'), exit: count('exit'), errno: count('errno'), line: count('line'),
    ssh: lineRows(value.ssh), hermes: lineRows(value.hermes), unsaved: value.unsaved === true, mismatch: value.mismatch === true,
    version: release(value.version), minimum: release(value.minimum), install: /^[a-z0-9-]{1,32}$/.test(value.install ?? '') ? value.install : '',
  }
}
const STAGES = {
  details: () => t('Checking the SSH details'), 'ssh-sign-in': () => t('Signing in with SSH'), 'host-key': () => t('Checking the host key'),
  'remote-start': () => t('Finding Hermes'), 'hermes-start': () => t('Starting Hermes'), tunnel: () => t('Opening the tunnel'),
  token: () => t('Signing in to Hermes'), profiles: () => t('Listing profiles'), chat: () => t('Opening a chat connection'),
}

// One screen per kind of failure. An SSH screen names the host the person picked and
// the step that stopped; the generic SSH screen is only for a kind nothing here knows.
function errorFor(error, draft, detail) {
  const code = error?.code ?? ''
  const base = screenFor(code, draft, failureFacts(detail))
  if (!base.ssh) return base
  const facts = failureFacts(detail), host = shortText(draft?.ssh?.host?.trim?.() ?? '')
  const rows = [...(base.rows ?? [])]
  if (host) rows.unshift({ label: t('SSH host'), value: host })
  if (STAGES[facts.stage] && !base.trust) rows.push({ label: t('Stopped while'), value: STAGES[facts.stage]() })
  if (facts.exit !== undefined && !base.trust) rows.push({ label: t('Exit code'), value: String(facts.exit) })
  if (facts.fault) rows.push({ label: t('Error'), value: `${facts.fault}${facts.errno ? ` (${facts.errno})` : ''}${facts.line ? ` · ${t('line {line}', { line: facts.line })}` : ''}`, mono: true })
  return { ...base, rows, lines: base.trust ? [] : [facts.hermes.length ? { label: t('Last lines from Hermes'), lines: facts.hermes } : null, facts.ssh.length ? { label: t('Last lines from SSH'), lines: facts.ssh } : null].filter(Boolean) }
}

function screenFor(code, draft, facts) {
  const host = shortText(draft?.ssh?.host?.trim?.() ?? '') || t('the other computer')
  if (code === 'bot/hermes-busy') return { heading: t('Remote Hermes'), title: t('A chat is still running on this connection; stop it or wait.'), text: t('Your connection settings were not changed.'), hint: t('Stop the chat or wait') }
  if (code === 'bot/hermes-ssh-cleanup') return { heading: t('Connection cleanup is unconfirmed'), title: t('Check {host} before reconnecting', { host }), text: t('Automagik could not confirm that the owned Hermes process group stopped. Remote work may continue.'), hint: t('Check the remote Hermes process before testing or connecting again.'), ssh: true }
  if (code === 'bot/hermes-ssh-update') {
    const step = updateStep(facts.install, host)
    return { heading: t('Hermes needs an update'), title: facts.minimum ? t('Update Hermes on {host} to v{version} or newer', { host, version: facts.minimum }) : t('Update Hermes on {host}', { host }),
      text: facts.version && facts.minimum ? t('{host} runs Hermes v{found}. This connection needs v{version} or newer.', { host, found: facts.version, version: facts.minimum }) : t('This Hermes installation lacks the server ownership options needed for an SSH connection.'),
      hint: step.hint, rows: updateRows(facts, step), ssh: true }
  }
  if (code === 'bot/hermes-ssh-version') {
    const step = updateStep(facts.install, host)
    return { heading: t('Hermes did not report its version'), title: t('Automagik could not read the Hermes version on {host}', { host }),
      text: facts.minimum ? t('“hermes --version” on {host} named no release, so Automagik cannot tell whether it is new enough. This connection needs v{version} or newer.', { host, version: facts.minimum }) : t('“hermes --version” on {host} named no release, so Automagik cannot tell whether it is new enough.', { host }),
      hint: step.hint, rows: updateRows(facts, step), ssh: true }
  }
  if (code === 'bot/hermes-ssh-platform') return { heading: t('This computer cannot run the SSH connection yet'), title: t('Check the remote system and Python'), text: t('The remote computer needs Linux or macOS, Python 3, and a supported Hermes installation.'), hint: t('Check Python and the supported system on the other computer, then test again.'), ssh: true }
  if (code === 'bot/hermes-ssh-exited') return { heading: t('Hermes stopped while starting'), title: t('Hermes on {host} stopped before it was ready', { host }), text: facts.exit !== undefined ? t('SSH signed in and started Hermes, but Hermes exited with code {code}.', { code: facts.exit }) : t('SSH signed in and started Hermes, but Hermes stopped right away.'), hint: t('Run “hermes serve” on {host} to see the full error, fix it there, then test again.', { host }), ssh: true }
  if (code === 'bot/hermes-ssh-not-ready') return { heading: t('Hermes took too long to start'), title: t('Hermes on {host} was not ready in time', { host }), text: t('SSH signed in and started Hermes, but Hermes did not say it was ready before the deadline.'), hint: t('Check that Hermes starts normally on {host}, then test again.', { host }), ssh: true }
  if (code === 'bot/hermes-ssh-port') return { heading: t('Hermes did not report its port'), title: t('Hermes on {host} started without a port', { host }), text: t('Hermes is running there, but it never said which port it listens on, so there is nothing to connect to.'), hint: t('Update Hermes on {host}, then test again.', { host }), ssh: true }
  if (code === 'bot/hermes-ssh-handshake' || (draft.mode === 'ssh' && code === 'bot/hermes-auth')) return { heading: t('The one-time token was not accepted'), title: t('Automagik and {host} could not agree on this connection', { host }), text: t('The start script or Hermes on {host} did not accept the one-time token made for this connection.', { host }), hint: t('Test again. If it keeps failing, update Hermes on {host} and check that signing in there prints no extra text.', { host }), ssh: true }
  if (code === 'bot/hermes-ssh-tunnel') return { heading: t('The tunnel did not open'), title: t('SSH could not open a tunnel to Hermes on {host}', { host }), text: t('Hermes started, but the SSH tunnel from this computer to it did not start listening, or carried no answer.'), hint: t('Check that {host} allows port forwarding, then test again.', { host }), ssh: true }
  if (code === 'bot/hermes-ssh-forward') return { heading: t('A port from your SSH config is in use'), title: facts.port ? t('Port {port} from the SSH config for {host} is busy', { port: facts.port, host }) : t('A port forward in the SSH config for {host} could not start', { host }), text: t('The SSH config entry for {host} forwards its own ports. One is already in use on this computer, usually by another SSH session to the same host, so SSH closed the tunnel.', { host }), hint: t('Close the other SSH session to {host}, or remove the forward from its config entry, then test again.', { host }), ssh: true }
  if (code === 'bot/hermes-ssh-script') return { heading: t('The start script stopped'), title: t('Automagik’s start script failed on {host}', { host }), text: t('SSH signed in, but the small script that finds and starts Hermes stopped with an error.'), hint: t('Check that Python 3 works on {host} and that this user can run Hermes, then test again.', { host }), ssh: true }
  if (code === 'bot/hermes-ssh-details') return { heading: t('Check the SSH details'), title: t('These SSH details can’t be used'), text: t('The host, user, port, key path or Hermes path has characters SSH does not accept.'), hint: t('Edit the SSH details, then test again.'), ssh: true }
  if (code === 'bot/hermes-ssh-timeout' || code === 'bot/hermes-timeout') return { heading: t('The connection timed out'), title: t('The other computer did not become ready in time'), text: t('Check that the other computer is reachable and Hermes can start, then test again.'), hint: t('Check the connection and remote Hermes startup before trying again.'), ssh: draft.mode === 'ssh' }
  if (code === 'bot/hermes-ssh-unreachable') return { heading: t('We could not reach the other computer'), title: t('Check the SSH address and connection'), text: t('Check the host or config name, network, and SSH access to the other computer.'), hint: t('Confirm that SSH can reach this computer, then test again.'), ssh: true }
  if (code === 'bot/hermes-ssh-interactive') return { heading: t('SSH needs a check in a terminal'), title: t('Complete the SSH check once'), text: t('Connect once in a terminal and complete the required check. Then test this connection again.'), hint: t('Complete the terminal check without changing SSH host-key protection.'), ssh: true }
  if (code === 'bot/hermes-approvals') return { heading: t('Check the remote approval setting'), title: t('Choose a profile that asks before running tools'), text: t('Set this profile to manual approvals in Hermes. Automagik does not change its global approval setting.'), hint: t('Check this Hermes profile’s approval rules, then test again.') }
  if (code === 'bot/hermes-protocol') return { heading: t('Hermes returned an unsupported response'), title: t('Check the Hermes version'), text: t('This connection needs the tested standalone Hermes contract.'), hint: t('Check the Hermes version and test the connection again.') }
  // A host this computer has never seen: its key is shown, and trusted only by the button.
  if (code === 'bot/hermes-ssh-host-key-unknown') {
    const trust = Boolean(facts.keyType && facts.fingerprint && !facts.unsaved)
    return { heading: t('Trust this SSH host?'), title: t('{host} is new to this computer', { host }), ssh: true, trust,
      text: trust ? t('This computer has not connected to {host} before. Compare this key with one you trust. If it matches, trust the host to continue.', { host }) : t('This computer has not connected to {host} before, and Automagik cannot save its key for you.', { host }),
      hint: trust ? t('Only this exact key is saved to your known hosts. If {host} ever shows a different key, the connection is refused.', { host }) : facts.unsaved ? t('The SSH config for {host} does not keep host keys. Change that config entry, then test again.', { host }) : t('Connect to {host} once in a terminal and accept its key, then test again.', { host }),
      rows: trust ? [{ label: t('Key type'), value: facts.keyType, mono: true }, { label: t('Fingerprint'), value: facts.fingerprint, mono: true }] : [] }
  }
  // A changed key is never trusted from here, whatever the host says about it.
  if (code.includes('host-key')) return { heading: t('This host’s key has changed'), title: t('The key for {host} is not the one this computer saved', { host }), text: t('The host may have been reinstalled, or something may be between you and it. Automagik will not connect and cannot trust the new key for you.'), hint: t('Connect once in a terminal to verify the SSH host key, then test again.'), ssh: true }
  if (draft.mode === 'ssh' && code === 'bot/hermes-ssh-missing') return { heading: t('SSH couldn’t open Hermes'), title: t('Check the Hermes installation'), text: t('Install or update Hermes on the other computer, or enter its executable path. Then test again.'), hint: t('Hermes must already be installed on the other computer.'), ssh: true }
  if (code === 'bot/hermes-expired') return { heading: t('Test this connection again'), title: t('The connection test expired'), text: t('Test again before choosing and saving a profile.'), hint: t('Run a new connection test before choosing or saving a profile.') }
  if (code === 'bot/hermes-profiles') return { heading: t('We couldn’t list the profiles'), title: t('Check this Hermes profile list'), text: t('Refresh the list, or check that the profile is available on this Hermes.'), hint: t('Check the profile on the other computer, then test again.') }
  if (code === 'bot/hermes' || code === 'bot/hermes-unsupported') return { heading: t('This Hermes can’t connect yet'), title: t('Check this Hermes version and profile'), text: t('Use a supported Hermes version and a profile that asks before running tools. Then test again.'), hint: t('Check the Hermes version and this profile’s approval settings, then test again.') }
  if (code === 'bot/hermes-ssh-auth') {
    // Which key files SSH offered: their names only, on the person's own screen.
    const keys = [...facts.identities, ...(facts.agentKeys ? [facts.agentKeys === 1 ? t('1 key from your SSH agent') : t('{count} keys from your SSH agent', { count: facts.agentKeys })] : [])]
    return keys.length
      ? { heading: t('SSH couldn’t sign in'), title: t('{host} refused your SSH key', { host }), text: t('SSH offered {keys}, and {host} accepted none of them.', { keys: keys.join(', '), host }), hint: t('Check the SSH user and key, then test again.'), ssh: true }
      : { heading: t('SSH couldn’t sign in'), title: t('Check your SSH details'), text: t('Check the host and user. If your key is locked, unlock it in your SSH agent, or choose another key.'), hint: t('Check the SSH user and key, then test again.'), ssh: true }
  }
  if (draft.mode === 'ssh' && code === 'bot/hermes-connection') return { heading: t('Hermes did not answer'), title: t('Hermes on {host} started but did not answer correctly', { host }), text: t('SSH signed in and the tunnel opened, but Hermes did not complete the connection check.'), hint: t('Check that Hermes works on {host}, then test again.', { host }), ssh: true }
  if (draft.mode === 'ssh') return { heading: t('The SSH connection could not start'), title: t('SSH to {host} stopped with an unexpected error', { host }), text: facts.ssh.length ? t('This is not one of the failures Automagik knows. What SSH said is shown below.') : t('This is not one of the failures Automagik knows, and SSH said nothing more.'), hint: t('Run “ssh {host}” in a terminal to see the full error. Fix it there, then test again.', { host }), ssh: true, generic: true }
  if (code === 'bot/hermes-auth') return { heading: t('We couldn’t sign in'), title: draft.authMode === 'password' ? t('The sign-in wasn’t accepted') : t('The token wasn’t accepted'), text: draft.authMode === 'password' ? t('Check your user and password, then sign in again.') : t('Check the token, or choose user and password if this Hermes asks you to sign in.'), hint: draft.authMode === 'password' ? t('Enter your dashboard user and password again, then sign in.') : t('Enter a valid session token and test the connection again.') }
  return { heading: t('We couldn’t connect'), title: t('Check the remote address'), text: t('Check the address and that Hermes is running, then test again.'), hint: t('Check that Hermes is running at this address and try again.') }
}

// Route entry and Settings share the same wizard. A saved route connects without another
// setup screen; its returned model still goes through the existing route-change policy.
export function HermesRemoteConnect({ onClose, onConnected, edit = false, initialView, onSaved }) {
  const [view, setView] = useState(initialView ?? null)
  const [draft, setDraft] = useState(() => draftOf(initialView))
  const [step, setStep] = useState(edit ? 'details' : 'connection')
  const [status, setStatus] = useState('loading')
  const [stage, setStage] = useState('reach')
  const [error, setError] = useState(null)
  const [test, setTest] = useState(null)
  const [profile, setProfile] = useState('')
  const [saved, setSaved] = useState(null)
  const [choosingKey, setChoosingKey] = useState(false)
  const request = useRef(null)
  const testLease = useRef(null)
  const testRequest = useRef(null)
  const saving = useRef(false)
  const progress = useRef(null)
  const stopProgress = () => {
    if (!progress.current) return
    clearTimeout(progress.current.timer)
    progress.current.controller.abort()
    progress.current = null
  }
  const epoch = useRef(0)
  const live = useRef(true)
  const dialog = useRef(null)
  const callbacks = useRef({ onConnected, onSaved })
  callbacks.current = { onConnected, onSaved }
  const discardTest = (testId, requestId = testRequest.current) => {
    // The host can finish a test while its HTTP response is lost or aborted. Its request
    // identity is known before POST, so cleanup never depends on receiving the test ID.
    if (!testId && !requestId) return
    if (testId && testLease.current === testId) testLease.current = null
    if (requestId && testRequest.current === requestId) testRequest.current = null
    void api('hermes-remote-disconnect', { testsOnly: true, ...(requestId ? { requestId } : {}), ...(testId ? { testId } : {}) }).catch(() => {})
  }
  const disposeDraft = () => {
    epoch.current++
    request.current?.abort()
    stopProgress()
    discardTest(testLease.current)
  }
  const close = () => {
    // A save may already be committing on the host. Keep its tested identity and wait
    // for the result rather than suggesting that closing the dialog cancels that commit.
    if (saving.current) return
    disposeDraft()
    setDraft(freshSecrets)
    onClose()
  }
  useEscape(close)
  // What the host kept of the failure just reported: best effort, never a new failure.
  const failureDetail = async key => {
    try { return (await api('hermes-remote-test-status', key))?.failure } catch { return undefined }
  }
  const run = async (endpoint, payload) => {
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    return api(endpoint, payload, controller.signal)
  }
  useEffect(() => {
    live.current = true
    const generation = ++epoch.current
    let loadedDraft = draftOf(initialView)
    void (initialView ? Promise.resolve(initialView) : run('hermes-remote')).then(async next => {
      if (!live.current || generation !== epoch.current) return
      loadedDraft = draftOf(next)
      setView(next); setDraft(loadedDraft)
      if (!edit && configured(next)) {
        setStep('test'); setStatus('connecting')
        const connected = await run('hermes-remote-connect')
        if (!live.current || generation !== epoch.current) return
        await callbacks.current.onConnected?.(connected)
      } else setStatus('idle')
    }).catch(async failure => {
      if (!live.current || generation !== epoch.current || failure?.name === 'AbortError') return
      const detail = loadedDraft.mode === 'ssh' ? await failureDetail({ connect: true }) : undefined
      if (!live.current || generation !== epoch.current) return
      setStep('test'); setStatus('error'); setError({ ...errorFor(failure, loadedDraft, detail), requestId: 'connect' })
    })
    return () => { live.current = false; disposeDraft() }
  }, [])
  useEffect(() => { dialog.current?.querySelector('input,button:not(:disabled)')?.focus() }, [step, status])
  const change = (key, value) => { if (saving.current) return; discardTest(testLease.current); setDraft(current => ({ ...current, [key]: value })); setTest(null); setError(null) }
  const ssh = (key, value) => { if (saving.current) return; discardTest(testLease.current); setTest(null); setDraft(current => ({ ...current, ssh: { ...current.ssh, [key]: value } })) }
  const pickSshHost = item => {
    if (saving.current) return
    discardTest(testLease.current); setTest(null); setError(null)
    setDraft(current => ({ ...current, ssh: { ...current.ssh, host: item.alias, user: item.user, port: item.port } }))
  }
  const testConnection = async () => {
    if (saving.current) return
    discardTest(testLease.current)
    const generation = ++epoch.current
    const requestId = globalThis.crypto.randomUUID()
    testRequest.current = requestId
    const payload = { ...draft, ssh: { ...draft.ssh, port: draft.ssh.port === '' ? undefined : Number(draft.ssh.port) }, requestId }
    stopProgress()
    setStep('test'); setStatus('testing'); setStage('reach'); setError(null); setTest(null)
    const polling = { controller: new AbortController(), timer: null }
    progress.current = polling
    const poll = async () => {
      try {
        const answer = await api('hermes-remote-test-status', { requestId }, polling.controller.signal)
        if (live.current && generation === epoch.current && !polling.controller.signal.aborted && ['reach', 'sign-in', 'open', 'connected'].includes(answer.stage)) setStage(answer.stage)
      } catch {}
      if (live.current && generation === epoch.current && !polling.controller.signal.aborted) polling.timer = setTimeout(poll, 200)
    }
    polling.timer = setTimeout(poll, 200)
    try {
      const answer = await run('hermes-remote-test', payload)
      if (!live.current || generation !== epoch.current) { discardTest(answer.testId, requestId); return }
      testLease.current = answer.testId
      setTest(answer); setProfile(answer.profiles?.[0]?.id ?? ''); setStatus('connected')
    } catch (failure) {
      if (!live.current || generation !== epoch.current || failure?.name === 'AbortError') return
      const detail = payload.mode === 'ssh' ? await failureDetail({ requestId }) : undefined
      if (!live.current || generation !== epoch.current) return
      setError({ ...errorFor(failure, payload, detail), requestId }); setStatus('error')
    } finally {
      if (progress.current === polling) stopProgress()
      if (live.current && generation === epoch.current) setDraft(freshSecrets)
    }
  }
  // Trust names only this wizard's own failed request: the host kept the key it showed.
  const trustHost = async () => {
    if (saving.current || !error?.trust || !error.requestId) return
    const generation = ++epoch.current, requestId = error.requestId, shown = draft
    setStatus('trusting')
    try {
      await run('hermes-remote-ssh-trust', { requestId })
      if (!live.current || generation !== epoch.current) return
      await testConnection()
    } catch (failure) {
      if (!live.current || generation !== epoch.current || failure?.name === 'AbortError') return
      const detail = await failureDetail({ requestId })
      if (!live.current || generation !== epoch.current) return
      setError({ ...errorFor(failure, shown, detail), requestId }); setStatus('error')
    }
  }
  const save = async () => {
    if (saving.current) return
    saving.current = true
    const generation = ++epoch.current
    setStatus('saving'); setError(null)
    try {
      const next = await run('hermes-remote-save', { testId: test.testId, profile })
      if (!live.current || generation !== epoch.current) return
      testLease.current = null // The host consumed this test into the saved connection.
      testRequest.current = null
      setSaved(next); setView(next); setStep('ready'); setStatus('idle'); callbacks.current.onSaved?.(next)
    } catch (failure) {
      if (!live.current || generation !== epoch.current || failure?.name === 'AbortError') return
      setError(errorFor(failure, draft)); setStep('test'); setStatus('error')
    } finally { saving.current = false }
  }
  const refreshProfiles = async () => {
    if (saving.current) return
    const generation = ++epoch.current
    const testId = test.testId
    setStatus('refreshing')
    try {
      const next = await run('hermes-remote-test-profiles', { testId })
      if (!live.current || generation !== epoch.current) return
      const profiles = next.profiles ?? []
      setTest(current => current?.testId === testId ? { ...current, profiles } : current)
      setProfile(current => profiles.some(item => item.id === current) ? current : profiles[0]?.id ?? '')
      setStatus('connected')
    } catch (failure) {
      if (!live.current || generation !== epoch.current || failure?.name === 'AbortError') return
      setError(errorFor(failure, draft)); setStep('test'); setStatus('error')
    }
  }
  const validDetails = draft.mode === 'ssh' ? draft.ssh.host.trim().length > 0 && (draft.ssh.port === '' || (/^\d+$/.test(String(draft.ssh.port)) && Number(draft.ssh.port) > 0 && Number(draft.ssh.port) <= 65535)) : draft.address.trim().length > 0 && (draft.authMode === 'password' ? draft.username.trim().length > 0 && draft.password.length > 0 : draft.credential.length > 0 || (view?.credentialSet === true && draft.address === view.address && draft.authMode === (view.authMode ?? 'token')))
  const current = Math.max(0, ['connection', 'details', 'test', 'profile', 'ready'].indexOf(step))
  const summary = h('div', { className: 'bt-hw-summary' }, h(Pair, { label: draft.mode === 'ssh' ? t('SSH host or config name') : t('Remote address'), value: connectionLabel(draft) }), h(Pair, { label: t('Status'), value: t('Connected') }))
  let heading, content, footer
  if (step === 'connection') {
    heading = t('How would you like to connect?')
    content = h(Fragment, null, h('p', { className: 'bt-hw-lead' }, t('Chat with a Hermes agent on another computer.')),
      h('div', { className: 'bt-hw-cards' },
        [['remote', GlobeIcon, t('Remote address'), t('Hermes is already running. Connect with its address and sign in.'), t('Use an address')], ['ssh', TerminalIcon, t('Through SSH'), t('Start Hermes on the other computer and connect through SSH.'), t('Use SSH')]].map(([id, Icon, title, text, action]) => h('button', { key: id, type: 'button', className: 'bt-hw-card', 'aria-label': title, 'aria-pressed': draft.mode === id, onClick: () => change('mode', id) }, h('span', { className: 'bt-hw-card-icon' }, h(Icon)), h('strong', null, title), h('span', { className: 'bt-hw-card-description' }, text), h('span', { className: 'bt-hw-card-action' }, action, ' →')))),
      h('p', { className: 'bt-hw-quiet' }, t('You can change the connection later from Bot settings.')))
    footer = h(Fragment, null, h(Button, { onClick: close }, t('Cancel')), h(Button, { primary: true, disabled: status === 'loading', onClick: () => setStep('details') }, t('Continue'), ' →'))
  } else if (step === 'details') {
    if (draft.mode === 'ssh') {
      heading = t('Connect through SSH')
      content = h(Fragment, null, h('p', { className: 'bt-hw-lead' }, t('We’ll find Hermes on the other computer and start the connection.')),
        h(SshHostPicker, { host: draft.ssh.host, onPick: pickSshHost }),
        h(Field, { label: t('SSH host or config name'), value: draft.ssh.host, onChange: value => ssh('host', value), hint: t('You can also use a name from your SSH config.') }),
        h('div', { className: 'bt-hw-two' }, h(Field, { label: t('User (optional)'), value: draft.ssh.user, onChange: value => ssh('user', value), placeholder: t('From SSH config') }), h(Field, { label: t('Port (optional)'), value: draft.ssh.port, onChange: value => ssh('port', value), placeholder: t('From SSH config'), type: 'text' })),
        h('div', { className: 'bt-hw-field' }, h('span', null, t('SSH key (optional)')), h('div', { className: 'bt-hw-file-choice' }, h('span', null, draft.ssh.identityFile || t('Use SSH agent or SSH config')), h(Button, { onClick: () => setChoosingKey(on => !on) }, t('Choose file…'))), h('small', null, t('The key stays on this computer.')), choosingKey ? h('div', { className: 'bt-hw-key-path' }, h(Field, { label: t('Key file path'), value: draft.ssh.identityFile, onChange: value => ssh('identityFile', value), placeholder: t('Path on the computer running Automagik'), hint: t('Enter a local path. The key is never uploaded or copied.') }), h(Button, { onClick: () => setChoosingKey(false) }, t('Use this path'))) : null),
        h(Field, { label: t('Hermes path (optional)'), value: draft.ssh.hermesPath, onChange: value => ssh('hermesPath', value), placeholder: t('Find Hermes automatically'), hint: t('Hermes must already be installed on the other computer.') }),
        h(Field, { label: t('Hermes home (optional)'), value: draft.ssh.hermesHome, onChange: value => ssh('hermesHome', value), hint: t('Absolute data folder on the remote computer. Leave empty for its default Hermes home.') }))
    } else {
      heading = draft.authMode === 'password' ? t('Sign in to your Hermes') : t('Connect to your Hermes')
      content = h(Fragment, null, h('p', { className: 'bt-hw-lead' }, draft.authMode === 'password' ? t('Use the sign-in set up on this Hermes instance.') : t('Enter the address of the Hermes you want to use.')),
        h(Field, { label: t('Remote address'), value: draft.address, onChange: value => change('address', value), hint: t('A path after the address is okay.') }),
        h('div', { className: 'bt-hw-field' }, h('span', null, t('How do you sign in?')), h('div', { className: 'bt-hw-segments', role: 'group', 'aria-label': t('How do you sign in?') }, [['token', t('Session token')], ['password', t('User and password')]].map(([id, label]) => h('button', { key: id, type: 'button', 'aria-pressed': draft.authMode === id, onClick: () => setDraft(current => ({ ...freshSecrets(current), authMode: id })) }, label)))),
        draft.authMode === 'password' ? h(Fragment, null, h('div', { className: 'bt-hw-two' }, h(Field, { label: t('User'), value: draft.username, onChange: value => change('username', value), placeholder: t('Your dashboard user') }), h(Field, { label: t('Password'), value: draft.password, onChange: value => change('password', value), placeholder: t('Enter password'), secret: true })), h(Note, null, t('Your password is used to sign in and is not saved.')))
          : h(Fragment, null, h(Field, { label: t('Session token'), value: draft.credential, onChange: value => change('credential', value), placeholder: view?.credentialSet ? t('Key saved — enter a new token to replace it') : '', secret: true, hint: t('Use the session token from this Hermes instance.') }), h(Note, null, t('The saved token stays hidden. You can replace it later.'))))
    }
    footer = h(Fragment, null, h(Button, { onClick: () => { setDraft(freshSecrets); setStep('connection') } }, t('Back')), h(Button, { primary: true, disabled: !validDetails, onClick: testConnection }, draft.mode === 'ssh' ? t('Test SSH connection') : draft.authMode === 'password' ? t('Sign in and test') : t('Test connection'), ' →'))
  } else if (step === 'test') {
    if (status === 'error' || status === 'trusting') {
      heading = error?.heading ?? t('We couldn’t connect')
      const facts = error?.rows?.length ? h('div', { className: 'bt-hw-summary bt-hw-facts' }, error.rows.map(row => h(Pair, { key: row.label, ...row }))) : null
      const said = (error?.lines ?? []).map(block => h(Lines, { key: block.label, ...block }))
      // A new host is a question, not a fault: its key, then one button that trusts it.
      content = error?.trust
        ? h(Fragment, null, h('div', { className: 'bt-hw-result bt-hw-ask', role: 'alert' }, h('span', { className: 'bt-hw-result-icon' }, h(ShieldIcon)), h('h3', null, error.title), h('p', null, error.text)), facts, h(Note, null, error.hint))
        : h(Fragment, null, h('div', { className: 'bt-hw-result bt-hw-failed', role: 'alert' }, h('span', { className: 'bt-hw-result-icon' }, '!'), h('h3', null, error?.title), h('p', null, error?.text)), facts, said, h(Note, { error: true }, error?.hint),
          error?.ssh ? h('p', { className: 'bt-hw-quiet' }, t('Settings → Feedback keeps a line about this test for a report.')) : null)
      footer = error?.trust
        ? h(Fragment, null, h(Button, { disabled: status === 'trusting', onClick: () => setStep('details') }, t('Edit SSH details')), h(Button, { primary: true, disabled: status === 'trusting', onClick: trustHost }, status === 'trusting' ? t('Trusting…') : t('Trust this host'), ' →'))
        : h(Fragment, null, h(Button, { onClick: testConnection, disabled: !validDetails }, t('Test again')), h(Button, { primary: true, onClick: () => setStep('details') }, draft.mode === 'ssh' ? t('Edit SSH details') : t('Edit sign-in'), ' ←'))
    } else if (status === 'connected') {
      heading = t('Hermes is ready')
      content = h(Fragment, null, h('div', { className: 'bt-hw-result bt-hw-success', role: 'status' }, h('span', { className: 'bt-hw-result-icon' }, h(CheckIcon)), h('h3', null, t('Connection works')), h('p', null, t('Now choose a profile from this Hermes.'))), summary, h('p', { className: 'bt-hw-quiet' }, t('Nothing has been sent to a chat.')))
      footer = h(Fragment, null, h(Button, { onClick: () => setStep('details') }, t('Edit connection')), h(Button, { primary: true, onClick: () => setStep('profile') }, t('Choose a profile'), ' →'))
    } else {
      heading = t('Testing your connection')
      content = h(Fragment, null, h('p', { className: 'bt-hw-lead' }, t('Checking {address}. This can take a moment.', { address: connectionLabel(draft) })), h('div', { className: 'bt-hw-checks', role: 'status' },
        [[t('Reach the computer'), connectionLabel(draft)], [t('Sign in'), stage === 'open' || stage === 'connected' ? t('Your sign-in was accepted') : t('Checking your sign-in…')], [t('Open Hermes'), t('Opening the connection…')]].map(([title, description], index) => {
          const at = ['reach', 'sign-in', 'open', 'connected'].indexOf(stage)
          const done = index < at
          const working = index === at
          return h('div', { key: title, className: 'bt-hw-check-row' }, h('span', { className: `bt-hw-status${working ? ' bt-hw-working' : !done ? ' bt-hw-pending' : ''}` }, done ? h(CheckIcon) : working ? h('span', { className: 'bt-hw-spinner' }) : '·'), h('div', null, h('strong', null, title), h('small', null, description)))
        })), h('p', { className: 'bt-hw-quiet' }, t('Next, we’ll list the profiles you can use.')))
      footer = h(Fragment, null, h(Button, { onClick: close }, t('Cancel')), h(Button, { disabled: true }, t('Testing…')))
    }
  } else if (step === 'profile') {
    heading = t('Which profile would you like?')
    const profiles = test?.profiles ?? []
    content = h(Fragment, null, h('p', { className: 'bt-hw-lead' }, t('Profiles available from {address}.', { address: connectionLabel(draft) })),
      h('div', { className: 'bt-hw-profiles', role: 'radiogroup', 'aria-label': t('Profile') }, profiles.map(item => h('button', { key: item.id, type: 'button', className: 'bt-hw-profile', role: 'radio', 'aria-checked': profile === item.id, disabled: status === 'saving', onClick: () => { if (!saving.current) setProfile(item.id) } }, h('span', { className: 'bt-hw-radio' }), h('span', null, h('strong', null, item.name), h('small', null, t('Available on this Hermes'))), profile === item.id ? h('span', { className: 'bt-hw-tag' }, t('Selected')) : null))),
      h('div', { className: 'bt-hw-profile-tools' }, h('span', null, profiles.length === 1 ? t('1 profile available') : t('{count} profiles available', { count: profiles.length })), h('button', { type: 'button', disabled: status === 'refreshing' || status === 'saving', onClick: refreshProfiles }, t('Refresh list'))),
      profiles.length === 0 ? h('p', { role: 'alert', className: 'bt-hw-quiet' }, t('No profiles are available. Check the connection and test again.')) : null,
      h(Note, null, t('This profile’s tools run on the other computer under its own rules.')))
    footer = h(Fragment, null, h(Button, { disabled: status === 'saving', onClick: () => { if (!saving.current) { setStatus('connected'); setStep('test') } } }, t('Back')), h(Button, { primary: true, disabled: !profile || status === 'saving' || status === 'refreshing', onClick: save }, status === 'saving' ? t('Saving…') : t('Use this profile'), ' →'))
  } else {
    heading = t('You’re connected')
    content = h(Fragment, null, h('div', { className: 'bt-hw-result bt-hw-success bt-hw-compact', role: 'status' }, h('span', { className: 'bt-hw-result-icon' }, h(CheckIcon)), h('h3', null, t('Ready to chat')), h('p', null, t('Next time, choose Remote Hermes to connect in one click.'))),
      h('div', { className: 'bt-hw-summary' }, h(Pair, { label: t('Connection'), value: connectionLabel(draft) }), h(Pair, { label: t('Profile'), value: saved?.profile ?? profile })),
      h('p', { className: 'bt-hw-remember' }, h(CheckIcon), t('Connection and profile remembered')),
      h('p', { className: 'bt-hw-limits' }, t('Your bots’ team tools — messages to other bots, secrets, memory and schedules — aren’t available in these chats. This computer’s sandbox does not protect the remote computer.')))
    footer = h(Fragment, null, h(Button, { onClick: () => { setTest(null); setStep('details') } }, t('Connection settings')), h(Button, { primary: true, onClick: () => onConnected ? onConnected(saved) : onClose() }, t('Open chat'), ' →'))
  }
  const trap = event => {
    if (event.key !== 'Tab') return
    const controls = [...dialog.current.querySelectorAll('button:not(:disabled),input:not(:disabled)')]
    if (controls.length === 0) { event.preventDefault(); dialog.current.focus(); return }
    const first = controls[0], last = controls.at(-1)
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
  }
  return createPortal(h('div', { className: 'bt-hermes-layer' }, h('style', null, HERMES_REMOTE_CSS), h('div', { className: 'bt-scrim', onMouseDown: close }),
    h('div', { ref: dialog, role: 'dialog', 'aria-modal': true, 'aria-label': t('Connect Remote Hermes'), 'aria-busy': status === 'saving' || status === 'trusting' || undefined, tabIndex: -1, className: 'bt-hermes-wizard', 'data-step': step, 'data-status': status, onKeyDown: trap },
      h('header', { className: 'bt-hw-head' }, h('div', { className: 'bt-hw-identity' }, h(HermesMark, { size: 36 }), h('div', null, h('strong', null, t('Connect Remote Hermes')), h('small', null, t('A connection to another computer'))), h('button', { type: 'button', className: 'bt-hw-close', 'aria-label': t('Close connection setup'), disabled: status === 'saving', onClick: close }, h(CloseIcon))),
        h('ol', { className: 'bt-hw-steps' }, steps.map((label, index) => h('li', { key: label, 'aria-current': current === index ? 'step' : undefined, 'data-complete': index < current || undefined }, h('span', null, index < current ? h(CheckIcon) : index + 1), t(label))))),
      h('main', { className: 'bt-hw-content' }, h('h2', null, heading), content), h('footer', { className: 'bt-hw-foot' }, footer))), document.body)
}

export function HermesRemoteSettings({ run, Section, actions }) {
  const [view, setView] = useState(null)
  const [pairing, setPairing] = useState(false)
  const [editing, setEditing] = useState(false)
  const [reconciliation, setReconciliation] = useState(null)
  useEffect(() => { let on = true; void run(api('hermes-remote').then(next => { if (on) setView(next) })); return () => { on = false } }, [])
  if (!view) return null
  return h(Fragment, null, h('style', null, HERMES_REMOTE_CSS), h(Section, null,
    h('div', { className: 'bt-set-row' }, h('div', { className: 'bt-set-copy' }, h('span', null, t('Chat with a Hermes agent on another computer.')), h('span', { className: 'bt-set-hint' }, t('Your bots’ team tools (messages to other bots, secrets, memory, schedules) are not available in these chats.')))),
    h('div', { className: 'bt-set-row' }, h('div', { className: 'bt-set-copy' }, h('span', null, view.profile || t('No connection saved')), h('span', { className: 'bt-set-hint' }, view.mode === 'ssh' ? view.ssh?.host : view.address)), h('button', { type: 'button', className: 'bt-soft bt-soft-sm', onClick: () => setEditing(true) }, configured(view) ? t('Edit connection') : t('Set up connection'))),
    view.credentialSet ? h('div', { className: 'bt-set-row' }, h('span', { className: 'bt-set-hint' }, t('Key saved')), h('button', { type: 'button', className: 'bt-soft bt-soft-sm', onClick: () => setEditing(true) }, t('Replace'))) : null,
    configured(view) ? h('div', { className: 'bt-set-row' },
      h('label', null, t('Pair Hermes Bot'), h('select', { 'aria-label': t('Pair Hermes Bot'), value: view.pairedBotId ?? '', disabled: pairing,
        onChange: event => {
          const botId = event.target.value
          setPairing(true)
          void run(api('hermes-remote-pair', { botId }).then(next => setView(next)).finally(() => setPairing(false)))
        } }, h('option', { value: '' }, t('Not paired')),
        (view.bots ?? []).map(bot => h('option', { key: bot.id, value: bot.id, disabled: Boolean(view.pairedBotId && view.pairedBotId !== bot.id) }, bot.name)))),
      h('span', { className: 'bt-set-hint' }, t('Uses this profile’s existing Bot Chat. Other bots, groups and tasks cannot use this pairing. Unpair before changing it.'))) : null,
    configured(view) ? h('div', { className: 'bt-set-row' }, h('button', { type: 'button', className: 'bt-soft bt-soft-sm', onClick: () => run(api('hermes-remote-disconnect').then(next => { if (next) setView(next) })) }, t('Disconnect'))) : null,
    (view.sessions ?? []).filter(session => session.uncertain || session.pendingSubmit).map(session => h('div', { key: session.sessionId }, h('p', { role: 'status' }, t('Connection lost; remote outcome unknown')), h('button', { type: 'button', className: 'bt-soft bt-soft-sm', onClick: () => run(api('hermes-remote-reconcile', { sessionId: session.sessionId }).then(next => { setView(next); setReconciliation(next.reconciliation) })) }, t('Reconnect and reconcile')))),
    reconciliation ? h('div', { role: 'status', className: 'bt-set-hint' }, reconciliation.unknown ? t('Connection lost; remote outcome unknown') : t('Remote session reconciled. Review the remote transcript before sending again.'), reconciliation.gap ? h('p', null, t('Replay gap: showing a fresh remote snapshot.')) : null, h('pre', null, (reconciliation.messages ?? []).map(message => `${message.role}: ${typeof message.text === 'string' ? message.text : typeof message.content === 'string' ? message.content : ''}`).join('\n')), reconciliation.inflight?.assistant ? h('p', null, reconciliation.inflight.assistant) : null) : null),
    editing ? h(HermesRemoteConnect, { edit: true, initialView: view, onClose: () => setEditing(false), onSaved: next => { setView(next); void actions?.refreshModels?.() }, onConnected: () => setEditing(false) }) : null)
}

export const HERMES_REMOTE_CSS = `${HERMES_MARK_CSS}
.bt-hermes-layer{position:fixed;inset:var(--dsh-frame-chrome-top,0px) 0 0;z-index:90;display:flex;align-items:center;justify-content:center;font-family:var(--bt-font);color:var(--bt-ink)}
.bt-hermes-wizard{position:relative;width:min(736px,calc(100vw - 40px));max-height:calc(100dvh - 48px);display:flex;flex-direction:column;background:var(--st-raised,var(--bt-main));border:1px solid var(--st-line,var(--bt-line-2));border-radius:var(--st-r-dialog,24px);box-shadow:var(--st-lift,0 18px 60px rgba(0,0,0,.267));overflow:hidden}
.bt-hw-head{padding:24px 28px 18px;border-bottom:1px solid var(--st-line,var(--bt-line));background:var(--bt-card)}.bt-hw-identity{display:flex;align-items:center;gap:12px}.bt-hw-identity>div{display:flex;flex-direction:column;gap:2px}.bt-hw-identity strong{font:700 16px var(--bt-head-font,var(--bt-font))}.bt-hw-identity small{font-size:12px;color:var(--bt-ink-2)}.bt-hw-close{margin-left:auto;width:30px;height:30px;border:0;border-radius:8px;display:grid;place-items:center;color:var(--bt-ink-2);background:var(--st-sunk,var(--bt-hover));cursor:pointer}.bt-hw-steps{display:flex;list-style:none;margin:22px 0 0;padding:0}.bt-hw-steps li{flex:1;display:flex;align-items:center;gap:6px;color:var(--bt-ink-2);font-size:11px}.bt-hw-steps li>span{width:20px;height:20px;display:grid;place-items:center;border-radius:50%;border:1px solid var(--st-line,var(--bt-line-2));font-size:10px}.bt-hw-steps li[aria-current]{color:var(--bt-ink);font-weight:700}.bt-hw-steps li[aria-current]>span{background:var(--st-lilac,var(--bt-active));border-color:transparent;color:var(--st-lilac-ink,var(--bt-ink))}.bt-hw-steps li[data-complete]>span{color:var(--st-ok,var(--bt-green));background:color-mix(in srgb,var(--bt-green) 10%,var(--bt-card));border-color:transparent}.bt-hw-steps svg{width:11px;height:11px}
.bt-hw-content{padding:26px 28px;background:var(--bt-card);overflow:auto}.bt-hw-content h2{font:700 23px/30px var(--bt-head-font,var(--bt-font));margin:0 0 10px;letter-spacing:-.025em}.bt-hw-lead{color:var(--bt-ink-2);margin:0 0 22px;font-size:14px;line-height:21px}.bt-hw-cards{display:grid;grid-template-columns:1fr 1fr;gap:14px}.bt-hw-card{border:1px solid var(--st-line,var(--bt-line-2));border-radius:var(--st-r-menu,14px);padding:20px;min-height:224px;display:flex;flex-direction:column;align-items:flex-start;text-align:left;color:var(--bt-ink);font:inherit;background:var(--st-raised,var(--bt-main));cursor:pointer}.bt-hw-card[aria-pressed=true]{box-shadow:inset 0 0 0 1px var(--st-cyan,var(--bt-accent));border-color:var(--st-cyan,var(--bt-accent))}.bt-hw-card-icon{height:44px;width:44px;display:grid;place-items:center;border-radius:12px;background:var(--st-lilac,var(--bt-active));color:var(--st-lilac-ink,var(--bt-ink))}.bt-hw-card-icon svg{width:26px;height:26px}.bt-hw-card>strong{margin:14px 0 8px;font-size:16px;line-height:22px}.bt-hw-card-description{font-size:13px;line-height:20px;color:var(--bt-ink-2);margin-bottom:20px}.bt-hw-card-action{margin-top:auto;font-size:12px;font-weight:700;color:var(--st-cyan-ink,var(--bt-accent))}body[data-ds-dark-theme] .bt-hw-card-action{color:var(--st-cyan,var(--bt-accent))}.bt-hw-quiet{color:var(--bt-ink-2);font-size:12px;line-height:18px;margin:18px 0 0}
.bt-hw-field{display:flex;flex-direction:column;gap:8px;margin:0 0 18px;font-size:13px}.bt-hw-field>span:first-child{font-weight:600}.bt-hw-field small{color:var(--bt-ink-2);font-size:12px;line-height:17px}.bt-hw-field input{height:42px;width:100%;box-sizing:border-box;border:1px solid var(--st-line,var(--bt-line-2));border-radius:8px;padding:0 12px;background:var(--st-raised,var(--bt-main));color:var(--bt-ink);font:14px var(--bt-font);outline:none}.bt-hw-field input::placeholder{color:var(--bt-ink-2);opacity:1}.bt-hw-field input:focus-visible,.bt-hermes-wizard button:focus-visible{outline:2px solid var(--st-ring,var(--bt-accent));outline-offset:2px}.bt-hw-segments{display:flex;gap:4px;padding:4px;border-radius:10px;align-self:flex-start;background:var(--st-sunk,var(--bt-hover))}.bt-hw-segments button{border:0;border-radius:var(--bt-hw-choice-radius,7px);background:transparent;color:var(--bt-ink-2);padding:8px 13px;font:12px var(--bt-font);cursor:pointer}.bt-hw-segments button[aria-pressed=true]{background:var(--bt-card);color:var(--bt-ink);box-shadow:0 1px 3px rgba(0,0,0,.067);font-weight:600}.bt-hw-file-choice{display:flex;align-items:center;justify-content:space-between;gap:12px;border:1px solid var(--st-line,var(--bt-line-2));border-radius:8px;padding:8px 10px;background:var(--st-raised,var(--bt-main));color:var(--bt-ink-2);font-size:13px}.bt-hw-file-choice>span{overflow-wrap:anywhere;min-width:0}.bt-hw-file-choice .bt-hw-button{height:30px;padding:0 10px;font-size:12px}.bt-hw-key-path{border:1px solid var(--bt-line-2);padding:14px;border-radius:10px;background:var(--bt-card)}.bt-hw-key-path .bt-hw-field{margin-bottom:10px}.bt-hw-two{display:grid;grid-template-columns:1fr 1fr;gap:16px}.bt-hw-note{display:flex;gap:10px;padding:13px 14px;border:1px solid var(--st-line,var(--bt-line));border-radius:10px;background:var(--st-raised,var(--bt-main));color:var(--bt-ink-2);font-size:12px;line-height:19px}.bt-hw-note svg{flex:none;margin-top:1px}.bt-hw-error-note{background:color-mix(in srgb,var(--bt-danger) 10%,var(--bt-card));border-color:transparent;color:var(--bt-danger)}
.bt-hw-foot{padding:18px 28px;display:flex;justify-content:space-between;gap:12px;border-top:1px solid var(--st-line,var(--bt-line));background:var(--st-raised,var(--bt-main))}.bt-hw-button{height:38px;border:1px solid transparent;border-radius:8px;font:600 13px var(--bt-font);padding:0 15px;display:inline-flex;gap:10px;align-items:center;justify-content:center;white-space:nowrap;cursor:pointer}.bt-hw-primary{background:var(--st-cyan,var(--bt-accent));color:var(--st-cyan-ink,var(--bt-accent-ink,var(--bt-card)));box-shadow:var(--st-clay,none)}.bt-hw-secondary{background:var(--bt-card);border-color:var(--st-line,var(--bt-line-2));color:var(--bt-ink)}.bt-hw-button:disabled{background:var(--st-sunk,var(--bt-hover));color:var(--bt-ink-2);box-shadow:none;cursor:default}
.bt-hw-checks{border:1px solid var(--st-line,var(--bt-line));border-radius:12px;overflow:hidden}.bt-hw-check-row{display:flex;gap:12px;align-items:center;padding:17px;border-bottom:1px solid var(--st-line,var(--bt-line))}.bt-hw-check-row:last-child{border:0}.bt-hw-check-row>div{display:flex;flex-direction:column;gap:4px}.bt-hw-check-row strong{font-size:13px}.bt-hw-check-row small{font-size:12px;color:var(--bt-ink-2)}.bt-hw-status{width:30px;height:30px;border-radius:50%;display:grid;place-items:center;background:color-mix(in srgb,var(--bt-green) 10%,var(--bt-card));color:var(--bt-green)}.bt-hw-pending{background:var(--bt-hover);color:var(--bt-ink-2)}.bt-hw-working{background:var(--st-lilac,var(--bt-active));color:var(--st-lilac-ink,var(--bt-ink))}.bt-hw-spinner{width:17px;height:17px;border-radius:50%;border:2px solid var(--bt-line-2);border-top-color:var(--st-lilac-ink,var(--bt-ink));animation:bt-hw-spin .8s linear infinite}@keyframes bt-hw-spin{to{transform:rotate(360deg)}}
.bt-hw-result{text-align:center;padding:10px 28px 28px}.bt-hw-result-icon{display:grid;place-items:center;width:58px;height:58px;margin:8px auto 16px;border-radius:50%}.bt-hw-result-icon svg{width:30px;height:30px}.bt-hw-success .bt-hw-result-icon{background:color-mix(in srgb,var(--bt-green) 10%,var(--bt-card));color:var(--bt-green)}.bt-hw-failed .bt-hw-result-icon{background:color-mix(in srgb,var(--bt-danger) 10%,var(--bt-card));color:var(--bt-danger);font-size:30px}.bt-hw-result h3{font:700 20px var(--bt-head-font,var(--bt-font));margin:0 0 10px}.bt-hw-result p{margin:0;color:var(--bt-ink-2);font-size:14px;line-height:22px}.bt-hw-summary{border:1px solid var(--st-line,var(--bt-line));border-radius:var(--bt-hw-summary-radius,11px);overflow:hidden;background:var(--st-raised,var(--bt-main))}.bt-hw-pair{display:flex;justify-content:space-between;gap:20px;padding:14px 16px;border-bottom:1px solid var(--st-line,var(--bt-line));font-size:13px}.bt-hw-pair:last-child{border:0}.bt-hw-pair span{color:var(--bt-ink-2);flex:none}.bt-hw-pair strong{font-weight:500;overflow-wrap:anywhere;min-width:0;text-align:right}.bt-hw-mono{font:12px/18px ui-monospace,SFMono-Regular,Menlo,monospace}.bt-hw-facts{margin:0 0 14px}.bt-hw-result+.bt-hw-facts{margin-top:-6px}.bt-hw-ask .bt-hw-result-icon{background:var(--st-lilac,var(--bt-active));color:var(--st-lilac-ink,var(--bt-ink))}.bt-hw-lines{margin:0 0 14px;border:1px solid var(--st-line,var(--bt-line));border-radius:var(--bt-hw-summary-radius,11px);background:color-mix(in srgb,var(--st-sunk,var(--bt-hover)) 55%,var(--bt-card));overflow:hidden}.bt-hw-lines>span{display:block;padding:11px 16px 0;font-size:11px;font-weight:600;color:var(--bt-ink-2)}.bt-hw-lines pre{margin:0;padding:6px 16px 12px;max-height:126px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;color:var(--bt-ink);font:12px/18px ui-monospace,SFMono-Regular,Menlo,monospace}.bt-hw-profiles{border:1px solid var(--st-cyan,var(--bt-accent));border-radius:12px;background:var(--st-raised,var(--bt-main));overflow:hidden}.bt-hw-profile{display:flex;align-items:center;gap:14px;width:100%;padding:20px;border:0;border-bottom:1px solid var(--bt-line);background:transparent;color:var(--bt-ink);text-align:left;cursor:pointer}.bt-hw-profile:last-child{border-bottom:0}.bt-hw-profile[aria-checked=true]{box-shadow:inset 0 0 0 1px var(--st-cyan,var(--bt-accent))}.bt-hw-profile>span:nth-child(2){display:flex;flex-direction:column;gap:5px}.bt-hw-profile strong{font-size:15px}.bt-hw-profile small{font-size:12px;color:var(--bt-ink-2)}.bt-hw-radio{width:18px;height:18px;box-sizing:border-box;border:1px solid var(--bt-line-2);border-radius:50%;background:var(--bt-card)}[aria-checked=true]>.bt-hw-radio{border:5px solid var(--st-cyan,var(--bt-accent))}.bt-hw-tag{margin-left:auto;padding:4px 8px;border-radius:6px;background:var(--st-lilac,var(--bt-active));color:var(--st-lilac-ink,var(--bt-ink));font-size:11px}.bt-hw-profile-tools{display:flex;justify-content:space-between;font-size:12px;color:var(--bt-ink-2);margin:14px 0 22px}.bt-hw-profile-tools button{border:0;background:none;padding:0;color:var(--bt-ink);font:inherit;text-decoration:underline;text-underline-offset:3px;cursor:pointer}.bt-hw-remember{display:flex;gap:9px;align-items:center;font-size:12px;color:var(--bt-green);margin:16px 0}.bt-hw-limits{font-size:12px;line-height:19px;color:var(--bt-ink-2);margin:18px 0 0}.bt-hw-compact{padding-top:0;padding-bottom:18px}.bt-hw-compact .bt-hw-result-icon{margin-top:0}
.bt-hw-host-picker{margin:0 0 20px;padding:14px;border:1px solid var(--st-line,var(--bt-line-2));border-radius:12px;background:var(--st-raised,var(--bt-main));min-width:0}.bt-hw-host-title{display:block;font-size:13px;margin-bottom:10px}.bt-hw-host-picker .bt-hw-field{margin:0 0 10px;gap:6px}.bt-hw-host-picker .bt-hw-field>span{font-size:12px;font-weight:400;color:var(--bt-ink-2)}.bt-hw-host-picker .bt-hw-field input{height:34px;font-size:13px}.bt-hw-host-list{max-height:176px;overflow:auto;overscroll-behavior:contain;border:1px solid var(--st-line,var(--bt-line));border-radius:8px}.bt-hw-host-choice{display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%;border:0;border-bottom:1px solid var(--st-line,var(--bt-line));padding:9px 10px;background:transparent;color:var(--bt-ink);font:inherit;text-align:left;cursor:pointer}.bt-hw-host-choice:last-child{border-bottom:0}.bt-hw-host-choice:hover,.bt-hw-host-choice[aria-pressed=true]{background:var(--bt-hover)}.bt-hw-host-choice>span{display:flex;flex-direction:column;gap:3px;min-width:0}.bt-hw-host-choice strong{font-size:13px;font-weight:600;overflow-wrap:anywhere}.bt-hw-host-choice small{font-size:11px;color:var(--bt-ink-2);overflow-wrap:anywhere}.bt-hw-host-choice svg{flex:none;width:14px;height:14px;color:var(--st-cyan,var(--bt-accent))}.bt-hw-host-hint{margin:0;font-size:12px;line-height:18px;color:var(--bt-ink-2)}.bt-hw-other-hosts{display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%;border:0;background:none;color:var(--bt-ink-2);font:12px var(--bt-font);padding:12px 0 0;text-align:left;cursor:pointer}.bt-hw-other-hosts+ .bt-hw-host-list{margin-top:10px}
@media(max-width:640px){.bt-hermes-wizard{width:calc(100vw - 20px);max-height:calc(100dvh - 20px)}.bt-hw-head,.bt-hw-content{padding:18px}.bt-hw-foot{padding:14px 18px}.bt-hw-cards,.bt-hw-two{grid-template-columns:1fr}.bt-hw-card{min-height:160px}.bt-hw-steps{gap:4px}.bt-hw-steps li{font-size:9px;gap:3px}.bt-hw-steps li>span{width:16px;height:16px}.bt-hw-card-action{margin-top:8px}}
@media(prefers-reduced-motion:reduce){.bt-hw-spinner{animation:none}}
`
