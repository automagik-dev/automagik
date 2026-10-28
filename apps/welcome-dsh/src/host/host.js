// The host DSH runs in. Unfold's own Automagik instance says so with AUTOMAGIK_HOST=unfold or
// AUTOMAGIK_PRELOAD=unfold, either one (the same rule as bots-dsh's inUnfoldInstance and
// unfold-bot-dsh's unfoldLeads): Unfold ships it whole, Omni and Genie inside it, so the team
// step installs nothing there, never offers a new Omni of its own, never shows a line to paste
// into a terminal, and Unfold leads the team. Anything else, or nothing, is no host kind.

/** 'unfold', or null for none. */
export const hostOf = (env = process.env) => ([env?.AUTOMAGIK_HOST, env?.AUTOMAGIK_PRELOAD].some(value => String(value ?? '').trim().toLowerCase() === 'unfold') ? 'unfold' : null)
