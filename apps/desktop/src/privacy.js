// What the app shares. The owner's rule: send nothing usable for training a model unless the
// person switches it on; features that are not training data (Claude Code's own error reports
// and updates, spellcheck dictionaries, a stable anonymous id) work as their makers ship them.
// Each share is one switch on the Privacy page of the Bot team's settings, saved in <home>/privacy.json (the Bot team writes it; see dshEnv's
// AUTOMAGIK_PRIVACY_FILE) and applied at each launch. A share left off becomes rows that the
// overlay disables, and the environment variables that switch its sender off. The overlay goes
// to dsh as a --patch, after the person's own profile patch, so nothing in that patch turns a
// share on behind the page's back. DSH's own opt-out is DSH_TELEMETRY_DISABLED; no DSH package
// reads DO_NOT_TRACK.
import { readFileSync, writeFileSync } from 'node:fs'

/** The shares, by the key the Privacy page saves: the dsh rows and the environment that keep each off. */
export const SHARES = Object.freeze({
  // Every request to a DeepSeek model also carries the Session log and the plugins installed.
  // Training data: off unless switched on.
  'deepseek-session-log': { on: false, rows: ['session-log-deepseek', 'plugin-package-inventory-deepseek'] },
  // A rated message, or /feedback, uploads the whole Session to DeepSeek's collector.
  'deepseek-feedback': { on: false, rows: ['session-telemetry-otel'], env: { DSH_TELEMETRY_DISABLED: '1' } },
  // Claude Code's error reports, and its other optional traffic, to Anthropic.
  'claude-errors': { on: true, env: { DISABLE_ERROR_REPORTING: '1', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' } },
  // Chromium's spellcheck dictionaries, from Google (Linux and Windows; macOS checks locally).
  spellcheck: { on: true },
  // DSH's anonymous id on DeepSeek requests, kept across launches instead of a new one each time.
  'stable-id': { on: true },
})

// Never on, whatever was chosen: DSH desktop's product analytics, and the CLIs' own analytics.
const ALWAYS_OFF_ROWS = ['product-analytics', 'desktop-product-telemetry']
const ALWAYS_OFF_ENV = { DO_NOT_TRACK: '1', DISABLE_TELEMETRY: '1', OPENUI_TELEMETRY_DISABLED: '1', npm_config_update_notifier: 'false' }

/** Each share's default (SHARES `on`), the choices of a person who has chosen nothing. */
export const DEFAULTS = Object.freeze(Object.fromEntries(Object.entries(SHARES).map(([key, share]) => [key, share.on === true])))

/** The person's choices from `file`, `{ [share]: boolean }`: what they switched, else each default. */
export function readChoices(file, read = readFileSync) {
  let saved
  try {
    saved = JSON.parse(read(file, 'utf8'))?.share
  } catch {
    saved = undefined
  }
  return Object.fromEntries(Object.keys(SHARES).map(key => [key, typeof saved?.[key] === 'boolean' ? saved[key] : DEFAULTS[key]]))
}

/** The dsh overlay for `choices`: a disabled row for every row of a share left off. */
export function overlayOf(choices = {}) {
  const rows = [...ALWAYS_OFF_ROWS, ...Object.entries(SHARES).filter(([key]) => choices[key] !== true).flatMap(([, share]) => share.rows ?? [])]
  return `# Written by Automagik at each launch from the Privacy page (privacy.json); edits here are replaced.\n${rows.map(id => `- id: ${id}\n  disabled: true\n`).join('')}`
}

/** The environment that keeps every share left off from sending. */
export function privacyEnv(choices = {}) {
  return Object.assign({}, ALWAYS_OFF_ENV, ...Object.entries(SHARES).filter(([key]) => choices[key] !== true).map(([, share]) => share.env ?? {}))
}

/** Writes the overlay for `choices` to `file` and answers its path. */
export function writeOverlay(file, choices, write = writeFileSync) {
  write(file, overlayOf(choices))
  return file
}
