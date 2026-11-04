// Seed copies the image may carry (RFC 0016, "The image": Claude Code, Codex, the ACP adapters),
// put into the volume on first start so each then updates itself there, as it does today. The
// image lists them in <image>/seeds/seeds.json, `{ "v": 1, "seeds": [{ "path": "<relative to the
// guest home>" }] }`, with each tree under <image>/seeds/tree/<path>. A seed goes in only where
// the volume has nothing at its path: what the person (or the tool's updater) has is never
// replaced. Delivery 2's image lists none (wslc/README.md, "Deferred").
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs'
import { dirname, isAbsolute, join, normalize, sep } from 'node:path'

const safePath = path => typeof path === 'string' && path !== '' && !isAbsolute(path) && !normalize(path).split(sep).includes('..')

/** Copies each listed seed missing from `home`. Answers the paths it put in. */
export function plantSeeds({ from, home, log = () => {} }) {
  const list = join(from, 'seeds.json')
  if (!existsSync(list)) return []
  let seeds
  try {
    const json = JSON.parse(readFileSync(list, 'utf8'))
    if (json?.v !== 1 || !Array.isArray(json.seeds)) throw new Error('not a v1 seed list')
    seeds = json.seeds
  } catch (error) {
    log('error', `seeds: ${error.message}`)
    return []
  }
  const planted = []
  for (const { path } of seeds) {
    if (!safePath(path)) { log('error', `seeds: ${JSON.stringify(path)} is not a path inside the home`); continue }
    const target = join(home, path)
    if (existsSync(target)) continue
    const fresh = `${target}.seeding`
    try {
      rmSync(fresh, { recursive: true, force: true })
      mkdirSync(dirname(target), { recursive: true })
      cpSync(join(from, 'tree', path), fresh, { recursive: true, verbatimSymlinks: true })
      renameSync(fresh, target)
      planted.push(path)
    } catch (error) {
      rmSync(fresh, { recursive: true, force: true })
      log('error', `seeds: ${path} not copied (${error.message})`)
    }
  }
  return planted
}
