import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  GITHUB_FIELDS, GITHUB_TOKEN_DAYS, GITHUB_TOKEN_PAGE, GITHUB_WORK,
  cleanGitHubWork, githubPermissions, githubTokenUrl, isGitHubTokenName,
} from '../src/shared/github-token.js'

// #316: the card links straight to GitHub's new fine-grained token page and names its fields
// as GitHub's form does; the permissions come from the work the Bot declared, never more.

test('the link is GitHub\'s new fine-grained token page, pre-filled with the work\'s permissions and 30 days', () => {
  assert.equal(GITHUB_TOKEN_PAGE, 'https://github.com/settings/personal-access-tokens/new')
  assert.equal(GITHUB_TOKEN_DAYS, 30)
  assert.equal(githubTokenUrl(['edit_code', 'open_prs']), 'https://github.com/settings/personal-access-tokens/new?expires_in=30&contents=write&pull_requests=write')
  assert.equal(githubTokenUrl(['read_code']), 'https://github.com/settings/personal-access-tokens/new?expires_in=30&contents=read')
})

test('the steps use the field names of GitHub\'s form', () => {
  assert.deepEqual(GITHUB_FIELDS, {
    expiration: 'Expiration',
    days: '30 days',
    repositoryAccess: 'Repository access',
    onlySelected: 'Only select repositories',
    permissions: 'Permissions > Repository permissions',
    generate: 'Generate token',
  })
})

test('editing code and opening pull requests asks for Contents and Pull requests, read and write, nothing else', () => {
  // The onboarding session asked for "repository, issues and pull request read": too little to
  // push, and issues the work never touched. GitHub's own push-and-PR preset adds workflows too.
  assert.deepEqual(githubPermissions(['edit_code', 'open_prs']), [
    { name: 'contents', label: 'Contents', level: 'write', access: 'Read and write' },
    { name: 'pull_requests', label: 'Pull requests', level: 'write', access: 'Read and write' },
  ])
  const asked = githubPermissions(['edit_code', 'open_prs']).map(entry => entry.name)
  for (const broader of ['issues', 'workflows', 'administration', 'actions', 'metadata']) assert.equal(asked.includes(broader), false, broader)
})

test('narrower work asks for less', () => {
  assert.deepEqual(githubPermissions(['read_code']), [{ name: 'contents', label: 'Contents', level: 'read', access: 'Read-only' }])
  assert.deepEqual(githubPermissions(['read_code', 'read_prs']).map(entry => `${entry.label}: ${entry.access}`), ['Contents: Read-only', 'Pull requests: Read-only'])
  // Read and write of the same permission is one row, at the higher level.
  assert.deepEqual(githubPermissions(['read_code', 'edit_code']).map(entry => `${entry.label}: ${entry.access}`), ['Contents: Read and write'])
  assert.deepEqual(githubPermissions(['edit_issues']).map(entry => `${entry.label}: ${entry.access}`), ['Issues: Read and write'])
})

test('declared work is a closed list of tags', () => {
  assert.deepEqual(Object.keys(GITHUB_WORK), ['read_code', 'edit_code', 'read_prs', 'open_prs', 'read_issues', 'edit_issues'])
  assert.deepEqual(cleanGitHubWork(['open_prs', 'edit_code', 'open_prs']), { work: ['edit_code', 'open_prs'], unknown: [] })
  assert.deepEqual(cleanGitHubWork(['edit_code', 'admin', 7]), { work: ['edit_code'], unknown: ['admin', '7'] })
  assert.deepEqual(cleanGitHubWork(undefined), { work: [], unknown: [] })
  assert.deepEqual(cleanGitHubWork('edit_code'), { work: ['edit_code'], unknown: [] })
})

test('a GitHub token is recognized by its usual names only', () => {
  for (const name of ['GITHUB_TOKEN', 'GH_TOKEN', 'GITHUB_PAT', 'GH_PAT', 'GITHUB_ACCESS_TOKEN', 'GITHUB_PERSONAL_ACCESS_TOKEN',
    'GITHUB_API_TOKEN', 'GH_API_TOKEN', 'GITHUB_OAUTH_TOKEN']) assert.equal(isGitHubTokenName(name), true, name)
  for (const name of ['GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN', 'GH_ENTERPRISE_API_TOKEN', 'GITLAB_TOKEN', 'GHOST_TOKEN', 'MY_GITHUB_TOKEN', 'GITHUB_WEBHOOK_SECRET', 'DEMO_TOKEN']) assert.equal(isGitHubTokenName(name), false, name)
})
