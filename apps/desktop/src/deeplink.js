// omni:// links. The app registers the scheme with the system, so a link on an Omni's own
// pages ("Open in the Omni app", /api/login/app) opens the app:
//
//   omni://connect?url=https://omni.example.com              connect to that Omni (the app asks first)
//   omni://connect?url=https://omni.example.com&grant=<grant> the same, with a one-time grant
//   omni://open                                               just bring the app to the front
//
// A link without a grant carries an address and nothing else: whoever made it, connecting
// still means signing in on that Omni's own page (a passkey, or a code on WhatsApp). A grant
// comes from the link an Omni sends its owner who texted "connect" to themselves: it is the
// owner's yes already, spent on first use. Either way the app shows the address and asks
// before it starts, and a grant is passed on to Omni's page, never logged.
export const SCHEME = 'omni'

// A grant as an Omni mints it: 24 base64url characters.
export const GRANT = /^[A-Za-z0-9_-]{24}$/

/** What a link asks for: { action: 'connect', url, host, secure, grant? } or { action: 'open' }, or null. */
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
  // A grant that is not one an Omni mints makes the whole link suspect.
  const grant = link.searchParams.get('grant')
  if (grant !== null && !GRANT.test(grant)) return null
  return { action: 'connect', url, host: target.host, secure: target.protocol === 'https:', ...(grant === null ? {} : { grant }) }
}

/** The first omni:// link in a command line (Linux and Windows pass the link as an argument). */
export function linkInArgs(argv) {
  return (Array.isArray(argv) ? argv : []).find(arg => typeof arg === 'string' && arg.startsWith(`${SCHEME}:`)) ?? null
}
