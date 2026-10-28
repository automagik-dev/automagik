import { createElement as h, Fragment, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CommandPalette } from './palette.js'
import { NewChat } from './new-chat.js'
import { ExchangeDialog } from './exchange.js'
import { VoiceMode } from './voice.js'
import { SettingsDialog } from './settings.js'
import { ContextMenu } from './context-menu.js'
import { PANEL_LINGER_MS, BotPanel } from './browser-pane.js'
import { MemoryDialog } from './memory-panel.js'
import { useLinger } from './motion.js'
import { LiveRail, RAIL_MIN_ROOM } from './live-rail.js'

// How long a closing dialog or menu stays for its exit (see their [data-leaving] CSS).
const DIALOG_EXIT_MS = 160
const MENU_EXIT_MS = 120

// The width of the conversation's cell in DSH's frame, for what only shows when it is wide:
// the window less the sidebar and DSH's own right panel (which takes room from the centre,
// unlike the Bot team's panel, which floats over it). The column's border box loses the
// margin the team gives it (browser-pane.js chatRoom), so that margin is added back. The
// column comes and goes with the view, so it is looked for again now and then.
function useChatCellWidth() {
  const [width, setWidth] = useState(() => window.innerWidth)
  useEffect(() => {
    let watched = null
    const measure = () => {
      const column = document.querySelector('[class*="_centerCol"]')
      if (column !== watched) {
        if (watched) observer.unobserve(watched)
        if (column) observer.observe(column)
        watched = column
      }
      setWidth(column ? Math.round(column.getBoundingClientRect().width + (parseFloat(getComputedStyle(column).marginRight) || 0)) : window.innerWidth)
    }
    const observer = new ResizeObserver(measure)
    measure()
    window.addEventListener('resize', measure)
    const timer = setInterval(measure, 1000)
    return () => { observer.disconnect(); window.removeEventListener('resize', measure); clearInterval(timer) }
  }, [])
  return width
}

export function Overlays({ useRoster, useUi, useSessions, useSessionStatus, useActivity, useWork, useRegistry, useBrowserPages, useBrowserTabs, useBrowserHolds, useUpdate, actions }) {
  const roster = useRoster(value => value)
  const ui = useUi(value => value)
  useRegistry(value => value)
  const current = useSessions(list => Object.values(list.byId).find(session => (session?.retainedBy?.mainView ?? 0) > 0)?.id ?? null)
  // An open panel follows the conversation in the main view. Only a change of the
  // main view moves it, so opening details for another id (Rename) is not undone.
  const previous = useRef(current)
  useEffect(() => {
    if (previous.current === current) return
    previous.current = current
    if (current) actions.followPanel?.(current)
  }, [current])
  const open = ui.details ? { id: ui.details, view: ui.view ?? 'details', renaming: ui.renaming, tab: ui.tab, side: ui.side } : null
  const [kept, setKept] = useState(open)
  useEffect(() => {
    if (open) { setKept(open); return undefined }
    const timer = setTimeout(() => setKept(null), PANEL_LINGER_MS)
    return () => clearTimeout(timer)
  }, [ui.details, ui.view, ui.renaming, ui.tab])
  const pane = open ?? kept
  const [settings, settingsLeaving] = useLinger(ui.settings, DIALOG_EXIT_MS)
  // The memory dialog shows a Bot's memory or a group chat's.
  const memoryOwner = (id) => {
    const bot = roster.byId[id]
    if (bot) return { id: bot.id, name: bot.name }
    const room = roster.roomsById[id]
    return room ? { id: room.id, name: room.name, group: true } : null
  }
  const [memory, memoryLeaving] = useLinger(ui.memory && memoryOwner(ui.memory) ? ui.memory : null, DIALOG_EXIT_MS)
  const owner = memory ? memoryOwner(memory) : null
  const [menu, menuLeaving] = useLinger(ui.menu, MENU_EXIT_MS)
  // The Live rail: in a team chat (a Bot's, a group's or a task's) with room for it beside
  // the conversation, while neither the team's panel nor DSH's right panel is open.
  const width = useChatCellWidth()
  const teamChat = current !== null && (roster.byId[current] || roster.roomsById[current] || roster.tasks?.[current])
  const rail = !pane && teamChat && width >= RAIL_MIN_ROOM
  return h(Fragment, null,
    rail ? createPortal(h(LiveRail, { roster, actions, useWork }), document.body) : null,
    pane ? createPortal(h(BotPanel, { pane, leaving: open === null, roster, actions, useSessions, useSessionStatus, useActivity, useWork, useBrowserTabs, useBrowserPages, useBrowserHolds }), document.body) : null,
    ui.newChat ? createPortal(h(NewChat, { key: ui.newChat, mode: ui.newChat, roster, actions }), document.body) : null,
    ui.palette ? createPortal(h(CommandPalette, { key: ui.palette.token, start: ui.palette.query, token: ui.palette.token, roster, actions, useSessions }), document.body) : null,
    ui.exchange ? createPortal(h(ExchangeDialog, { pair: ui.exchange, roster, actions }), document.body) : null,
    ui.voice ? createPortal(h(VoiceMode, { key: ui.voice, sessionId: ui.voice, roster, actions, useSessions, useSessionStatus }), document.body) : null,
    menu ? createPortal(h(ContextMenu, { key: `${menu.kind ?? ''}:${menu.id}:${menu.x}:${menu.y}`, menu, roster, actions, leaving: menuLeaving }), document.body) : null,
    settings ? createPortal(h(SettingsDialog, { page: settings.page, id: settings.id, roster, actions, useUpdate, leaving: settingsLeaving }), document.body) : null,
    owner ? createPortal(h(MemoryDialog, { key: owner.id, owner, actions, leaving: memoryLeaving }), document.body) : null)
}
