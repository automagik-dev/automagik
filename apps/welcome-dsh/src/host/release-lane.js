// Before the welcome installs a sibling from its own release's tarballs, it checks each one
// against the lane.json published on that same versioned release, signed (ed25519, detached,
// base64) with a key this plugin carries: lane-keys.json, a copy of the repository's
// plugin-lane/keys.json. The lane must be for this release's version and list every sibling,
// and each tarball must have the lane's size, sha256 and sha512 integrity. Nothing is written
// until every tarball about to be installed matches; then each is kept 0600 under
// <AUTOMAGIK_HOME>/welcome/tarballs, a path the profile records, so it stays after the install.
// A release without a lane is refused: there is no other source of the expected hashes.
import { createHash, createPublicKey, verify } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const LANE_KEYS = Object.freeze(JSON.parse(readFileSync(new URL('./lane-keys.json', import.meta.url), 'utf8')).keys)
export const RELEASES = 'https://github.com/automagik-dev/automagik/releases/download/'
const SCHEMA_VERSION = 1
const MAX_TARBALL = 64 * 1024 * 1024
const TIMEOUT_MS = 60_000

const fail = message => Object.assign(new Error(message), { code: 'omni-ai/refused' })
const sha256Of = bytes => createHash('sha256').update(bytes).digest('hex')
const integrityOf = bytes => `sha512-${createHash('sha512').update(bytes).digest('base64')}`

export const tarballDir = (env = process.env) => join(env.AUTOMAGIK_HOME?.trim() || join(homedir(), '.automagik'), 'welcome', 'tarballs')

/** The lane in `bytes`, when `signature` (base64, detached ed25519) is one of `keys`'. */
export function verifyLane(bytes, signature, keys = LANE_KEYS) {
  let lane
  try { lane = JSON.parse(Buffer.from(bytes).toString('utf8')) } catch { throw fail('lane.json is not JSON') }
  const key = keys.find(entry => entry.keyId === lane?.keyId)
  if (!key) throw fail(`lane.json: no key ${lane?.keyId}`)
  let good = false
  try { good = verify(null, Buffer.from(bytes), createPublicKey(key.publicKey), Buffer.from(String(signature).trim(), 'base64')) } catch {}
  if (!good) throw fail('lane.json: the signature does not match')
  if (lane.schemaVersion !== SCHEMA_VERSION) throw fail(`lane.json: schema ${lane.schemaVersion}`)
  return lane
}

/**
 * Each of `wanted` ([{ name, url }], tarballs of release v`version`) checked against that
 * release's signed lane and kept; resolves to { name: path }. Throws, having written nothing,
 * if any one fails.
 */
export async function checkedTarballs(wanted, { version, env = process.env, fetch = globalThis.fetch, keys = LANE_KEYS }) {
  if (wanted.length === 0) return {}
  const get = async (url, what) => {
    const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (!response.ok) throw fail(`${what}: HTTP ${response.status}`)
    return Buffer.from(await response.arrayBuffer())
  }
  const release = `${RELEASES}v${version}/`
  const bytes = await get(`${release}lane.json`, `v${version} lane.json`)
  const signature = await get(`${release}lane.json.sig`, `v${version} lane.json.sig`)
  const lane = verifyLane(bytes, signature.toString('utf8'), keys)
  if (lane.version !== version) throw fail(`the lane on v${version} is for ${lane.version}`)
  const checked = []
  for (const { name, url } of wanted) {
    const entry = (lane.plugins ?? []).find(plugin => plugin.name === name)
    if (!entry || entry.version !== version || entry.url !== url) throw fail(`${name} ${version}: not in the release's lane`)
    const tarball = await get(url, `${name} ${version}`)
    if (tarball.length > MAX_TARBALL || tarball.length !== entry.size) throw fail(`${name} ${version}: not the size the lane names`)
    if (sha256Of(tarball) !== entry.sha256 || integrityOf(tarball) !== entry.integrity) throw fail(`${name} ${version}: the tarball does not match the lane`)
    checked.push({ name, path: `${name.replace('/', '+')}-${version}-${entry.sha256}.tgz`, tarball })
  }
  // Every one matched: only now is anything written, each through a temporary name.
  const dir = tarballDir(env)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const made = []
  try {
    const paths = {}
    for (const { name, path, tarball } of checked) {
      const file = join(dir, path)
      if (!(existsSync(file) && sha256Of(readFileSync(file)) === sha256Of(tarball))) {
        const part = `${file}.${process.pid}.part`
        made.push(part)
        writeFileSync(part, tarball, { mode: 0o600 })
        renameSync(part, file)
        made.push(file)
      }
      paths[name] = file
    }
    return paths
  } catch (error) {
    for (const file of made) rmSync(file, { force: true })
    throw error
  }
}
