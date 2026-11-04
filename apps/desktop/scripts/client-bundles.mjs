// The client bundles the app's profile ships must be production builds. DSH's web client hands a
// plugin only the modules in its table (react, react/jsx-runtime, …), never react/jsx-dev-runtime,
// and refuses the whole web UI when one plugin's import misses ("Failed to load plugins"). A
// development build of an add-on (v3.53.0: the Oh My Claude fork at f6e9158) imports exactly that.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const DEV_ONLY = /["']react\/jsx-dev-runtime["']/

/** Whether a client bundle's text names a module only a development build of React imports. */
export const isDevBundle = text => DEV_ONLY.test(text)

/** Each `names` package under `nodeModules` whose client entry (exports './client') is a development build. */
export function devClientBundles(nodeModules, names) {
  const found = []
  for (const name of names) {
    const dir = join(nodeModules, ...name.split('/'))
    if (!existsSync(join(dir, 'package.json'))) continue
    const entry = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).exports?.['./client']
    const file = typeof entry === 'string' ? join(dir, entry) : null
    if (file && existsSync(file) && isDevBundle(readFileSync(file, 'utf8'))) found.push(`${name} (${entry})`)
  }
  return found
}
