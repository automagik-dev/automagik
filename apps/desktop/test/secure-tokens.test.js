import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  accountKeyOf, createTokenStore, detectSecureStore, NO_SECURE_STORE_REASON, SIGNED_OUT_REASON,
  TOKEN_FILE, TRY_LATER_REASON,
} from '../src/secure-tokens.js'

const seal = text => Buffer.from(`sealed:${text}`)
const opened = buffer => buffer.toString().replace(/^sealed:/, '')

/** safeStorage's async surface, with counters and the sync calls refusing to run. */
function fakeSafeStorage({ backend = 'gnome_libsecret', decrypt, encrypt, isTemporarilyUnavailable } = {}) {
  const calls = { backends: 0, decrypts: 0, encrypts: 0, plaintext: 0, sync: 0 }
  const storage = {
    calls,
    getSelectedStorageBackend() {
      calls.backends += 1
      return backend
    },
    setUsePlainTextEncryption() {
      calls.plaintext += 1
      throw new Error('the app must never opt into plaintext encryption')
    },
    encryptString() {
      calls.sync += 1
      throw new Error('the synchronous API must not be used')
    },
    decryptString() {
      calls.sync += 1
      throw new Error('the synchronous API must not be used')
    },
    async encryptStringAsync(text) {
      calls.encrypts += 1
      return encrypt ? encrypt(text) : seal(text)
    },
    async decryptStringAsync(buffer) {
      calls.decrypts += 1
      return decrypt ? decrypt(buffer) : { result: opened(buffer), shouldReEncrypt: false }
    },
  }
  if (isTemporarilyUnavailable) storage.isTemporarilyUnavailable = isTemporarilyUnavailable
  return storage
}

const scratch = (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'automagik-secure-tokens-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}
const entries = file => JSON.parse(readFileSync(file, 'utf8')).tokens
const tokenFile = dir => join(dir, TOKEN_FILE)

test('Linux backend detection: kwallet and gnome-libsecret are secure; basic_text and unknown are not', () => {
  for (const backend of ['kwallet', 'kwallet5', 'kwallet6', 'gnome_libsecret', 'gnome-libsecret']) {
    const storage = fakeSafeStorage({ backend })
    const result = detectSecureStore(storage, 'linux')
    assert.equal(result.secure, true, backend)
    assert.equal(result.backend, backend)
    assert.equal(result.reason, null)
    assert.equal(storage.calls.backends, 1)
  }
  for (const backend of ['basic_text', 'unknown']) {
    const result = detectSecureStore(fakeSafeStorage({ backend }), 'linux')
    assert.equal(result.secure, false, backend)
    assert.equal(result.backend, backend)
    assert.equal(result.reason, NO_SECURE_STORE_REASON)
  }
  assert.equal(detectSecureStore(null, 'linux').secure, false)
  assert.equal(detectSecureStore(fakeSafeStorage({ backend: '' }), 'linux').secure, false)
})

test('macOS and Windows use the platform store without asking for a Linux backend', () => {
  for (const [platform, backend] of [['darwin', 'keychain'], ['win32', 'dpapi']]) {
    const storage = fakeSafeStorage()
    const result = detectSecureStore(storage, platform)
    assert.deepEqual(result, { platform, backend, secure: true, reason: null })
    assert.equal(storage.calls.backends, 0)
  }
})

test('with no secret store nothing is written; the token lives only in this process', async (t) => {
  const dir = scratch(t)
  const storage = fakeSafeStorage({ backend: 'basic_text' })
  const store = createTokenStore({ safeStorage: storage, platform: 'linux', userData: dir })
  assert.equal(store.secure, false)
  assert.equal(store.memoryOnly, true)
  assert.equal(store.backend, 'basic_text')
  assert.equal(store.reason, NO_SECURE_STORE_REASON)

  assert.deepEqual(await store.save('cloud:alpha', 'refresh-1'), { status: 'memory', reason: NO_SECURE_STORE_REASON })
  assert.deepEqual(await store.load('cloud:alpha'), { status: 'ok', token: 'refresh-1', memory: true })
  // Nothing on disk: no file, no basic_text item, no temporary file, no safeStorage call.
  assert.equal(existsSync(tokenFile(dir)), false)
  assert.deepEqual(readdirSync(dir), [])
  assert.equal(storage.calls.encrypts, 0)
  assert.equal(storage.calls.decrypts, 0)
  assert.equal(storage.calls.plaintext, 0)
  assert.equal(storage.calls.sync, 0)

  // The next launch has no memory, so it asks for a sign-in again.
  const nextLaunch = createTokenStore({ safeStorage: fakeSafeStorage({ backend: 'unknown' }), platform: 'linux', userData: dir })
  assert.deepEqual(await nextLaunch.load('cloud:alpha'), { status: 'empty', reason: NO_SECURE_STORE_REASON })
  assert.deepEqual(readdirSync(dir), [])
})

test('a secure store keeps one token per account, rotates it on use, and clears it on sign-out', async (t) => {
  const dir = scratch(t)
  const storage = fakeSafeStorage()
  const store = createTokenStore({ safeStorage: storage, platform: 'linux', userData: dir })
  assert.equal(store.secure, true)
  assert.equal(store.reason, null)
  assert.deepEqual(await store.load('cloud:alpha'), { status: 'empty' })

  assert.deepEqual(await store.save('cloud:alpha', 'alpha-1'), { status: 'saved' })
  assert.deepEqual(await store.save('cloud:beta', 'beta-1'), { status: 'saved' })
  const file = tokenFile(dir)
  assert.equal(Object.keys(entries(file)).length, 2)
  if (process.platform !== 'win32') assert.equal(statSync(file).mode & 0o777, 0o600)
  // Only ciphertext and hashed account keys reach the disk.
  const written = readFileSync(file, 'utf8')
  assert.equal(written.includes('alpha-1'), false)
  assert.equal(written.includes('cloud:alpha'), false)
  assert.equal(written.includes('cloud:beta'), false)
  assert.deepEqual(await store.load('cloud:alpha'), { status: 'ok', token: 'alpha-1' })

  // A successful use rotates the token: the old one is replaced, not kept beside the new one.
  assert.deepEqual(await store.rotate('cloud:alpha', 'alpha-2'), { status: 'saved' })
  assert.deepEqual(await store.load('cloud:alpha'), { status: 'ok', token: 'alpha-2' })
  assert.deepEqual(await store.load('cloud:beta'), { status: 'ok', token: 'beta-1' })
  assert.equal(Object.keys(entries(file)).length, 2)
  assert.equal(storage.calls.sync, 0)
  assert.equal(storage.calls.plaintext, 0)

  assert.deepEqual(await store.clear('cloud:alpha'), { status: 'cleared' })
  assert.deepEqual(await store.load('cloud:alpha'), { status: 'empty' })
  assert.deepEqual(await store.load('cloud:beta'), { status: 'ok', token: 'beta-1' })
  assert.deepEqual(await store.clear('cloud:beta'), { status: 'cleared' })
  assert.equal(existsSync(file), false)
})

test('a decrypt failure is signed out, never an exception, and the ciphertext stays', async (t) => {
  const dir = scratch(t)
  await createTokenStore({ safeStorage: fakeSafeStorage(), platform: 'linux', userData: dir }).save('cloud:alpha', 'alpha-1')
  const file = tokenFile(dir)
  const before = readFileSync(file)
  const broken = fakeSafeStorage({
    decrypt: async () => {
      throw new Error('Error while decrypting the ciphertext provided to safeStorage.decryptStringAsync.')
    },
  })
  const store = createTokenStore({ safeStorage: broken, platform: 'linux', userData: dir })
  assert.deepEqual(await store.load('cloud:alpha'), { status: 'signed-out', reason: SIGNED_OUT_REASON })
  assert.deepEqual(readFileSync(file), before)
  // The caller re-authenticates; the fresh token replaces the one that could not be unlocked.
  const reauthenticated = createTokenStore({ safeStorage: fakeSafeStorage(), platform: 'linux', userData: dir })
  assert.deepEqual(await reauthenticated.save('cloud:alpha', 'alpha-2'), { status: 'saved' })
  assert.deepEqual(await reauthenticated.load('cloud:alpha'), { status: 'ok', token: 'alpha-2' })
})

test('shouldReEncrypt re-encrypts the token under the new key and rewrites the file', async (t) => {
  const dir = scratch(t)
  await createTokenStore({ safeStorage: fakeSafeStorage(), platform: 'linux', userData: dir }).save('cloud:alpha', 'alpha-1')
  const file = tokenFile(dir)
  const before = entries(file)[accountKeyOf('cloud:alpha')]
  const rotating = fakeSafeStorage({
    decrypt: async () => ({ result: 'alpha-1', shouldReEncrypt: true }),
    encrypt: async text => Buffer.from(`rotated:${text}`),
  })
  const store = createTokenStore({ safeStorage: rotating, platform: 'linux', userData: dir })
  assert.deepEqual(await store.load('cloud:alpha'), { status: 'ok', token: 'alpha-1' })
  assert.equal(rotating.calls.encrypts, 1)
  const after = entries(file)[accountKeyOf('cloud:alpha')]
  assert.notEqual(after, before)
  assert.equal(Buffer.from(after, 'base64').toString(), 'rotated:alpha-1')

  const rewritten = fakeSafeStorage({
    decrypt: async buffer => ({ result: buffer.toString().replace(/^rotated:/, ''), shouldReEncrypt: false }),
  })
  assert.deepEqual(await createTokenStore({ safeStorage: rewritten, platform: 'linux', userData: dir }).load('cloud:alpha'), { status: 'ok', token: 'alpha-1' })
})

test('a temporarily unavailable decrypt is try-later and keeps the token for the next try', async (t) => {
  const dir = scratch(t)
  await createTokenStore({ safeStorage: fakeSafeStorage(), platform: 'linux', userData: dir }).save('cloud:alpha', 'alpha-1')
  const file = tokenFile(dir)
  const before = readFileSync(file)
  let unavailable = true
  const storage = fakeSafeStorage({
    decrypt: async () => {
      if (unavailable) throw new Error('safeStorage.decryptStringAsync is temporarily unavailable. Please try again.')
      return { result: 'alpha-1', shouldReEncrypt: false }
    },
  })
  const store = createTokenStore({ safeStorage: storage, platform: 'linux', userData: dir })
  assert.deepEqual(await store.load('cloud:alpha'), { status: 'retry', reason: TRY_LATER_REASON })
  assert.deepEqual(readFileSync(file), before)
  unavailable = false
  assert.deepEqual(await store.load('cloud:alpha'), { status: 'ok', token: 'alpha-1' })
})

test('the availability probe counts as try-later even without the error text', async (t) => {
  const dir = scratch(t)
  await createTokenStore({ safeStorage: fakeSafeStorage(), platform: 'linux', userData: dir }).save('cloud:alpha', 'alpha-1')
  const storage = fakeSafeStorage({
    decrypt: async () => {
      throw new Error('decrypt failed')
    },
    isTemporarilyUnavailable: () => true,
  })
  const store = createTokenStore({ safeStorage: storage, platform: 'linux', userData: dir })
  assert.deepEqual(await store.load('cloud:alpha'), { status: 'retry', reason: TRY_LATER_REASON })
})

test('a resolved result that says it is temporarily unavailable is try-later too', async (t) => {
  const dir = scratch(t)
  await createTokenStore({ safeStorage: fakeSafeStorage(), platform: 'linux', userData: dir }).save('cloud:alpha', 'alpha-1')
  const storage = fakeSafeStorage({ decrypt: async () => ({ isTemporarilyUnavailable: true }) })
  const store = createTokenStore({ safeStorage: storage, platform: 'linux', userData: dir })
  assert.deepEqual(await store.load('cloud:alpha'), { status: 'retry', reason: TRY_LATER_REASON })
})

test('a temporarily unavailable save leaves the old token in place', async (t) => {
  const dir = scratch(t)
  await createTokenStore({ safeStorage: fakeSafeStorage(), platform: 'linux', userData: dir }).save('cloud:alpha', 'alpha-1')
  const file = tokenFile(dir)
  const before = readFileSync(file)
  let unavailable = true
  const storage = fakeSafeStorage({
    encrypt: async text => {
      if (unavailable) throw new Error('safeStorage.encryptStringAsync is temporarily unavailable. Please try again.')
      return seal(text)
    },
  })
  const store = createTokenStore({ safeStorage: storage, platform: 'linux', userData: dir })
  assert.deepEqual(await store.rotate('cloud:alpha', 'alpha-2'), { status: 'retry', reason: TRY_LATER_REASON })
  assert.deepEqual(readFileSync(file), before)
  unavailable = false
  assert.deepEqual(await store.rotate('cloud:alpha', 'alpha-2'), { status: 'saved' })
  assert.deepEqual(await store.load('cloud:alpha'), { status: 'ok', token: 'alpha-2' })
})

test('Delivery 1: with no secret store nothing is written, whatever is saved or cleared', async (t) => {
  const dir = scratch(t)
  const store = createTokenStore({ safeStorage: fakeSafeStorage({ backend: 'basic_text' }), platform: 'linux', userData: dir })
  await store.save('https://cloud.example', 'refresh-1')
  await store.save('https://instance.example', 'refresh-2')
  await store.rotate('https://cloud.example', 'refresh-3')
  await store.clear('https://instance.example')
  assert.deepEqual(readdirSync(dir), [])
  assert.equal(existsSync(tokenFile(dir)), false)
})

test('Delivery 1: a downgrade leaves stored items unused and the file untouched', async (t) => {
  const dir = scratch(t)
  const secure = createTokenStore({ safeStorage: fakeSafeStorage(), platform: 'linux', userData: dir })
  await secure.save('cloud:alpha', 'alpha-1')
  const file = tokenFile(dir)
  const before = readFileSync(file)

  const downgraded = createTokenStore({ safeStorage: fakeSafeStorage({ backend: 'basic_text' }), platform: 'linux', userData: dir })
  assert.equal(downgraded.secure, false)
  assert.deepEqual(await downgraded.load('cloud:alpha'), { status: 'empty', reason: NO_SECURE_STORE_REASON })
  assert.deepEqual(readFileSync(file), before)
  await downgraded.save('cloud:alpha', 'alpha-2')
  await downgraded.clear('cloud:alpha')
  assert.deepEqual(readFileSync(file), before)
  assert.deepEqual(readdirSync(dir), [TOKEN_FILE])
})

test('the store is inert: no desktop flow imports or calls it', () => {
  const src = new URL('../src/', import.meta.url)
  const read = name => readFileSync(new URL(name, src), 'utf8')
  for (const name of readdirSync(src)) {
    if (!name.endsWith('.js') || name === 'secure-tokens.js') continue
    const source = read(name)
    assert.doesNotMatch(source, /secure-tokens/, `${name} imports or names the unused store`)
    assert.doesNotMatch(source, /createTokenStore|detectSecureStore/, `${name} calls the unused store`)
    assert.doesNotMatch(source, /safeStorage/, `${name} reaches safeStorage outside the store`)
  }
  const module = read('secure-tokens.js')
  // Electron supplies safeStorage from main.js; the module itself is plain Node and testable.
  assert.doesNotMatch(module, /from 'electron'/)
  // The fixed-key fallback is detected, never opted into, and only the async API is used.
  assert.doesNotMatch(module, /setUsePlainTextEncryption\s*\(/)
  assert.doesNotMatch(module, /[^A-Za-z]encryptString\(/)
  assert.doesNotMatch(module, /[^A-Za-z]decryptString\(/)
  assert.match(module, /encryptStringAsync/)
  assert.match(module, /decryptStringAsync/)
})
