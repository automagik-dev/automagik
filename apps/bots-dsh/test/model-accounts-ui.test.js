// The provider/model/account workflow with DSH's actual React in Chromium. The
// host and login card are fakes: these checks never contact a provider or save a key.
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, readdirSync } from 'node:fs'
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
      import { NATIVE_MODEL_CSS } from './src/client/native-model-seat.js'
      import { SHELL_CSS } from './src/client/styles.js'
      const { createRoot } = window.nativeSeeds['react-dom/client']
      const models = [
        { ref:'deepseek-official/flash', provider:'deepseek-official', providerName:'DeepSeek', name:'Flash' },
        { ref:'openai/gpt', provider:'openai', providerName:'OpenAI API', name:'GPT API' },
        { ref:'acp-codex/gpt', provider:'acp-codex', providerName:'Codex', name:'GPT Codex' },
        { ref:'anthropic/sonnet', provider:'anthropic', providerName:'Anthropic API', name:'Sonnet API' },
        { ref:'acp-claude/default', provider:'acp-claude', providerName:'Claude Code', name:'Claude Code Default' },
        { ref:'custom/gpt', provider:'custom', providerName:'Company Gateway', name:'GPT Gateway' },
        { ref:'ollama/local', provider:'ollama', providerName:'Ollama', name:'Local model' },
      ]
      const methods = { 'deepseek-official':['key'], openai:['key'], 'acp-codex':['login'], anthropic:['login','key'], 'acp-claude':['login'], ollama:[] }
      const rows = models.filter(model=>model.provider!=='custom').map(model => ({ provider:model.provider, name:model.providerName, authMethods:methods[model.provider] }))
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
          methods[provider]?.includes('key') ? h('label',null,'API key',h('input',{type:'password',value:key,onChange:event=>setKey(event.target.value)})) : null,
          methods[provider]?.includes('key') ? h('button',{type:'button',onClick:()=>save('key')},'Save key') : null,
          methods[provider]?.includes('login') ? h('button',{type:'button',onClick:()=>save('login')},'Sign in') : null,
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
      style.textContent=SHELL_CSS + NATIVE_MODEL_CSS + MODEL_CSS
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
      body{font:14px sans-serif;margin:20px;background:var(--bt-main);color:var(--bt-ink)}#root{position:fixed;bottom:30px;right:20px}
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
    if (provider) await connection(page, provider).click()
  }
  const connection = (page, provider) => page.getByRole('radiogroup', { name: 'Connection', exact: true }).locator(`[role="radio"][data-provider="${provider}"]`)

  await t.test('company then connection distinguishes API models, CLI models and custom gateways', async s => {
    const page = await pageFor(s)
    await open(page, 'OpenAI', 'openai')
    assert.deepEqual(await page.getByRole('menuitemradio').allTextContents(), ['GPT API'])
    assert.match(await connection(page, 'openai').textContent(), /API key only/)
    assert.match(await connection(page, 'acp-codex').textContent(), /Sign in/)
    assert.equal(await page.getByRole('button', { name: 'Save key', exact: true }).count(), 1)
    assert.equal(await page.getByRole('button', { name: 'Sign in', exact: true }).count(), 0)
    await connection(page, 'acp-codex').click()
    assert.deepEqual(await page.getByRole('menuitemradio').allTextContents(), ['GPT Codex'])
    await page.getByRole('combobox', { name: /^Company/ }).selectOption('Anthropic · Claude')
    assert.match(await connection(page, 'anthropic').textContent(), /Sign in or API key/)
    await connection(page, 'acp-claude').click()
    assert.deepEqual(await page.getByRole('menuitemradio').allTextContents(), ['Claude Code Default'])
    await page.getByRole('combobox', { name: /^Company/ }).selectOption('Company Gateway')
    assert.equal(await page.getByRole('button', { name: 'Save key', exact: true }).count(), 1)
    assert.equal(await page.getByRole('button', { name: 'Sign in', exact: true }).count(), 0)
    assert.deepEqual(await page.getByRole('menuitemradio').allTextContents(), ['GPT Gateway'])
    await page.getByRole('combobox', { name: /^Company/ }).selectOption('New Provider')
    assert.match(await page.getByRole('dialog').textContent(), /Set up this provider in Models and providers/)
    assert.equal(await page.getByRole('group', { name: 'Provider settings', exact: true }).count(), 1)
    await page.getByRole('combobox', { name: 'Company', exact: true }).selectOption('Ollama')
    assert.equal(await page.getByRole('group', { name: 'No account needed', exact: true }).count(), 1)
    assert.equal(await page.getByRole('button', { name: 'Sign in', exact: true }).count(), 0)
    assert.deepEqual(await page.evaluate(() => window.evidence.mutations), [])
    assert.deepEqual(await page.evaluate(() => window.evidence.auth), [])
  })

  await t.test('a connection supporting both methods is in the sign-in group and offers both explicitly', async s => {
    const page = await pageFor(s)
    await open(page, 'Anthropic · Claude', 'anthropic')
    const group = page.getByRole('group', { name: 'Sign in', exact: true })
    assert.equal(await group.getByRole('radio').count(), 2)
    assert.equal(await page.getByRole('group', { name: 'API key only', exact: true }).count(), 0)
    await page.getByRole('button', { name: 'Sign in or use an API key', exact: true }).click()
    const setup = page.getByRole('region', { name: 'Connect account' })
    await setup.waitFor()
    assert.equal(await setup.getByRole('button', { name: 'Save key', exact: true }).count(), 1)
    assert.equal(await setup.getByRole('button', { name: 'Sign in', exact: true }).count(), 1)
    assert.deepEqual(await page.evaluate(() => window.evidence.auth), [])
  })

  await t.test('connection radios support arrow, Home and End navigation without changing the model', async s => {
    const page = await pageFor(s)
    await open(page, 'OpenAI', 'openai')
    await connection(page, 'openai').focus()
    await page.keyboard.press('ArrowUp')
    assert.equal(await connection(page, 'acp-codex').getAttribute('aria-checked'), 'true')
    assert.equal(await page.locator(':focus').getAttribute('data-provider'), 'acp-codex')
    assert.equal(await connection(page, 'openai').getAttribute('tabindex'), '-1')
    await page.keyboard.press('End')
    assert.equal(await connection(page, 'openai').getAttribute('aria-checked'), 'true')
    await page.keyboard.press('Home')
    assert.equal(await connection(page, 'acp-codex').getAttribute('aria-checked'), 'true')
    await page.keyboard.press('ArrowDown')
    assert.equal(await connection(page, 'openai').getAttribute('aria-checked'), 'true')
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
      await page.getByRole('button', { name: method, exact: true }).click()
      const setup = page.getByRole('region', { name: 'Connect account' })
      await setup.waitFor()
      if (method === 'Save key') assert.equal(await setup.locator('input').getAttribute('type'), 'password')
      else assert.equal(await setup.locator('input').count(), 0, 'CLI sign-in never suggests an API key')
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

  for (const theme of ['light', 'dark']) {
    await t.test(`${theme} theme keeps selected routes and focused controls legible`, async s => {
      const page = await pageFor(s)
      await page.evaluate(dark => {
        document.body.toggleAttribute('data-ds-dark-theme', dark)
        window.evidence.ready.push('openai')
      }, theme === 'dark')
      await open(page, 'OpenAI', 'openai')
      await page.getByRole('menuitemradio', { name: 'GPT API', exact: true }).click()
      await page.getByRole('dialog').waitFor({ state: 'detached' })
      await open(page, 'OpenAI')
      await page.keyboard.press('Tab')
      const active = page.locator(':focus')
      assert.equal(await active.getAttribute('role'), 'radio')
      assert.equal(await active.getAttribute('aria-checked'), 'true')
      const company = page.getByRole('combobox', { name: 'Company', exact: true })
      assert.equal(await company.evaluate(element => getComputedStyle(element).colorScheme), theme)
      const ratios = await page.getByRole('dialog').evaluate(dialog => {
        const canvas = document.createElement('canvas')
        canvas.width = canvas.height = 1
        const context = canvas.getContext('2d', { willReadFrequently: true })
        const rgba = value => {
          context.clearRect(0, 0, 1, 1)
          context.fillStyle = value
          context.fillRect(0, 0, 1, 1)
          const color = [...context.getImageData(0, 0, 1, 1).data]
          color[3] /= 255
          return color
        }
        const composite = (front, back) => front.slice(0, 3).map((channel, i) => channel * front[3] + back[i] * (1 - front[3]))
        const background = element => {
          const ancestors = []
          for (let node = element; node; node = node.parentElement) ancestors.unshift(node)
          return ancestors.reduce((color, node) => composite(rgba(getComputedStyle(node).backgroundColor), color), [255, 255, 255])
        }
        const luminance = color => color.slice(0, 3).map(channel => {
          const value = channel / 255
          return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4
        }).reduce((sum, value, i) => sum + value * [.2126, .7152, .0722][i], 0)
        const contrast = (first, second) => {
          const a = luminance(first)
          const b = luminance(second)
          return (Math.max(a, b) + .05) / (Math.min(a, b) + .05)
        }
        const results = [...dialog.querySelectorAll('select,option,.bt-model-connection-name,.bt-model-connection-method,.bt-model-connection-heading,.bt-menu-label,.bt-model-group')].map(element => {
          const bg = background(element)
          return { text: element.textContent.trim(), ratio: contrast(composite(rgba(getComputedStyle(element).color), bg), bg) }
        })
        const focused = document.activeElement
        const focusStyle = getComputedStyle(focused)
        return {
          text: results,
          focusWidth: parseFloat(focusStyle.outlineWidth),
          focus: contrast(rgba(focusStyle.outlineColor), background(focused.parentElement)),
        }
      })
      for (const { text, ratio } of ratios.text) assert.ok(ratio >= 4.5, `${theme}: ${text} text contrast ${ratio.toFixed(2)} must reach 4.5`)
      assert.ok(ratios.focusWidth >= 2, `${theme}: keyboard focus has a visible outline`)
      assert.ok(ratios.focus >= 3, `${theme}: focus contrast ${ratios.focus.toFixed(2)} must reach 3`)
      s.diagnostic(`${theme}: minimum text contrast ${Math.min(...ratios.text.map(row => row.ratio)).toFixed(2)}:1; focus ${ratios.focus.toFixed(2)}:1`)
      const folder = process.env.MODEL_PICKER_EVIDENCE_DIR
      if (folder) {
        mkdirSync(folder, { recursive: true })
        await page.getByRole('dialog').screenshot({ path: join(folder, `${theme}-selected-focused.png`) })
      }
    })
  }
})
