import { randomUUID } from 'node:crypto'
import { HermesTransport, RemoteChat, remoteAddress } from './hermes-transport.js'
import { MISSING_TOOLS, RemoteChatAdapter } from './remote-chat-adapter.js'
import { refusal } from './refusal.js'

export const HERMES_PROVIDER = 'hermes-remote'
const CREDENTIAL_REF = 'HERMES_REMOTE_CREDENTIAL'

export function install(rt, { transport = options => new HermesTransport(options) } = {}) {
  const { ctx, state } = rt
  const record = () => state.prefs?.hermesRemote ?? { enabled: false, models: [] }
  const sessions = () => state.hermesSessions ??= {}
  const enabled = () => record().enabled === true
  const identity = id => sessions()[id] ??= { createKey: randomUUID() }
  const save = () => rt.save()
  const active = new Set()
  let registration
  let adapter

  async function open(options = {}) {
    await rt.load()
    await rt.loadSecrets()
    const config = record()
    if (!config.enabled) throw refusal('Turn on Hermes remote in Models and providers first.')
    const credential = rt.secretValue(config.credentialRef)
    if (!credential) throw refusal('Save a credential for Hermes remote first.')
    const wire = transport({ address: config.address, profile: config.profile, credential })
    active.add(wire)
    const close = wire.close.bind(wire)
    const abort = () => wire.close()
    wire.close = () => { options.signal?.removeEventListener('abort', abort); active.delete(wire); close() }
    options.signal?.addEventListener('abort', abort, { once: true })
    try {
      await wire.connect()
      options.signal?.removeEventListener('abort', abort)
      return new RemoteChat(wire, options)
    } catch (error) {
      active.delete(wire)
      wire.close()
      throw refusal(error?.code === 'bot/hermes' ? error.message : 'Remote Hermes could not connect.')
    }
  }

  const view = () => ({
    enabled: enabled(), address: record().address ?? '', profile: record().profile ?? '',
    credentialRef: record().credentialRef ?? '', credentialSet: Boolean(rt.secretValue?.(record().credentialRef)),
    models: record().models ?? [], limitations: MISSING_TOOLS,
    sessions: Object.entries(sessions()).map(([sessionId, info]) => ({ sessionId, ...info })),
  })

  const publish = () => {
    adapter.registerAll()
    registration?.()
    registration = undefined
    if (enabled() && (record().models?.length ?? 0) > 0) registration = ctx.llm.registerAdapter([HERMES_PROVIDER], adapter)
    rt.dropCatalog?.()
  }

  async function configure(body) {
    await rt.load()
    await rt.loadSecrets()
    if (typeof body.enabled !== 'boolean') throw refusal('Choose whether Hermes remote is on.')
    const address = body.address ? remoteAddress(body.address) : record().address
    const profile = typeof body.profile === 'string' ? body.profile.trim() : record().profile ?? ''
    if (profile.length > 100 || ['\r', '\n', '\0'].some(character => profile.includes(character))) throw refusal('Enter a valid Hermes profile name.')
    if (body.enabled && !address) throw refusal('Enter the Hermes address before turning it on.')
    const changed = address !== record().address || profile !== record().profile
    if (changed && Object.values(sessions()).some(info => info.pendingSubmit || info.uncertain)) throw refusal('Reconcile uncertain remote sessions before changing this connection.')
    if (body.credential !== undefined && body.credential !== '') {
      await rt.secretEndpoint('secret-set', { name: CREDENTIAL_REF, value: body.credential, purpose: 'Remote Hermes connection credential', scope: [] })
    }
    if (body.enabled && !rt.secretValue(CREDENTIAL_REF)) throw refusal('Save a credential before turning Hermes remote on.')
    for (const wire of active) wire.close()
    active.clear()
    adapter.dispose()
    state.prefs.hermesRemote = { enabled: body.enabled, address, profile, credentialRef: CREDENTIAL_REF, models: changed ? [] : record().models ?? [] }
    if (changed) state.hermesSessions = {}
    await save()
    publish()
    return view()
  }

  async function discover() {
    const run = await open()
    try {
      // Contract version lives in session.info, not gateway.ready. This creates an empty
      // session only; the probe never submits a turn and never changes profile defaults.
      await run.prepare()
      record().models = await run.transport.models()
      await save()
      publish()
      return view()
    } finally {
      if (run.identity.runtimeSessionId) await run.transport.request('session.close', { session_id: run.identity.runtimeSessionId }).catch(() => {})
      active.delete(run.transport)
      run.dispose()
    }
  }

  adapter = new RemoteChatAdapter(rt, { open, models: () => record().models ?? [], identity, save, enabled })
  rt.hooks.endpoint('hermes-remote', async () => { await rt.load(); await rt.loadSecrets(); return view() }, { read: true })
  rt.hooks.endpoint('hermes-remote-configure', configure)
  rt.hooks.endpoint('hermes-remote-discover', discover)
  rt.hooks.endpoint('hermes-remote-reconcile', async (body) => {
    const info = sessions()[body.sessionId]
    if (!info?.storedSessionId) throw refusal('There is no saved remote session to reconcile.')
    const run = await open({ identity: info, save })
    try {
      const result = await run.reconcile()
      return { ...view(), reconciliation: { unknown: result.unknown, gap: result.gap, messages: result.snapshot.messages, inflight: result.snapshot.inflight } }
    } finally { active.delete(run.transport); run.dispose() }
  })
  ctx.effect(() => {
    void rt.load().then(publish).catch(() => {})
    return () => { registration?.(); adapter.dispose(); for (const wire of active) wire.close(); active.clear() }
  }, 'ds-bot: remote Hermes')
  Object.assign(rt, { hermesRemote: { view, configure, discover, adapter } })
}
