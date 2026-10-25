import assert from 'node:assert/strict'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { entriesNameSrc, prunable, pruneNodeModules } from '../scripts/prune-runtime.mjs'

const write = (root, files) => {
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), body)
  }
}

test('maps, typings and package docs go; what Node or a package reads stays', () => {
  for (const path of ['lib/index.js.map', 'lib/index.d.ts.map', 'dist/a.mjs.map', 'dist/a.css.map', 'lib/index.d.ts', 'lib/index.d.mts', 'lib/index.d.cts', 'README.md', 'CHANGELOG.md', 'History.md']) {
    assert.equal(prunable(path), true, path)
  }
  for (const path of ['lib/index.js', 'lib/index.cjs', 'lib/index.mjs', 'package.json', 'build/addon.node', 'lib/engine.wasm', 'locale/en.json', 'LICENSE', 'LICENSE.md', 'NOTICE.md',
    'skills/x/SKILL.md', 'assets/dsh-badge.md', 'docs/README.md', 'src/index.ts', 'lib/index.ts', 'data/regions.map.json', 'cordis.patch.yml']) {
    assert.equal(prunable(path), false, path)
  }
  // TypeScript sources go only from src/ of a package that runs lib/.
  assert.equal(prunable('src/index.ts', { srcIsSource: true }), true)
  assert.equal(prunable('src/index.js', { srcIsSource: true }), false)
  // DSH's own packages and the profile's plugins keep typings and README (DSH's
  // plugin-development skill reads them); a profile keeps every .md (a plugin reads its own).
  assert.equal(prunable('lib/types/index.d.ts', { keepDocs: true }), false)
  assert.equal(prunable('README.md', { keepDocs: true }), false)
  assert.equal(prunable('lib/index.js.map', { keepDocs: true }), true)
  assert.equal(prunable('CHANGELOG.md', { docs: false }), false)
})

test('src/ stays when a package\'s entry points name it', () => {
  assert.equal(entriesNameSrc({ main: 'lib/index.js', exports: { '.': { types: './lib/index.d.ts', default: './lib/index.js' } } }), false)
  assert.equal(entriesNameSrc({ exports: { '.': './lib/index.js', './src/*': './src/*' } }), true)
  assert.equal(entriesNameSrc({ main: 'src/index.js' }), true)
  assert.equal(entriesNameSrc({ bin: { x: './src/cli.js' } }), true)
  assert.equal(entriesNameSrc({ main: 'lib/index.js', types: 'src/index.ts' }), false)
})

test('a node_modules tree loses only what nothing reads, nested packages included', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'automagik-prune-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const nm = join(root, 'node_modules')
  write(nm, {
    'left-pad/package.json': '{"name":"left-pad","main":"lib/index.js"}',
    'left-pad/lib/index.js': 'module.exports = 1\n//# sourceMappingURL=index.js.map',
    'left-pad/lib/index.js.map': '{}',
    'left-pad/lib/index.d.ts': 'export {}',
    'left-pad/src/index.ts': 'export {}',
    'left-pad/README.md': '#',
    'left-pad/LICENSE': 'MIT',
    'left-pad/node_modules/inner/package.json': '{"name":"inner"}',
    'left-pad/node_modules/inner/index.js': '',
    'left-pad/node_modules/inner/index.d.ts': '',
    'left-pad/node_modules/inner/CHANGELOG.md': '',
    'src-pkg/package.json': '{"name":"src-pkg","exports":{"./src/*":"./src/*"}}',
    'src-pkg/lib/index.js': '',
    'src-pkg/src/index.ts': '',
    'no-lib/package.json': '{"name":"no-lib"}',
    'no-lib/src/index.ts': '',
    '@deepseek-ai/dsh-x/package.json': '{"name":"@deepseek-ai/dsh-x"}',
    '@deepseek-ai/dsh-x/lib/index.js': '',
    '@deepseek-ai/dsh-x/lib/index.js.map': '{}',
    '@deepseek-ai/dsh-x/lib/types/index.d.ts': '',
    '@deepseek-ai/dsh-x/README.md': '#',
    '@deepseek-ai/dsh-x/skills/a/SKILL.md': '#',
    '@deepseek-ai/dsh-x/node_modules/fflate/package.json': '{"name":"fflate"}',
    '@deepseek-ai/dsh-x/node_modules/fflate/README.md': '#',
    '.bin/.keep': '',
  })
  symlinkSync('index.js', join(nm, 'left-pad', 'lib', 'alias.d.ts'))
  const removed = pruneNodeModules(nm, { keepDocsOf: name => name.startsWith('@deepseek-ai/') })
  const gone = ['left-pad/lib/index.js.map', 'left-pad/lib/index.d.ts', 'left-pad/src/index.ts', 'left-pad/README.md', 'left-pad/node_modules/inner/index.d.ts',
    'left-pad/node_modules/inner/CHANGELOG.md', '@deepseek-ai/dsh-x/lib/index.js.map', '@deepseek-ai/dsh-x/node_modules/fflate/README.md']
  const kept = ['left-pad/lib/index.js', 'left-pad/LICENSE', 'left-pad/package.json', 'left-pad/node_modules/inner/index.js', 'src-pkg/src/index.ts', 'no-lib/src/index.ts',
    '@deepseek-ai/dsh-x/lib/types/index.d.ts', '@deepseek-ai/dsh-x/README.md', '@deepseek-ai/dsh-x/skills/a/SKILL.md', '@deepseek-ai/dsh-x/lib/index.js']
  for (const path of gone) assert.equal(existsSync(join(nm, path)), false, `${path} is left out`)
  for (const path of kept) assert.equal(existsSync(join(nm, path)), true, `${path} stays`)
  assert.equal(lstatSync(join(nm, 'left-pad', 'lib', 'alias.d.ts')).isSymbolicLink(), true, 'only regular files go, never a symlink')
  assert.equal(existsSync(join(nm, '.bin', '.keep')), true, 'dot folders are not packages')
  assert.equal(removed.files, gone.length)
})

test('the runtime pins the zod DSH pins, so one copy ships instead of one per package', () => {
  const runtime = new URL('../runtime/', import.meta.url)
  const manifest = JSON.parse(readFileSync(new URL('package.json', runtime), 'utf8'))
  const lock = JSON.parse(readFileSync(new URL('package-lock.json', runtime), 'utf8')).packages
  const pins = new Set(Object.entries(lock).filter(([path]) => path.includes('@deepseek-ai/')).map(([, entry]) => entry.dependencies?.zod).filter(range => /^\d+\.\d+\.\d+$/.test(range ?? '')))
  assert.deepEqual([...pins], [manifest.dependencies.zod], 'runtime/package.json pins the exact zod every DSH package pins: move it with DSH')
  const copies = Object.keys(lock).filter(path => /(?:^|\/)node_modules\/zod$/.test(path))
  assert.deepEqual(copies, ['node_modules/zod'])
})
