// The host DSH runs in. Unfold's own Automagik instance says so with AUTOMAGIK_HOST=unfold:
// Unfold ships it whole, Omni and Genie inside it, so the team step installs nothing there,
// never offers a new Omni of its own, and never shows a line to paste into a terminal.
// Anything else, or nothing, is no host kind.

/** 'unfold', or null for none. */
export const hostOf = (env = process.env) => (String(env?.AUTOMAGIK_HOST ?? '').trim().toLowerCase() === 'unfold' ? 'unfold' : null)
