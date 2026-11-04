// The Bot team's description on DSH's plugin pages, in the DSH language (#317). DSH reads a
// plugin's display text from its package's locale/<lang>.json (readPluginMeta in
// @deepseek-ai/dsh-app-boot), English from package.json: the Bot team ships its pt-BR there.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const json = path => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'))

test('the Bot team\'s description on DSH\'s plugin pages has its pt-BR text', () => {
  const manifest = json('../package.json')
  assert.equal(manifest.exports['./locale/*.json'], './locale/*.json')
  assert.ok(manifest.files.includes('locale/'))
  // English stays package.json's description: en.json holds none of its own, and no title.
  assert.deepEqual(json('../locale/en.json'), { meta: {} })
  const pt = json('../locale/pt-br.json')
  assert.deepEqual(Object.keys(pt.meta), ['description'])
  assert.ok(pt.meta.description.length > 40 && pt.meta.description !== manifest.description)
})
