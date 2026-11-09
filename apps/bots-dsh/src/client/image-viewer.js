import { createElement as h, useEffect, useRef, useState } from 'react'
import { ArrowUpIcon, CloseIcon, DownloadIcon } from './icons.js'
import { hostText, t } from './i18n.js'
import { useEscape } from './overlay-hooks.js'

// -------------------------------------------------------------------------
// A finished image opened over the whole window (image-cell.js draws it in a portal): the image
// as large as the window allows and never above its own size, Save and Close at the top right,
// and a field to ask the chat's Bot for changes. It is made of what the app already has: the
// scrim, the image card's tools and the memory dialog's ask row.

/**
 * A change request for one image, as the chat's Bot reads it: the file name is the one its own
 * tool result gave it (`…/images/<id>.png`), so it knows which image is meant.
 */
export const askAbout = (id, text) => t('About the image {file}: {text}', { file: `images/${id}.png`, text })

const FOCUSABLE = 'a[href],button:not(:disabled),input:not(:disabled)'

export function ImageViewer({ id, url, alt, onAsk, onClose }) {
  const [text, setText] = useState('')
  const [phase, setPhase] = useState('idle')
  const [error, setError] = useState(null)
  // 'shown' until the image cannot load here (its file left the team folder meanwhile).
  const [image, setImage] = useState('shown')
  const dialog = useRef(null)
  const input = useRef(null)
  const closeButton = useRef(null)
  useEscape(onClose)
  useEffect(() => { (input.current ?? closeButton.current)?.focus() }, [])
  // Tab stays in the viewer: past the last control it goes to the first, and back.
  const onKeyDown = (event) => {
    if (event.key !== 'Tab') return
    const stops = [...(dialog.current?.querySelectorAll(FOCUSABLE) ?? [])]
    if (stops.length === 0) return
    const at = stops.indexOf(document.activeElement)
    const next = event.shiftKey ? (at <= 0 ? stops.length - 1 : at - 1) : (at === stops.length - 1 ? 0 : at + 1)
    event.preventDefault()
    stops[next].focus()
  }
  const sending = phase === 'sending'
  const ask = async (event) => {
    event.preventDefault()
    const asked = text.trim()
    if (asked === '' || sending) return
    setPhase('sending')
    setError(null)
    try {
      await onAsk(askAbout(id, asked))
      onClose()
    } catch (failure) {
      setError(failure?.message ?? String(failure))
      setPhase('idle')
    }
  }
  return h('div', { className: 'bt-imgv-layer', onKeyDown },
    h('div', { className: 'bt-scrim', onMouseDown: onClose }),
    // tabIndex -1: a click on the image keeps focus in the dialog, so Tab stays inside.
    h('div', { ref: dialog, className: 'bt-imgv', role: 'dialog', 'aria-modal': true, 'aria-label': t('Image viewer'), tabIndex: -1 },
      h('div', { className: 'bt-imgv-bar' },
        // A lost image has nothing to save.
        image === 'lost' ? null : h('a', { className: 'bt-img-tool', href: url, download: `${id}.png`, title: t('Save image'), 'aria-label': t('Save image') }, h(DownloadIcon)),
        h('button', { ref: closeButton, type: 'button', className: 'bt-img-tool', title: t('Close image'), 'aria-label': t('Close image'), onClick: onClose }, h(CloseIcon))),
      h('div', { className: 'bt-imgv-stage' },
        image === 'lost'
          ? h('div', { className: 'bt-img bt-img-failed', role: 'status', 'data-state': 'lost' },
              h('div', { className: 'bt-img-failed-title' }, t('The image could not be shown')),
              h('div', { className: 'bt-img-failed-why' }, t('This image is no longer in the team folder.')))
          : h('img', { className: 'bt-imgv-img', src: url, alt: alt ?? '', draggable: false, onError: () => setImage('lost') })),
      error ? h('div', { className: 'bt-img-failed bt-imgv-note', role: 'alert' }, h('div', { className: 'bt-img-failed-why' }, hostText(error))) : null,
      onAsk
        ? h('form', { className: 'bt-mem-ask bt-imgv-ask', onSubmit: ask },
            h('input', {
              ref: input, className: 'bt-mem-input', value: text, maxLength: 2000,
              placeholder: t('Ask for changes…'), 'aria-label': t('Ask for changes to this image'),
              onChange: event => setText(event.target.value),
            }),
            h('button', { type: 'submit', className: 'bt-mem-send', disabled: sending || text.trim() === '', 'aria-label': t('Send') },
              sending ? h('span', { className: 'bt-mem-spin', 'aria-hidden': true }) : h(ArrowUpIcon)))
        : null))
}

// Layout only: every colour, radius and shadow is the scrim's, the card tools' or the ask row's.
// The viewer lets a click beside the image through to the scrim, which closes it.
export const IMAGE_VIEWER_CSS = `
.bt-img[data-state=done] .bt-img-final{cursor:zoom-in}
.bt-imgv-layer{position:fixed;inset:var(--dsh-frame-chrome-top,0px) 0 0;z-index:61;display:flex;font-family:var(--bt-font)}
.bt-imgv{position:relative;flex:1;min-width:0;box-sizing:border-box;display:flex;flex-direction:column;align-items:center;gap:12px;padding:16px;pointer-events:none;outline:none}
.bt-imgv-bar{align-self:flex-end;flex:none;display:flex;gap:6px;pointer-events:auto}
.bt-imgv-stage{position:relative;flex:1;min-height:0;align-self:stretch;display:grid;place-items:center}
.bt-imgv-img{position:absolute;inset:0;margin:auto;display:block;max-width:100%;max-height:100%;border-radius:18px;pointer-events:auto}
.bt-imgv-stage .bt-img-failed,.bt-imgv-note,.bt-imgv-ask{pointer-events:auto}
.bt-imgv-note,.bt-imgv-ask{flex:none;box-sizing:border-box;width:min(100%,680px)}
`
