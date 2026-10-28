// The Unfold Bot: Unfold inside DSH, on the Bot team. In Unfold's own Automagik instance it is the
// team's Main Bot, made in place of the default one (the team's rt.mainBotMaker), so the
// instance starts with Unfold and nothing else. In a DSH that already has a Main Bot (the
// Automagik app, where the welcome's Unfold card installs this plugin) it joins as one more Bot.
// Either way it is made once: an Unfold Bot that is there is kept, and one the person deleted is
// not made again.
//
// Its Session is titled with its name, so Unfold can watch it by that name (the Unfold bridge's
// `names` match) before it exists, and sees it from its first turn: the greeting waits for a
// model, so nothing runs before Connect AI.
import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const UNFOLD_KIND = 'unfold'
export const UNFOLD_NAME = 'Unfold'

export const UNFOLD_INSTRUCTIONS = [
  'You are Unfold, working inside this DSH.',
  'The Unfold plugins give you what Unfold itself is doing: its session, its events, its Mind, its capabilities and its settings. Use them to follow and carry on the work the user does with Unfold.',
  'Talk with the user in plain words, in the user\'s language.',
  'When the user wants work done that needs a decision, ask in one short question before you act.',
].join('\n')

export const UNFOLD_BOT = Object.freeze({
  kind: UNFOLD_KIND,
  // The team keeps a role to ROLE_MAX (24) characters (bots-dsh roster.js).
  role: 'Unfold, inside DSH',
  instructions: UNFOLD_INSTRUCTIONS,
})

// What the Unfold Bot type starts with, besides this plugin: the Unfold bridge and the Unfold
// plugins, all in this repository and released with it. The welcome's Unfold card installs them
// in this order (welcome-dsh src/host/bot-types.js keeps a copy); Unfold's own instance has
// them preinstalled.
export const UNFOLD_PLUGINS = Object.freeze([
  { name: '@automagik/unfold-bridge-dsh', dir: 'unfold-bridge-dsh', title: 'Unfold bridge', what: 'Unfold watches this DSH' },
  { name: '@automagik/unfold-sse-dsh', dir: 'unfold-sse-dsh', title: 'Unfold stream', what: 'Unfold\'s events as they happen' },
  { name: '@automagik/unfold-events-dsh', dir: 'unfold-events-dsh', title: 'Unfold events', what: 'What Unfold did, as a timeline' },
  { name: '@automagik/unfold-capabilities-dsh', dir: 'unfold-capabilities-dsh', title: 'Unfold capabilities', what: 'What Unfold can do now' },
  { name: '@automagik/unfold-settings-dsh', dir: 'unfold-settings-dsh', title: 'Unfold settings', what: 'Unfold\'s settings, to read' },
  { name: '@automagik/unfold-mind-dsh', dir: 'unfold-mind-dsh', title: 'Unfold Mind', what: 'What Unfold is thinking' },
  { name: '@automagik/unfold-trajectory-dsh', dir: 'unfold-trajectory-dsh', title: 'Unfold trajectory', what: 'Each run, step by step' },
  { name: '@automagik/unfold-session-dsh', dir: 'unfold-session-dsh', title: 'Unfold session', what: 'Unfold\'s own session, in DSH' },
])

export function install(rt, team) {
  const { ctx } = rt
  const file = () => join(rt.home, 'unfold.json')

  let data
  const load = () => {
    if (data !== undefined) return data
    try {
      data = { unfoldCreated: JSON.parse(readFileSync(file(), 'utf8')).unfoldCreated === true }
    } catch {
      data = { unfoldCreated: false }
    }
    return data
  }
  const save = () => {
    const temp = `${file()}.tmp`
    writeFileSync(temp, `${JSON.stringify(data, null, 2)}\n`)
    renameSync(temp, file())
  }

  const unfoldBot = () => Object.values(rt.state?.bots ?? {}).find(bot => bot.kind === UNFOLD_KIND)
  const hasMain = () => (rt.state?.mainBotIds ?? []).some(id => rt.botOf?.(id))
  // With a default model already served, the Bot greets at once; with none, its greeting
  // waits until Connect AI gives it one.
  const noModel = async () => (await Promise.resolve(rt.defaultModel?.()).catch(() => undefined)) === undefined

  async function make({ main }) {
    const name = rt.findBot?.(UNFOLD_NAME) === undefined ? UNFOLD_NAME : `${UNFOLD_NAME} ${Date.now()}`
    const bot = await rt.createBot({ ...UNFOLD_BOT, name, main, pickModel: await noModel() })
    load().unfoldCreated = true
    save()
    return bot
  }

  // The team's first Main Bot, when the team has none yet: Unfold, unless an Unfold Bot was
  // made before (then the team makes its default one).
  async function mainBot() {
    if (unfoldBot() !== undefined || load().unfoldCreated) return undefined
    return make({ main: true })
  }

  // Once per start: through the team's own bootstrap when it has no Main Bot (one at a time
  // with a bootstrap the browser asks for), else as one more Bot.
  async function ensureUnfold() {
    await rt.load()
    if (rt.readOnly() !== undefined) return undefined
    if (!hasMain()) await team.bootstrap()
    const existing = unfoldBot()
    if (existing !== undefined) return existing
    if (load().unfoldCreated) return undefined
    return make({ main: false })
  }

  ctx.effect(() => {
    team.mainBotMaker = mainBot
    return () => { if (team.mainBotMaker === mainBot) delete team.mainBotMaker }
  }, 'unfold-bot: the first Main Bot')

  const ready = (async () => {
    try {
      return await ensureUnfold()
    } catch (error) {
      rt.warn?.('unfold-bot: the Unfold Bot was not made: %s', error?.message ?? error)
      return undefined
    }
  })()

  Object.assign(rt, { ensureUnfold, unfoldReady: ready })
}
