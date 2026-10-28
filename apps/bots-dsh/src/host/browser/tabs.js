// A Bot's open tabs, kept by dsh in the Bot's browser-profiles/<botId> folder so they come
// back after a crash or a restart, on either host: the Chrome dsh launches, or the Automagik
// app's views (the app keeps none itself and reopens what dsh asks for). Only web pages are
// kept, by address and title; sign-ins stay in the browser's own storage, never here.
import { readFileSync } from 'node:fs'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export const TABS_FILE = 'tabs.json'
const TABS_MAX = 20
const SAVE_DELAY_MS = 400
const RESTORE_TIMEOUT_MS = 15_000

const isWeb = url => typeof url === 'string' && /^https?:\/\//i.test(url) && url.length <= 4000

/** `{ tabs: [{ url, title }], active }` from whatever was stored; nothing usable is no tabs. */
export function cleanTabs(value) {
  const tabs = (Array.isArray(value?.tabs) ? value.tabs : [])
    .filter(tab => isWeb(tab?.url))
    .slice(0, TABS_MAX)
    .map(tab => ({ url: tab.url, title: typeof tab.title === 'string' ? tab.title.slice(0, 300) : '' }))
  const active = Number.isInteger(value?.active) && value.active >= 0 && value.active < tabs.length ? value.active : tabs.length - 1
  return { tabs, active }
}

export function readSavedTabs(dir) {
  try {
    return cleanTabs(JSON.parse(readFileSync(join(dir, TABS_FILE), 'utf8')))
  } catch {
    return cleanTabs(null)
  }
}

/**
 * A browser that opens with no web page gets the saved tabs back, `page` (its first tab) taking
 * the first one; the rest open after it. Returns the tab that was active.
 */
export async function restoreTabs(context, dir, page) {
  const saved = readSavedTabs(dir)
  if (saved.tabs.length === 0 || context.pages().some(target => isWeb(target.url()))) return page
  const pages = [page]
  for (let index = 1; index < saved.tabs.length; index += 1) pages.push(await context.newPage())
  await Promise.all(saved.tabs.map((tab, index) => pages[index].goto(tab.url, { waitUntil: 'commit', timeout: RESTORE_TIMEOUT_MS }).catch(() => {})))
  return pages[saved.active] ?? page
}

/**
 * Save the browser's web tabs whenever they change, until `stop()`: a browser that is closing
 * or went away saves nothing more, so its closing tabs never replace the saved ones.
 * `onSave` hears each saved list.
 */
export function keepTabs({ context, dir, activePage, onSave }) {
  let stopped = false
  let timer
  let written = ''
  const save = async () => {
    timer = undefined
    if (stopped) return
    const open = context.pages().filter(target => !target.isClosed() && isWeb(target.url()))
    if (open.length === 0) return
    const tabs = await Promise.all(open.map(async target => ({ url: target.url(), title: await target.title().catch(() => '') })))
    const saved = cleanTabs({ tabs, active: open.indexOf(activePage()) })
    const text = JSON.stringify(saved)
    if (stopped || text === written) return
    written = text
    const file = join(dir, TABS_FILE)
    const temporary = `${file}.${process.pid}.tmp`
    try {
      await mkdir(dir, { recursive: true })
      await writeFile(temporary, text)
      await rename(temporary, file)
      onSave?.(saved)
    } catch {
      written = ''
    }
  }
  const later = () => {
    if (stopped) return
    clearTimeout(timer)
    timer = setTimeout(() => void save(), SAVE_DELAY_MS)
  }
  const watch = (target) => {
    target.on?.('framenavigated', frame => { if (frame === target.mainFrame?.()) later() })
    target.on?.('load', later)
    target.on?.('close', later)
  }
  for (const target of context.pages()) watch(target)
  context.on?.('page', (target) => { watch(target); later() })
  // Tabs opened while no Bot was attached (the owner's, during a takeover) are saved now.
  later()
  return {
    changed: later,
    stop() {
      stopped = true
      clearTimeout(timer)
    },
  }
}
