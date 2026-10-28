// DSH bots: plain dsh entries listed under the Bots but not Bots. The user makes any number,
// each with a name, a project folder (`workDir`, else the team workspace) and a DSH agent
// preset (`profile`, else DSH's default). Their Sessions are ordinary root Sessions there,
// so they get the whole dsh conversation surface and none of the team tools.
//
// The tasks record (`kind: 'tasks'`) is not one: it keeps the Sessions of the one-off work
// a Bot hands off (start_task), which show under that Bot; when a task's first turn ends,
// its last words go back to the Bot. Only a task whose Bot is gone shows under it.
import { randomUUID } from 'node:crypto'
import { isAbsolute } from 'node:path'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { AGENT_NAME, AGENT_SESSION_TITLE_MAX, DSH_BOT_NAME_MAX, TEAM_TOOLS } from './constants.js'
import { splitRef } from './text.js'
import { output } from './tools.js'
import { OMNI_KIND } from './roster.js'

const TASK_REPORT_MAX = 1500
const TASKS_KEPT = 60
const TASK_LINE_MAX = 160
const TASK_SUMMARY_MAX = 600

export const DSH_BOT = 'dsh'
export const TASKS = 'tasks'

export function install(rt) {
  const { ctx, state } = rt

  const dshBots = () => Object.values(state.agents).filter(agent => agent.kind === DSH_BOT)
  const tasksRecord = () => Object.values(state.agents).find(agent => agent.kind === TASKS)
  // What other plugins read of a DSH bot; null is the team workspace and DSH's default preset.
  const listed = agent => ({ id: agent.id, name: agent.name, workDir: agent.workDir ?? null, profile: agent.profile ?? null })

  // LEGACY: the single DSH Agent, shown as Tasks, held both the Sessions the user opened
  // there and the ones Bots and automations started. The first become a DSH bot of that
  // name in the team workspace, the others the tasks record. store.js calls this as it adopts.
  rt.migrateAgents = () => {
    let migrated = false
    const started = new Set([...Object.keys(state.tasks ?? {}), ...(state.subscriptionRuns ?? []).map(run => run.sessionId)])
    for (const agent of Object.values(state.agents)) {
      if (agent.kind !== undefined) continue
      migrated = true
      const sessions = agent.sessions ?? []
      const own = sessions.filter(id => !started.has(id))
      if (own.length === 0) {
        agent.kind = TASKS
        continue
      }
      agent.kind = DSH_BOT
      agent.sessions = own
      const handed = sessions.filter(id => started.has(id))
      if (handed.length === 0) continue
      const tasks = tasksRecord() ?? (state.agents[`${agent.id}:tasks`] = { id: `${agent.id}:tasks`, kind: TASKS, name: AGENT_NAME, sessions: [], createdAt: agent.createdAt ?? Date.now() })
      tasks.sessions.push(...handed)
    }
    return migrated
  }

  /** @type {Map<string, string>} Session id -> DSH bot or tasks record id. */
  const sessionIndex = new Map()
  // Told when the DSH bots change (rt.dshBots.onChange), with the new list.
  const listeners = new Set()
  let listedKey = ''
  // store.js calls this from indexSessions after every adopt and save.
  rt.indexAgents = () => {
    sessionIndex.clear()
    for (const agent of Object.values(state.agents)) {
      for (const sessionId of agent.sessions ?? []) sessionIndex.set(sessionId, agent.id)
    }
    const list = dshBots().map(listed)
    const key = JSON.stringify(list)
    if (key === listedKey) return
    listedKey = key
    for (const listener of listeners) {
      try {
        listener(list)
      } catch (error) {
        rt.warn('ds-bot: a DSH bot listener failed: %s', error?.message ?? error)
      }
    }
  }
  // The DSH bot or the tasks record a Session belongs to; Bot and group Sessions get undefined.
  const agentOf = sessionId => state.agents[sessionIndex.get(sessionId)]

  // A DSH bot or task Session must not offer the team tools: its agent sees only the
  // global dsh surface minus this plugin's registrations. A Session whose deny
  // has not landed yet (schemas not up, restrict hook missing, a transient
  // throw) stays on the retry list until it sticks or the Session leaves.
  const restricted = new WeakSet()
  const RETRY_MS = 5_000
  const pendingRestrict = new Set()
  let retryTimer
  const stopRetry = () => {
    if (retryTimer !== undefined) clearInterval(retryTimer)
    retryTimer = undefined
  }
  ctx.effect(() => stopRetry, 'ds-bot: agent tool restrict retry')
  const scheduleRetry = (agent) => {
    pendingRestrict.add(agent)
    if (retryTimer === undefined) {
      retryTimer = setInterval(() => {
        for (const waiting of [...pendingRestrict]) void restrictTeamTools(waiting)
        if (pendingRestrict.size === 0) stopRetry()
      }, RETRY_MS)
      retryTimer.unref?.()
    }
  }
  const restrictTeamTools = async (agent) => {
    if (agent === undefined || restricted.has(agent)) return
    if (agentOf(agent.session?.id) === undefined) {
      pendingRestrict.delete(agent)
      return
    }
    // Unknown names make restrict() throw, so only deny what this profile serves.
    const known = new Set(ctx.tools.schemas(agent).map(schema => schema.name))
    // A Bot's own browser (browser-plugins.js) is the team's too: its tools answer Bots only.
    const deny = [...TEAM_TOOLS, ...rt.browserToolNames ?? []].filter(name => known.has(name))
    // An empty list can mean the schemas are not up yet, and a missing restrict
    // hook means the Agent is still being put together; both retry.
    if (deny.length === 0 || typeof agent.ctx?.tools?.restrict !== 'function') {
      scheduleRetry(agent)
      return
    }
    try {
      agent.ctx.tools.restrict({ deny })
      restricted.add(agent)
      pendingRestrict.delete(agent)
    } catch (error) {
      rt.warn('ds-bot: team tools stay visible to DSH bot Session %s: %s', agent.session?.id, error)
      scheduleRetry(agent)
    }
  }
  // Fires when a root Session resolves its agent, including sessions saved earlier.
  ctx.on('agent/created', ({ agent }) => {
    void rt.load()
      .then(() => restrictTeamTools(agent))
      .catch(error => rt.warn('ds-bot: tool restrict on agent/created failed: %s', error))
  })

  const writeCheck = () => {
    const readOnly = rt.readOnly()
    if (readOnly !== undefined) throw new Error(readOnly)
  }
  const record = (agentId) => {
    const agent = rt.own(state.agents, agentId)
    if (agent === undefined) throw new Error('Unknown DSH bot')
    return agent
  }

  // A Session of a DSH bot starts in its folder with its preset; a task's comes from the caller.
  async function createAgentSession(agentId, workspaceId, options = {}) {
    writeCheck()
    const agent = record(agentId)
    if (agent.kind === DSH_BOT) {
      if (agent.workDir !== undefined && !(await rt.isFolder(agent.workDir))) throw new Error(`The folder ${agent.workDir} of ${agent.name} is gone. Pick another in its settings.`)
      options = { cwd: agent.workDir, agentPreset: agent.profile }
    }
    const { cwd, agentPreset } = options
    // A folder of its own (a task's `cwd`) makes the Session by cwd alone, outside every
    // DSH workspace, as a Bot's working folder does. Otherwise a known workspace id wins
    // (the Agent's latest Session may live outside the team workspace after a workspace
    // switch); anything else gets the team's own.
    const own = typeof cwd === 'string' && isAbsolute(cwd) && await rt.isFolder(cwd)
    if (cwd !== undefined && !own) rt.warn('ds-bot: the task folder %s is not an absolute path to a folder; the task starts in the team workspace', cwd)
    const place = own
      ? { cwd }
      : { workspaceId: typeof workspaceId === 'string' && ctx.workspaceRegistry.get(workspaceId) ? workspaceId : await rt.ensureWorkspace() }
    const preset = await servedPreset(agentPreset)
    const { sessionId } = await ctx.sessionController.create({ ...place, ...(preset ? { agentPreset: preset } : {}) })
    agent.sessions.push(sessionId)
    await rt.save()
    // agent/created fired before the session joined the index, so restrict again now.
    await restrictTeamTools(await rt.resolveAgent(sessionId))
    return sessionId
  }

  // A root Session the user opened from a DSH bot page (the hero's workspace
  // picker or a fork) is adopted into the same Agent: it keeps dsh's surface and
  // the team tools stay hidden.
  async function adoptAgentSession(agentId, sessionId) {
    writeCheck()
    const agent = record(agentId)
    if (agent.sessions.includes(sessionId)) return sessionId
    await rt.resolveAgent(sessionId)
    const owned = rt.selfOf(sessionId) !== undefined || rt.botOf(sessionId) !== undefined
      || rt.roomOf(sessionId) !== undefined || agentOf(sessionId) !== undefined
    if (owned) throw new Error('Session already belongs to the team')
    agent.sessions.push(sessionId)
    await rt.save()
    await restrictTeamTools(await rt.resolveAgent(sessionId))
    return sessionId
  }

  // A DSH bot's name, folder and preset, checked: a folder that exists outside DSH's data
  // (undefined: the team workspace), and a preset this DSH serves (undefined: DSH's default).
  async function dshBotFields({ name, workDir, profile } = {}, id) {
    const clean = String(name ?? '').trim().slice(0, DSH_BOT_NAME_MAX)
    if (clean === '') throw new Error('A DSH bot needs a name')
    const taken = dshBots().some(agent => agent.id !== id && agent.name.toLowerCase() === clean.toLowerCase())
    if (taken) throw new Error(`A DSH bot named ${clean} already exists`)
    const folder = await rt.cleanWorkDir(String(workDir ?? ''))
    const preset = typeof profile === 'string' && profile !== '' ? await servedPreset(profile, { strict: true }) : undefined
    return { name: clean, workDir: folder, profile: preset }
  }
  const setFields = (agent, fields) => {
    agent.name = fields.name
    for (const key of ['workDir', 'profile']) {
      if (fields[key] === undefined) delete agent[key]
      else agent[key] = fields[key]
    }
  }

  async function addAgent(fields) {
    writeCheck()
    const agent = { id: randomUUID(), kind: DSH_BOT, sessions: [], createdAt: Date.now() }
    setFields(agent, await dshBotFields(fields))
    state.agents[agent.id] = agent
    try {
      await createAgentSession(agent.id)
    } catch (error) {
      // The first Session may already be created and saved: archive it and
      // persist the rollback, or the DSH bot returns on restart with its team
      // tools never denied.
      const createdSessions = [...agent.sessions]
      delete state.agents[agent.id]
      for (const sessionId of createdSessions) await ctx.workspaceRegistry.archiveSession(sessionId).catch(() => {})
      await rt.save().catch(() => {})
      throw error
    }
    return agent
  }

  // A new name, folder or preset applies to the Sessions made after it; the others keep theirs.
  async function updateAgent(agentId, fields) {
    writeCheck()
    const agent = record(agentId)
    if (agent.kind !== DSH_BOT) throw new Error('Unknown DSH bot')
    setFields(agent, await dshBotFields(fields, agent.id))
    await rt.save()
    return agent
  }

  async function archiveAgentSession(agentId, sessionId) {
    writeCheck()
    const agent = record(agentId)
    if (!agent.sessions.includes(sessionId)) throw new Error('Session does not belong to the DSH bot')
    // Archive first: the Session leaves the Agent only once it is actually gone,
    // so a failed archive stays retryable and keeps its tool restriction.
    await ctx.workspaceRegistry.archiveSession(sessionId)
    agent.sessions = agent.sessions.filter(id => id !== sessionId)
    await rt.save()
  }

  async function renameAgentSession(agentId, sessionId, title) {
    writeCheck()
    const agent = record(agentId)
    if (!agent.sessions.includes(sessionId)) throw new Error('Session does not belong to the DSH bot')
    const clean = String(title ?? '').trim()
    if (clean === '') throw new Error('A session needs a title')
    const agent_ = await rt.resolveAgent(sessionId)
    await ctx.sessionTitle.rename(agent_.session, clean.slice(0, AGENT_SESSION_TITLE_MAX))
  }

  async function removeAgent(agentId) {
    writeCheck()
    const agent = record(agentId)
    const sessions = [...agent.sessions]
    const kept = []
    let failure
    for (const sessionId of sessions) {
      try {
        await ctx.workspaceRegistry.archiveSession(sessionId)
      } catch (error) {
        failure ??= error
        kept.push(sessionId)
      }
    }
    // What could not be archived stays with the DSH bot, so it keeps its tool
    // restriction and the removal can be retried from the same place.
    if (kept.length > 0) {
      agent.sessions = kept
      await rt.save()
      throw failure
    }
    delete state.agents[agentId]
    await rt.save()
  }

  // The tasks record, made when the first task starts.
  async function ensureTasks() {
    const existing = tasksRecord()
    if (existing !== undefined) return existing
    writeCheck()
    const agent = { id: randomUUID(), kind: TASKS, name: AGENT_NAME, sessions: [], createdAt: Date.now() }
    state.agents[agent.id] = agent
    await rt.save()
    return agent
  }

  // The DSH agent presets this DSH serves unbroken, for the DSH bot form.
  async function presets() {
    try {
      return ((await ctx.get?.('agentPresets')?.list?.()) ?? []).filter(preset => preset.broken === undefined)
        .map(preset => ({ id: preset.id, name: preset.name ?? preset.id, ...(preset.description ? { description: preset.description } : {}) }))
    } catch {
      return []
    }
  }
  // A DSH agent preset by id, when this DSH serves it unbroken; anything else is DSH's
  // default, or refused when `strict`.
  async function servedPreset(id, { strict = false } = {}) {
    if (typeof id !== 'string' || id === '') return undefined
    if ((await presets()).some(preset => preset.id === id)) return id
    if (strict) throw new Error(`The preset ${id} is not available in this DSH`)
    rt.warn('ds-bot: the agent preset %s is not served here; the task takes DSH\'s default', id)
    return undefined
  }

  // A fresh task Session with a title; automations that run "a new DSH session" use it too.
  // Another plugin may give it a folder (`cwd`) and a DSH agent preset of its own.
  async function createTaskSession(title, { cwd, agentPreset } = {}) {
    const agent = await ensureTasks()
    const sessionId = await createAgentSession(agent.id, undefined, { cwd, agentPreset })
    const clean = String(title ?? '').trim().slice(0, AGENT_SESSION_TITLE_MAX)
    if (clean !== '') await renameAgentSession(agent.id, sessionId, clean).catch(error => rt.warn('ds-bot: task title not set: %s', error?.message ?? error))
    return sessionId
  }

  // A task thinks with the model of the Bot that asked, as that Bot's own chat does, not
  // with DSH's default: the default may be a route this machine has no key for. Before the
  // first message, so the first turn already runs on it.
  async function askersModel(sessionId, bot) {
    if (bot === undefined) return
    try {
      const ref = await rt.desiredModel(bot)
      if (ref === undefined) return
      const effort = await rt.desiredEffort(bot, ref)
      await rt.selectSessionModel(sessionId, { ...splitRef(ref), ...(effort === undefined ? {} : { reasoningEffort: effort }) })
    } catch (error) {
      rt.warn('ds-bot: the task keeps the default model, %s\'s was not applied: %s', bot.name, error?.message ?? error)
    }
  }

  const tasks = () => (state.tasks ??= {})
  async function startTask({ title, text, from, cwd, agentPreset }) {
    const sessionId = await createTaskSession(title, { cwd, agentPreset })
    tasks()[sessionId] = { title: String(title).slice(0, AGENT_SESSION_TITLE_MAX), from, at: Date.now(), status: 'working' }
    // Only the newest tasks are remembered for their reports.
    const kept = Object.entries(tasks()).sort(([, a], [, b]) => b.at - a.at)
    for (const [id] of kept.slice(TASKS_KEPT)) delete tasks()[id]
    await rt.save()
    await askersModel(sessionId, state.bots?.[from])
    const live = await rt.resolveAgent(sessionId)
    // DSH's turn loop reads every input's source: the instructions arrive as the user's.
    live.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
    await ctx.sessions.flush(live.session)
    return sessionId
  }

  // A task's first turn ends: its last words go to the Bot that asked, once.
  const lastWords = new Map()
  ctx.on('session/event', (session, event) => {
    const id = session?.id
    const task = id === undefined ? undefined : state.tasks?.[id]
    if (task === undefined || task.status !== 'working') return
    if (event?.type === 'assistant/message') {
      const content = event.data?.message?.content
      const text = Array.isArray(content) ? content.filter(block => block?.type === 'text').map(block => block.text).join('\n').trim() : ''
      // What the task is on, for its card in the chat: its latest words and how far it got.
      task.steps = (task.steps ?? 0) + 1
      const calls = Array.isArray(content) ? content.filter(block => block?.type === 'tool-call' || block?.type === 'tool_use').map(block => block.name ?? block.toolName).filter(Boolean) : []
      if (calls.length > 0) task.tool = String(calls.at(-1)).slice(0, 40)
      if (text) {
        lastWords.set(id, text)
        task.said = text.replace(/\s+/g, ' ').slice(0, TASK_LINE_MAX)
      }
      void rt.save().catch(error => rt.warn('ds-bot: saving a task failed: %s', error))
    } else if (event?.type === 'turn/end') {
      // A restart cut the turn: the task is not done, and resume.js sets it going again.
      if (rt.cutByRestart?.(event.data?.reason)) return
      // An error fails the task; the user or a Bot stopping it (an abort) only stops it.
      const kind = event.data?.reason?.kind
      const failed = kind === 'error'
      const stopped = kind === 'aborted'
      task.status = failed ? 'failed' : stopped ? 'stopped' : 'done'
      task.endedAt = Date.now()
      const words = lastWords.get(id) ?? ''
      lastWords.delete(id)
      const problem = event.data?.reason?.error?.message || 'unknown error'
      task.summary = (failed ? problem : words).slice(0, TASK_SUMMARY_MAX)
      void rt.save().catch(error => rt.warn('ds-bot: saving a task failed: %s', error))
      if (rt.botOf(task.from) === undefined) return
      const said = failed ? `It failed: ${problem}`
        : stopped ? `It was stopped before it finished.${words ? ` Its last words: ${words}` : ''}`
        : words || 'It ended without a reply.'
      void rt.deliver({ toId: task.from, text: said.slice(0, TASK_REPORT_MAX), role: 'task-done', note: task.title, taskSessionId: id })
        .catch(error => rt.warn('ds-bot: the report of task %s did not reach its Bot: %s', task.title, error?.message ?? error))
    }
  })

  // A Session under a DSH bot for another plugin, with a title and, optionally, the
  // user's first message, which starts its first turn.
  async function createDshBotSession(botId, { title, firstMessage } = {}) {
    await rt.load()
    const agent = rt.own(state.agents, botId)
    if (agent?.kind !== DSH_BOT) throw new Error('Unknown DSH bot')
    const sessionId = await createAgentSession(agent.id)
    const clean = String(title ?? '').trim().slice(0, AGENT_SESSION_TITLE_MAX)
    if (clean !== '') await renameAgentSession(agent.id, sessionId, clean).catch(error => rt.warn('ds-bot: session title not set: %s', error?.message ?? error))
    const text = String(firstMessage ?? '').trim()
    if (text !== '') {
      const live = await rt.resolveAgent(sessionId)
      live.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
      await ctx.sessions.flush(live.session)
    }
    return { sessionId }
  }
  // For other plugins: the DSH bots, a Session under one, and word when the list changes.
  rt.dshBots = {
    list: () => dshBots().map(listed),
    createSession: createDshBotSession,
    onChange(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }

  ctx.tools.register(defineTool({
    name: 'start_task',
    description: 'Main Bot only. Hands one-off work (code, files, a repo, research, a long investigation) to a new session under your row, which has a full computer. Write instructions that stand on their own: it cannot see this chat. Its result comes back to you as a message when its first turn ends.',
    parameters: {
      title: { type: 'string', required: true, description: 'A few words the user will see under your row' },
      instructions: { type: 'string', required: true, description: 'Everything the task needs: the goal, where to work, what to return' },
    },
    output,
    async execute(args, exec) {
      await rt.load()
      const self = rt.selfOf(exec.agent?.id)
      // The Omni Bot too: Omni's rules send computer work to start_task.
      if (self === undefined || (!rt.isMain(self) && rt.botOf(self)?.kind !== OMNI_KIND)) return 'Only a Main Bot or the Omni Bot starts tasks. Ask one of them in its chat.'
      const title = String(args.title ?? '').trim()
      const text = String(args.instructions ?? '').trim()
      if (title === '' || text === '') return 'A task needs a title and instructions.'
      try {
        const sessionId = await startTask({ title, text, from: self })
        return `Started task "${title.slice(0, AGENT_SESSION_TITLE_MAX)}" (${sessionId}) under your row. Its result comes back to you as a message; do not wait or poll.`
      } catch (error) {
        return `The task did not start: ${error?.message ?? error}`
      }
    },
  }))

  Object.assign(rt, { agentOf, addAgent, updateAgent, presets, createAgentSession, adoptAgentSession, archiveAgentSession, renameAgentSession, removeAgent, createTaskSession, startTask })
}
