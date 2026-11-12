// docs/brand's rules on marks, where agents read them: the triskle is Automagik's alone, the
// Genie and Omni lockups are retired and stay as files, and a product shows as its word.
import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'

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

  test('"Which logo file" sends Genie and Omni to their word, and to a lockup only to say it is retired', () => {
    for (const row of rows) if (/(genie|omni|mykes)-lockup/.test(row)) expect(row).toContain('RETIRED')
    const row = (start: string) => rows.find(line => line.startsWith(`| ${start} |`)) ?? ''
    for (const name of ['genie', 'omni']) expect(row('Genie or Omni')).toContain(`\`logo/wordmark/${name}-wordmark-ink.svg\``)
    for (const name of ['genie', 'omni']) {
      for (const tone of ['ink', 'cream']) {
        const file = `docs/brand/logo/wordmark/${name}-wordmark-${tone}.svg`
        expect([file, existsSync(at(file))]).toEqual([file, true])
      }
    }
  })

  test('the two later rules are written: a flat one-colour mark, and the word until a mark is approved', () => {
    expect(rules).toContain("9. **Every mark that is not Automagik's is flat and one colour.** The sparkle of its word is its only colour")
    expect(rules).toContain('10. **Until the owner approves its mark, a product shows as its word.** Genie, Omni and Mykes each appear as the name')
    expect(rules).toContain('the plain words "Coming soon." stand')
    expect(flat(SKILL)).toContain('Genie, Omni and Mykes each show as their word')
    expect(flat(SKILL)).toContain('flat and one colour, with its word\'s sparkle as the only colour')
  })
})
