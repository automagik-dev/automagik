import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test, { after } from 'node:test'
import { fileURLToPath } from 'node:url'
import { imageRecord, parseRecord, RECORD_ASSET } from '../image-record.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..', '..')
const SCRIPT = join(HERE, '..', 'image-record.mjs')
const temps = []
after(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true })
})

const revision = 'ab12'.repeat(10)
const digest = `sha256:${'0f'.repeat(32)}`
const good = { image: 'ghcr.io/automagik-si/automagik-server', digest, version: '3.93.0', revision, tag: `3.93.0-${revision.slice(0, 8)}` }
const run = (args) => {
  try {
    return { status: 0, stdout: execFileSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', stdio: 'pipe' }) }
  } catch (error) {
    return { status: error.status, stderr: String(error.stderr) }
  }
}

test('the record pins the image by the pushed digest, never by a tag', () => {
  const record = imageRecord(good)
  assert.deepEqual(record, { schema: 1, ...good, ref: `${good.image}@${digest}`, image: good.image })
  assert.deepEqual(Object.keys(record), ['schema', 'image', 'digest', 'ref', 'version', 'revision', 'tag'])
  assert.ok(!record.ref.includes(':latest'))
  assert.deepEqual(parseRecord(JSON.stringify(record)), record)
  const pre = { ...good, version: '3.94.0-rc.1', tag: `3.94.0-rc.1-${revision.slice(0, 8)}` }
  assert.equal(imageRecord(pre).version, '3.94.0-rc.1')
})

test('anything that is not what a push produced is refused', () => {
  const bad = [
    ['an empty digest', { digest: '' }, /digest/],
    ['a tag for a digest', { digest: 'latest' }, /digest/],
    ['a short digest', { digest: `sha256:${'0f'.repeat(31)}` }, /digest/],
    ['an uppercase digest', { digest: `sha256:${'0F'.repeat(32)}` }, /digest/],
    ['another algorithm', { digest: `sha512:${'0f'.repeat(32)}` }, /digest/],
    ['an image with a tag', { image: `${good.image}:latest` }, /image/],
    ['an image with a digest', { image: `${good.image}@${digest}` }, /image/],
    ['a bare image name', { image: 'automagik-server' }, /image/],
    ['a version with its v', { version: 'v3.93.0' }, /version/],
    ['a short revision', { revision: revision.slice(0, 8) }, /revision/],
    ['the latest tag', { tag: 'latest' }, /tag/],
    ['a tag of another commit', { tag: '3.93.0-00000000' }, /tag/],
    ['a tag of another release', { tag: `3.92.0-${revision.slice(0, 8)}` }, /tag/],
  ]
  for (const [label, change, message] of bad) assert.throws(() => imageRecord({ ...good, ...change }), message, label)
  assert.throws(() => imageRecord({}), /digest/)
  const record = imageRecord(good)
  assert.throws(() => parseRecord(JSON.stringify({ ...record, schema: 2 })), /schema/)
  assert.throws(() => parseRecord(JSON.stringify({ ...record, ref: `${good.image}:latest` })), /ref/)
  assert.throws(() => parseRecord('{'), SyntaxError)
})

test('the CLI writes the asset and checks the posted one against the pushed digest', () => {
  const dir = mkdtempSync(join(tmpdir(), 'automagik-image-record-'))
  temps.push(dir)
  const out = join(dir, RECORD_ASSET)
  const flags = ['--image', good.image, '--digest', digest, '--version', good.version, '--revision', revision, '--tag', good.tag]
  assert.equal(run(['write', ...flags, '--out', out]).status, 0)
  assert.deepEqual(JSON.parse(readFileSync(out, 'utf8')), imageRecord(good))
  assert.match(run(['check', out, '--digest', digest]).stdout, new RegExp(`records ${good.image}@${digest}`))

  const other = run(['check', out, '--digest', `sha256:${'1e'.repeat(32)}`])
  assert.equal(other.status, 1)
  assert.match(other.stderr, /not the pushed/)
  const empty = run(['write', ...flags.map((flag) => (flag === digest ? '' : flag)), '--out', join(dir, 'none.json')])
  assert.equal(empty.status, 1)
  assert.throws(() => readFileSync(join(dir, 'none.json')))
  assert.equal(run([]).status, 1)
  assert.equal(run(['check', join(dir, 'missing.json'), '--digest', digest]).status, 1)
})

// The workflow's wiring, read as text: the record is the release's own, on every pushing run.
const workflow = readFileSync(join(ROOT, '.github/workflows/server-image.yml'), 'utf8')
const job = (name) => {
  const start = workflow.indexOf(`\n  ${name}:\n`)
  assert.notEqual(start, -1, name)
  const next = workflow.slice(start + 1).search(/\n  [a-z-]+:\n/)
  return workflow.slice(start, next === -1 ? undefined : start + 1 + next)
}

test('every run that pushes records the digest: a release and a dispatch alike', () => {
  const record = job('record')
  assert.match(record, /needs: \[image, publish\]/)
  // The same condition as the push itself, with no event filter of its own.
  assert.match(record, /\n    if: needs\.image\.outputs\.publish == 'true'\n/)
  assert.match(job('publish'), /\n    if: needs\.image\.outputs\.publish == 'true'\n/)
  assert.ok(!/github\.event_name/.test(record))
  // The digest is the push step's own output, and the record goes on the content release.
  assert.match(job('publish'), /outputs:\n      digest: \$\{\{ steps\.push\.outputs\.digest \}\}/)
  assert.match(record, /DIGEST: \$\{\{ needs\.publish\.outputs\.digest \}\}/)
  assert.match(record, /node server\/image-record\.mjs write --image "\$\{GHCR\}" --digest "\$\{DIGEST\}"/)
  assert.ok(record.includes(`gh release upload "v\${CONTENT}" ${RECORD_ASSET} --clobber`))
  assert.ok(record.includes(`gh release download "v\${CONTENT}" --pattern ${RECORD_ASSET}`))
  assert.match(record, /node server\/image-record\.mjs check posted\/server-image\.json --digest "\$\{DIGEST\}"/)
  // Both jobs name the same registry image.
  const ghcr = /GHCR: (\S+)/
  assert.equal(ghcr.exec(record)[1], ghcr.exec(job('publish'))[1])
})

test('only the record job may write to a release, and it cannot reach the registry', () => {
  assert.match(workflow, /\npermissions:\n  contents: read\n/)
  const record = job('record')
  assert.match(record, /permissions:\n      contents: write\n/)
  assert.ok(!record.includes('packages:'))
  assert.ok(!record.includes('docker login'))
  const publish = job('publish')
  assert.match(publish, /permissions:\n      contents: read\n      packages: write\n/)
  assert.ok(!job('image').includes('permissions:'))
})

test("a desktop rebuild's asset sweep keeps the record", () => {
  const sweep = readFileSync(join(ROOT, '.github/workflows/desktop-build.yml'), 'utf8')
    .split('\n').find((line) => /case "\$\{name\}" in .*\) continue ;; esac/.test(line)) ?? ''
  const kept = /in (.*)\) continue/.exec(sweep)?.[1].split('|') ?? []
  assert.ok(kept.includes(RECORD_ASSET))
})
