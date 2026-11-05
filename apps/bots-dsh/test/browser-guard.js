// The one guard for the Bot team's browser layout tests (#364). CI must run every browser half
// (#323): its job sets CHROME_BIN and installs playwright-core (a dependency of this package), so
// a missing browser or module there fails the test. Away from CI it is a skip, and each test's
// structural checks still run.
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'

export const DARWIN_CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
export const LINUX_CHROMIUM = '/usr/bin/chromium'

export function browserPath({ env = process.env, platform = process.platform } = {}) {
  return env.CHROME_BIN ?? (platform === 'darwin' ? DARWIN_CHROME : LINUX_CHROMIUM)
}

// Resolves { chromium, executablePath } to launch, or { skip } with the reason for t.skip.
// Under CI it never returns a skip: it fails with what it looked for.
export async function browserGuard({
  env = process.env,
  platform = process.platform,
  exists = existsSync,
  load = () => import('playwright-core'),
} = {}) {
  const executablePath = browserPath({ env, platform })
  if (!exists(executablePath)) {
    if (env.CI) assert.fail(`Browser layout check found no browser at ${executablePath} (CHROME_BIN=${env.CHROME_BIN ?? 'unset'}); CI must run it`)
    return { skip: 'Browser layout check requires CHROME_BIN; the structural checks still run' }
  }
  let chromium
  try { ({ chromium } = await load()) } catch (error) {
    if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error
    if (env.CI) assert.fail(`Browser layout check cannot import playwright-core (${error.message}); CI's bun install must provide it`)
    return { skip: 'Browser layout check requires the root bun install (playwright-core)' }
  }
  return { chromium, executablePath }
}
