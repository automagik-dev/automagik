import { createElement as h, Fragment, useState } from 'react'
import { createPortal } from 'react-dom'
import { CheckIcon } from './icons.js'
import { Caret, useAnchoredMenu } from './model-menu.js'
import { hostText, t } from './i18n.js'

// -------------------------------------------------------------------------
// The model menu of a Bot whose plugin owns it (the host's host-models.js): the entries
// and levels come only from that plugin, as the state's `hostModels[botId]`; nothing is
// added here. Each row says where a message goes; the tick is the pick, "Answering now"
// marks another row while it still answers (a switch waiting for the reply, a fallback).

// Where a message goes, from the entry's facts.
export function privacyText(privacy) {
  const device = t(privacy?.device ?? 'computer')
  switch (privacy?.kind) {
    case 'local': return t('Stays on this {device}.', { device })
    case 'direct': return privacy.memories
      ? t('Your message and the memories recalled for it go to {provider}.', { provider: privacy.provider ?? '' })
      : t('Your message goes to {provider}.', { provider: privacy.provider ?? '' })
    case 'relay': return t('Your message goes to {provider} through {via}; memories stay on this {device}.', { provider: privacy.provider ?? '', via: privacy.via ?? '', device })
    default: return undefined
  }
}

// What a pick that has not taken over yet says.
export function statusText(menu) {
  switch (menu?.status?.kind) {
    case 'after-reply': return t('Switching after this reply…')
    case 'switching': return t('Switching…')
    case 'fallback': return menu.status.answering ? t('{model} answers for now', { model: menu.status.answering }) : undefined
    default: return undefined
  }
}

// Entries in their groups, in the order the plugin lists them.
export function hostGroups(entries) {
  const groups = new Map()
  for (const entry of entries ?? []) {
    const group = entry.group ?? ''
    if (!groups.has(group)) groups.set(group, [])
    groups.get(group).push(entry)
  }
  return [...groups]
}

export function HostModelMenu({ bot, roster, actions, run, wide = false, link = false }) {
  const { isOpen, shownPlace, leaving, button, menu, open, close } = useAnchoredMenu()
  const [confirming, setConfirming] = useState(null)
  const host = roster.hostModels?.[bot.id] ?? { entries: [] }
  const entries = host.entries ?? []
  const current = entries.find(entry => entry.current)
  const levels = current?.levels ?? []
  const level = levels.find(entry => entry.id === host.level)
  const status = statusText(host)
  const toggle = () => {
    if (isOpen) { close(); return }
    setConfirming(null)
    // The plugin's engine can change its list at any time, so opening asks again.
    void actions?.refreshModels?.()
    open()
  }
  // An entry marked `confirm` asks once more: the first press shows "Confirm" on its row,
  // the second sends the pick with the person's ack.
  const pick = (entry) => {
    if (entry.current) { close(); return }
    const ack = entry.confirm === true && confirming === entry.id
    if (entry.confirm && !ack) { setConfirming(entry.id); return }
    close()
    void run(actions.updateBot(bot.id, { model: entry.id, ...(ack ? { ack: true } : {}) }))
  }
  const pickLevel = (id) => {
    close()
    if (id !== host.level) void run(actions.updateBot(bot.id, { effort: id }))
  }
  const second = status ?? [current?.group, level ? t(level.name) : undefined].filter(Boolean).join(' · ')
  return h(Fragment, null,
    link ? h('button', {
      ref: button, type: 'button', className: 'bt-model-change', 'aria-haspopup': 'menu', 'aria-expanded': isOpen,
      'aria-label': t('Change the model of {name}', { name: bot.name }), onClick: toggle,
    }, t('change')) : h('button', {
      ref: button, type: 'button', className: 'bt-model-trigger', 'data-wide': wide || undefined, 'data-host': '',
      'aria-haspopup': 'menu', 'aria-expanded': isOpen, 'aria-label': t('Model: {model}', { model: current?.label ?? t('none') }),
      onClick: toggle,
    },
    h('span', { className: 'bt-model-copy' },
      h('span', { className: 'bt-model-name' }, current?.label ?? t('Choose a model')),
      second ? h('span', { className: 'bt-model-provider' }, second) : null),
    h(Caret)),
    shownPlace ? createPortal(h('div', { ref: menu, className: `bt-menu bt-model-menu${shownPlace.bottom !== undefined ? ' bt-menu-up' : ''}`, role: 'menu', 'aria-label': t('Model for {name}', { name: bot.name }), style: shownPlace, 'data-leaving': leaving || undefined },
      status ? h('div', { className: 'bt-host-model-status', role: 'status' }, status) : null,
      host.error ? h('div', { className: 'bt-model-none', role: 'alert' }, hostText(host.error))
        : entries.length === 0 ? h('div', { className: 'bt-model-none' }, t('Loading…')) : null,
      hostGroups(entries).map(([group, list]) => h(Fragment, { key: group },
        group ? h('div', { className: 'bt-model-group', role: 'presentation' }, group) : null,
        list.map((entry) => {
          const detail = privacyText(entry.privacy)
          return h('button', {
            key: entry.id, type: 'button', role: 'menuitemradio', 'aria-checked': entry.current === true, title: entry.id,
            onClick: () => pick(entry),
          },
          h('span', { className: 'bt-host-model-copy' },
            h('span', { className: 'bt-menu-label' }, entry.label),
            detail ? h('span', { className: 'bt-host-model-detail' }, detail) : null),
          entry.answering && !entry.current ? h('span', { className: 'bt-menu-hint' }, t('Answering now')) : null,
          confirming === entry.id ? h('span', { className: 'bt-host-model-confirm' }, t('Confirm')) : null,
          h('span', { className: 'bt-model-tick', 'aria-hidden': true }, entry.current ? h(CheckIcon) : null))
        }))),
      levels.length > 0 ? h(Fragment, null,
        h('div', { className: 'bt-menu-sep', role: 'separator' }),
        h('div', { className: 'bt-model-group', role: 'presentation' }, t('Thinking level')),
        levels.map(entry => h('button', {
          key: entry.id, type: 'button', role: 'menuitemradio', 'aria-checked': entry.id === host.level,
          onClick: () => pickLevel(entry.id),
        },
        h('span', { className: 'bt-menu-label' }, t(entry.name)),
        h('span', { className: 'bt-model-tick', 'aria-hidden': true }, entry.id === host.level ? h(CheckIcon) : null)))) : null), document.body) : null)
}
