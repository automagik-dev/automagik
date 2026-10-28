// Patches the app carries to the pinned DeepSeek Harness until DSH has the change itself
// (runtime/patches: patches.json lists each patch, the dsh it is for, and every file it
// changes with the package's version and the file's sha256 before and after). prepare-runtime
// applies them to build/runtime once npm has installed it. Anything unexpected fails the build:
// another dsh or package version, a file with another hash, a hunk that does not apply, a result
// with another hash. A file already at its after-hash is left alone, so a re-run changes nothing.
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const sha256 = text => createHash('sha256').update(text).digest('hex')
const readJson = file => JSON.parse(readFileSync(file, 'utf8'))

/** The file sections of a unified diff: each path (without a/ or b/) and its hunks. */
function parsePatch(text, label) {
  const lines = text.split('\n')
  const files = []
  for (let i = 0; i < lines.length;) {
    if (lines[i].startsWith('--- ') && lines[i + 1]?.startsWith('+++ ')) {
      files.push({ path: lines[i + 1].slice(4).replace(/^b\//, ''), hunks: [] })
      i += 2
      continue
    }
    const head = /^@@ -(\d+)(?:,(\d+))? \+\d+(?:,(\d+))? @@/.exec(lines[i])
    if (head === null) { i += 1; continue }
    if (files.length === 0) throw new Error(`${label}: a hunk before any file header`)
    const hunk = { start: Number(head[1]), lines: [] }
    let old = head[2] === undefined ? 1 : Number(head[2])
    let added = head[3] === undefined ? 1 : Number(head[3])
    if (old === 0) hunk.start += 1
    for (i += 1; old > 0 || added > 0; i += 1) {
      const line = lines[i]
      if (line === undefined) throw new Error(`${label}: a hunk at line ${hunk.start} ends early`)
      if (line[0] === ' ') { old -= 1; added -= 1 } else if (line[0] === '-') old -= 1
      else if (line[0] === '+') added -= 1
      else throw new Error(`${label}: unexpected line in a hunk: ${JSON.stringify(line.slice(0, 40))}`)
      hunk.lines.push(line)
    }
    if (lines[i]?.startsWith('\\')) throw new Error(`${label}: files without a final newline are not supported`)
    files.at(-1).hunks.push(hunk)
  }
  return files
}

/** Apply hunks exactly: every context and removed line must match where the hunk says. */
function applyHunks(text, hunks, label) {
  const lines = text.split('\n')
  const out = []
  let at = 0
  for (const hunk of hunks) {
    let i = hunk.start - 1
    if (i < at) throw new Error(`${label}: overlapping hunks`)
    out.push(...lines.slice(at, i))
    for (const line of hunk.lines) {
      if (line[0] !== '+') {
        if (lines[i] !== line.slice(1)) throw new Error(`${label}: the hunk at line ${hunk.start} does not apply (line ${i + 1} differs)`)
        i += 1
      }
      if (line[0] !== '-') out.push(line.slice(1))
    }
    at = i
  }
  return [...out, ...lines.slice(at)].join('\n')
}

/**
 * Patch the DSH packages under `nodeModules` as `dir`/patches.json says, all or nothing: every
 * file is checked and patched in memory before any is written.
 * @param {string} nodeModules - the runtime's node_modules
 * @param {string} dir - the patches folder (runtime/patches)
 * @param {{ versions?: boolean, write?: boolean }} [options] - versions: false skips the dsh and
 *   package version checks (the hashes still apply); write: false only returns the results
 * @returns {{ name: string, path: string, text: string, state: 'patched' | 'already patched' }[]}
 */
export function patchRuntime(nodeModules, dir, { versions = true, write = true } = {}) {
  const dsh = readJson(join(nodeModules, '@deepseek-ai', 'dsh', 'package.json')).version
  const results = []
  for (const entry of readJson(join(dir, 'patches.json'))) {
    const label = `runtime patch ${entry.patch}`
    if (versions && entry.dsh !== dsh) throw new Error(`${label} is for dsh ${entry.dsh}, but the runtime is dsh ${dsh}: delete it if this dsh has the change, else port it (docs/DEVELOPMENT.md)`)
    const sections = parsePatch(readFileSync(join(dir, entry.patch), 'utf8'), label)
    const named = entry.files.map(file => `${file.package}/${file.file}`)
    if (sections.length !== named.length || sections.some(section => !named.includes(section.path))) throw new Error(`${label} changes ${sections.map(section => section.path).join(', ')}, but patches.json lists ${named.join(', ')}`)
    for (const file of entry.files) {
      const name = `${file.package}/${file.file}`
      const version = readJson(join(nodeModules, ...file.package.split('/'), 'package.json')).version
      if (versions && version !== file.version) throw new Error(`${label}: ${file.package} is ${version}, not ${file.version}`)
      const path = join(nodeModules, ...name.split('/'))
      const text = readFileSync(path, 'utf8')
      const hash = sha256(text)
      if (hash === file.after) { results.push({ name, path, text, state: 'already patched' }); continue }
      if (hash !== file.before) throw new Error(`${label}: ${name} has sha256 ${hash}, neither the ${file.before} it was made against nor its result`)
      const patched = applyHunks(text, sections.find(section => section.path === name).hunks, `${label}: ${name}`)
      if (sha256(patched) !== file.after) throw new Error(`${label}: ${name} patched to sha256 ${sha256(patched)}, not ${file.after}`)
      results.push({ name, path, text: patched, state: 'patched' })
    }
  }
  if (write) for (const result of results) if (result.state === 'patched') writeFileSync(result.path, result.text)
  return results
}
