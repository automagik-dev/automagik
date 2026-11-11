import { createElement as h, useEffect, useState } from 'react'
import { call as api } from './api.js'
import { Row, Switch } from './bot-settings.js'
import { t } from './i18n.js'

export function HermesRemoteSettings({ run, Section }) {
  const [view, setView] = useState(null)
  const [address, setAddress] = useState('')
  const [profile, setProfile] = useState('')
  const [credential, setCredential] = useState('')
  const [replacing, setReplacing] = useState(false)
  const [enabled, setEnabled] = useState(false)
  const [reconciliation, setReconciliation] = useState(null)
  const update = next => { setView(next); setAddress(next.address); setProfile(next.profile); setEnabled(next.enabled) }
  useEffect(() => { void run(api('hermes-remote').then(update)) }, [])
  const save = () => run(api('hermes-remote-configure', { address, profile, enabled, credential }).then(next => { setCredential(''); setReplacing(false); update(next) }))
  if (!view) return null
  return h(Section, null,
    h('div', { className: 'bt-set-row' }, h('div', { className: 'bt-set-copy' },
      h('span', { className: 'bt-set-hint' }, t('Chat with a Hermes agent on another computer.')),
      h('span', { className: 'bt-set-hint' }, t('Its own tools run there under its own rules; this computer’s sandbox does not protect that machine.')),
      h('span', { className: 'bt-set-hint' }, t('Your bots’ team tools (messages to other bots, secrets, memory, schedules) are not available in these chats.')))),
    h(Row, { label: t('Address'), stack: true }, h('input', { className: 'bt-input', 'aria-label': t('Address'), value: address, autoComplete: 'off', onChange: event => setAddress(event.target.value) })),
    h(Row, { label: t('Profile'), stack: true }, h('input', { className: 'bt-input', 'aria-label': t('Profile'), value: profile, autoComplete: 'off', onChange: event => setProfile(event.target.value) })),
    h(Row, { label: t('Credential'), stack: true, hint: view.credentialSet ? undefined : t('Save a credential to connect.') },
      view.credentialSet && !replacing
        ? h('div', { className: 'bt-set-row' }, h('span', { role: 'status', className: 'bt-set-hint' }, t('Key saved')),
          h('button', { type: 'button', className: 'bt-soft bt-soft-sm', onClick: () => setReplacing(true) }, t('Replace')))
        : h('input', { className: 'bt-input', type: 'password', 'aria-label': t('Credential'), value: credential, autoComplete: 'new-password', spellCheck: false, onChange: event => setCredential(event.target.value) })),
    h('div', { className: 'bt-set-row' }, h('span', { className: 'bt-set-copy' }, t('Enable Remote Hermes')),
      h(Switch, { on: enabled, label: t('Enable Remote Hermes'), onChange: setEnabled })),
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
      h('pre', null, (reconciliation.messages ?? []).map(message => `${message.role}: ${typeof message.text === 'string' ? message.text : typeof message.content === 'string' ? message.content : ''}`).join('\n')),
      reconciliation.inflight?.assistant ? h('p', null, reconciliation.inflight.assistant) : null) : null)
}
