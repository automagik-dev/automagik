import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

// The input names declared under one trigger (`on.<trigger>.inputs`) of a workflow file.
function inputsOf(text, trigger) {
  const block = text.split('\n').reduce((state, line) => {
    if (state.done) return state
    if (line === `  ${trigger}:`) return { ...state, inside: true }
    if (state.inside && /^ {0,2}\S/.test(line)) return { ...state, done: true }
    if (state.inside) {
      const name = line.match(/^ {6}([A-Za-z_][\w-]*):\s*$/)
      if (name) state.names.add(name[1])
    }
    return state
  }, { inside: false, done: false, names: new Set() })
  return block.names
}

test('desktop-build.yml declares every input it reads for release.yml, which calls it', () => {
  const text = readFileSync(new URL('../../../.github/workflows/desktop-build.yml', import.meta.url), 'utf8')
  const read = new Set([...text.matchAll(/inputs\.([A-Za-z_][\w-]*)/g)].map(match => match[1]))
  // An input a caller cannot see reads as '', which equals false: `publish != false` was
  // false for every release follow-omni made, and they were never published.
  for (const trigger of ['workflow_call', 'workflow_dispatch']) {
    const declared = inputsOf(text, trigger)
    assert.deepEqual([...read].filter(name => !declared.has(name)), [], `${trigger} lacks inputs the jobs read`)
  }
})

test('release.yml declares every input it reads for follow-omni, which calls it', () => {
  const text = readFileSync(new URL('../../../.github/workflows/release.yml', import.meta.url), 'utf8')
  const read = new Set([...text.matchAll(/inputs\.([A-Za-z_][\w-]*)/g)].map(match => match[1]))
  for (const trigger of ['workflow_call', 'workflow_dispatch']) {
    const declared = inputsOf(text, trigger)
    assert.deepEqual([...read].filter(name => !declared.has(name)), [], `${trigger} lacks inputs the jobs read`)
  }
})

// And Pocket's APK and latest.json, which the release's Pocket job attaches (docs/rfcs/0011, "Pocket").
test('a desktop rebuild keeps the plugins its release carries, their signed lane, and Pocket\'s APK', () => {
  const text = readFileSync(new URL('../../../.github/workflows/desktop-build.yml', import.meta.url), 'utf8')
  assert.match(text, /case "\$\{name\}" in automagik-\*\.tgz\|plugins\.json\|PLUGINS\.SHA256SUMS\|lane\.json\|lane\.json\.sig\|automagik-pocket-\*\.apk\|latest\.json\) continue ;; esac/)
})

test('every release carries the stable download names under Automagik and under Omni, the old name', () => {
  const text = readFileSync(new URL('../../../.github/workflows/desktop-build.yml', import.meta.url), 'utf8')
  assert.match(text, /for pair in "-mac-arm64\.dmg:Mac\.dmg" "-linux-x86_64\.AppImage:Linux\.AppImage" "-linux-amd64\.deb:Linux\.deb"; do/)
  assert.match(text, /for name in Automagik Omni; do cp -- "\$\{file\}" "\$\{name\}-\$\{pair##\*:\}"; done/)
})

// Windows x86_64 (D27, D28): built on every release, unsigned until a certificate exists (D36).
test('every release builds Windows, publishes its installer and feed, and never fails on a missing certificate', () => {
  const text = readFileSync(new URL('../../../.github/workflows/desktop-build.yml', import.meta.url), 'utf8')
  assert.match(text, /- target: windows\r?\n {12}os: windows-latest\r?\n/)
  assert.match(text, /npx --no-install electron-builder --win nsis --x64 --publish never/)
  assert.match(text, /if \[\[ -z "\$\{WIN_CSC_LINK\}" \]\]; then\r?\n {12}\[\[ "\$\{signed\}" == true \]\] \|\| echo "::warning ::No Windows code-signing certificate: the installer is unsigned"\r?\n {12}unset WIN_CSC_LINK WIN_CSC_KEY_PASSWORD\r?\n/)
  // A build meant to be signed (a certificate, or Azure Trusted Signing) fails unless it is.
  assert.match(text, /if \[\[ "\$\{signed\}" == true && "\$\{status\}" != Valid\* \]\]; then/)
  assert.match(text, /node scripts\/check-feed\.mjs dist\/latest\.yml/)
  assert.match(text, /need\+=\("Automagik-\$\{VERSION\}-win-x64\.exe" latest\.yml\)/)
  assert.match(text, /apps\/desktop\/dist\/latest\.yml\r?\n/)
  assert.match(text, /cp -- "\$\{file\}" Automagik-Windows\.exe/)
})
