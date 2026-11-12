// Build-only: a pnpm 10 content-addressed store containing exactly the inspected profile
// payload. No tarballs or unused dependency fixtures are copied into the runtime image.
import { createHash } from 'node:crypto'
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const json = path => JSON.parse(readFileSync(path, 'utf8'))
const integrity = bytes => `sha512-${createHash('sha512').update(bytes).digest('base64')}`

function packages(modules, found = new Map()) {
  if (!existsSync(modules)) return found
  for (const entry of readdirSync(modules, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    const dirs = entry.name.startsWith('@') ? readdirSync(join(modules, entry.name)).map(name => join(modules, entry.name, name)) : [join(modules, entry.name)]
    for (const dir of dirs) {
      if (!lstatSync(dir).isDirectory() || !existsSync(join(dir, 'package.json'))) continue
      const pkg = json(join(dir, 'package.json'))
      found.set(`${pkg.name}@${pkg.version}`, dir)
      packages(join(dir, 'node_modules'), found)
    }
  }
  return found
}

export function buildOfflineStore({ store, profile, out, excludeNames = [] }) {
  const installed = packages(join(profile, 'node_modules')), covered = new Set()
  rmSync(out, { recursive: true, force: true })
  mkdirSync(join(out, 'v10'), { recursive: true })
  const source = join(store, 'v10'), target = join(out, 'v10')
  for (const shard of readdirSync(join(source, 'index'))) {
    for (const file of readdirSync(join(source, 'index', shard))) {
      const index = json(join(source, 'index', shard, file)), key = `${index.name}@${index.version}`
      if (excludeNames.includes(index.name)) continue
      const dir = installed.get(key)
      if (!dir) continue
      const files = {}
      for (const [name, record] of Object.entries(index.files ?? {})) {
        if (name.startsWith('/') || name.split('/').some(part => part === '..' || part === '')) throw new Error('Unsafe offline package entry')
        const path = join(dir, name)
        if (!existsSync(path) || !lstatSync(path).isFile()) continue
        if (integrity(readFileSync(path)) !== record.integrity) throw new Error('Offline cache differs from inspected profile')
        const match = /^sha512-([A-Za-z0-9+/]+=*)$/.exec(record.integrity)
        if (!match) throw new Error('Unsupported offline content hash')
        const hex = Buffer.from(match[1], 'base64').toString('hex')
        let copied = false
        for (const suffix of ['', '-exec']) {
          const relative = join('files', hex.slice(0, 2), hex.slice(2) + suffix)
          const origin = join(source, relative)
          if (!existsSync(origin)) continue
          if (integrity(readFileSync(origin)) !== record.integrity) throw new Error('Invalid offline cache content')
          mkdirSync(dirname(join(target, relative)), { recursive: true })
          cpSync(origin, join(target, relative))
          copied = true
        }
        if (!copied) throw new Error('Missing offline cache content')
        files[name] = record
      }
      if (!files['package.json']) throw new Error('Offline cache lacks package metadata')
      const destination = join(target, 'index', shard, file)
      mkdirSync(dirname(destination), { recursive: true })
      writeFileSync(destination, `${JSON.stringify({ ...index, files })}\n`)
      covered.add(key)
    }
  }
  for (const [key, dir] of installed) if (!covered.has(key) && !excludeNames.includes(json(join(dir, 'package.json')).name)) throw new Error('Installed package missing from offline cache')
  return { packages: covered.size }
}
