// The web app's name, for an instance that sets one. DSH's page carries its own name in two
// places the plugin can't configure: dist/manifest.webmanifest ("DeepSeek Harness", short "DSH")
// and the <title> of index.html. DSH's web server answers a named route before its static files,
// and runs index.html through tapIndex transforms, so a configured `appManifest` serves its own
// manifest on the exact path the page links, an icon beside it, and swaps the <title>.
//
// Off unless configured: the bridge also runs in DSHs people already have, and those keep DSH's
// name. A config without both names is refused, and the plugin then changes nothing.
import { readFileSync } from 'node:fs'
import { extname, isAbsolute } from 'node:path'

export const MANIFEST_PATH = '/manifest.webmanifest'
export const MANIFEST_TYPE = 'application/manifest+json'
const ICON_BASE = '/unfold-bridge/app-icon'
const ICON_TYPES = { '.svg': 'image/svg+xml', '.png': 'image/png' }
// DSH's own icon entry, kept when no icon is configured.
const DSH_ICON = { src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }
const MAX_NAME = 120
const COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i

const text = (value, max) => typeof value === 'string' && value.trim() !== '' && value.length <= max

/**
 * Read `config.appManifest`. Unset gives null; a malformed one gives null and a refusal line.
 * @returns {{ name, short_name, theme_color?, background_color?, icon? } | null}
 */
export function appManifestOf(config, { warn = () => {}, read = readFileSync } = {}) {
  const raw = config?.appManifest
  if (raw === undefined || raw === null) return null
  const refuse = why => {
    warn(`appManifest refused (${why}); the page keeps DSH's own name`)
    return null
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) return refuse('not an object')
  if (!text(raw.name, MAX_NAME) || !text(raw.short_name, MAX_NAME)) return refuse('name and short_name are required')
  const app = { name: raw.name, short_name: raw.short_name }
  for (const key of ['theme_color', 'background_color']) {
    if (raw[key] === undefined) continue
    if (typeof raw[key] !== 'string' || !COLOR.test(raw[key])) return refuse(`${key} is not a #hex color`)
    app[key] = raw[key]
  }
  if (raw.icon !== undefined) {
    const type = typeof raw.icon === 'string' ? ICON_TYPES[extname(raw.icon).toLowerCase()] : undefined
    if (!type || !isAbsolute(raw.icon)) return refuse('icon is not an absolute path to an .svg or .png file')
    let body
    try {
      body = read(raw.icon)
    } catch (error) {
      return refuse(`icon unreadable: ${error?.code ?? 'error'}`)
    }
    app.icon = { path: `${ICON_BASE}${extname(raw.icon).toLowerCase()}`, type, body }
  }
  return app
}

/** The manifest DSH's page would get, with the configured names, colors and icon. */
export function manifestOf(app) {
  return {
    name: app.name,
    short_name: app.short_name,
    start_url: './',
    scope: './',
    display: 'fullscreen',
    ...(app.theme_color ? { theme_color: app.theme_color } : {}),
    ...(app.background_color ? { background_color: app.background_color } : {}),
    // Relative to the manifest's URL, as DSH's own entry is.
    icons: [app.icon ? { src: app.icon.path.slice(1), sizes: 'any', type: app.icon.type, purpose: 'any' } : DSH_ICON],
  }
}

// GET and HEAD, as DSH's static files answer.
function answer(type, body) {
  return async (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { allow: 'GET, HEAD' })
      return res.end()
    }
    res.writeHead(200, { 'content-type': type })
    res.end(req.method === 'HEAD' ? undefined : body)
  }
}

/** Exact webServer routes: the manifest, and the icon when one is configured. */
export function appManifestRoutes(app) {
  const routes = [{ kind: 'exact', path: MANIFEST_PATH, handler: answer(MANIFEST_TYPE, Buffer.from(JSON.stringify(manifestOf(app), null, 2))) }]
  if (app.icon) routes.push({ kind: 'exact', path: app.icon.path, handler: answer(app.icon.type, app.icon.body) })
  return routes
}

const escapeHtml = value => value.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`)

/** A tapIndex transform that puts the configured name in index.html's <title>. */
export function titleTap(name) {
  const title = `<title>${escapeHtml(name)}</title>`
  return html => html.replace(/<title>[^<]*<\/title>/i, () => title)
}
