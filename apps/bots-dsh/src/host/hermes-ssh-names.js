// Who and where one SSH connection was: kept out of every stored diagnostics line.
// The person's own screen still shows what SSH said; a line that may be attached to a
// report names no remote user, no host, no address and not the alias the person typed.
import { isIPv6 } from 'node:net'

const quote = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const PLACEHOLDER = /^<(?:ip|host|user|alias)>$/
const V4 = /(?<![\w.])(?:\d{1,3}\.){3}\d{1,3}(?!\w|\.\d)/g
// Candidates only: node's own parser decides, so a clock time or a port list stays.
const V6 = /(?<![\w:.])(?:[0-9A-Fa-f]{1,4})?(?::[0-9A-Fa-f]{0,4}){2,7}(?:\.\d{1,3}){0,3}(?:%[A-Za-z0-9._-]+)?(?!\w)/g
const address = (match) => {
  if (isIPv6(match.split('%')[0])) return '<ip>'
  // "fe80::1: Connection refused": the colon after the address is SSH's, not its own.
  const cut = match.replace(/:+$/, '')
  return cut !== match && isIPv6(cut) ? `<ip>${match.slice(cut.length)}` : match
}
const NAME = '[A-Za-z0-9](?:[\\w.-]*[A-Za-z0-9_])?'
// SSH's own sentences that name a host the trace did not (a jump host, a missing trace).
const PHRASE = new RegExp(`\\b(connect to host|resolve hostname|key is known for|[Hh]ost key for|key for host|authenticity of host|Connection to|Connection closed by|Connection reset by|banner exchange with|[Dd]isconnected from|disconnect from|Timeout, server)( ['"]?)(${NAME})`, 'g')
const NOT_A_HOST = /^(?:remote|peer|UNKNOWN|port|host|the|user|authenticating|invalid|IP)$/

/**
 * The names SSH's own words give for one connection: the host its config resolved the
 * alias to and the user it signed in as. `trace` is SSH's stderr with its -v lines,
 * `config` the output of `ssh -G`.
 */
export function sshNames(trace, config = '') {
  const hosts = new Set(), users = new Set()
  const said = String(trace ?? ''), shown = String(config ?? '')
  for (const match of said.matchAll(/^debug\d+: Connecting to (\S+) \[/gm)) hosts.add(match[1])
  for (const match of said.matchAll(/^debug\d+: Authenticating to (\S+?):\d+ as '([^']+)'/gm)) { hosts.add(match[1]); users.add(match[2]) }
  for (const match of shown.matchAll(/^hostname (\S+)$/gim)) hosts.add(match[1])
  for (const match of shown.matchAll(/^user (\S+)$/gim)) users.add(match[1])
  return { hosts: [...hosts], users: [...users] }
}

/** One line of SSH's or Hermes's words with its addresses and names replaced. */
export function redactSshNames(text, { alias, hosts = [], users = [] } = {}) {
  let out = String(text ?? '')
  out = out.replace(V6, address).replace(V4, '<ip>')
  // The longest name first: an alias is often the start of the host name it stands for.
  const known = [...(alias ? [[alias, '<alias>']] : []), ...hosts.map(name => [name, '<host>']), ...users.map(name => [name, '<user>'])]
    .filter(([name]) => typeof name === 'string' && name.length > 0 && !PLACEHOLDER.test(name))
    .sort((a, b) => b[0].length - a[0].length)
  for (const [name, placeholder] of known) {
    out = out.replace(new RegExp(`(?<![A-Za-z0-9_.<-])${quote(name)}(?![A-Za-z0-9_>-]|\\.[A-Za-z0-9])`, 'g'), placeholder)
  }
  // user@host as SSH writes it; never an algorithm's name (chacha20-poly1305@openssh.com).
  out = out.replace(/(?<![\w.<>@+-])[A-Za-z0-9_][\w.+-]*(?=@(?!(?:openssh\.com|libssh\.org)(?![\w.-]))[A-Za-z0-9<[])/g, '<user>')
    .replace(new RegExp(`(?<=<user>@)${NAME}`, 'g'), '<host>')
    .replace(PHRASE, (match, lead, gap, name) => NOT_A_HOST.test(name) ? match : `${lead}${gap}<host>`)
    .replace(/(Permanently added ')([^']+)(?=')/g, (match, lead, names) => `${lead}${names.split(',').map(name => PLACEHOLDER.test(name) ? name : '<host>').join(',')}`)
  return out
}
