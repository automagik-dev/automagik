// The app's own dsh profile hosts the Bot team AND Omni's channels, so its fetch policy is the
// channel profiles' policy: no local HTTP provider means web_fetch cannot reach this machine's
// localhost services from text a channel delivered. dsh 0.2.2 has no private-address-only switch,
// so the row is off and the seam refuses every fetch that names the configured provider.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import WebRuntime from '@deepseek-ai/dsh-web'

const profile = readFileSync(new URL('../../desktop/profile/cordis.patch.yml', import.meta.url), 'utf8')

test('the app profile disables the local fetch provider and switches read-before-write on', () => {
  assert.match(profile, /- id: web-fetch-http\n {2}disabled: true/)
  assert.match(profile, /- id: fs-observation-policy\n {2}disabled: false/)
})

test('a web seam with that provider off refuses a private-address fetch', async (t) => {
  const ctx = new Context()
  await ctx.plugin(WebRuntime, { fetchProvider: 'http' })
  t.after(() => ctx.fiber.dispose())
  for (const url of ['http://127.0.0.1:9/', 'http://169.254.169.254/latest/meta-data/']) {
    await assert.rejects(ctx.web.fetch({ url }), /configured web provider "http" is not registered/, url)
  }
})
