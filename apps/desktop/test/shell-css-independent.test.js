// An independent guard for issue #845, derived from its acceptance and PR #878's description:
// the top bar is the window's drag region, while every bar item that takes input is no-drag on
// every platform, so a new control cannot inherit the drag region and swallow its clicks.
//
// The stylesheet is read as CSS text. An element's app-region is the declaration of the winning
// matching rule (specificity, then source order); an element with no declaration sits in the
// region of its nearest declared ancestor. That is why the bar can drag while its content does
// not, and why a later control needs no new rule.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

// macOS is the reported failure, so it is checked first; all three platforms are covered.
const PLATFORMS = ['darwin', 'linux', 'win32']
const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
const css = read('src/shell.css')
const html = read('src/shell.html')
const js = read('src/shell.js')

const REGION = /(?:^|;)\s*(?:-webkit-)?app-region\s*:\s*(drag|no-drag)\b/
const PLATFORM_CLASS = /\.(?:linux|darwin|win32)(?![\w-])/

// Top-level style rules; at-rules (fonts, keyframes, media) carry no app-region here, and an
// app-region that only applies under a media or state condition would not be the at-rest one.
function styleRules(text) {
  const clean = text.replace(/\/\*[\s\S]*?\*\//g, '')
  const rules = []
  let index = 0
  while (index < clean.length) {
    while (index < clean.length && /\s/.test(clean[index])) index += 1
    if (index >= clean.length) break
    const start = index
    while (index < clean.length && clean[index] !== '{') index += 1
    if (index >= clean.length) break
    const prelude = clean.slice(start, index).trim()
    const bodyStart = index + 1
    let depth = 1
    index += 1
    while (index < clean.length && depth > 0) {
      if (clean[index] === '{') depth += 1
      else if (clean[index] === '}') depth -= 1
      index += 1
    }
    if (prelude && !prelude.startsWith('@')) {
      rules.push({ prelude, body: clean.slice(bodyStart, index - 1), order: rules.length })
    }
  }
  return rules
}

const RULES = styleRules(css)
const declaredValue = rule => rule.body.match(REGION)?.[1]

// Split a selector list on commas that are not inside `()` or `[]` (quotes included).
function selectorsOf(prelude) {
  const found = []
  let start = 0
  let depth = 0
  let quote = ''
  for (let index = 0; index < prelude.length; index += 1) {
    const char = prelude[index]
    if (quote) {
      if (char === quote && prelude[index - 1] !== '\\') quote = ''
      continue
    }
    if (char === '"' || char === "'") quote = char
    else if (char === '(' || char === '[') depth += 1
    else if (char === ')' || char === ']') depth -= 1
    else if (char === ',' && depth === 0) {
      found.push(prelude.slice(start, index).trim())
      start = index + 1
    }
  }
  found.push(prelude.slice(start).trim())
  return found.filter(Boolean)
}

// The index of the bracket closing the one at `open`, honouring nesting and quoted values.
function closing(text, open) {
  const close = text[open] === '[' ? ']' : ')'
  let depth = 0
  let quote = ''
  for (let index = open; index < text.length; index += 1) {
    const char = text[index]
    if (quote) {
      if (char === quote && text[index - 1] !== '\\') quote = ''
      continue
    }
    if (char === '"' || char === "'") quote = char
    else if (char === text[open]) depth += 1
    else if (char === close && --depth === 0) return index
  }
  return -1
}

// A complex selector as its compounds (rightmost last) and the combinator before each one.
function compoundsOf(selector) {
  const parts = []
  const links = []
  let current = ''
  let depth = 0
  let quote = ''
  let next = ' '
  const flush = () => {
    const compound = current.trim()
    current = ''
    if (!compound) return
    if (parts.length) links.push(next)
    parts.push(compound)
    next = ' '
  }
  for (let index = 0; index < selector.length; index += 1) {
    const char = selector[index]
    if (quote) {
      current += char
      if (char === quote && selector[index - 1] !== '\\') quote = ''
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      current += char
    } else if (char === '(' || char === '[') {
      depth += 1
      current += char
    } else if (char === ')' || char === ']') {
      depth -= 1
      current += char
    } else if (depth === 0 && /\s/.test(char)) {
      flush()
    } else if (depth === 0 && (char === '>' || char === '+' || char === '~')) {
      flush()
      next = char
    } else {
      current += char
    }
  }
  flush()
  return { parts, links }
}

function attributeMatches(element, expression) {
  const parsed = expression.trim().match(
    /^([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?$/,
  )
  if (!parsed) return false
  const name = parsed[1].toLowerCase()
  if (!(name in element.attrs)) return false
  const wanted = parsed[2] ?? parsed[3] ?? parsed[4]
  return wanted === undefined || String(element.attrs[name]) === wanted
}

function matchesCompound(element, compound) {
  let rest = compound.trim()
  if (!rest) return false
  if (rest === '*') return true
  const tag = rest.match(/^[a-zA-Z][\w-]*/)
  if (tag) {
    if (element.tag !== tag[0].toLowerCase()) return false
    rest = rest.slice(tag[0].length)
  }
  while (rest) {
    if (rest.startsWith('*')) {
      rest = rest.slice(1)
      continue
    }
    if (rest[0] === '.') {
      const match = rest.match(/^\.([\w-]+)/)
      if (!match || !element.classes.has(match[1])) return false
      rest = rest.slice(match[0].length)
      continue
    }
    if (rest[0] === '#') {
      const match = rest.match(/^#([\w-]+)/)
      if (!match || element.id !== match[1]) return false
      rest = rest.slice(match[0].length)
      continue
    }
    if (rest[0] === '[') {
      const end = closing(rest, 0)
      if (end < 0 || !attributeMatches(element, rest.slice(1, end))) return false
      rest = rest.slice(end + 1)
      continue
    }
    if (rest.startsWith(':is(') || rest.startsWith(':where(') || rest.startsWith(':not(')) {
      const open = rest.indexOf('(')
      const end = closing(rest, open)
      if (end < 0) return false
      const hit = selectorsOf(rest.slice(open + 1, end)).some(argument =>
        matchesComplex(element, argument))
      if (rest.startsWith(':not(') ? hit : !hit) return false
      rest = rest.slice(end + 1)
      continue
    }
    if (rest.startsWith(':root')) {
      if (element.parent) return false
      rest = rest.slice(':root'.length)
      continue
    }
    // A state pseudo-class (:hover, :active) or a pseudo-element is not the resting page: it
    // cannot decide whether a control takes a click.
    return false
  }
  return true
}

function matchesComplex(element, selector) {
  const { parts, links } = compoundsOf(selector)
  if (!parts.length || !matchesCompound(element, parts[parts.length - 1])) return false
  let node = element
  for (let index = parts.length - 2; index >= 0; index -= 1) {
    const link = links[index] ?? ' '
    if (link === '>') {
      node = node.parent
      if (!node || !matchesCompound(node, parts[index])) return false
    } else if (link === ' ') {
      node = node.parent
      while (node && !matchesCompound(node, parts[index])) node = node.parent
      if (!node) return false
    } else {
      return false
    }
  }
  return true
}

const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const compare = (a, b) => (a[0] - b[0]) || (a[1] - b[1]) || (a[2] - b[2])

function specificityOfCompound(compound) {
  let rest = compound.trim()
  let score = [0, 0, 0]
  if (rest === '*') return score
  const tag = rest.match(/^[a-zA-Z][\w-]*/)
  if (tag) {
    score = add(score, [0, 0, 1])
    rest = rest.slice(tag[0].length)
  }
  while (rest) {
    if (rest[0] === '#') {
      const match = rest.match(/^#[\w-]+/)
      score = add(score, [1, 0, 0])
      rest = rest.slice(match[0].length)
    } else if (rest[0] === '.') {
      const match = rest.match(/^\.[\w-]+/)
      score = add(score, [0, 1, 0])
      rest = rest.slice(match[0].length)
    } else if (rest[0] === '[') {
      const end = closing(rest, 0)
      if (end < 0) return score
      score = add(score, [0, 1, 0])
      rest = rest.slice(end + 1)
    } else if (rest.startsWith(':is(') || rest.startsWith(':not(') ||
      rest.startsWith(':where(')) {
      const open = rest.indexOf('(')
      const end = closing(rest, open)
      if (end < 0) return score
      if (!rest.startsWith(':where(')) {
        let best = [0, 0, 0]
        for (const argument of selectorsOf(rest.slice(open + 1, end))) {
          best = compare(specificityOf(argument), best) > 0 ? specificityOf(argument) : best
        }
        score = add(score, best)
      }
      rest = rest.slice(end + 1)
    } else if (rest[0] === ':') {
      const match = rest.match(/^:[\w-]+/)
      if (!match) return score
      if (match[0] !== ':where') score = add(score, [0, 1, 0])
      rest = rest.slice(match[0].length)
    } else {
      rest = rest.slice(1)
    }
  }
  return score
}

function specificityOf(selector) {
  return compoundsOf(selector).parts
    .reduce((total, compound) => add(total, specificityOfCompound(compound)), [0, 0, 0])
}

// The app-region an element declares for itself, by specificity and then source order.
function declaredFor(element) {
  let winner = null
  for (const rule of RULES) {
    const value = declaredValue(rule)
    if (!value) continue
    for (const selector of selectorsOf(rule.prelude)) {
      if (!matchesComplex(element, selector)) continue
      const score = specificityOf(selector)
      if (winner && compare(score, winner.score) < 0) continue
      if (winner && compare(score, winner.score) === 0 && rule.order < winner.order) continue
      winner = { value, score, order: rule.order, selector }
    }
  }
  return winner
}

function regionOf(element) {
  for (let node = element; node; node = node.parent) {
    const declaration = declaredFor(node)
    if (declaration) return declaration.value
  }
  return undefined
}

function element(tag, attrs = {}, parent = null) {
  const normalized = {}
  for (const [name, value] of Object.entries(attrs)) normalized[name.toLowerCase()] = value
  return {
    tag: tag.toLowerCase(),
    attrs: normalized,
    classes: new Set(String(normalized.class ?? '').split(/\s+/).filter(Boolean)),
    id: normalized.id,
    parent,
    children: [],
  }
}

function append(parent, tag, attrs = {}) {
  const node = element(tag, attrs, parent)
  parent.children.push(node)
  return node
}

function walk(node, visit) {
  visit(node)
  for (const child of node.children) walk(child, visit)
}

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link',
  'meta', 'param', 'source', 'track', 'wbr'])

function parseAttributes(text) {
  const attrs = {}
  const pattern = /([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g
  let match
  while ((match = pattern.exec(text))) {
    const name = match[1].toLowerCase()
    if (!(name in attrs)) attrs[name] = match[2] ?? match[3] ?? match[4] ?? ''
  }
  return attrs
}

// The real bar subtree as elements, under a body that carries the platform class shell.js adds.
function barTree(platform) {
  const header = html.match(/<header\b([^>]*)>([\s\S]*?)<\/header>/)
  assert.ok(header, 'shell.html has the top bar header')
  const body = element('body', { class: platform })
  const bar = element('header', parseAttributes(header[1]), body)
  body.children.push(bar)
  assert.ok(bar.classes.has('bar'), 'the header is the bar')
  const stack = [bar]
  const tags = /<!--[\s\S]*?-->|<\/([a-zA-Z][\w:-]*)\s*>|<([a-zA-Z][\w:-]*)([^>]*)>/g
  let token
  while ((token = tags.exec(header[2]))) {
    if (token[1]) {
      const name = token[1].toLowerCase()
      for (let index = stack.length - 1; index > 0; index -= 1) {
        if (stack[index].tag === name) {
          stack.length = index
          break
        }
      }
    } else if (token[2]) {
      const name = token[2].toLowerCase()
      const raw = token[3] ?? ''
      const selfClosing = /\/\s*$/.test(raw)
      const attrs = parseAttributes(selfClosing ? raw.replace(/\/\s*$/, '') : raw)
      const node = append(stack[stack.length - 1], name, attrs)
      if (!selfClosing && !VOID.has(name)) stack.push(node)
    }
  }
  return bar
}

const INPUT_TAGS = new Set(['a', 'button', 'input', 'label', 'select', 'summary', 'textarea'])
const WIDGET_ROLES = new Set(['button', 'checkbox', 'link', 'menu', 'menubar', 'menuitem',
  'menuitemcheckbox', 'menuitemradio', 'option', 'radio', 'slider', 'switch', 'tab'])

function interactive(node) {
  return INPUT_TAGS.has(node.tag) || node.classes.has('brand') || node.classes.has('controls') ||
    WIDGET_ROLES.has(node.attrs.role) || 'aria-haspopup' in node.attrs ||
    'tabindex' in node.attrs || 'data-menu' in node.attrs
}

function describe(node) {
  const classes = [...node.classes].map(name => `.${name}`).join('')
  const attrs = ['data-act', 'role', 'aria-haspopup', 'data-menu', 'tabindex']
    .filter(name => name in node.attrs)
    .map(name => `[${name}=${node.attrs[name]}]`)
    .join('')
  return `${node.tag}${classes}${attrs}`
}

test('the bar drags the window, and its sanctioned empty surface still drags on every platform', () => {
  const barRule = RULES.find(rule => selectorsOf(rule.prelude).includes('.bar'))
  assert.ok(barRule, 'shell.css declares the bar rule')
  assert.equal(declaredValue(barRule), 'drag', 'the bar itself is the window drag region')
  for (const platform of PLATFORMS) {
    const bar = barTree(platform)
    assert.equal(regionOf(bar), 'drag', `${platform}: the bar drags the window`)
    const spacer = bar.children.find(child => child.classes.has('spacer'))
    assert.ok(spacer, `${platform}: the bar still has its empty spacer`)
    assert.equal(regionOf(spacer), 'drag', `${platform}: the spacer is empty bar space and drags`)
    // The bar's own padding and gaps are inside its drag region too. The .spacer is the one
    // sanctioned empty child: any other child is no-drag by default, because a control that
    // inherits the drag region swallows its own clicks (issue #845).
    const empty = append(bar, 'div', { class: 'future-empty-area' })
    assert.equal(regionOf(empty), 'no-drag',
      `${platform}: a new unclassed area is no-drag by default, not a drag region`)
  }
})

test('every interactive item in the real top bar is no-drag on every platform', () => {
  for (const platform of PLATFORMS) {
    const bar = barTree(platform)
    const items = []
    walk(bar, node => {
      if (node !== bar && interactive(node)) items.push(node)
    })
    const buttons = items.filter(node => node.tag === 'button')
    assert.deepEqual(buttons.map(node => node.attrs['data-act']).sort(),
      ['close', 'maximize', 'minimize'], `${platform}: the three window controls are in the bar`)
    const brand = items.find(node => node.classes.has('brand'))
    const controls = items.find(node => node.classes.has('controls'))
    assert.ok(brand, `${platform}: the brand, the bar's right-click surface, is in the bar`)
    assert.ok(controls, `${platform}: the controls container is in the bar`)
    assert.equal(regionOf(bar), 'drag', `${platform}: the bar still drags around its items`)
    for (const item of items) {
      assert.equal(regionOf(item), 'no-drag',
        `${platform}: ${describe(item)} must take clicks, not drag the window`)
    }
    // The nearest declared ancestor carries the region to content that declares none: the
    // brand's mark and label, and each button's icon, sit inside no-drag.
    for (const container of [brand, controls]) {
      walk(container, node => {
        assert.equal(regionOf(node), 'no-drag',
          `${platform}: ${describe(node)} is inside a no-drag ancestor`)
      })
    }
  }
})

test('the old Linux-only controls no-drag is gone and its display rules are unchanged', () => {
  const ruleFor = selector => RULES.find(rule =>
    selectorsOf(rule.prelude).includes(selector))
  const linux = ruleFor('body.linux .controls')
  const mac = ruleFor('body.darwin .controls')
  assert.ok(linux, 'shell.css still has the Linux custom-controls display rule')
  assert.ok(mac, 'shell.css still has the macOS custom-controls display rule')
  assert.match(linux.body, /display\s*:\s*flex/,
    'Linux still shows the custom window controls')
  assert.match(mac.body, /display\s*:\s*none/,
    'macOS still hides the custom window controls, keeping its traffic lights')
  assert.equal(declaredValue(linux), undefined,
    'the old body.linux .controls no-drag rule is gone')
  assert.equal(declaredValue(mac), undefined, 'the macOS display rule declares no app-region')
  // No equivalent platform-only controls opt-out may come back under another selector.
  const noDragRules = RULES.filter(rule => declaredValue(rule) === 'no-drag')
  assert.ok(noDragRules.length > 0, 'shell.css has a no-drag rule')
  for (const rule of noDragRules) {
    for (const selector of selectorsOf(rule.prelude)) {
      assert.doesNotMatch(selector, PLATFORM_CLASS,
        `the no-drag exception must not be platform-qualified: ${selector}`)
    }
  }
})

test('a new control of each kind in the bar is no-drag without a new rule', () => {
  const additions = [
    ['button', {}],
    ['a', { href: '#' }],
    ['input', { type: 'text' }],
    ['select', {}],
    ['textarea', {}],
    ['summary', {}],
    ['div', { role: 'menu' }],
    ['div', { role: 'menuitem' }],
    ['div', { 'aria-haspopup': 'menu' }],
    ['div', { 'data-menu': 'bar' }],
    // Kinds the old enumerated allowlist did not name: the default must cover them instead.
    ['details', {}],
    ['option', {}],
    ['video', { controls: '' }],
    ['am-menu', {}],
    ['am-button', {}],
    ['div', { contenteditable: 'true' }],
  ]
  for (const platform of PLATFORMS) {
    for (const [tag, attrs] of additions) {
      const bar = barTree(platform)
      const spacer = bar.children.find(child => child.classes.has('spacer'))
      const item = append(bar, tag, attrs)
      assert.equal(regionOf(item), 'no-drag',
        `${platform}: a new ${describe(item)} in the bar must take clicks, not drag the window`)
      const winner = declaredFor(item)
      assert.ok(winner, `${platform}: the existing stylesheet covers a new ${describe(item)}`)
      assert.doesNotMatch(winner.selector, PLATFORM_CLASS,
        `the rule covering a new ${describe(item)} must cover every platform: ${winner.selector}`)
      // The sanctioned spacer still drags beside the new control, while a new unclassed filler
      // is no-drag by default: control-safe, at the cost of an unknown empty filler being
      // inert instead of dragging. A filler that must drag is .spacer.
      assert.equal(regionOf(spacer), 'drag',
        `${platform}: the empty space beside a new ${describe(item)} still drags`)
      const empty = append(bar, 'div', { class: 'future-empty-area' })
      assert.equal(regionOf(empty), 'no-drag',
        `${platform}: a new unclassed filler beside a new ${describe(item)} is inert`)
    }
  }
})

// A structural guard over the real markup: the bar subtree may put only its own empty box and
// the .spacer in the drag region. An unknown control, of a custom tag or any other kind, must
// resolve no-drag without a new rule — the safe default the enumerated allowlist lacked.
test('the real bar subtree has no drag surface for a control, only its empty surface drags', () => {
  for (const platform of PLATFORMS) {
    const bar = barTree(platform)
    const spacer = bar.children.find(child => child.classes.has('spacer'))
    assert.ok(spacer, `${platform}: the bar has its sanctioned empty spacer`)
    assert.equal(regionOf(bar), 'drag', `${platform}: the bar's own box still drags`)
    assert.equal(regionOf(spacer), 'drag', `${platform}: the spacer still drags`)
    walk(bar, node => {
      if (node === bar || node === spacer) return
      assert.equal(regionOf(node), 'no-drag',
        `${platform}: ${describe(node)} in the real bar must take clicks, not drag the window`)
    })
    const unknown = append(bar, 'am-menu', {})
    assert.equal(regionOf(unknown), 'no-drag',
      `${platform}: an unknown custom-element control is no-drag by default`)
  }
})

test('shell.js still wires the bar menu and the window-control handlers', () => {
  const bridge = js.match(/const \{([^}]*)\} = window\.omniWindow/)
  assert.ok(bridge, 'shell.js takes the preload bridge')
  for (const name of ['platform', 'act', 'onState']) {
    assert.match(bridge[1], new RegExp(`\\b${name}\\b`),
      `shell.js takes ${name} from the preload bridge`)
  }
  assert.match(js, /body\.classList\.add\(platform\)/,
    'shell.js puts the platform class on the body for the platform-qualified rules')
  const menu = js.match(
    /document\.querySelector\('\.bar'\)\.addEventListener\('contextmenu',[\s\S]*?\n\}\)/,
  )
  assert.ok(menu, 'shell.js listens for a contextmenu on the bar, the menu surface')
  assert.match(menu[0], /preventDefault\(\)/, 'the menu handler cancels the native menu')
  assert.match(menu[0], /act\('menu'\)/, 'the menu handler opens the bar menu')
  const controls = js.match(/document\.querySelectorAll\('\.controls \[data-act\]'\)[^\n]*/)
  assert.ok(controls, 'shell.js wires the window controls by their data-act')
  assert.match(controls[0], /addEventListener\('click'/,
    'each window control has a click handler')
  assert.match(controls[0], /act\(button\.dataset\.act\)/,
    'each click asks the main process to act')
  for (const act of ['minimize', 'maximize', 'close']) {
    assert.match(html, new RegExp(`data-act="${act}"`), `shell.html has the ${act} control`)
  }
  assert.equal((html.match(/\bdata-act="/g) ?? []).length, 3,
    'shell.html has exactly the three window controls')
})
