// The Privacy page's choices: which shares the person switched on, in the file the Automagik
// desktop app names in AUTOMAGIK_PRIVACY_FILE (apps/desktop src/privacy.js applies them at its
// next launch). Elsewhere (a dsh in a terminal, a browser on a remote host) there is no such
// file and the page says the app is not managing privacy here. Everything starts off.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

// The desktop app's shares, by the keys it reads; a key it does not know is never written.
export const SHARES = Object.freeze(['deepseek-session-log', 'deepseek-feedback', 'claude-errors', 'spellcheck', 'stable-id'])

export function createPrivacy({ env = process.env } = {}) {
  const file = env.AUTOMAGIK_PRIVACY_FILE?.trim() || null
  const read = () => {
    if (!file) return {}
    try {
      const share = JSON.parse(readFileSync(file, 'utf8'))?.share ?? {}
      return Object.fromEntries(SHARES.map(key => [key, share[key] === true]))
    } catch {
      return {}
    }
  }
  const view = () => ({ managed: file !== null, share: { ...Object.fromEntries(SHARES.map(key => [key, false])), ...read() } })
  function set(key, on) {
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
