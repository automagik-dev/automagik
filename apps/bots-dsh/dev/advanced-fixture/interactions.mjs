// Real browser interactions against the installed native frontend and linked plugin.
// No page.setContent, route.fulfill, DOM replacement or calls into private React stores.
import assert from 'node:assert/strict'

const visible = locator => locator.first().isVisible().catch(() => false)
const wait = locator => locator.first().waitFor({ state: 'visible' })
const selectedBot = (state, id) => state.bots.find(bot => bot.id === id)
const authority = bot => Object.fromEntries(['id', 'name', 'role', 'instructions', 'model', 'effort', 'kind', 'workDir', 'main', 'permission'].map(key => [key, bot[key] ?? null]))
const panel = page => page.locator('[data-sidebar-right-panel][data-sidebar-right-open]').filter({ visible: true }).first()

async function focusSnapshot(page) {
  return page.evaluate(() => {
    const node = document.activeElement, box = node?.getBoundingClientRect(), style = node && getComputedStyle(node)
    const body = node === document.body || node === document.documentElement
    const visibleControl = Boolean(node && !body && node.matches('button,input,textarea,select,a,[tabindex],[contenteditable="true"]') && !node.closest('[hidden],[aria-hidden="true"]') && style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0 && box.width > 0 && box.height > 0 && box.left >= -2 && box.top >= -2 && box.right <= innerWidth + 2 && box.bottom <= innerHeight + 2)
    return { tag: node?.tagName, name: node?.getAttribute('aria-label'), role: node?.getAttribute('role'), body, visibleControl, inNativePane: Boolean(node?.closest('[data-sidebar-right-panel][data-sidebar-right-open]')), box: box?.toJSON(), visibility: style?.visibility, display: style?.display }
  })
}
async function settleKeyboardPane(page, label) {
  await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))))
  try {
    await page.waitForFunction(() => {
      const toggle = [...document.querySelectorAll('[data-sidebar-right-panel][data-sidebar-right-open] [data-sidebar-right-toggle]')].find(node => node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden')
      if (!toggle) return false
      const box = toggle.getBoundingClientRect()
      const settled = document.getAnimations().every(animation => !animation.effect?.target?.closest?.('[data-sidebar-right-panel]') || animation.effect.getTiming().iterations === Infinity || animation.playState !== 'running')
      return settled && box.width > 0 && box.height > 0 && box.left >= -2 && box.top >= -2 && box.right <= innerWidth + 2 && box.bottom <= innerHeight + 2
    }, undefined, { polling: 'raf', timeout: 2000 })
  } catch (error) {
    console.log('native-keyboard-settle-failure', JSON.stringify({ label, focus: await focusSnapshot(page), toggles: await page.locator('[data-sidebar-right-toggle]').evaluateAll(nodes => nodes.map(node => ({ box: node.getBoundingClientRect().toJSON(), visibility: getComputedStyle(node).visibility }))) }))
    throw error
  }
}
async function keyboardCollapseSample(page, until, label) {
  await settleKeyboardPane(page, `${label}: before collapse`)
  const toggle = panel(page).locator('[data-sidebar-right-toggle]').first()
  await toggle.focus()
  try {
    await page.waitForFunction(() => {
      const node = document.activeElement, box = node?.getBoundingClientRect()
      return node?.matches('[data-sidebar-right-toggle]') && node.closest('[data-sidebar-right-panel][data-sidebar-right-open]') && getComputedStyle(node).visibility !== 'hidden' && box.width > 0 && box.height > 0 && box.left >= -2 && box.top >= -2 && box.right <= innerWidth + 2 && box.bottom <= innerHeight + 2
    }, undefined, { polling: 'raf', timeout: 2000 })
  } catch (error) { console.log('native-keyboard-start-focus-failure', JSON.stringify({ label, focus: await focusSnapshot(page), target: await toggle.boundingBox() })); throw error }
  assert.equal(await toggle.evaluate(node => document.activeElement === node) && (await focusSnapshot(page)).visibleControl, true, `${label}: keyboard starts on exact fully visible native collapse control`)
  await page.keyboard.press('Enter')
  await until(`${label}: keyboard collapses native pane`, async () => await panel(page).count() === 0, 2000)
  await page.waitForFunction(() => document.getAnimations().every(animation => !animation.effect?.target?.closest?.('[data-sidebar-right-panel]') || animation.effect.getTiming().iterations === Infinity || animation.playState !== 'running'), undefined, { polling: 'raf', timeout: 2000 })
  await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))))
  const automatic = await focusSnapshot(page)
  await page.keyboard.press('Tab')
  await page.evaluate(() => new Promise(done => requestAnimationFrame(done)))
  const recovery = await focusSnapshot(page)
  // Pinned web:macos sidebar.right.toggle default is primary+shift+KeyB.
  await page.keyboard.press('Meta+Shift+B')
  await until(`${label}: native keyboard shortcut reopens sidebar`, async () => await panel(page).count() === 1, 2000)
  await settleKeyboardPane(page, `${label}: after keyboard reopen`)
  const reopened = await focusSnapshot(page)
  if (!reopened.visibleControl || !reopened.inNativePane) console.log('native-keyboard-reopen-focus-failure', JSON.stringify({ label, reopened }))
  assert.equal(reopened.visibleControl && reopened.inNativePane, true, `${label}: native keyboard reopen focuses a fully visible usable pane`)
  await page.keyboard.press('Meta+Shift+B')
  await until(`${label}: native keyboard cleanup collapses sidebar`, async () => await panel(page).count() === 0, 2000)
  const sample = { label, automatic, recovery, reopened }
  console.log('native-keyboard-collapse-focus', JSON.stringify(sample))
  return sample
}

async function dismissNotices(page) {
  const skip = page.getByRole('button', { name: 'Skip for now', exact: true })
  await page.addLocatorHandler(skip, () => skip.click())
  const notice = page.getByRole('dialog').getByRole('button', { name: 'Continue', exact: true, disabled: false })
  await page.addLocatorHandler(notice, () => notice.click())
}
async function closeDetails(page) {
  for (const label of ['Close settings', 'Close details']) {
    const close = page.getByRole('button', { name: label, exact: true }).first()
    if (await visible(close)) {
      await close.click()
      await close.waitFor({ state: 'hidden' })
    }
  }
}
async function openBot(page, id) {
  await closeDetails(page)
  await page.locator(`.bt-row[data-bot-id="${id}"]`).first().click()
  const simple = page.getByRole('button', { name: 'View conversation details', exact: true })
  const native = page.getByRole('button', { name: 'Bot settings', exact: true })
  await wait(simple.or(native))
}
async function settings(page) {
  const native = page.getByRole('button', { name: 'Bot settings', exact: true })
  if (await visible(native)) await native.first().click()
  else {
    await page.getByRole('button', { name: 'View conversation details', exact: true }).first().click()
    await page.locator('.bt-panel [data-info-row="settings"]').click()
  }
  const form = page.locator('.bt-panel .bt-bs:visible, .bt-settings .bt-bs:visible').first()
  await wait(form.getByRole('switch', { name: 'Advanced Bot', exact: true }))
  return form
}
async function assertNoHorizontalOverflow(page, check, label) {
  check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), `${label}: no horizontal page overflow`)
}
async function checkHeader(page, check, label) {
  const collapse = page.locator('[data-sidebar-right-open] [data-sidebar-right-toggle]:visible').first()
  if (await visible(collapse)) await collapse.click()
  const corner = page.locator('[data-conversation-header-corner]:visible').first()
  await wait(corner)
  const box = await corner.boundingBox()
  check(box && box.x >= 0 && box.x + box.width <= page.viewportSize().width + 2, `${label}: actual native header corner stays in frame`)
  const nativeTabs = page.locator('[data-conversation-tabs]:visible')
  await wait(nativeTabs)
  const tabs = nativeTabs.getByRole('tab')
  console.log('native-header-diagnostic', JSON.stringify({ label, tabs: await tabs.allTextContents(), buttons: await page.locator('header button:visible').evaluateAll(nodes => nodes.map(node => ({ name: node.getAttribute('aria-label'), text: node.textContent }))) }))
  const chat = nativeTabs.getByRole('tab', { name: 'Chat', exact: true })
  check(await chat.count() === 1, `${label}: native Chat tab retained`)
  const probe = nativeTabs.getByRole('tab', { name: 'Fixture view', exact: true })
  await page.getByRole('button', { name: 'More conversation views', exact: true }).click()
  await wait(page.getByRole('menu'))
  console.log('native-more-views-diagnostic', JSON.stringify(await page.getByRole('menuitem').allTextContents()))
  check(await page.getByRole('menuitem', { name: 'Browse other plugins', exact: true }).count() === 1, `${label}: genuine native More retains plugin discovery route`)
  const entry = page.getByRole('menuitem', { name: 'Fixture view', exact: true })
  if (await entry.count() === 1) {
    await entry.click()
    check(true, `${label}: actual native More selects the loaded overflowed plugin view`)
  } else {
    check(await visible(probe), `${label}: plugin view is directly visible when not overflowed`)
    await page.keyboard.press('Escape')
    await probe.click()
  }
  await wait(page.getByRole('region', { name: 'Fixture plugin view', exact: true }))
  check(true, `${label}: native registry opens actual plugin view body (direct or overflow)`)
  await chat.click()
  check(await chat.getAttribute('aria-selected') === 'true', `${label}: native view returns to chat`)
  const action = page.getByRole('button', { name: 'Fixture header action', exact: true })
  check(await action.count() === 1 && await visible(action), `${label}: registered third-party action is present in actual native header`)
  const before = Number((await action.innerText()).match(/\d+/)?.[0])
  await action.click()
  check(await action.innerText() === `Probe ${before + 1}`, `${label}: native header retains third-party child controls`)
}
async function checkLive(page, check, label) {
  await page.getByRole('button', { name: 'Open Live', exact: true }).first().click()
  const live = page.locator('[data-sidebar-right-panel][data-sidebar-right-open] .bt-live:visible')
  await wait(live)
  check(await live.count() === 1, `${label}: exactly one Live body in genuine native sidebar`)
  check(await live.evaluate(element => getComputedStyle(element).position !== 'fixed'), `${label}: Live does not own a fixed competing rail`)
  // Native panel CSS slides dock children with translateX/sidebar-width. Visibility
  // precedes settled layout; poll the SAME containment predicate on animation frames.
  try {
    await page.waitForFunction(() => {
      const node = [...document.querySelectorAll('[data-sidebar-right-panel][data-sidebar-right-open] .bt-live')].find(element => element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden')
      const parent = node?.closest('[data-sidebar-right-panel]')
      if (!node || !parent) return false
      const live = node.getBoundingClientRect(), pane = parent.getBoundingClientRect()
      return pane.width > 0 && live.width > 0 && live.x >= pane.x - 2 && live.right <= pane.right + 2
    }, undefined, { polling: 'raf', timeout: 2000 })
  } catch (error) {
    console.log('native-live-geometry-failure', JSON.stringify(await live.evaluate(node => ({
      live: node.getBoundingClientRect().toJSON(), pane: node.closest('[data-sidebar-right-panel]')?.getBoundingClientRect().toJSON(),
      animations: document.getAnimations().map(animation => ({ target: animation.effect?.target?.className, state: animation.playState, time: animation.currentTime, timing: animation.effect?.getTiming() })),
    }))))
    throw error
  }
  const box = await panel(page).boundingBox()
  const liveBox = await live.boundingBox()
  check(box?.width > 0 && liveBox?.width > 0 && liveBox.x >= box.x - 2 && liveBox.x + liveBox.width <= box.x + box.width + 2, `${label}: native pane contains settled Live geometry`)
  const nativeToggle = page.locator('[data-sidebar-right-open] [data-sidebar-right-toggle]:visible').first()
  await nativeToggle.click()
  await live.waitFor({ state: 'hidden' })
  const toggle = page.getByRole('button', { name: 'Toggle right sidebar', exact: true })
  const expand = page.locator('[data-sidebar-right-expand]:visible')
  if (await visible(toggle)) await toggle.first().click()
  else await expand.first().click()
  await wait(live)
  check(true, `${label}: native collapse and real toggle/expand restore Live`)
  await page.getByRole('button', { name: 'Open Live', exact: true }).first().click()
  check(await live.count() === 1, `${label}: repeated Open Live reuses native tab`)
}
async function send(page, { api, until, check, botId, sessionId, text, expected = `收到：${text}` }) {
  await until('Own native Session is idle before composer input', async () => { const value = await api('context-status', { botId }); return value.sessionId === sessionId && value.status === 'idle' })
  const before = await api('context-status', { botId })
  assert.equal(typeof before.counts.user, 'number')
  const conversation = page.locator(`[data-conversation-session="${sessionId}"]:visible`)
  assert.equal(await conversation.count(), 1, 'Exactly one visible conversation owns this Session')
  const composer = conversation.locator('[data-composer-seat]')
  const editor = composer.locator('[data-composer-input][contenteditable="true"]:visible')
  assert.equal(await editor.count(), 1, 'Use the actual native Lexical editor, not an arbitrary textarea')
  await editor.click()
  await editor.pressSequentially(text)
  check((await editor.innerText()).trim() === text, 'Real keyboard input populated the owned native composer')
  const submit = composer.getByRole('button', { name: 'Send message', exact: true })
  await submit.waitFor({ state: 'visible', timeout: 5000 })
  await submit.click() // Native onPrimary -> keyboard.submit; click waits for reactive draft enablement.
  await until('Native UI submission persisted the actual user event', async () => { const value = await api('context-status', { botId }); return value.sessionId === sessionId && value.counts.user > before.counts.user }, 10000)
  const submitted = conversation.getByText(text, { exact: true }).filter({ visible: true }).last()
  await until('Admitted user text rendered outside the composer', async () => await submitted.count() > 0 && await submitted.evaluate(node => node.closest('[data-composer-seat]') === null), 5000)
  check(true, 'Actual Send click admitted a durable user event and rendered its own-chat row')
  await wait(conversation.getByText(expected, { exact: false }).last())
  return conversation
}
async function setAdvanced(page, api, until, botId, on, check) {
  const before = selectedBot(await api('state'), botId)
  const form = await settings(page)
  const control = form.getByRole('switch', { name: 'Advanced Bot', exact: true })
  check(await control.getAttribute('aria-checked') === String(!on), `${before.name}: Advanced initial value before click`)
  await control.click()
  await until('Advanced persisted', async () => selectedBot(await api('state'), botId)?.advanced === on)
  const after = selectedBot(await api('state'), botId)
  assert.deepEqual(authority(after), authority(before), 'Advanced must not mutate model, identity or permissions')
  check(true, `${before.name}: Advanced click persists presentation only`)
  return form
}

export async function checkPlainInteractions({ page, check, until, seed }) {
  await dismissNotices(page)
  assert.ok(seed?.sessionId && seed.workspaceId, 'Public native fixture seed must complete before UI assertions')
  // Native host API seeded data only. This genuine workspace action selects/reuses its blank Session.
  const workspace = page.getByText('native-workspace', { exact: true }).first()
  await wait(workspace)
  await workspace.hover()
  await page.getByRole('button', { name: 'New session in native-workspace', exact: true }).click()
  // SessionView sets hidden=!active; exclude inactive resident Sessions and nested panels.
  const current = page.locator('[data-sidebar-right-session]:not([data-sidebar-right-panel]):not([hidden])')
  await until('Native UI selected the seeded Session', async () => await current.count() === 1 && await current.getAttribute('data-sidebar-right-session') === seed.sessionId)
  check(true, 'Plain native workspace action selected the exact public-API seeded Session')
  await page.locator('[data-conversation-header-corner]').first().waitFor({ state: 'attached' })
  const sessionId = await current.getAttribute('data-sidebar-right-session')
  check(sessionId === seed.sessionId, 'Plain native blank Session header retains the actual selected fixture identity')
  check(await page.locator('.bt-head,.bt-native-head,.bt-live,.bt-row').count() === 0, 'Plain DSH has no Bot-owned surface or Live tab')
  check(await page.getByRole('switch', { name: 'Advanced Bot', exact: true }).count() === 0, 'Plain DSH has no Bot Advanced control')
  await page.keyboard.press('Tab')
  check(await page.evaluate(() => document.activeElement !== document.body), 'Plain DSH keyboard navigation reaches a native control')
  await page.setViewportSize({ width: 390, height: 844 })
  await assertNoHorizontalOverflow(page, check, 'Plain narrow DSH')
  await page.locator('[data-sidebar-right-expand]:visible').click()
  await page.waitForFunction(() => document.querySelector('[data-sidebar-right-panel="fullscreen"][data-sidebar-right-open]') !== null, undefined, { polling: 'raf', timeout: 2000 })
  await wait(panel(page).locator('[data-sidebar-right-guide]'))
  const plainFocus = await keyboardCollapseSample(page, until, 'Plain native Guide 390px')
  check(plainFocus.recovery.visibleControl, 'Plain native Guide keyboard collapse, real Tab recovery and native keyboard reopen work', { focus: plainFocus })
  await page.reload()
  await wait(page.getByRole('button', { name: /New (chat|conversation|session)/i }).first())
  await current.waitFor({ state: 'attached' })
  check(await current.getAttribute('data-sidebar-right-session') === sessionId, 'Plain reload retains the actual current native Session identity')
  check(await page.locator('.bt-live,.bt-row').count() === 0, 'Plain DSH stays native after reload')
  return plainFocus
}

export async function checkBotInteractions({ page, api, check, until, probeStatus, plainFocus }) {
  await dismissNotices(page)
  await wait(page.locator('.bt-row[data-bot-id]').first())
  await until('Fixture client applied and registered both public native slots', () => { const value = probeStatus(); return value.PROBE_APPLIED > 0 && value.VIEW_REGISTERED > 0 && value.ACTION_REGISTERED > 0 }, 5000)
  console.log('fixture-probe-registration-diagnostic', JSON.stringify(probeStatus()))
  let state = await api('state')
  let main = selectedBot(state, state.mainBotId)
  assert.ok(main, 'Fresh profile has a Main Bot')
  check(main.advanced !== true, 'Fresh Main Bot Advanced defaults off')
  await openBot(page, main.id)
  // A new Main Bot needs an explicit local model selection; never synthesize provider settings.
  if (main.waiting) {
    await page.getByRole('button', { name: 'View conversation details', exact: true }).first().click()
    await page.locator('.bt-panel .bt-model-trigger').first().click()
    await page.locator('.bt-model-menu button, .bt-model-menu [role="menuitem"]').first().click()
    await until('Main Bot local model selected', async () => !selectedBot(await api('state'), main.id)?.waiting)
    await closeDetails(page)
  }
  await until('Main Bot greeting settled', async () => {
    const value = await api('context-status', { botId: main.id })
    return value.canCheckpoint
  })
  main = selectedBot(await api('state'), main.id)
  // Synthetic setup through the real host endpoint; tested Advanced mutations remain UI clicks.
  const other = await api('create-bot', { name: 'Fixture Other', role: 'Synthetic checker', model: main.model })
  state = await api('state')
  check(selectedBot(state, other.id)?.advanced !== true, 'Fresh other Bot Advanced defaults off')
  await checkLive(page, check, 'Main simple')
  await setAdvanced(page, api, until, main.id, true, check)
  await closeDetails(page)
  await checkHeader(page, check, 'Main Advanced')
  await wait(page.locator('.bt-native-note'))
  check(await page.locator('.bt-native-note').innerText().then(text => text.includes('Native compaction is unavailable')), 'Advanced explains unsupported native Bot compaction')
  await checkLive(page, check, 'Main Advanced')
  await openBot(page, other.id)
  check(await page.locator('.bt-native-note:visible').count() === 0, 'Main Advanced does not enable other Bot native controls')
  await checkLive(page, check, 'Other simple')
  await setAdvanced(page, api, until, other.id, true, check)
  await closeDetails(page)
  await checkHeader(page, check, 'Other Advanced')
  // Native selectCompactableRange retains its newest priced node even with retainTokens=0.
  // Put substantial assistant history before a final tiny turn so it is genuinely eligible.
  const ownSession = selectedBot(await api('state'), other.id).sessionId
  const sendOptions = { api, until, check, botId: other.id, sessionId: ownSession }
  const conversation = await send(page, { ...sendOptions, text: 'long 12', expected: '长文第1段' })
  await until('Long synthetic assistant history rendered', async () => (await conversation.getByText('长文第1段', { exact: false }).last().innerText()).length >= 12_000)
  check(true, 'Owned mock produced substantial synthetic assistant history')
  await send(page, { ...sendOptions, text: 'fixture accounting sample' })
  await until('Other idle', async () => (await api('context-status', { botId: other.id })).canCheckpoint)
  const history = await api('context-status', { botId: other.id })
  check(history.counts.user >= 2 && history.counts.assistant >= 3 && history.usage.tokens > 0 && history.usage.source !== 'unavailable', 'Real admitted turns and native context usage put long assistant history before the tiny latest turn', { counts: history.counts, usage: history.usage })
  let form = await settings(page)
  const ratio = form.getByRole('spinbutton', { name: 'Check at (% usable window)', exact: true })
  const carry = form.getByRole('spinbutton', { name: 'Recent-message carry budget', exact: true })
  await ratio.fill('75')
  await ratio.press('Tab')
  await carry.fill('8192')
  await carry.press('Tab')
  await until('Context policy persisted', async () => {
    const value = selectedBot(await api('state'), other.id)
    return value.contextCheckRatio === 0.75 && value.contextRecentTokens === 8192
  })
  check(selectedBot(await api('state'), main.id).contextCheckRatio !== 0.75, 'Context policy save is per-Bot')
  const memory = form.getByRole('switch', { name: 'Automatic memory review', exact: true })
  const memoryBefore = await memory.getAttribute('aria-checked')
  await memory.click()
  await until('Memory review persisted', async () => String(selectedBot(await api('state'), other.id).memoryReview) === String(memoryBefore !== 'true'))
  const context = await api('context-status', { botId: other.id })
  check(context.policy.checkRatio === 0.75 && context.policy.recentTokens === 8192, 'Context query reads the actual saved policy')
  check(['measured', 'estimated', 'unavailable'].includes(context.usage.source), 'Context source preserves measured/estimated/unavailable distinction')
  await wait(form.locator('[data-context-usage]'))
  const scope = form.getByRole('combobox', { name: 'Stats scope', exact: true })
  for (const [key, label] of [['lastRequest', 'Last request'], ['lastTurn', 'Last turn'], ['session', 'Current Session'], ['bot', 'Bot total']]) {
    await scope.selectOption({ label })
    const [response] = await Promise.all([
      page.waitForResponse(response => {
        if (!response.url().endsWith('/api/omni-ui')) return false
        const body = response.request().postDataJSON()
        return body?.endpoint === 'usage-stats' && body.payload?.botId === other.id
      }),
      form.getByRole('button', { name: 'Refresh stats', exact: true }).click(),
    ])
    const request = response.request().postDataJSON()
    check(request.payload.sessionId === context.sessionId, `Stats UI requests selected Bot own Session: ${label}`)
    const result = await response.json()
    assert.equal(result.ok, true)
    const selected = result.value.scopes[key]
    if (selected) {
      const table = form.getByRole('table', { name: 'Recorded model attempts', exact: true })
      await wait(table)
      const expected = ['input', 'output', 'cacheRead', 'cacheWrite', 'calls', 'attempts', 'retries'].map(field => Number.isFinite(selected.allIn[field]) ? selected.allIn[field].toLocaleString('en-US') : 'Unknown')
      await until(`Stats render matches ${label}`, async () => JSON.stringify(await table.locator('tbody tr').first().locator('td').allTextContents()) === JSON.stringify(expected))
    } else await wait(form.getByText('No attributable attempts recorded for this scope.', { exact: true }))
    check(true, `Stats rendered values match actual derived query: ${label}`)
  }
  const stats = await api('usage-stats', { botId: other.id, sessionId: context.sessionId })
  check(stats.botId === other.id && stats.scopes.bot.allIn.attempts > 0, 'Durable Stats query includes synthetic billed attempts for owner')
  const forbidden = await page.evaluate(async payload => {
    const response = await fetch('/api/omni-ui', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ endpoint: 'usage-stats', payload }) })
    return response.json()
  }, { botId: other.id, sessionId: selectedBot(await api('state'), main.id).sessionId })
  check(forbidden.ok === false, 'Stats query refuses another Bot private Session')
  const beforeCheckpoint = context.sessionId
  await form.getByRole('button', { name: 'Checkpoint now', exact: true }).click()
  await until('Checkpoint settled', async () => {
    const value = await api('context-status', { botId: other.id })
    return value.sessionId === beforeCheckpoint && value.canCheckpoint && value.counts.checkpoints > context.counts.checkpoints
  })
  check(true, 'Checkpoint now uses real backend and retains same own-chat Session')
  await form.getByRole('button', { name: 'Use context defaults', exact: true }).click()
  await until('Context defaults restored', async () => {
    const value = await api('context-status', { botId: other.id })
    return value.policy.checkRatio === 0.8 && value.policy.recentTokens === 16384
  })
  await form.getByRole('button', { name: 'Start new part', exact: true }).click()
  await form.getByRole('button', { name: 'Confirm new part', exact: true }).click()
  await until('Fresh part differs from checkpoint', async () => (await api('context-status', { botId: other.id })).sessionId !== beforeCheckpoint)
  check(true, 'Start new part is distinct from same-Session checkpoint')
  await page.reload()
  await openBot(page, other.id)
  form = await settings(page)
  check(await form.getByRole('switch', { name: 'Advanced Bot', exact: true }).getAttribute('aria-checked') === 'true', 'Other Advanced persists through reload and fresh-part navigation')
  await closeDetails(page)
  await setAdvanced(page, api, until, other.id, false, check)
  await closeDetails(page)
  await openBot(page, main.id)
  form = await settings(page)
  check(await form.getByRole('switch', { name: 'Advanced Bot', exact: true }).getAttribute('aria-checked') === 'true', 'Main Advanced remains independently on after other Bot changes')
  await closeDetails(page)
  await checkHeader(page, check, 'Main after session switch')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: 'Open Live', exact: true }).first().click()
  await wait(panel(page))
  await page.waitForFunction(() => document.querySelector('[data-sidebar-right-panel="fullscreen"][data-sidebar-right-open]') !== null, undefined, { polling: 'raf', timeout: 2000 })
  check(await panel(page).getAttribute('data-sidebar-right-panel') === 'fullscreen', 'Native sidebar owns narrow fullscreen docking')
  await assertNoHorizontalOverflow(page, check, 'Narrow Advanced Live')
  assert.ok(plainFocus?.automatic && plainFocus.recovery.visibleControl, 'Actual same-run plain native focus baseline is required')
  const botFocus = await keyboardCollapseSample(page, until, 'Bot native Live 390px')
  if (plainFocus.automatic.visibleControl) {
    check(botFocus.automatic.visibleControl, 'Bot native collapse preserves strict automatic visible-focus restoration proven by plain DSH', { plainFocus, botFocus })
  } else {
    const rank = sample => sample.visibleControl ? 2 : sample.body ? 0 : 1
    check(rank(botFocus.automatic) >= rank(plainFocus.automatic), 'Bot native collapse is no worse than actual plain native automatic-focus baseline (not an auto-restore claim)', { plainFocus, botFocus })
  }
  check(botFocus.recovery.visibleControl, 'Bot native collapse preserves actual one-Tab recovery and native keyboard reopen', { plainFocus, botFocus })
  await page.setViewportSize({ width: 1440, height: 960 })
  // Browser Details belongs to simple mode. Use the real saved switch, then restore Advanced.
  await setAdvanced(page, api, until, main.id, false, check)
  await closeDetails(page)
  await page.getByRole('button', { name: 'View conversation details', exact: true }).first().click()
  const browserTab = page.locator('.bt-panel').getByRole('tab', { name: 'Browser', exact: true })
  if (await visible(browserTab)) {
    await browserTab.click()
    check(await page.locator('.bt-panel').innerText().then(text => /browser/i.test(text)), 'Existing Browser details route remains navigable')
  } else {
    // Browser service is desktop-only in some deployments; never manufacture a route to pass.
    check(!(await api('state')).browser, 'Browser unavailable in isolated plain web runtime is reported honestly')
  }
  await closeDetails(page)
  await setAdvanced(page, api, until, main.id, true, check)
  await closeDetails(page)
  await page.locator('button.bt-account').click()
  await page.getByRole('menuitem', { name: 'Switch to classic Agent mode', exact: true }).click()
  await wait(page.locator('button.bt-return'))
  check(await page.locator('.bt-head:visible,.bt-native-head:visible,.bt-native-note:visible,.bt-live:visible').count() === 0, 'Classic Agent mode withdraws Bot header, controls and Live')
  const nativeExpand = page.locator('[data-sidebar-right-expand]:visible').first()
  await nativeExpand.click()
  await wait(panel(page))
  await page.locator('[data-sidebar-right-open] [data-sidebar-right-toggle]:visible').first().click()
  await until('Classic native sidebar collapses', async () => await panel(page).count() === 0)
  check(true, 'Plugin-loaded classic DSH retains genuine native sidebar open/close')
  await page.locator('button.bt-return').click()
  await wait(page.locator('.bt-row[data-bot-id]').first())
  check(selectedBot(await api('state'), main.id).advanced === true, 'Returning from classic DSH preserves Bot Advanced preference')
  return { mainId: main.id, otherId: other.id }
}

export async function checkRestartPersistence({ page, api, check, until, probeStatus }, expected) {
  await dismissNotices(page)
  await wait(page.locator('.bt-row[data-bot-id]').first())
  await until('Restarted fixture client native registrations', () => { const value = probeStatus(); return value.VIEW_REGISTERED > 0 && value.ACTION_REGISTERED > 0 }, 5000)
  const state = await api('state')
  check(selectedBot(state, expected.mainId)?.advanced === true && selectedBot(state, expected.otherId)?.advanced === false, 'Advanced settings survive actual isolated runtime restart')
  await openBot(page, expected.mainId)
  await checkHeader(page, check, 'Restarted main')
}
