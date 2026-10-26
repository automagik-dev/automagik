import { createElement as h, useEffect, useRef, useState } from 'react'
import { call } from './api.js'
import { CopyIcon, DownloadIcon } from './icons.js'
import { t } from './i18n.js'

// -------------------------------------------------------------------------
// The generate_image call in the chat: the image being drawn, then the image. While the model
// draws, the frame (in the shape the Bot asked for) is a slow drift of the Automagik colors
// under a passing light, with what it is drawing and for how long; the partial images the
// service streams (the Images API sends two) replace it, sharper each time, and the finished
// image settles in from a blur. Progress comes from the host (imagegen.js) by polling, since
// a tool call reports nothing until it ends. A finished image loads by its id from the image
// route, so it shows again in a reopened chat.

const POLL_MS = 800
const IMAGE_ID = /images[\\/](img-[a-z0-9-]{8,64})\.png/
export const imageIdOf = text => IMAGE_ID.exec(String(text ?? ''))?.[1]
export const imageUrl = id => `api/omni-ui/image?id=${encodeURIComponent(id)}`
// The frame's shape before the image says its own.
export const ratioOf = size => ({ '1536x1024': '3 / 2', '1024x1536': '2 / 3' }[size] ?? '1 / 1')

// What the drawing is at, by how long it has run (no service says), so a long wait reads as work.
const STAGES = [[0, 'Reading the brief'], [4, 'Sketching the composition'], [14, 'Laying in the color'], [30, 'Working the details'], [55, 'Finishing touches'], [90, 'Almost there']]
export const stageOf = seconds => STAGES.reduce((found, [from, label]) => (seconds >= from ? label : found), STAGES[0][1])

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

async function copyImage(url) {
  const blob = await (await fetch(url)).blob()
  await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })])
}

export function ImageCell({ callId, prompt, size, done, content, isError }) {
  const running = !done
  const progress = useProgress(callId, running)
  const elapsed = useElapsed(running, progress.started)
  const id = done ? imageIdOf(content) : undefined
  const [loaded, setLoaded] = useState(false)
  const [copied, setCopied] = useState(false)
  const failed = done && (isError || id === undefined)
  const ratio = ratioOf(size)
  if (failed) {
    return h('div', { className: 'bt-img bt-img-failed', role: 'status' },
      h('div', { className: 'bt-img-failed-title' }, t('The image was not made')),
      h('div', { className: 'bt-img-failed-why' }, String(content ?? '').slice(0, 300)))
  }
  const url = id ? imageUrl(id) : undefined
  const partial = progress.partial
  const step = progress.count > 0 ? Math.min(progress.count, 2) : 0
  return h('figure', { className: 'bt-img', 'data-state': url ? (loaded ? 'done' : 'arriving') : partial ? 'partial' : 'drawing', style: { aspectRatio: ratio } },
    h('div', { className: 'bt-img-dev', 'aria-hidden': true }, h('i'), h('i'), h('i'), h('span', { className: 'bt-img-light' })),
    partial ? h('img', { className: 'bt-img-partial', 'data-step': step, src: partial, alt: '', draggable: false }) : null,
    url ? h('img', { className: 'bt-img-final', src: url, alt: prompt ?? '', onLoad: () => setLoaded(true) }) : null,
    url && loaded
      ? h('div', { className: 'bt-img-tools' },
          h('a', { className: 'bt-img-tool', href: url, download: `${id}.png`, title: t('Save image'), 'aria-label': t('Save image') }, h(DownloadIcon)),
          typeof ClipboardItem === 'function' ? h('button', { type: 'button', className: 'bt-img-tool', title: copied ? t('Copied') : t('Copy image'), 'aria-label': t('Copy image'), onClick: () => { void copyImage(url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) }, () => {}) } }, h(CopyIcon)) : null)
      : h('figcaption', { className: 'bt-img-status', role: 'status' },
          h('span', { className: 'bt-img-pill' }, h('span', { className: 'bt-img-dot', 'aria-hidden': true }), `${t(url ? 'Ready' : stageOf(elapsed))} · ${elapsed}s`),
          prompt ? h('span', { className: 'bt-img-brief' }, h('span', null, prompt)) : null))
}

export const IMAGE_CELL_CSS = `
.bt-img{position:relative;margin:6px 0;width:min(100%,440px);border-radius:18px;overflow:hidden;background:var(--bt-card);box-shadow:0 0 0 1px var(--bt-line),0 10px 30px -18px color-mix(in srgb,var(--bt-ink) 50%,transparent);isolation:isolate}
.bt-img-dev{position:absolute;inset:0;background:color-mix(in srgb,var(--bt-magic-violet) 14%,var(--bt-card));filter:saturate(1.15);transition:opacity .9s ease}
.bt-img-dev i{position:absolute;width:70%;height:70%;border-radius:50%;filter:blur(38px);opacity:.75;mix-blend-mode:normal;animation:bt-img-drift 9s ease-in-out infinite alternate}
.bt-img-dev i:nth-child(1){left:-12%;top:-10%;background:var(--bt-magic-cyan)}
.bt-img-dev i:nth-child(2){right:-14%;top:18%;background:var(--bt-magic-violet);animation-duration:11s;animation-delay:-3s}
.bt-img-dev i:nth-child(3){left:12%;bottom:-18%;background:var(--bt-magic-pink);animation-duration:13s;animation-delay:-6s}
.bt-img-light{position:absolute;inset:-40% -60%;background:linear-gradient(105deg,transparent 40%,color-mix(in srgb,var(--bt-card) 55%,transparent) 50%,transparent 60%);animation:bt-img-sweep 2.8s ease-in-out infinite}
.bt-img-partial,.bt-img-final{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block}
.bt-img-partial{filter:blur(16px) saturate(1.1);transform:scale(1.06);transition:filter .8s ease,transform .8s ease;animation:bt-img-in .6s ease both}
.bt-img-partial[data-step="2"]{filter:blur(6px);transform:scale(1.02)}
.bt-img-final{opacity:0;filter:blur(10px);transform:scale(1.02);transition:opacity .7s ease,filter .9s ease,transform .9s ease}
.bt-img[data-state=done] .bt-img-final{opacity:1;filter:none;transform:none}
.bt-img[data-state=done] .bt-img-dev{opacity:0}
.bt-img-status{position:absolute;left:10px;right:10px;bottom:10px;display:flex;flex-direction:column;align-items:flex-start;gap:6px;margin:0}
.bt-img-pill{display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border-radius:999px;background:color-mix(in srgb,var(--bt-card) 82%,transparent);backdrop-filter:blur(8px);color:var(--bt-ink);font:600 12px/16px var(--bt-font);box-shadow:0 1px 0 var(--bt-line)}
.bt-img-dot{width:7px;height:7px;border-radius:50%;background:var(--bt-magic-pink);animation:bt-img-pulse 1.2s ease-in-out infinite}
.bt-img-brief{max-width:100%;box-sizing:border-box;padding:6px 10px;border-radius:12px;background:color-mix(in srgb,var(--bt-card) 70%,transparent);backdrop-filter:blur(8px);color:var(--bt-ink-2);font:400 12px/16px var(--bt-font)}
.bt-img-brief>span{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.bt-img-tools{position:absolute;top:8px;right:8px;display:flex;gap:6px;opacity:0;transition:opacity .15s ease}
.bt-img:hover .bt-img-tools,.bt-img:focus-within .bt-img-tools{opacity:1}
.bt-img-tool{display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;border:0;border-radius:10px;background:color-mix(in srgb,var(--bt-card) 85%,transparent);backdrop-filter:blur(8px);color:var(--bt-ink);cursor:pointer}
.bt-img-tool:hover{background:var(--bt-card)}
.bt-img-failed{aspect-ratio:auto;padding:14px 16px;display:flex;flex-direction:column;gap:4px}
.bt-img-failed-title{font:600 14px/20px var(--bt-font);color:var(--bt-ink)}
.bt-img-failed-why{font:400 12px/16px var(--bt-font);color:var(--bt-ink-2)}
@keyframes bt-img-drift{0%{transform:translate(0,0) scale(1)}50%{transform:translate(8%,6%) scale(1.12)}100%{transform:translate(-6%,10%) scale(.94)}}
@keyframes bt-img-sweep{0%{transform:translateX(-30%)}100%{transform:translateX(30%)}}
@keyframes bt-img-pulse{50%{opacity:.35}}
@keyframes bt-img-in{from{opacity:0}to{opacity:1}}
@media (prefers-reduced-motion:reduce){.bt-img-dev i,.bt-img-light,.bt-img-dot{animation:none}}
body[data-bt-motion=quiet] :is(.bt-img-dev i,.bt-img-light,.bt-img-dot){animation:none}
`

// Settings → Bots: what draws the Bots' images here, so the person knows before asking.
export function ImagesSection({ Section, Row }) {
  const [access, setAccess] = useState(undefined)
  useEffect(() => { void call('image-access').then(setAccess, () => setAccess(null)) }, [])
  const label = access === undefined ? t('Loading…')
    : access === null ? t('Not connected')
      : access.kind === 'chatgpt' ? t('Your ChatGPT account') : t('Your OpenAI key')
  const hint = access === null
    ? t('Sign in to ChatGPT or add an OpenAI key in Settings → Models, and every Bot can draw images in its chats.')
    : t('Every Bot can draw images in its chats. They are saved in the team workspace\'s images folder.')
  return h(Section, { title: t('Images') },
    h(Row, { label: t('Drawn with'), hint }, h('span', { className: 'bt-set-hint' }, access?.model ? `${label} · ${access.model}` : label)))
}
