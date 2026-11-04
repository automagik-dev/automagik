// node --test bridge/pairing.test.mjs: what each try does to the pairing code, per phone and in
// total; cancelling it (the dialog does on close); shortening it when its link is copied; the key
// fingerprint.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, existsSync, unlinkSync, openSync, closeSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { judgeCode, cancelCode, shorten, shortenCode, shortenOpen, fingerprint, TRIES_PER_PHONE, TRIES_PER_CODE, COPIED_LIFE } from './pairing.mjs'

const NOW = 1_000_000
const code = (extra = {}) => ({ code: 'right', expires: NOW + 60_000, name: 'desk', ...extra })

/** Plays tries against one code the way bridge.mjs does: write `next`, or delete on null. */
function play(pending, tries) {
  const verdicts = []
  for (const [phone, guess] of tries) {
    const { verdict, next } = judgeCode(pending, phone, guess, NOW)
    verdicts.push(verdict)
    if (next !== undefined) pending = next
  }
  return { verdicts, pending }
}

test('the right code pairs once and is gone', () => {
  const { verdicts, pending } = play(code(), [['phone-a', 'right'], ['phone-b', 'right']])
  assert.deepEqual(verdicts, ['ok', 'gone'])
  assert.equal(pending, null)
})

test('one phone that keeps guessing locks only itself out; the code still pairs another phone', () => {
  const wrong = Array.from({ length: TRIES_PER_PHONE + 5 }, () => ['phone-a', 'nope'])
  const { verdicts, pending } = play(code(), [...wrong, ['phone-a', 'right'], ['phone-b', 'right']])
  assert.deepEqual(verdicts.slice(0, TRIES_PER_PHONE), Array(TRIES_PER_PHONE).fill('wrong'))
  assert.deepEqual(verdicts.slice(TRIES_PER_PHONE), [...Array(6).fill('locked'), 'ok'])
  assert.equal(pending, null)
})

test('a locked-out phone does not count toward the code\'s total', () => {
  const tries = Array.from({ length: 100 }, () => ['phone-a', 'nope'])
  const { pending } = play(code(), tries)
  assert.equal(pending.failures, TRIES_PER_PHONE)
  assert.equal(pending.tries['phone-a'], TRIES_PER_PHONE)
})

test('a stranger with a few fresh keys can\'t end the code: 7 keys with 3 wrong tries each', () => {
  const tries = Array.from({ length: 7 * TRIES_PER_PHONE }, (_, i) => [`stranger-${i % 7}`, 'nope'])
  const { verdicts, pending } = play(code(), [...tries, ['phone-real', 'right']])
  assert.equal(pending, null)
  assert.equal(verdicts.at(-1), 'ok')
})

test('only a flood of keys ends the code, at the total', () => {
  const tries = Array.from({ length: TRIES_PER_CODE }, (_, i) => [`phone-${i}`, 'nope'])
  const { verdicts, pending } = play(code(), [...tries, ['phone-real', 'right']])
  assert.equal(pending, null)
  assert.equal(verdicts.at(-1), 'gone')
})

test('an expired code or none at all is gone, and nothing is written', () => {
  assert.deepEqual(judgeCode(code({ expires: NOW - 1 }), 'p', 'right', NOW), { verdict: 'gone', next: undefined })
  assert.deepEqual(judgeCode(null, 'p', 'right', NOW), { verdict: 'gone', next: undefined })
  assert.deepEqual(judgeCode(code(), 'p', undefined, NOW).verdict, 'wrong')
})

test('cancel ends a live code, and says whether there was one', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pocket-pairing-test-'))
  const path = join(dir, 'pairing.json')
  writeFileSync(path, JSON.stringify(code()))
  assert.equal(cancelCode(path, NOW), true)
  assert.equal(existsSync(path), false)
  assert.equal(judgeCode(null, 'p', 'right', NOW).verdict, 'gone') // the bridge reads no file as gone
  assert.equal(cancelCode(path, NOW), false) // closing again is harmless
  writeFileSync(path, JSON.stringify(code({ expires: NOW - 1 })))
  assert.equal(cancelCode(path, NOW), false)
  assert.equal(existsSync(path), false)
})

test('a copied code ends 2 minutes later, keeps its tries, and is never lengthened', () => {
  assert.equal(COPIED_LIFE, 2 * 60_000)
  const tried = code({ expires: NOW + 10 * 60_000, failures: 2, tries: { 'phone-a': 2 } })
  const cut = shorten(tried, COPIED_LIFE, NOW)
  assert.deepEqual(cut, { ...tried, expires: NOW + COPIED_LIFE })
  assert.equal(judgeCode(cut, 'phone-b', 'right', NOW + COPIED_LIFE).verdict, 'ok')
  assert.equal(judgeCode(cut, 'phone-b', 'right', NOW + COPIED_LIFE + 1).verdict, 'gone')
  // Copying again later doesn't give it more time, nor does copying a code with less than 2 minutes.
  assert.equal(shorten(cut, COPIED_LIFE, NOW + 30_000).expires, NOW + COPIED_LIFE)
  assert.equal(shorten(code({ expires: NOW + 30_000 }), COPIED_LIFE, NOW).expires, NOW + 30_000)
  assert.equal(shorten(code({ expires: NOW - 1 }), COPIED_LIFE, NOW), undefined)
  assert.equal(shorten(null, COPIED_LIFE, NOW), undefined)
})

test('copied rewrites pairing.json in place, and never brings back a used or cancelled code', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pocket-pairing-test-'))
  const path = join(dir, 'pairing.json')
  writeFileSync(path, JSON.stringify(code({ expires: NOW + 10 * 60_000 })), { mode: 0o600 })
  assert.equal(shortenCode(path, COPIED_LIFE, NOW), NOW + COPIED_LIFE)
  assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), code({ expires: NOW + COPIED_LIFE }))
  assert.equal(statSync(path).mode & 0o777, 0o600)
  // Used (the bridge deleted it), cancelled, expired or unreadable: nothing to shorten, nothing made.
  unlinkSync(path)
  assert.equal(shortenCode(path, COPIED_LIFE, NOW), null)
  assert.equal(existsSync(path), false)
  writeFileSync(path, JSON.stringify(code({ expires: NOW - 1 })))
  assert.equal(shortenCode(path, COPIED_LIFE, NOW), null)
  assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), code({ expires: NOW - 1 }))
  writeFileSync(path, '{not json')
  assert.equal(shortenCode(path, COPIED_LIFE, NOW), null)
  // A longer record shrinking to a shorter one leaves no tail behind.
  writeFileSync(path, JSON.stringify({ ...code({ expires: NOW + 10 * 60_000 }), pad: 'x'.repeat(500) }))
  assert.equal(shortenCode(path, COPIED_LIFE, NOW), NOW + COPIED_LIFE)
  assert.equal(JSON.parse(readFileSync(path, 'utf8')).expires, NOW + COPIED_LIFE)
})

test('a code used while copied is shortening stays gone: the write lands in the deleted file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pocket-pairing-test-'))
  const path = join(dir, 'pairing.json')
  writeFileSync(path, JSON.stringify(code({ expires: NOW + 10 * 60_000 })))
  // shortenCode has opened the file; a phone pairs and the bridge deletes it before the write.
  const fd = openSync(path, 'r+')
  unlinkSync(path)
  try { assert.equal(shortenOpen(fd, COPIED_LIFE, NOW), NOW + COPIED_LIFE) } finally { closeSync(fd) }
  assert.equal(existsSync(path), false)
  assert.equal(shortenCode(path, COPIED_LIFE, NOW), null)
  assert.equal(existsSync(path), false)
})

test('the fingerprint is the key\'s first 12 hex characters in fours', () => {
  assert.equal(fingerprint('6d35626dc129f365026a5cb104f735bb'), '6d35 626d c129')
  assert.equal(fingerprint('abc'), 'abc')
})
