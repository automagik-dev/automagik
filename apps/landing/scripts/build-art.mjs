// Derived site art: crops and 1x/2x WebP of Automagik's own art and of the unchanged,
// provenance-backed captures in assets/screens. Nothing is drawn, recoloured or retouched:
// each file is one rectangle of one source, scaled with Lanczos. The manifest records the
// source, its SHA-256, the rectangle and the output's SHA-256; landing.test.mjs checks them.
// Needs ffmpeg/ffprobe with libwebp. Run from anywhere: node apps/landing/scripts/build-art.mjs
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const landing = resolve(fileURLToPath(new URL('..', import.meta.url)))
const repo = resolve(landing, '../..')
const out = join(landing, 'assets/art')
const sha = buffer => createHash('sha256').update(buffer).digest('hex')

// A capture's light and dark pictures: the same rectangle of screen.png and screen-dark.png.
const twins = (name, screen, rect, width) => [
  [name, `apps/landing/assets/screens/${screen}.png`, rect, width],
  [`${name}-dark`, `apps/landing/assets/screens/${screen}-dark.png`, rect, width],
]
// [name, source (repo-relative), rectangle [x, y, w, h] in source pixels or 'trim', 1x width]
export const ART = [
  ['genie', 'apps/desktop/assets/dmg-source/genie.png', 'trim', 220],
  ['omni', 'apps/landing/assets/brand/omni-pleased.png', 'trim', 260],
  ['lamp', 'apps/bots-dsh/src/client/art/lamp.webp', 'trim', 128],
  ['pet', 'apps/bots-dsh/src/host/pets/automagik/spritesheet.webp', [0, 0, 192, 208], 96],
  ['app-icon', 'apps/landing/assets/brand/app-icon.png', 'trim', 112],
  ['genie-faces', 'apps/bots-dsh/src/client/art/genie-expressions.webp', 'trim', 504],
  ['omni-faces', 'apps/bots-dsh/src/client/art/omni-expressions.webp', 'trim', 504],
  // Captures: one rectangle each of the unchanged files in assets/screens. Each has a dark
  // twin (name-dark) cut from the dark capture of the same view with the same rectangle.
  ...twins('team-chat', 'pip-delegates', [0, 0, 2200, 1440], 1040),
  ...twins('team-chat-phone', 'pip-delegates-phone', [0, 36, 780, 1516], 390),
  ...twins('app-review', 'wish-diff', [0, 0, 2560, 1548], 1040),
  ...twins('app-review-crop', 'wish-diff', [0, 0, 1900, 1440], 760),
  ...twins('thread-phone', 'wish-checks-phone', [0, 0, 780, 1200], 390),
  ...twins('ask', 'pip-delegates-phone', [0, 36, 780, 470], 390),
  ...twins('checks', 'wish-checks-phone', [0, 536, 780, 624], 390),
  ...twins('report', 'genie-report-phone', [0, 456, 780, 588], 390),
  ...twins('team-step', 'team-step', [440, 0, 2000, 1560], 600),
  ...twins('omni-card', 'team-step', [500, 838, 940, 962], 400),
  ['code-tree', 'apps/landing/assets/screens/code-sidebar.png', [0, 0, 722, 668], 361],
  ...['home', 'chat', 'code'].flatMap(screen => [
    [`pocket-${screen}`, `apps/landing/assets/screens/pocket-${screen}-light.png`, [0, 0, 1179, 2556], 300],
    [`pocket-${screen}-dark`, `apps/landing/assets/screens/pocket-${screen}-dark.png`, [0, 0, 1179, 2556], 300],
  ]),
]

function probe(path) {
  const [width, height] = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', path], { encoding: 'utf8' }).trim().split(',').map(Number)
  return { width, height }
}
// The tight box around pixels with alpha above a small threshold, plus a 2px margin.
function trimBox(path) {
  const { width, height } = probe(path)
  const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', path, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { maxBuffer: 1 << 28 })
  let left = width, right = -1, top = height, bottom = -1
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (raw[(y * width + x) * 4 + 3] > 8) { if (x < left) left = x; if (x > right) right = x; if (y < top) top = y; if (y > bottom) bottom = y }
  }
  assert.ok(right >= left, `${path} has no opaque pixels`)
  const pad = 2
  left = Math.max(0, left - pad); top = Math.max(0, top - pad)
  right = Math.min(width - 1, right + pad); bottom = Math.min(height - 1, bottom + pad)
  return [left, top, right - left + 1, bottom - top + 1]
}
function encode(source, [x, y, w, h], width, target, alpha) {
  const height = Math.round(h * width / w)
  const filter = `crop=${w}:${h}:${x}:${y},scale=${width}:${height}:flags=lanczos`
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', source, '-frames:v', '1', '-vf', filter, '-c:v', 'libwebp', '-quality', alpha ? '90' : '86',
    '-compression_level', '6', '-preset', alpha ? 'picture' : 'text', ...(alpha ? ['-pix_fmt', 'yuva420p'] : ['-pix_fmt', 'yuv420p']), '-metadata', 'comment=', '-map_metadata', '-1', target])
  return { width, height }
}
export async function buildArt() {
  await mkdir(out, { recursive: true })
  for (const file of await readdir(out)) if (file.endsWith('.webp')) await rm(join(out, file))
  const files = {}
  for (const [name, source, rect, width] of ART) {
    const path = join(repo, source)
    const box = rect === 'trim' ? trimBox(path) : rect
    const size = probe(path)
    assert.ok(box[0] + box[2] <= size.width && box[1] + box[3] <= size.height, `${name}: rectangle outside ${source}`)
    const alpha = !source.includes('/screens/')
    for (const [suffix, scale] of [['', 1], ['-2x', 2]]) {
      const w = Math.min(width * scale, box[2])
      const file = `${name}${suffix}.webp`
      const dims = encode(path, box, w, join(out, file), alpha)
      files[file] = { source, sourceSha256: sha(await readFile(path)), rect: box, width: dims.width, height: dims.height, sha256: sha(await readFile(join(out, file))) }
    }
  }
  const manifest = { builtBy: 'node apps/landing/scripts/build-art.mjs', tool: execFileSync('ffmpeg', ['-version'], { encoding: 'utf8' }).split('\n')[0].split(' Copyright')[0], files }
  await writeFile(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
  return manifest
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const manifest = await buildArt()
  for (const [file, entry] of Object.entries(manifest.files)) console.log(file, `${entry.width}x${entry.height}`)
}
