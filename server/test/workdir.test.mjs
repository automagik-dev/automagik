// The image's working directory is part of its runtime contract and must stay off /data:
// an Incus instance pre-creates the image WorkingDir on the mounted data volume as root, so a
// WORKDIR under /data would leave /data/workspace 0:0 755 before the entrypoint runs.
//
// What it does NOT cover: a real Incus volume or instance, or a built image. This is a static
// parse of the final runtime stage's WORKDIR lines; data-preflight.test.mjs covers the
// entrypoint's repair of an existing unwritable /data/workspace.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const DOCKERFILE = join(ROOT, 'server/Dockerfile')

test('the final runtime stage works outside /data', () => {
  const lines = readFileSync(DOCKERFILE, 'utf8').split('\n')
  const start = lines.findIndex((line) => /^FROM\s+scratch\s+AS\s+runtime\s*$/i.test(line))
  assert.notEqual(start, -1, 'the final stage is FROM scratch AS runtime')

  const workdirs = lines
    .slice(start + 1)
    .filter((line) => /^WORKDIR\s+/i.test(line))
    .map((line) => line.replace(/^WORKDIR\s+/i, '').trim())
  assert.equal(workdirs.length, 1, 'the final stage has exactly one WORKDIR')
  assert.equal(workdirs[0], '/opt/automagik', 'the working directory is the code root')
  assert.ok(
    workdirs[0] !== '/data' && !workdirs[0].startsWith('/data/'),
    `${workdirs[0]} must not be /data or under it`,
  )
})
