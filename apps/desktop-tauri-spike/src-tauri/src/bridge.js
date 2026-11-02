// The spike's init script: what apps/desktop/src/preload.cjs gives DSH's page, plus timings,
// error capture and the WebKit feature probes. Runs in every page the window loads, before the
// page's own scripts. Its only way out is the `spike_bridge` command.
(() => {
  if (window.__spikeBridge) return
  const config = window.__SPIKE_CONFIG__ || {}
  const remote = location.protocol === 'http:'
  const invoke = (cmd, args) => window.__TAURI_INTERNALS__.invoke(cmd, args)
  const send = (kind, payload = {}) => invoke('spike_bridge', { kind, payload }).catch((error) => {
    console.warn('[spike] bridge failed', String(error))
    return { ok: false, error: String(error) }
  })
  window.__spikeBridge = true

  // preload.cjs: the page knows it is in the desktop app.
  const mark = () => { if (document.documentElement) document.documentElement.dataset.automagikDesktop = 'darwin' }
  mark()
  document.addEventListener('DOMContentLoaded', mark)
  const updates = Object.freeze({ status: async () => null, open: async () => null, subscribe: () => () => {} })
  Object.defineProperty(window, 'omniDesktop', { value: Object.freeze({ app: 'omni-desktop', platform: 'darwin', updates }) })
  // The minimal bridge a page can call: one command, from the remote origin.
  Object.defineProperty(window, 'automagikSpike', { value: Object.freeze({ ping: note => send('ping', { note: String(note ?? '') }) }) })

  // What breaks: uncaught errors, rejections and console.error, kept for the report.
  const errors = []
  const keep = (kind, text) => { if (errors.length < 200) errors.push({ kind, t: Math.round(performance.now()), text: String(text).slice(0, 500) }) }
  addEventListener('error', event => keep('error', `${event.message} @ ${event.filename}:${event.lineno}`))
  // WebKit's error.stack has no message line, so name and message go first.
  const describe = a => (a instanceof Error ? `${a.name}: ${a.message}\n${a.stack}` : typeof a === 'object' ? JSON.stringify(a) : a)
  addEventListener('unhandledrejection', event => keep('rejection', describe(event.reason)))
  const consoleError = console.error.bind(console)
  console.error = (...args) => { keep('console.error', args.map(describe).join(' ')); consoleError(...args) }

  const where = `${location.origin}${location.pathname}`
  // SPIKE_AUTH_RETRY=1: DSH's sign-in cookie is SameSite=Strict and set on a 303. When the
  // token URL was reached from another site (the tauri:// placeholder), WebKit holds the cookie
  // back on the redirect; one same-site reload of the origin then sends it.
  if (config.authRetry && remote) document.addEventListener('DOMContentLoaded', () => {
    if (!/dsh web authentication required/.test(document.body?.innerText ?? '')) return
    if (sessionStorage.getItem('spike-auth-retry')) return
    sessionStorage.setItem('spike-auth-retry', '1')
    void send('auth-retry', {})
    location.replace(`${location.origin}/`)
  })
  document.addEventListener('DOMContentLoaded', () => { void send('dom-ready', { where, t: Math.round(performance.now()) }) })
  addEventListener('load', () => {
    void send('load', { where, t: Math.round(performance.now()) }).then(reply => console.info('[spike] bridge reply', reply))
    if (!remote) return
    // "Page visible": the first frame in which DSH's app has drawn real content.
    const start = performance.now()
    const look = () => {
      const body = document.body
      const text = body?.innerText?.trim().length ?? 0
      const nodes = body?.getElementsByTagName('*').length ?? 0
      if (text > 40 && nodes > 80) {
        const visibility = document.visibilityState; const paints = performance.getEntriesByType('paint').map(p => `${p.name}=${Math.round(p.startTime)}`).join(' ')
        void send("visible", { t: Math.round(performance.now()), nodes, text, paints, visibility, sample: body.innerText.trim().replace(/\s+/g, " ").slice(0, 160) })
        if (config.probes) setTimeout(() => { void probes().then(report => send('report', report)) }, 4000)
        return
      }
      if (performance.now() - start < 20000) setTimeout(look, 50)
      else {
        void send('visible-timeout', { nodes, text, sample: body?.innerText?.slice(0, 400), html: document.documentElement.outerHTML.slice(0, 1500), errors: errors.slice(0, 20) })
        if (config.probes) void probes().then(report => send('report', report))
      }
    }
    setTimeout(look, 0)
  })

  const settle = (promise, ms = 5000) => Promise.race([promise, new Promise((_, fail) => setTimeout(() => fail(new Error(`timed out after ${ms} ms`)), ms))])
  const attempt = async (fn) => { try { return await fn() } catch (error) { return { error: `${error?.name ?? 'Error'}: ${error?.message ?? error}` } } }

  async function probes() {
    const report = { userAgent: navigator.userAgent, isSecureContext: window.isSecureContext, origin: location.origin }
    report.bridge = await attempt(() => settle(window.automagikSpike.ping('from the probes')))

    // Voice (speech.js openCapture): MediaRecorder with its default type, then decodeAudioData and
    // a 16 kHz OfflineAudioContext. A synthetic stream stands in for the microphone.
    report.voice = await attempt(async () => {
      const out = { mediaRecorder: typeof MediaRecorder, getUserMedia: typeof navigator.mediaDevices?.getUserMedia }
      if (typeof MediaRecorder === 'undefined') return out
      out.isTypeSupported = Object.fromEntries(['audio/webm', 'audio/webm;codecs=opus', 'audio/mp4', 'audio/mp4;codecs=mp4a.40.2', 'audio/ogg'].map(t => [t, MediaRecorder.isTypeSupported(t)]))
      const audio = new AudioContext()
      out.contextStateBefore = audio.state
      await settle(audio.resume(), 2000).catch(e => { out.resume = String(e) })
      out.contextState = audio.state
      const osc = audio.createOscillator()
      const dest = audio.createMediaStreamDestination()
      osc.connect(dest)
      osc.start()
      const recorder = new MediaRecorder(dest.stream)
      const chunks = []
      recorder.ondataavailable = (event) => { if (event.data.size > 0) chunks.push(event.data) }
      recorder.start()
      await new Promise(r => setTimeout(r, 1200))
      await settle(new Promise((resolve) => { recorder.onstop = resolve; recorder.stop() }), 3000)
      osc.stop()
      const blob = new Blob(chunks, { type: recorder.mimeType })
      out.mimeType = recorder.mimeType
      out.bytes = blob.size
      if (blob.size === 0) return out
      const decoded = await settle(audio.decodeAudioData(await blob.arrayBuffer()), 5000)
      out.decodedSeconds = Number(decoded.duration.toFixed(3))
      out.decodedRate = decoded.sampleRate
      const offline = new OfflineAudioContext(1, Math.max(1, Math.floor(Math.min(decoded.duration, 30) * 16000)), 16000)
      const source = offline.createBufferSource()
      source.buffer = decoded
      source.connect(offline.destination)
      source.start()
      const rendered = await offline.startRendering()
      const samples = rendered.getChannelData(0)
      let peak = 0
      for (const s of samples) peak = Math.max(peak, Math.abs(s))
      out.wavSamples = samples.length
      out.peak = Number(peak.toFixed(3))
      void audio.close()
      return out
    })

    // The real microphone (only with SPIKE_PROBES=mic: it asks macOS for the permission).
    if (config.probes === 'mic') {
      report.microphone = await attempt(async () => {
        const stream = await settle(navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false }), 20000)
        const tracks = stream.getAudioTracks().map(t => ({ label: t.label, state: t.readyState }))
        stream.getTracks().forEach(t => t.stop())
        return { ok: true, tracks }
      })
    }

    // composer.js speechApi + start(): the engine has to start and hear something, not just exist.
    report.speechRecognition = await attempt(async () => {
      const Api = window.SpeechRecognition ?? window.webkitSpeechRecognition
      const out = { SpeechRecognition: typeof window.SpeechRecognition, webkitSpeechRecognition: typeof window.webkitSpeechRecognition }
      if (!Api || config.probes !== 'mic') return out
      const engine = new Api()
      engine.lang = navigator.language || 'en-US'
      engine.interimResults = true
      engine.continuous = true
      const events = []
      for (const name of ['start', 'audiostart', 'soundstart', 'speechstart', 'result', 'error', 'end']) {
        engine.addEventListener(name, event => events.push(name === 'error' ? `error:${event.error}` : name))
      }
      engine.start()
      await new Promise(r => setTimeout(r, 6000))
      try { engine.abort() } catch {}
      await new Promise(r => setTimeout(r, 500))
      out.events = events
      return out
    })

    // pet-bake.js / widget-chart.js: canvas.toBlob(…, 'image/webp', 1). WebKit falls back to PNG.
    report.canvasWebp = await attempt(async () => {
      const canvas = document.createElement('canvas')
      canvas.width = 64
      canvas.height = 64
      const g = canvas.getContext('2d')
      g.fillStyle = '#c84'
      g.fillRect(0, 0, 64, 64)
      const blob = await settle(new Promise(r => canvas.toBlob(r, 'image/webp', 1)))
      const dataUrl = canvas.toDataURL('image/webp').slice(0, 22)
      return { blobType: blob?.type ?? null, bytes: blob?.size ?? 0, dataUrlPrefix: dataUrl }
    })

    // The CSS the Bot team uses (styles.js, task-card.js, sidebar.js).
    report.css = await attempt(async () => {
      const style = document.createElement('style')
      style.textContent = '@property --spike-angle{syntax:"<angle>";inherits:false;initial-value:7deg}'
        + '.spike-fs{field-sizing:content;font:14px/20px sans-serif;padding:0;border:0;width:auto;min-width:0}'
        + '.spike-cs{width:20px;height:20px;border-radius:50%;corner-shape:round}'
      document.head.append(style)
      const probe = document.createElement('div')
      const ta = document.createElement('textarea')
      ta.className = 'spike-fs'
      ta.rows = 1
      const box = document.createElement('div')
      box.style.cssText = 'position:fixed;left:-9999px;top:0'
      box.append(probe, ta)
      document.body.append(box)
      const before = ta.getBoundingClientRect().height
      ta.value = 'one\ntwo\nthree\nfour'
      const after = ta.getBoundingClientRect().height
      const result = {
        supports: {
          cornerShapeRound: CSS.supports('corner-shape', 'round'),
          cornerShapeSquircle: CSS.supports('corner-shape', 'squircle'),
          fieldSizingContent: CSS.supports('field-sizing', 'content'),
          webkitAppRegionDrag: CSS.supports('-webkit-app-region', 'drag'),
          appRegionDrag: CSS.supports('app-region', 'drag'),
          colorMix: CSS.supports('color', 'color-mix(in srgb, red 50%, blue)'),
        },
        registerProperty: typeof CSS.registerProperty,
        atPropertyInitialValue: getComputedStyle(probe).getPropertyValue('--spike-angle').trim(),
        // task-card.js registers --op-angle (initial 0deg): set only if the page's own rule took.
        pageOpAngle: getComputedStyle(document.documentElement).getPropertyValue('--op-angle').trim(),
        fieldSizingGrows: { before, after },
      }
      box.remove()
      style.remove()
      const top = document.querySelector('.bt-side-top')
      result.sidebarDragRegion = top ? { found: true, webkitAppRegion: getComputedStyle(top).getPropertyValue('-webkit-app-region') || '(not computed)' } : { found: false }
      return result
    })

    // image-cell.js: navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]).
    // Runs without a click, so a refusal for want of a user gesture is expected here.
    report.clipboard = await attempt(async () => {
      const out = { ClipboardItem: typeof ClipboardItem, write: typeof navigator.clipboard?.write, supportsPng: typeof ClipboardItem?.supports === 'function' ? ClipboardItem.supports('image/png') : '(no supports())' }
      if (typeof ClipboardItem !== 'function') return out
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = 8
      const png = await new Promise(r => canvas.toBlob(r, 'image/png'))
      out.writeWithoutGesture = await settle(navigator.clipboard.write([new ClipboardItem({ [png.type]: png })]).then(() => 'resolved', e => `${e.name}: ${e.message}`), 4000).catch(e => String(e))
      return out
    })

    // A real click (SPIKE_PROBES=mic runs are interactive): the same write, with a user gesture.
    if (config.probes === 'mic') {
      const button = document.createElement('button')
      button.textContent = 'spike: copy image'
      button.id = 'spike-copy'
      button.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483647;padding:12px 18px;background:#c33;color:#fff;font:600 14px system-ui;border:0;border-radius:8px'
      button.addEventListener('click', async () => {
        const canvas = document.createElement('canvas')
        canvas.width = canvas.height = 8
        const png = await new Promise(r => canvas.toBlob(r, 'image/png'))
        const result = await navigator.clipboard.write([new ClipboardItem({ [png.type]: png })]).then(() => 'resolved', e => `${e.name}: ${e.message}`)
        button.textContent = `spike: ${result}`
        void send('clipboard-gesture', { result })
      })
      document.body.append(button)
    }

    report.other = {
      webview: typeof window.chrome,
      Notification: typeof Notification === 'function' ? Notification.permission : 'missing',
      serviceWorker: 'serviceWorker' in navigator,
      indexedDB: typeof indexedDB,
      showOpenFilePicker: typeof window.showOpenFilePicker,
      webkitRequestFullscreen: typeof document.documentElement.webkitRequestFullscreen,
      requestFullscreen: typeof document.documentElement.requestFullscreen,
      popover: typeof HTMLElement.prototype.showPopover,
      viewTransition: typeof document.startViewTransition,
      dialog: typeof HTMLDialogElement,
    }
    report.errors = errors.slice()
    return report
  }

  // Errors that arrive after the report still show up in the app's log.
  setTimeout(() => { if (remote && errors.length) void send('errors', { errors: errors.slice(0, 50) }) }, 30000)
})()
