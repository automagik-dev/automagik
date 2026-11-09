// Connect AI's real connections: an API key saved the way DSH's Models page saves one, and a
// subscription sign-in run through DSH's own authorization flows (pi-ai registers one per
// provider), with the flow's links, codes and questions relayed to the page that asked.
//
//   providers                     what each tile's provider has: a key, a sign-in, a route
//   provider-key { provider, apiKey }
//                                 stores the key in DSH's credential store under the
//                                 reference the Models page would use, and points the
//                                 provider's pi-ai route at it (DeepSeek: DSH's own key)
//   signin-start { provider }     starts the provider's sign-in; its pi-ai route is added
//                                 once the sign-in succeeds, so a cancelled one leaves none
//   signin-status { provider }    the attempt: running, authorized, cancelled or failed,
//                                 its latest notice (message, url, code) and open question
//   signin-answer { provider, promptId, value }
//   signin-cancel { provider }
//
// Connect AI signs Claude and ChatGPT in only through their CLIs, Claude Code and Codex
// (ais.js): DSH's own sign-ins to them (pi-ai's anthropic Pro/Max and openai-codex) are not
// started here. A record an earlier version stored stays where it is (image generation still
// reads openai-codex's). An Anthropic API key still goes on pi-ai's anthropic route
// (ANTHROPIC_API_KEY).
//
// The browser never sees a key or a token: it sees the flow's notices and answers its
// questions. A sign-in lives in this process; reloading the page leaves it running, and
// signin-status picks it up again.
import { randomUUID } from 'node:crypto'
import { Answer, AnswerPayload, KeyPayload, ProviderPayload, Secret, parse } from './payloads.js'

export const PI_AI = 'llm-pi-ai'
// pi-ai's credential record scope: a sign-in is the record llm-pi-ai/<provider>.
const RECORD_SCOPE = 'llm-pi-ai'
// Providers a key can connect. DeepSeek's key is DSH's own DeepSeek route's, not a pi-ai route.
export const KEY_PROVIDERS = {
  deepseek: { label: 'DeepSeek', ref: 'DEEPSEEK_API_KEY', route: false },
  openai: { label: 'OpenAI' },
  anthropic: { label: 'Anthropic' },
  zai: { label: 'Z.ai' },
  opencode: { label: 'OpenCode' },
  openrouter: { label: 'OpenRouter' },
  moonshotai: { label: 'Moonshot (Kimi API)' },
  xai: { label: 'xAI' },
}
// Providers a subscription sign-in can connect, by pi-ai's provider id. Claude and ChatGPT
// are not among them: their plans sign in through their CLIs.
export const SIGNIN_PROVIDERS = {
  'kimi-coding': { label: 'Kimi Code' },
  'github-copilot': { label: 'GitHub Copilot' },
  xai: { label: 'Grok' },
}
// What the route of DSH's own Claude sign-in held beyond its provider, as earlier versions
// wrote it: a Claude plan at its limit answers with a 429 (rate_limit_error), which DSH's
// default policy retries five times, about 16 s, before the Bot team's fallback model gets the
// turn, so that plan's 429 was not retried. A key saved on such a route drops it (saveRoute).
export const SIGNIN_ROUTES = {
  anthropic: { retryPolicy: { mode: 'normal', retryableCodes: ['EMPTY_RESPONSE', 'SERVER', 'TIMEOUT', 'TRANSPORT'] } },
}
// A finished attempt is kept this long, so a page that comes back still learns how it ended.
const KEEP_MS = 10 * 60 * 1000

const failure = (code, message) => Object.assign(new Error(message), { code })
const invalid = message => failure('omni-ai/invalid', message)
const refused = message => failure('omni-ai/refused', message)

// The reference DSH's Models page derives for a provider's key (OPENAI_CODEX_API_KEY).
export const keyRefOf = provider => `${provider.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_API_KEY`
const recordKeyOf = provider => `${RECORD_SCOPE}/${provider}`

const providerArg = (payload, table) => {
  const provider = parse(ProviderPayload, payload)?.provider ?? ''
  if (!Object.hasOwn(table, provider)) throw invalid(`No provider "${provider.slice(0, 40)}" here`)
  return provider
}

const piAiEntry = (ctx) => {
  try {
    return ctx.settings.describe().find(row => row.ns === PI_AI)
  } catch {
    return undefined
  }
}

// DSH's retry defaults (dsh-llm resolveRetryPolicy). DSH's settings describe a route as its
// schema resolved it, so a stored policy carries these filled in.
const RETRY_DEFAULTS = Object.freeze({ maxRetries: 5, backoff: Object.freeze({ initialDelayMs: 500, maxDelayMs: 10_000, jitterRatio: 0.1 }) })
const sameCodes = (a, b) => Array.isArray(a) && Array.isArray(b) && new Set(a).size === new Set(b).size && b.every(code => a.includes(code))
const unsetOr = (value, fallback) => value === undefined || value === fallback

/**
 * Whether a stored retry policy is the sign-in's (SIGNIN_ROUTES), as written or as DSH's
 * schema resolved it: the same mode and codes, and every other field absent or DSH's default.
 */
export function isSigninPolicy(stored, signin) {
  if (stored === null || typeof stored !== 'object' || signin === undefined) return false
  const { mode, retryableCodes, maxRetries, backoff, ...other } = stored
  if (Object.keys(other).length > 0 || mode !== signin.mode || !sameCodes(retryableCodes, signin.retryableCodes)) return false
  if (!unsetOr(maxRetries, RETRY_DEFAULTS.maxRetries)) return false
  if (backoff === undefined) return true
  if (backoff === null || typeof backoff !== 'object') return false
  const { initialDelayMs, maxDelayMs, jitterRatio, ...more } = backoff
  const d = RETRY_DEFAULTS.backoff
  return Object.keys(more).length === 0 && unsetOr(initialDelayMs, d.initialDelayMs) && unsetOr(maxDelayMs, d.maxDelayMs) && unsetOr(jitterRatio, d.jitterRatio)
}

// Write one route under llm-pi-ai.providers, keeping what it already holds. A route that
// does not exist yet is added; DSH checks it before the change applies. A route that takes a
// key leaves the sign-in's retry policy (isSigninPolicy): a key's 429 is DSH's to retry. A
// policy someone set by hand stays.
export async function saveRoute(ctx, provider, patch) {
  const entry = piAiEntry(ctx)
  if (entry === undefined) throw refused('This DSH has no pi-ai entry (llm-pi-ai) to connect providers with.')
  const current = entry.value?.providers?.[provider]
  const route = { ...(current && typeof current === 'object' ? current : {}), ...patch }
  if (patch.apiKeyEnv !== undefined && !Object.hasOwn(patch, 'retryPolicy') && isSigninPolicy(route.retryPolicy, SIGNIN_ROUTES[provider]?.retryPolicy)) {
    delete route.retryPolicy
  }
  try {
    await ctx.settings.mutate(PI_AI, [{ op: 'set', path: ['providers', provider], value: route }], entry.revision)
  } catch (error) {
    if (error?.code === 'SETTINGS_CONFLICT') throw refused('DSH\'s model settings changed while saving. Try again.')
    throw refused(`DSH did not save the ${provider} route: ${error?.message ?? error}`)
  }
}

// Removes one route from llm-pi-ai.providers. The key or sign-in it used stays stored.
export async function unsetRoute(ctx, provider) {
  const entry = piAiEntry(ctx)
  if (entry === undefined || !Object.hasOwn(entry.value?.providers ?? {}, provider)) return
  try {
    await ctx.settings.mutate(PI_AI, [{ op: 'unset', path: ['providers', provider] }], entry.revision)
  } catch (error) {
    if (error?.code === 'SETTINGS_CONFLICT') throw refused('DSH\'s model settings changed while saving. Try again.')
    throw refused(`DSH did not remove the ${provider} route: ${error?.message ?? error}`)
  }
}

const configured = async (read) => {
  try {
    return (await read())?.configured === true
  } catch {
    return false
  }
}

// DSH's authorization service, looked up when used: it is not a declared dependency, so the
// welcome still loads in a DSH that has none (sign-ins are then refused, keys still work).
const authorizationOf = (ctx) => {
  try {
    return ctx.get?.('authorization') ?? undefined
  } catch {
    return undefined
  }
}

export function createProviderActions(ctx) {
  // One attempt per provider: { id, status, notice, prompt, error, answer, finishedAt }.
  const attempts = new Map()
  const view = (provider) => {
    const attempt = attempts.get(provider)
    if (!attempt) return { provider, status: 'none' }
    const prompt = attempt.prompt ? { id: attempt.prompt.id, kind: attempt.prompt.kind, message: attempt.prompt.message, placeholder: attempt.prompt.placeholder, options: attempt.prompt.options } : null
    return { provider, status: attempt.status, notice: attempt.notice, prompt, error: attempt.error }
  }
  const prune = () => {
    for (const [provider, attempt] of attempts) {
      if (attempt.finishedAt && Date.now() - attempt.finishedAt > KEEP_MS) attempts.delete(provider)
    }
  }

  return {
    async providers() {
      const providers = piAiEntry(ctx)?.value?.providers ?? {}
      const out = {}
      for (const [provider, info] of Object.entries(KEY_PROVIDERS)) {
        out[provider] = { ...out[provider], key: await configured(() => ctx.credentials.describe(info.ref ?? keyRefOf(provider))), route: info.route === false || Object.hasOwn(providers, provider) }
      }
      for (const provider of Object.keys(SIGNIN_PROVIDERS)) {
        out[provider] = { ...out[provider], signedIn: await configured(() => ctx.credentials.describeRecord(recordKeyOf(provider))), route: Object.hasOwn(providers, provider), signIn: authorizationOf(ctx)?.describe?.(recordKeyOf(provider)) !== undefined }
      }
      return out
    },

    async 'provider-key'(payload) {
      const provider = providerArg(payload, KEY_PROVIDERS)
      const apiKey = parse(Secret, parse(KeyPayload, payload)?.apiKey)
      if (apiKey === undefined) throw invalid('Paste the whole API key.')
      const info = KEY_PROVIDERS[provider]
      const ref = info.ref ?? keyRefOf(provider)
      // Kept to put back if DSH refuses the route, so a failed save leaves the old key in place.
      // A key that came from the environment rather than DSH's store ("file") is not copied in.
      const previous = await ctx.credentials.resolve(ref).catch(() => undefined)
      await ctx.credentials.set(ref, apiKey)
      if (info.route !== false) {
        try {
          await saveRoute(ctx, provider, { apiKeyEnv: ref })
        } catch (error) {
          await (previous?.source === 'file' ? ctx.credentials.set(ref, previous.value) : ctx.credentials.unset(ref)).catch(() => {})
          throw error
        }
      }
      return { provider, connected: true }
    },

    async 'signin-start'(payload) {
      const provider = providerArg(payload, SIGNIN_PROVIDERS)
      prune()
      const authorization = authorizationOf(ctx)
      if (!authorization) throw refused('This DSH cannot run sign-ins (no authorization service).')
      const key = recordKeyOf(provider)
      if (authorization.describe(key) === undefined) throw refused(`This DSH offers no ${SIGNIN_PROVIDERS[provider].label} sign-in.`)
      // A page reloaded mid-sign-in finds this one running rather than beginning another.
      if (attempts.get(provider)?.status === 'running') return view(provider)
      const attempt = { id: randomUUID(), status: 'running', notice: null, prompt: null, error: null, finishedAt: 0 }
      attempts.set(provider, attempt)
      const interaction = {
        notify(notice) {
          attempt.notice = { message: String(notice?.message ?? ''), url: typeof notice?.url === 'string' ? notice.url : undefined, code: typeof notice?.code === 'string' ? notice.code : undefined }
        },
        prompt(prompt) {
          return new Promise((resolve, reject) => {
            const asked = {
              id: randomUUID(),
              kind: ['text', 'secret', 'select'].includes(prompt?.kind) ? prompt.kind : 'text',
              message: String(prompt?.message ?? ''),
              placeholder: typeof prompt?.placeholder === 'string' ? prompt.placeholder : undefined,
              options: Array.isArray(prompt?.options) ? prompt.options.map(option => ({ id: String(option.id), label: String(option.label ?? option.id), description: option.description ? String(option.description) : undefined })) : undefined,
              resolve,
              reject,
            }
            attempt.prompt = asked
            prompt?.signal?.addEventListener?.('abort', () => {
              if (attempt.prompt === asked) attempt.prompt = null
              reject(new Error('withdrawn'))
            }, { once: true })
          })
        },
      }
      authorization.begin({ key, method: 'oauth', interaction })
        .then(async (outcome) => {
          if (outcome?.status !== 'authorized') {
            attempt.status = 'cancelled'
            return
          }
          // Only a finished sign-in gets a route. A sign-in sits beneath a key: a route that is
          // already there (with apiKeyEnv, the key's) is left as it is.
          const routes = piAiEntry(ctx)?.value?.providers ?? {}
          if (!Object.hasOwn(routes, provider)) await saveRoute(ctx, provider, {})
          attempt.status = 'authorized'
        })
        .catch((error) => {
          attempt.status = 'failed'
          attempt.error = String(error?.message ?? error).slice(0, 300)
        })
        .finally(() => {
          attempt.prompt = null
          attempt.finishedAt = Date.now()
        })
      return view(provider)
    },

    async 'signin-status'(payload) {
      return view(providerArg(payload, SIGNIN_PROVIDERS))
    },

    async 'signin-answer'(payload) {
      const provider = providerArg(payload, SIGNIN_PROVIDERS)
      const attempt = attempts.get(provider)
      const asked = attempt?.prompt
      const fields = parse(AnswerPayload, payload)
      if (!asked || asked.id !== fields?.promptId) throw refused('That question is no longer open.')
      const value = parse(Answer, fields.value)
      if (value === undefined) throw invalid('Type an answer.')
      if (asked.kind === 'select' && !asked.options?.some(option => option.id === value)) throw invalid('Pick one of the options.')
      attempt.prompt = null
      asked.resolve(value)
      return view(provider)
    },

    async 'signin-cancel'(payload) {
      const provider = providerArg(payload, SIGNIN_PROVIDERS)
      const attempt = attempts.get(provider)
      if (attempt?.status === 'running') {
        authorizationOf(ctx)?.cancel?.(recordKeyOf(provider))
        attempt.prompt?.reject(new Error('cancelled'))
        attempt.prompt = null
      }
      return view(provider)
    },
  }
}
