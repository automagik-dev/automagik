import http from 'node:http'
import { randomUUID } from 'node:crypto'
import { Transform } from 'node:stream'
import { COOKIE, cookieSecret, LOCAL_TRUST_NOTICE, sessionCookie } from './gate-store.mjs'
import { agentMcpHeaders, DSH_HOST, responseHeaders, upstreamHeaders } from './gate-upstream.mjs'

export function pinOrigin(value) {
  const url = new URL(value)
  if (url.origin !== value || url.username || url.password || (url.protocol !== 'https:' && !(url.protocol === 'http:' && url.hostname === 'localhost'))) {
    throw new Error('Gate origin must be an exact HTTPS origin or HTTP localhost origin')
  }
  return url
}
function trustedRequest(req, origin, upgrade, allowNavigation = false) {
  if (req.headers.host !== origin.host) return false
  if (req.headers.origin !== undefined && req.headers.origin !== origin.origin) return false
  if (req.headers['sec-fetch-site'] === 'cross-site' && !(allowNavigation && !upgrade && ['GET', 'HEAD'].includes(req.method) && req.headers['sec-fetch-mode'] === 'navigate')) return false
  return !(upgrade || !['GET', 'HEAD'].includes(req.method)) || req.headers.origin === origin.origin
}
// Gate management has one spelling. Do this before authentication so an alias cannot
// become a second sign-in/management entry, or pass raw to a differently decoding upstream.
function reservedPathAlias(rawUrl, origin) {
  const raw = rawUrl.split('?', 1)[0]
  const reserved = path => path === '/_gate' || path.startsWith('/_gate/')
  const queue = [raw]
  const seen = new Set(queue)
  for (let i = 0; i < queue.length; i++) {
    const candidate = queue[i]
    if (reserved(candidate) && (candidate !== raw || !raw.startsWith('/_gate/'))) return true
    let normalized
    try { normalized = new URL(candidate, origin).pathname }
    catch { return true }
    const forms = [normalized, candidate.replace(/\\/g, '/').replace(/\/{2,}/g, '/')]
    try { forms.push(decodeURIComponent(candidate)) }
    catch { if (reserved(candidate)) return true }
    // Explore compositions too: collapsing empty segments changes which '..' is resolved.
    for (const form of forms) {
      if (form !== raw && (reserved(raw) || reserved(form))) return true
      if (!seen.has(form)) {
        if (seen.size >= 64) return true
        seen.add(form)
        queue.push(form)
      }
    }
  }
  return false
}

function answer(res, status, value) {
  res.writeHead(status, { 'cache-control': 'no-store', 'content-type': 'application/json' })
  res.end(JSON.stringify(value))
}
function refuseSocket(socket, status = 401) {
  const destroy = () => socket.destroy()
  const timer = setTimeout(destroy, 1000).unref()
  socket.once('error', destroy)
  socket.once('close', () => clearTimeout(timer))
  // An upgraded/CONNECT socket can stay half-open forever after FIN. Close its descriptor
  // once the rejection has flushed, with a deadline even if the peer does not read it.
  socket.end(`HTTP/1.1 ${status} Refused\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`, destroy)
}

export function createGate({ origin: value, sessions, credentials, access, selfHosted, bootstrap = false, auditAccess = record => process.stderr.write(`${JSON.stringify(record)}\n`) }) {
  const origin = pinOrigin(value)
  const sockets = new Map()
  async function authorize(req, upgrade = false) {
    if (trustedRequest(req, origin, upgrade)) {
      const family = sessions.authenticate(cookieSecret(req.headers.cookie), origin.origin)
      if (family) return { family }
    }
    // Access exchanges happen only on HTTP; an upgrade must already hold a gate session.
    if (!access || upgrade) return undefined
    try {
      if (!trustedRequest(req, origin, upgrade, true)) throw new Error('Refused')
      // Invalid or replayed gate cookies never silently turn into a fresh Access session.
      if (req.headers.cookie?.split(';').some(part => part.trim().startsWith(`${COOKIE}=`))) throw new Error('Refused')
      if (!req.url.startsWith('/') || req.url.startsWith('//') || new URL(req.url, origin).searchParams.has('token')) throw new Error('Refused')
      const principal = await access.signIn(req.headers['cf-access-jwt-assertion'])
      const issued = sessions.issue(origin.origin, principal)
      return { family: issued.family, cookie: sessionCookie(issued.secret) }
    } catch {
      auditAccess({ status: 401, request_id: randomUUID() })
      return undefined
    }
  }
  const server = http.createServer(async (req, res) => {
    if (reservedPathAlias(req.url, origin)) { answer(res, 400, { error: 'Non-canonical gate path' }); return }
    // Literal target only: queries and aliases continue through the ordinary session gate.
    // The upstream exact route admits only agent tokens, never a browser session alone.
    if (req.url === '/api/omni-mcp') {
      if (req.headers.host !== origin.host
        || (req.headers.origin !== undefined && req.headers.origin !== origin.origin)
        || req.headers['sec-fetch-site'] === 'cross-site') {
        auditAccess({ status: 403, request_id: randomUUID() })
        answer(res, 403, { error: 'Invalid MCP origin' })
        return
      }
      try {
        const cookie = await credentials.cookie()
        const proxy = http.request({ hostname: DSH_HOST, port: credentials.port,
          method: req.method, path: '/api/omni-mcp',
          headers: agentMcpHeaders(req, credentials, cookie), timeout: 10000 }, upstream => {
          res.writeHead(upstream.statusCode, responseHeaders(upstream.headers))
          upstream.pipe(res)
          upstream.on('error', () => res.destroy())
        })
        proxy.on('timeout', () => proxy.destroy(new Error('MCP timeout')))
        proxy.on('error', () => {
          if (!res.headersSent) answer(res, 502, { error: 'MCP unavailable' })
          else res.destroy()
        })
        res.on('close', () => proxy.destroy())
        req.pipe(proxy)
      } catch { answer(res, 502, { error: 'MCP unavailable' }) }
      return
    }
    const authorization = await authorize(req)
    const family = authorization?.family
    if (selfHosted && await selfHosted.handle(req, res, family, { bootstrap })) return
    if (!family) { answer(res, 401, { error: 'Session required' }); return }
    if (authorization.cookie) res.setHeader('set-cookie', authorization.cookie)
    try {
      // No absolute-form URLs, launch-token exchanges or token-bearing browser URLs.
      if (!req.url.startsWith('/') || req.url.startsWith('//')) { answer(res, 400, { error: 'Invalid path' }); return }
      const url = new URL(req.url, origin)
      if (url.searchParams.has('token')) { answer(res, 401, { error: 'Session required' }); return }
      if (url.pathname.startsWith('/_gate/')) {
        if (url.pathname === '/_gate/sessions' && req.method === 'GET') {
          answer(res, 200, { sessions: sessions.list(), current: family.id, local_trust_notice: LOCAL_TRUST_NOTICE })
        } else if (url.pathname === '/_gate/session/renew' && req.method === 'POST') {
          res.setHeader('set-cookie', sessionCookie(sessions.renew(family)))
          answer(res, 200, {})
        } else if (url.pathname === '/_gate/sign-out-everywhere' && req.method === 'POST') {
          sessions.revokeAll()
          res.setHeader('set-cookie', sessionCookie('', 0))
          answer(res, 200, {})
        } else answer(res, 404, { error: 'Unknown gate route' })
        return
      }
      // The gate-held browser credential also admits DSH's /api and WebSocket owner peer.
      // /connect is a DSH bearer exchange, never a second browser sign-in path.
      if (url.pathname === '/connect') { answer(res, 401, { error: 'Session exchanges belong to the gate' }); return }
      const cookie = await credentials.cookie()
      if (!sessions.active(family) || res.destroyed) { answer(res, 401, { error: 'Session required' }); return }
      const proxy = http.request({ hostname: DSH_HOST, port: credentials.port, method: req.method, path: req.url, headers: upstreamHeaders(req, credentials, cookie, family.principal), timeout: 30_000 }, upstream => {
        // Refresh credentials for the next request on 401. Never replay a mutating body.
        if (upstream.statusCode === 401) credentials.cookie(true).catch(() => {})
        res.writeHead(upstream.statusCode, responseHeaders(upstream.headers))
        upstream.pipe(res)
        upstream.on('error', () => res.destroy())
      })
      proxy.on('timeout', () => proxy.destroy(new Error('DSH timeout')))
      proxy.on('error', () => { if (!res.headersSent) answer(res, 502, { error: 'DSH unavailable' }); else res.destroy() })
      res.on('close', () => proxy.destroy())
      req.pipe(proxy)
    } catch { if (!res.headersSent) answer(res, 502, { error: 'DSH unavailable' }); else res.destroy() }
  })
  server.on('connect', (req, socket) => refuseSocket(socket, reservedPathAlias(req.url, origin) ? 400 : 401))
  server.on('upgrade', async (req, socket, head) => {
    socket.on('error', () => {})
    if (reservedPathAlias(req.url, origin)) { refuseSocket(socket, 400); return }
    const authorization = await authorize(req, true)
    const family = authorization?.family
    if (!family) { refuseSocket(socket); return }
    try {
      if (!req.url.startsWith('/') || req.url.startsWith('//') || new URL(req.url, origin).searchParams.has('token') || req.headers.upgrade?.toLowerCase() !== 'websocket') { refuseSocket(socket); return }
      const cookie = await credentials.cookie()
      if (!sessions.active(family) || socket.destroyed) { refuseSocket(socket); return }
      const proxy = http.request({ hostname: DSH_HOST, port: credentials.port, method: 'GET', path: req.url, headers: upstreamHeaders(req, credentials, cookie, family.principal, true), timeout: 5000 })
      const record = { socket, family, proxy }
      sockets.set(socket, record)
      socket.on('error', () => proxy.destroy())
      socket.on('close', () => { sockets.delete(socket); proxy.destroy(); record.upstream?.destroy() })
      proxy.on('error', () => socket.destroy())
      proxy.on('timeout', () => proxy.destroy())
      proxy.on('response', response => {
        response.resume()
        if (response.statusCode === 401) credentials.cookie(true).catch(() => {})
        refuseSocket(socket, response.statusCode === 401 ? 401 : 502)
      })
      proxy.on('upgrade', (response, upstream, upstreamHead) => {
        record.upstream = upstream
        if (!sessions.active(family) || socket.destroyed) { upstream.destroy(); socket.destroy(); return }
        proxy.setTimeout(0)
        const headers = { ...responseHeaders(response.headers), connection: 'Upgrade', upgrade: 'websocket' }
        socket.write(`HTTP/1.1 101 Switching Protocols\r\n${Object.entries(headers).map(([k, v]) => `${k}: ${v}\r\n`).join('')}\r\n`)
        if (head.length) upstream.write(head)
        if (upstreamHead.length) socket.write(upstreamHead)
        upstream.on('error', () => socket.destroy())
        upstream.on('close', () => socket.destroy())
        const admitted = new Transform({
          transform(chunk, encoding, callback) {
            if (!sessions.touch(family)) { callback(new Error('Session expired')); return }
            callback(null, chunk)
          },
        })
        admitted.on('error', () => { socket.destroy(); upstream.destroy() })
        socket.on('close', () => admitted.destroy())
        socket.pipe(admitted).pipe(upstream).pipe(socket)
      })
      proxy.end()
    } catch { refuseSocket(socket, 502) }
  })
  const revoke = id => { for (const record of sockets.values()) if (record.family.id === id) record.socket.destroy() }
  sessions.on('revoke', revoke)
  const timer = setInterval(() => { for (const record of sockets.values()) if (!sessions.active(record.family)) record.socket.destroy() }, 1000).unref()
  let rebinding = false
  server.on('close', () => { if (!rebinding) { clearInterval(timer); sessions.off('revoke', revoke) } })
  let binding = Promise.resolve()
  server.rebind = (port, target, drop = false) => {
    if (drop) { for (const record of sockets.values()) record.socket.destroy(); server.closeAllConnections() }
    const task = binding.then(async () => {
      const host = typeof target === 'function' ? target() : target
      if (server.address()?.address === host) return
      rebinding = true
      await new Promise((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve())
        // Stop accepting first, then drop connections accepted while this rebind was queued.
        if (drop) server.closeAllConnections()
      })
      await new Promise((resolve, reject) => {
        const failed = error => reject(error)
        server.once('error', failed)
        server.listen(port, host, () => { server.off('error', failed); resolve() })
      })
      rebinding = false
    })
    binding = task.catch(() => {})
    return task
  }
  server.closeGate = () => { for (const record of sockets.values()) record.socket.destroy(); server.closeAllConnections(); return new Promise(resolve => server.close(resolve)) }
  return server
}
