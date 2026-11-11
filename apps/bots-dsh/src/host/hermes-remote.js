import { randomUUID } from 'node:crypto'
import { HermesTransport, RemoteChat, remoteAddress, HERMES_DEADLINES } from './hermes-transport.js'
import { prepareHermesConnection, refreshHermesProfiles } from './hermes-connection.js'
import { MISSING_TOOLS, RemoteChatAdapter } from './remote-chat-adapter.js'
import { refusal } from './refusal.js'

export const HERMES_PROVIDER = 'hermes-remote'
const CREDENTIAL_REF = 'HERMES_REMOTE_CREDENTIAL'
const TEST_LIFETIME = 5 * 60_000
const fail = (message, kind = 'connection') => refusal(message, { code: `bot/hermes-${kind}` })
const sshFields = ssh => Object.fromEntries(['host', 'user', 'port', 'identityFile', 'hermesPath'].filter(key => ssh?.[key] !== undefined).map(key => [key, ssh[key]]))
const CONNECTION_ERRORS = Object.freeze({
  'bot/hermes-auth': 'Hermes did not accept the saved sign-in. Check the token or sign in again.',
  'bot/hermes-connection': 'Remote Hermes could not connect. Check the connection details and try again.',
  'bot/hermes-profiles': 'Hermes could not open the selected profile. Check its available profiles and test again.',
  'bot/hermes-expired': 'This connection test expired. Test it again before connecting.',
  'bot/hermes-unsupported': 'Remote Hermes requires standalone Desktop contract 8. Canonical-authority Hermes is not supported.',
  'bot/hermes-approvals': 'Set this remote profile to manual approvals in Hermes before connecting. Automagik does not change its global approval setting.',
  'bot/hermes-protocol': 'Remote Hermes returned an invalid protocol frame. Reconnect and reconcile the remote session.',
  'bot/hermes-timeout': 'Hermes did not answer in time. Check the connection and try again.',
  'bot/hermes-ssh': 'SSH could not connect. Check the connection details and try again.',
  'bot/hermes-ssh-host-key': 'Verify this computer’s SSH host key in a terminal before testing again.',
  'bot/hermes-ssh-auth': 'SSH could not sign in. Check the user and key, then test again.',
  'bot/hermes-ssh-missing': 'SSH could not find Hermes. Install Hermes or enter its executable path.',
  'bot/hermes-ssh-interactive': 'SSH needs interactive sign-in. Unlock the key in your SSH agent, then test again.',
  'bot/hermes-ssh-update': 'The remote Hermes needs an update before it can connect.',
  'bot/hermes-ssh-platform': 'This remote platform does not support the Hermes SSH connection.',
  'bot/hermes-ssh-timeout': 'SSH did not answer in time. Check the connection and test again.',
  'bot/hermes-ssh-unreachable': 'SSH could not reach the other computer. Check the host and connection.',
  'bot/hermes-ssh-cleanup': 'The SSH connection could not confirm remote cleanup. Check the remote Hermes before reconnecting.',
})
const connectionFailure = (error, native = false) => error?.cleanupUnknown === true
  ? refusal(CONNECTION_ERRORS['bot/hermes-ssh-cleanup'], { code: 'bot/hermes-ssh-cleanup' })
  : Object.hasOwn(CONNECTION_ERRORS, error?.code)
  ? refusal(CONNECTION_ERRORS[error.code], { code: error.code })
  : refusal(native && error?.code === 'bot/hermes' ? error.message : 'Remote Hermes could not connect.')

export function install(rt, { transport = options => new HermesTransport(options), fetch: fetcher = globalThis.fetch, startSsh, now = Date.now, deadlines = HERMES_DEADLINES, testLifetime = TEST_LIFETIME } = {}) {
  const { ctx, state } = rt
  const record = () => state.prefs?.hermesRemote ?? { enabled: false, models: [] }
  const sessions = () => state.hermesSessions ??= {}
  const enabled = () => record().enabled === true
  const identity = id => sessions()[id] ??= { createKey: randomUUID() }
  const saveState = () => rt.save()
  const active = new Set(), leases = new Set(), closing = new Set()
  let registration, adapter, tested, pendingTest, currentLease, pendingConnection, cleanupFailure
  let generation = 0, testGeneration = 0, disposed = false, disconnecting = false

  function budget(signal) {
    const controller = new AbortController(), until = Date.now() + deadlines.start
    const abort = () => controller.abort()
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) abort()
    const timer = setTimeout(abort, deadlines.start)
    return { controller, signal: controller.signal, until, finish: () => { clearTimeout(timer); signal?.removeEventListener('abort', abort) } }
  }
  const remaining = until => ({ ...deadlines, start: Math.max(1, until - Date.now()) })

  const connectionKey = config => JSON.stringify([config.mode ?? 'remote', config.address, config.profile, config.mode === 'ssh' ? config.ssh : undefined])
  function requireReplaceable(next) {
    if (connectionKey(next) !== connectionKey(record()) && Object.values(sessions()).some(info => info.pendingSubmit || info.uncertain)) {
      throw refusal('Reconcile uncertain remote sessions before changing this connection.')
    }
  }
  function lease(connection, held = false) {
    const entry = { connection, held, users: 0, closed: false }
    entry.close = () => {
      if (entry.task) return entry.task
      entry.closed = true
      if (currentLease === entry) currentLease = undefined
      entry.task = Promise.resolve().then(() => connection.close())
      closing.add(entry.task)
      void entry.task.then(() => { leases.delete(entry); closing.delete(entry.task) }, () => {
        cleanupFailure = fail('The SSH connection could not confirm remote cleanup. Check the remote Hermes before reconnecting.', 'ssh-cleanup')
        closing.delete(entry.task)
      })
      return entry.task
    }
    entry.release = () => {
      entry.users--
      if (!entry.users && !entry.held) void entry.close().catch(() => {})
    }
    leases.add(entry)
    return entry
  }
  async function drain() {
    await Promise.allSettled(closing)
    if (cleanupFailure) throw cleanupFailure
  }
  function savedSecret(config) {
    const value = rt.secretValue(config.credentialRef)
    if (!value) throw fail('Save a credential for Remote Hermes first.', 'auth')
    if (!config.setupVersion) return { kind: 'token', credential: value }
    try {
      const secret = JSON.parse(value)
      if (secret?.kind === 'token' || secret?.kind === 'session') return secret
    } catch {}
    throw fail('The saved sign-in is unavailable. Set up this connection again.', 'auth')
  }
  function reusableToken(draft) {
    if (draft?.mode !== 'remote' || draft.authMode !== 'token' || (draft.credential !== undefined && draft.credential !== '')) return undefined
    const config = record()
    const key = value => JSON.stringify([value.mode ?? 'remote', value.address, value.authMode ?? 'token', value.credentialRef])
    if (key(draft) !== key(config) || !config.credentialRef) throw fail('Enter the session token for this Hermes.', 'auth')
    const value = rt.secretValue(config.credentialRef), secret = savedSecret(config), owner = generation, expected = key(config)
    if (secret.kind !== 'token') throw fail('Enter the session token for this Hermes.', 'auth')
    const check = () => {
      if (generation !== owner || key(record()) !== expected || rt.secretValue(config.credentialRef) !== value) {
        throw fail('The saved connection changed. Test it again before using its token.', 'auth')
      }
    }
    return { secret, check }
  }
  async function acquire(config, signal, until) {
    if (!config.setupVersion) return undefined // Preserve the installed legacy transport contract.
    if (currentLease && !currentLease.closed) return currentLease
    if (!pendingConnection) {
      const owner = generation, controller = new AbortController()
      const secret = config.mode === 'ssh' ? undefined : savedSecret(config)
      const pending = { controller, waiters: 0 }
      pendingConnection = pending
      pending.task = prepareHermesConnection({ mode: config.mode, address: config.address, authMode: config.authMode, ssh: config.ssh }, {
        fetch: fetcher, startSsh, signal: controller.signal, deadlines: remaining(until), secret, discover: false,
        onAuthUpdate: async updated => {
          if (disposed || owner !== generation || record().credentialRef !== config.credentialRef) throw fail('Connection setup was cancelled.')
          await rt.secretEndpoint('secret-set', { name: config.credentialRef, value: JSON.stringify(updated), purpose: 'Remote Hermes authenticated connection', scope: [] })
        },
      }).then(async connection => {
        if (disposed || disconnecting || owner !== generation || controller.signal.aborted) {
          await connection.close()
          throw fail('This connection setup was cancelled.')
        }
        return pending.owned = currentLease = lease(connection)
      }).finally(() => { if (pendingConnection === pending) pendingConnection = undefined })
      void pending.task.catch(() => {})
    }
    const pending = pendingConnection
    pending.waiters++
    let abort
    try {
      if (!signal) return await pending.task
      if (signal.aborted) throw fail('Connection setup was cancelled.')
      return await Promise.race([pending.task, new Promise((_, reject) => {
        abort = () => reject(fail('Connection setup was cancelled.'))
        signal.addEventListener('abort', abort, { once: true })
      })])
    } finally {
      signal?.removeEventListener('abort', abort)
      pending.waiters--
      if (!pending.waiters && signal?.aborted) {
        pending.controller.abort()
        if (pending.owned && !pending.owned.users) await pending.owned.close()
      }
    }
  }
  async function open(options = {}) {
    const startup = options.startup ?? budget(options.signal)
    try {
      await rt.load(); await rt.loadSecrets()
      const config = record(), owner = generation
      if (disposed || disconnecting || !config.enabled) throw refusal('Turn on Remote Hermes in Bot settings first.')
      const owned = options.connectionLease ?? await acquire(config, startup.signal, startup.until)
      if (disposed || disconnecting || owner !== generation || options.signal?.aborted || owned?.closed) {
        if (owned && !owned.users) await owned.close()
        throw fail('Connection setup was cancelled.')
      }
      const connection = owned?.connection
      const credential = connection?.credential ?? savedSecret(config).credential
      if (owned) owned.users++
      let wire
      try {
        wire = transport(connection ? {
          address: connection.address, profile: options.profile ?? config.profile, credential, authHeaders: connection.authHeaders,
          allowLoopback: connection.allowLoopback, redactionSecrets: connection.redactionSecrets,
          deadlines: remaining(startup.until),
          fetch: async (...args) => {
            const response = await connection.fetch(...args)
            for (const secret of connection.redactionSecrets) wire?.secrets?.add(secret)
            return response
          },
        } : { address: config.address, profile: config.profile, credential, deadlines: remaining(startup.until) })
      } catch (error) { owned?.release(); throw error }
      active.add(wire)
      let closed = false
      const close = wire.close.bind(wire), abort = () => wire.close()
      wire.close = () => {
        if (closed) return
        closed = true
        options.signal?.removeEventListener('abort', abort)
        startup.signal.removeEventListener('abort', abort)
        active.delete(wire)
        close()
        owned?.release()
        if (!options.startup) startup.finish()
      }
      startup.signal.addEventListener('abort', abort, { once: true })
      try {
        await wire.connect()
        if (startup.signal.aborted) throw fail('Connection setup was cancelled or timed out.')
        const run = new RemoteChat(wire, options)
        if (!options.startup) {
          const prepare = run.prepare.bind(run)
          run.prepare = async (...args) => {
            try { return await prepare(...args) }
            finally { startup.finish(); startup.signal.removeEventListener('abort', abort) }
          }
        }
        return run
      } catch (error) {
        wire.close()
        throw connectionFailure(error, true)
      }
    } catch (error) {
      if (!options.startup) startup.finish()
      throw error?.code === 'bot/refused' && error.cleanupUnknown !== true ? error : connectionFailure(error)
    }
  }
  const view = () => ({
    enabled: enabled(), mode: record().mode ?? 'remote', authMode: record().authMode ?? 'token',
    address: record().address ?? '', profile: record().profile ?? '', ssh: record().mode === 'ssh' ? sshFields(record().ssh) : undefined,
    credentialRef: record().credentialRef ?? '', credentialSet: record().mode === 'ssh' ? Boolean(record().enabled) : Boolean(rt.secretValue?.(record().credentialRef)),
    models: record().models ?? [], limitations: MISSING_TOOLS,
    modelRef: record().models?.[0] ? `${HERMES_PROVIDER}/${record().models[0].id}` : undefined,
    sessions: Object.entries(sessions()).map(([sessionId, info]) => ({ sessionId, ...info })),
  })
  const publish = () => {
    if (disposed) return
    adapter.registerAll()
    registration?.(); registration = undefined
    if (enabled() && (record().models?.length ?? 0) > 0) registration = ctx.llm.registerAdapter([HERMES_PROVIDER], adapter)
    rt.dropCatalog?.()
  }
  async function stopLive() {
    pendingConnection?.controller.abort()
    await Promise.allSettled([...adapter.live.values()].map(entry => entry.run.stop()))
    adapter.dispose()
    for (const wire of active) wire.close()
    active.clear()
    if (pendingConnection) await Promise.allSettled([pendingConnection.task])
    for (const owned of leases) if (owned !== tested?.lease) await owned.close().catch(() => {})
    await drain()
  }
  async function cancelTests({ testId, requestId } = {}) {
    const scoped = testId !== undefined || requestId !== undefined
    if ((testId !== undefined && (typeof testId !== 'string' || !testId))
      || (requestId !== undefined && (typeof requestId !== 'string' || !requestId))) return
    const matches = entry => entry && (testId === undefined || entry.id === testId)
      && (requestId === undefined || entry.requestId === requestId)
    const pending = matches(pendingTest) ? pendingTest : undefined
    const previous = matches(tested) ? tested : undefined
    if (scoped && !pending && !previous) return
    if (!scoped || pending) testGeneration++
    if (pending) pendingTest = undefined
    if (previous) tested = undefined
    pending?.controller.abort()
    previous?.controller.abort()
    clearTimeout(previous?.timer)
    if (previous) await previous.lease.close()
    if (pending) await Promise.allSettled([pending.task])
  }
  async function testDraft(draft, signal) {
    if (disposed) throw fail('Connection setup is no longer available.')
    const cancelling = cancelTests(), owner = testGeneration
    const startup = budget(signal), controller = startup.controller
    const pending = { controller, requestId: typeof draft?.requestId === 'string' && draft.requestId.length <= 100 ? draft.requestId : undefined, stage: 'reach' }
    pendingTest = pending
    pending.task = (async () => {
      await cancelling
      if (owner !== testGeneration || controller.signal.aborted) throw fail('Connection setup was cancelled.')
      await rt.load(); await rt.loadSecrets()
      if (owner !== testGeneration || controller.signal.aborted) throw fail('Connection setup was cancelled.')
      const source = reusableToken(draft)
      const checkedFetch = source ? async (...args) => {
        source.check()
        const response = await fetcher(...args)
        source.check()
        return response
      } : fetcher
      const connection = await prepareHermesConnection(draft, { fetch: checkedFetch, startSsh, signal: controller.signal, deadlines: remaining(startup.until), secret: source?.secret,
        onProgress: stage => { if (pendingTest === pending && owner === testGeneration && !controller.signal.aborted) pending.stage = stage },
      })
      if (disposed || owner !== testGeneration || controller.signal.aborted) { await connection.close(); throw fail('Connection setup was cancelled.') }
      const entry = { id: randomUUID(), lease: lease(connection, true), controller, expires: now() + testLifetime, requestId: pending.requestId, checkSource: source?.check, fetch: checkedFetch }
      try {
        entry.checkSource?.()
        await probe(entry.lease, connection.profiles[0].id, controller.signal, startup.until)
        entry.checkSource?.()
        if (disposed || owner !== testGeneration || controller.signal.aborted) throw fail('Connection setup was cancelled.')
      } catch (error) { await entry.lease.close(); throw error }
      // Keep only connection references and ephemeral session material, never the submitted password/user.
      entry.config = { mode: connection.mode, authMode: connection.authMode, address: connection.mode === 'remote' ? connection.address : '', ...(connection.mode === 'ssh' ? { ssh: sshFields(connection.ssh) } : {}) }
      entry.timer = setTimeout(() => { if (tested === entry) { tested = undefined; entry.controller.abort(); void entry.lease.close().catch(() => {}) } }, testLifetime)
      entry.timer.unref?.()
      tested = entry
      pending.stage = 'connected'
      return { testId: entry.id, profiles: connection.profiles, status: 'connected' }
    })()
    try { return await pending.task }
    catch (error) { throw error?.cleanupUnknown === true ? connectionFailure(error) : error }
    finally {
      startup.finish()
      if (pendingTest === pending) pendingTest = undefined
    }
  }
  async function probe(owned, profile, signal, until) {
    // Probe a chosen profile without enabling the adapter or sending a message.
    const wire = transport({ address: owned.connection.address, profile, credential: owned.connection.credential,
      authHeaders: owned.connection.authHeaders, allowLoopback: owned.connection.allowLoopback, redactionSecrets: owned.connection.redactionSecrets,
      deadlines: remaining(until), fetch: async (...args) => {
        const response = await owned.connection.fetch(...args)
        for (const secret of owned.connection.redactionSecrets) wire.secrets?.add(secret)
        return response
      } })
    owned.users++
    let closed = false
    const close = wire.close.bind(wire), abort = () => wire.close()
    wire.close = () => { if (closed) return; closed = true; signal?.removeEventListener('abort', abort); close(); owned.release() }
    signal?.addEventListener('abort', abort, { once: true })
    let run
    try {
      if (signal?.aborted) throw fail('Connection setup was cancelled.')
      await wire.connect()
      if (signal?.aborted) throw fail('Connection setup was cancelled or timed out.')
      run = new RemoteChat(wire)
      await run.prepare()
      if (signal?.aborted) throw fail('Connection setup was cancelled or timed out.')
      const models = await wire.models()
      if (signal?.aborted) throw fail('Connection setup was cancelled or timed out.')
      if (!models.length) throw fail('This profile has no available models. Configure a model in Hermes and test again.', 'profiles')
      return models
    } finally {
      signal?.removeEventListener('abort', abort)
      if (run?.identity.runtimeSessionId && !signal?.aborted) await wire.request('session.close', { session_id: run.identity.runtimeSessionId }).catch(() => {})
      if (run) run.dispose(); else wire.close()
    }
  }
  async function saveTest(body, signal) {
    const startup = budget(signal)
    try { return await saveTestWithin(body, startup) }
    catch (error) { throw error?.cleanupUnknown === true ? connectionFailure(error) : error }
    finally { startup.finish() }
  }
  async function saveTestWithin(body, startup) {
    const signal = startup.signal
    await rt.load(); await rt.loadSecrets()
    const entry = tested
    if (!entry || entry.id !== body?.testId || entry.expires <= now() || entry.lease.closed) throw fail('This connection test expired. Test it again before saving.', 'expired')
    entry.checkSource?.()
    const profile = entry.lease.connection.profiles.find(profile => profile.id === body.profile)?.id
    if (!profile) throw fail('Choose a profile returned by this Hermes.', 'profiles')
    const next = { ...entry.config, profile, setupVersion: 1, enabled: true }
    requireReplaceable(next)
    const models = await probe(entry.lease, profile, signal, startup.until)
    entry.checkSource?.()
    if (tested !== entry || disposed || signal?.aborted || entry.expires <= now()) throw fail('This connection test expired or was cancelled. Test it again.', 'expired')
    const old = record(), oldSessions = state.hermesSessions
    const changed = connectionKey(next) !== connectionKey(old)
    entry.lease.held = false
    await entry.lease.close()
    if (tested !== entry || disposed || signal?.aborted) throw fail('Connection setup was cancelled.')
    entry.checkSource?.()
    const name = entry.lease.connection.secret ? `HERMES_REMOTE_${randomUUID().replaceAll('-', '').toUpperCase()}` : undefined
    let installed, installedSessions, saveGeneration
    try {
      if (name) await rt.secretEndpoint('secret-set', { name, value: JSON.stringify(entry.lease.connection.secret), purpose: 'Remote Hermes authenticated connection', scope: [] })
      if (tested !== entry || disposed || signal?.aborted) throw fail('Connection setup was cancelled.')
      entry.checkSource?.()
      disconnecting = true; saveGeneration = ++generation
      await stopLive()
      if (tested !== entry || disposed || signal?.aborted || generation !== saveGeneration) throw fail('Connection setup was cancelled.')
      state.prefs ??= {}
      installed = { ...next, models, ...(name ? { credentialRef: name } : {}) }
      state.prefs.hermesRemote = installed
      if (changed) state.hermesSessions = installedSessions = {}
      await saveState()
      if (tested !== entry || disposed || signal?.aborted || record() !== installed || generation !== saveGeneration) throw fail('The saved connection changed. Test it again before saving.')
    } catch (error) {
      // Roll back only our own installed state. An awaited write may have let a
      // different configuration finish before this stale save rejects.
      if (installed && record() === installed && generation === saveGeneration) {
        state.prefs.hermesRemote = old
        if (installedSessions && state.hermesSessions === installedSessions) state.hermesSessions = oldSessions
      }
      if (name && record().credentialRef !== name) await rt.secretEndpoint('secret-delete', { name }).catch(() => {})
      throw error
    } finally { if (generation === saveGeneration) disconnecting = false }
    tested = undefined; clearTimeout(entry.timer)
    entry.lease.held = false
    if (!entry.lease.users) await entry.lease.close()
    if (old.credentialRef && old.credentialRef !== name) await rt.secretEndpoint('secret-delete', { name: old.credentialRef }).catch(() => {})
    publish()
    return view()
  }
  async function configure(body) {
    await rt.load(); await rt.loadSecrets()
    if (typeof body.enabled !== 'boolean') throw refusal('Choose whether Remote Hermes is on.')
    const address = body.address ? remoteAddress(body.address) : record().address
    const profile = typeof body.profile === 'string' ? body.profile.trim() : record().profile ?? ''
    if (profile.length > 100 || ['\r', '\n', '\0'].some(character => profile.includes(character))) throw refusal('Enter a valid Hermes profile name.')
    if (body.enabled && !address) throw refusal('Enter the Hermes address before turning it on.')
    const next = { enabled: body.enabled, address, profile, credentialRef: CREDENTIAL_REF }
    requireReplaceable(next)
    const changed = connectionKey(next) !== connectionKey(record())
    if (body.credential !== undefined && body.credential !== '') await rt.secretEndpoint('secret-set', { name: CREDENTIAL_REF, value: body.credential, purpose: 'Remote Hermes connection credential', scope: [] })
    if (body.enabled && !rt.secretValue(CREDENTIAL_REF)) throw refusal('Save a credential before turning Remote Hermes on.')
    await cancelTests()
    disconnecting = true; generation++
    try {
      await stopLive()
      state.prefs ??= {}
      state.prefs.hermesRemote = { ...next, models: changed ? [] : record().models ?? [] }
      if (changed) state.hermesSessions = {}
      await saveState()
    } finally { disconnecting = false }
    publish()
    return view()
  }
  async function discover(signal) {
    const startup = budget(signal)
    let run
    try {
      run = await open({ signal: startup.signal, startup })
      await run.prepare()
      record().models = await run.transport.models()
      await saveState(); publish()
      return view()
    } finally {
      if (run?.identity.runtimeSessionId) await run.transport.request('session.close', { session_id: run.identity.runtimeSessionId }).catch(() => {})
      run?.dispose()
      startup.finish()
      await drain()
    }
  }
  async function connect(signal) {
    await rt.load(); await rt.loadSecrets()
    if (!enabled()) throw fail('Set up Remote Hermes before connecting.')
    return discover(signal)
  }
  async function disconnect(body = {}) {
    await cancelTests(body?.testsOnly ? { testId: body.testId, requestId: body.requestId } : undefined)
    if (body?.testsOnly) return view()
    disconnecting = true; generation++
    try { await stopLive() } finally { disconnecting = false }
    return view()
  }
  async function refreshProfiles(body, signal) {
    const entry = tested
    if (!entry || entry.id !== body?.testId || entry.expires <= now() || entry.lease.closed) throw fail('This connection test expired. Test it again.', 'expired')
    entry.checkSource?.()
    const combined = signal ? AbortSignal.any([signal, entry.controller.signal]) : entry.controller.signal
    const profiles = await refreshHermesProfiles(entry.lease.connection, { fetch: entry.fetch, signal: combined, deadlines })
    entry.checkSource?.()
    if (tested !== entry || entry.expires <= now() || combined.aborted) throw fail('This connection test expired or was cancelled.', 'expired')
    entry.lease.connection.profiles = profiles
    return { profiles }
  }

  adapter = new RemoteChatAdapter(rt, { open, models: () => record().models ?? [], identity, save: saveState, enabled })
  rt.hooks.endpoint('hermes-remote', async () => { await rt.load(); await rt.loadSecrets(); return view() }, { read: true })
  rt.hooks.endpoint('hermes-remote-test', (body, signal) => testDraft(body, signal))
  rt.hooks.endpoint('hermes-remote-test-status', body => ({ stage: pendingTest?.requestId && pendingTest.requestId === body?.requestId
    ? pendingTest.stage : tested?.requestId && tested.requestId === body?.requestId ? 'connected' : 'reach' }), { read: true })
  rt.hooks.endpoint('hermes-remote-test-profiles', (body, signal) => refreshProfiles(body, signal))
  rt.hooks.endpoint('hermes-remote-save', (body, signal) => saveTest(body, signal))
  rt.hooks.endpoint('hermes-remote-connect', (_body, signal) => connect(signal))
  rt.hooks.endpoint('hermes-remote-disconnect', disconnect)
  rt.hooks.endpoint('hermes-remote-configure', configure)
  rt.hooks.endpoint('hermes-remote-discover', (_body, signal) => discover(signal))
  rt.hooks.endpoint('hermes-remote-reconcile', async (body, signal) => {
    const info = sessions()[body.sessionId]
    if (!info?.storedSessionId) throw refusal('There is no saved remote session to reconcile.')
    const run = await open({ identity: info, save: saveState, signal })
    try {
      const result = await run.reconcile()
      return { ...view(), reconciliation: { unknown: result.unknown, gap: result.gap, messages: result.snapshot.messages, inflight: result.snapshot.inflight } }
    } finally { run.dispose(); await drain() }
  })
  ctx.effect(() => {
    void rt.load().then(publish).catch(() => {})
    return async () => {
      disposed = true
      registration?.(); registration = undefined
      await disconnect()
    }
  }, 'ds-bot: remote Hermes')
  Object.assign(rt, { hermesRemote: { view, configure, discover, adapter, test: testDraft, save: saveTest, connect, disconnect, refreshProfiles } })
}
