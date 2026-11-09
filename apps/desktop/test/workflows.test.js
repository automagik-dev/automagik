import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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

// And Pocket's APK and latest.json, which the release's Pocket job attaches (docs/rfcs/0011, "Pocket"),
// and the meter's binaries and usagemeter.SHA256SUMS, which its meter jobs attach (docs/rfcs/0017).
test('a desktop rebuild keeps the plugins its release carries, their signed lane, Pocket\'s APK and the meter', () => {
  const text = readFileSync(new URL('../../../.github/workflows/desktop-build.yml', import.meta.url), 'utf8')
  assert.match(text, /case "\$\{name\}" in automagik-\*\.tgz\|plugins\.json\|PLUGINS\.SHA256SUMS\|lane\.json\|lane\.json\.sig\|automagik-pocket-\*\.apk\|latest\.json\|usagemeter-\*\|usagemeter\.SHA256SUMS\) continue ;; esac/)
})

test('every release carries the stable download names under Automagik and under Omni, the old name', () => {
  const text = readFileSync(new URL('../../../.github/workflows/desktop-build.yml', import.meta.url), 'utf8')
  assert.match(text, /for pair in "-mac-arm64\.dmg:Mac\.dmg" "-linux-x86_64\.AppImage:Linux\.AppImage" "-linux-amd64\.deb:Linux\.deb"; do/)
  assert.match(text, /for name in Automagik Omni; do cp -- "\$\{file\}" "\$\{name\}-\$\{pair##\*:\}"; done/)
})

const DESKTOP_BUILD = new URL('../../../.github/workflows/desktop-build.yml', import.meta.url)

// The native Windows app is off (2026-11-04): its build and files wait behind the `windows`
// input, false by default, which release.yml never sets. Its code (D27, D28, D36) stays.
test('the Windows build is still there behind the switch; a missing certificate fails nothing', () => {
  const text = readFileSync(DESKTOP_BUILD, 'utf8')
  assert.match(text, /matrix: \$\{\{ fromJSON\(needs\.version\.outputs\.matrix\) \}\}\r?\n/)
  assert.doesNotMatch(text, /- target: windows/, 'no Windows leg outside the switch')
  assert.match(text, /npx --no-install electron-builder --win nsis --x64 --publish never/)
  assert.match(text, /if \[\[ -z "\$\{WIN_CSC_LINK\}" \]\]; then\r?\n {12}\[\[ "\$\{signed\}" == true \]\] \|\| echo "::warning ::No Windows code-signing certificate: the installer is unsigned"\r?\n {12}unset WIN_CSC_LINK WIN_CSC_KEY_PASSWORD\r?\n/)
  // A build meant to be signed fails unless it is; Azure only once electron-builder.yml asks for it.
  assert.match(text, /if \[\[ "\$\{signed\}" == true && "\$\{status\}" != Valid\* \]\]; then/)
  assert.match(text, /if \[\[ -n "\$\{AZURE_CLIENT_ID\}" \]\] && grep -Eq '\^\[\[:space:\]\]\+azureSignOptions:' electron-builder\.yml; then/)
  assert.match(text, /node scripts\/check-feed\.mjs dist\/latest\.yml/)
  assert.match(text, /apps\/desktop\/dist\/latest\.yml\r?\n/)
})

test('the windows switch is off unless set, and release.yml does not set it', () => {
  const text = readFileSync(DESKTOP_BUILD, 'utf8')
  const declared = [...text.matchAll(/^ {6}windows:\r?\n((?: {8}.*\r?\n)+)/gm)].map(match => match[1])
  assert.equal(declared.length, 2, 'declared under workflow_call and workflow_dispatch')
  for (const body of declared) {
    assert.match(body, /type: boolean/)
    assert.match(body, /default: false/)
  }
  const release = readFileSync(new URL('../../../.github/workflows/release.yml', import.meta.url), 'utf8')
  const call = release.slice(release.indexOf('uses: ./.github/workflows/desktop-build.yml'))
  const withBlock = call.match(/\n {4}with:\r?\n((?: {6}.*\r?\n)+)/)
  assert.ok(withBlock, 'release.yml calls desktop-build.yml with inputs')
  assert.doesNotMatch(withBlock[1], /windows/)
})

// A rebuilt release keeps the Windows files it had only while Windows is on; off, they go.
test('Publish fetches a release\'s old Windows files only with the switch on', () => {
  const text = readFileSync(DESKTOP_BUILD, 'utf8')
  assert.match(text, /- name: Windows files the release already has\r?\n {8}if: steps\.files\.outputs\.windows == 'false' && inputs\.windows == true\r?\n/)
  assert.match(text, /\[\[ "\$\{WINDOWS\}" == true && -s assets\/Automagik-Windows\.exe \]\] && windows=/)
})

// D37: a Windows build that fails never holds back Mac and Linux.
test('Publish runs after a failed or cancelled build leg, unless the run itself was cancelled', () => {
  const text = readFileSync(DESKTOP_BUILD, 'utf8')
  assert.match(text, /needs: \[version, build\]\r?\n(?: {4}#.*\r?\n)* {4}if: \$\{\{ !cancelled\(\) && needs\.version\.result == 'success' && inputs\.publish != false \}\}\r?\n/)
})

// The workflow steps' own bash, run on stand-in files named as the builds name theirs.
function stepScript(text, name) {
  const lines = text.split(/\r?\n/)
  const at = lines.findIndex(line => line.trim() === `- name: ${name}`)
  assert.ok(at >= 0, `no step ${name}`)
  const run = lines.findIndex((line, i) => i > at && line.trim() === 'run: |')
  const body = []
  for (const line of lines.slice(run + 1)) {
    if (line.trim() !== '' && !line.startsWith(' '.repeat(10))) break
    body.push(line.slice(10))
  }
  return body.join('\n')
}
const bash = { skip: spawnSync('bash', ['-c', 'true']).status === 0 ? false : 'no bash' }

// The build matrix, as the Version job hands it to Build; `windows` is '' when no one set it.
function buildTargets(t, windows) {
  const text = readFileSync(DESKTOP_BUILD, 'utf8')
  const root = mkdtempSync(join(tmpdir(), 'automagik-targets-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const output = join(root, 'output')
  writeFileSync(output, '')
  const script = join(root, 'targets.sh')
  writeFileSync(script, stepScript(text, 'The builds to run'))
  const run = spawnSync('bash', [script], { cwd: root, env: { ...process.env, WINDOWS: windows, GITHUB_OUTPUT: output }, encoding: 'utf8' })
  assert.equal(run.status, 0, run.stderr)
  const line = readFileSync(output, 'utf8').match(/^matrix=(.*)$/m)
  assert.ok(line, 'the step sets matrix')
  return JSON.parse(line[1]).include
}

test('by default no Windows build runs: Mac and Linux only', bash, (t) => {
  for (const windows of ['', 'false']) {
    assert.deepEqual(buildTargets(t, windows), [{ target: 'linux', os: 'ubuntu-24.04' }, { target: 'mac', os: 'macos-15' }], `windows=${windows}`)
  }
})

test('with the switch on, Windows builds beside Mac and Linux', bash, (t) => {
  assert.deepEqual(buildTargets(t, 'true'), [{ target: 'linux', os: 'ubuntu-24.04' }, { target: 'mac', os: 'macos-15' }, { target: 'windows', os: 'windows-latest' }])
})

const VERSION = '3.65.0'
const LINUX_MAC = [`Automagik-${VERSION}-linux-x86_64.AppImage`, `Automagik-${VERSION}-linux-amd64.deb`, 'latest-linux.yml', `Automagik-${VERSION}-mac-arm64.dmg`]
const WINDOWS = [`Automagik-${VERSION}-win-x64.exe`, `Automagik-${VERSION}-win-x64.exe.blockmap`, 'latest.yml']
const WINDOWS_FILE = /Windows|win-x64|^latest\.yml$/
function publishFiles(t, files, windows = '') {
  const text = readFileSync(DESKTOP_BUILD, 'utf8')
  const root = mkdtempSync(join(tmpdir(), 'automagik-publish-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const assets = join(root, 'assets')
  mkdirSync(assets)
  for (const file of files) writeFileSync(join(assets, file), 'x')
  const output = join(root, 'output')
  const summary = join(root, 'summary')
  writeFileSync(output, '')
  writeFileSync(summary, '')
  const env = { ...process.env, VERSION, SIGNED: 'false', WINDOWS: windows, GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: summary }
  const run = (name) => {
    const script = join(root, `${name.replaceAll(' ', '-')}.sh`)
    writeFileSync(script, stepScript(text, name))
    return spawnSync('bash', [script], { cwd: assets, env, encoding: 'utf8' })
  }
  const check = run('Every download is there')
  const stable = check.status === 0 ? run('Stable download names') : null
  return { check, stable, output: readFileSync(output, 'utf8'), summary: readFileSync(summary, 'utf8'), left: readdirSync(assets).sort() }
}

test('by default Publish neither expects nor uploads a Windows file, and warns of nothing', bash, (t) => {
  for (const windows of ['', 'false']) {
    for (const files of [LINUX_MAC, [...LINUX_MAC, ...WINDOWS], [...LINUX_MAC, 'latest.yml']]) {
      const { check, stable, output, summary, left } = publishFiles(t, files, windows)
      assert.equal(check.status, 0, check.stdout + check.stderr)
      assert.equal(stable.status, 0, stable.stderr)
      assert.match(output, /^windows=false$/m)
      assert.doesNotMatch(check.stdout, /::warning/)
      assert.equal(summary, '')
      assert.deepEqual(left.filter(file => WINDOWS_FILE.test(file)), [], `windows=${windows}`)
      for (const name of ['Mac.dmg', 'Linux.AppImage', 'Linux.deb']) assert.ok(left.includes(`Automagik-${name}`) && left.includes(`Omni-${name}`), name)
    }
  }
})

test('switch on, every file there: Windows publishes with its stable name', bash, (t) => {
  const { check, stable, output, left } = publishFiles(t, [...LINUX_MAC, ...WINDOWS], 'true')
  assert.equal(check.status, 0, check.stdout + check.stderr)
  assert.equal(stable.status, 0, stable.stderr)
  assert.match(output, /^windows=true$/m)
  assert.ok(left.includes('Automagik-Windows.exe') && left.includes('latest.yml'))
  assert.ok(!left.includes('Omni-Windows.exe'), 'Windows came after the rename: no Omni- name')
  for (const name of ['Mac.dmg', 'Linux.AppImage', 'Linux.deb']) assert.ok(left.includes(`Automagik-${name}`) && left.includes(`Omni-${name}`), name)
})

test('switch on, the Windows build failed: Mac and Linux still publish, with a warning', bash, (t) => {
  const { check, stable, output, summary, left } = publishFiles(t, LINUX_MAC, 'true')
  assert.equal(check.status, 0, check.stdout + check.stderr)
  assert.match(check.stdout, /::warning ::No Windows installer from this build of v3\.65\.0/)
  assert.match(summary, /Windows users get the next release/)
  assert.match(output, /^windows=false$/m)
  assert.equal(stable.status, 0)
  assert.ok(!left.some(file => WINDOWS_FILE.test(file)))
})

test('switch on, half a Windows build never ships: a latest.yml without its installer goes', bash, (t) => {
  const { check, output, left } = publishFiles(t, [...LINUX_MAC, 'latest.yml'], 'true')
  assert.equal(check.status, 0)
  assert.match(output, /^windows=false$/m)
  assert.ok(!left.includes('latest.yml'), 'a feed naming an installer the release lacks would break every Windows update')
})

test('a Mac or Linux file missing still refuses the release, switch on or off', bash, (t) => {
  for (const windows of ['', 'true']) {
    for (const gone of LINUX_MAC) {
      const { check } = publishFiles(t, [...LINUX_MAC.filter(file => file !== gone), ...WINDOWS], windows)
      assert.equal(check.status, 1, `${gone}, windows=${windows}`)
      assert.match(check.stdout, new RegExp(`::error ::${gone.replaceAll('.', '\\.')} is missing`))
    }
  }
})
