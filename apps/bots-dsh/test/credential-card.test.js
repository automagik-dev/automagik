import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { build } from 'esbuild'
import { PT_BR, ptBrLocale } from './fixtures/pt-br-locale.js'

// #316: the secure card for a GitHub token shows how to make one: GitHub's new fine-grained
// token page, the fields to fill, the permissions the declared work needs and an expiration.
const { outputFiles } = await build({
  stdin: {
    contents: [
      "export { SecretCard, GitHubSteps } from './src/client/secret-card.js'",
      "export { installLocale } from './src/client/i18n.js'",
    ].join('\n'),
    resolveDir: fileURLToPath(new URL('..', import.meta.url)),
  },
  bundle: true, format: 'cjs', platform: 'browser', write: false, logLevel: 'silent',
  external: ['react', '@deepseek-ai/dsh-client-ui-primitives'],
})
const react = {
  createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
  useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}],
  useRef: initial => ({ current: initial }),
  useId: () => 'card-id',
  useEffect: () => {}, useLayoutEffect: () => {},
  useSyncExternalStore: (subscribe, getSnapshot) => getSnapshot(),
}
const module = { exports: {} }
runInNewContext(outputFiles[0].text, {
  module, exports: module.exports,
  require: name => (name === 'react' ? react : { MarkdownText: ({ text }) => text }),
  document: { activeElement: null, querySelector: () => null, addEventListener: () => {}, removeEventListener: () => {} },
  location: { protocol: 'http:', hostname: 'localhost' },
  HTMLInputElement: class {}, HTMLTextAreaElement: class {}, HTMLSelectElement: class {}, HTMLElement: class {},
  URL, URLSearchParams,
})
const { SecretCard, GitHubSteps, installLocale } = module.exports

const all = (node, check) => {
  if (Array.isArray(node)) return node.flatMap(child => all(child, check))
  if (!node || typeof node !== 'object') return []
  return [...(check(node) ? [node] : []), ...all(node.props.children, check)]
}
const text = node => (Array.isArray(node) ? node.map(text).join('') : node && typeof node === 'object' ? text(node.props.children) : node == null || node === false ? '' : String(node))
const bot = { id: 'b2', name: 'Coder' }
const actions = {}
const card = request => SecretCard({ sessionId: 'b2', bot, request, roster: { secrets: [] }, actions })
const steps = node => all(node, child => child.type === GitHubSteps)
const github = { id: 'r1', name: 'GITHUB_TOKEN', purpose: 'Push my fix and open the pull request', kind: 'fill', status: 'pending', github: ['edit_code', 'open_prs'] }

test('a GitHub token card links to the new fine-grained token page with the work\'s permissions', () => {
  const [shown] = steps(card(github))
  assert.ok(shown, 'the card shows the GitHub steps')
  const rendered = GitHubSteps(shown.props)
  const [link] = all(rendered, node => node.type === 'a')
  assert.equal(link.props.href, 'https://github.com/settings/personal-access-tokens/new?expires_in=30&contents=write&pull_requests=write')
  assert.equal(link.props.target, '_blank')
  assert.equal(link.props.rel, 'noopener noreferrer')
  const lines = all(rendered, node => node.type === 'li').filter(node => !all(node.props.children, child => child.type === 'li').length).map(text)
  assert.deepEqual(lines, [
    'Open GitHub\'s new fine-grained token page.',
    'Under “Expiration”, choose “30 days”.',
    'Under “Repository access”, choose “Only select repositories” and pick the ones Coder works on.',
    'Contents: Read and write',
    'Pull requests: Read and write',
    'Click “Generate token”, copy it and paste it below.',
  ])
  assert.match(text(rendered), /Under “Permissions > Repository permissions”, set only these:/)
  assert.doesNotMatch(text(rendered), /Issues|Workflows|Read-only/)
})

test('narrower work shows narrower permissions in the steps and the link', () => {
  const rendered = GitHubSteps(steps(card({ ...github, github: ['read_code'] }))[0].props)
  assert.equal(all(rendered, node => node.type === 'a')[0].props.href, 'https://github.com/settings/personal-access-tokens/new?expires_in=30&contents=read')
  assert.match(text(rendered), /Contents: Read-only/)
  assert.doesNotMatch(text(rendered), /Pull requests|Read and write/)
})

test('the steps follow the interface language; GitHub\'s own field names stay as GitHub shows them', () => {
  const english = text(GitHubSteps(steps(card(github))[0].props))
  const off = installLocale(ptBrLocale())
  try {
    const portuguese = text(GitHubSteps(steps(card(github))[0].props))
    assert.notEqual(portuguese, english)
    for (const key of ['Open GitHub\'s new fine-grained token page.', 'Under “{field}”, choose “{value}”.', 'Click “{button}”, copy it and paste it below.']) assert.ok(PT_BR[key] && PT_BR[key] !== key, key)
    assert.match(portuguese, /“Expiration”.*“30 days”/)
    assert.match(portuguese, /Contents: Read and write/)
  } finally { off() }
})

test('a card with no declared GitHub work, or for another key, stays the plain card', () => {
  // A request saved before #316 has no github field.
  const { github: _, ...legacy } = github
  assert.equal(steps(card(legacy)).length, 0)
  assert.equal(steps(card({ ...github, name: 'DEMO_TOKEN', github: undefined })).length, 0)
  // A key that is already saved asks to allow it, not to make a new one.
  assert.equal(steps(card({ ...github, kind: 'allow' })).length, 0)
})
