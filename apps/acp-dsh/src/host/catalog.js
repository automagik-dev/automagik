// What an agent offers as DSH models: its own model list and each model's effort levels, read
// from the agent itself over ACP (its session config options of category `model` and
// `thought_level`). A probe starts the agent once, opens a session that is never prompted (no
// turn, no tokens), reads the models, then picks each one to read the efforts it offers, since
// an agent rebuilds its effort list per model. The result is kept here and, for the real
// agents, on disk, so the next start lists them at once while a new probe runs behind it.
// Until a probe answers, a short list of the agent's well-known names stands in.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { AgentRun, valuesOf } from './acp.js'

/** DSH's model for "whatever the agent's own settings choose"; Sessions saved before models came from the agent use it. */
export const DEFAULT_MODEL = 'default'
// How long a model list waits on a first probe before the stand-in list answers: the picker
// waits on every provider at once.
export const LIST_WAIT_MS = 8000
const PROBE_TIMEOUT_MS = 120_000
const RETRY_MS = 10 * 60 * 1000

/**
 * The efforts a `thought_level` option offers, from least to most, as DSH reasoning metadata.
 * The agent's own "default" row is no level: DSH sends no effort for it. The option's current
 * value, the person's own setting for that model, is the default effort.
 */
export function reasoningOf(option) {
  const efforts = valuesOf(option).filter(choice => choice.value !== DEFAULT_MODEL).map(choice => ({ id: choice.value, name: choice.name || choice.value, ...(choice.description ? { description: choice.description } : {}) }))
  if (efforts.length === 0) return undefined
  return { efforts, ...(efforts.some(effort => effort.id === option.currentValue) ? { defaultEffort: option.currentValue } : {}) }
}

/**
 * Read what one agent offers. `seen` gets the model list as soon as the session is open (each
 * model with `probed: false` until its efforts are read) and again after each model.
 * @param {AgentRun} run - started, never prompted.
 * @param {{ defaultName: string, seen?(state: CatalogState): void, stopped?(): boolean }} options
 */
export async function readCatalog(run, { defaultName, seen = () => {}, stopped = () => false }) {
  const modelOption = run.option('model')
  const startEffort = reasoningOf(run.option('thought_level'))
  if (modelOption === undefined) {
    const state = { models: [{ id: DEFAULT_MODEL, name: defaultName, reasoning: startEffort, probed: true }], complete: true }
    seen(state)
    return state
  }
  const start = run.startModel
  const models = valuesOf(modelOption).map(choice => ({ id: choice.value, name: choice.name || choice.value, ...(choice.description ? { description: choice.description } : {}), probed: false }))
  const own = models.find(model => model.id === start)
  if (!models.some(model => model.id === DEFAULT_MODEL)) {
    models.unshift({ id: DEFAULT_MODEL, name: defaultName, description: own ? `Its own setting: ${own.name}` : 'Its own setting', reasoning: startEffort, probed: true })
  }
  for (const model of models) {
    if (model.id === start) Object.assign(model, { reasoning: startEffort, probed: true })
  }
  const state = { models, complete: false }
  seen(state)
  for (const model of models) {
    if (model.probed) continue
    if (stopped()) return state
    await run.setOption('model', model.id)
    model.reasoning = reasoningOf(run.option('thought_level'))
    model.probed = true
    seen(state)
  }
  state.complete = true
  seen(state)
  return state
}

/**
 * @typedef {{ id: string, name: string, description?: string, reasoning?: { efforts: { id: string, name: string, description?: string }[], defaultEffort?: string }, probed?: boolean }} CatalogModel
 * @typedef {{ models: CatalogModel[], complete: boolean }} CatalogState
 */

const isText = value => typeof value === 'string' && value.length > 0
const isEffort = effort => isText(effort?.id) && isText(effort?.name) && (effort.description === undefined || typeof effort.description === 'string')
/** Whether a kept entry is a model as a probe writes it: DSH turns down any other shape. */
export function isModel(model) {
  if (!isText(model?.id) || !isText(model?.name)) return false
  if (model.description !== undefined && typeof model.description !== 'string') return false
  const reasoning = model.reasoning
  if (reasoning === undefined) return true
  if (!Array.isArray(reasoning?.efforts) || reasoning.efforts.length === 0 || !reasoning.efforts.every(isEffort)) return false
  const ids = reasoning.efforts.map(effort => effort.id)
  if (new Set(ids).size !== ids.length) return false
  return reasoning.defaultEffort === undefined || ids.includes(reasoning.defaultEffort)
}

export class Catalog {
  /**
   * @param {{
   *   id: string, name: string, defaultName: string, fallback: CatalogModel[],
   *   key(): string | undefined, spawn(): { command: string, args?: string[], env?: Record<string, string> } | Promise<any>,
   *   home?: string, log?(message: string): void, waitMs?: number, now?(): number,
   * }} spec - `key` names what the probe ran (the adapter's release); a new one probes again.
   */
  constructor(spec) {
    this.spec = spec
    this.now = spec.now ?? Date.now
    this.waitMs = spec.waitMs ?? LIST_WAIT_MS
    this.file = spec.home ? join(spec.home, `${spec.id}.json`) : undefined
    this.saved = this.read()
    this.live = undefined
    this.probing = undefined
    this.listed = undefined
    // A kept catalog read from the release installed now is not read again at start: a new
    // adapter release (or another CLI) changes the key and probes again.
    this.probedKey = this.saved?.key
    this.failedAt = undefined
    this.run = undefined
    this.disposed = false
  }

  // A kept file that is not wholly what a probe writes is not used: the stand-ins answer until
  // the next probe writes it again.
  read() {
    if (this.file === undefined) return undefined
    try {
      const saved = JSON.parse(readFileSync(this.file, 'utf8'))
      return Array.isArray(saved?.models) && saved.models.length > 0 && saved.models.every(isModel) ? saved : undefined
    } catch {
      return undefined
    }
  }

  write(key, models) {
    if (this.file === undefined) return
    try {
      mkdirSync(this.spec.home, { recursive: true })
      const tmp = `${this.file}.${process.pid}.tmp`
      writeFileSync(tmp, `${JSON.stringify({ key, at: this.now(), models: models.map(({ probed, ...model }) => model) }, null, 2)}\n`)
      renameSync(tmp, this.file)
    } catch (error) {
      this.spec.log?.(`could not keep ${this.spec.name}'s models: ${error?.message ?? error}`)
    }
  }

  /** Probe again when nothing has, the agent's release changed, or the last try failed a while ago. */
  kick() {
    if (this.probing !== undefined || this.disposed) return
    const key = this.spec.key()
    if (key === undefined) return
    if (this.probedKey === key && (this.failedAt === undefined || this.now() - this.failedAt < RETRY_MS)) return
    this.probedKey = key
    this.failedAt = undefined
    let listed
    this.listed = new Promise((resolve) => { listed = resolve })
    this.probing = this.probe(key, listed).finally(() => {
      listed()
      this.probing = undefined
    })
  }

  async probe(key, listed) {
    let run
    const timer = setTimeout(() => run?.dispose(), PROBE_TIMEOUT_MS)
    timer.unref?.()
    try {
      run = new AgentRun({ ...(await this.spec.spawn()), cwd: homedir(), name: this.spec.name })
      this.run = run
      await run.start()
      const state = await readCatalog(run, {
        defaultName: this.spec.defaultName,
        stopped: () => this.disposed || !run.alive,
        seen: (state) => {
          if (this.probedKey !== key) return
          this.live = state
          listed()
        },
      })
      if (!state.complete) throw new Error('it stopped before every model was read')
      this.write(key, state.models)
    } catch (error) {
      this.failedAt = this.now()
      if (!this.disposed) this.spec.log?.(`could not read ${this.spec.name}'s models, offering its usual ones: ${error?.message ?? error}`)
    } finally {
      clearTimeout(timer)
      run?.dispose()
      if (this.run === run) this.run = undefined
    }
  }

  /** The models as best known now: a probe's, else the last one kept, else the stand-ins. */
  current() {
    const saved = this.saved?.models
    if (this.live === undefined) return saved ?? this.spec.fallback
    const provisional = this.live.models.find(model => model.id === DEFAULT_MODEL)?.reasoning
    return this.live.models.map((model) => {
      if (model.probed) return model
      // Efforts not read yet: the ones kept for it, else those of the model the agent started on.
      const kept = saved?.find(other => other.id === model.id)
      return { ...model, reasoning: kept ? kept.reasoning : provisional }
    })
  }

  /** Every model the agent offers; a first probe is waited on briefly. */
  async models() {
    this.kick()
    if (this.saved === undefined && this.live === undefined && this.listed !== undefined) {
      let timer
      await Promise.race([this.listed, new Promise((resolve) => { timer = setTimeout(resolve, this.waitMs); timer.unref?.() })])
      clearTimeout(timer)
    }
    return this.current()
  }

  /**
   * The effort the agent itself shows for a model, as read for that model: a probe's when it has
   * read that model, else what was kept, else undefined. Never a stand-in's, and never waited
   * for: a turn does not stall on a probe.
   */
  ownEffort(id) {
    const live = this.live?.models.find(model => model.id === id)
    if (live?.probed) return live.reasoning?.defaultEffort
    return this.saved?.models.find(model => model.id === id)?.reasoning?.defaultEffort
  }

  /** One model by id, or undefined when the agent does not offer it. */
  async model(id) {
    return (await this.models()).find(model => model.id === id)
  }

  dispose() {
    this.disposed = true
    this.run?.dispose()
  }
}
