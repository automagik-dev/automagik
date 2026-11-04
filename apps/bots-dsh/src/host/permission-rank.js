// The narrower of two permission levels, for a Session whose owner goes away: it must
// never end with more than it had. Auto is never narrower than workspace-write, its
// fallback. A level outside this ranking (a custom preset) cannot be compared, so the
// answer is read-only. Host only: the client has no use for it.
import { AUTO, AUTO_FALLBACK } from '../shared/permission-levels.js'

export const READ_ONLY = 'read-only'
const RANK = { [READ_ONLY]: 0, [AUTO_FALLBACK]: 1, [AUTO]: 2, 'danger-full-access': 3 }

export function narrowerLevel(a, b) {
  if (!(a in RANK) || !(b in RANK)) return READ_ONLY
  return RANK[a] <= RANK[b] ? a : b
}
