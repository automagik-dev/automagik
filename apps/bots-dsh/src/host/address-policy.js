// One address policy for the Bot team's browser and web_fetch. The lists live in the team
// file's prefs (Settings -> Browser -> Address lists), so a change applies to the next
// navigation or fetch without restarting the profile. Both lists start empty: localhost,
// LAN and tailnet addresses are reachable by default. A deny entry always wins; when the
// allow list is not empty, only a matching target opens.
import { decideAddress, normalizeAddressList } from './browser/address-policy.js'

export { normalizeAddressList }

export function install(rt) {
  const lists = () => {
    const prefs = rt.state?.prefs ?? {}
    return {
      allow: Array.isArray(prefs.browserAllow) ? prefs.browserAllow : [],
      deny: Array.isArray(prefs.browserDeny) ? prefs.browserDeny : [],
    }
  }
  const check = (url, action = 'open') => {
    const { allow, deny } = lists()
    return decideAddress(url, { allow, deny, action })
  }
  rt.addressPolicy = { lists, check }

  // web_fetch is a host tool over DSH's web seam. Its provider is local and has no address
  // policy of its own, so the same lists gate the tool before it reaches the provider.
  // A redirect the provider follows is same-origin only; a cross-origin target is refused
  // by the provider itself, so the initial URL is the one to classify here.
  if (typeof rt.ctx.on === 'function') {
    rt.ctx.on('tools/pre-execute', async (exec, next) => {
      if (exec?.name !== 'web_fetch') return next()
      const url = exec.arguments?.url
      if (typeof url !== 'string') return next()
      await rt.load?.()
      const decision = await check(url, 'fetch')
      if (!decision.allowed) return { kind: 'deny', reason: decision.message }
      return next()
    })
  }
}
