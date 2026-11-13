// docs/brand's rules on marks, where agents read them: the triskle is Automagik's alone, the
// Genie and Omni lockups that carry it are retired and stay as files, Genie and Omni each show
// with their own approved mark, whose files are byte copies of the handed-over ones, and Mykes
// shows as its word until its mark's file is confirmed.
import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'

const at = (path: string) => new URL(`../${path}`, import.meta.url)
const read = (path: string) => readFileSync(at(path), 'utf8')
const flat = (path: string) => read(path).replace(/\s+/g, ' ')
const section = (text: string, title: string) => text.split(`\n## ${title}\n`)[1]?.split('\n## ')[0] ?? ''

const README = 'docs/brand/README.md'
const LOGO = 'docs/brand/logo/README.md'
const SKILL = '.claude/skills/automagik-brand/SKILL.md'
const rules = section(read(README), 'The rules')
const rows = section(read(README), 'Which logo file').split('\n').filter(line => line.startsWith('| '))
// The lines of a text that name both retired sets of files.
const naming = (path: string) => read(path).split('\n').filter(line => line.includes('genie-lockup-*') && line.includes('omni-lockup-*'))

describe("docs/brand's marks", () => {
  test("the triskle is Automagik's alone: the rules, the logo's note and the skill say so", () => {
    expect(rules).toContain("1. **The triskle is Automagik's mark, and Automagik's alone.** Genie, Omni and Mykes do not carry it")
    expect(rules).not.toContain('all carry the same mark')
    expect(rules).toContain("2. **Automagik's triskle is always in colour.**")
    expect(read(LOGO).split('\n')[2]).toStartWith("The triskle is Automagik's mark, and Automagik's alone.")
    expect(flat(SKILL)).toContain("The triskle is Automagik's mark alone. Genie, Omni and Mykes do not carry it")
  })

  test('the Genie and Omni lockups are retired in the README, the logo note and the skill, and the files stay', () => {
    for (const path of [README, LOGO, SKILL]) {
      const parts = naming(path)
      expect([path, parts.length > 0, parts.every(part => part.includes('RETIRED'))]).toEqual([path, true, true])
    }
    for (const name of ['genie', 'omni']) {
      for (const kind of ['three-colours-ink', 'three-colours-cream', 'ink', 'cream']) {
        for (const size of ['', '-header']) {
          const file = `docs/brand/logo/lockups/${name}-lockup-${kind}${size}.svg`
          expect([file, existsSync(at(file))]).toEqual([file, true])
        }
      }
    }
  })

  test('"Which logo file" sends each product to its own lockup, and to a triskle lockup only to say it is retired', () => {
    for (const row of rows) if (/(genie|omni|mykes)-lockup/.test(row)) expect(row).toContain('RETIRED')
    const row = (start: string) => rows.find(line => line.startsWith(`| ${start} |`)) ?? ''
    expect(row('Genie')).toContain('`logo/lockups/genie-lamp-lockup-ink.svg`')
    expect(row('Omni, in a header or anywhere under about 56px high')).toContain('`logo/lockups/omni-mark-lockup-ink-header.svg`')
    expect(row('Omni, 56px high or more')).toContain('`logo/lockups/omni-mark-lockup-ink.svg`')
    expect(row("Omni's mark alone under about 56px")).toContain('`logo/svg/omni-mark-ink-32.svg`')
    for (const mark of ['genie-lamp', 'omni-mark']) {
      expect(row("Genie's or Omni's mark alone")).toContain(`\`logo/svg/${mark}-ink.svg\``)
    }
    // Mykes has no row and no file: its mark's drawing is not confirmed.
    expect(rows.filter(line => /mykes/i.test(line))).toEqual([])
    // Every file the table names is here.
    for (const [, path] of rows.join('\n').matchAll(/`((?:logo|favicon)\/[^`*<]+\.(?:svg|ico|png))`/g)) {
      expect([path, existsSync(at(`docs/brand/${path}`))]).toEqual([path, true])
    }
    for (const name of ['genie', 'omni']) expect(row("Genie's or Omni's name without the mark")).toContain(`\`logo/wordmark/${name}-wordmark-ink.svg\``)
    for (const name of ['genie', 'omni']) {
      for (const tone of ['ink', 'cream']) {
        const file = `docs/brand/logo/wordmark/${name}-wordmark-${tone}.svg`
        expect([file, existsSync(at(file))]).toEqual([file, true])
      }
    }
  })

  test('the two later rules are written: a flat one-colour mark, approved for Genie and Omni, and Mykes as its word', () => {
    expect(rules).toContain("9. **Every mark that is not Automagik's is flat and one colour.** The sparkle of its word is its only colour")
    expect(rules).toContain("Genie's mark is a flat lamp and Omni's is a tentacle vortex.")
    expect(rules).toContain('The owner approved them on 12 November 2026 and confirmed it on 13 November 2026, in his words: "Yes, I approved them". Neither carries the triskle.')
    expect(rules).toContain("the drawing handed over is not confirmed to be that one, so no file for Mykes's mark is here")
    expect(rules).toContain('10. **Genie and Omni show as their own mark with their word; Mykes shows as its word.** Genie and Omni each have a lockup')
    expect(rules).toContain('ended for the two with the approval in rule 9')
    expect(rules).toContain("Mykes appears as its name in the brand's lettering, with no mark beside it, until its mark's file is confirmed and in this folder")
    expect(rules).toContain('the plain words "Coming soon." stand')
    expect(rules).toContain('never the triskle, never a pet, never another drawing')
    // The word-only rule for Genie and Omni is gone from every place an agent reads.
    for (const path of [README, LOGO, SKILL]) {
      for (const old of ['Until the owner approves its mark', 'show as their word', 'a product shows as its word', 'None is approved', 'neither is drawn or approved']) {
        expect([path, old, flat(path).includes(old)]).toEqual([path, old, false])
      }
    }
    expect(flat(SKILL)).toContain('Genie and Omni each have their own mark: a flat lamp, a tentacle vortex.')
    expect(flat(SKILL)).toContain("Mykes shows as its word, with no mark beside it, until its mark's file is confirmed and in this folder.")
    expect(read(LOGO).split('\n')[2]).toContain("Mykes shows as its word until its mark's file is confirmed")
    expect(flat(SKILL)).toContain('flat and one colour, with its word\'s sparkle as the only colour')
  })

  test("Genie's and Omni's files are byte copies: each has the sha256 the logo note records, and no Mykes file is here", () => {
    const record = section(read(LOGO), "Where Genie's and Omni's files came from")
    const listed = [...record.matchAll(/^\| `((?:svg|lockups)\/[^`]+\.svg)` \| `[^`]+` \| `([0-9a-f]{64})` \|$/gm)]
    expect(listed.map(([, path]) => path).sort()).toEqual(
      [
        ...['genie-lamp', 'omni-mark'].flatMap(mark => ['ink', 'cream'].flatMap(tone => [`svg/${mark}-${tone}.svg`, `lockups/${mark}-lockup-${tone}.svg`])),
        ...['ink', 'cream'].flatMap(tone => [`svg/omni-mark-${tone}-32.svg`, `lockups/omni-mark-lockup-${tone}-header.svg`]),
      ].sort(),
    )
    for (const [, path, sha256] of listed) {
      const bytes = readFileSync(at(`docs/brand/logo/${path}`))
      expect([path, createHash('sha256').update(bytes).digest('hex')]).toEqual([path, sha256])
    }
    for (const folder of ['svg', 'lockups', 'wordmark', 'png']) {
      expect([folder, readdirSync(at(`docs/brand/logo/${folder}`)).filter(name => /mykes/i.test(name))]).toEqual([folder, []])
    }
  })

  test("Genie's and Omni's marks are each one flat shape in one colour, and a lockup adds only the sparkle and never the triskle", () => {
    const tones = { ink: '#3c3049', cream: '#f3e9dd' }
    const sparkle: Record<string, string[]> = { 'genie-lamp': ['#ee5496'], 'omni-mark': ['#15bde0'] }
    const colours = (svg: string) => [...new Set([...svg.matchAll(/(?:fill|stroke|color|stop-color)="([^"]+)"/g)].map(([, value]) => value))].sort()
    for (const [tone, colour] of Object.entries(tones)) {
      for (const mark of ['genie-lamp', 'omni-mark']) {
        for (const size of mark === 'omni-mark' ? ['', '-32'] : ['']) {
          const svg = read(`docs/brand/logo/svg/${mark}-${tone}${size}.svg`)
          expect([mark, tone, size, colours(svg), svg.match(/<path/g)?.length]).toEqual([mark, tone, size, [colour], 1])
          expect(/<(mask|filter|linearGradient|radialGradient|image|script|use)\b|opacity/.test(svg)).toBe(false)
        }
        for (const size of mark === 'omni-mark' ? ['', '-header'] : ['']) {
          const svg = read(`docs/brand/logo/lockups/${mark}-lockup-${tone}${size}.svg`)
          expect([mark, tone, size, colours(svg)]).toEqual([mark, tone, size, [colour, 'currentColor', ...sparkle[mark]].sort()])
          expect(/<(mask|filter|linearGradient|radialGradient|image|script|use)\b|opacity/.test(svg)).toBe(false)
          expect(/viewBox="0 -186 [0-9.]+ 264"/.test(svg)).toBe(true)
        }
      }
    }
  })
})
