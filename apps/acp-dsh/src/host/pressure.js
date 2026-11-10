// The model-switch guard and an agent's route (RFC 0003, amendment, "Live switching").
// compaction-basic prices every switch with `compactPressure` on the destination's header, and
// an agent declares no context window (it keeps its own context), so the guard threw "no
// context capacity" before any threshold: API -> agent and agent -> agent switches failed with
// MODEL_SWITCH_COMPACTION_FAILED whenever the Session had a request header. An agent receives
// the transcript as a bounded, redacted replay instead (switch.js), so there is nothing to
// condense for it: this plugin answers "no compaction needed" for an agent destination and
// leaves every other destination to the engine as it is.
//
// This plugin is the method's only Automagik owner (the Bot team never wraps it). The wrapper
// is chain-safe: it delegates to whatever was below it, read when it is called, so another
// wrapper installed before or after it keeps working; on dispose it unwinds only when it is
// still on top, and otherwise stays in place as an inert pass-through.
//
// The method is another plugin's private one, so a DSH update can take it away (#871). An engine
// this plugin cannot guard is then said out loud (`onUnguarded`), never passed over in silence:
// without the wrapper, a switch to an agent fails as it did before this plugin had one.

/** The engine method this plugin wraps. Private to compaction-basic: a guard test pins it. */
export const PRESSURE_METHOD = 'compactPressure'

const hasOwn = (target, key) => Object.prototype.hasOwnProperty.call(target, key)

// cordis hands each `ctx.get()` caller a fresh tracing proxy of a service, whose methods come
// back as fresh bound proxies too: identity checks and the wrapper itself work on the raw
// instance the proxies share.
const ORIGINAL = Symbol.for('cordis.original')
const rawOf = (engine) => {
  if (engine === null || typeof engine !== 'object') return undefined
  try {
    const original = engine[ORIGINAL]
    return original !== null && typeof original === 'object' ? original : engine
  } catch {
    return engine
  }
}

/**
 * The wrapper owner for one plugin instance. `adopt` is idempotent per engine instance; a
 * recreated engine (a reloaded compaction plugin, a preset mount) is a new instance and is
 * adopted when an agent next reaches it.
 * `onUnguarded(reason)` is told once per engine instance that the engine is there and cannot
 * be guarded: `missing` (it has no such method any more) or `locked` (it cannot be wrapped).
 * @param {{ agentDestination(provider: unknown): boolean, onUnguarded?(reason: 'missing' | 'locked'): void }} options
 * @returns {{ adopt(engine: any): boolean, dispose(): void, adopted(engine: any): boolean }}
 */
export function pressureGuard({ agentDestination, onUnguarded }) {
  const links = new Map()
  const unguarded = new WeakSet()
  let disposed = false

  const refuse = (engine, reason) => {
    if (!unguarded.has(engine)) {
      unguarded.add(engine)
      try { onUnguarded?.(reason) } catch {}
    }
    return false
  }

  function adopt(service) {
    const engine = rawOf(service)
    if (disposed || engine === undefined || links.has(engine)) return false
    const current = engine[PRESSURE_METHOD]
    if (typeof current !== 'function') return refuse(engine, 'missing')
    // An own property is another owner's wrapper (or an instance override): call it. An
    // inherited method is looked up again at each call, so a replaced prototype is honoured.
    const link = { inert: false, below: hasOwn(engine, PRESSURE_METHOD) ? current : undefined, wrapper: undefined }
    link.wrapper = function compactPressureOutsideAgents(agent, header, signal, requireBelowThreshold) {
      if (!link.inert && agentDestination(header?.config?.provider)) return Promise.resolve(null)
      const below = link.below ?? Reflect.get(Object.getPrototypeOf(engine) ?? {}, PRESSURE_METHOD, this)
      return below.call(this, agent, header, signal, requireBelowThreshold)
    }
    try {
      engine[PRESSURE_METHOD] = link.wrapper
    } catch {
      return refuse(engine, 'locked')
    }
    if (engine[PRESSURE_METHOD] !== link.wrapper) return refuse(engine, 'locked')
    links.set(engine, link)
    return true
  }

  function dispose() {
    disposed = true
    for (const [engine, link] of links) {
      if (hasOwn(engine, PRESSURE_METHOD) && engine[PRESSURE_METHOD] === link.wrapper) {
        try {
          if (link.below === undefined) delete engine[PRESSURE_METHOD]
          else engine[PRESSURE_METHOD] = link.below
          continue
        } catch {}
      }
      // Someone wrapped above this one: removing it would drop their wrapper too, so it stays
      // and only passes calls down.
      link.inert = true
    }
    links.clear()
  }

  return { adopt, dispose, adopted: engine => links.has(rawOf(engine)) }
}

/**
 * The compaction engines that may serve `agent`: its preset's own mount, then the root one.
 * @param {any} ctx
 * @param {any} agent
 */
export function enginesFor(ctx, agent) {
  const engines = []
  try {
    const preset = ctx.get?.('agentPresets')?.serviceFor?.(agent, 'compaction')
    if (preset !== undefined) engines.push(preset)
  } catch {}
  try {
    const root = ctx.get?.('compaction')
    if (root !== undefined && !engines.includes(root)) engines.push(root)
  } catch {}
  return engines
}
