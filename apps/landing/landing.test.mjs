// The page's contract, without a browser: every screen is a recorded capture, every link is a
// reviewed destination, and the page claims nothing the captures do not show.
// Run: node --test apps/landing/landing.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
const html = readFileSync(resolve(root, 'index.html'), 'utf8')
const css = readFileSync(resolve(root, 'styles.css'), 'utf8')
const captures = readFileSync(resolve(root, 'assets/CAPTURES.md'), 'utf8')
const manifest = JSON.parse(readFileSync(resolve(root, 'assets/screens/manifest.json'), 'utf8'))
const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
const images = [...html.matchAll(/<img\b[^>]*>/g)].map(match => match[0])
const sources = [...html.matchAll(/(?:src|srcset)="([^"]+)"/g)].map(match => match[1])
const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map(match => match[1])

test('one page, its sections, no script or form', () => {
  assert.match(html, /<html lang="en">/)
  assert.equal((html.match(/<h1\b/g) ?? []).length, 1)
  for (const id of ['main', 'team', 'genie', 'plugins', 'install']) assert.match(html, new RegExp(`id="${id}"`))
  assert.doesNotMatch(html, /<(?:script|iframe|video|form)\b/)
})

test('every picture on the page is a recorded app capture or the lockup', () => {
  for (const src of sources) {
    assert.ok(existsSync(resolve(root, src)), src)
    assert.ok(src === 'assets/lockup.webp' || src.startsWith('assets/screens/'), `${src} is not a capture`)
  }
  for (const tag of images) assert.match(tag, /alt="[^"]{20,}"|alt="Automagik"/, tag)
  // No character art standing in for the product (the predecessor's mascots stay out).
  for (const art of ['genie.png', 'omni.png']) assert.ok(!existsSync(resolve(root, 'assets', art)), art)
})

test('each capture matches its recorded digest and is described in CAPTURES.md', () => {
  const files = readdirSync(resolve(root, 'assets/screens')).filter(name => name.endsWith('.png')).sort()
  assert.deepEqual(Object.keys(manifest.images).sort(), files)
  for (const file of files) {
    const digest = createHash('sha256').update(readFileSync(resolve(root, 'assets/screens', file))).digest('hex')
    assert.equal(digest, manifest.images[file], `${file} changed after its capture`)
    assert.ok(captures.includes(file), `${file} is not described in CAPTURES.md`)
  }
  for (const used of sources.filter(src => src.startsWith('assets/screens/'))) assert.ok(files.includes(used.slice('assets/screens/'.length)), used)
  assert.equal(manifest.runtime.version, '0.2.1-rc.5')
  assert.equal(manifest.captureScriptsClean, true, 'Captured with uncommitted capture scripts')
  assert.deepEqual(Object.keys(manifest.plugins).sort(), ['@automagik/bots-dsh', '@automagik/genie-dsh', '@automagik/welcome-dsh'])
})

test('links go to local anchors or reviewed destinations', () => {
  const allowed = new Set([
    'https://github.com/automagik-dev/automagik',
    'https://github.com/automagik-dev/automagik/blob/dev/apps/landing/assets/CAPTURES.md',
    'https://github.com/automagik-dev/automagik/releases',
    'https://github.com/deepseek-ai/deepseek-harness',
    'https://deepseek.com/en/harness/',
  ])
  for (const href of hrefs) {
    if (href.startsWith('https://')) assert.ok(allowed.has(href), href)
    else if (href.startsWith('#')) assert.ok(href === '#' || html.includes(`id="${href.slice(1)}"`), href)
    else assert.ok(existsSync(resolve(root, href)), href)
  }
  // The desktop download aliases answer 404 today (the latest release has no app build); the
  // page sends people through genie desktop instead.
  assert.doesNotMatch(html, /releases\/latest\/download/)
})

test('the developer commands are exactly the verified ones', () => {
  assert.ok(html.includes('<code>curl -fsSL https://raw.githubusercontent.com/automagik-dev/genie/main/install.sh | bash</code>'))
  assert.ok(html.includes('<code>genie desktop</code>'))
  assert.match(text, /The Genie CLI installs on Linux \(x64 or arm64\) and on a Mac with Apple silicon/)
  assert.match(text, /there is no Linux arm64 desktop build yet/)
})

test('the market install stays off and says why', () => {
  assert.match(html, /<button type="button" disabled aria-describedby="install-status">/)
  assert.match(text, /TODO: a one-click install link is not verified yet/)
  assert.doesNotMatch(html, /(?:dsh|automagik|omni):\/\//)
  assert.match(text, /Everything is a plugin\./)
  assert.match(text, /DeepSeek does not endorse it/)
})

test('claims stay inside what the captures show', () => {
  // Omni appears only as powered off: no channel, reminder or approval is shown or claimed.
  assert.match(text, /Omni is asleep, with its power button off/)
  assert.doesNotMatch(html, /Powered off/)
  assert.doesNotMatch(text, /remind|approv|WhatsApp|Telegram|Slack/i)
  assert.match(text, /replies are scripted/)
  assert.match(text, /Nothing is pushed or merged/)
})

test('no personal data, tracking or host paths', () => {
  assert.doesNotMatch(html + css + captures, /\/Users\/|\/home\/[a-z]|feliperosa|(?:sk-|ghp_)[a-z\d]{15,}|analytics|gtag/i)
  assert.doesNotMatch(html, /[\w.+-]+@[\w-]+\.[a-z]{2,}/i)
})

test('responsive and keyboard basics', () => {
  assert.match(html, /name="viewport"/)
  assert.match(html, /class="skip" href="#main"/)
  assert.match(css, /:focus-visible/)
  assert.match(css, /@media \(max-width:700px\)/)
  assert.match(css, /prefers-reduced-motion:reduce/)
  assert.doesNotMatch(css, /overflow-x:hidden/)
})
