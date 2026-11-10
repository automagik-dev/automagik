// Secure token storage for Cloud accounts and remote self-hosted instances. One refresh token
// per account or instance, encrypted by Electron's main-process safeStorage (the Keychain on
// macOS, DPAPI on Windows, KWallet or GNOME libsecret on Linux). It is a storage layer only:
// nothing in the app uses it yet, and C1.2 wires it behind its setting.
//
// safeStorage keeps no named items: it encrypts and decrypts strings. The ciphertexts live in
// one file under Electron's userData folder, which main.js pins under the app's name
// (identity.js), and each account's map key is a hash of the app's name and the account, so no
// account or instance identifier is written in the clear. Nothing else is written there: the
// plaintext token exists only in this process, or in safeStorage's ciphertext.
//
// On Linux, safeStorage falls back to a hardcoded password (`basic_text`) when the desktop has
// no secret store. The fallback is not encryption, so this module never opts into it
// (setUsePlainTextEncryption is never called) and treats `basic_text` and `unknown` as no
// secure store: load/save then use process memory only, nothing is written, and the caller must
// sign in again at each launch. The reason string is exposed for the UI.
//
// Create the store after app.whenReady(): getSelectedStorageBackend answers `unknown` before
// that. Pure Node otherwise: main.js passes Electron's safeStorage in, and tests pass a fake.
import { createHash, randomUUID } from 'node:crypto'
import { chmodSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PRODUCT } from './identity.js'

/** What the app's encrypted token file is called, inside Electron's userData folder. */
export const TOKEN_FILE = 'cloud-refresh-tokens.json'

/** The backends that mean the desktop has no secret store: safeStorage's fixed-key fallback,
 *  and the answer before app ready (or from an unrecognised desktop). */
export const NO_SECURE_STORE_BACKENDS = Object.freeze(['basic_text', 'unknown'])

/** Why no token is kept across launches on this desktop (shown to the person by the UI). */
export const NO_SECURE_STORE_REASON = 'This desktop has no secure secret store, so Automagik cannot save your Cloud sign-in. Sign in again each time you open the app.'

/** Why a stored token was not used: it cannot be decrypted on this launch (a locked keyring,
 *  or the secret store changed). The caller treats it as signed out and asks to sign in again. */
export const SIGNED_OUT_REASON = 'The saved Cloud sign-in could not be unlocked. Sign in again.'

/** Why a load or save can be tried later: the secret store is temporarily unavailable, and
 *  the stored token must be kept as it is. */
export const TRY_LATER_REASON = 'The system secret store is temporarily unavailable. Try again in a moment.'

/** Why a secure save or clear failed without the store being temporarily unavailable. */
export const STORAGE_FAILED_REASON = 'The system secret store could not save the Cloud sign-in. Try again.'

const VERSION = 1

/** The token file for an Electron userData folder (main.js pins that folder under the app's name). */
export function tokenFileOf(userData) {
  return join(userData, TOKEN_FILE)
}

/** The key one account's ciphertext is filed under: the app's name and the account, hashed. */
export function accountKeyOf(account) {
  return createHash('sha256').update(`${PRODUCT}\u0000${account}`).digest('hex')
}

/**
 * Whether safeStorage offers a real secret store, and what to tell the person when it does not.
 * On Linux the answer is the selected backend, never isEncryptionAvailable: with the fallback
 * that reports available only after opting into plaintext (which this app never does).
 * `unknown` is how Electron answers before app ready, so call this only after it.
 */
export function detectSecureStore(safeStorage, platform = process.platform) {
  const noStore = backend => ({ platform, backend, secure: false, reason: NO_SECURE_STORE_REASON })
  if (!safeStorage) return noStore('unknown')
  if (platform === 'darwin') return { platform, backend: 'keychain', secure: true, reason: null }
  if (platform === 'win32') return { platform, backend: 'dpapi', secure: true, reason: null }
  if (platform !== 'linux') return noStore('unknown')
  let backend
  try {
    backend = safeStorage.getSelectedStorageBackend?.()
  } catch {
    backend = 'unknown'
  }
  if (typeof backend !== 'string' || NO_SECURE_STORE_BACKENDS.includes(backend)) return noStore(backend ?? 'unknown')
  return { platform, backend, secure: true, reason: null }
}

/**
 * The token store, given Electron's safeStorage and where to keep the ciphertexts. Call it after
 * app.whenReady(). Methods are async because encryption uses safeStorage's async API:
 *   load(account)   -> { status: 'ok', token } | { status: 'empty' } |
 *                      { status: 'retry', reason } | { status: 'signed-out', reason }
 *   save(account, token)   -> { status: 'saved' | 'memory' | 'retry' | 'failed', reason? }
 *   rotate(account, token) -> the same, for the refresh token a successful use just replaced
 *   clear(account)         -> { status: 'cleared' | 'failed', ... }
 * A failed decrypt is signed-out: no token is returned and the caller re-authenticates. A
 * temporarily unavailable store is retry: the stored token is left untouched.
 */
export function createTokenStore({ safeStorage, platform = process.platform, userData, file } = {}) {
  const target = file ?? (userData ? tokenFileOf(userData) : null)
  if (typeof target !== 'string' || target === '') throw new TypeError('createTokenStore needs userData or file')
  const detected = detectSecureStore(safeStorage, platform)
  const { secure, backend, reason } = detected
  // The only place a token waits without a secret store, and never past this process.
  const memory = new Map()

  const isTemporarilyUnavailable = (error) => {
    if (error?.isTemporarilyUnavailable === true) return true
    if (typeof safeStorage?.isTemporarilyUnavailable === 'function') {
      try {
        if (safeStorage.isTemporarilyUnavailable()) return true
      } catch {
        // The availability probe itself failed; the error below still decides.
      }
    }
    return /temporarily unavailable/i.test(String(error?.message ?? error ?? ''))
  }

  const readTokens = () => {
    let text
    try {
      text = readFileSync(target, 'utf8')
    } catch (error) {
      if (error?.code === 'ENOENT') return { tokens: {} }
      return { error }
    }
    try {
      const saved = JSON.parse(text)
      if (saved?.version !== VERSION || !saved.tokens || typeof saved.tokens !== 'object' || Array.isArray(saved.tokens)) {
        return { error: new Error('the token file is not readable') }
      }
      const tokens = Object.create(null)
      for (const [key, value] of Object.entries(saved.tokens)) {
        if (key === '__proto__') continue
        if (typeof value === 'string' && value !== '') tokens[key] = value
      }
      return { tokens }
    } catch (error) {
      return { error }
    }
  }

  // One atomic replace: a crash or a full disk leaves either the old file or the new one.
  const writeTokens = (tokens) => {
    if (Object.keys(tokens).length === 0) {
      rmSync(target, { force: true })
      return
    }
    const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`
    try {
      writeFileSync(temporary, `${JSON.stringify({ version: VERSION, tokens })}\n`, { mode: 0o600 })
      chmodSync(temporary, 0o600)
      renameSync(temporary, target)
      try {
        chmodSync(target, 0o600)
      } catch {
        // Windows has no meaningful group/other mode; the file is still the owner's.
      }
    } catch (error) {
      try {
        rmSync(temporary, { force: true })
      } catch {
        // Nothing else can be done with the leftover temporary file.
      }
      throw error
    }
  }

  const encrypt = async (token) => {
    const ciphertext = await safeStorage.encryptStringAsync(token)
    return Buffer.from(ciphertext).toString('base64')
  }

  const saveOnly = async (account, token) => {
    if (typeof account !== 'string' || account === '') throw new TypeError('an account or instance is required')
    if (typeof token !== 'string' || token === '') throw new TypeError('a refresh token is required')
    if (!secure) {
      memory.set(account, token)
      return { status: 'memory', reason }
    }
    let encrypted
    try {
      encrypted = await encrypt(token)
    } catch (error) {
      return isTemporarilyUnavailable(error)
        ? { status: 'retry', reason: TRY_LATER_REASON }
        : { status: 'failed', reason: STORAGE_FAILED_REASON }
    }
    const { tokens, error } = readTokens()
    if (error) return { status: 'failed', reason: STORAGE_FAILED_REASON }
    tokens[accountKeyOf(account)] = encrypted
    try {
      writeTokens(tokens)
    } catch {
      return { status: 'failed', reason: STORAGE_FAILED_REASON }
    }
    return { status: 'saved' }
  }

  return Object.freeze({
    /** Whether tokens survive a launch. */
    secure,
    /** The backend safeStorage selected: keychain, dpapi, a Linux secret store, or unknown. */
    backend,
    platform,
    /** Why nothing is kept across launches, or null when the store is secure. */
    reason,
    /** The ciphertext file (never written when `secure` is false). */
    file: target,
    memoryOnly: !secure,

    async load(account) {
      if (typeof account !== 'string' || account === '') throw new TypeError('an account or instance is required')
      if (!secure) {
        return memory.has(account)
          ? { status: 'ok', token: memory.get(account), memory: true }
          : { status: 'empty', reason }
      }
      const { tokens, error } = readTokens()
      if (error) return { status: 'signed-out', reason: SIGNED_OUT_REASON }
      const stored = tokens[accountKeyOf(account)]
      if (typeof stored !== 'string' || stored === '') return { status: 'empty' }
      let decrypted
      try {
        decrypted = await safeStorage.decryptStringAsync(Buffer.from(stored, 'base64'))
      } catch (error) {
        return isTemporarilyUnavailable(error)
          ? { status: 'retry', reason: TRY_LATER_REASON }
          : { status: 'signed-out', reason: SIGNED_OUT_REASON }
      }
      const token = typeof decrypted === 'string' ? decrypted : decrypted?.result
      // A future async API may report unavailability on a resolved result instead of rejecting.
      if (decrypted?.isTemporarilyUnavailable === true) return { status: 'retry', reason: TRY_LATER_REASON }
      if (typeof token !== 'string' || token === '') return { status: 'signed-out', reason: SIGNED_OUT_REASON }
      if (decrypted?.shouldReEncrypt === true) {
        // The key was rotated: write the same token back under the new key. A failure here
        // leaves today's token usable and the old ciphertext in place for the next launch.
        try {
          const next = await encrypt(token)
          const current = readTokens()
          if (!current.error && current.tokens[accountKeyOf(account)] === stored) {
            current.tokens[accountKeyOf(account)] = next
            writeTokens(current.tokens)
          }
        } catch {
          // Not fatal for this launch: the token was decrypted, and the old ciphertext works.
        }
      }
      return { status: 'ok', token }
    },

    save: saveOnly,
    // A refresh exchange replaces the old token with the one the server just issued; the write
    // is one atomic replace, so the old token is never left beside the new one.
    rotate: saveOnly,

    async clear(account) {
      if (typeof account !== 'string' || account === '') throw new TypeError('an account or instance is required')
      if (!secure) {
        memory.delete(account)
        return { status: 'cleared', memory: true }
      }
      const { tokens, error } = readTokens()
      if (error) return { status: 'failed', reason: STORAGE_FAILED_REASON }
      const key = accountKeyOf(account)
      if (!(key in tokens)) return { status: 'cleared' }
      delete tokens[key]
      try {
        writeTokens(tokens)
      } catch {
        return { status: 'failed', reason: STORAGE_FAILED_REASON }
      }
      return { status: 'cleared' }
    },
  })
}
