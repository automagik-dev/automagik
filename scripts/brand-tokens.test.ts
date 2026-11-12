// docs/brand's colour tokens: the stylesheet and the record hold the same values, the status
// colours keep their pairs, and the rule about status dots is written where agents read it.
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const tokens = JSON.parse(read('docs/brand/tokens/tokens.json')).color.tokens as { name: string; value: string | Record<string, string>; usage: string }[]
const css = read('docs/brand/tokens/tokens.css')
const token = (name: string) => tokens.find(entry => entry.name === name)!

// The three blocks of tokens.css that set a theme: light, dark by choice, dark by the system.
const blocks = {
  light: css.match(/^:root,\[data-theme="light"\]\{([^}]*)\}$/m)?.[1],
  dark: css.match(/^\[data-theme="dark"\]\{([^}]*)\}$/m)?.[1],
  systemDark: css.match(/^@media \(prefers-color-scheme:dark\)\{:root:not\(\[data-theme="light"\]\)\{([^}]*)\}\}$/m)?.[1],
}
const declared = (block: string | undefined, name: string) => block?.split(';').find(part => part.startsWith(`--${name}:`))?.slice(name.length + 3)

describe('docs/brand colour tokens', () => {
  test('tokens.css sets every themed colour to the value tokens.json records, in all three theme blocks', () => {
    const themed = tokens.filter(entry => typeof entry.value !== 'string')
    expect(themed.length).toBeGreaterThan(30)
    for (const entry of themed) {
      const value = entry.value as Record<string, string>
      expect([entry.name, declared(blocks.light, entry.name)]).toEqual([entry.name, value.light])
      expect([entry.name, declared(blocks.dark, entry.name)]).toEqual([entry.name, value.dark])
      expect([entry.name, declared(blocks.systemDark, entry.name)]).toEqual([entry.name, value.dark])
    }
  })

  test('the app action colours are the status colours: bt-danger is st-bad, bt-green is st-ok', () => {
    expect(token('bt-danger').value).toEqual(token('st-bad').value)
    expect(token('bt-green').value).toEqual(token('st-ok').value)
  })

  test('a status dot never stands alone: the rule is in the README, on each dot colour and in the skill', () => {
    const colour = read('docs/brand/README.md').split('\n## Colour\n')[1]?.split('\n## ')[0] ?? ''
    expect(colour).toContain('every status dot has a word or a mark beside it')
    for (const name of ['st-okdot', 'st-warndot', 'st-work', 'st-bad']) expect([name, token(name).usage.includes('always with a word or a mark beside it')]).toEqual([name, true])
    expect(read('.claude/skills/automagik-brand/SKILL.md').replace(/\s+/g, ' ')).toContain('every one has a word or a mark beside it')
  })
})
