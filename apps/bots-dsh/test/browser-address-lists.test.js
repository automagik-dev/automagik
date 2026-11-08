// The address lists on the real tool paths. The default is empty: localhost, LAN and
// tailnet targets open. A deny entry refuses; a non-empty allow list limits; deny wins.
// The Bot browser host is real (openBotBrowser -> createSession, its main-frame route and
// its saved-tab filter); only Playwright itself is the fake fixture.
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'
import {
  apply as applyToolExecutor,
  inject as toolExecutorInject,
} from '@deepseek-ai/dsh-tool-executor-native'
import { mountBrowserPlugin } from '../src/host/browser/mount.js'
import { toolDefs as refsTools } from '../src/host/browser/refs.js'
import { toolDefs as scriptTools } from '../src/host/browser/script.js'
import { decideAddress } from '../src/host/browser/address-policy.js'
import { browserAddress, blockedAddress } from '../src/client/bot-browsers.js'
import { contexts } from './fixtures/fake-playwright.mjs'

const FAKE_PLAYWRIGHT = new URL('./fixtures/fake-playwright.mjs', import.meta.url).href
const TOOL_NAMES = ['browser_open', 'browser_back', 'browser_tabs', 'browser_exec']

const runTool = (ctx, name, args = {}) => ctx.tools.execute({
  signal: new AbortController().signal,
  calls: [{ type: 'tool-call', id: ToolCallId(name), name, arguments: JSON.stringify(args) }],
}).then(batch => batch.results[0].result)

async function harness({ lists = { allow: [], deny: [] }, botId = 'bot-1', tabs } = {}) {
  contexts.length = 0
  const home = mkdtempSync(join(tmpdir(), 'ds-bot-address-'))
  if (tabs !== undefined) {
    mkdirSync(join(home, botId), { recursive: true })
    writeFileSync(join(home, botId, 'tabs.json'), JSON.stringify(tabs))
  }
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin({ apply: applyToolExecutor, inject: toolExecutorInject })
  const policy = {
    check: (url, action = 'open') =>
      decideAddress(url, { allow: lists.allow, deny: lists.deny, action }),
  }
  const plugin = inner => {
    mountBrowserPlugin(inner, {
      toolDefs: [...refsTools, ...scriptTools].filter(tool => TOOL_NAMES.includes(tool.name)),
      defineTool,
      keyOf: async () => botId,
      profileRoot: home,
      headless: true,
      playwrightUrl: FAKE_PLAYWRIGHT,
      executablePath: '/fake/chrome',
      addressPolicy: policy,
    })
  }
  plugin.inject = ['tools']
  await ctx.plugin(plugin)
  return {
    lists,
    run: (name, args) => runTool(ctx, name, args),
    page: () => contexts.at(-1)?.pages()[0],
    async close() {
      await ctx.fiber.dispose()
      rmSync(home, { recursive: true, force: true })
    },
  }
}

test('the default opens localhost, LAN and tailnet on the real browser_open path', async t => {
  const h = await harness()
  t.after(h.close)
  for (const url of [
    'http://127.0.0.1:41234/',
    'http://192.168.1.10/',
    'http://100.100.100.100/',
    'http://[fd7a:115c:a1e0::1]/',
    'http://localhost:3000/',
  ]) {
    const result = await h.run('browser_open', { url })
    assert.equal(result.isError, false, `${url}: ${result.error?.message}`)
  }
})

test('a denied address is refused with clear text and the page never opens', async t => {
  const h = await harness({ lists: { allow: [], deny: ['127.0.0.0/8'] } })
  t.after(h.close)
  const result = await h.run('browser_open', { url: 'http://127.0.0.1:41234/' })
  assert.equal(result.isError, true)
  assert.match(result.error.message, /denied by this profile's address list/u)
  assert.match(result.error.message, /127\.0\.0\.0\/8/u)
  assert.match(result.error.message, /A Bot cannot open it/u)
  assert.equal(h.page().url(), 'about:blank')
})

test('deny wins over allow, while a narrower deny closes only its target', async t => {
  const h = await harness({ lists: { allow: ['127.0.0.0/8'], deny: ['127.0.0.1'] } })
  t.after(h.close)
  const denied = await h.run('browser_open', { url: 'http://127.0.0.1:1/' })
  assert.equal(denied.isError, true)
  assert.match(denied.error.message, /denied by this profile's address list/u)
  const allowed = await h.run('browser_open', { url: 'http://127.0.0.2:1/' })
  assert.equal(allowed.isError, false, allowed.error?.message)
})

test('a non-empty allow list limits browsing; an empty one allows the rest', async t => {
  const h = await harness({ lists: { allow: ['10.0.0.0/8'], deny: [] } })
  t.after(h.close)
  const allowed = await h.run('browser_open', { url: 'http://10.1.2.3/' })
  assert.equal(allowed.isError, false, allowed.error?.message)
  const refused = await h.run('browser_open', { url: 'http://192.168.1.10/' })
  assert.equal(refused.isError, true)
  assert.match(refused.error.message, /not on this profile's allow list/u)
})

test('hostnames match by name and by every address they resolve to', async t => {
  const byName = await harness({ lists: { allow: [], deny: ['localhost', '*.internal.example'] } })
  t.after(byName.close)
  for (const url of ['http://localhost:3000/', 'http://foo.internal.example/']) {
    const result = await byName.run('browser_open', { url })
    assert.equal(result.isError, true, url)
    assert.match(result.error.message, /denied by this profile's address list/u)
  }
  const byAddress = await harness({ lists: { allow: [], deny: ['127.0.0.0/8'] } })
  t.after(byAddress.close)
  const result = await byAddress.run('browser_open', { url: 'http://localhost:3000/' })
  assert.equal(result.isError, true)
  assert.match(result.error.message, /127\.0\.0\.1/u)
})

test('browser_exec goto uses the same host guard', async t => {
  const h = await harness({ lists: { allow: [], deny: ['127.0.0.1'] } })
  t.after(h.close)
  const result = await h.run('browser_exec', {
    script: "await goto('http://127.0.0.1:1/'); done('opened')",
  })
  assert.equal(result.isError, true)
  assert.match(result.error.message, /denied by this profile's address list/u)
})

test('a redirect to a denied address is refused', async t => {
  const h = await harness({ lists: { allow: [], deny: ['127.0.0.1'] } })
  t.after(h.close)
  // The context is created by the first browser call, which also installs the route.
  const first = await h.run('browser_open', { url: 'http://10.1.1.1/' })
  assert.equal(first.isError, false, first.error?.message)
  contexts.at(-1).redirects.set('http://public.test/', 'http://127.0.0.1:1/')
  const result = await h.run('browser_open', { url: 'http://public.test/' })
  assert.equal(result.isError, true)
  assert.match(result.error.message, /denied by this profile's address list/u)
})

test('browser_back to a denied page is refused', async t => {
  const h = await harness({ lists: { allow: [], deny: [] } })
  t.after(h.close)
  await h.run('browser_open', { url: 'http://10.1.1.1/' })
  h.lists.deny.push('127.0.0.1')
  h.page().backTo = 'http://127.0.0.1:1/'
  const result = await h.run('browser_back', {})
  assert.equal(result.isError, true)
  assert.match(result.error.message, /denied by this profile's address list/u)
})

test('a saved denied tab is dropped on restore', async t => {
  const h = await harness({
    lists: { allow: [], deny: ['127.0.0.1'] },
    tabs: {
      tabs: [
        { url: 'http://127.0.0.1:1/', title: 'private' },
        { url: 'http://10.1.1.1/', title: 'public' },
      ],
      active: 0,
    },
  })
  t.after(h.close)
  const open = await h.run('browser_open', { url: 'http://10.1.1.1/' })
  assert.equal(open.isError, false, open.error?.message)
  const tabs = await h.run('browser_tabs', { action: 'list' })
  assert.equal(tabs.isError, false, tabs.error?.message)
  assert.doesNotMatch(tabs.value, /127\.0\.0\.1/u)
})

test('a bot profile and a channel profile each use their own lists', async t => {
  const bot = await harness({ botId: 'bot-1', lists: { allow: [], deny: [] } })
  t.after(bot.close)
  const channel = await harness({ botId: 'channel-bot', lists: { allow: [], deny: ['127.0.0.1'] } })
  t.after(channel.close)
  const botOpen = await bot.run('browser_open', { url: 'http://127.0.0.1:1/' })
  assert.equal(botOpen.isError, false, botOpen.error?.message)
  const channelOpen = await channel.run('browser_open', { url: 'http://127.0.0.1:1/' })
  assert.equal(channelOpen.isError, true)
  assert.match(channelOpen.error.message, /denied by this profile's address list/u)
})

test('the person\'s own browser path still opens local and LAN addresses', () => {
  assert.equal(browserAddress('127.0.0.1:3000'), 'http://127.0.0.1:3000/')
  assert.equal(browserAddress('192.168.1.10/admin'), 'http://192.168.1.10/admin')
  assert.equal(blockedAddress('http://127.0.0.1:3000/'), false)
  assert.equal(blockedAddress('http://192.168.1.10/'), false)
  assert.equal(blockedAddress('http://169.254.169.254/'), true)
})
