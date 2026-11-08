// A tiny Playwright stand-in for tests that must run the real browser host: launch,
// pages, saved tabs, and navigation interception. It is not a browser. `goto` feeds every
// navigation request through the context route the host installed, follows `redirects`,
// and records the address it reached. Tests import `contexts` to steer one launch.
export const contexts = []

function emitter() {
  const listeners = new Map()
  return {
    on(name, listener) {
      const list = listeners.get(name) ?? []
      list.push(listener)
      listeners.set(name, list)
    },
    off(name, listener) {
      const list = listeners.get(name) ?? []
      listeners.set(name, list.filter(item => item !== listener))
    },
    emit(name, ...args) {
      for (const listener of listeners.get(name) ?? []) listener(...args)
    },
  }
}

function makePage(context, initial = 'about:blank') {
  const events = emitter()
  let current = initial
  let closed = false
  let backTo = null
  let page
  const frame = { page: () => page }

  async function navigate(input) {
    let next = String(input)
    for (let hop = 0; hop < 8; hop += 1) {
      const handler = context.routes.at(-1)
      if (handler !== undefined) {
        let aborted = false
        const request = {
          url: () => next,
          isNavigationRequest: () => true,
          frame: () => frame,
        }
        const route = {
          request: () => request,
          continue: async () => {},
          abort: async () => {
            aborted = true
            throw new Error('net::ERR_BLOCKED_BY_CLIENT')
          },
        }
        await handler(route)
        if (aborted) throw new Error('net::ERR_BLOCKED_BY_CLIENT')
      }
      const redirect = context.redirects.get(next)
      if (redirect === undefined) break
      next = redirect
    }
    current = next
    events.emit('framenavigated', frame)
    events.emit('load')
  }

  page = {
    ...events,
    isClosed: () => closed,
    url: () => current,
    title: async () => 'Fake page',
    ariaSnapshot: async () => '- heading "Fake page"',
    mainFrame: () => frame,
    setDefaultTimeout() {},
    setDefaultNavigationTimeout() {},
    waitForLoadState: async () => {},
    goto: navigate,
    goBack: async () => {
      if (backTo === null) throw new Error('no history')
      await navigate(backTo)
    },
    goForward: async () => {},
    reload: async () => {},
    screenshot: async () => Buffer.from('fake image'),
    close: async () => {
      closed = true
      events.emit('close')
    },
    locator: () => {
      throw new Error('the fake page has no elements')
    },
    set backTo(value) { backTo = value },
  }
  return page
}

function makeContext() {
  const pages = []
  const events = emitter()
  const context = {
    routes: [],
    redirects: new Map(),
    pages: () => pages,
    on: events.on,
    off: events.off,
    route: async (_pattern, handler) => {
      context.routes.push(handler)
    },
    unroute: async (_pattern, handler) => {
      context.routes = context.routes.filter(item => item !== handler)
    },
    newPage: async () => {
      const page = makePage(context)
      pages.push(page)
      events.emit('page', page)
      return page
    },
    cookies: async () => [],
    addCookies: async () => {},
    close: async () => {
      events.emit('close')
    },
  }
  pages.push(makePage(context))
  return context
}

export const chromium = {
  async launchPersistentContext() {
    const context = makeContext()
    contexts.push(context)
    return context
  },
  async connectOverCDP() {
    throw new Error('the fake Playwright does not connect over CDP')
  },
}
