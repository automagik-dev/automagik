import assert from 'node:assert/strict'
import { test } from 'node:test'
import { closestClaude, PI_AI_CLAUDE_MODELS, piAiClaudeOf } from '../src/host/claude-models.js'

test('a Claude Code model moves to the pi-ai Claude model closest to it', () => {
  const cases = {
    // Claude Code's aliases: the newest of the family; its `default` is Opus, as on Max.
    opus: 'claude-opus-5-5',
    sonnet: 'claude-sonnet-5-5',
    haiku: 'claude-haiku-5-5',
    fable: 'claude-fable-5-1',
    'opus[1m]': 'claude-opus-5-5',
    opusplan: 'claude-opus-5-5',
    default: 'claude-opus-5-5',
    // A version pi-ai serves stays that version; 1M and dated ids take the plain one.
    'claude-opus-5-5': 'claude-opus-5-5',
    'claude-opus-5-5[1m]': 'claude-opus-5-5',
    'claude-opus-4-7': 'claude-opus-4-7',
    'claude-sonnet-4-5-20250929': 'claude-sonnet-4-5',
    'claude-sonnet-5': 'claude-sonnet-5',
    'claude-haiku-4-5-20251001': 'claude-haiku-4-5',
    // One it does not: the nearest, the newer between two as near.
    'claude-opus-4-1': 'claude-opus-4-5',
    'claude-sonnet-4-7': 'claude-sonnet-4-6',
    'claude-haiku-5': 'claude-haiku-5-5',
    'claude-fable-6': 'claude-fable-5-1',
    // An older naming still names its family; nothing readable takes the default.
    'claude-3-5-sonnet-20241022': 'claude-sonnet-5-5',
    'mystery-model': 'claude-opus-5-5',
  }
  for (const [from, to] of Object.entries(cases)) assert.equal(closestClaude(from), to, from)
  // Every answer is a model pi-ai serves.
  const served = new Set(Object.entries(PI_AI_CLAUDE_MODELS).flatMap(([family, versions]) => versions.map(version => `claude-${family}-${version}`)))
  for (const to of Object.values(cases)) assert.ok(served.has(to), to)
})

test('only a claude-code ref moves, a boxed one too', () => {
  assert.equal(piAiClaudeOf('claude-code/opus'), 'anthropic/claude-opus-5-5')
  assert.equal(piAiClaudeOf('claude-code-work/claude-sonnet-4-6'), 'anthropic/claude-sonnet-4-6')
  for (const ref of ['anthropic/claude-opus-5-5', 'openai-codex/gpt-6.1-sol', 'claude-codex/x', 'claude-code', '/opus', undefined, null, 7]) {
    assert.equal(piAiClaudeOf(ref), undefined, String(ref))
  }
})
