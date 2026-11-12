// Permission levels, across providers. A level is stored as DSH's preset name, and DSH's
// preset runs every provider's tools. Pure, so the client imports it too.

export const AUTO = 'auto'
// The level a saved Auto runs as where it cannot be applied: never a looser one.
export const AUTO_FALLBACK = 'workspace-write'

export const AUTO_MARK = 'acp-codex'
export const MARK_LEVEL = 'workspace-write'
export const AUTO_ROW = 'workspace-write:auto'
