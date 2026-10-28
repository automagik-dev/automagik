// The Unfold card in a plain DSH: the person makes a companion, then powers Unfold on, which
// installs the Bot team and @automagik/unfold-bot-dsh. After the restart the team has no Main Bot
// yet. The companion must still become the Main Bot, with Unfold beside it; only Unfold's own
// instance hands Unfold the lead.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRuntime as createUnfold } from '../../unfold-bot-dsh/index.js'
import { createCompanionActions } from '../src/host/companion.js'

// A team as bots-dsh keeps it (roster.js bootstrap): the first Main Bot comes from the Main Bot
// maker a plugin set, when there is one, else it is the default "Omni".
function fakeTeam(home) {
  const state = { bots: {}, mainBotIds: [] }
  let made = 0
  let bootstrapping = null
  const team = {
    home,
    state,
    load: async () => {},
    readOnly: () => undefined,
    defaultModel: async () => undefined,
    findBot: name => Object.values(state.bots).find(bot => bot.name === name),
    botOf: id => state.bots[id],
    createBot: async (options) => {
      made += 1
      const bot = { id: `bot-${made}`, ...options }
      state.bots[bot.id] = bot
      if (options.main) state.mainBotIds.push(bot.id)
      return bot
    },
    updateBot: async (id, patch) => Object.assign(state.bots[id], patch),
    async bootstrap() {
      if (state.mainBotIds.some(id => team.botOf(id))) return
      const makeDefault = () => team.createBot({ name: 'Omni', role: 'Your companion', main: true, pickModel: true })
      bootstrapping ??= (team.mainBotMaker ? Promise.resolve(team.mainBotMaker()).then(bot => (state.mainBotIds.some(id => team.botOf(id)) ? bot : makeDefault())) : makeDefault())
        .finally(() => { bootstrapping = null })
      await bootstrapping
    },
  }
  return team
}

const ctxOf = (team, entry) => ({
  get: name => (name === 'omniTeam' ? team : undefined),
  settings: { describe: () => [{ ns: 'omni-ai', value: entry }], update: async () => {} },
  effect: (run) => { run() },
  logger: { warn: () => {} },
})

async function afterRestart(env, entry) {
  const home = mkdtempSync(join(tmpdir(), 'welcome-unfold-companion-'))
  try {
    const team = fakeTeam(home)
    const ctx = ctxOf(team, entry)
    await createUnfold(ctx, team, {}, env).unfoldReady
    await createCompanionActions(ctx, { env: {} })['team-save']({ omni: false })
    return Object.values(team.state.bots).map(bot => [bot.name, bot.kind ?? null, team.state.mainBotIds.includes(bot.id)])
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
}

test('in a plain DSH, the companion made before Unfold powered on is the Main Bot, with Unfold beside it', async () => {
  assert.deepEqual(await afterRestart({}, { companionName: 'Pip', companionColor: 'teal' }), [['Pip', null, true], ['Unfold', 'unfold', false]])
})

test('in Unfold\'s own instance, Unfold leads the team and no companion is made', async () => {
  for (const env of [{ AUTOMAGIK_HOST: 'unfold' }, { AUTOMAGIK_PRELOAD: 'unfold' }]) {
    assert.deepEqual(await afterRestart(env, { companionDone: true }), [['Unfold', 'unfold', true]], JSON.stringify(env))
  }
})
