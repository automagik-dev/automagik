// A release for the tests: its tarballs, and its lane.json signed with a key made here (the
// lane keys welcome carries are not used). Each file is served by URL; a missing one is a 404.
import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { OMNI_PLUGINS, UNFOLD_PLUGIN, UNFOLD_PLUGINS } from '../src/host/bot-types.js'

export const PKG = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
export const V = PKG.version
export const RELEASE = `https://github.com/automagik-dev/automagik/releases/download/v${V}/`
export const EVERYTHING = [OMNI_PLUGINS[0], ...UNFOLD_PLUGINS, UNFOLD_PLUGIN]
export const urlOf = plugin => `${RELEASE}automagik-${plugin.dir}-${V}.tgz`

const { privateKey, publicKey } = generateKeyPairSync('ed25519')
export const KEYS = [{ keyId: 'test-key', publicKey: publicKey.export({ type: 'spki', format: 'pem' }) }]
export const tarballOf = plugin => Buffer.from(`not a real tarball: ${plugin.name} ${V}\n`)
export const entryOf = (plugin, bytes = tarballOf(plugin)) => ({
  name: plugin.name,
  version: V,
  url: urlOf(plugin),
  integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
  sha256: createHash('sha256').update(bytes).digest('hex'),
  size: bytes.length,
  engines: { dsh: '*' },
})
export const laneOf = ({ version = V, plugins = EVERYTHING.map(plugin => entryOf(plugin)) } = {}) => Buffer.from(JSON.stringify({
  schemaVersion: 1, publisher: 'automagik', keyId: 'test-key', sequence: 1, issuedAt: '2026-10-28T00:00:00Z',
  repository: 'https://github.com/automagik-dev/automagik', version, commit: '0'.repeat(40), base: version, plugins,
}))
export const signatureOf = bytes => sign(null, bytes, privateKey).toString('base64')

// The release's files by URL; a missing one answers 404.
export function release(files) {
  const asked = []
  const fetch = async (url) => {
    asked.push(String(url))
    const body = files[String(url)]
    return body === undefined
      ? { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) }
      : { ok: true, status: 200, arrayBuffer: async () => Uint8Array.from(Buffer.from(body)).buffer }
  }
  return { fetch, asked }
}
export const filesOf = ({ lane = laneOf(), sig = signatureOf(lane), tarballs = {} } = {}) => ({
  [`${RELEASE}lane.json`]: lane,
  ...(sig === null ? {} : { [`${RELEASE}lane.json.sig`]: sig }),
  ...Object.fromEntries(EVERYTHING.map(plugin => [urlOf(plugin), tarballs[plugin.name] ?? tarballOf(plugin)])),
})
