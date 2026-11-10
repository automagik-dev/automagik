// An image an agent makes with its own tools in a chat (Codex's built-in image tool, or another
// agent's call titled as image generation): the card in the chat follows it
// while it is made, and the image itself is kept where the chat can show it. Two parts:
//
// - The picture. The mirror tool (tool.js) takes the PNG from the call's own update: an ACP
//   PNG image block in its content, or its `rawOutput.result`. Only an image-generation call is
//   read this way: a Read, a screenshot or a view of an image answers with an image block too,
//   and keeps its own result. It never opens
//   the file the agent saved (Codex's `rawOutput.savedPath` under CODEX_HOME). It hands the bytes
//   to the image keeper a chat plugin registered (`acpAgents.keepImages`, the Bot team's images
//   folder), and the call's result names the kept file, never the agent's.
// - The reply. The agent's own words then link the image by the local path it saved it at
//   (Codex answers `![image](/home/…/.codex/generated_images/….png)`), which no chat can show and
//   which names a folder on the person's computer. `ImageLinks` takes those links (and a bare path
//   into a `generated_images` folder) out of the text as it streams, before DSH writes it down, so
//   the stored reply, the chat and any later replay carry none.
import { IMAGE_TITLE, isPng } from './image.js'

/** The result text of a kept image: the Bot team's card finds the image id after it. */
export const KEPT_TEXT = 'Image generated and saved as'

// A title that names image generation: Codex's own, and the obvious spellings of another agent's.
const IMAGE_TITLES = /^(?:image generation|generate[ _]image|image[ _]gen(?:eration)?)\b/i

// A call's structured name is its identity where the agent sends one (Claude Code does; Codex
// sends none, so its image tool is known by its exact title and nothing else, #871). A built-in
// tool (a name that is not an MCP one: Bash, Read, Write) is what its name says: a command
// titled `generate_image.py` is a command, and keeps its own result.
const builtInName = tool => (typeof tool?.structuredName === 'string' && tool.structuredName !== '' && !tool.structuredName.startsWith('mcp__') ? tool.structuredName : undefined)

/** Whether a call is an image-generation call, by what the agent titled or named it. */
export const isImageCall = (tool) => {
  if (typeof tool?.title !== 'string') return false
  if (tool.title === IMAGE_TITLE || IMAGE_TITLES.test(String(tool.structuredName ?? ''))) return true
  return builtInName(tool) === undefined && IMAGE_TITLES.test(tool.title.trim())
}

/**
 * The PNG an image-generation call answered with, as base64: the first ACP `image/png` block in
 * its content, else its `rawOutput.result`. Never its saved file. Undefined for any other call
 * (a Read or a screenshot that answers with an image did not make one), or when it carries no PNG.
 */
export function agentImageOf(tool) {
  if (!isImageCall(tool)) return undefined
  for (const item of Array.isArray(tool?.content) ? tool.content : []) {
    const block = item?.type === 'content' ? item.content : item
    if (block?.type === 'image' && block.mimeType === 'image/png' && typeof block.data === 'string' && block.data !== '') return block.data
  }
  const result = tool.rawOutput?.result
  return typeof result === 'string' && result !== '' ? result : undefined
}

export { isPng }

// --- the reply's local links -------------------------------------------------------------------

const LOCAL = /^(?:file:\/\/|~[\\/]|\/|[A-Za-z]:[\\/])/
const GENERATED = /(?:^|[\\/])generated_images[\\/]/
const PATH_LIKE = /[\\/]/
const LINK = /(!?)\[([^\]\n]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"\n]*")?\s*\)/g
const BARE = /(?<![\w:/.\\~-])(?:file:\/\/)?(?:~|[A-Za-z]:)?[\\/][^\s)\]>'"`]*generated_images[\\/][^\s)\]>'"`]+/g
// How much text a pending link or path may hold back before it goes out as it is.
const HOLD_MAX = 2048
const PLAIN = 'the image'

const bare = target => target.replace(/^file:\/\//, '')

/**
 * The text with the agent's links to its own saved images taken out: a markdown image to a local
 * path in a `generated_images` folder, or to one of `saved` (the paths the agent's image calls
 * reported), is removed; a plain link to one keeps its label (or says "the image" when the label
 * is itself a path); a bare such path reads "the image". Other links are left alone.
 * @param {string} text
 * @param {Iterable<string>} [saved]
 */
export function scrubImageLinks(text, saved = []) {
  const known = new Set([...saved].map(bare))
  const ours = target => LOCAL.test(target) && (GENERATED.test(bare(target)) || known.has(bare(target)))
  return String(text)
    .replace(LINK, (whole, image, label, target) => {
      if (!ours(target)) return whole
      if (image === '!') return ''
      return label.trim() === '' || PATH_LIKE.test(label) ? PLAIN : label
    })
    .replace(BARE, PLAIN)
}

// Where a link or path still being written starts, so it is held until it is whole.
function pendingFrom(text) {
  // A trailing "!" may open a markdown image.
  let from = text.endsWith('!') ? text.length - 1 : text.length
  const open = text.lastIndexOf('[')
  if (open !== -1) {
    const rest = text.slice(open)
    if (/^\[[^\]\n]*$/.test(rest) || /^\[[^\]\n]*\]$/.test(rest) || /^\[[^\]\n]*\]\([^)\n]*$/.test(rest)) {
      from = open > 0 && text[open - 1] === '!' ? open - 1 : open
    }
  }
  const space = Math.max(text.lastIndexOf(' '), text.lastIndexOf('\n'), text.lastIndexOf('\t'))
  const token = text.slice(space + 1)
  // A word that may begin a path (a slash, a home "~", a drive "C:") waits for its end.
  if (/[\\/~:]/.test(token)) from = Math.min(from, space + 1)
  return text.length - from > HOLD_MAX ? text.length : from
}

/**
 * The scrubber for one stream of the agent's text: `push` a chunk and get what is safe to show
 * now; a link or path that may still be completing is held, and `flush` lets it go at the end of
 * a block.
 */
export class ImageLinks {
  /** @param {() => Iterable<string>} [saved] the paths the agent's image calls reported */
  constructor(saved = () => []) {
    this.saved = saved
    this.held = ''
  }

  push(text) {
    const raw = this.held + text
    let cut = pendingFrom(raw)
    // A whole link or path is never cut in two: one the cut falls inside waits with the rest.
    for (const pattern of [LINK, BARE]) {
      for (const match of raw.matchAll(pattern)) {
        if (match.index < cut && cut < match.index + match[0].length) cut = match.index
      }
    }
    this.held = raw.slice(cut)
    return scrubImageLinks(raw.slice(0, cut), this.saved())
  }

  flush() {
    const rest = this.held === '' ? '' : scrubImageLinks(this.held, this.saved())
    this.held = ''
    return rest
  }
}

/**
 * The paths an agent's image calls said they saved to (Codex's `rawOutput.savedPath`, or a local
 * image block's uri). Another call's image (a file it read) is not the agent's to scrub.
 */
export function savedPathsOf(tools) {
  const paths = []
  for (const tool of tools ?? []) {
    if (!isImageCall(tool)) continue
    const saved = tool?.rawOutput?.savedPath ?? tool?.rawOutput?.saved_path
    if (typeof saved === 'string' && saved !== '') paths.push(saved)
    for (const item of Array.isArray(tool?.content) ? tool.content : []) {
      const block = item?.type === 'content' ? item.content : item
      if (block?.type === 'image' && typeof block.uri === 'string' && LOCAL.test(block.uri)) paths.push(block.uri)
    }
  }
  return paths
}
