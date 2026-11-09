import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
const shellCss = read('src/shell.css')
const shellHtml = read('src/shell.html')
const shellJs = read('src/shell.js')
const PLATFORMS = ['linux', 'darwin', 'win32']

// The frame's stylesheet is hand-written and compact; these checks only need selectors and
// the app-region declaration, so this reader stays small.
function cssRules(source) {
  const text = source.replace(/\/\*[\s\S]*?\*\//g, '')
  const found = []
  let start = 0
  let depth = 0
  let bodyStart = 0
  let prelude = ''
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '{') {
      if (depth === 0) {
        prelude = text.slice(start, i).trim()
        bodyStart = i + 1
      }
      depth += 1
    } else if (text[i] === '}') {
      depth -= 1
      if (depth === 0) {
        if (!prelude.startsWith('@')) found.push({ prelude, body: text.slice(bodyStart, i) })
        start = i + 1
      }
    }
  }
  return found
}

const rules = cssRules(shellCss)
const appRegionOf = rule => rule.body.match(/(?:^|;)\s*(?:-webkit-)?app-region\s*:\s*(drag|no-drag)/)?.[1]

// Split on a comma that is outside `()` and `[]`, so `:is(button, a)` stays one selector.
function splitTop(text, separator = ',') {
  const parts = []
  let depth = 0
  let start = 0
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (char === '(' || char === '[') depth += 1
    else if (char === ')' || char === ']') depth -= 1
    else if (char === separator && depth === 0) {
      parts.push(text.slice(start, i))
      start = i + 1
    }
  }
  parts.push(text.slice(start))
  return parts.map(part => part.trim()).filter(Boolean)
}

// A complex selector as its compounds and the combinators between them.
function complex(selector) {
  const text = selector.trim()
  const tokens = []
  let current = ''
  let depth = 0
  let space = false
  const flush = () => {
    if (current) tokens.push({ compound: current })
    current = ''
  }
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (char === '(' || char === '[') depth += 1
    else if (char === ')' || char === ']') depth -= 1
    if (depth === 0 && /\s/.test(char)) {
      flush()
      const last = tokens[tokens.length - 1]
      if (!last || !last.combinator || last.combinator === ' ') space = true
      continue
    }
    if (depth === 0 && (char === '>' || char === '+' || char === '~')) {
      flush()
      tokens.push({ combinator: char })
      space = false
      continue
    }
    if (space) {
      tokens.push({ combinator: ' ' })
      space = false
    }
    current += char
  }
  flush()
  return {
    parts: tokens.filter(token => token.compound).map(token => token.compound),
    combinators: tokens.filter(token => token.combinator).map(token => token.combinator),
  }
}

// The index of the `]` or `)` that closes the bracket at `openIndex`.
function closing(text, openIndex) {
  const open = text[openIndex]
  const close = open === '[' ? ']' : ')'
  let depth = 0
  let quote = ''
  for (let i = openIndex; i < text.length; i++) {
    const char = text[i]
    if (quote) {
      if (char === quote && text[i - 1] !== '\\') quote = ''
      continue
    }
    if (char === '"' || char === "'") quote = char
    else if (char === open) depth += 1
    else if (char === close && --depth === 0) return i
  }
  return -1
}

function matchesCompound(element, raw) {
  let rest = raw.trim()
  if (!rest) return false
  if (rest === '*') return true
  const tag = rest.match(/^[a-zA-Z][\w-]*/)
  if (tag) {
    if (element.tag !== tag[0].toLowerCase()) return false
    rest = rest.slice(tag[0].length)
  }
  while (rest) {
    if (rest[0] === '*') {
      rest = rest.slice(1)
    } else if (rest[0] === '.') {
      const match = rest.match(/^\.([\w-]+)/)
      if (!match || !element.classes.has(match[1])) return false
      rest = rest.slice(match[0].length)
    } else if (rest[0] === '#') {
      const match = rest.match(/^#([\w-]+)/)
      if (!match || element.id !== match[1]) return false
      rest = rest.slice(match[0].length)
    } else if (rest[0] === '[') {
      const end = closing(rest, 0)
      if (end < 0) return false
      const attribute = rest.slice(1, end).trim()
      const match = attribute.match(/^([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s]+)))?$/)
      if (!match || !(match[1] in element.attrs)) return false
      if (match[2] !== undefined || match[3] !== undefined || match[4] !== undefined) {
        const wanted = match[2] ?? match[3] ?? match[4] ?? ''
        if (String(element.attrs[match[1]]) !== wanted) return false
      }
      rest = rest.slice(end + 1)
    } else if (rest.startsWith(':is(') || rest.startsWith(':where(') || rest.startsWith(':not(')) {
      const name = rest.slice(0, rest.indexOf('('))
      const open = rest.indexOf('(')
      const end = closing(rest, open)
      if (end < 0) return false
      const matched = splitTop(rest.slice(open + 1, end)).some(argument => matchesComplex(element, argument))
      if (name === ':not(' ? matched : !matched) return false
      rest = rest.slice(end + 1)
    } else if (rest.startsWith(':root')) {
      if (element.parent) return false
      rest = rest.slice(':root'.length)
    } else {
      // A state pseudo-class (:hover, :active) or a pseudo-element is not part of the page
      // at rest, so it cannot decide the app region of a control a person can click.
      return false
    }
  }
  return true
}

function matchesComplex(element, selector) {
  const { parts, combinators } = complex(selector)
  if (!parts.length || !matchesCompound(element, parts[parts.length - 1])) return false
  let node = element
  for (let i = parts.length - 2; i >= 0; i -= 1) {
    const combinator = combinators[i] ?? ' '
    if (combinator === '>') {
      node = node.parent
      if (!node || !matchesCompound(node, parts[i])) return false
    } else if (combinator === ' ') {
      node = node.parent
      while (node && !matchesCompound(node, parts[i])) node = node.parent
      if (!node) return false
    } else {
      return false
    }
  }
  return true
}

const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const bigger = (a, b) => (a[0] - b[0]) || (a[1] - b[1]) || (a[2] - b[2])

function compoundSpecificity(raw) {
  let rest = raw.trim()
  let specificity = [0, 0, 0]
  if (rest === '*') return specificity
  const tag = rest.match(/^[a-zA-Z][\w-]*/)
  if (tag) {
    specificity = add(specificity, [0, 0, 1])
    rest = rest.slice(tag[0].length)
  }
  while (rest) {
    if (rest[0] === '#') {
      specificity = add(specificity, [1, 0, 0])
      rest = rest.slice(rest.match(/^#[\w-]+/)[0].length)
    } else if (rest[0] === '.' || rest[0] === '[') {
      specificity = add(specificity, [0, 1, 0])
      rest = rest[0] === '.' ? rest.slice(rest.match(/^\.[\w-]+/)[0].length) : rest.slice(closing(rest, 0) + 1)
    } else if (rest.startsWith(':is(') || rest.startsWith(':not(') || rest.startsWith(':where(')) {
      const name = rest.slice(0, rest.indexOf('('))
      const open = rest.indexOf('(')
      const end = closing(rest, open)
      if (name !== ':where(') {
        const best = splitTop(rest.slice(open + 1, end)).map(specificityOf).reduce((a, b) => (bigger(a, b) >= 0 ? a : b))
        specificity = add(specificity, best)
      }
      rest = rest.slice(end + 1)
    } else if (rest.startsWith(':root')) {
      specificity = add(specificity, [0, 1, 0])
      rest = rest.slice(':root'.length)
    } else {
      rest = rest.slice(1)
    }
  }
  return specificity
}

function specificityOf(selector) {
  return complex(selector).parts.reduce((total, part) => add(total, compoundSpecificity(part)), [0, 0, 0])
}

const compare = (a, b) => {
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return a[i] - b[i]
  }
  return 0
}

// The app-region an element declares itself, by specificity and then source order.
function declaredAppRegion(element) {
  let winner = null
  rules.forEach((rule, index) => {
    const value = appRegionOf(rule)
    if (!value) return
    for (const selector of splitTop(rule.prelude)) {
      if (!matchesComplex(element, selector)) continue
      const score = [...specificityOf(selector), index]
      if (!winner || compare(score, winner.score) >= 0) winner = { value, score }
    }
  })
  return winner?.value
}

// A drag region covers its whole rectangle: a child with no app-region of its own sits in the
// nearest ancestor's region. That is why the bar can drag while only its controls opt out.
function appRegion(element) {
  for (let node = element; node; node = node.parent) {
    const declared = declaredAppRegion(node)
    if (declared) return declared
  }
  return undefined
}

function element(tag, attrs = {}, parent = null) {
  const normalized = Object.fromEntries(Object.entries(attrs).map(([name, value]) => [name.toLowerCase(), value]))
  return {
    tag: tag.toLowerCase(),
    attrs: normalized,
    classes: new Set(String(normalized.class ?? '').split(/\s+/).filter(Boolean)),
    id: normalized.id,
    parent,
    children: [],
  }
}

function walk(node, visit) {
  visit(node)
  for (const child of node.children) walk(child, visit)
}

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'])

function parseAttributes(source) {
  const attrs = {}
  const pattern = /([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g
  let match
  while ((match = pattern.exec(source))) attrs[match[1]] = match[2] ?? match[3] ?? match[4] ?? ''
  return attrs
}

// The bar subtree as elements, hung under a body that carries the platform class shell.js adds.
function barTree(platform) {
  const match = shellHtml.match(/<header class="bar">[\s\S]*?<\/header>/)
  assert.ok(match, 'shell.html has the top bar')
  const body = element('body', { class: platform })
  const stack = [body]
  const tags = /<!--[\s\S]*?-->|<\/([a-zA-Z][\w:-]*)\s*>|<([a-zA-Z][\w:-]*)((?:\s+[^<>]*?)?)\s*(\/?)>/g
  let tag
  while ((tag = tags.exec(match[0]))) {
    if (tag[1]) {
      const index = stack.map(node => node.tag).lastIndexOf(tag[1].toLowerCase())
      if (index > 0) stack.length = index
    } else if (tag[2]) {
      const node = element(tag[2], parseAttributes(tag[3] ?? ''), stack[stack.length - 1])
      stack[stack.length - 1].children.push(node)
      if (!VOID.has(node.tag) && !tag[4]) stack.push(node)
    }
  }
  return body.children.find(node => node.classes.has('bar'))
}

function interactive(node) {
  return ['a', 'button', 'input', 'label', 'select', 'summary', 'textarea'].includes(node.tag) ||
    node.classes.has('brand') || node.classes.has('controls') ||
    ['button', 'checkbox', 'link', 'menu', 'menubar', 'menuitem', 'menuitemcheckbox',
      'menuitemradio', 'option', 'radio', 'slider', 'switch', 'tab'].includes(node.attrs.role) ||
    'aria-haspopup' in node.attrs || 'tabindex' in node.attrs || 'data-menu' in node.attrs
}

test('the top bar drags the window, and its empty space still drags on every platform', () => {
  const barRule = rules.find(rule => splitTop(rule.prelude).includes('.bar'))
  assert.equal(appRegionOf(barRule), 'drag', 'the bar itself is the drag region')
  for (const platform of PLATFORMS) {
    const bar = barTree(platform)
    assert.equal(appRegion(bar), 'drag', `${platform}: the bar drags the window`)
    const spacer = bar.children.find(node => node.classes.has('spacer'))
    assert.equal(appRegion(spacer), 'drag', `${platform}: the empty bar space still drags`)
    const empty = element('div', { class: 'empty-space' }, bar)
    bar.children.push(empty)
    assert.equal(appRegion(empty), 'drag', `${platform}: a later empty area still drags`)
  }
})

test('every interactive item in the top bar is no-drag on every platform', () => {
  for (const platform of PLATFORMS) {
    const body = barTree(platform).parent
    const items = []
    walk(body, node => {
      if (node.classes.has('bar')) return
      if (interactive(node)) items.push(node)
    })
    const buttons = items.filter(node => node.tag === 'button')
    assert.deepEqual(buttons.map(node => node.attrs['data-act']), ['minimize', 'maximize', 'close'],
      `${platform}: the three window controls are still in the bar`)
    assert.ok(items.some(node => node.classes.has('controls')), `${platform}: the controls container is found`)
    assert.ok(items.some(node => node.classes.has('brand')), `${platform}: the brand is found`)
    for (const item of items) {
      assert.equal(appRegion(item), 'no-drag',
        `${platform}: ${item.tag}${item.classes.size ? `.${[...item.classes].join('.')}` : ''} must take clicks`)
    }
  }
})

test('a control added to the top bar later is no-drag without a new rule', () => {
  const added = [
    ['button', {}],
    ['a', { href: '#' }],
    ['input', { type: 'text' }],
    ['select', {}],
    ['textarea', {}],
    ['div', { role: 'button' }],
    ['div', { role: 'menu' }],
    ['div', { role: 'menuitem' }],
    ['div', { 'aria-haspopup': 'menu' }],
    ['div', { 'data-menu': 'bar' }],
    ['div', { tabindex: '0' }],
  ]
  for (const platform of PLATFORMS) {
    const bar = barTree(platform)
    for (const [tag, attrs] of added) {
      const control = element(tag, attrs, bar)
      bar.children.push(control)
      assert.equal(appRegion(control), 'no-drag', `${platform}: a new ${tag} in the bar must be no-drag`)
      bar.children.pop()
    }
  }
})

test('the no-drag exception is not Linux-only and the bar menu still reaches its handler', () => {
  // The old rule lived on body.linux .controls; the current one must cover the bar's items on
  // every platform, the brand included, because a drag region swallows its right click too.
  const barNoDrag = rules.filter(rule => appRegionOf(rule) === 'no-drag' &&
    splitTop(rule.prelude).some(selector => selector.includes('.bar') && selector !== '.bar'))
  assert.ok(barNoDrag.length > 0, 'the bar has a no-drag rule')
  for (const rule of barNoDrag) {
    for (const selector of splitTop(rule.prelude)) {
      assert.doesNotMatch(selector, /^body\.(linux|darwin|win32)\b/,
        `the bar's no-drag rule must be platform-neutral: ${selector}`)
    }
  }
  for (const platform of PLATFORMS) {
    const bar = barTree(platform)
    const brand = bar.children.find(node => node.classes.has('brand'))
    assert.equal(appRegion(brand), 'no-drag', `${platform}: the brand is the bar menu's no-drag surface`)
  }
  // The three custom buttons still show on Linux and stay out of macOS's way there.
  assert.match(shellCss, /body\.linux \.controls\{[^}]*display:flex/)
  assert.match(shellCss, /body\.darwin \.controls\{[^}]*display:none/)
  assert.match(shellJs, /querySelector\('\.bar'\)\.addEventListener\('contextmenu'/)
  assert.match(shellJs, /act\('menu'\)/)
  assert.match(shellJs, /querySelectorAll\('\.controls \[data-act\]'\)/)
})
