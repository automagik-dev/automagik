// A GitHub token a Bot asks for with request_secret (#316): the work it declares maps to the
// repository permissions of a fine-grained token, and only those. The host words the Bot's
// answer from it and the secure card shows the steps from it. Pure, so the client imports it.
//
// GitHub's pages are in English, so its field and option names stay in English here; the
// card's sentences around them follow the interface language.

// GitHub's new fine-grained token page. It takes the expiration and each permission as URL
// parameters (docs.github.com, "Pre-filling fine-grained personal access token details using
// URL parameters"): `expires_in` in days, `<permission>=read|write`, and `write` includes read.
export const GITHUB_TOKEN_PAGE = 'https://github.com/settings/personal-access-tokens/new'
// The expiration the card suggests: short, and GitHub's own default.
export const GITHUB_TOKEN_DAYS = 30

// Field and option names as GitHub's form shows them.
export const GITHUB_FIELDS = {
  expiration: 'Expiration',
  days: `${GITHUB_TOKEN_DAYS} days`,
  repositoryAccess: 'Repository access',
  onlySelected: 'Only select repositories',
  permissions: 'Permissions > Repository permissions',
  generate: 'Generate token',
}

// Each kind of work a Bot can declare, and the repository permission it needs. A closed list:
// work not listed here cannot be asked for, so a request never grows past what was declared.
export const GITHUB_WORK = {
  read_code: ['contents', 'read'],
  edit_code: ['contents', 'write'],
  read_prs: ['pull_requests', 'read'],
  open_prs: ['pull_requests', 'write'],
  read_issues: ['issues', 'read'],
  edit_issues: ['issues', 'write'],
}
const PERMISSIONS = { contents: 'Contents', pull_requests: 'Pull requests', issues: 'Issues' }
const ACCESS = { read: 'Read-only', write: 'Read and write' }

// The work tags a request may carry, in GITHUB_WORK's order and once each; anything else is
// reported back as unknown.
export function cleanGitHubWork(raw) {
  const given = raw === undefined || raw === null ? [] : (Array.isArray(raw) ? raw : [raw]).map(String)
  return {
    work: Object.keys(GITHUB_WORK).filter(tag => given.includes(tag)),
    unknown: [...new Set(given.filter(tag => !Object.hasOwn(GITHUB_WORK, tag)))],
  }
}

// One row per permission, at the highest level any of the work needs.
export function githubPermissions(work) {
  const levels = new Map()
  for (const tag of cleanGitHubWork(work).work) {
    const [name, level] = GITHUB_WORK[tag]
    if (levels.get(name) !== 'write') levels.set(name, level)
  }
  return Object.keys(PERMISSIONS).filter(name => levels.has(name))
    .map(name => ({ name, label: PERMISSIONS[name], level: levels.get(name), access: ACCESS[levels.get(name)] }))
}

export function githubTokenUrl(work) {
  const params = new URLSearchParams({ expires_in: String(GITHUB_TOKEN_DAYS) })
  for (const { name, level } of githubPermissions(work)) params.set(name, level)
  return `${GITHUB_TOKEN_PAGE}?${params}`
}

// The names a Bot gives a github.com token. A request under one of them must say its work;
// the API_TOKEN and OAUTH_TOKEN forms (GITHUB_API_TOKEN, GH_API_TOKEN, GITHUB_OAUTH_TOKEN) count
// too. An Enterprise host's token (GH_ENTERPRISE_TOKEN) is another site and not matched.
const GITHUB_TOKEN_NAME = /^(?:GITHUB|GH)_(?:TOKEN|PAT|ACCESS_TOKEN|PERSONAL_ACCESS_TOKEN|API_TOKEN|OAUTH_TOKEN)$/
export const isGitHubTokenName = name => GITHUB_TOKEN_NAME.test(String(name ?? ''))
