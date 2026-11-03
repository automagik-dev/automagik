// Code mode's fourth step (RFC 0013, delivery 4): the right space. Once Herdr's window is open,
// main looks up the Bot's folder and machine itself (the page sends a Bot id and nothing else),
// reads `herdr-app ls`, and shows the space on that folder and machine: an open one is selected,
// else one is made (space.new). A Bot with no folder gets no space picked (D27). Like herdr.js,
// pure apart from what it is handed: main.js passes the real file system and execFile; tests
// pass fakes. Every call to herdr-app goes through herdr.js's run(): an argv array, no shell,
// a 10 s limit.
import { realpathSync, statSync } from 'node:fs'
import { open } from 'node:fs/promises'
import { posix, win32 } from 'node:path'
import { isBotId } from './bot-views.js'
import { run } from './herdr.js'

const pathOf = platform => (platform === 'win32' ? win32 : posix)

/**
 * What main takes from the page's open request: the Bot id when it has a Bot id's shape, and
 * the person's yes or no to an update offer. Anything else in it (a folder, a machine, a path)
 * is dropped here, so nothing the page names reaches herdr-app.
 */
export function openRequest(request) {
  const botId = isBotId(request?.botId) ? request.botId : null
  const update = typeof request?.update === 'boolean' ? request.update : undefined
  return { botId, update }
}

/** The Bot team's saved state under the app's home (appHome, dsh.js AUTOMAGIK_BOTS_HOME). */
export const botsStateOf = (appHome, platform = process.platform) => pathOf(platform).join(appHome, 'bots', 'state.json')

/**
 * Where a Bot works: `{ folder, machine }`, or null for an id main does not know (not a Bot
 * id's shape, not in the state, or no state to read). `folder` is null for a Bot with none of
 * its own (it works in the team's workspace: a global Bot, D3), and for one whose folder is
 * gone or not a full path. `machine` is null for this computer.
 *
 * This is the one place the switch learns a Bot's folder and machine. Today it reads the Bot
 * team's state.json, which keeps no machine, so every Bot is on this computer; RFC 0014's
 * shared registry replaces what is behind it, and nothing else changes.
 */
export async function botPlace(botId, { appHome, platform = process.platform, read = readText, isFolder = defaultIsFolder } = {}) {
  if (!isBotId(botId) || !appHome) return null
  let state
  try {
    const text = await read(botsStateOf(appHome, platform))
    if (typeof text !== 'string' || text.length > STATE_MAX_BYTES) return null
    state = JSON.parse(text)
  } catch {
    return null
  }
  const bots = state && typeof state === 'object' ? state.bots : null
  if (!bots || typeof bots !== 'object' || !Object.hasOwn(bots, botId)) return null
  const bot = bots[botId]
  if (!bot || typeof bot !== 'object') return null
  const dir = bot.workDir
  const usable = typeof dir === 'string' && dir !== '' && pathOf(platform).isAbsolute(dir) && isFolder(dir)
  return { folder: usable ? dir : null, machine: null }
}

// state.json holds the team's chat history too, and is read on every click: one over this is
// not read, and its Bots are unknown.
export const STATE_MAX_BYTES = 8 * 1024 * 1024

async function readText(file) {
  const handle = await open(file, 'r')
  try {
    if ((await handle.stat()).size > STATE_MAX_BYTES) throw new Error(`${file} is over ${STATE_MAX_BYTES} bytes`)
    return await handle.readFile('utf8')
  } finally {
    await handle.close()
  }
}

function defaultIsFolder(dir) {
  try {
    return statSync(dir).isDirectory()
  } catch {
    return false
  }
}

function defaultResolve(dir) {
  try {
    return realpathSync.native(dir)
  } catch {
    return dir
  }
}

/**
 * A folder as the planner compares it: no trailing separator; on Windows `/` read as `\` and
 * case ignored. A remote machine's folders are Unix paths (herdr-app runs agents there in the
 * remote user's Unix shell), whatever this computer is.
 */
export function folderKey(folder, platform) {
  if (typeof folder !== 'string' || folder === '') return null
  if (platform === 'win32') {
    const text = folder.replace(/\//g, '\\')
    const trimmed = /^[a-z]:\\$/i.test(text) || /^\\+$/.test(text) ? text : text.replace(/\\+$/, '')
    return trimmed.toLowerCase()
  }
  return folder === '/' || /^\/+$/.test(folder) ? '/' : folder.replace(/\/+$/, '')
}

/** The spaces in `herdr-app ls` JSON, each `{ id, folder, machine, active }`; null if it is not that. */
export function spacesIn(text) {
  let parsed
  try {
    parsed = typeof text === 'string' ? JSON.parse(text) : text
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.spaces)) return null
  return parsed.spaces
    .filter(space => space && typeof space === 'object' && typeof space.id === 'string' && space.id !== '')
    .map(space => ({
      id: space.id,
      folder: typeof space.folder === 'string' ? space.folder : null,
      machine: typeof space.machine === 'string' && space.machine !== '' ? space.machine : null,
      active: space.active === true,
    }))
}

/**
 * The herdr-app argv that shows a Bot's space (protocol step 5), from `ls`'s spaces and the
 * Bot's folder and machine (null: this computer). Spaces on every machine count, remote ones
 * too. Answers `{ action, argv, id?, note? }`:
 * - `select`: the space on that folder and machine, `do space.select --id <id>`. Of two or
 *   more, the active one, else the first `ls` lists; `note` says so, for the log.
 * - `new`: none matched, `do space.new {"name":<folder name>,"folder":<folder>,"machine":<m>}`,
 *   one JSON object (`do` reads `--name value` flags, and a folder named `-x`, `true` or
 *   `2026` would be read as a flag or a non-string); `machine` left out for this computer.
 * - `none`: the Bot has no folder (D27), `argv` null: Herdr stays as it was.
 * A space whose folder is empty (that machine's home) matches no Bot. `resolve` turns a folder
 * on this computer into its real path (the Bot team saves real paths; a person's own space may
 * carry a link to the same folder); a remote folder is compared as it is.
 */
export function planSpace({ spaces, folder, machine = null, platform, resolve = dir => dir }) {
  if (typeof folder !== 'string' || folder === '') return { action: 'none', argv: null }
  const remote = typeof machine === 'string' && machine !== ''
  const os = remote ? 'linux' : platform
  const real = dir => (remote ? dir : resolve(dir))
  const wanted = folderKey(real(folder), os)
  const matches = (spaces ?? []).filter(space =>
    (remote ? space.machine === machine : space.machine === null) &&
    space.folder !== null && space.folder !== '' &&
    folderKey(real(space.folder), os) === wanted)
  if (matches.length > 0) {
    const active = matches.find(space => space.active)
    const picked = active ?? matches[0]
    const note = matches.length > 1
      ? `${matches.length} spaces on ${folder}${remote ? ` (${machine})` : ''}: ${matches.map(space => space.id).join(', ')}; picked ${picked.id} (${active ? 'active' : 'first'})`
      : undefined
    return { action: 'select', argv: ['do', 'space.select', '--id', picked.id], id: picked.id, ...(note ? { note } : {}) }
  }
  const p = pathOf(os)
  const name = p.basename(folder.replace(os === 'win32' ? /[\\/]+$/ : /\/+$/, '')) || folder
  const args = { name, folder, ...(remote ? { machine } : {}) }
  return { action: 'new', argv: ['do', 'space.new', JSON.stringify(args)] }
}

/** Text for one log line: control characters (newlines included) become spaces. */
export const oneLine = text => String(text).replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ')

const lastLine = text => String(text ?? '').trim().split(/\r?\n/).pop() ?? ''

/** herdr-app's answer to a `do`: `{ ok, answer?, error? }` (exit 1 with `{ "error" }` is a refusal). */
function doAnswer(result) {
  let answer = null
  try {
    answer = JSON.parse(result.stdout)
  } catch {}
  const error = answer && typeof answer === 'object' && answer.error !== undefined ? String(answer.error?.message ?? answer.error) : null
  if (result.code === 0 && !error) return { ok: true, answer }
  return { ok: false, error: error || lastLine(result.stderr) || `exited ${result.code}` }
}

/**
 * Shows the Bot's space in Herdr's open window: looks the Bot up (botPlace), reads `ls`, and
 * runs the planner's `do`. Only the Bot id comes from the page. Resolves to `{ action, id? }`
 * (`action` 'select', 'new' or 'none') or `{ action, error }` when herdr-app refused; never
 * throws. Log lines (logs/switch.log): `space select|new <id>`, `no-space <why>`, `do-error`.
 */
export async function pickSpace({ botId, found, platform, env, appHome, execFile, read, isFolder, resolve = defaultResolve, place = botPlace, mark = () => {}, log: write = () => {} }) {
  // One line each in switch.log: a folder, a machine or herdr-app's message can hold anything.
  const log = line => write(oneLine(line))
  const bot = botId ? await place(botId, { appHome, platform, read, isFolder }) : null
  if (!bot || !bot.folder) {
    log(`no-space ${!botId ? 'no Bot' : !bot ? 'unknown Bot' : 'no folder'}`)
    return { action: 'none' }
  }
  const listed = await run(found.bin, ['ls'], { env, execFile })
  const spaces = listed.code === 0 ? spacesIn(listed.stdout) : null
  if (!spaces) {
    const why = listed.code === 0 ? 'ls gave no spaces' : lastLine(listed.stderr) || `ls exited ${listed.code}`
    log(`do-error ${why}`)
    return { action: 'none', error: why }
  }
  const plan = planSpace({ spaces, folder: bot.folder, machine: bot.machine, platform, resolve })
  if (plan.note) log(`space ${plan.note}`)
  const done = doAnswer(await run(found.bin, plan.argv, { env, execFile }))
  if (!done.ok) {
    // A remote machine that is offline lands here too: herdr-app's own message says so.
    log(`do-error ${plan.argv[1]}${bot.machine ? ` on ${bot.machine}` : ''}: ${done.error}`)
    return { action: plan.action, error: done.error }
  }
  const id = plan.action === 'new' ? (typeof done.answer?.space === 'string' ? done.answer.space : null) : plan.id
  mark('space')
  log(`space ${plan.action} ${id ?? '(no id)'}`)
  return { action: plan.action, ...(id ? { id } : {}) }
}
