// omni:// links. The app registers the scheme with the system, so a link on an Omni's own
// pages ("Open in the Omni app", /api/login/app) opens the app:
//
//   omni://connect?url=https://omni.example.com   connect to that Omni (the app asks first)
//   omni://open                                    just bring the app to the front
//
// A link carries an address and nothing else: whoever made it, connecting still means
// signing in on that Omni's own page (a passkey, or a code on WhatsApp), so the app shows
// the address and asks before it starts.
export const SCHEME = 'omni'

/** What a link asks for: { action: 'connect', url, host, secure } or { action: 'open' }, or null. */
export function parseDeepLink(text) {
  let link
  try {
    link = new URL(String(text))
  } catch {
    return null
  }
  if (link.protocol !== `${SCHEME}:`) return null
  // omni://connect?… parses with "connect" as the host; omni:connect?… as the path.
  const action = (link.host || link.pathname).replace(/^\/+|\/+$/g, '')
  if (action === 'open') return { action: 'open' }
  if (action !== 'connect') return null
  let target
  try {
    target = new URL(link.searchParams.get('url') ?? '')
  } catch {
    return null
  }
  if (target.protocol !== 'https:' && target.protocol !== 'http:') return null
  if (target.username || target.password) return null
  const url = `${target.origin}${target.pathname.replace(/\/api\/v2\/?$/, '').replace(/\/+$/, '')}`
  return { action: 'connect', url, host: target.host, secure: target.protocol === 'https:' }
}

/** The first omni:// link in a command line (Linux and Windows pass the link as an argument). */
export function linkInArgs(argv) {
  return (Array.isArray(argv) ? argv : []).find(arg => typeof arg === 'string' && arg.startsWith(`${SCHEME}:`)) ?? null
}
