// A DSH bot, new or edited: a plain dsh entry with a name, the project folder its Sessions
// start in (the team workspace when none) and the DSH agent preset they run (DSH's default
// when none). A change applies to the Sessions made after it (agents.js).
import { createElement as h, Fragment, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { FolderMenu } from './folder-menu.js'
import { CheckIcon, ChevronLeftIcon, CloseIcon } from './icons.js'
import { BotMark } from './mark.js'
import { DSH_LOOK } from './characters.js'
import { Caret, useAnchoredMenu } from './model-menu.js'
import { hostText, t } from './i18n.js'

// The DSH agent presets, in the folder menu's shape; '' is DSH's default.
function PresetMenu({ value, options, onPick }) {
  const { isOpen, shownPlace, leaving, button, menu, open, close } = useAnchoredMenu()
  const current = options.find(entry => entry.id === value)
  const item = (id, label, note) => h('button', { key: id || 'default', type: 'button', role: 'menuitemradio', 'aria-checked': id === value, onClick: () => { close(); onPick(id) } },
    h('span', { className: 'bt-folder-copy' }, h('span', { className: 'bt-menu-label' }, label), note ? h('span', { className: 'bt-folder-path' }, note) : null),
    h('span', { className: 'bt-model-tick', 'aria-hidden': true }, id === value ? h(CheckIcon) : null))
  return h(Fragment, null,
    h('button', {
      ref: button, type: 'button', className: 'bt-model-trigger', 'data-wide': true, 'aria-haspopup': 'menu', 'aria-expanded': isOpen,
      'aria-label': t('Preset'), onClick: () => (isOpen ? close() : open()),
    },
    h('span', { className: 'bt-model-copy' }, h('span', { className: 'bt-model-name' }, current?.name ?? (value || t('DSH default')))),
    h(Caret)),
    shownPlace ? createPortal(h('div', { ref: menu, className: `bt-menu bt-model-menu bt-folder-menu${shownPlace.bottom !== undefined ? ' bt-menu-up' : ''}`, role: 'menu', 'aria-label': t('Preset'), style: shownPlace, 'data-leaving': leaving || undefined },
      h('div', { className: 'bt-folder-view' },
        item('', t('DSH default')),
        options.map(entry => item(entry.id, entry.name ?? entry.id, entry.description)))), document.body) : null)
}

export function DshBotForm({ agent, actions, onBack, onDone }) {
  const [name, setName] = useState(agent?.name ?? '')
  const [folder, setFolder] = useState(agent?.workDir ?? '')
  const [preset, setPreset] = useState(agent?.profile ?? '')
  const [presets, setPresets] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    let live = true
    void Promise.resolve(actions.agentPresets()).then(list => live && setPresets(list ?? [])).catch(() => live && setPresets([]))
    return () => { live = false }
  }, [])
  const run = promise => Promise.resolve(promise).catch(failure => setError(failure?.message ?? String(failure)))
  const save = async () => {
    if (busy || name.trim() === '') return
    setBusy(true)
    setError('')
    try {
      const fields = { name: name.trim(), workDir: folder, profile: preset }
      onDone(agent ? await actions.updateAgent(agent.id, fields) : await actions.addAgent(fields))
    } catch (failure) {
      setError(failure?.message ?? String(failure))
    } finally {
      setBusy(false)
    }
  }
  // A preset gone from this DSH stays listed while it is the saved one.
  const listed = presets ?? []
  const options = preset && !listed.some(entry => entry.id === preset) ? [...listed, { id: preset, name: preset }] : listed
  const title = agent ? t('Edit {name}', { name: agent.name }) : t('New DSH bot')
  return h('div', { className: 'bt-create', role: 'dialog', 'aria-label': title },
    h('div', { className: 'bt-create-head' },
      onBack ? h('button', { type: 'button', className: 'bt-icon-btn', 'aria-label': t('Back to new chat'), onClick: onBack }, h(ChevronLeftIcon)) : h('span'),
      h('span', { className: 'bt-create-title' }, title),
      h('button', { type: 'button', className: 'bt-icon-btn', 'aria-label': t('Close'), onClick: () => actions.closeOverlay() }, h(CloseIcon))),
    h('div', { className: 'bt-create-body' },
      h('div', { className: 'bt-create-card' },
        h('div', { className: 'bt-create-preview' },
          h('span', { className: 'bt-agent-ava bt-dsh-ava', 'aria-hidden': true }, h(BotMark, { bot: { id: agent?.id ?? 'new-dsh-bot' }, look: DSH_LOOK, size: 32 }))),
        h('label', { className: 'bt-field' },
          h('span', { className: 'bt-field-label' }, t('Name')),
          h('input', {
            className: 'bt-input', value: name, autoFocus: true, maxLength: 40, placeholder: t('Website'),
            onChange: event => setName(event.target.value),
            onKeyDown: (event) => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) void save() },
          })),
        h('div', { className: 'bt-field' },
          h('span', { className: 'bt-field-label' }, t('Project folder')),
          h(FolderMenu, { value: folder || undefined, actions, run, onPick: path => { setError(''); setFolder(path) }, wide: true })),
        h('div', { className: 'bt-field' },
          h('span', { className: 'bt-field-label' }, t('Preset')),
          h(PresetMenu, { value: preset, options, onPick: setPreset })),
        h('span', { className: 'bt-note' }, t('Its sessions are plain DSH sessions in this folder, without the team tools.')),
        error ? h('div', { className: 'bt-error', role: 'alert', style: { padding: 0 } }, hostText(error)) : null,
        h('div', { className: 'bt-create-foot' },
          h('button', { type: 'button', className: 'bt-soft', onClick: onBack ?? (() => actions.closeOverlay()) }, onBack ? t('Back') : t('Cancel')),
          h('button', { type: 'button', className: 'bt-send bt-create-go', disabled: busy || name.trim() === '', onClick: () => void save() },
            busy ? (agent ? t('Saving…') : t('Creating…')) : agent ? t('Save') : t('Create'))))))
}
