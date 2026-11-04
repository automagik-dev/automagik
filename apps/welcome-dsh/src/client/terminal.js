import { createElement as h, useEffect, useRef } from 'react'
import XTERM_CSS from '@xterm/xterm/css/xterm.css'

// The terminals the welcome draws (xterm.js): InstallLog, the read-only tail of what the Genie
// install printed on its card.

const FONT = '13px ui-monospace, SFMono-Regular, Menlo, monospace'
const THEME = {
  background: '#05080e', foreground: '#cfe3ee', cursor: '#22d3ee', cursorAccent: '#05080e', selectionBackground: '#1f4b5c',
  black: '#0b111d', red: '#ff6b6b', green: '#4fe0a8', yellow: '#f0c86a', blue: '#5fa8f0', magenta: '#ff3bd4', cyan: '#22d3ee', white: '#cfe3ee',
  brightBlack: '#5d6b82', brightRed: '#ff8f8f', brightGreen: '#7ef0c2', brightYellow: '#ffd98a', brightBlue: '#8cc3ff', brightMagenta: '#ff7fe3', brightCyan: '#8ff4ff', brightWhite: '#ffffff',
}
// Columns that fit the terminal's box, from the width of one character of its font.
export function columnsFor(width, charWidth) {
  if (!(width > 0) || !(charWidth > 0)) return 80
  return Math.max(30, Math.min(400, Math.floor((width - 24) / charWidth)))
}
let measured = 0
function charWidth() {
  if (measured > 0) return measured
  const context = document.createElement('canvas').getContext?.('2d')
  if (!context) return 7.8
  context.font = FONT
  measured = context.measureText('W').width || 7.8
  return measured
}

// A read-only terminal that shows what an install printed (Genie's card): `text` is the whole
// log so far, kept as a tail by the host; each new render writes only what was added.
const LOG_ROWS = 7
export function InstallLog({ text, label }) {
  const box = useRef(null)
  const terminal = useRef(null)
  const written = useRef('')
  useEffect(() => {
    let alive = true
    let term
    void (async () => {
      const { Terminal } = await import('@xterm/xterm')
      if (!alive || box.current === null) return
      term = new Terminal({ rows: LOG_ROWS, cols: columnsFor(box.current.clientWidth, charWidth() * 11.5 / 13), fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 11.5, lineHeight: 1.15, disableStdin: true, cursorBlink: false, convertEol: true, scrollback: 4000, theme: { ...THEME, cursor: THEME.background } })
      term.open(box.current)
      terminal.current = term
      written.current = ''
      write(text)
    })()
    return () => { alive = false; term?.dispose(); terminal.current = null }
  }, [])
  const write = (next = '') => {
    const term = terminal.current
    if (term === null) return
    // The host keeps a tail: when the start moved, the screen starts over.
    if (!next.startsWith(written.current)) {
      term.reset()
      written.current = ''
    }
    term.write(next.slice(written.current.length))
    written.current = next
  }
  useEffect(() => { write(text) }, [text])
  return h('div', { className: 'oai-term oai-mini-term', role: 'log', 'aria-label': label },
    h('div', { className: 'oai-term-screen', ref: box }))
}

export const TERMINAL_CSS = XTERM_CSS + `
.oai-term{margin-top:10px;border:1px solid var(--oai-line);border-radius:12px;overflow:hidden;background:#05080e}
.oai-term-screen{padding:10px 12px;min-height:150px}
.oai-term-screen .xterm-viewport{background:#05080e!important}
.oai-mini-term{margin:8px 0 0;width:100%;text-align:left}
.oai-mini-term .oai-term-screen{min-height:0;padding:8px 10px}
`
