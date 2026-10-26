// Image generation for the Bots (the generate_image tool), through what the person connected:
// their ChatGPT account (DSH's openai-codex sign-in), the way the Codex CLI makes images on a
// ChatGPT plan, else an OpenAI API key. The welcome's companion step draws through the same two.
// The sign-in is refreshed here when it has run out, inside the credential record's own lock,
// as DSH refreshes it before a chat. A generation streams its partial images when the service
// sends them (the Images API with an API key does; the ChatGPT backend may answer in one piece),
// and the card in the chat (image-cell.js) polls them through `progress`. Images are kept in
// the team workspace's images folder, named by an id the card loads them by.
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { defineTool } from '@deepseek-ai/dsh-tools'

// Where DSH keeps each sign-in (dsh-llm-pi-ai's recordKeyFor): a ChatGPT grant, or a key.
export const CODEX_RECORD = 'llm-pi-ai/openai-codex'
export const OPENAI_RECORD = 'llm-pi-ai/openai'
export const OPENAI_ENV = 'OPENAI_API_KEY'
export const CODEX_IMAGES = 'https://chatgpt.com/backend-api/codex/images/generations'
export const CODEX_IMAGE_MODEL = 'gpt-image-2'
export const OPENAI_IMAGES = 'https://api.openai.com/v1/images/generations'
export const OPENAI_IMAGE_MODEL = 'gpt-image-1'
// The sign-in's own token endpoint and client (pi-ai's openai-codex OAuth).
const TOKEN_URL = 'https://auth.openai.com/oauth/token'
const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
const JWT_CLAIM = 'https://api.openai.com/auth'
const REFRESH_EARLY_MS = 60_000

export const SIZES = Object.freeze(['auto', '1024x1024', '1536x1024', '1024x1536'])
export const QUALITIES = Object.freeze(['auto', 'low', 'medium', 'high'])
export const BACKGROUNDS = Object.freeze(['auto', 'opaque', 'transparent'])
export const PARTIAL_IMAGES = 2
export const MAX_IMAGE_BYTES = 12 * 1024 * 1024
export const PROMPT_MAX = 4000
// A finished generation's progress is kept a while for a card that polls late.
const KEEP_MS = 5 * 60_000
export const IMAGE_ID = /^img-[a-z0-9-]{8,64}$/

const refused = message => Object.assign(new Error(message), { code: 'bot/unavailable' })

/** The ChatGPT account id inside an access token, or undefined. */
export function accountIdOf(token) {
  try {
    const part = String(token).split('.')[1]
    const payload = JSON.parse(Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'))
    const id = payload?.[JWT_CLAIM]?.chatgpt_account_id
    return typeof id === 'string' && id !== '' ? id : undefined
  } catch {
    return undefined
  }
}

/** Server-sent events from a response body, as { event, data } with data parsed when it is JSON. */
export async function* sseEvents(body) {
  const decoder = new TextDecoder()
  let buffer = ''
  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true })
    let at
    while ((at = buffer.search(/\r?\n\r?\n/)) >= 0) {
      const block = buffer.slice(0, at)
      buffer = buffer.slice(at).replace(/^\r?\n\r?\n/, '')
      let event = 'message'
      const data = []
      for (const line of block.split(/\r?\n/)) {
        if (line.startsWith('event:')) event = line.slice(6).trim()
        else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''))
      }
      if (data.length === 0) continue
      const text = data.join('\n')
      let parsed = text
      try { parsed = JSON.parse(text) } catch { parsed = text }
      yield { event, data: parsed }
    }
  }
}

// `credentials` answers DSH's credential service (the plugin does not require one: ctx.get), and
// `folder` the team workspace.
export function createImageGen({ credentials: credentialsOf, folder, fetch = globalThis.fetch, now = () => Date.now(), warn = () => {} }) {
  const progress = new Map()
  // Whether the ChatGPT backend took a streamed request; it is asked once per run.
  let chatgptStreams = true

  // The sign-in's access token, refreshed when it has run out (or is about to).
  async function chatgptToken(payload) {
    if (typeof payload.expires !== 'number' || payload.expires > now() + REFRESH_EARLY_MS) return payload
    const store = credentialsOf()
    if (typeof payload.refresh !== 'string' || typeof store?.modifyRecord !== 'function') return undefined
    const record = await store.modifyRecord(CODEX_RECORD, async (current) => {
      const held = current?.kind === 'grant' ? current.payload : undefined
      // Another process may have refreshed it while this one waited for the lock.
      if (!held || typeof held.expires !== 'number' || held.expires > now() + REFRESH_EARLY_MS) return current
      const response = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: held.refresh, client_id: CLIENT_ID }),
        signal: AbortSignal.timeout(20_000),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok || typeof body.access_token !== 'string' || typeof body.refresh_token !== 'string' || typeof body.expires_in !== 'number') {
        throw refused('Your ChatGPT sign-in could not be renewed. Sign in again in Settings → Models.')
      }
      return { kind: 'grant', payload: { ...held, access: body.access_token, refresh: body.refresh_token, expires: now() + body.expires_in * 1000, accountId: accountIdOf(body.access_token) ?? held.accountId } }
    })
    return record?.kind === 'grant' ? record.payload : undefined
  }

  /** What draws images here: { kind: 'chatgpt' | 'openai', token, accountId? }, or undefined. */
  async function source({ refresh = true } = {}) {
    const credentials = credentialsOf()
    const grant = await credentials?.readRecord?.(CODEX_RECORD).catch(() => undefined)
    const payload = grant?.kind === 'grant' ? grant.payload : undefined
    if (payload && typeof payload.access === 'string') {
      const live = refresh ? await chatgptToken(payload) : payload
      if (live) return { kind: 'chatgpt', token: live.access, accountId: live.accountId ?? accountIdOf(live.access) }
    }
    const record = await credentials?.readRecord?.(OPENAI_RECORD).catch(() => undefined)
    if (record?.kind === 'api-key' && typeof record.key === 'string' && record.key !== '') return { kind: 'openai', token: record.key }
    const env = await credentials?.resolve?.(OPENAI_ENV).catch(() => undefined)
    if (typeof env?.value === 'string' && env.value !== '') return { kind: 'openai', token: env.value }
    return undefined
  }

  /** For settings and the tool's refusal: how images are made here, never what is stored. */
  async function access() {
    const found = await source({ refresh: false })
    return found ? { kind: found.kind, model: found.kind === 'chatgpt' ? CODEX_IMAGE_MODEL : OPENAI_IMAGE_MODEL } : null
  }

  const note = (callId, patch) => {
    if (!callId) return
    const entry = { ...(progress.get(callId) ?? { started: now(), partials: [] }), ...patch, at: now() }
    progress.set(callId, entry)
    for (const [id, old] of progress) if (old.phase !== 'generating' && now() - old.at > KEEP_MS) progress.delete(id)
  }

  /** A card's poll: the phase, how long it has run, and the partial images it has not seen. */
  function progressOf(callId, seen = 0) {
    const entry = progress.get(callId)
    if (!entry) return null
    const from = Math.max(0, Math.min(Number(seen) || 0, entry.partials.length))
    return { phase: entry.phase, started: entry.started, via: entry.via, partials: entry.partials.slice(from).map((base64, index) => ({ index: from + index, image: `data:image/png;base64,${base64}` })), count: entry.partials.length, ...(entry.id ? { id: entry.id } : {}), ...(entry.error ? { error: entry.error } : {}) }
  }

  async function request(found, body, signal) {
    const chatgpt = found.kind === 'chatgpt'
    const headers = chatgpt
      ? { authorization: `Bearer ${found.token}`, 'chatgpt-account-id': found.accountId ?? '', originator: 'codex_cli_rs', 'content-type': 'application/json', accept: 'text/event-stream, application/json' }
      : { authorization: `Bearer ${found.token}`, 'content-type': 'application/json', accept: 'text/event-stream, application/json' }
    return fetch(chatgpt ? CODEX_IMAGES : OPENAI_IMAGES, { method: 'POST', signal, headers, body: JSON.stringify(body) })
      .catch((error) => { throw signal?.aborted ? error : refused('The image service could not be reached. Check the connection and try again.') })
  }

  const failure = async (response) => {
    const body = await response.json().catch(() => ({}))
    const detail = typeof body?.error?.message === 'string' ? body.error.message.slice(0, 240) : typeof body?.detail === 'string' ? body.detail.slice(0, 240) : `HTTP ${response.status}`
    return refused(`The image was not made: ${detail}`)
  }

  // The final image of a response: streamed (partials on the way) or in one JSON answer.
  async function imageOf(response, onPartial) {
    if ((response.headers.get('content-type') ?? '').includes('text/event-stream')) {
      for await (const { event, data } of sseEvents(response.body)) {
        const type = typeof data === 'object' && data !== null && typeof data.type === 'string' ? data.type : event
        if (type.endsWith('partial_image') && typeof data.b64_json === 'string') onPartial(data.b64_json, Number(data.partial_image_index) || 0)
        else if (type.endsWith('partial_image') && typeof data.partial_image_b64 === 'string') onPartial(data.partial_image_b64, Number(data.partial_image_index) || 0)
        else if (type.endsWith('.completed') && typeof data.b64_json === 'string') return { base64: data.b64_json, size: data.size }
        else if (type === 'error' || type.endsWith('.failed')) throw refused(`The image was not made: ${String(data?.error?.message ?? data?.message ?? 'the service stopped').slice(0, 240)}`)
      }
      throw refused('The image service stopped before the image was finished. Try again.')
    }
    const body = await response.json().catch(() => ({}))
    const item = Array.isArray(body?.data) ? body.data[0] : undefined
    if (typeof item?.b64_json === 'string') return { base64: item.b64_json, size: body.size }
    if (typeof item?.url === 'string' && item.url.startsWith('https://')) {
      const fetched = await fetch(item.url).catch(() => undefined)
      if (fetched?.ok) return { base64: Buffer.from(await fetched.arrayBuffer()).toString('base64'), size: body.size }
    }
    throw refused('The image service answered without an image. Try again.')
  }

  /**
   * Draws one image and keeps it. Returns { id, file, via, bytes }. `callId` names the card
   * that follows its progress.
   */
  async function generate({ prompt, size = 'auto', quality = 'auto', background = 'auto', callId, signal }) {
    const text = String(prompt ?? '').trim().slice(0, PROMPT_MAX)
    if (text === '') throw Object.assign(new Error('Say what to draw.'), { code: 'bot/invalid' })
    const found = await source()
    if (!found) throw refused('No image service is connected. Ask the user to sign in to ChatGPT or add an OpenAI key in Settings → Models; then generate_image can draw.')
    const chatgpt = found.kind === 'chatgpt'
    note(callId, { phase: 'generating', via: found.kind, partials: [], started: now(), error: undefined })
    const base = {
      model: chatgpt ? CODEX_IMAGE_MODEL : OPENAI_IMAGE_MODEL,
      prompt: text,
      size: SIZES.includes(size) ? size : 'auto',
      quality: QUALITIES.includes(quality) ? quality : 'auto',
      ...(BACKGROUNDS.includes(background) && background !== 'auto' ? { background } : {}),
      ...(chatgpt ? {} : { n: 1 }),
    }
    const streamed = { ...base, stream: true, partial_images: PARTIAL_IMAGES }
    const onPartial = (base64, index) => {
      const entry = progress.get(callId)
      if (!entry || Buffer.byteLength(base64, 'base64') > MAX_IMAGE_BYTES) return
      const partials = [...entry.partials]
      partials[Math.min(index, partials.length)] = base64
      note(callId, { partials })
    }
    try {
      let response = await request(found, chatgpt && !chatgptStreams ? base : streamed, signal)
      // A backend that does not take a streamed request answers 400 naming it: asked again whole.
      if (chatgpt && chatgptStreams && response.status === 400) {
        const said = await response.clone().text().catch(() => '')
        if (/stream|partial/i.test(said)) {
          chatgptStreams = false
          response = await request(found, base, signal)
        }
      }
      if (!response.ok) throw await failure(response)
      const image = await imageOf(response, onPartial)
      const bytes = Buffer.from(image.base64, 'base64')
      if (bytes.length > MAX_IMAGE_BYTES) throw refused('The image is too large to keep. Try again.')
      const dir = folder()
      if (!dir) throw refused('The team has no workspace folder to keep the image in.')
      const id = `img-${randomUUID()}`
      await mkdir(join(dir, 'images'), { recursive: true })
      const file = join(dir, 'images', `${id}.png`)
      await writeFile(`${file}.tmp`, bytes)
      await rename(`${file}.tmp`, file)
      note(callId, { phase: 'done', id })
      return { id, file, via: found.kind, bytes: bytes.length, size: image.size ?? base.size }
    } catch (error) {
      note(callId, { phase: 'failed', error: String(error?.message ?? error).slice(0, 300) })
      if (signal?.aborted) warn('ds-bot: an image generation was stopped')
      throw error
    }
  }

  /** A kept image's bytes for the card, by its id; undefined for any other name. */
  async function imageFile(id) {
    const dir = folder()
    if (!dir || !IMAGE_ID.test(String(id ?? ''))) return undefined
    return readFile(join(dir, 'images', `${id}.png`)).catch(() => undefined)
  }

  return { access, generate, progress: progressOf, imageFile, source }
}

// The generate_image tool, for every Bot (Genie and Omni among them), and `rt.images` for the
// channel's endpoints and the image route.
export function install(rt) {
  const { ctx } = rt
  const images = createImageGen({
    credentials: () => { try { return ctx.get?.('credentials') } catch { return undefined } },
    folder: () => rt.teamFolder?.(),
    warn: (...args) => rt.warn?.(...args),
  })
  rt.images = images
  ctx.tools.register(defineTool({
    name: 'generate_image',
    description: 'Draw a new image from a description, with the image model of the user\'s ChatGPT account or OpenAI key. The user watches it being drawn in the chat, and the finished image is saved in the team workspace (its path comes back). Write the prompt as a full visual brief: the subject, the composition, the style or medium, the colors and the light; put any words that must appear in the image in quotes. One image per call; it takes up to two minutes.',
    parameters: {
      prompt: { type: 'string', required: true, description: 'What to draw, as a full visual brief' },
      size: { type: 'string', enum: SIZES, description: 'Square 1024x1024, landscape 1536x1024, portrait 1024x1536, or auto (the default) to let the model choose' },
      quality: { type: 'string', enum: QUALITIES, description: 'auto (the default); low is fastest, high is most detailed' },
      background: { type: 'string', enum: BACKGROUNDS, description: 'transparent for a cut-out (a logo, a sticker, an icon); auto otherwise' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: String(value) }] },
    timeoutMs: 180_000,
    async execute(args, exec) {
      try {
        const made = await images.generate({ prompt: args.prompt, size: args.size, quality: args.quality, background: args.background, callId: exec.callId, signal: exec.signal })
        const via = made.via === 'chatgpt' ? 'the user\'s ChatGPT account' : 'the user\'s OpenAI key'
        return `Drew the image with ${via} and saved it as ${made.file}. It is on screen in the chat, so do not describe it back; give its path to send or use it elsewhere.`
      } catch (error) {
        if (exec.signal?.aborted) return 'The image was stopped before it was finished.'
        return String(error?.message ?? error)
      }
    },
  }))
}
