// The narrower of two permission levels, for a Session whose owner goes away: it must
// never end with more than it had. A level is ranked by what DSH's preset allows, not by
// its name: `service.resolve(name)` gives its sandbox (read-only < workspace-write <
// danger-full-access), then its approval (ask before never). So workspace-write < Auto
// (full sandbox, every step asked) < full access, and a custom preset ranks as what it
// allows. A level DSH cannot resolve or rank gives the narrowest level the catalog
// offers, never a name it may not have. Host only: the client has no use for it.

const SANDBOX = { 'read-only': 0, 'workspace-write': 1, 'danger-full-access': 2 }
const APPROVAL = { ask: 0, never: 1 }

// A number to compare levels by, or undefined when the level cannot be ranked.
export function rankOf(service, name) {
  let spec
  try {
    spec = service.resolve(name)
  } catch {
    return undefined
  }
  const sandbox = SANDBOX[spec?.sandbox]
  const approval = APPROVAL[spec?.approval]
  return sandbox === undefined || approval === undefined ? undefined : sandbox * 2 + approval
}

// The narrowest level the catalog offers; its default when none can be ranked.
export function narrowestOffered(service) {
  const { options, defaultPreset } = service.catalog()
  let narrowest
  let lowest = Infinity
  for (const { value } of options) {
    const rank = rankOf(service, value)
    if (rank !== undefined && rank < lowest) [narrowest, lowest] = [value, rank]
  }
  return narrowest ?? defaultPreset
}

export function narrowerLevel(service, a, b) {
  const rankA = rankOf(service, a)
  const rankB = rankOf(service, b)
  if (rankA === undefined || rankB === undefined) return narrowestOffered(service)
  return rankA <= rankB ? a : b
}
