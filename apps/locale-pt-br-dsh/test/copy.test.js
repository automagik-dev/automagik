import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkCopy, omniKeys } from '../scripts/copy-check.mjs'

test('the copy check is green', async () => {
  assert.deepEqual(await checkCopy(), [])
})

test('the omni-ui keys the pack translates are still the Bot team\'s', async () => {
  const keys = await omniKeys()
  assert.ok(keys.size > 1000, `only ${keys.size} omni-ui keys found`)
})

// A pack with one of each fault, against a two-key reference.
test('the copy check finds each kind of fault', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pt-br-copy-'))
  mkdirSync(join(dir, 'pt-BR'))
  const reference = join(dir, 'en.json')
  writeFileSync(reference, JSON.stringify({ sidebar: { a: 'Open {name}', b: 'Close', c: 'Saved', d: 'Done' } }))
  const fault = {
    a: 'Abra o Unfold', b: 'Toque para fechar', c: 'Bem-vindo de volta', d: 'O ficheiro na sandbox', extra: 'Sobra',
  }
  writeFileSync(join(dir, 'pt-BR', 'sidebar.json'), JSON.stringify(fault))
  const findings = await checkCopy({ folder: join(dir, 'pt-BR'), reference, omni: new Set() })
  const has = (pattern) => assert.ok(findings.some((line) => pattern.test(line)), `no finding matches ${pattern}:\n${findings.join('\n')}`)
  has(/sidebar:a: drops or adds a placeholder/)
  has(/sidebar:a: puts an article before Unfold/)
  has(/sidebar:b: says tap/)
  has(/sidebar:c: uses a gendered word for the person/)
  has(/sidebar:d: is European Portuguese/)
  has(/sidebar:d: says sandbox/)
  has(/sidebar:extra: not an en key/)
})
