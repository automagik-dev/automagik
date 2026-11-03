import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { devClientBundles, isDevBundle } from '../scripts/client-bundles.mjs'

const write = (root, files) => {
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), body)
  }
}
const pkg = (name, client) => JSON.stringify({ name, exports: { '.': './lib/index.js', ...(client ? { './client': client } : {}) } })

test('a development React build is told apart from a production one', () => {
  assert.equal(isDevBundle('import { jsxDEV } from "react/jsx-dev-runtime";'), true)
  assert.equal(isDevBundle("var j = require('react/jsx-dev-runtime');"), true)
  assert.equal(isDevBundle('import { jsx, jsxs } from "react/jsx-runtime";'), false)
})

test('the profile packages whose client entry is a development build are named (v3.53.0: an add-on fork at f6e9158)', () => {
  const root = mkdtempSync(join(tmpdir(), 'client-bundles-'))
  try {
    write(root, {
      'dsh-addon/package.json': pkg('dsh-addon', './lib/client.js'),
      'dsh-addon/lib/client.js': 'import { jsxDEV } from "react/jsx-dev-runtime";\n',
      '@goodandready/dsh-subscriptions/package.json': pkg('@goodandready/dsh-subscriptions', './lib/client.js'),
      '@goodandready/dsh-subscriptions/lib/client.js': 'import { jsx } from "react/jsx-runtime";\n',
      // No client entry: only the server half, whatever its files say.
      'server-only/package.json': pkg('server-only'),
      'server-only/lib/client.js': 'import "react/jsx-dev-runtime";\n',
    })
    assert.deepEqual(devClientBundles(root, ['dsh-addon', '@goodandready/dsh-subscriptions', 'server-only', 'not-installed']), ['dsh-addon (./lib/client.js)'])
    write(root, { 'dsh-addon/lib/client.js': 'import { jsx } from "react/jsx-runtime";\n' })
    assert.deepEqual(devClientBundles(root, ['dsh-addon', '@goodandready/dsh-subscriptions']), [])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
