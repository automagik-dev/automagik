// The loopback CDP relay a Bot drives its in-app browser through. dsh asks for an endpoint
// over its IPC channel (bots-dsh browser-plugins.js appBrowserEndpoint; main.js answers) and
// connects Playwright to it (`connectOverCDP`). The endpoint is a WebSocket on 127.0.0.1 whose
// path carries a 64-hex token bound to one Bot; only a loopback peer that sends no Origin gets
// in, so no web page can. A connection sees that Bot's views as its only browser context: its
// tabs are page targets, and every page command goes to that view's own debugger, child
// sessions too (cross-origin iframes, workers). A Bot view takes a debugger only while a Bot is
// attached to it; when the last one leaves, the debugger lets go, and with it every override
// and interception the Bot left behind, so the owner browses a plain page. The Bot's mouse and
// navigation commands are also drawn by its cursor (bot-cursor.js) as they pass.
//
// Ported from DS Bot's app, app/src/bot-views.mjs at 4a7b55069ad300eae8be42a74f31bc170b40ead7
// (https://github.com/Fei2411/DS-Bot, Apache-2.0; see NOTICE). Changed here: commands are not
// queued behind one another (a page blocked on a dialog still gets the command that answers
// it), child sessions route from the moment they attach, a tab the panel does not show can
// be screenshot, the debugger is held only while a Bot is attached, and a new tab does not
// take the window's focus.
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdirSync, realpathSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { basename, isAbsolute, join, relative as relativePath, resolve, sep } from 'node:path'
import { WebSocketServer } from 'ws'

const LOOPBACK_PEERS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])
const PLAYWRIGHT_ARTIFACT_PREFIX = 'playwright-artifacts-'
const ROOTS_MAX = 4
// Of the Target domain, a page session gets only what Playwright uses there: auto-attaching
// the page's own children (iframes in another process, workers) and detaching from them.
// The rest would reach the debugger's view of every target: other Bots' tabs, dsh's page.
const PAGE_TARGET_METHODS = new Set(['Target.setAutoAttach', 'Target.detachFromTarget'])

function containsPath(root, target) {
  const relative = relativePath(resolve(root), resolve(target))
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${sep}`) && !isAbsolute(relative))
}

function isDirectChild(root, target) {
  const relative = relativePath(resolve(root), resolve(target))
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${sep}`) && !relative.includes(sep) && !isAbsolute(relative)
}

export class BotRelay {
  #views
  #tokens = new Map()
  #clients = new Map()
  #server
  #wss
  #listening
  #downloadPaths = new Map()
  #downloadRoots = new Map()
  // Per view: the sockets attached to it, each with its own session id for the page.
  #attached = new Map()

  /** @param {{ views: import('./bot-views.js').BotViews }} options */
  constructor({ views }) {
    this.#views = views
    views.relay = this
    this.#server = createServer((_request, response) => { response.writeHead(404).end() })
    this.#wss = new WebSocketServer({ noServer: true })
    this.#server.on('upgrade', (request, socket, head) => {
      const token = /^\/devtools\/browser\/([a-f0-9]{64})$/u.exec(request.url ?? '')?.[1]
      const botId = token === undefined ? undefined : this.#tokens.get(token)
      if (request.headers.origin !== undefined || !LOOPBACK_PEERS.has(request.socket.remoteAddress) || botId === undefined) {
        socket.destroy()
        return
      }
      this.#wss.handleUpgrade(request, socket, head, client => this.#connect(client, botId))
    })
    this.#listening = new Promise((done, fail) => {
      this.#server.once('error', fail)
      this.#server.listen(0, '127.0.0.1', () => done(this.#server.address().port))
    })
  }

  /**
   * A new endpoint for the Bot's browser; earlier tokens stop working. A Bot with no tab gets a
   * blank one. `downloadRoots` are the folders (at most four, absolute) the Bot may save into.
   */
  async endpoint(botId, { downloadRoots } = {}) {
    if (this.#views.isHeld(botId)) throw new Error('The user has taken over this browser.')
    if (downloadRoots !== undefined) {
      if (!Array.isArray(downloadRoots) || downloadRoots.length > ROOTS_MAX || !downloadRoots.every(root => typeof root === 'string' && isAbsolute(root))) {
        throw new Error('Invalid browser download roots.')
      }
      this.#downloadRoots.set(botId, [...new Set(downloadRoots.map(root => resolve(root)))])
      this.#downloadPaths.delete(botId)
    }
    const port = await this.#listening
    if (this.#views.entriesOf(botId).length === 0) this.#views.create(botId, { createdByBot: true })
    this.#revoke(botId)
    const token = randomBytes(32).toString('hex')
    this.#tokens.set(token, botId)
    return `ws://127.0.0.1:${port}/devtools/browser/${token}`
  }

  /** The Bot's connections close and its tokens stop working (a hold, a crash, a deleted Bot). */
  drop(botId) {
    this.#revoke(botId)
    for (const client of [...(this.#clients.get(botId) ?? [])]) client.socket.terminate()
  }

  attached(entry) {
    return (this.#attached.get(entry)?.size ?? 0) > 0
  }

  /** A new view of the Bot: connections that discover or auto-attach learn of it. */
  created(entry) {
    entry.contents.debugger.on('message', (_event, method, params, sessionId) => this.#native(entry, method, params, sessionId))
    // Something else took the debugger (DevTools, say): the Bot connects again. A tab that
    // closed is not that: bot-views.js lets it go, and the Bot keeps its connection.
    entry.contents.debugger.on('detach', (_event, reason) => {
      if (!entry.releasing && reason !== 'target closed') this.drop(entry.botId)
    })
    for (const client of this.#clients.get(entry.botId) ?? []) {
      if (client.discover) this.#send(client.socket, { method: 'Target.targetCreated', params: { targetInfo: this.#targetInfo(entry) } })
      if (client.autoAttach) client.attach(entry)
    }
  }

  /** A view of the Bot closes: its sessions end. */
  closing(entry) {
    for (const [socket, sessionId] of this.#attached.get(entry) ?? []) {
      this.#send(socket, { method: 'Target.detachedFromTarget', params: { sessionId, targetId: entry.tabId } })
    }
    for (const client of this.#clients.get(entry.botId) ?? []) {
      if (client.discover) this.#send(client.socket, { method: 'Target.targetDestroyed', params: { targetId: entry.tabId } })
      client.forget(entry)
    }
    this.#attached.delete(entry)
    this.#release(entry)
  }

  dispose() {
    this.#tokens.clear()
    for (const client of this.#wss.clients) client.terminate()
    this.#wss.close()
    this.#server.close()
  }

  /** A download a Bot view starts: saved only while the Bot is attached and into its roots. */
  download(entry, event, item) {
    const downloadPath = this.attached(entry) ? this.#downloadPaths.get(entry.botId) : undefined
    if (downloadPath === undefined) {
      event.preventDefault()
      return
    }
    try {
      const guid = randomUUID()
      const savePath = join(downloadPath, guid)
      item.setSavePath(savePath)
      entry.downloads ??= new Map()
      entry.downloads.set(guid, item)
      this.#broadcast(entry.botId, { method: 'Browser.downloadWillBegin', params: {
        frameId: entry.tabId, guid, url: item.getURL(), suggestedFilename: item.getFilename(),
      } })
      const progress = state => this.#broadcast(entry.botId, { method: 'Browser.downloadProgress', params: {
        guid, receivedBytes: item.getReceivedBytes(), totalBytes: Math.max(0, item.getTotalBytes()),
        state: state === 'completed' ? 'completed' : state === 'interrupted' || state === 'cancelled' ? 'canceled' : 'inProgress',
      } })
      item.on('updated', (_event, state) => progress(state))
      item.once('done', (_event, state) => {
        progress(state)
        entry.downloads.delete(guid)
        if (state !== 'completed') void rm(savePath, { force: true }).catch(() => {})
      })
    } catch {
      event.preventDefault()
    }
  }

  #revoke(botId) {
    for (const [token, id] of this.#tokens) if (id === botId) this.#tokens.delete(token)
  }

  // A folder Playwright names for downloads: inside the Bot's roots, or Playwright's own
  // artifacts folder in the temporary directory.
  #allowedDownloadPath(botId, requested) {
    if (typeof requested !== 'string' || !isAbsolute(requested)) return undefined
    const target = resolve(requested)
    const roots = this.#downloadRoots.get(botId) ?? []
    const real = (path) => { try { return realpathSync(path) } catch { return undefined } }
    const inRoots = path => roots.some(root => containsPath(root, path) || (real(root) !== undefined && containsPath(real(root), path)))
    const temporary = resolve(tmpdir())
    const temporaryReal = real(temporary)
    const isArtifact = path => temporaryReal !== undefined && [temporary, temporaryReal].some(root =>
      isDirectChild(root, path) && basename(path).startsWith(PLAYWRIGHT_ARTIFACT_PREFIX))
    if (!inRoots(target) && !isArtifact(target)) return undefined
    try {
      mkdirSync(target, { recursive: true })
      const realTarget = realpathSync(target)
      return inRoots(realTarget) || isArtifact(realTarget) ? realTarget : undefined
    } catch {
      return undefined
    }
  }

  // The view's debugger, taken when the first Bot session attaches.
  #hold(entry) {
    const contents = entry.contents
    if (!contents.debugger.isAttached()) contents.debugger.attach('1.3')
  }

  #release(entry) {
    const contents = entry.contents
    if (contents.isDestroyed()) return
    if (contents.debugger.isAttached()) {
      entry.releasing = true
      try { contents.debugger.detach() } catch {}
      entry.releasing = false
    }
  }

  #frameId(entry, frameId) {
    return frameId === entry.mainFrameId ? entry.tabId : frameId
  }

  // A page target's id is its main frame's id to Playwright, and here it is the tab's id: the
  // main frame's native id is swapped for the tab's on the way out, and back on the way in.
  #framePayload(entry, method, payload) {
    if (payload === undefined || payload === null) return payload
    const value = structuredClone(payload)
    if (method === 'Page.getFrameTree' && value.frameTree?.frame && !value.frameTree.frame.parentId) entry.mainFrameId = value.frameTree.frame.id
    if (method === 'Page.frameNavigated' && value.frame && !value.frame.parentId) entry.mainFrameId = value.frame.id
    if (method === 'Page.frameAttached' && !value.parentFrameId) entry.mainFrameId = value.frameId
    const mapFrame = (frame) => {
      if (!frame) return
      if (frame.id !== undefined) frame.id = this.#frameId(entry, frame.id)
      if (frame.parentId !== undefined) frame.parentId = this.#frameId(entry, frame.parentId)
      for (const child of frame.childFrames ?? []) mapFrame(child)
    }
    if (method === 'Page.getFrameTree') {
      mapFrame(value.frameTree?.frame)
      const children = [...(value.frameTree?.childFrames ?? [])]
      while (children.length > 0) {
        const child = children.shift()
        mapFrame(child.frame)
        children.push(...(child.childFrames ?? []))
      }
    }
    if (value.frameId !== undefined) value.frameId = this.#frameId(entry, value.frameId)
    if (value.parentFrameId !== undefined) value.parentFrameId = this.#frameId(entry, value.parentFrameId)
    if (value.targetInfo?.parentFrameId !== undefined) value.targetInfo.parentFrameId = this.#frameId(entry, value.targetInfo.parentFrameId)
    if (value.frame) mapFrame(value.frame)
    if (value.context?.auxData?.frameId !== undefined) value.context.auxData.frameId = this.#frameId(entry, value.context.auxData.frameId)
    return value
  }

  // An event from a view's debugger, to every connection attached to that view. A child the
  // page attaches (an iframe in another process, a worker) routes from the moment it does.
  #native(entry, method, params, childSessionId) {
    const sockets = this.#attached.get(entry)
    if (!sockets) return
    for (const [socket, rootSessionId] of sockets) {
      const routes = this.#routesOf(socket)
      if (method === 'Target.attachedToTarget' && params?.sessionId) routes?.set(params.sessionId, { entry, nativeId: params.sessionId })
      if (childSessionId) routes?.set(childSessionId, { entry, nativeId: childSessionId })
      this.#send(socket, { method, params: this.#framePayload(entry, method, params), sessionId: childSessionId || rootSessionId })
      if (method === 'Target.detachedFromTarget' && params?.sessionId) routes?.delete(params.sessionId)
    }
  }

  #routesOf(socket) {
    for (const clients of this.#clients.values()) for (const client of clients) if (client.socket === socket) return client.sessions
    return undefined
  }

  #broadcast(botId, message) {
    for (const client of this.#clients.get(botId) ?? []) this.#send(client.socket, message)
  }

  #send(socket, message) {
    if (socket.readyState === 1) socket.send(JSON.stringify(message))
  }

  #connect(socket, botId) {
    const sessions = new Map()
    const client = { socket, botId, autoAttach: false, discover: false, sessions, attach: undefined, forget: undefined }
    const clients = this.#clients.get(botId) ?? new Set()
    clients.add(client)
    this.#clients.set(botId, clients)
    const targets = () => this.#views.entriesOf(botId)
    const info = entry => this.#targetInfo(entry)
    const attach = (entry) => {
      const sockets = this.#attached.get(entry) ?? new Map()
      const existing = sockets.get(socket)
      if (existing) return existing
      this.#hold(entry)
      const sessionId = randomUUID()
      sessions.set(sessionId, { entry, nativeId: undefined })
      sockets.set(socket, sessionId)
      this.#attached.set(entry, sockets)
      this.#send(socket, { method: 'Target.attachedToTarget', params: { sessionId, targetInfo: info(entry), waitingForDebugger: false } })
      this.#views.changed(entry)
      return sessionId
    }
    // This connection leaves a view: its routes to the view go, and the view's debugger with
    // the last one.
    const leave = (entry) => {
      for (const [id, route] of sessions) if (route.entry === entry) sessions.delete(id)
      const sockets = this.#attached.get(entry)
      if (!sockets?.delete(socket)) return
      if (sockets.size === 0) {
        this.#attached.delete(entry)
        this.#release(entry)
      }
      this.#views.changed(entry)
    }
    client.attach = attach
    client.forget = leave
    const browserTarget = { targetId: 'browser', type: 'browser', title: '', url: '', attached: true, canAccessOpener: false }
    socket.on('message', (raw) => {
      let request
      try { request = JSON.parse(raw.toString()) } catch { return }
      const { id, method, params = {}, sessionId } = request ?? {}
      const reply = result => this.#send(socket, { id, result, ...(sessionId ? { sessionId } : {}) })
      const fail = error => this.#send(socket, { id, error: { code: -32000, message: String(error?.message ?? error) }, ...(sessionId ? { sessionId } : {}) })
      // Each command runs at once: one waiting on the page (an evaluate behind a dialog) must
      // not hold back the next (the dialog's answer).
      void this.#command({ botId, method, params, sessionId, sessions, client, targets, attach, leave, info, browserTarget, socket }).then(reply, fail)
    })
    socket.on('close', () => {
      for (const entry of targets()) leave(entry)
      sessions.clear()
      clients.delete(client)
      if (clients.size === 0) this.#clients.delete(botId)
    })
  }

  async #command({ botId, method, params, sessionId, sessions, client, targets, attach, leave, info, browserTarget, socket }) {
    if (sessionId) {
      const route = sessions.get(sessionId)
      if (!route) throw new Error('Unknown target session')
      if (method.startsWith('Target.') && !PAGE_TARGET_METHODS.has(method)) {
        throw new Error(`${method} is not available here`)
      }
      const nativeParams = { ...params }
      if (nativeParams.frameId === route.entry.tabId) nativeParams.frameId = route.entry.mainFrameId
      const contents = route.entry.contents
      const sent = contents.debugger.sendCommand(method, nativeParams, route.nativeId)
      // The Bot's pointer and navigations, for its cursor (bot-cursor.js): the page session's
      // only, since input goes there in the page's own coordinates.
      if (route.nativeId === undefined) this.#views.cursor?.forwarded(route.entry, method, params)
      // A hidden tab draws no frame to copy: it is captured, kept hidden, until the shot is in.
      if (method === 'Page.captureScreenshot' && !route.entry.shown) {
        let done = false
        void sent.finally(() => { done = true }).catch(() => {})
        void (async () => {
          while (!done && !contents.isDestroyed()) await contents.capturePage(undefined, { stayHidden: true, stayAwake: true }).catch(() => {})
        })()
      }
      return this.#framePayload(route.entry, method, await sent)
    }
    const owned = (targetId) => {
      const entry = this.#views.entry(targetId)
      if (!entry || entry.botId !== botId) throw new Error('Browser tab does not belong to this Bot')
      return entry
    }
    switch (method) {
      case 'Browser.getVersion':
        return { protocolVersion: '1.3', product: `Chrome/${process.versions.chrome}`, revision: '', userAgent: `Mozilla/5.0 Chrome/${process.versions.chrome}`, jsVersion: process.versions.v8 }
      case 'Browser.setDownloadBehavior': {
        const allows = params.behavior === 'allow' || params.behavior === 'allowAndName'
        this.#downloadPaths.set(botId, allows ? this.#allowedDownloadPath(botId, params.downloadPath) : undefined)
        return {}
      }
      case 'Browser.cancelDownload': {
        const item = targets().map(entry => entry.downloads?.get(params.guid)).find(Boolean)
        item?.cancel()
        return {}
      }
      case 'Browser.close':
        socket.close()
        return {}
      case 'Browser.getWindowForTarget':
      case 'Browser.getBrowserCommandLine':
        return {}
      case 'Target.getBrowserContexts':
        return { browserContextIds: [`bot:${botId}`] }
      case 'Target.getTargets':
        return { targetInfos: targets().map(info) }
      case 'Target.getTargetInfo':
        return { targetInfo: params.targetId ? info(owned(params.targetId)) : browserTarget }
      case 'Target.setDiscoverTargets':
        client.discover = params.discover === true
        if (client.discover) for (const entry of targets()) this.#send(socket, { method: 'Target.targetCreated', params: { targetInfo: info(entry) } })
        return {}
      case 'Target.setAutoAttach':
        client.autoAttach = params.autoAttach === true
        if (client.autoAttach) for (const entry of targets()) attach(entry)
        return {}
      case 'Target.attachToTarget':
        return { sessionId: attach(owned(params.targetId)) }
      case 'Target.detachFromTarget': {
        const route = sessions.get(params.sessionId)
        if (route?.nativeId) {
          await route.entry.contents.debugger.sendCommand('Target.detachFromTarget', { sessionId: route.nativeId }).catch(() => {})
          sessions.delete(params.sessionId)
        } else if (route) leave(route.entry)
        return {}
      }
      case 'Target.createTarget':
        return { targetId: this.#views.create(botId, { url: params.url || 'about:blank', createdByBot: true }).tabId }
      case 'Target.closeTarget':
        await this.#views.close(botId, owned(params.targetId).tabId)
        return { success: true }
      case 'Target.activateTarget':
        owned(params.targetId)
        return {}
      default:
        throw new Error(`Unsupported CDP method: ${method}`)
    }
  }

  #targetInfo(entry) {
    const contents = entry.contents
    return {
      targetId: entry.tabId, type: 'page', title: contents.getTitle(),
      url: contents.getURL() || entry.requestedUrl, attached: this.attached(entry), canAccessOpener: true,
      browserContextId: `bot:${entry.botId}`, ...(entry.openerId ? { openerId: entry.openerId } : {}),
    }
  }
}
