// A real fixture-only extension using the shipped client loader and public slot API.
// It does not replace native header/corner/sidebar controls or Bot rendering.
window.__ModuleLoader__.load({
  id: 'advanced-native-fixture-probe',
  factory: require => {
    const { createElement: h, useState } = require('react')
    function ProbeView({ sessionId }) {
      return h('section', { 'aria-label': 'Fixture plugin view' }, h('h2', null, 'Fixture plugin view'), h('p', null, sessionId))
    }
    function ProbeAction() {
      const [count, setCount] = useState(0)
      return h('button', { type: 'button', 'aria-label': 'Fixture header action', onClick: () => setCount(value => value + 1) }, `Probe ${count}`)
    }
    return {
      inject: ['slots'],
      apply(ctx) {
        console.info('ADVANCED_FIXTURE_PROBE_APPLIED')
        ctx.slots.inject('conversation.view', () => {
          const release = ctx.slots.register({ name: 'conversation.view', id: 'fixture-view', label: () => 'Fixture view', order: 900 }, ProbeView)
          console.info('ADVANCED_FIXTURE_VIEW_REGISTERED')
          return release
        })
        ctx.slots.inject('conversation.session.header.actions', () => {
          const release = ctx.slots.register({ name: 'conversation.session.header.actions', id: 'fixture-action', order: 900 }, ProbeAction)
          console.info('ADVANCED_FIXTURE_ACTION_REGISTERED')
          return release
        })
      },
    }
  },
})
