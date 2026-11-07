// What the server image's entrypoint and its build share: the profile's name, the web port,
// the token redaction every log line goes through, the private-key-file rule, and the pnpm
// store pinning that keeps a profile built under /build usable under /data.
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { cp } from 'node:fs/promises'

export const PROFILE = 'automagik-web'
export const PORT = 3081
/** The store pnpm uses for its major version, as the desktop app records it (`v10` for pnpm 10). */
export const STORE_LAYOUT = 'v10'

/** One log line with any `token=` credential replaced. Everything else is kept verbatim. */
export const redactTokens = (text) => String(text).replace(/(?<![A-Za-z0-9_])token=[^\s&"'<>]+/g, 'token=<redacted>')

/** The launch URL (with dsh's per-launch token) in a line of dsh's output, or null. */
export const launchUrlOf = (text) => /dsh web: (http:\/\/127\.0\.0\.1:\d+\/\S*token=\S+)/.exec(String(text))?.[1] ?? null

/** A key file must be private: 0400 or 0600, never readable or writable by group or other. */
export const privateMode = (mode) => (mode & 0o077) === 0

/** The profiles dsh reads under `$DSH_HOME/profiles`. */
export const profileDirOf = (dshHome) => join(dshHome, 'profiles', PROFILE)

/**
 * Put the shipped profile in place under `$DSH_HOME/profiles/automagik-web`, first start only.
 * The copy lands beside its place and is renamed in whole, so an interrupted first start never
 * leaves a profile that looks installed. An existing profile is the user's and is never touched.
 */
export async function seedProfile({ dshHome, source, marker = 'automagik-server-profile' }) {
  const target = profileDirOf(dshHome)
  if (existsSync(target)) return { target, seeded: false }
  mkdirSync(join(dshHome, 'profiles'), { recursive: true })
  const fresh = `${target}.installing`
  rmSync(fresh, { recursive: true, force: true })
  await cp(source, fresh, { recursive: true, verbatimSymlinks: true })
  writeFileSync(join(fresh, marker), `${readVersion(source)}\n`)
  renameSync(fresh, target)
  return { target, seeded: true }
}

function readVersion(source) {
  try {
    return JSON.parse(readFileSync(join(source, 'package.json'), 'utf8')).version ?? 'unknown'
  } catch {
    return 'unknown'
  }
}

/**
 * pnpm refuses to touch a profile whose node_modules were linked from another store
 * (`ERR_PNPM_UNEXPECTED_STORE`). The image builds the profile under /build with the builder's
 * store; this names the runtime's store in the profile's pnpm-workspace.yaml, which wins over a
 * user's pnpm config, and records it where pnpm reads node_modules' origin. The counterpart of
 * the desktop's `pinProfileStore` (apps/desktop/src/dsh.js).
 */
export function pinStore(profileDir, dshHome) {
  const store = join(dshHome, 'pnpm-store')
  const workspace = join(profileDir, 'pnpm-workspace.yaml')
  const text = existsSync(workspace) ? readFileSync(workspace, 'utf8') : ''
  const line = `storeDir: ${JSON.stringify(store)}`
  const next = /^storeDir:.*$/m.test(text) ? text.replace(/^storeDir:.*$/m, line) : `${text.replace(/\s*$/, '')}${text.trim() ? '\n' : ''}${line}\n`
  if (next !== text) writeFileSync(workspace, next)
  const modules = join(profileDir, 'node_modules', '.modules.yaml')
  if (existsSync(modules)) {
    const raw = readFileSync(modules, 'utf8')
    const recorded = join(store, STORE_LAYOUT)
    let fixed = raw
    try {
      const state = JSON.parse(raw)
      if (state.storeDir !== recorded) fixed = `${JSON.stringify({ ...state, storeDir: recorded }, null, 2)}\n`
    } catch {
      fixed = raw.replace(/^(\s*storeDir:\s*).*$/m, `$1${JSON.stringify(recorded)}`)
    }
    if (fixed !== raw) writeFileSync(modules, fixed)
  }
  // pnpm's cache of the build machine's paths; pnpm rebuilds it on its next install.
  rmSync(join(profileDir, 'node_modules', '.pnpm-workspace-state-v1.json'), { force: true })
  return store
}
