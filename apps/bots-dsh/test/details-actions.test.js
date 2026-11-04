import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createSource } from '../src/client/sources.js'
import { teamActions } from '../src/client/team-actions.js'

// The header's Details button drives the one existing panel through these actions.
function panel() {
  const ui = createSource({ details: null, view: 'details', renaming: false, tab: null })
  const roster = createSource({ byId: { bot: { id: 'bot' }, other: { id: 'other' } }, roomsById: { group: { id: 'group' } }, sideChats: { bot: [{ id: 'side-1' }] } })
  return { ui, actions: teamActions({ ui, roster }) }
}

test('Details opens, closes and switches subject on the one existing panel', () => {
  const { ui, actions } = panel()
  actions.toggleDetails('bot')
  assert.equal(ui.getSnapshot().details, 'bot')
  actions.toggleDetails('bot')
  assert.equal(ui.getSnapshot().details, null)
  actions.toggleDetails('bot')
  actions.toggleDetails('group')
  assert.equal(ui.getSnapshot().details, 'group')
  actions.toggleDetails('group')
  assert.equal(ui.getSnapshot().details, null)
})

test('Details on a pane showing the browser switches it to details before a second press closes it', () => {
  const { ui, actions } = panel()
  ui.set({ details: 'bot', view: 'browser', renaming: true, tab: 'settings' })
  actions.toggleDetails('bot')
  assert.deepEqual(ui.getSnapshot(), { details: 'bot', view: 'details', renaming: false, tab: null })
  actions.toggleDetails('bot')
  assert.equal(ui.getSnapshot().details, null)
})

test('an open pane follows the selected Bot, group or native thread without another Bot\'s browser or side chat', () => {
  const { ui, actions } = panel()
  actions.followPanel('bot')
  assert.equal(ui.getSnapshot().details, null, 'navigation never opens a closed pane')
  ui.set({ details: 'bot', view: 'browser', renaming: true, tab: 'settings' })
  actions.followPanel('other')
  assert.deepEqual(ui.getSnapshot(), { details: 'other', view: 'browser', renaming: false, tab: null }, 'a Bot shows its own browser')
  actions.followPanel('group')
  assert.deepEqual(ui.getSnapshot(), { details: 'group', view: 'details', renaming: false, tab: null }, 'a group has no browser')
  ui.set({ details: 'bot', view: 'side', side: 'side-1', renaming: false, tab: null })
  actions.followPanel('other')
  assert.equal(ui.getSnapshot().view, 'details', 'another Bot does not keep this Bot\'s side chat')
  actions.followPanel('native-thread')
  assert.equal(ui.getSnapshot().details, 'native-thread', 'a native thread is its own subject, not its parent Bot')
  assert.equal(ui.getSnapshot().view, 'details')
  actions.closePanel()
  assert.equal(ui.getSnapshot().details, null)
})
