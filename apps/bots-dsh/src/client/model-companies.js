// Company is presentation only. Every selection and credential operation still uses
// the provider's exact route id, including separate API and CLI accounts.
const COMPANIES = {
  'deepseek': 'DeepSeek', 'deepseek-official': 'DeepSeek', 'deepseek-platform': 'DeepSeek', 'deepseek-account': 'DeepSeek',
  'openai': 'OpenAI', 'openai-codex': 'OpenAI', 'codex': 'OpenAI', 'acp-codex': 'OpenAI',
  'anthropic': 'Anthropic · Claude', 'claude': 'Anthropic · Claude', 'acp-claude': 'Anthropic · Claude', 'claude-code': 'Anthropic · Claude',
  'google': 'Google', 'google-gemini-cli': 'Google', 'google-antigravity': 'Google', 'antigravity': 'Google', 'acp-gemini': 'Google',
  'moonshot': 'Moonshot · Kimi', 'moonshotai': 'Moonshot · Kimi', 'kimi': 'Moonshot · Kimi', 'kimi-coding': 'Moonshot · Kimi',
}

export const companyOf = row => COMPANIES[row.provider] ?? row.company ?? row.name ?? row.provider

// Capabilities describe the connection form, not whether the account is signed in.
// An absent declaration stays unknown; an explicit empty list is a local connection.
export function authMethodsOf(row) {
  if (Array.isArray(row?.authMethods)) return row.authMethods.filter(method => method === 'login' || method === 'key')
  if (row?.key) return ['key']
  return undefined
}

export function connectionGroups(providers = []) {
  const groups = new Map(['login', 'key', 'local', 'settings'].map(id => [id, []]))
  for (const provider of providers) {
    const methods = authMethodsOf(provider)
    const kind = methods?.includes('login') ? 'login' : methods?.includes('key') ? 'key' : methods ? 'local' : 'settings'
    groups.get(kind).push(provider)
  }
  return [...groups].filter(([, entries]) => entries.length > 0)
}

export function modelCompanies(models = [], accounts = []) {
  const routes = new Map()
  for (const row of accounts) {
    const provider = row.provider ?? row.id
    if (typeof provider !== 'string' || !provider) continue
    routes.set(provider, { ...routes.get(provider), ...row, provider })
  }
  for (const model of models) {
    const provider = model.provider ?? model.ref.split('/')[0]
    if (!routes.has(provider)) routes.set(provider, { provider, name: model.providerName ?? provider })
  }
  const companies = new Map()
  for (const row of routes.values()) {
    const company = companyOf(row)
    if (!companies.has(company)) companies.set(company, { name: company, providers: [] })
    companies.get(company).providers.push({ ...row, models: models.filter(model => (model.provider ?? model.ref.split('/')[0]) === row.provider) })
  }
  return [...companies.values()]
}

// A failed preflight must not invoke the mutation at all. Successful authentication
// only refreshes the catalog; the user still explicitly chooses a model afterwards.
export async function chooseAccessibleModel({ ref, actions, select }) {
  if (actions?.modelAccess) {
    const access = await actions.modelAccess(ref)
    if (access?.ready !== true) {
      throw Object.assign(new Error(access?.message ?? 'This model is not ready. Connect its account and try again.'), { code: 'bot/model-access', access })
    }
  }
  return select(ref)
}
