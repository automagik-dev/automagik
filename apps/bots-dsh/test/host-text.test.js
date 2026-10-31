// A host message in the interface language: a language pack's entry for it wins, in any
// language (the pt-BR pack, or a plugin's words); Chinese also has its patterns.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { hostText, installLocale } from '../src/client/i18n.js'

function locale(active, words) {
  return {
    register: () => () => {},
    bind: () => key => words[key] ?? key,
    getLocale: () => ({ active }),
  }
}

test('a pack\'s entry for a host message words it in that language; anything else stays as sent', () => {
  const off = installLocale(locale('pt-BR', { 'Unfold is not reachable from here right now': 'Não dá para falar com Unfold daqui agora' }))
  try {
    assert.equal(hostText('Unfold is not reachable from here right now'), 'Não dá para falar com Unfold daqui agora')
    assert.equal(hostText('Model x is not available. Available: y'), 'Model x is not available. Available: y')
  } finally { off() }
  const zh = installLocale(locale('zh-CN', {}))
  try {
    assert.equal(hostText('Model x is not available. Available: y'), '模型 x 不可用。可用的：y')
  } finally { zh() }
  assert.equal(hostText('Unfold is not reachable from here right now'), 'Unfold is not reachable from here right now')
})
