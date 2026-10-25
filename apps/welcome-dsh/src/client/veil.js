import { call } from './api.js'

// DSH draws its main view first and mounts onboarding only once the Sessions have loaded and
// the main one is blank, so a fresh install flashed the Bot team before the welcome. In the
// desktop app (window.omniDesktop, src/preload.cjs), where a fresh install always starts in
// this welcome, the welcome's own table covers that frame from the moment the plugin applies,
// and lifts when a step (or another plugin's onboarding dialog) is up, when the host says the
// companion and team steps are behind the person, or after VEIL_MS at the latest.
export const VEIL_MS = 5000
const FADE_MS = 200

export function installVeil({ doc = globalThis.document, scope = globalThis, request = call, wait = VEIL_MS, observe = (target, onChange) => {
  const observer = new MutationObserver(onChange)
  observer.observe(target, { childList: true })
  return () => observer.disconnect()
} } = {}) {
  if (scope.omniDesktop === undefined || doc?.body == null) return () => {}
  const veil = doc.createElement('div')
  veil.className = 'oai-overlay oai-veil'
  veil.setAttribute('aria-hidden', 'true')
  doc.body.append(veil)
  let lifted = false
  let stop = () => {}
  let timer
  const lift = () => {
    if (lifted) return
    lifted = true
    stop()
    clearTimeout(timer)
    veil.classList.add('oai-veil-out')
    setTimeout(() => veil.remove(), FADE_MS)
  }
  const dialogUp = () => doc.querySelector('[aria-modal="true"]:not(.oai-veil)') !== null
  stop = observe(doc.body, () => { if (dialogUp()) lift() })
  timer = setTimeout(lift, wait)
  request('state').then((state) => { if (state?.companionDone === true && state?.teamDone === true) lift() }, lift)
  return () => { lift(); veil.remove() }
}
