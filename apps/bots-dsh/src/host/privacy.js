// The Privacy page's choices: which shares the person switched on, in the file the Automagik
// desktop app names in AUTOMAGIK_PRIVACY_FILE (apps/desktop src/privacy.js applies them at its
// next launch). Elsewhere (a dsh in a terminal, a browser on a remote host) there is no such
// file and the page says the app is not managing privacy here. In Unfold's own instance
// (AUTOMAGIK_HOST=unfold) Unfold's Privacy settings decide, and the page has no switch. What
// could train a model starts off; the rest starts on (DEFAULTS, the same as the app's).
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { inUnfoldHost } from './constants.js'

// The desktop app's shares, by the keys it reads; a key it does not know is never written.
export const SHARES = Object.freeze(['deepseek-session-log', 'deepseek-feedback', 'claude-errors', 'spellcheck', 'stable-id'])
export const DEFAULTS = Object.freeze({ 'deepseek-session-log': false, 'deepseek-feedback': false, 'claude-errors': true, spellcheck: true, 'stable-id': true })

export function createPrivacy({ env = process.env } = {}) {
  const unfold = inUnfoldHost(env)
  const file = unfold ? null : env.AUTOMAGIK_PRIVACY_FILE?.trim() || null
  const read = () => {
    let share = {}
    if (file) {
      try { share = JSON.parse(readFileSync(file, 'utf8'))?.share ?? {} } catch { share = {} }
    }
    return Object.fromEntries(SHARES.map(key => [key, typeof share[key] === 'boolean' ? share[key] : DEFAULTS[key]]))
  }
  const view = () => ({ managed: file !== null, ...(unfold ? { host: 'unfold' } : {}), share: read() })
  function set(key, on) {
    if (unfold) throw Object.assign(new Error('Privacy is managed by Unfold'), { code: 'bot/unavailable' })
    if (!file) throw Object.assign(new Error('Privacy is managed by the Automagik desktop app'), { code: 'bot/unavailable' })
    if (!SHARES.includes(key)) throw Object.assign(new Error('Unknown share'), { code: 'bot/invalid' })
    const share = { ...read(), [key]: on === true }
    mkdirSync(dirname(file), { recursive: true })
    const next = `${file}.${process.pid}.tmp`
    writeFileSync(next, `${JSON.stringify({ share }, null, 2)}\n`)
    renameSync(next, file)
    return view()
  }
  return { view, set }
}
