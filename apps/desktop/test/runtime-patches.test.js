import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { patchRuntime } from '../scripts/runtime-patches.mjs'

const sha256 = text => createHash('sha256').update(text).digest('hex')

// A Windows checkout with core.autocrlf turns the patch's lines into CRLF (#191): it applies the same.
for (const eol of ['\n', '\r\n']) {
  test(`a runtime patch with ${eol === '\n' ? 'LF' : 'CRLF'} lines applies to the file npm installed`, (t) => {
    const root = mkdtempSync(join(tmpdir(), 'automagik-patches-'))
    t.after(() => rmSync(root, { recursive: true, force: true }))
    const modules = join(root, 'node_modules')
    const pkg = join(modules, '@deepseek-ai', 'dsh-x')
    mkdirSync(join(pkg, 'lib'), { recursive: true })
    mkdirSync(join(modules, '@deepseek-ai', 'dsh'), { recursive: true })
    writeFileSync(join(modules, '@deepseek-ai', 'dsh', 'package.json'), JSON.stringify({ version: '1.0.0' }))
    writeFileSync(join(pkg, 'package.json'), JSON.stringify({ version: '2.0.0' }))
    const before = 'one\ntwo\nthree\n'
    const after = 'one\n2\nthree\n'
    writeFileSync(join(pkg, 'lib', 'index.js'), before)
    const patches = join(root, 'patches')
    mkdirSync(patches)
    const patch = ['--- a/@deepseek-ai/dsh-x/lib/index.js', '+++ b/@deepseek-ai/dsh-x/lib/index.js', '@@ -1,3 +1,3 @@', ' one', '-two', '+2', ' three', ''].join(eol)
    writeFileSync(join(patches, 'x.patch'), patch)
    writeFileSync(join(patches, 'patches.json'), JSON.stringify([{ patch: 'x.patch', dsh: '1.0.0', files: [{ package: '@deepseek-ai/dsh-x', file: 'lib/index.js', version: '2.0.0', before: sha256(before), after: sha256(after) }] }]))
    assert.deepEqual(patchRuntime(modules, patches).map(result => result.state), ['patched'])
    assert.equal(readFileSync(join(pkg, 'lib', 'index.js'), 'utf8'), after)
    assert.deepEqual(patchRuntime(modules, patches).map(result => result.state), ['already patched'])
  })
}
