// Permission levels, across providers. A level is stored as DSH's preset name, and DSH's
// preset runs every provider's tools. Pure, so the client imports it too.

export const AUTO = 'auto'
// The level a saved Auto runs as where it cannot be applied: never a looser one.
export const AUTO_FALLBACK = 'workspace-write'

export const AUTO_MARK = 'acp-codex'
export const MARK_LEVEL = 'workspace-write'
export const AUTO_ROW = 'workspace-write:auto'

import { routeOf } from './routes.js'

export const OWN_MODE_MARKS = ['acp-codex', 'acp-claude']
export const TEAM_MARKS = ['acp-hermes', 'acp-antigravity', 'acp-omp']
export function markOf(ref) {
  if (typeof ref !== 'string') return undefined
  const slash = ref.indexOf('/')
  const provider = slash < 0 ? ref : ref.slice(0, slash)
  if (OWN_MODE_MARKS.includes(provider) || TEAM_MARKS.includes(provider)) return provider
  return slash > 0 && ref.slice(slash + 1) && ['native', 'pi-ai'].includes(routeOf(provider).connectedBy) ? `api:${ref}` : undefined
}
export const judgeOf = mark => mark === 'acp-codex' ? 'codex' : mark === 'acp-claude' ? 'claude' : TEAM_MARKS.includes(mark) ? 'team' : typeof mark === 'string' && mark.startsWith('api:') ? 'own' : undefined
