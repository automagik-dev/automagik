// Fixture data preparation through public native services; no client override or model call.
import assert from 'node:assert/strict'
import { realpath } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
export const name = 'advanced-native-fixture-seed'
export const inject = ['workspaceRegistry', 'sessionController']
export async function apply(ctx) {
  const root = process.env.ADVANCED_FIXTURE_ROOT
  assert.ok(root && resolve(root) === root && root.includes(`${sep}.tools${sep}advanced-fixture${sep}run-`), 'Missing scoped fixture root')
  const actualRoot = await realpath(root)
  const home = await realpath(process.env.HOME)
  assert.equal(home, join(actualRoot, 'plain/home'), 'Seed only the owned plain fixture HOME')
  const path = await realpath(join(home, 'native-workspace'))
  assert.equal(path, join(home, 'native-workspace'), 'Reject symlinked or escaped fixture workspace')
  const workspace = await ctx.workspaceRegistry.create(path)
  const { sessionId } = await ctx.sessionController.create({ workspaceId: workspace.id })
  assert.ok(workspace.sessionIds.includes(sessionId), 'Public create must attach the native Session')
  console.log(`ADVANCED_FIXTURE_SEED ${JSON.stringify({ path, workspaceId: workspace.id, sessionId })}`)
}
