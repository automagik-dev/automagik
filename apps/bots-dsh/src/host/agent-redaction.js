import { encodeUrlComponent, redactor } from './secrets.js'

const longSecretEnv = /PASSWORD|PASSWD|PASSPHRASE|SECRET|TOKEN|CREDENTIALS?|APIKEY|PRIVATEKEY/i
// Short fragments need boundaries so names such as COMPASS and MONKEY stay readable.
const secretEnv = new RegExp('(?:^|_)(?:KEYS?|TOKENS?|SECRETS?|PASS(?:WD|WORD)?|PWD|'
  + 'CREDENTIALS?|PRIVATE|AUTH)(?:_|$)', 'i')
const pathEnv = new Set(['PATH', 'HOME', 'PWD', 'OLDPWD'])
const urlPassword = value => {
  try { return new URL(value).password || undefined }
  catch { return undefined }
}
const reference = /^[A-Za-z_][A-Za-z0-9_]*$/
// Public field names are protocol vocabulary, not user-supplied dictionary keys.
const fields = new Set(('id name role color instructions model effort permission main '
  + 'notice members admin mode status lastActivity folder items nextOffset nextCursor '
  + 'kind text time seq turn who prefs mainBotIds defaultModel permissions models '
  + 'theme accent motion layout width flatWidth thinking backgroundModel ref provider '
  + 'reasoning needsKey needsSignIn type target callId tokenName action outcome reason '
  + 'changes bots groups before after error code url webPath tokens audit createdAt revokedAt')
  .split(' '))
const strings = value => typeof value === 'string' ? [value]
  : value && typeof value === 'object' ? Object.values(value).flatMap(strings) : []

// MCP has a single redaction boundary, including credentials owned by DSH rather
// than the Bot secret store. Resolve on each boundary: environment and credential
// fallback changes do not necessarily emit an event. Remember rotated values too,
// since a conversation or an older audit row can still contain them.
export function createAgentRedactor(rt) {
  const known = new Set()
  let redact = text => text
  let shorts = []
  const remember = value => {
    for (const text of strings(value)) if (text !== '') known.add(text)
  }
  const refresh = async () => {
    await rt.loadSecrets()
    for (const secret of rt.secretsView?.() ?? []) remember(rt.secretValue?.(secret.name))
    const refs = new Set(rt.keyRefs?.().values() ?? [])
    for (const [name, value] of Object.entries(process.env)) {
      const password = urlPassword(value)
      if (password !== undefined || (!pathEnv.has(name)
        && (longSecretEnv.test(name) || secretEnv.test(name)))) {
        refs.add(name)
        remember(value)
      }
      // A connection password is sensitive under every name, including path names.
      if (password !== undefined) {
        remember(password)
        try { remember(decodeURIComponent(password)) } catch { /* Keep the encoded password. */ }
      }
    }
    for (const entry of rt.ctx.llm?.listConfigurableProviders?.() ?? []) {
      for (const name of entry.nativeAuth?.env ?? []) refs.add(name)
    }
    const settings = rt.ctx.get?.('settings')
    if (settings?.describe) {
      const raw = settings.describe({ redactSecrets: false })
      const masked = settings.describe({ redactSecrets: true })
      for (const section of raw) {
        const collectRefs = value => {
          if (!value || typeof value !== 'object') return
          for (const [key, item] of Object.entries(value)) {
            if (key === 'apiKeyEnv' && typeof item === 'string') refs.add(item)
            else collectRefs(item)
          }
        }
        for (const layer of ['value', 'base', 'user']) collectRefs(section[layer])
        const slots = masked.find(item => item.ns === section.ns)?.secrets ?? []
        for (const { path } of slots) {
          for (const layer of ['value', 'base', 'user']) {
            remember(path.reduce((value, key) => value?.[key], section[layer]))
          }
        }
      }
    }
    const credentials = rt.ctx.get?.('credentials')
    if (credentials?.resolve) {
      for (const ref of refs) {
        if (reference.test(ref)) remember((await credentials.resolve(ref))?.value)
      }
    }
    if (credentials?.listRecords && credentials?.readRecord) {
      for (const { key } of await credentials.listRecords()) {
        const record = await credentials.readRecord(key)
        if (record?.kind === 'api-key') { remember(record.key); remember(record.env) }
        else if (record?.kind === 'grant') remember(record.payload)
      }
    }
    redact = redactor([...known].map(value => ({ name: 'credential', value })), {
      wholeWords: false,
    })
    // Bot secrets have a four-character write floor; DSH credentials do not.
    shorts = [...known].filter(value => value.length < 4).flatMap(value => [value,
      JSON.stringify(value).slice(1, -1),
      ...(value.isWellFormed() ? [encodeUrlComponent(value)] : []),
    ]).sort((a, b) => b.length - a.length)
  }
  const text = value => {
    let safe = redact(rt.redactSecretsAnywhere(value))
      .replace(/am_agent_[a-f0-9]{64}/g, '[agent token]')
    // One pass prevents a short credential from matching a replacement label.
    if (shorts.length) {
      const quote = item => item.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      safe = safe.replace(new RegExp(shorts.map(quote).join('|'), 'gu'), '[secret:credential]')
    }
    return safe
  }
  const clean = value => {
    if (typeof value === 'string') return text(value)
    if (Array.isArray(value)) return value.map(clean)
    if (value !== null && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [
        fields.has(key) ? key : text(key), clean(item),
      ]))
    }
    return value
  }
  return { refresh, text, clean }
}
