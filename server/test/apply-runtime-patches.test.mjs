// The server image applies the desktop's carried runtime patches in its builder stage, after
// npm ci and the dsh version check and before pruning. These tests drive the exported
// applyRuntimePatches helper against a temp runtime: it patches, leaves an already-patched
// file alone, and fails the build on a dsh version, package version or file hash mismatch
// (a half-patched runtime must never be written). The real patch is covered by the desktop
// test and by the Server image job, which cannot be assembled in a unit test.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { applyRuntimePatches } from '../assemble.mjs'

const BEFORE = 'const serve = 1;\nconst cache = false;\n\nexport { serve, cache };\n'
const AFTER = 'const serve = 1;\nconst cache = true;\n\nexport { serve, cache };\n'
const PATCH = [
  '--- a/@deepseek-ai/dsh-x/lib/index.js',
  '+++ b/@deepseek-ai/dsh-x/lib/index.js',
  '@@ -1,4 +1,4 @@',
  ' const serve = 1;',
  '-const cache = false;',
  '+const cache = true;',
  ' ',
  ' export { serve, cache };',
  '',
].join('\n')

const sha256 = text => createHash('sha256').update(text).digest('hex')

function write(root, path, content) {
  mkdirSync(join(root, path.split('/').slice(0, -1).join('/')), { recursive: true })
  writeFileSync(join(root, path), content)
}

// A runtime the builder stage sees: the dsh pin, the patched package and the patch folder.
// The version knobs are the mismatches a later dsh or package would produce.
function makeRuntime(t, { dsh = '1.0.0', pkg = '2.0.0', file = BEFORE } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'automagik-server-patches-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const runtimeDir = join(root, 'runtime')
  const patchesDir = join(root, 'patches')
  write(runtimeDir, 'node_modules/@deepseek-ai/dsh/package.json', JSON.stringify({ name: '@deepseek-ai/dsh', version: dsh }))
  write(runtimeDir, 'node_modules/@deepseek-ai/dsh-x/package.json', JSON.stringify({ name: '@deepseek-ai/dsh-x', version: pkg }))
  write(runtimeDir, 'node_modules/@deepseek-ai/dsh-x/lib/index.js', file)
  write(patchesDir, 'x.patch', PATCH)
  write(patchesDir, 'patches.json', JSON.stringify([{
    patch: 'x.patch',
    dsh: '1.0.0',
    files: [{ package: '@deepseek-ai/dsh-x', version: '2.0.0', file: 'lib/index.js', before: sha256(BEFORE), after: sha256(AFTER) }],
  }]))
  return {
    runtimeDir,
    patchesDir,
    file: join(runtimeDir, 'node_modules', '@deepseek-ai', 'dsh-x', 'lib', 'index.js'),
  }
}

test('applyRuntimePatches patches the runtime and names the file it changed', (t) => {
  const { runtimeDir, patchesDir, file } = makeRuntime(t)
  const results = applyRuntimePatches(runtimeDir, patchesDir)
  assert.deepEqual(results.map(({ name, state }) => ({ name, state })), [{ name: '@deepseek-ai/dsh-x/lib/index.js', state: 'patched' }])
  assert.equal(readFileSync(file, 'utf8'), AFTER)
})

test('applyRuntimePatches leaves an already-patched file alone', (t) => {
  const { runtimeDir, patchesDir, file } = makeRuntime(t)
  applyRuntimePatches(runtimeDir, patchesDir)
  const second = applyRuntimePatches(runtimeDir, patchesDir)
  assert.deepEqual(second.map(({ name, state }) => ({ name, state })), [{ name: '@deepseek-ai/dsh-x/lib/index.js', state: 'already patched' }])
  assert.equal(readFileSync(file, 'utf8'), AFTER)
})

test('applyRuntimePatches fails the build on a dsh version mismatch', (t) => {
  const { runtimeDir, patchesDir } = makeRuntime(t, { dsh: '0.9.0' })
  assert.throws(
    () => applyRuntimePatches(runtimeDir, patchesDir),
    /runtime patch x\.patch is for dsh 1\.0\.0, but the runtime is dsh 0\.9\.0/,
  )
})

test('applyRuntimePatches fails the build on a package version mismatch', (t) => {
  const { runtimeDir, patchesDir } = makeRuntime(t, { pkg: '3.0.0' })
  assert.throws(
    () => applyRuntimePatches(runtimeDir, patchesDir),
    /runtime patch x\.patch: @deepseek-ai\/dsh-x is 3\.0\.0, not 2\.0\.0/,
  )
})

test('applyRuntimePatches fails the build on a file hash mismatch and writes nothing', (t) => {
  const tampered = BEFORE.replace('const serve = 1;', 'const serve = 9;')
  const { runtimeDir, patchesDir, file } = makeRuntime(t, { file: tampered })
  assert.throws(
    () => applyRuntimePatches(runtimeDir, patchesDir),
    /runtime patch x\.patch: @deepseek-ai\/dsh-x\/lib\/index\.js has sha256 [0-9a-f]{64}, neither the [0-9a-f]{64} it was made against nor its result/,
  )
  assert.equal(readFileSync(file, 'utf8'), tampered, 'a failed check must not leave a partially patched runtime')
})
