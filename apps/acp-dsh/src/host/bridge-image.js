// Two guards for the images of a DSH tool result on its way to an ACP agent over the bridge
// (backchannel.js `contentOf`, #920):
//
// - The store read. A durable attachment is read from DSH's attachment store, and a read that
//   never settles would hold the bridge call for good. The read gets an abort signal and a
//   deadline; past it the call goes on with the text placeholder. The deadline is one budget for
//   all the images of a result, so many slow reads cannot add up past the bridge's own wait for
//   the call (bridge.js, 60 s).
// - The image nobody reads. `contentImages` (acp.js) reads arrays and `content` wrappers. An
//   image anywhere else in the result (inside a resource, under another key) used to vanish
//   without a trace. It is not sent to the model in a shape nobody asked for: its place becomes
//   the same one-line text placeholder, with its own reason.
import { AsyncLocalStorage } from 'node:async_hooks'
import { contentImages } from './acp.js'

/**
 * How long the attachment reads of one tool result have, all together, before the result goes
 * on without the pictures still unread. A read is a local file of a few MiB at most; the bridge
 * gives the whole call 60 s (bridge.js), and this stays well inside it.
 */
export const IMAGE_READ_MS = 10_000

/**
 * When the reads of a result must be over. The budget belongs to the result being answered,
 * not to its image blocks (two results may carry the very same block object, and a block is
 * handed on exactly as the tool made it), so it travels with the asynchronous work of that
 * answer: `bridgeImages` opens it, and every read that follows in the same answer finds it.
 * Each bridge call is answered in its own asynchronous context, so two results never share or
 * move each other's deadline. It starts at the result's first read and is counted on a clock
 * that only moves forward.
 */
export const resultBudget = new AsyncLocalStorage()
/** The clock the budgets are counted on (a test moves it instead of waiting). */
export const budgetClock = { now: () => performance.now() }
const elapsed = () => budgetClock.now()

/**
 * How long the next attachment read of the result being answered may take: what is left of
 * its budget, or the whole of one when no result is being answered here.
 * @param {() => number} [now] a clock in milliseconds that never goes back
 */
export function readMsOf(now = elapsed) {
  const budget = resultBudget.getStore()
  if (budget === undefined) return IMAGE_READ_MS
  const at = now()
  budget.until ??= at + IMAGE_READ_MS
  return Math.max(0, budget.until - at)
}

/**
 * One image from the attachment store, read with an abort signal and within `ms`. Undefined
 * when no store is mounted or it reads no image; it rejects when the store does, or when the
 * read is not over after `ms` (the signal is aborted then, so a store that honours it stops).
 * @param {{ readImage?: (ref: any, signal?: AbortSignal) => Promise<any> } | undefined} attachments
 * @param {any} ref
 * @param {number} [ms]
 * @param {{ setTimeout: Function, clearTimeout: Function }} [timers]
 */
export async function readStoredImage(attachments, ref, ms = IMAGE_READ_MS, timers = globalThis) {
  // Read once: a store may hand its reader out through a getter.
  const reader = attachments?.readImage
  if (typeof reader !== 'function') return undefined
  const overdue = () => Object.assign(new Error('the attachment was not read in time'), { code: 'acp_image_read_timeout' })
  // A result whose budget is already spent reads nothing more.
  if (!(ms > 0)) throw overdue()
  const controller = new AbortController()
  let timer
  const late = new Promise((_, fail) => {
    timer = timers.setTimeout(() => {
      const error = overdue()
      controller.abort(error)
      fail(error)
    }, ms)
  })
  try {
    // Called as the store's own method. A store that throws before it returns a promise is a
    // rejection like any other. The race keeps listening to a read that lost it, so its late
    // rejection (the abort it was just sent) is never an unhandled one.
    const read = Promise.resolve().then(() => Reflect.apply(reader, attachments, [ref, controller.signal]))
    return await Promise.race([read, late])
  } finally {
    timers.clearTimeout(timer)
  }
}

/** Why a nested image is a placeholder. */
export const NESTED_REASON = "nested deeper than a tool result's content"
/** Why a result that could not be searched to its end says so. */
export const UNSEARCHED_REASON = 'the result is too deep or too large to look for nested images'
// How much of a result the search for nested images reads (how deep, and how many values in
// all), and how many nested images it reports one by one.
export const MAX_DEPTH = 16
export const MAX_VALUES = 20_000
const MAX_REPORTED = 8

// A media type as a placeholder may name it: the plain `type/subtype` form and nothing else. A
// tool result chooses these strings, and a placeholder is text the agent's model reads, so
// anything longer, with a space, a line break or a bracket is not repeated.
const MEDIA_TYPE = /^[A-Za-z0-9][A-Za-z0-9.+-]{0,63}\/[A-Za-z0-9][A-Za-z0-9.+-]{0,63}$/
const mediaTypeOf = value => (typeof value === 'string' && MEDIA_TYPE.test(value) ? value : undefined)

/**
 * The media type an image block's attachment reference names, when it is a plain one.
 * @param {any} block
 * @returns {string | undefined}
 */
export const refMediaType = (block) => {
  // A reference that can no longer be read names nothing; it does not cost the placeholder.
  try { return mediaTypeOf(block?.attachment?.mediaType) } catch { return undefined }
}

// The media type of an MCP embedded resource that holds an image (`{ type: 'resource',
// resource: { mimeType: 'image/…', blob } }`), or undefined for any other value.
function resourceImageType(node) {
  if (node.type !== 'resource' || node.resource === null || typeof node.resource !== 'object') return undefined
  const { mimeType, blob } = node.resource
  if (typeof mimeType !== 'string' || !/^image\//i.test(mimeType) || typeof blob !== 'string' || blob === '') return undefined
  // An image whatever it calls itself; named only when the name is a plain media type.
  return mediaTypeOf(mimeType) ?? UNNAMED
}

// The images in `content` that `contentImages` does not return: their media types in the order
// they are met (UNNAMED for one that names no plain type), and whether the search stopped
// before the end. It reads arrays and plain objects only: never the inside of a string, and
// never bytes (a Buffer, a typed array). Every value it looks at is counted, so a wide, deep or
// cyclic result costs a bounded amount. It reads plain fields and never runs a getter. A part
// that cannot be read at all (an object that throws when looked at) ends the search as a
// result it could not read to its end: the result itself is still answered.
function nestedImages(content, read) {
  const types = []
  const seen = new Set()
  let values = 0
  let cut = false
  // `own`: reached from the top through arrays and `content` wrappers only, which is the path
  // `contentImages` follows to any depth. That path is not counted in levels, so an image the
  // bridge reads is always reached and never taken for one too deep to look at.
  const walk = (node, depth, own) => {
    if (cut) return
    values += 1
    if (values > MAX_VALUES) {
      cut = true
      return
    }
    if (node === null || typeof node !== 'object' || ArrayBuffer.isView(node) || node instanceof ArrayBuffer || seen.has(node)) return
    // An image `contentImages` returned is the result's own, however deep its wrappers put it:
    // it is not reported, and not a level too deep. What it holds is still looked into.
    const known = read.has(node)
    if (depth > MAX_DEPTH && !known) {
      cut = true
      return
    }
    seen.add(node)
    if (Array.isArray(node)) {
      for (let index = 0; index < node.length && !cut; index += 1) walk(node[index], own ? depth : depth + 1, own)
      return
    }
    // An image found is reported and looked into all the same: one inside another is one more.
    if (known) {
      // The result's own: nothing to report.
    } else if (node.type === 'image') {
      types.push(mediaTypeOf(node.mimeType) ?? mediaTypeOf(node.mediaType) ?? mediaTypeOf(node.attachment?.mediaType) ?? UNNAMED)
    } else {
      const resource = resourceImageType(node)
      if (resource !== undefined) types.push(resource)
    }
    const wrapper = own && node.type === 'content'
    for (const key in node) {
      if (cut) return
      // Plain fields only: a field computed on reading (a getter) is not run to look inside it.
      const field = Object.getOwnPropertyDescriptor(node, key)
      if (field === undefined || !('value' in field)) continue
      const followed = wrapper && key === 'content'
      walk(field.value, followed ? depth : depth + 1, followed)
    }
  }
  try {
    walk(content, 0, true)
  } catch {
    cut = true
  }
  return { types, cut }
}

// The markers `bridgeImages` made, and each one's reason. A marker is known by being one of
// these objects, never by a field, so nothing a tool result carries can pass for one.
const markers = new WeakMap()

// The label of an image that names no plain media type.
const UNNAMED = 'unknown media type'

// `label` is one of this module's own words or a media type `mediaTypeOf` passed.
function marker(label, reason = NESTED_REASON) {
  const block = { type: 'image' }
  markers.set(block, `[image unavailable: ${label}; ${reason}]`)
  return block
}

/**
 * The one-line text that stands for a nested image's marker, or undefined for any other block.
 * @param {object} block
 * @returns {string | undefined}
 */
export const nestedPlaceholder = block => markers.get(block)

/**
 * The image blocks of a DSH tool result for the bridge: the ones `contentImages` reads, the
 * very objects and in their order, then one marker for each image found deeper. Calling it
 * opens the result's read budget (`resultBudget`). A marker has no `data` and no `attachment`,
 * so it can only ever become its text placeholder (`nestedPlaceholder`). Past eight nested
 * images one marker counts the rest, and a result the search could not read to its end gets a
 * last marker saying so: no image is dropped without a word.
 * @param {any} content
 * @returns {any[]}
 */
export function bridgeImages(content) {
  const images = contentImages(content)
  resultBudget.enterWith({ until: undefined })
  const { types, cut } = nestedImages(content, new Set(images))
  if (types.length === 0 && !cut) return images
  const reported = types.slice(0, MAX_REPORTED).map(type => marker(type))
  const more = types.length - reported.length
  if (more > 0) reported.push(marker(`${more} more`))
  if (cut) reported.push(marker('any other nested image', UNSEARCHED_REASON))
  return [...images, ...reported]
}
