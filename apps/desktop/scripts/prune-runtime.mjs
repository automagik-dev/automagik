// What the app ships but nothing reads, left out of build/runtime and build/profile
// (prepare-runtime runs this). Every shipped file costs the update: macOS verifies the
// signature of each one before an update relaunches the app. Removed:
//
//   source maps (*.js.map, *.d.ts.map, *.css.map, ...)   Node runs without them; DSH serves
//       a plugin's map to DevTools only when one exists (dsh-client-modules: ENOENT is no map)
//   TypeScript sources under src/ of a package that ships lib/   Node does not run
//       TypeScript from node_modules; kept when the package's entry points name src/
//   typings (*.d.ts, *.d.mts, *.d.cts)                     only an editor reads them
//   a package's README, CHANGELOG and HISTORY (.md)         runtime only: plugins in the
//       profile read their own (dsh-oh-my-claude's Changelog card reads CHANGELOG.md)
//
// DSH's own packages and the profile's plugins keep their typings and READMEs: DSH's
// plugin-development skill (dsh-agent-preset, cordis-plugin-development) reads
// `<packageDir>/README.md` and `lib/types/**/*.d.ts` of installed packages. No .md other
// than a package's top-level README/CHANGELOG/HISTORY is touched (skills are .md files).
import { lstatSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const MAP = /\.(?:[cm]?js|[cm]?ts|jsx|tsx|css)\.map$/
const TYPINGS = /\.d\.[cm]?ts$/
const TS_SOURCE = /\.(?:[cm]?ts|tsx)$/
const DOCS = /^(?:readme|changelog|history)\.md$/i
// package.json fields that name files Node (or a bundler) loads.
const ENTRY_FIELDS = ['main', 'module', 'browser', 'bin', 'exports', 'imports']

const readJson = (file) => {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

/** Whether a package's entry points name anything under src/. */
export function entriesNameSrc(manifest) {
  const entries = JSON.stringify(ENTRY_FIELDS.map(field => manifest?.[field] ?? null))
  return /(?:^|["/.])src\//.test(entries)
}

/**
 * What to remove from one package, by its path inside the package ('lib/index.js.map').
 * `keepDocs`: the package keeps its typings and README (DSH's own, a profile plugin).
 * `docs`: top-level README/CHANGELOG/HISTORY may go (the runtime, not the profile).
 */
export function prunable(path, { srcIsSource = false, keepDocs = false, docs = true } = {}) {
  const name = path.slice(path.lastIndexOf('/') + 1)
  if (MAP.test(name)) return true
  if (TYPINGS.test(name)) return !keepDocs
  if (srcIsSource && path.startsWith('src/') && TS_SOURCE.test(name)) return true
  if (docs && !keepDocs && !path.includes('/') && DOCS.test(name)) return true
  return false
}

// The packages of a node_modules folder, scoped ones as @scope/name; .bin and package
// managers' dot folders are not packages.
function packagesIn(dir) {
  let names
  try {
    names = readdirSync(dir)
  } catch {
    return []
  }
  return names.filter(name => !name.startsWith('.')).flatMap((name) => {
    if (!name.startsWith('@')) return [name]
    try {
      return readdirSync(join(dir, name)).filter(inner => !inner.startsWith('.')).map(inner => `${name}/${inner}`)
    } catch {
      return []
    }
  })
}

/**
 * Remove what nothing reads from every package under `nodeModules`, nested node_modules
 * included. Only regular files go; symlinks and folders stay. `keepDocsOf(name)` names the
 * packages that keep their typings and README. Returns { files, bytes } removed.
 */
export function pruneNodeModules(nodeModules, { keepDocsOf = () => false, docs = true } = {}) {
  const removed = { files: 0, bytes: 0 }
  const prunePackage = (dir, name) => {
    let stat
    try {
      stat = lstatSync(dir)
    } catch {
      return
    }
    if (!stat.isDirectory()) return
    const manifest = readJson(join(dir, 'package.json'))
    const has = sub => lstatSync(join(dir, sub), { throwIfNoEntry: false })?.isDirectory() === true
    const options = {
      srcIsSource: manifest !== null && has('lib') && has('src') && !entriesNameSrc(manifest),
      keepDocs: keepDocsOf(name),
      docs,
    }
    const walk = (folder, prefix) => {
      for (const entry of readdirSync(folder, { withFileTypes: true })) {
        const full = join(folder, entry.name)
        const path = `${prefix}${entry.name}`
        if (entry.isDirectory()) {
          if (entry.name === 'node_modules') {
            for (const inner of packagesIn(full)) prunePackage(join(full, inner), inner)
          } else {
            walk(full, `${path}/`)
          }
        } else if (entry.isFile() && prunable(path, options)) {
          removed.bytes += lstatSync(full).size
          removed.files++
          rmSync(full)
        }
      }
    }
    walk(dir, '')
  }
  for (const name of packagesIn(nodeModules)) prunePackage(join(nodeModules, name), name)
  return removed
}
