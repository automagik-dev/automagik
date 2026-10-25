// What the app shares, which is nothing unless the person chooses otherwise (the owner: "don't
// send anything to anyone, even us"). Each share is one switch on the Privacy page of the Bot
// team's settings, saved in <home>/privacy.json (the Bot team writes it; see dshEnv's
// AUTOMAGIK_PRIVACY_FILE) and applied at each launch. A share left off becomes rows that the
// overlay disables, and the environment variables that switch its sender off. The overlay goes
// to dsh as a --patch, after the person's own profile patch, so nothing in that patch turns a
// share on behind the page's back. DSH's own opt-out is DSH_TELEMETRY_DISABLED; no DSH package
// reads DO_NOT_TRACK.
import { readFileSync, writeFileSync } from 'node:fs'

/** The shares, by the key the Privacy page saves: the dsh rows and the environment that keep each off. */
export const SHARES = Object.freeze({
  // Every request to a DeepSeek model also carries the Session log and the plugins installed.
  'deepseek-session-log': { rows: ['session-log-deepseek', 'plugin-package-inventory-deepseek'] },
  // A rated message, or /feedback, uploads the whole Session to DeepSeek's collector.
  'deepseek-feedback': { rows: ['session-telemetry-otel'], env: { DSH_TELEMETRY_DISABLED: '1' } },
  // Claude Code's error reports, and its other optional traffic, to Anthropic.
  'claude-errors': { env: { DISABLE_ERROR_REPORTING: '1', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' } },
  // Chromium's spellcheck dictionaries, from Google (Linux and Windows; macOS checks locally).
  spellcheck: {},
  // DSH's anonymous id on DeepSeek requests, kept across launches instead of a new one each time.
  'stable-id': {},
})

// Never on, whatever was chosen: DSH desktop's product analytics, and the CLIs' own analytics.
const ALWAYS_OFF_ROWS = ['product-analytics', 'desktop-product-telemetry']
const ALWAYS_OFF_ENV = { DO_NOT_TRACK: '1', DISABLE_TELEMETRY: '1', OPENUI_TELEMETRY_DISABLED: '1', npm_config_update_notifier: 'false' }

/** The person's choices from `file`: `{ [share]: true }` for each share switched on; none when missing. */
export function readChoices(file, read = readFileSync) {
  let saved
  try {
    saved = JSON.parse(read(file, 'utf8'))?.share
  } catch {
    return {}
  }
  return Object.fromEntries(Object.keys(SHARES).filter(key => saved?.[key] === true).map(key => [key, true]))
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
