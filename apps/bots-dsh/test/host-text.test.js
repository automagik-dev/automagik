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

test('a model access refusal and a switch DSH turned down are worded with the values they carry', () => {
  const words = {
    'Sign in to {connection} before using this model.': 'Faça login em {connection} antes de usar este modelo.',
    '{name} could not switch to {model}. It stays on {kept}.': '{name} não conseguiu mudar para {model}. Continua em {kept}.',
  }
  const fill = (key, params) => (words[key] ?? key).replace(/\{(\w+)\}/g, (match, name) => params?.[name] ?? match)
  const off = installLocale({ register: () => () => {}, bind: () => fill, getLocale: () => ({ active: 'pt' }) })
  try {
    assert.equal(hostText('Sign in to Codex (acp-codex) before using this model.'), 'Faça login em Codex (acp-codex) antes de usar este modelo.')
    assert.equal(hostText('Omni could not switch to acp-codex/default. It stays on deepseek/v4.'), 'Omni não conseguiu mudar para acp-codex/default. Continua em deepseek/v4.')
    assert.equal(hostText('Something else.'), 'Something else.')
  } finally { off() }
  // Without a language pack the message stays as sent.
  assert.equal(hostText('Sign in to Codex (acp-codex) before using this model.'), 'Sign in to Codex (acp-codex) before using this model.')
})
