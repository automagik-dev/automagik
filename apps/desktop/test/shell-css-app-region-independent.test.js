// An independent guard for issue #845 and PR #941, derived from the issue's acceptance rows:
//
//   1. every interactive item in the top bar — buttons, menus, window controls, and a new or
//      custom kind — is no-drag on linux, darwin and win32;
//   2. the sanctioned empty surface — the bar's own padding and flex gaps, plus .spacer —
//      still drags the window;
//   3. structurally, a new bar control cannot inherit the drag region by default.
//
// This file shares no helper with test/shell-css.test.js or test/shell-css-independent.test.js.
// It reads the real stylesheet and markup, compiles the selectors that matter into predicates,
// resolves app-region by specificity then source order, and falls back to the nearest ancestor
// that declares one. The two conclusions it adds beyond resolution are deliberate:
//
//   - an unknown unclassed empty filler is inert (no-drag). That is PR #941's stated tradeoff,
//     not a bug: a control inheriting drag is issue #845, while an inert filler is visible and
//     fixed by using .spacer. Row 2's sanctioned empty surface still drags.
//   - the only way to carry app-region in this stylesheet is the bar's own box, the sanctioned
//     .spacer and the universal `.bar > *` default. An enumerated kind allowlist cannot return
//     without failing the structural row.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const PLATFORMS = ['linux', 'darwin', 'win32']
const readSource = name => readFileSync(new URL(`../src/${name}`, import.meta.url), 'utf8')
const css = readSource('shell.css')
const markup = readSource('shell.html')
const script = readSource('shell.js')
const stylesheet = css.replace(/\/\*[\s\S]*?\*\//g, '')

// ---------------------------------------------------------------------------------------------
// Stylesheet: rules, declarations, selectors. Only the shapes this stylesheet uses are
// compiled; a selector this harness cannot read is dropped rather than guessed at.
// ---------------------------------------------------------------------------------------------

function styleRules(text) {
  const rules = []
  const visit = (chunk, atRule) => {
    let cursor = 0
    while (cursor < chunk.length) {
      const open = chunk.indexOf('{', cursor)
      if (open === -1) return
      const prelude = chunk.slice(cursor, open).trim()
      let depth = 1
      let close = open + 1
      while (close < chunk.length && depth > 0) {
        if (chunk[close] === '{') depth += 1
        else if (chunk[close] === '}') depth -= 1
        close += 1
      }
      const body = chunk.slice(open + 1, close - 1)
      if (prelude.startsWith('@')) {
        if (body.includes('{')) visit(body, prelude)
      } else if (prelude) {
        rules.push({ prelude, body, atRule })
      }
      cursor = close
    }
  }
  visit(text, null)
  return rules
}

// Split a declaration block on semicolons at its top level, so the semicolons inside
// url(data:...;base64,...) and color-mix() stay part of the value.
function declarationsOf(body) {
  const declarations = new Map()
  const remember = chunk => {
    const match = chunk.match(/^\s*([-\w]+)\s*:\s*([\s\S]*?)\s*$/)
    if (match) declarations.set(match[1].toLowerCase(), match[2])
  }
  let chunk = ''
  let depth = 0
  let quote = ''
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index]
    if (quote) {
      chunk += char
      if (char === quote && body[index - 1] !== '\\') quote = ''
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      chunk += char
      continue
    }
    if (char === '(' || char === '[') depth += 1
    else if (char === ')' || char === ']') depth -= 1
    if (char === ';' && depth === 0) {
      remember(chunk)
      chunk = ''
      continue
    }
    chunk += char
  }
  remember(chunk)
  return declarations
}

function splitSelectors(prelude) {
  const selectors = []
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
      selectors.push(prelude.slice(start, index).trim())
      start = index + 1
    }
  }
  selectors.push(prelude.slice(start).trim())
  return selectors.filter(Boolean)
}

function selectorParts(selector) {
  const parts = []
  let buffer = ''
  let depth = 0
  let quote = ''
  let spaced = false
  const flush = () => {
    if (!buffer) return
    parts.push({ kind: 'compound', text: buffer })
    buffer = ''
  }
  for (let index = 0; index < selector.length; index += 1) {
    const char = selector[index]
    if (quote) {
      buffer += char
      if (char === quote && selector[index - 1] !== '\\') quote = ''
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      buffer += char
      continue
    }
    if (char === '(' || char === '[') depth += 1
    else if (char === ')' || char === ']') depth -= 1
    if (depth === 0 && (char === '>' || char === '+' || char === '~')) {
      flush()
      spaced = false
      parts.push({ kind: 'combinator', text: char })
      continue
    }
    if (depth === 0 && /\s/.test(char)) {
      flush()
      spaced = true
      continue
    }
    if (spaced) {
      const last = parts[parts.length - 1]
      if (last && last.kind === 'compound') parts.push({ kind: 'combinator', text: ' ' })
      spaced = false
    }
    buffer += char
  }
  flush()
  return parts
}

// The index of the bracket closing the one at `open`, honouring nesting and quoted values.
function closingBracket(text, open) {
  const opener = text[open]
  const closer = opener === '(' ? ')' : ']'
  let depth = 0
  let quote = ''
  for (let index = open; index < text.length; index += 1) {
    const char = text[index]
    if (quote) {
      if (char === quote && text[index - 1] !== '\\') quote = ''
      continue
    }
    if (char === '"' || char === "'") quote = char
    else if (char === opener) depth += 1
    else if (char === closer && --depth === 0) return index
  }
  return -1
}

function attributeTest(expression) {
  const parsed = expression.trim().match(
    /^([\w:-]+)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?$/,
  )
  if (!parsed) return null
  const name = parsed[1].toLowerCase()
  const wanted = parsed[2] ?? parsed[3] ?? parsed[4]
  return node => {
    if (!(name in node.attrs)) return false
    return wanted === undefined || node.attrs[name] === wanted
  }
}

const add = (left, right) => [left[0] + right[0], left[1] + right[1], left[2] + right[2]]
const compare = (left, right) => (left[0] - right[0]) || (left[1] - right[1]) || (left[2] - right[2])
const ZERO = [0, 0, 0]

function compileCompound(text) {
  let rest = text.trim()
  if (!rest) return null
  const tests = []
  let specificity = ZERO
  const tag = rest.match(/^(\*|[a-zA-Z][\w:-]*)/)
  if (tag) {
    if (tag[1] !== '*') {
      const expected = tag[1].toLowerCase()
      tests.push(node => node.tag === expected)
      specificity = add(specificity, [0, 0, 1])
    }
    rest = rest.slice(tag[0].length)
  }
  while (rest) {
    if (rest.startsWith('.')) {
      const parsed = rest.match(/^\.([\w-]+)/)
      if (!parsed) return null
      const expected = parsed[1]
      tests.push(node => node.classes.has(expected))
      specificity = add(specificity, [0, 1, 0])
      rest = rest.slice(parsed[0].length)
      continue
    }
    if (rest.startsWith('#')) {
      const parsed = rest.match(/^#([\w-]+)/)
      if (!parsed) return null
      const expected = parsed[1]
      tests.push(node => node.attrs.id === expected)
      specificity = add(specificity, [1, 0, 0])
      rest = rest.slice(parsed[0].length)
      continue
    }
    if (rest.startsWith('[')) {
      const end = closingBracket(rest, 0)
      if (end < 0) return null
      const test = attributeTest(rest.slice(1, end))
      if (!test) return null
      tests.push(test)
      specificity = add(specificity, [0, 1, 0])
      rest = rest.slice(end + 1)
      continue
    }
    if (rest.startsWith(':root')) {
      tests.push(node => node.parent && node.parent.tag === '#document')
      specificity = add(specificity, [0, 1, 0])
      rest = rest.slice(':root'.length)
      continue
    }
    const functional = rest.match(/^:(is|where|not)\(/i)
    if (functional) {
      const open = functional[0].length - 1
      const end = closingBracket(rest, open)
      if (end < 0) return null
      const kind = functional[1].toLowerCase()
      const alternatives = splitSelectors(rest.slice(open + 1, end))
        .map(compileSelector)
        .filter(Boolean)
      if (!alternatives.length) return null
      tests.push(node => {
        const hit = alternatives.some(alternative => alternative.match(node))
        return kind === 'not' ? !hit : hit
      })
      if (kind !== 'where') {
        const best = alternatives.reduce(
          (top, alternative) => compare(alternative.specificity, top) > 0
            ? alternative.specificity
            : top,
          ZERO,
        )
        specificity = add(specificity, best)
      }
      rest = rest.slice(end + 1)
      continue
    }
    // A state pseudo (:hover, :active, :focus-visible) is not the resting bar; any other
    // pseudo is outside the app-region/box contract this harness reads.
    return null
  }
  return { match: node => tests.every(test => test(node)), specificity }
}

function compileSelector(text) {
  const parts = selectorParts(text)
  const compounds = []
  const combinators = []
  for (const part of parts) {
    if (part.kind === 'compound') {
      const compiled = compileCompound(part.text)
      if (!compiled) return null
      compounds.push(compiled)
    } else {
      combinators.push(part.text)
    }
  }
  if (!compounds.length || combinators.length !== compounds.length - 1) return null
  const match = node => {
    if (!compounds[compounds.length - 1].match(node)) return false
    let current = node
    for (let index = compounds.length - 2; index >= 0; index -= 1) {
      if (combinators[index] === '>') {
        current = current.parent
        if (!current || !compounds[index].match(current)) return false
      } else if (combinators[index] === ' ') {
        current = current.parent
        while (current && !compounds[index].match(current)) current = current.parent
        if (!current) return false
      } else {
        return false
      }
    }
    return true
  }
  const specificity = compounds.reduce(
    (total, compound) => add(total, compound.specificity),
    ZERO,
  )
  return { text, match, specificity }
}

const normalizeSelector = text => text.replace(/\s+/g, ' ').trim()

const RULES = styleRules(stylesheet).map((rule, order) => ({
  ...rule,
  order,
  declarations: declarationsOf(rule.body),
  selectors: splitSelectors(rule.prelude).map(compileSelector).filter(Boolean),
}))
const LAYOUT_RULES = RULES.filter(rule => !rule.atRule)

const REGION_DECLARATIONS = []
for (const rule of RULES) {
  for (const name of ['-webkit-app-region', 'app-region']) {
    if (!rule.declarations.has(name)) continue
    const value = rule.declarations.get(name).trim().toLowerCase()
    for (const selector of rule.selectors) {
      REGION_DECLARATIONS.push({ selector, value, order: rule.order, atRule: rule.atRule })
    }
  }
}

const declaredRegion = node => {
  let winner = null
  for (const declaration of REGION_DECLARATIONS) {
    if (!declaration.selector.match(node)) continue
    if (!winner) {
      winner = declaration
      continue
    }
    const comparison = compare(declaration.selector.specificity, winner.selector.specificity)
    if (comparison > 0 || (comparison === 0 && declaration.order > winner.order)) winner = declaration
  }
  return winner
}

const regionOf = node => {
  for (let current = node; current && current.tag !== '#document'; current = current.parent) {
    const declaration = declaredRegion(current)
    if (declaration) return declaration.value
  }
  return 'none'
}

// The winning value of a box property, with the same specificity/source-order cascade.
function propertyOf(node, property) {
  let winner = null
  for (const rule of LAYOUT_RULES) {
    if (!rule.declarations.has(property)) continue
    for (const selector of rule.selectors) {
      if (!selector.match(node)) continue
      const candidate = {
        value: rule.declarations.get(property),
        specificity: selector.specificity,
        order: rule.order,
      }
      if (!winner) {
        winner = candidate
        continue
      }
      const comparison = compare(candidate.specificity, winner.specificity)
      if (comparison > 0 || (comparison === 0 && candidate.order >= winner.order)) winner = candidate
    }
  }
  return winner ? winner.value : null
}

function pixelsOf(value) {
  const parsed = String(value).trim().match(/^(-?\d*\.?\d+)(?:px)?$/)
  return parsed ? Number(parsed[1]) : Number.NaN
}

function paddingOf(bar) {
  const shorthand = propertyOf(bar, 'padding')
  assert.ok(shorthand, 'the bar declares its own padding')
  const sides = shorthand.trim().split(/\s+/).map(pixelsOf)
  assert.ok(sides.length >= 1 && sides.length <= 4 && sides.every(Number.isFinite),
    `the bar padding is a plain pixel box: ${shorthand}`)
  const [top, right, bottom, left] = sides.length === 1
    ? [sides[0], sides[0], sides[0], sides[0]]
    : sides.length === 2
      ? [sides[0], sides[1], sides[0], sides[1]]
      : sides.length === 3
        ? [sides[0], sides[1], sides[2], sides[1]]
        : sides
  const leftOverride = propertyOf(bar, 'padding-left')
  return { top, right, bottom, left: leftOverride == null ? left : pixelsOf(leftOverride) }
}

// ---------------------------------------------------------------------------------------------
// Markup: the real shell.html as a small element tree, with the platform class shell.js adds
// to the body. The bar controls the rows plant are appended to this same real bar.
// ---------------------------------------------------------------------------------------------

const VOID_ELEMENTS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr'])

function parseAttributes(raw) {
  const attributes = {}
  const pattern = /([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g
  let match
  while ((match = pattern.exec(raw))) {
    const name = match[1].toLowerCase()
    if (!(name in attributes)) attributes[name] = match[2] ?? match[3] ?? match[4] ?? ''
  }
  return attributes
}

function element(tag, attributes = {}, parent = null) {
  const attrs = {}
  for (const [name, value] of Object.entries(attributes)) {
    attrs[name.toLowerCase()] = value == null ? '' : String(value)
  }
  const node = {
    tag: tag.toLowerCase(),
    attrs,
    classes: new Set((attrs.class ?? '').split(/\s+/).filter(Boolean)),
    parent,
    children: [],
  }
  if (parent) parent.children.push(node)
  return node
}

function parseDocument(text) {
  const document = element('#document')
  const stack = [document]
  const tokens = /<!--[\s\S]*?-->|<![^>]*>|<\/([a-zA-Z][\w:-]*)\s*>|<([a-zA-Z][\w:-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g
  let token
  while ((token = tokens.exec(text))) {
    if (token[1]) {
      const tag = token[1].toLowerCase()
      for (let index = stack.length - 1; index > 0; index -= 1) {
        if (stack[index].tag === tag) {
          stack.length = index
          break
        }
      }
      continue
    }
    if (!token[2]) continue
    const tag = token[2].toLowerCase()
    const raw = token[3] ?? ''
    const selfClosing = /\/\s*$/.test(raw) || VOID_ELEMENTS.has(tag)
    const node = element(tag, parseAttributes(raw.replace(/\/\s*$/, '')),
      stack[stack.length - 1])
    if (!selfClosing) stack.push(node)
  }
  return document
}

function walk(node, visit) {
  visit(node)
  for (const child of node.children) walk(child, visit)
}

function append(parent, tag, attributes = {}) {
  return element(tag, attributes, parent)
}

function barTree(platform) {
  const document = parseDocument(markup)
  let body = null
  walk(document, node => {
    if (!body && node.tag === 'body') body = node
  })
  assert.ok(body, 'shell.html has a body')
  body.classes.add(platform)
  let bar = null
  walk(document, node => {
    if (!bar && node.tag === 'header' && node.classes.has('bar')) bar = node
  })
  assert.ok(bar, 'shell.html has the header.bar top bar')
  return { bar, body }
}

function describe(node) {
  const classes = [...node.classes].sort().map(name => `.${name}`).join('')
  const act = node.attrs['data-act'] ? `[data-act=${node.attrs['data-act']}]` : ''
  return `<${node.tag}${classes}${act}>`
}

// ---------------------------------------------------------------------------------------------
// Row 1: the real bar subtree and the new/custom kinds. The bar's brand is its right-click
// menu surface, .controls holds the window controls, and the final case is a kind no allowlist
// ever named.
// ---------------------------------------------------------------------------------------------

test('row 1 — every item in the real top bar is no-drag on linux, darwin and win32', () => {
  assert.match(script, /body\.classList\.add\(platform\)/,
    'shell.js puts the platform class on the body, which this test mirrors')
  for (const platform of PLATFORMS) {
    const { bar } = barTree(platform)
    const brand = bar.children.find(child => child.classes.has('brand'))
    assert.ok(brand, `${platform}: the bar has the brand, its right-click menu surface`)
    assert.ok(brand.children.some(child => child.classes.has('brand-mark')),
      `${platform}: the brand has its mark`)
    assert.ok(brand.children.some(child => child.tag === 'b'),
      `${platform}: the brand has its label`)
    const controls = bar.children.find(child => child.classes.has('controls'))
    assert.ok(controls, `${platform}: the bar has the window-controls container`)
    const buttons = controls.children.filter(child => child.tag === 'button')
    assert.deepEqual(
      buttons.map(button => button.attrs['data-act']).sort(),
      ['close', 'maximize', 'minimize'],
      `${platform}: the bar has its three window controls`,
    )
    for (const button of buttons) {
      const icons = button.children.filter(child => child.tag === 'svg')
      assert.ok(icons.length > 0, `${platform}: ${describe(button)} has its icon`)
      for (const icon of icons) {
        const shapes = icon.children.filter(child => child.tag === 'path' || child.tag === 'rect')
        assert.ok(shapes.length > 0, `${platform}: ${describe(button)}'s icon has its shapes`)
      }
    }
    const seen = new Set()
    walk(bar, node => seen.add(node.tag))
    for (const tag of ['header', 'div', 'i', 'b', 'button', 'svg', 'path', 'rect']) {
      assert.ok(seen.has(tag), `${platform}: the walk reached the bar's <${tag}>`)
    }
    const items = []
    walk(bar, node => {
      if (node !== bar && !node.classes.has('spacer')) items.push(node)
    })
    assert.ok(items.length > 0, `${platform}: the bar has items to check`)
    for (const item of items) {
      assert.equal(regionOf(item), 'no-drag',
        `${platform}: ${describe(item)} must take clicks instead of dragging the window`)
    }
  }
})

const NEW_KINDS = [
  { tag: 'am-menu', attrs: {} },
  { tag: 'am-button', attrs: {} },
  { tag: 'details', attrs: {}, children: [{ tag: 'summary', attrs: {} }] },
  { tag: 'option', attrs: {} },
  { tag: 'video', attrs: { controls: '' } },
  { tag: 'input', attrs: { type: 'search' } },
  { tag: 'a', attrs: { href: '#menu' } },
  { tag: 'div', attrs: {} },
]

test('row 1 — new and custom bar controls are no-drag on every platform with no new rule', () => {
  for (const platform of PLATFORMS) {
    const { bar } = barTree(platform)
    const spacer = bar.children.find(child => child.classes.has('spacer'))
    assert.ok(spacer, `${platform}: the real bar still has its spacer`)
    for (const kind of NEW_KINDS) {
      const node = append(bar, kind.tag, kind.attrs)
      for (const child of kind.children ?? []) append(node, child.tag, child.attrs)
      assert.equal(regionOf(node), 'no-drag',
        `${platform}: a new ${describe(node)} must take clicks, not drag the window`)
      const declaration = declaredRegion(node)
      assert.ok(declaration, `${platform}: ${describe(node)} is covered by an existing rule`)
      assert.equal(normalizeSelector(declaration.selector.text), '.bar > *',
        `${platform}: ${describe(node)} is covered by the universal default, not a new rule`)
      for (const child of node.children) {
        assert.equal(declaredRegion(child), null,
          `${platform}: no app-region rule names ${describe(child)} itself`)
        assert.equal(regionOf(child), 'no-drag',
          `${platform}: ${describe(child)} inherits no-drag from ${describe(node)}`)
      }
    }
    assert.equal(regionOf(spacer), 'drag',
      `${platform}: the sanctioned spacer still drags beside the new controls`)
  }
  for (const kind of NEW_KINDS) {
    const named = new RegExp(`(^|[\\s>])${kind.tag}(?![\\w-])`)
    for (const declaration of REGION_DECLARATIONS) {
      assert.doesNotMatch(declaration.selector.text, named,
        `no app-region rule enumerates the ${kind.tag} kind`)
    }
  }
})

// Row 2 verdict: the sanctioned empty surface MEETS "empty areas still drag". The bar's own box
// — its padding and the flex gaps between its children — resolves drag, and .spacer re-declares
// it. What row 2 does not promise, by PR #941's explicit tradeoff, is that an arbitrary new
// unclassed empty child drags: that child is inert. The next test pins that tradeoff, so a
// future change that makes control-safe defaulting narrower (or silently widens it) is seen.

test('row 2 — the sanctioned empty surface drags: the bar box (padding/gaps) and .spacer', () => {
  const linuxPadding = paddingOf(barTree('linux').bar)
  for (const platform of PLATFORMS) {
    const { bar } = barTree(platform)
    assert.equal(regionOf(bar), 'drag', `${platform}: the bar itself is the window drag region`)
    const spacer = bar.children.find(child => child.classes.has('spacer'))
    assert.ok(spacer, `${platform}: the bar has its empty spacer`)
    assert.equal(regionOf(spacer), 'drag',
      `${platform}: the spacer, the sanctioned empty middle, drags`)
    walk(bar, node => {
      const expected = node === bar || node === spacer ? 'drag' : 'no-drag'
      assert.equal(regionOf(node), expected,
        `${platform}: only the bar's own box and .spacer drag around ${describe(node)}`)
    })
    const padding = paddingOf(bar)
    assert.ok(padding.left > 0 && padding.right > 0,
      `${platform}: the bar's own horizontal padding is empty surface inside its drag region`)
    const gap = String(propertyOf(bar, 'gap') ?? '').trim().split(/\s+/)[0]
    assert.ok(pixelsOf(gap) > 0,
      `${platform}: the bar's flex gaps are empty surface inside its drag region`)
    if (platform === 'darwin') {
      assert.ok(padding.left > linuxPadding.left,
        'darwin: the bar keeps a wider left drag strip for the traffic lights')
    }
  }
})

test('row 2 — documented tradeoff: an unknown unclassed filler is inert, not a bug', () => {
  for (const platform of PLATFORMS) {
    const { bar } = barTree(platform)
    const filler = append(bar, 'div', {})
    assert.equal(regionOf(filler), 'no-drag',
      `${platform}: an unknown unclassed empty filler is inert by design, not a bug`)
    const replacement = append(bar, 'div', { class: 'spacer' })
    assert.equal(regionOf(replacement), 'drag',
      `${platform}: a filler that must drag uses the sanctioned .spacer`)
  }
})

// ---------------------------------------------------------------------------------------------
// Row 3: the contract is structural, not a list of known kinds. Exactly three app-region
// declarations exist; the only no-drag is the universal direct-child selector; anything
// deeper with no rule of its own inherits no-drag from it.
// ---------------------------------------------------------------------------------------------

test('row 3 — drag is declared only on the bar box and .spacer, no-drag only on .bar > *', () => {
  const raw = (stylesheet.match(/(?:^|[;{\s])(?:-webkit-)?app-region\s*:/g) ?? []).length
  assert.equal(raw, 3,
    'shell.css has exactly three app-region declarations, none hidden in another block')
  assert.equal(REGION_DECLARATIONS.length, 3,
    'each app-region declaration belongs to one rule and one selector')
  for (const declaration of REGION_DECLARATIONS) {
    assert.ok(declaration.selector, 'every app-region selector is one this harness can read')
    assert.equal(declaration.atRule, null,
      'no app-region declaration is conditional on an at-rule')
    assert.doesNotMatch(declaration.value, /!important/i,
      'app-region is decided by specificity and source order, not !important')
    assert.ok(declaration.value === 'drag' || declaration.value === 'no-drag',
      `app-region is drag or no-drag, not ${declaration.value}`)
    assert.doesNotMatch(declaration.selector.text, /(?:^|[\s.>])(?:linux|darwin|win32)(?![\w-])/,
      `app-region is platform-neutral, not ${declaration.selector.text}`)
  }
  const selectorsFor = value => [...new Set(REGION_DECLARATIONS
    .filter(declaration => declaration.value === value)
    .map(declaration => normalizeSelector(declaration.selector.text)))].sort()
  assert.deepEqual(selectorsFor('drag'), ['.bar', '.bar > .spacer'],
    'drag is declared only on the bar box and its sanctioned .spacer')
  assert.deepEqual(selectorsFor('no-drag'), ['.bar > *'],
    'no-drag is declared once, on every direct bar child without naming a kind')
  // The selectors can only be those three shapes. An enumerated kind allowlist (the old
  // :is(...) list), an attribute opt-out or a platform-only exception cannot come back
  // without failing this row.
  for (const declaration of REGION_DECLARATIONS) {
    assert.match(normalizeSelector(declaration.selector.text),
      /^\.bar(?: > (?:\*|\.spacer))?$/,
      `the app-region contract has no other selector: ${declaration.selector.text}`)
  }
})

test('row 3 — a control kind with no rule inherits no-drag; no kind allowlist can return', () => {
  const { bar } = barTree('linux')
  const custom = append(bar, 'agenda-widget', {
    role: 'menuitem',
    'aria-haspopup': 'menu',
    tabindex: '0',
    'data-menu': 'bar',
  })
  const direct = declaredRegion(custom)
  assert.ok(direct, 'the universal direct-child rule covers even an unknown custom element')
  assert.equal(normalizeSelector(direct.selector.text), '.bar > *')
  const nested = append(custom, 'span', { 'data-icon': 'clock' })
  const icon = append(nested, 'svg', {})
  const shape = append(icon, 'path', { d: 'M0 0h1' })
  for (const node of [nested, icon, shape]) {
    assert.equal(declaredRegion(node), null,
      `no app-region rule names ${describe(node)}; it is not a kind on a list`)
    assert.equal(regionOf(node), 'no-drag',
      `${describe(node)} inherits no-drag from the universal direct-child rule`)
  }
  const noDrag = REGION_DECLARATIONS.filter(declaration => declaration.value === 'no-drag')
  assert.equal(noDrag.length, 1, 'one universal no-drag rule, not an enumerated list')
  const universal = noDrag[0].selector
  for (const tag of ['button', 'a', 'input', 'select', 'textarea', 'summary', 'details',
    'option', 'video', 'am-menu', 'am-button', 'agenda-widget', 'div', 'span', 'svg']) {
    const node = element(tag, { role: 'button', tabindex: '0', 'aria-haspopup': 'menu' }, bar)
    assert.ok(universal.match(node), `${tag} matches the universal no-drag rule`)
    assert.equal(declaredRegion(node).selector, universal,
      `${tag} gets no-drag from the default, not from a named kind`)
  }
})
