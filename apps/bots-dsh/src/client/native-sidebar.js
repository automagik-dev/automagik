// Native registrations remain the authority for their children, stores and locale.
// Advanced removes our presentation shadows; it never copies native components.
export const LIVE_KIND = 'bot-live'
const LIVE_ID = 'ds-bot/live'

export function advancedBot(roster, sessionId) {
  const bot = roster.byId?.[sessionId]
  return bot?.advanced === true ? bot : null
}

export function installSimpleControls({ roster, sources = [], sessionId, install }) {
  let release
  const sync = () => {
    const id = sessionId()
    // No visible Session means no conversation chrome to suppress. Rooms/tasks
    // have no per-Bot Advanced owner and retain the simple team presentation.
    const simple = id !== undefined && advancedBot(roster.getSnapshot(), id) === null
    if (simple && !release) release = install()
    else if (!simple && release) { const off = release; release = undefined; off() }
  }
  const offs = [roster, ...sources].filter(Boolean).map(source => source.subscribe(sync))
  try { sync() } catch (error) { for (const off of offs) off(); throw error }
  return () => { for (const off of offs) off(); release?.(); release = undefined }
}

export function installLiveTab({ tabs, slots, sidebar, face, Body }) {
  const releaseType = tabs.register({
    // No guide card: the static native registry cannot hide it for plain Sessions.
    id: LIVE_ID, kind: LIVE_KIND, title: () => 'Live',
  })
  let releaseBody
  try { releaseBody = slots.inject('sidebar.right.pane.tab', () => slots.register({ name: 'sidebar.right.pane.tab', key: LIVE_ID, inject: face }, Body)) }
  catch (error) { releaseType(); throw error }
  return () => {
    try {
      // Only our kind; closeIn targets each tab's own Session, never the mounted one.
      // Dormant saved layouts without an adopted store remain native-owned metadata.
      for (const tab of sidebar?.openTabs.getSnapshot() ?? []) {
        if (tab.kind === LIVE_KIND) sidebar.closeIn(tab.sessionId, tab.tabId)
      }
    } finally { try { releaseBody() } finally { releaseType() } }
  }
}

export function sidebarActions({ sidebar, shown, teamSession = () => false, closePanel, reportError }) {
  const perform = operation => {
    const controller = sidebar()
    // Commands act on the native mounted Session, never a stale Bot callback.
    const sessionId = shown()
    if (!controller || sessionId === undefined || controller.mounted.getSnapshot() !== sessionId || !teamSession(sessionId)) return
    closePanel()
    try { operation(controller) } catch (error) { reportError(error, 'right-sidebar') }
  }
  return {
    hasRightSidebar: () => sidebar() !== undefined,
    openLive: () => perform(controller => controller.openTab(LIVE_KIND)),
    toggleRightSidebar: () => perform(controller => controller.toggleExpanded()),
  }
}
