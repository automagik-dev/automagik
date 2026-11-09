import { useSyncExternalStore } from 'react'

// What each power button (Omni, Genie, Unfold) is doing, kept outside the views that draw it:
// the team step's cards and the sidebar's power shortcut (power-shortcut.js) read the same
// phase, and a power-on started in one keeps running when that view closes. Only an explicit
// stop (a card's Remove or power-off) aborts a run; unmounting never does.

// The phases a power-on is still working through (team.js powerOn, botPowerOn, sandboxInstall).
export const WORKING = new Set(['waking', 'installing', 'starting', 'looking', 'sandbox'])

const ASLEEP = Object.freeze({ phase: 'asleep', detail: null })
const states = new Map()
const runs = new Map()
const listeners = new Set()

export const powerOf = kind => states.get(kind) ?? ASLEEP

export function showPower(kind, phase, detail = null) {
  states.set(kind, { phase, detail })
  for (const listener of Array.from(listeners)) listener()
}

export function subscribePower(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export const usePowerState = kind => useSyncExternalStore(subscribePower, () => powerOf(kind), () => powerOf(kind))

// The signal of the kind's latest run, aborted once it was stopped; null before any run.
export const powerSignal = kind => runs.get(kind)?.signal ?? null

/**
 * Runs `run({ show, signal })` as the kind's power-on, replacing the run before it. Only the
 * latest run draws; an error that is not the run being stopped ends it as failed.
 */
export function runPower(kind, run) {
  runs.get(kind)?.abort()
  const controller = new AbortController()
  runs.set(kind, controller)
  const latest = () => runs.get(kind) === controller && !controller.signal.aborted
  const show = (phase, detail = null) => { if (latest()) showPower(kind, phase, detail) }
  let running
  try {
    running = Promise.resolve(run({ show, signal: controller.signal }))
  } catch (error) {
    running = Promise.reject(error)
  }
  running.catch((error) => {
    if (error?.name !== 'AbortError' && latest()) showPower(kind, 'failed', { message: error?.message ?? String(error) })
  })
  return controller
}

// A press while the kind is already working starts nothing: one install however many clicks.
export const startPower = (kind, run) => (WORKING.has(powerOf(kind).phase) ? null : runPower(kind, run))

// Stops the kind's run, if one is going. The host's own install job, once started, finishes.
export function stopPower(kind) {
  runs.get(kind)?.abort()
}

// The shortcut's way into the team step: it opens the step on purpose, so the step saves
// nothing on Continue (TeamStep's explicit mode), and `power` ('omni') powers that card on by
// itself. One-shot, short-lived, and mirrored to sessionStorage where there is one.
const INTENT_KEY = 'automagik.welcome.team-intent'
export const INTENT_MS = 60_000
let intent = null

export function setTeamIntent(power = null, now = Date.now()) {
  intent = { power, at: now }
  try { globalThis.sessionStorage?.setItem(INTENT_KEY, JSON.stringify(intent)) } catch { /* the module copy stands */ }
}

export function takeTeamIntent(now = Date.now()) {
  let value = intent
  intent = null
  try {
    const stored = globalThis.sessionStorage?.getItem(INTENT_KEY)
    globalThis.sessionStorage?.removeItem(INTENT_KEY)
    if (value === null && stored) value = JSON.parse(stored)
  } catch { /* no storage, or an unreadable entry */ }
  return value !== null && typeof value?.at === 'number' && now - value.at >= 0 && now - value.at < INTENT_MS ? value : null
}

// For tests: forget every phase, run and intent.
export function resetPower() {
  for (const controller of runs.values()) controller.abort()
  runs.clear()
  states.clear()
  intent = null
  for (const listener of Array.from(listeners)) listener()
}
