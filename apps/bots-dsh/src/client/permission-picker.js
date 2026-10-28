import { createElement as h, Fragment, useEffect, useRef, useState } from 'react'
import { AUTO } from '../shared/permission-levels.js'
import { Segmented } from './motion.js'
import { t } from './i18n.js'

const LABELS = { 'read-only': 'Read only', 'workspace-write': 'Workspace', 'danger-full-access': 'Full access', [AUTO]: 'Auto review' }
const DANGER = new Set(['danger-full-access'])

export const presetDanger = value => DANGER.has(value)
export const presetName = (value, catalog) => (LABELS[value] ? t(LABELS[value]) : catalog?.options?.find(option => option.value === value)?.name ?? value)

// A saved Auto that runs as workspace-write where Auto cannot hold (`permissionFallback`).
export const PermissionFallback = ({ fallback }) => (fallback ? h('div', { className: 'bt-note' }, t('Runs as Workspace Write here')) : null)

// The presets DeepSeek Harness offers, as one segmented choice; Auto review only while
// DSH offers it. A pick shows at once and holds until the saved value catches up, or
// falls back when `onPick` resolves false. `repick` lets the shown preset be picked
// again. Auto review is experimental: picking it asks once before it is sent.
export function PermissionPicker({ catalog, saved, onPick, repick = false }) {
  const [pending, setPending] = useState(null)
  const [confirming, setConfirming] = useState(false)
  // One save runs at a time. A pick made while one is in flight waits as `latest`
  // (newer ones overwrite it), so a request that settles cannot clear or reorder a
  // pick made after it; two saves never land out of order on the server.
  const flight = useRef({ value: undefined, latest: undefined })
  useEffect(() => {
    const flying = flight.current.value
    if (pending === saved && (flying === undefined || flying === pending)) setPending(null)
  }, [pending, saved])
  const send = (value) => {
    flight.current.value = value
    void Promise.resolve(onPick(value)).then(done => done !== false, () => false).then((ok) => {
      const wanted = flight.current.latest
      flight.current.latest = undefined
      if (wanted !== undefined && !(wanted === value && ok)) { send(wanted); return }
      flight.current.value = undefined
      if (!ok) setPending(null)
    })
  }
  const current = pending ?? saved
  const pick = (value, confirmed = false) => {
    if (value === current && !repick) return
    if (value === AUTO && !confirmed) { setConfirming(true); return }
    setConfirming(false)
    setPending(value)
    if (flight.current.value !== undefined) { flight.current.latest = value; return }
    send(value)
  }
  const choice = h(Segmented, { label: t('Permissions'), value: current },
    catalog.options.map(option => h('button', {
      key: option.value, type: 'button', 'aria-pressed': option.value === current,
      title: option.description, onClick: () => pick(option.value),
      className: presetDanger(option.value) ? 'bt-perm-danger' : undefined,
    }, presetName(option.value, catalog), option.value === AUTO ? h('span', { className: 'bt-perm-exp' }, t('Experimental')) : null)))
  if (!confirming) return choice
  return h(Fragment, null, choice,
    h('div', { className: 'bt-perm-confirm', role: 'alert' },
      h('span', { className: 'bt-note' }, t('Auto review runs tools without a sandbox: a model reviews each call first, and you decide on the ones it stops. It is experimental, can let through or stop the wrong call, and uses more tokens.')),
      h('button', { type: 'button', className: 'bt-soft bt-soft-sm', onClick: () => pick(AUTO, true) }, t('Use Auto review')),
      h('button', { type: 'button', className: 'bt-soft bt-soft-sm', onClick: () => setConfirming(false) }, t('Cancel'))))
}
