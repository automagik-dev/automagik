// The host DSH runs in. Unfold's own Automagik instance says so with AUTOMAGIK_HOST=unfold or
// AUTOMAGIK_PRELOAD=unfold, either one (the same rule as bots-dsh's inUnfoldInstance and
// unfold-bot-dsh's unfoldLeads): Unfold ships it whole, Omni and Genie inside it, so the team
// step installs nothing there, never offers a new Omni of its own, never shows a line to paste
// into a terminal, and Unfold leads the team. Anything else, or nothing, is no host kind.

/** 'unfold', or null for none. */
export const hostOf = (env = process.env) => ([env?.AUTOMAGIK_HOST, env?.AUTOMAGIK_PRELOAD].some(value => String(value ?? '').trim().toLowerCase() === 'unfold') ? 'unfold' : null)

// The machine DSH runs on, as the welcome's copy needs it: its OS family, and whether DSH was
// launched over SSH, a sign that whoever reads the welcome sits at another machine. The rule is
// DSH's own launchedThroughSsh (@deepseek-ai/dsh-launch-environment): SSH_CONNECTION or SSH_TTY
// set and non-empty. Nothing else about the machine is sent: no hostname, release, architecture,
// user name or home path.
const OS_OF = { darwin: 'macos', linux: 'linux', win32: 'windows' }

/** The OS family DSH runs on: 'macos', 'linux', 'windows', or 'other'. */
export const osOf = (platform = process.platform) => (Object.hasOwn(OS_OF, platform) ? OS_OF[platform] : 'other')

/** { os, remoteHint? }: remoteHint only when DSH was launched over SSH. */
export function machineOf({ platform = process.platform, env = process.env } = {}) {
  const ssh = [env?.SSH_CONNECTION, env?.SSH_TTY].some(value => typeof value === 'string' && value !== '')
  return { os: osOf(platform), ...(ssh ? { remoteHint: true } : {}) }
}
