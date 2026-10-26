// Bakes the team's character catalogue into Codex pet packages, the way every live mark
// plays them (src/client/pet-bake.js, the same code): one folder per character, with a
// pet.json, a v2 spritesheet.webp and the DSH extension's sleep.webp, then checks each
// atlas with the pet toolkit's validator (skills/hatch-pet/scripts/validate_atlas.py, run
// through uv with Pillow; skipped, and said so, when uv is missing). Omni in clay comes too.
//
//   node dev/pets/bake-catalogue.mjs <out-dir> [--color <ink>] [--only shape,shape]
//
// Each character takes a color of its own from the defaults, or --color for all of them. A
// folder can go straight into ~/.codex/pets. Chrome: CHROME_BIN, else playwright's own;
// playwright-core comes from dev/harness, else PLAYWRIGHT_CORE (a playwright-core folder).
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { playwright } from '../desktop-linux/lib.mjs'

const PLUGIN = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
const args = process.argv.slice(2)
const out = args[0] && !args[0].startsWith('--') ? resolve(args[0]) : undefined
if (!out) {
  console.error('usage: node dev/pets/bake-catalogue.mjs <out-dir> [--color <ink>] [--only shape,shape]')
  process.exit(2)
}
const flag = name => { const at = args.indexOf(name); return at > 0 ? args[at + 1] : undefined }
const only = flag('--only')?.split(',').map(name => name.trim()).filter(Boolean)

// The client code, with React stubbed: baking draws on a canvas and renders nothing.
const bundle = await build({
  stdin: {
    contents: "export { bakeBlobs } from './src/client/pet-bake.js'\nexport { CHARACTERS, DEFAULT_COLORS } from './src/client/characters.js'",
    resolveDir: PLUGIN,
  },
  bundle: true, format: 'iife', globalName: 'PetBake', platform: 'browser', write: false, logLevel: 'silent',
  plugins: [{ name: 'no-react', setup(b) {
    b.onResolve({ filter: /^react$/ }, () => ({ path: 'react', namespace: 'stub' }))
    b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'export const createElement = () => null, useEffect = () => {}, useRef = () => ({}), useState = v => [v, () => {}], Fragment = "f"', loader: 'js' }))
  } }],
})

const loadPlaywright = async () => {
  try {
    return playwright(join(PLUGIN, 'dev', 'harness'))
  } catch (error) {
    if (!process.env.PLAYWRIGHT_CORE) throw new Error(`no playwright-core in dev/harness; set PLAYWRIGHT_CORE (${error.message.split('\n')[0]})`)
    const module = await import(pathToFileURL(join(resolve(process.env.PLAYWRIGHT_CORE), 'index.mjs')).href)
    return module.default ?? module
  }
}
const { chromium } = await loadPlaywright()
const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN, headless: true, args: ['--force-color-profile=srgb'] })
const page = await browser.newPage()
await page.setContent('<!doctype html><title>bake</title>')
await page.addScriptTag({ content: bundle.outputFiles[0].text })

const catalogue = await page.evaluate(() => Object.entries(globalThis.PetBake.CHARACTERS).map(([shape, character]) => ({ shape, label: character.label ?? shape[0].toUpperCase() + shape.slice(1) })))
const colors = await page.evaluate(() => globalThis.PetBake.DEFAULT_COLORS)
const looks = [
  ...catalogue.filter(entry => !only || only.includes(entry.shape)).map((entry, index) => ({ id: `automagik-${entry.shape}`, name: entry.label, look: { shape: entry.shape, color: flag('--color') ?? colors[index % colors.length] } })),
  ...(!only || only.includes('omni') ? [{ id: 'automagik-omni', name: 'Omni', look: { clay: 'omni' } }] : []),
]

let uv = true
try { execFileSync('uv', ['--version'], { stdio: 'ignore' }) } catch { uv = false }
const validator = join(PLUGIN, 'dev', 'pets', 'skills', 'hatch-pet', 'scripts', 'validate_atlas.py')
const failures = []
for (const { id, name, look } of looks) {
  const files = await page.evaluate(async (wanted) => {
    const { sheet, sleep } = await globalThis.PetBake.bakeBlobs(wanted, 1)
    // Base64 out of the page, in slices small enough to spread into fromCharCode.
    const encode = async (blob) => {
      const bytes = new Uint8Array(await blob.arrayBuffer())
      let text = ''
      for (let index = 0; index < bytes.length; index += 0x8000) text += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
      return btoa(text)
    }
    return { sheet: await encode(sheet), sleep: await encode(sleep) }
  }, look)
  const dir = join(out, id)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'spritesheet.webp'), Buffer.from(files.sheet, 'base64'))
  writeFileSync(join(dir, 'sleep.webp'), Buffer.from(files.sleep, 'base64'))
  writeFileSync(join(dir, 'pet.json'), `${JSON.stringify({ id, displayName: name, description: `${name}, an Automagik Bot character${look.color ? ` in ${look.color}` : ' in clay'}.`, spriteVersionNumber: 2, spritesheetPath: 'spritesheet.webp' }, null, 2)}\n`)
  let verdict = 'not validated (no uv)'
  if (uv) {
    try {
      execFileSync('uv', ['run', '-q', '--no-project', '--with', 'Pillow>=10', 'python', '-I', validator, join(dir, 'spritesheet.webp'), '--json-out', join(dir, 'validation.json')], { stdio: 'ignore' })
      verdict = 'valid'
    } catch {
      verdict = 'INVALID (see validation.json)'
      failures.push(id)
    }
  }
  console.log(`${id}: ${verdict}`)
}
await browser.close()
console.log(`${looks.length} pets in ${out}${failures.length ? `; invalid: ${failures.join(', ')}` : ''}`)
process.exit(failures.length ? 1 : 0)
