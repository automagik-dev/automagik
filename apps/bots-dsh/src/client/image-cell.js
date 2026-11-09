import { createElement as h, useEffect, useRef, useState } from 'react'
import { call } from './api.js'
import { CopyIcon, DownloadIcon } from './icons.js'
import { t } from './i18n.js'
import { faceAt } from './clay-art.js'

// -------------------------------------------------------------------------
// An image being made in the chat (a generate_image call, or an agent's own image tool): Omni
// paints while it is made, with how long it has run; the partial images a service streams (the
// Images API sends two) take Omni's place, sharper each time, and the finished image fades in
// where Omni was. Progress comes from the host (imagegen.js) by polling, since a tool call
// reports nothing until it ends. A finished image loads by its id from the image route, so it
// shows again in a reopened chat.

const POLL_MS = 800
const IMAGE_ID = /images[\\/](img-[a-z0-9-]{8,64})\.png/
export const imageIdOf = text => IMAGE_ID.exec(String(text ?? ''))?.[1]
export const imageUrl = id => `api/omni-ui/image?id=${encodeURIComponent(id)}`
// An image an agent makes with its own tool (a Bot on Codex asked for a picture): acp-dsh's mirror
// call (`acp_tool`) says `image: true` from its first sight when the agent titled it as image
// generation, and its result names the image it kept (acp-dsh's agent-image.js), so another
// agent's call that answered with an image draws here once it ends.
export const AGENT_TOOL = 'acp_tool'
export const AGENT_KEPT_TEXT = 'Image generated and saved as'
export const isAgentImageCall = ({ name, image, done, content }) => name === AGENT_TOOL
  && (image === true || (done === true && String(content ?? '').startsWith(AGENT_KEPT_TEXT) && imageIdOf(content) !== undefined))
// The prompt an agent's image call carries, when it carries one.
export const agentPromptOf = (input) => {
  const prompt = input?.prompt ?? input?.revised_prompt ?? input?.revisedPrompt
  return typeof prompt === 'string' && prompt !== '' ? prompt : undefined
}

// The frame's shape before the image says its own.
export const ratioOf = size => ({ '1536x1024': '3 / 2', '1024x1536': '2 / 3' }[size] ?? '1 / 1')

// While the image is made, Omni paints it (the owner's choice, "B · Omni paints"): Omni's own
// clay art and nothing behind it, swaying, its face moving through focused, pleased, focused,
// delighted, focused, curious every 0.9 s, four dabs of the Automagik colours popping around it.
// With reduced motion (or the team's quiet motion) Omni stands still and focused, no dabs.
export const PAINT_FACES = Object.freeze(['focused', 'pleased', 'focused', 'delighted', 'focused', 'curious'])
const FACE_MS = 900
const still = () => typeof document !== 'undefined'
  && (document.body?.dataset?.btMotion === 'quiet' || globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true)

function useFace(running) {
  const [at, setAt] = useState(0)
  useEffect(() => {
    if (!running || still()) return undefined
    const timer = setInterval(() => setAt(n => (n + 1) % PAINT_FACES.length), FACE_MS)
    return () => clearInterval(timer)
  }, [running])
  return PAINT_FACES[at] ?? PAINT_FACES[0]
}

function useElapsed(running, since) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!running) return undefined
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [running])
  return Math.max(0, Math.floor((now - (since ?? now)) / 1000))
}

// The host's progress for this call while it draws: { phase, started, partial, count, error }.
function useProgress(callId, running) {
  const [state, setState] = useState({ phase: running ? 'generating' : undefined, partial: undefined, count: 0, started: undefined })
  const seen = useRef(0)
  useEffect(() => {
    if (!running || !callId) return undefined
    let live = true
    let timer
    const poll = async () => {
      const next = await call('image-progress', { callId, seen: seen.current }).catch(() => null)
      if (!live) return
      if (next) {
        const latest = next.partials?.at(-1)
        if (latest) seen.current = latest.index + 1
        setState(prev => ({ phase: next.phase, started: next.started, count: next.count, error: next.error, partial: latest?.image ?? prev.partial }))
        if (next.phase !== 'generating') return
      }
      timer = setTimeout(poll, POLL_MS)
    }
    void poll()
    return () => { live = false; clearTimeout(timer) }
  }, [callId, running])
  return state
}

/** Omni painting: the clay octopus (the team's own atlas, clay-art.js) and its four dabs. */
export function OmniPaints({ face = PAINT_FACES[0] }) {
  return h('div', { className: 'bt-img-paint', 'aria-hidden': true },
    h('i', { className: 'bt-img-dab' }), h('i', { className: 'bt-img-dab' }), h('i', { className: 'bt-img-dab' }), h('i', { className: 'bt-img-dab' }),
    h('span', { className: 'bt-img-omni', 'data-face': face },
      h('span', { className: 'bt-clay bt-clay-omni', style: { '--bt-face-at': faceAt(face) } })))
}

async function copyImage(url) {
  const blob = await (await fetch(url)).blob()
  await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })])
}

/**
 * The image card: Omni paints while the image is made (a partial image the service streams
 * takes Omni's place, sharper each time), and the finished image fades in where Omni was once
 * it has loaded. A call that failed or was stopped says the image was not made, and why; an
 * image that was made but no longer loads says so, and Omni stops painting.
 */
export function ImageCell({ callId, prompt, size, done, content, isError }) {
  const running = !done
  const progress = useProgress(callId, running)
  // Until the host says when it started, the card counts from when it first showed.
  const [shown] = useState(() => Date.now())
  const elapsed = useElapsed(running, progress.started ?? shown)
  const id = done ? imageIdOf(content) : undefined
  // The finished image: 'loading' until it shows, 'loaded', or 'lost' when it cannot load (its
  // file is no longer in the team folder, say after the workspace moved or was cleaned).
  const [image, setImage] = useState('loading')
  const loaded = image === 'loaded'
  const [copied, setCopied] = useState(false)
  const face = useFace(running || (id !== undefined && image === 'loading'))
  const failed = done && (isError || id === undefined)
  if (failed || (id !== undefined && image === 'lost')) {
    return h('div', { className: 'bt-img bt-img-failed', role: 'status', 'data-state': failed ? 'failed' : 'lost' },
      h('div', { className: 'bt-img-failed-title' }, failed ? t('The image was not made') : t('The image could not be shown')),
      h('div', { className: 'bt-img-failed-why' }, failed ? String(content ?? '').slice(0, 300) : t('This image is no longer in the team folder.')))
  }
  const url = id ? imageUrl(id) : undefined
  const partial = url ? undefined : progress.partial
  const step = progress.count > 0 ? Math.min(progress.count, 2) : 0
  const state = url ? (loaded ? 'done' : 'arriving') : partial ? 'partial' : 'drawing'
  // Omni stays until there is a picture to show in its place.
  const painting = state === 'drawing' || state === 'arriving'
  return h('figure', { className: 'bt-img', 'data-state': state },
    h('div', { className: 'bt-img-frame', style: painting ? undefined : { aspectRatio: ratioOf(size) } },
      painting ? h(OmniPaints, { face }) : null,
      partial ? h('img', { className: 'bt-img-partial', 'data-step': step, src: partial, alt: '', draggable: false }) : null,
      url ? h('img', { className: 'bt-img-final', src: url, alt: prompt ?? '', onLoad: () => setImage('loaded'), onError: () => setImage('lost') }) : null,
      url && loaded
        ? h('div', { className: 'bt-img-tools' },
            h('a', { className: 'bt-img-tool', href: url, download: `${id}.png`, title: t('Save image'), 'aria-label': t('Save image') }, h(DownloadIcon)),
            typeof ClipboardItem === 'function' ? h('button', { type: 'button', className: 'bt-img-tool', title: copied ? t('Copied') : t('Copy image'), 'aria-label': t('Copy image'), onClick: () => { void copyImage(url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) }, () => {}) } }, h(CopyIcon)) : null)
        : null),
    url && loaded
      ? null
      : h('figcaption', { className: 'bt-img-status', role: 'status' },
          h('span', { className: 'bt-img-dot', 'aria-hidden': true }),
          h('b', { className: 'bt-img-caption' }, t('Painting your image…')),
          h('span', { className: 'bt-img-time' }, `${elapsed}s`)))
}

// No card behind Omni while it paints: only Omni, its dabs and the caption. The frame takes the
// image's shape, with the card's edge, once there is a picture in it.
export const IMAGE_CELL_CSS = `
.bt-img{box-sizing:border-box;margin:6px 0;width:min(100%,440px);display:flex;flex-direction:column;gap:8px}
.bt-img-frame{position:relative;height:210px;display:grid;place-items:center}
.bt-img:is([data-state=partial],[data-state=done]) .bt-img-frame{height:auto;border-radius:18px;overflow:hidden;background:var(--bt-card);box-shadow:0 0 0 1px var(--bt-line),0 10px 30px -18px color-mix(in srgb,var(--bt-ink) 50%,transparent);isolation:isolate}
.bt-img-paint{position:absolute;inset:0;display:grid;place-items:center;pointer-events:none}
.bt-img-omni{position:relative;z-index:1;width:132px;height:132px;display:flex;justify-content:center;animation:bt-img-sway 1.2s ease-in-out infinite alternate;transform-origin:50% 90%}
.bt-img-omni .bt-clay{height:100%}
.bt-img-dab{position:absolute;width:18px;height:18px;border-radius:50%;opacity:0;animation:bt-img-dab 2.4s ease-out infinite}
.bt-img-dab:nth-child(1){background:var(--bt-magic-violet);left:22%;top:22%}
.bt-img-dab:nth-child(2){background:var(--bt-magic-cyan);right:22%;top:30%;animation-delay:.6s}
.bt-img-dab:nth-child(3){background:var(--bt-magic-pink);left:28%;bottom:30%;animation-delay:1.2s}
.bt-img-dab:nth-child(4){background:var(--bt-gold);right:26%;bottom:34%;animation-delay:1.8s}
.bt-img-partial,.bt-img-final{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block}
.bt-img-partial{filter:blur(16px) saturate(1.1);transform:scale(1.06);transition:filter .8s ease,transform .8s ease;animation:bt-img-in .6s ease both}
.bt-img-partial[data-step="2"]{filter:blur(6px);transform:scale(1.02)}
.bt-img-final{opacity:0}
.bt-img[data-state=done] .bt-img-final{opacity:1;animation:bt-img-in .5s ease both}
.bt-img-status{display:flex;align-items:center;gap:8px;margin:0;color:var(--bt-ink-2);font:400 13px/18px var(--bt-font);font-variant-numeric:tabular-nums}
.bt-img-caption{color:var(--bt-ink);font-weight:600}
.bt-img-dot{flex:none;width:7px;height:7px;border-radius:50%;background:var(--bt-magic-violet);animation:bt-img-pulse 1.2s ease-in-out infinite}
.bt-img-tools{position:absolute;top:8px;right:8px;display:flex;gap:6px;opacity:0;transition:opacity .15s ease}
.bt-img:hover .bt-img-tools,.bt-img:focus-within .bt-img-tools{opacity:1}
.bt-img-tool{display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;border:0;border-radius:10px;background:color-mix(in srgb,var(--bt-card) 85%,transparent);backdrop-filter:blur(8px);color:var(--bt-ink);cursor:pointer}
.bt-img-tool:hover{background:var(--bt-card)}
.bt-img-failed{padding:14px 16px;gap:4px;border-radius:18px;background:var(--bt-card);box-shadow:0 0 0 1px var(--bt-line)}
.bt-img-failed-title{font:600 14px/20px var(--bt-font);color:var(--bt-ink)}
.bt-img-failed-why{font:400 12px/16px var(--bt-font);color:var(--bt-ink-2)}
@keyframes bt-img-sway{from{transform:rotate(-6deg)}to{transform:rotate(6deg)}}
@keyframes bt-img-dab{0%{transform:scale(.2);opacity:0}20%{transform:scale(1.1);opacity:1}70%{opacity:.9}100%{transform:scale(.9) translateY(-14px);opacity:0}}
@keyframes bt-img-pulse{50%{opacity:.35}}
@keyframes bt-img-in{from{opacity:0}to{opacity:1}}
@media (prefers-reduced-motion:reduce){.bt-img-omni,.bt-img-dot,.bt-img-partial,.bt-img-final{animation:none!important}.bt-img-dab{display:none}}
body[data-bt-motion=quiet] :is(.bt-img-omni,.bt-img-dot,.bt-img-partial,.bt-img-final){animation:none!important}
body[data-bt-motion=quiet] .bt-img-dab{display:none}
`

// Settings → Bots: what draws the Bots' images here, so the person knows before asking.
export function ImagesSection({ Section, Row }) {
  const [access, setAccess] = useState(undefined)
  useEffect(() => { void call('image-access').then(setAccess, () => setAccess(null)) }, [])
  const label = access === undefined ? t('Loading…')
    : access === null ? t('Not connected')
      : access.kind === 'codex' ? t('Codex, on your ChatGPT plan')
        : access.kind === 'chatgpt' ? t('Your ChatGPT account') : t('Your OpenAI key')
  const hint = access === null
    ? t('Sign in to Codex from a Bot\'s chat, or add an OpenAI key in Settings → Models, and every Bot can draw images in its chats.')
    : t('Every Bot can draw images in its chats. They are saved in the team workspace\'s images folder.')
  return h(Section, { title: t('Images') },
    h(Row, { label: t('Drawn with'), hint }, h('span', { className: 'bt-set-hint' }, access?.model ? `${label} · ${access.model}` : label)))
}
