import { createElement as h, useEffect, useState } from 'react'
import { t } from './i18n.js'

// -------------------------------------------------------------------------
// The Automagik desktop app's own update, at the bottom of the sidebar above the account and
// Channels, where DSH's own desktop app shows its update (DesktopUpdateIndicator beside its
// settings). The app hands it over in its preload (`omniDesktop.updates`: status, open,
// subscribe, in DSH desktop's phases); in a browser, or a desktop build without it, nothing
// shows. Clicking restarts into a downloaded update, opens the release page of one this copy
// cannot install, or checks again after a failed check.

const BUSY = new Set(['checking', 'downloading', 'installing'])

/** The pill for one presentation: { label, busy, primary }, or null when there is nothing to say. */
export function updatePill(state) {
  const version = state?.version
  switch (state?.phase) {
    case 'checking': return { label: t('Checking for updates…'), busy: true }
    case 'available': return { label: version ? t('Automagik {version} is out', { version }) : t('An update is out'), primary: true }
    case 'downloading': return { label: t('Updating · {percent}%', { percent: state.percent ?? 0 }), busy: true }
    case 'ready': return { label: version ? t('Restart to update to {version}', { version }) : t('Restart to update'), primary: true }
    case 'installing': return { label: t('Installing the update…'), busy: true }
    case 'error': return { label: t('Update check failed · Retry') }
    default: return null
  }
}

export function DesktopUpdate() {
  const bridge = globalThis.omniDesktop?.updates
  const [state, setState] = useState(null)
  useEffect(() => {
    if (!bridge) return undefined
    let live = true
    let heard = false
    const off = bridge.subscribe((next) => { heard = true; if (live) setState(next) })
    bridge.status().then((next) => { if (live && !heard) setState(next) }, () => {})
    return () => { live = false; off?.() }
  }, [bridge])
  const pill = updatePill(state)
  if (!bridge || !pill) return null
  const busy = BUSY.has(state.phase)
  return h('button', {
    type: 'button',
    className: `bt-desk-update${pill.primary ? ' bt-desk-update-go' : ''}`,
    'aria-busy': busy || undefined,
    disabled: busy,
    onClick: () => { void bridge.open().catch(() => {}) },
  },
  h('span', { className: 'bt-desk-update-dot', 'aria-hidden': true }),
  h('span', { className: 'bt-desk-update-label' }, pill.label),
  state.phase === 'downloading' ? h('span', { className: 'bt-desk-update-bar', 'aria-hidden': true }, h('i', { style: { width: `${state.percent ?? 0}%` } })) : null)
}

export const DESKTOP_UPDATE_CSS = `
[class*="_footArea"]>[class*="_footerActions"]>div:has(>.bt-desk-update){grid-column:1/-1;order:-1}
.bt-desk-update{position:relative;display:flex;align-items:center;gap:8px;width:100%;min-height:32px;padding:6px 12px;border:1px solid color-mix(in srgb,var(--bt-accent) 25%,transparent);border-radius:12px;background:color-mix(in srgb,var(--bt-accent) 8%,var(--bt-card));color:var(--bt-accent);font:600 12px/16px var(--bt-font);text-align:left;cursor:pointer;overflow:hidden}
.bt-desk-update:hover:not(:disabled){background:color-mix(in srgb,var(--bt-accent) 14%,var(--bt-card))}
.bt-desk-update:disabled{cursor:default}
.bt-desk-update-go{background:var(--bt-accent);color:var(--bt-accent-ink);border-color:transparent}
.bt-desk-update-go:hover:not(:disabled){background:color-mix(in srgb,var(--bt-accent) 88%,var(--bt-ink))}
.bt-desk-update-dot{flex:none;width:7px;height:7px;border-radius:50%;background:currentColor}
.bt-desk-update[aria-busy] .bt-desk-update-dot{animation:bt-desk-pulse 1.2s ease-in-out infinite}
.bt-desk-update-label{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bt-desk-update-bar{position:absolute;left:0;right:0;bottom:0;height:2px;background:color-mix(in srgb,var(--bt-accent) 18%,transparent)}
.bt-desk-update-bar i{display:block;height:100%;background:var(--bt-accent);transition:width .3s ease}
@keyframes bt-desk-pulse{50%{opacity:.35}}
@media (prefers-reduced-motion:reduce){.bt-desk-update[aria-busy] .bt-desk-update-dot{animation:none}}
`
