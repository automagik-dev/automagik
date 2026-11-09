// A stand-in for the Unfold Bot plugin (@automagik/unfold-bot-dsh), which lives in Unfold's own
// repository since RFC 0020. It does to the team what that plugin's src/host/unfold.js did at the
// hand-over commit (d0453789c51def594451b911cb88571f3246c63e), and nothing else: the team's side
// of that contract (mainBotMaker, createBot with kind unfold and existingSessionId,
// keepAdoptedSession, the unfoldSession service) is what these tests hold. Its model menu (the
// botModels hook over the session's answerWith) is left out: no test here reads it.
//
// Unfold's own instance (the host rule, fixtures/unfold-host-rule.json): Unfold is the team's
// first Main Bot, made on the session's root Session. Elsewhere it joins as one more Bot. Either
// way it is made once: a deleted Unfold Bot is not made again.
import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const UNFOLD_KIND = 'unfold'
export const unfoldLeads = (env = process.env) => [env.AUTOMAGIK_HOST, env.AUTOMAGIK_PRELOAD].some(value => String(value ?? '').trim().toLowerCase() === UNFOLD_KIND)
const UNFOLD_NAME = 'Unfold'
const UNFOLD_BOT = Object.freeze({ kind: UNFOLD_KIND, role: 'Unfold, inside DSH', instructions: 'You are Unfold, working inside this DSH.' })

/** The Unfold Bot on `team`, as the plugin's createRuntime(ctx, team, config, env) made it. */
export function createUnfold(ctx, team, _config = {}, env = process.env) {
  const rt = Object.assign(Object.create(team), { ctx })
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
    writeFileSync(`${file()}.tmp`, `${JSON.stringify(data, null, 2)}\n`)
    renameSync(`${file()}.tmp`, file())
  }
  const unfoldBot = () => Object.values(rt.state?.bots ?? {}).find(bot => bot.kind === UNFOLD_KIND)
  const hasMain = () => (rt.state?.mainBotIds ?? []).some(id => rt.botOf?.(id))
  const noModel = async () => (await Promise.resolve(rt.defaultModel?.()).catch(() => undefined)) === undefined

  async function make({ main }) {
    const name = rt.findBot?.(UNFOLD_NAME) === undefined ? UNFOLD_NAME : `${UNFOLD_NAME} ${Date.now()}`
    let existingSessionId
    if (unfoldLeads(env)) {
      const session = ctx.get?.('unfoldSession')
      if (!session?.sessionId || !session.ready) throw new Error('Unfold session is not ready')
      await session.ready
      existingSessionId = session.sessionId
    }
    const bot = await rt.createBot({ ...UNFOLD_BOT, name, main, pickModel: await noModel(), ...(existingSessionId === undefined ? {} : { existingSessionId }) })
    load().unfoldCreated = true
    save()
    return bot
  }

  let making = null
  async function mainBot() {
    if (making !== null) return making
    if (unfoldBot() !== undefined || load().unfoldCreated) return undefined
    making = make({ main: true }).finally(() => { making = null })
    return making
  }

  async function ensureUnfold() {
    await rt.load()
    if (rt.readOnly() !== undefined) return undefined
    if (!hasMain()) await team.bootstrap()
    const existing = unfoldBot()
    if (existing !== undefined) {
      if (unfoldLeads(env) && existing.id === ctx.get?.('unfoldSession')?.sessionId) {
        await Promise.resolve(rt.keepAdoptedSession?.(existing.id))
          .catch(error => rt.warn?.('unfold-bot: the Unfold Bot was not put back on its Session: %s', error?.message ?? error))
      }
      return existing
    }
    if (load().unfoldCreated) return undefined
    return unfoldLeads(env) && !hasMain() ? mainBot() : make({ main: false })
  }

  if (unfoldLeads(env)) {
    ctx.effect(() => {
      team.mainBotMaker = mainBot
      return () => { if (team.mainBotMaker === mainBot) delete team.mainBotMaker }
    }, 'unfold-bot: the first Main Bot')
  }

  const ready = (async () => {
    try {
      return await ensureUnfold()
    } catch (error) {
      rt.warn?.('unfold-bot: the Unfold Bot was not made: %s', error?.message ?? error)
      return undefined
    }
  })()
  return Object.assign(rt, { ensureUnfold, unfoldReady: ready })
}
