// The Bot team's browser address policy. The lists live in the team file's prefs
// (Settings -> Browser -> Address lists), so a change applies to the next navigation
// without restarting the profile. Both lists start empty: localhost, LAN and tailnet
// addresses are reachable by default. A deny entry always wins; when the allow list is
// not empty, only a matching target opens.
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
  const check = (url) => {
    const { allow, deny } = lists()
    return decideAddress(url, { allow, deny })
  }
  rt.addressPolicy = { lists, check }

}
