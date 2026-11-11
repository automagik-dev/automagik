import { createElement as h, useEffect, useState } from 'react'
import { t } from './i18n.js'

export function AgentAccessPage({ actions, run, Section, Row }) {
  const [view, setView] = useState(null)
  const [name, setName] = useState('')
  const [token, setToken] = useState(null)
  const [busy, setBusy] = useState(false)
  const refresh = () => actions.agentAccess().then(setView)
  useEffect(() => { void run(refresh()) }, [])
  const perform = fn => {
    setBusy(true)
    return run(fn().then(refresh).finally(() => setBusy(false)))
  }
  return h('div', null,
    h(Section, { title: t('Agent access') },
      h(Row, { label: t('Allow an outside agent to read and configure your space'),
        hint: t(
          'Tokens can read chats and manage Bots with your rights. Keep them private.'),
      }),
      h(Row, { label: t('MCP address'),
        hint: view?.url ?? t('Create a token to start access.') }),
      h(Row, { label: t('Web instance path'), hint: view?.webPath ?? '/api/omni-mcp' }),
      h(Row, { label: t('Token name') },
        h('input', { className: 'bt-input', value: name, maxLength: 60,
          'aria-label': t('Token name'), placeholder: t('My agent'),
          onChange: event => setName(event.target.value) })),
      h(Row, { label: t('Create a named token') },
        h('button', { type: 'button', className: 'bt-soft bt-soft-sm',
          disabled: busy || !/^[\w .-]{1,60}$/.test(name),
          onClick: () => perform(async () => {
            setToken(null)
            const result = await actions.agentTokenCreate(name)
            setToken(result.token)
            setName('')
          }) }, t('Create token'))),
      token ? h('div', { className: 'bt-set-row', role: 'status' },
        h('div', { className: 'bt-set-copy' },
          h('p', null, t('Copy this token now. It will not be shown again.')),
          h('code', { style: { overflowWrap: 'anywhere' } }, token),
          h('button', { type: 'button', className: 'bt-soft bt-soft-sm',
            onClick: () => setToken(null) }, t('Done')))) : null,
      view?.tokens.map(row => h(Row, { key: row.id, label: row.name,
        hint: row.revokedAt === undefined ? t('Active') : t('Revoked') },
      row.revokedAt === undefined ? h('button', { type: 'button',
        className: 'bt-soft bt-soft-sm', disabled: busy,
        onClick: () => perform(async () => {
          await actions.agentTokenRevoke(row.id)
          setToken(null)
        }) }, t('Revoke')) : null))),
    h(Section, { title: t('Agent activity') },
      h(Row, { label: t('Recent calls'),
        hint: t('Latest 200 audit records. Refresh to see new calls.') },
        h('button', { type: 'button', className: 'bt-soft bt-soft-sm', disabled: busy,
          onClick: () => run(refresh()) }, t('Refresh'))),
      view?.audit.slice().reverse().map((entry, index) => h('div', {
        key: `${entry.callId}-${index}`, className: 'bt-set-row',
      }, h('div', { className: 'bt-set-copy' },
      h('span', null, `${entry.tokenName} · ${entry.action} · ${entry.outcome}`),
      h('span', { className: 'bt-set-hint' },
        `${new Date(entry.time).toLocaleString()}${entry.target ? ` · ${entry.target}` : ''}`),
      entry.changes ? h('pre', { style: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } },
        JSON.stringify(entry.changes, null, 2)) : null)))))
}
