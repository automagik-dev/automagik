import { createElement as h, useEffect, useState } from 'react'
import { call as api } from './api.js'
import { MaskedInput } from './secret-card.js'
import { Row, Switch } from './bot-settings.js'
import { t } from './i18n.js'

export function HermesRemoteSettings({ run, Section }) {
  const [view, setView] = useState(null)
  const [address, setAddress] = useState('')
  const [profile, setProfile] = useState('')
  const [credential, setCredential] = useState('')
  const [enabled, setEnabled] = useState(false)
  const [reconciliation, setReconciliation] = useState(null)
  const update = next => { setView(next); setAddress(next.address); setProfile(next.profile); setEnabled(next.enabled) }
  useEffect(() => { void run(api('hermes-remote').then(update)) }, [])
  const save = () => run(api('hermes-remote-configure', { address, profile, enabled, credential }).then(next => { setCredential(''); update(next) }))
  if (!view) return null
  return h(Section, { title: t('Hermes remote') },
    h('div', { className: 'bt-set-row' }, h('div', { className: 'bt-set-copy' },
      h('span', { className: 'bt-set-hint' }, t('Off by default. Connect to standalone Desktop contract 8 through hermes serve.')),
      h('span', { className: 'bt-set-hint' }, t('No DSH team tools: message_bot, list_bots, create_bot, request_secret, memory or schedules.')),
      h('span', { className: 'bt-set-hint' }, t('Remote tools use the remote profile’s rules. DSH’s local sandbox does not protect the remote machine.')))),
    h(Row, { label: t('Address'), stack: true }, h('input', { className: 'bt-input', 'aria-label': t('Address'), value: address, autoComplete: 'off', onChange: event => setAddress(event.target.value) })),
    h(Row, { label: t('Profile'), stack: true }, h('input', { className: 'bt-input', 'aria-label': t('Profile'), value: profile, autoComplete: 'off', onChange: event => setProfile(event.target.value) })),
    h(Row, { label: t('Credential'), stack: true, hint: view.credentialSet ? t('Credential saved in the Bot secret store.') : t('Save a credential to connect.') },
      h('span', { className: 'bt-q-field bt-secret-field' }, h(MaskedInput, { value: credential, onChange: setCredential, label: t('Credential') }))),
    h('div', { className: 'bt-set-row' }, h('span', { className: 'bt-set-copy' }, t('Enable Hermes remote')),
      h(Switch, { on: enabled, label: t('Enable Hermes remote'), onChange: setEnabled })),
    h('div', { className: 'bt-set-row' },
      h('button', { type: 'button', className: 'bt-soft bt-soft-sm', onClick: save }, t('Save')),
      h('button', { type: 'button', className: 'bt-soft bt-soft-sm', disabled: !view.enabled, onClick: () => run(api('hermes-remote-discover').then(update)) }, t('Discover models')),
      h('span', { className: 'bt-set-hint' }, t('{count} models', { count: view.models.length }))),
    view.sessions.filter(session => session.uncertain || session.pendingSubmit).map(session => h('div', { key: session.sessionId },
      h('p', { role: 'status' }, t('Connection lost; remote outcome unknown')),
      h('button', { type: 'button', className: 'bt-soft bt-soft-sm', onClick: () => run(api('hermes-remote-reconcile', { sessionId: session.sessionId }).then(next => { update(next); setReconciliation(next.reconciliation) })) }, t('Reconnect and reconcile')))),
    reconciliation ? h('div', { role: 'status', className: 'bt-set-hint' },
      reconciliation.unknown ? t('Connection lost; remote outcome unknown') : t('Remote session reconciled. Review the remote transcript before sending again.'),
      reconciliation.gap ? h('p', null, t('Replay gap: showing a fresh remote snapshot.')) : null,
      h('pre', null, (reconciliation.messages ?? []).map(message => `${message.role}: ${typeof message.content === 'string' ? message.content : ''}`).join('\n')),
      reconciliation.inflight?.assistant ? h('p', null, reconciliation.inflight.assistant) : null) : null)
}
