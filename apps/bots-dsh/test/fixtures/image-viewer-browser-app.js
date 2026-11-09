// Browser fixture for the image viewer (image-viewer.js): the Bot team's real tool cell, image
// card, styles and themes in a chat-wide column. The image route and the host's `send` are
// fakes in this page; nothing leaves it.
import { createElement as h } from 'react'
import { SHELL_CSS } from '../../src/client/styles.js'
import { IMAGE_CELL_CSS } from '../../src/client/image-cell.js'
import { ToolCell } from '../../src/client/cells.js'
import { allThemes, themeCss } from '../../src/client/themes.js'
import { indexRoster } from '../../src/client/sources.js'

const { createRoot } = window.nativeSeeds['react-dom/client']

const style = document.createElement('style')
document.head.append(style)
window.setTheme = (id, dark) => {
  style.textContent = SHELL_CSS + IMAGE_CELL_CSS + themeCss(allThemes()[id])
  if (dark) document.body.setAttribute('data-ds-dark-theme', '')
  else document.body.removeAttribute('data-ds-dark-theme')
}

const painter = { id: 'painter', name: 'Painter', color: 'blue' }
const room = { id: 'room', name: 'Studio', members: ['painter'], admin: 'painter' }
const roster = indexRoster({ bots: [painter], rooms: [room], agents: [], models: [], prefs: {}, exchangeTurns: {}, questions: {}, secretRequests: {}, secrets: [] })

// The host's `send`, faked: what was sent and where; `failSend` refuses it, `holdSend` keeps it open.
window.sent = []
window.failSend = false
window.holdSend = false
const actions = {
  send: async (sessionId, text) => {
    window.sent.push({ sessionId, text })
    if (window.holdSend) await new Promise((resolve) => { window.releaseSend = resolve })
    if (window.failSend) throw new Error('This Bot is not answering right now.')
    return true
  },
}

const text = value => [{ type: 'text', text: value }]
const results = {
  generate_image: id => ({ kind: 'tool-result', name: 'generate_image', callId: 'gi_1', call: { name: 'generate_image', argsRaw: JSON.stringify({ prompt: 'A lighthouse at dusk', size: '1536x1024' }) }, content: text(`Drew the image with the user's OpenAI key and saved it as /team/images/${id}.png. It is on screen in the chat, so do not describe it back.`), isError: false, subCalls: [] }),
  acp_tool: id => ({ kind: 'tool-result', name: 'acp_tool', callId: 'acp_1', call: { name: 'acp_tool', argsRaw: JSON.stringify({ id: 'ig-1', title: 'Image generation', kind: 'other', input: { prompt: 'A lighthouse at dusk' }, image: true }) }, content: text(`Image generated and saved as /team/images/${id}.png. It is on screen in the chat, so do not describe it back.`), isError: false, subCalls: [] }),
}

let root = null
window.mount = ({ id = 'img-wide0001', tool = 'generate_image', sessionId = painter.id } = {}) => {
  root?.unmount()
  window.sent = []
  root = createRoot(document.getElementById('root'))
  root.render(h('div', { style: { maxWidth: 748, margin: '0 auto', padding: '24px 16px', color: 'var(--bt-ink)', font: '400 15px/22px var(--bt-font)' } },
    h('p', null, 'Here is the lighthouse you asked for.'),
    h(ToolCell, {
      node: { key: 'node', data: { root: results[tool](id) }, location: { turn: { turn: 1 } } }, sessionId, actions,
      useRoster: pick => pick(roster), useUi: pick => pick({ reactions: {}, visits: {} }), useHeldCards: pick => pick({}),
    }),
    h('p', null, 'Tell me if you want anything changed.')))
}
