// The permission payloads of a real agent (test/fixtures/permission-payloads): what the code
// that answers session/request_permission may and may not assume. A new capture that breaks
// one of these facts is a reason to read that code again, not to edit the test.
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const DIR = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'permission-payloads')
const read = name => JSON.parse(readFileSync(join(DIR, name), 'utf8'))
const codex = read('codex-acp-2.6.0.json')
const byName = name => codex.cases.find(item => item.name === name)
const calls = item => item.updates.filter(update => update.sessionUpdate === 'tool_call')

test('the fixtures name their source and carry nothing of the machine they were captured on', () => {
  for (const file of readdirSync(DIR).filter(name => name.endsWith('.json'))) {
    const text = readFileSync(join(DIR, file), 'utf8')
    const fixture = JSON.parse(text)
    assert.equal(typeof fixture.source?.adapter, 'string', file)
    assert.equal(typeof fixture.source?.cli, 'string', file)
    // Every string of the parsed fixture (so an escaped value is seen as it reads), keys included.
    const strings = []
    const walk = (value) => {
      if (typeof value === 'string') strings.push(value)
      else if (Array.isArray(value)) value.forEach(walk)
      else if (value !== null && typeof value === 'object') for (const [key, inner] of Object.entries(value)) { strings.push(key); walk(inner) }
    }
    walk(fixture)
    for (const value of strings) {
      assert.doesNotMatch(value, /\/home\/|\/Users\/|[A-Za-z]:\\Users\\/, `${file}: a home path in ${JSON.stringify(value.slice(0, 60))}`)
      assert.doesNotMatch(value, /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+/, `${file}: an address in ${JSON.stringify(value.slice(0, 60))}`)
      assert.doesNotMatch(value, /\b(sk|pk|ghp|gho|github_pat|xox[abp])[-_][A-Za-z0-9_-]{12,}|bearer\s+[A-Za-z0-9._-]{12,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/i, `${file}: a credential-shaped value`)
      assert.notEqual(value, 'sessionId', `${file} keeps a session id`)
    }
    // No wall-clock time of the capture: any number that reads as a date in ms is synthetic.
    const numbers = []
    const count = (value) => {
      if (typeof value === 'number') numbers.push(value)
      else if (value !== null && typeof value === 'object') Object.values(value).forEach(count)
    }
    count(fixture)
    assert.deepEqual(numbers.filter(value => value > 1e11), [], `${file} holds a real timestamp`)
  }
})

test('Codex: an ordinary question is the call itself: same id, same title, same input', () => {
  for (const name of ['read-only: write a file', 'workspace-write: write outside the workspace']) {
    const item = byName(name)
    assert.equal(item.questions.length, 1, name)
    const asked = item.questions[0].toolCall
    const call = calls(item).find(update => update.toolCallId === asked.toolCallId)
    assert.notEqual(call, undefined, `${name}: the question is about a call the agent announced`)
    // No title of its own ("Run command?"): the title is the command, as on the call.
    assert.equal(asked.title, call.title, name)
    assert.deepEqual(asked.rawInput, call.rawInput, name)
    assert.equal(asked.status, 'pending', name)
  }
})

test('Codex: a question to run again outside the sandbox is a new call that looks like the first', () => {
  const item = byName('workspace-write: command needing the network')
  const [sandboxed, again] = calls(item)
  assert.equal(calls(item).length, 2)
  // The sandboxed run failed before anything was asked.
  assert.equal(item.updates.find(update => update.sessionUpdate === 'tool_call_update' && update.toolCallId === sandboxed.toolCallId).status, 'failed')
  const asked = item.questions[0].toolCall
  assert.equal(asked.toolCallId, again.toolCallId)
  assert.notEqual(again.toolCallId, sandboxed.toolCallId, 'the tool id is not reused')
  assert.equal(again.title, sandboxed.title)
  assert.deepEqual(again.rawInput, sandboxed.rawInput)
  // The question is about the retry, and reads as the first run did.
  assert.equal(asked.title, sandboxed.title)
  assert.deepEqual(asked.rawInput, sandboxed.rawInput)
  // Nothing tells it from an ordinary question: no key an ordinary one lacks, at either level.
  const ordinary = byName('read-only: write a file').questions[0]
  assert.deepEqual(Object.keys(asked).filter(key => !Object.hasOwn(ordinary.toolCall, key)), [])
  assert.deepEqual(Object.keys(item.questions[0]).filter(key => !Object.hasOwn(ordinary, key)), [])
  assert.deepEqual(item.questions[0].options.map(option => option.kind), ordinary.options.map(option => option.kind))
})

test('Codex: each captured question offers once, always and reject', () => {
  const questions = codex.cases.flatMap(item => item.questions)
  assert.equal(questions.length, 3)
  for (const question of questions) {
    assert.deepEqual(question.options.map(option => option.kind), ['allow_once', 'allow_always', 'reject_once'])
    assert.equal(new Set(question.options.map(option => option.optionId)).size, 3)
  }
})

test('Codex: in its agent mode it asks nothing, and its own reviewer lets a command run', () => {
  for (const name of ['agent: command needing the network', 'agent: write outside the workspace']) {
    const item = byName(name)
    assert.equal(item.mode, 'agent', name)
    assert.deepEqual(item.questions, [], `${name}: no session/request_permission`)
    assert.equal(item.stopReason, 'end_turn', name)
  }
  // The write outside the workspace: reviewed by Codex's own Guardian, then completed.
  const outside = byName('agent: write outside the workspace')
  const guardian = calls(outside).find(update => update.kind === 'think')
  assert.equal(guardian.title, 'Guardian Review')
  const exec = calls(outside).find(update => update.kind === 'execute')
  assert.equal(guardian.rawInput.targetItemId, exec.toolCallId)
  // The reviewer's own result says approved, by the agent and not by a person.
  const verdict = outside.updates.find(update => update.sessionUpdate === 'tool_call_update' && update.toolCallId === guardian.toolCallId)
  assert.equal(verdict.status, 'completed')
  assert.equal(verdict.rawOutput.review.status, 'approved')
  assert.equal(verdict.rawOutput.decisionSource, 'agent')
  assert.equal(outside.updates.find(update => update.sessionUpdate === 'tool_call_update' && update.toolCallId === exec.toolCallId).status, 'completed')
})
