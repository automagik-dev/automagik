import { createElement as h, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { ModelMenu } from './model-menu.js'
import { t } from './i18n.js'
import { freePriority } from './surface.js'

export function installConversationModelSeat({ slots, face, Component, priority = -100 }) {
  return slots.inject('conversation.input.model', () => slots.register({
    name: 'conversation.input.model',
    priority: freePriority(slots.entries('conversation.input.model'), { priority }),
    inject: face,
    children: { 'conversation.model.accounts': { kind: 'list', scope: 'root' } },
  }, Component))
}

// Bot-owned selections live on the Bot. Every ordinary native Session, including a
// plugin's channel thread, owns its own selection. Rooms have several answering Bots;
// addressed subagents inherit their caller's route and offer neither picker.
export function modelSeatTarget(roster, sessionId, addressed = false) {
  if (!sessionId || addressed || roster.roomsById?.[sessionId] !== undefined) return 'hidden'
  const bot = roster.byId?.[sessionId]
  return bot !== undefined && (bot.kind !== 'dsh' || roster.hostModels?.[bot.id] !== undefined) ? 'bot' : 'session'
}

// Use the Session directory for its current selection and names. Keep the team's
// additional model metadata (credential status, superseded models) for the same refs.
export function sessionModelRoster(roster, directory) {
  const models = new Map((roster.models ?? []).map(model => [model.ref, model]))
  for (const provider of directory.groups ?? []) {
    for (const model of provider.models ?? []) {
      const ref = `${provider.id}/${model.id}`
      models.set(ref, { ...models.get(ref), ...model, ref, provider: provider.id, providerName: provider.name })
    }
  }
  // A synthetic Session subject must never resolve another plugin's Bot model menu.
  return { ...roster, models: [...models.values()], hostModels: {} }
}

// The Host checks credentials and CLI login before writing the Session selection,
// and preserves the profile default. Never optimistically replace the directory's
// current value: its Session-event projection is the source of truth after success.
export function sessionModelChanges({ sessionId, select, onBusy = () => {} }) {
  let pending = false
  return async (ref, reasoningEffort) => {
    if (pending) return false
    pending = true
    onBusy(true)
    try {
      await select({ sessionId, ref, ...(reasoningEffort === undefined ? {} : { reasoningEffort }) })
      return true
    } finally {
      pending = false
      onBusy(false)
    }
  }
}

export function NativeModelSeat({ sessionId, directory, roster, actions, select, locked = false }) {
  const snapshot = useSyncExternalStore(directory.store.subscribe, directory.store.getSnapshot, directory.store.getSnapshot)
  const [busy, setBusy] = useState(false)
  const change = useMemo(() => sessionModelChanges({ sessionId, select, onBusy: setBusy }), [sessionId, select])
  const menuActions = useMemo(() => ({
    ...actions,
    refreshModels: () => Promise.all([actions.refreshModels?.(), directory.load()]),
  }), [actions, directory])
  useEffect(() => { void directory.load().catch(error => actions.reportError?.(error, 'session-models')) }, [directory, actions])
  const selection = snapshot.current
  const ref = selection?.provider && selection?.model ? `${selection.provider}/${selection.model}` : undefined
  const bot = { id: sessionId, name: roster.byId?.[sessionId]?.name ?? t('this conversation'), model: ref, effort: selection?.reasoningEffort }
  const run = promise => Promise.resolve(promise).catch(error => { actions.reportError?.(error, 'session-model'); return false })
  return h('span', { className: 'bt-session-model', 'aria-busy': busy || undefined },
    h(ModelMenu, {
      bot, roster: sessionModelRoster(roster, snapshot), actions: menuActions, run, disabled: locked || busy,
      onPick: next => locked ? Promise.resolve(false) : change(next),
      onPickEffort: effort => locked || ref === undefined ? Promise.resolve(false) : change(ref, effort),
    }))
}

// One persistent model seat serves both native and team surfaces, so switching
// surfaces cannot expose two pickers or drop inline account setup. A plugin thread
// stays an ordinary Session: any inheritance that plugin applies still owns its
// policy. In particular, Omni reapplies its Bot's route when that Bot changes models.
export function conversationModelSeat({ PackModelCell, directoryFor, addressed, select }) {
  return function ConversationModelSeat(props) {
    const { sessionId, useRoster } = props
    const roster = useRoster(value => value)
    const target = modelSeatTarget(roster, sessionId, addressed(sessionId))
    if (target === 'hidden') return null
    if (target === 'bot') return h(PackModelCell, props)
    return h(NativeModelSeat, { ...props, key: sessionId, roster, directory: directoryFor(sessionId), select })
  }
}

// These controls also run with the Bot shell withdrawn. Root defaults yield to the
// shell's body-level theme; the narrowly scoped menu rules need no sidebar styles.
export const NATIVE_MODEL_CSS = `
:root{--bt-ink:var(--dsw-alias-label-primary);--bt-ink-2:var(--dsw-alias-label-secondary);--bt-ink-3:var(--dsw-alias-label-tertiary);--bt-main:var(--dsw-alias-bg-module-platform);--bt-card:var(--dsw-alias-bg-module-platform);--bt-surface:var(--dsw-alias-bg-module-platform);--bt-line:var(--dsw-alias-border-l);--bt-line-2:var(--dsw-alias-border-l);--bt-hover:var(--dsw-alias-interactive-bg-hover);--bt-accent:var(--dsw-alias-state-business-primary);--bt-danger:var(--dsw-alias-state-error-primary);--bt-font:var(--dsw-font-family,system-ui,sans-serif)}
.bt-session-model{display:inline-flex;min-width:0}
.bt-session-model .bt-model-trigger{min-height:30px;padding:2px 6px 2px 8px;background:transparent}
.bt-session-model .bt-model-copy{display:var(--dsh-composer-model-text-display,flex)}
.bt-model-menu{position:fixed;pointer-events:auto;z-index:60;min-width:200px;padding:6px;border-radius:12px;background:var(--bt-main);color:var(--bt-ink);border:.5px solid var(--bt-line-2);box-shadow:0 10px 20px -3px rgba(0,0,0,.1);display:flex;flex-direction:column;gap:2px;font-family:var(--bt-font);box-sizing:border-box}
.bt-model-menu button{display:flex;align-items:center;gap:4px;width:100%;min-height:30px;text-align:left;border:0;background:none;border-radius:6px;padding:6px 8px;font:inherit;font-size:13px;line-height:18px;color:var(--bt-ink);cursor:pointer;box-sizing:border-box}
.bt-model-menu button:hover:not(:disabled){background:var(--bt-hover)}
.bt-model-menu button:disabled{cursor:default;opacity:.6}
.bt-model-menu button svg{flex:none;width:16px;height:16px;margin:0 1px}
.bt-model-menu .bt-menu-sep{height:.5px;flex:none;background:var(--bt-line-2);margin:4px 8px}
.bt-model-menu .bt-menu-label{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
`
