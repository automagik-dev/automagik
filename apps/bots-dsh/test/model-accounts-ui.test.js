// The provider/model/account workflow with DSH's actual React in Chromium. The
// host and login card are fakes: these checks never contact a provider or save a key.
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { build } from 'esbuild'
import { browserGuard } from './browser-guard.js'

const plugin = dirname(dirname(fileURLToPath(import.meta.url)))
const harness = process.env.DSH_HARNESS ?? join(plugin, 'dev/harness')
const assets = join(harness, 'node_modules/@deepseek-ai/dsh-web-frontend/dist/assets')
const frontend = readFileSync(join(assets, readdirSync(assets).find(name => /^index-.*\.js$/.test(name))), 'utf8')
const seed = /function (\w+)\(\)\{return\{react:[\s\S]*?\}\}/.exec(frontend)
assert.ok(seed, 'the supported Harness provides its published React module seeds')
const seedsBuild = await build({
  stdin: { contents: `${frontend.slice(0, seed.index + seed[0].length)}; window.nativeSeeds = ${seed[1]}();`, resolveDir: assets },
  bundle: true, format: 'iife', platform: 'browser', write: false, logLevel: 'silent',
})

const fixture = await build({
  stdin: {
    resolveDir: plugin,
    contents: `
      import { createElement as h, useState, useMemo } from 'react'
      import { ModelMenu, MODEL_CSS } from './src/client/model-menu.js'
      const { createRoot } = window.nativeSeeds['react-dom/client']
      const models = [
        { ref:'deepseek-official/flash', provider:'deepseek-official', providerName:'DeepSeek', name:'Flash' },
        { ref:'openai/gpt', provider:'openai', providerName:'OpenAI API', name:'GPT API' },
        { ref:'acp-codex/gpt', provider:'acp-codex', providerName:'Codex', name:'GPT Codex' },
        { ref:'anthropic/sonnet', provider:'anthropic', providerName:'Anthropic API', name:'Sonnet API' },
        { ref:'acp-claude/default', provider:'acp-claude', providerName:'Claude Code', name:'Claude Code Default' },
        { ref:'custom/gpt', provider:'custom', providerName:'Company Gateway', name:'GPT Gateway' },
      ]
      const rows = models.map(model => ({ provider:model.provider, name:model.providerName }))
      window.evidence = { model:models[0].ref, checks:[], mutations:[], refreshes:0, auth:[], keyWrites:[], ready:[], hold:false }
      function Setup({provider,onConnected,onClose}) {
        const [key,setKey] = useState('')
        const save = async method => {
          window.evidence.auth.push({provider,method})
          window.evidence.ready.push(provider)
          setKey('')
          await onConnected()
        }
        return h('section',{'aria-label':'Connect account'},
          h('span',null,provider),
          h('label',null,'API key',h('input',{type:'password',value:key,onChange:event=>setKey(event.target.value)})),
          h('button',{type:'button',onClick:()=>save('key')},'Save key'),
          h('button',{type:'button',onClick:()=>save('login')},'Sign in'),
          h('button',{type:'button',onClick:onClose},'Cancel'))
      }
      function App() {
        const [model,setModel] = useState(models[0].ref)
        const [locked,setLocked] = useState(false)
        window.setLocked = setLocked
        const actions = useMemo(()=>({
          refreshModels:async()=>{ window.evidence.refreshes++ },
          modelProviders:async()=>({providers:[{id:'custom',name:'Company Gateway',key:{configured:false,writable:true}}],addable:[{id:'new-provider',name:'New Provider'}]}),
          modelAccountEntries:()=>[{component:Object.assign(Setup,{accounts:{providers:async()=>rows,matches:provider=>provider!=='custom' && rows.some(row=>row.provider===provider)}}),options:{id:'test-accounts'}}],
          setProviderKey:async(provider,value)=>{
            if(value!=='fake-custom-key') throw new Error('unexpected test credential')
            window.evidence.keyWrites.push(provider)
            window.evidence.ready.push(provider)
          },
          modelAccess:async ref=>{
            window.evidence.checks.push(ref)
            if(window.evidence.hold) await new Promise(resolve=>{window.releaseCheck=resolve})
            const provider=ref.split('/')[0]
            if(!window.evidence.ready.includes(provider)) return {ready:false,provider,status:'missing-key',message:'Save a key or sign in before using this model.'}
            return {ready:true,provider,status:'ready'}
          },
          updateBot:async(id,patch)=>{
            window.evidence.mutations.push({id,...patch})
            window.evidence.model=patch.model
            setModel(patch.model)
          },
        }),[])
        return h(ModelMenu,{bot:{id:'bot',name:'Test Bot',model},roster:{models},actions,disabled:locked})
      }
      const style=document.createElement('style')
      style.textContent=MODEL_CSS
      document.head.appendChild(style)
      createRoot(document.getElementById('root')).render(h(App))
    `,
  },
  bundle: true, format: 'iife', platform: 'browser', write: false, logLevel: 'silent',
  external: ['react', 'react-dom', '@deepseek-ai/dsh-client-ui-primitives'],
})

test('conversation model and account workflow preserves the chosen route until an allowed selection', async t => {
  const guard = await browserGuard()
  if (guard.skip) return t.skip(guard.skip)
  const browser = await guard.chromium.launch({ executablePath: guard.executablePath, headless: true })
  t.after(() => browser.close())
  async function pageFor(subtest) {
    const page = await browser.newPage({ viewport: { width: 900, height: 700 } })
    subtest.after(() => page.close())
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    subtest.after(() => assert.deepEqual(errors, [], 'the slot renders without browser errors'))
    await page.route('**/*', route => route.abort())
    await page.setContent(`<style>
      :root{--bt-ink:#24212f;--bt-ink-2:#575265;--bt-ink-3:#797287;--bt-line:#ddd;--bt-main:#fff;--bt-surface:#fff;--bt-hover:#f0edf4;--bt-active:#ddd;--bt-accent:#4455ff;--bt-danger:#a20}
      body{font:14px sans-serif;margin:20px}#root{position:fixed;bottom:30px;right:20px}
      .bt-menu{position:fixed;display:flex;flex-direction:column;gap:2px;background:white;border:1px solid #ccc;border-radius:10px}
      .bt-menu button{display:flex;align-items:center;width:100%;min-height:30px;border:0;border-radius:5px;padding:6px;text-align:left;background:transparent;color:inherit}
      .bt-menu button:hover{background:#f0edf4}.bt-menu-label{flex:1}
    </style><button id="outside">Outside</button><div id="root"></div>`)
    await page.addScriptTag({ content: seedsBuild.outputFiles[0].text })
    await page.addScriptTag({ content: "window.require = name => window.nativeSeeds[name] ?? {};" })
    await page.addScriptTag({ content: fixture.outputFiles[0].text })
    await page.getByRole('button', { name: 'Model: Flash', exact: true }).waitFor()
    return page
  }
  async function open(page, company = 'OpenAI', provider) {
    await page.getByRole('button', { name: /^Model:/ }).click()
    await page.getByRole('combobox', { name: 'Company', exact: true }).waitFor()
    assert.equal(await page.locator(':focus').getAttribute('aria-label'), 'Company', 'opening focuses the company selector')
    await page.getByRole('combobox', { name: /^Company/ }).selectOption(company)
    if (provider) await page.getByRole('combobox', { name: /^Connection/ }).selectOption(provider)
  }

  await t.test('company then connection distinguishes API models, CLI models and custom gateways', async s => {
    const page = await pageFor(s)
    await open(page, 'OpenAI', 'openai')
    assert.deepEqual(await page.getByRole('menuitemradio').allTextContents(), ['GPT API'])
    await page.getByRole('combobox', { name: /^Connection/ }).selectOption('acp-codex')
    assert.deepEqual(await page.getByRole('menuitemradio').allTextContents(), ['GPT Codex'])
    await page.getByRole('combobox', { name: /^Company/ }).selectOption('Anthropic · Claude')
    await page.getByRole('combobox', { name: /^Connection/ }).selectOption('acp-claude')
    assert.deepEqual(await page.getByRole('menuitemradio').allTextContents(), ['Claude Code Default'])
    await page.getByRole('combobox', { name: /^Company/ }).selectOption('Company Gateway')
    assert.equal(await page.getByRole('combobox', { name: /^Connection/ }).count(), 0)
    assert.deepEqual(await page.getByRole('menuitemradio').allTextContents(), ['GPT Gateway'])
    await page.getByRole('combobox', { name: /^Company/ }).selectOption('New Provider')
    assert.match(await page.getByRole('dialog').textContent(), /Connect this account to load its models/)
    assert.deepEqual(await page.evaluate(() => window.evidence.mutations), [])
    assert.deepEqual(await page.evaluate(() => window.evidence.auth), [])
  })

  await t.test('missing credentials leaves the prior model selected and gives an inline reason', async s => {
    const page = await pageFor(s)
    await open(page, 'OpenAI', 'openai')
    await page.getByRole('menuitemradio', { name: 'GPT API', exact: true }).click()
    await page.getByRole('alert').waitFor()
    assert.match(await page.getByRole('alert').textContent(), /Save a key or sign in.*previous model is unchanged/)
    assert.equal(await page.getByRole('dialog').count(), 1)
    assert.equal(await page.getByRole('button', { name: 'Model: Flash', exact: true }).count(), 1)
    assert.deepEqual(await page.evaluate(() => window.evidence.mutations), [])
    await page.getByRole('combobox', { name: /^Company/ }).selectOption('DeepSeek')
    assert.equal(await page.getByRole('menuitemradio', { name: 'Flash', exact: true }).getAttribute('aria-checked'), 'true')
  })

  for (const [provider, method, model] of [['openai', 'Save key', 'GPT API'], ['acp-codex', 'Sign in', 'GPT Codex']]) {
    await t.test(`${method} stays inside the chat; success refreshes without switching the model`, async s => {
      const page = await pageFor(s)
      await open(page, 'OpenAI', provider)
      await page.getByRole('button', { name: 'Save key or sign in', exact: true }).click()
      const setup = page.getByRole('region', { name: 'Connect account' })
      await setup.waitFor()
      assert.equal(await setup.locator('input').getAttribute('type'), 'password')
      assert.deepEqual(await page.evaluate(() => window.evidence.auth), [], 'opening does not start authentication')
      if (method === 'Save key') await setup.getByLabel('API key', { exact: true }).fill('fake-test-key')
      await setup.getByRole('button', { name: method, exact: true }).click()
      await setup.waitFor({ state: 'detached' })
      assert.deepEqual(await page.evaluate(() => window.evidence.auth), [{ provider, method: method === 'Save key' ? 'key' : 'login' }])
      assert.deepEqual(await page.evaluate(() => window.evidence.mutations), [])
      assert.equal(await page.evaluate(() => window.evidence.model), 'deepseek-official/flash')
      assert.ok(await page.evaluate(() => window.evidence.refreshes >= 2))
      await page.getByRole('menuitemradio', { name: model, exact: true }).click()
      await page.waitForFunction(() => window.evidence.mutations.length === 1)
      assert.equal(await page.evaluate(() => window.evidence.model), `${provider}/gpt`)
      await page.getByRole('dialog').waitFor({ state: 'detached' })
    })
  }

  await t.test('a custom provider uses its writable key reference without requiring a Welcome login card', async s => {
    const page = await pageFor(s)
    await open(page, 'Company Gateway')
    await page.getByRole('button', { name: 'Save key', exact: true }).click()
    const form = page.locator('.bt-model-key-form')
    await form.waitFor()
    const input = form.getByLabel('API key', { exact: true })
    assert.ok(await input.evaluate(element => element.type === 'password' || element.hasAttribute('data-masked')), 'credential input is masked')
    await input.fill('fake-custom-key')
    await input.press('Enter')
    await form.waitFor({ state: 'detached' })
    assert.deepEqual(await page.evaluate(() => window.evidence.keyWrites), ['custom'])
    assert.deepEqual(await page.evaluate(() => window.evidence.auth), [])
    assert.deepEqual(await page.evaluate(() => window.evidence.mutations), [])
    assert.equal(await page.evaluate(() => window.evidence.model), 'deepseek-official/flash')
    assert.equal(await page.locator('body').getByText('fake-custom-key', { exact: true }).count(), 0)
    await page.getByRole('menuitemradio', { name: 'GPT Gateway', exact: true }).click()
    await page.waitForFunction(() => window.evidence.mutations.length === 1)
    assert.equal(await page.evaluate(() => window.evidence.model), 'custom/gpt')
  })

  await t.test('rapid repeated choices wait for one preflight and one model write', async s => {
    const page = await pageFor(s)
    await page.evaluate(() => { window.evidence.ready.push('openai'); window.evidence.hold = true })
    await open(page, 'OpenAI', 'openai')
    const row = page.getByRole('menuitemradio', { name: 'GPT API', exact: true })
    await row.evaluate(button => { button.click(); button.click() })
    await page.waitForFunction(() => typeof window.releaseCheck === 'function')
    assert.equal(await row.isDisabled(), true)
    assert.deepEqual(await page.evaluate(() => window.evidence.checks), ['openai/gpt'])
    assert.deepEqual(await page.evaluate(() => window.evidence.mutations), [])
    assert.equal(await page.evaluate(() => window.evidence.model), 'deepseek-official/flash')
    await page.evaluate(() => window.releaseCheck())
    await page.waitForFunction(() => window.evidence.mutations.length === 1)
    assert.deepEqual(await page.evaluate(() => window.evidence.mutations), [{ id: 'bot', model: 'openai/gpt' }])
  })

  await t.test('locked composer disables the trigger; narrow windows keep the popover visible', async s => {
    const page = await pageFor(s)
    await page.evaluate(() => window.setLocked(true))
    await page.waitForFunction(() => document.querySelector('.bt-model-trigger').disabled)
    await page.getByRole('button', { name: /^Model:/ }).evaluate(button => button.click())
    assert.equal(await page.getByRole('dialog').count(), 0)
    await page.evaluate(() => window.setLocked(false))
    await page.setViewportSize({ width: 320, height: 600 })
    await open(page, 'OpenAI', 'openai')
    const box = await page.getByRole('dialog').boundingBox()
    assert.ok(box.x >= 0 && box.x + box.width <= 320, 'popover remains inside the narrow viewport')
    await page.keyboard.press('Escape')
    await page.getByRole('dialog').waitFor({ state: 'detached' })
    assert.equal(await page.locator(':focus').getAttribute('class'), 'bt-model-trigger')
  })
})
