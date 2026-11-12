// The inner wall of browser_exec (src/script-child/sandbox.js): the script runs in an
// interpreter that shares nothing with Node, so its whole reach is what the sandbox
// hands it. These tests take that as the claim and check it: two functions cross, `call`
// and `finish`; each takes text (finish: or null) and nothing else; neither runs code of
// the script to read its arguments; neither lets an error of this side through; and what
// comes back the other way is a number, a boolean, text or null.
//
// The checks run the sandbox in this process and give it a prelude of their own, which
// gets the two functions bare, as the real prelude does before it hides them.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MAX_TEXT, MEMORY_LIMIT, openSandbox } from '../src/script-child/sandbox.js'

// Every global of the interpreter. Nothing of Node, nothing of a browser: no process,
// require, fetch, URL, timers, console, Intl, WebAssembly or Atomics. The script's
// setTimeout, console and helpers are arguments of its function, not globals.
const GLOBALS = [
  'AggregateError', 'Array', 'ArrayBuffer', 'BigInt', 'BigInt64Array', 'BigUint64Array', 'Boolean', 'DataView', 'Date',
  'Error', 'EvalError', 'FinalizationRegistry', 'Float16Array', 'Float32Array', 'Float64Array', 'Function', 'Infinity',
  'Int16Array', 'Int32Array', 'Int8Array', 'InternalError', 'Iterator', 'JSON', 'Map', 'Math', 'NaN', 'Number', 'Object',
  'Promise', 'Proxy', 'RangeError', 'ReferenceError', 'Reflect', 'RegExp', 'Set', 'SharedArrayBuffer', 'String', 'Symbol',
  'SyntaxError', 'TypeError', 'URIError', 'Uint16Array', 'Uint32Array', 'Uint8Array', 'Uint8ClampedArray', 'WeakMap',
  'WeakRef', 'WeakSet', 'decodeURI', 'decodeURIComponent', 'encodeURI', 'encodeURIComponent', 'escape', 'eval',
  'globalThis', 'isFinite', 'isNaN', 'parseFloat', 'parseInt', 'undefined', 'unescape',
]

// Opens a sandbox whose prelude is `code`, a function of (call, finish) run at once.
// Resolves to what the host's two functions were given, and the sandbox.
async function probe(code, { call, finish } = {}) {
  const seen = { calls: [], finishes: [] }
  const sandbox = await openSandbox({
    call: (...args) => {
      seen.calls.push(args)
      return call ? call(...args) : seen.calls.length
    },
    finish: (...args) => {
      seen.finishes.push(args)
      if (finish) finish(...args)
    },
    prelude: `(function (call, finish) { ${code} })`,
  })
  sandbox.start([], '')
  return { seen, sandbox }
}

// What a probe reported with finish(text, null).
const reported = ({ seen }) => {
  assert.equal(seen.finishes.length, 1, JSON.stringify(seen.finishes))
  assert.equal(seen.finishes[0][1], null, seen.finishes[0][1])
  return JSON.parse(seen.finishes[0][0])
}

test('the sandbox hands the interpreter two functions and puts nothing on its globals', async (t) => {
  const first = await openSandbox({ call: () => 1, finish: () => {} })
  // Every way the sandbox can give the interpreter something of this side.
  const Context = Object.getPrototypeOf(first.context)
  const made = []
  const newFunction = Context.newFunction
  t.mock.method(Context, 'newFunction', function (name, fn) {
    made.push(name)
    return newFunction.call(this, name, fn)
  })
  const placed = []
  for (const method of ['setProp', 'defineProp']) {
    t.mock.method(Context, method, () => {
      placed.push(method)
      throw new Error(`${method} is not for the sandbox`)
    })
  }
  const run = await probe('finish(JSON.stringify({ args: arguments.length, names: Object.getOwnPropertyNames(globalThis).sort() }), null)')
  assert.deepEqual(made, ['call', 'finish'])
  assert.deepEqual(placed, [])
  const { args, names } = reported(run)
  // The real prelude gets these two and two texts (the helper names and the body).
  assert.equal(args, 4)
  assert.deepEqual(names, GLOBALS)
})

test('the two functions are functions of the interpreter with nothing of this side on them', async () => {
  const run = await probe(`
    const shape = fn => ({
      type: typeof fn,
      proto: Object.getPrototypeOf(fn) === Function.prototype,
      own: Object.getOwnPropertyNames(fn).sort(),
      symbols: Object.getOwnPropertySymbols(fn).length,
      source: String(fn),
      maker: (() => { try { return typeof fn.constructor('return typeof process + typeof require')() } catch (error) { return 'threw' } })(),
    })
    finish(JSON.stringify([shape(call), shape(finish)]), null)
  `)
  for (const shape of reported(run)) {
    assert.equal(shape.type, 'function')
    assert.equal(shape.proto, true)
    assert.deepEqual(shape.own, ['length', 'name'])
    assert.equal(shape.symbols, 0)
    assert.match(shape.source, /\[native code\]/)
    // Their constructor is the interpreter's Function: code it makes sees no Node.
    assert.equal(shape.maker, 'string')
  }
})

test('call takes two texts and answers a number; anything else is refused without running the script\'s code', async () => {
  const run = await probe(`
    let ran = 0
    const spy = { toString() { ran += 1; return 'goto' }, valueOf() { ran += 1; return 'goto' }, get length() { ran += 1; return 1 } }
    const trap = new Proxy({}, { get() { ran += 1; return undefined }, has() { ran += 1; return false }, ownKeys() { ran += 1; return [] } })
    const text = new String('goto')
    const refused = [
      [], ['goto'], [1, '[]'], ['goto', 1], [null, '[]'], ['goto', null], [undefined, undefined], [true, '[]'],
      [spy, '[]'], ['goto', spy], [trap, '[]'], ['goto', trap], [text, '[]'], ['goto', new String('[]')],
      [Symbol('goto'), '[]'], [() => 'goto', '[]'], [['goto'], '[]'], ['goto', ['[]']], [10n, '[]'],
      ['goto', 'x'.repeat(${MAX_TEXT} + 1)], ['y'.repeat(${MAX_TEXT} + 1), '[]'],
    ].map(args => call(...args))
    const taken = [call('goto', '["https://example.com/"]'), call('', ''), call('goto', 'x'.repeat(${MAX_TEXT}))]
    finish(JSON.stringify({ refused, taken: taken.map(id => typeof id + ':' + id), ran }), null)
  `)
  const { refused, taken, ran } = reported(run)
  assert.deepEqual(refused, refused.map(() => 0))
  assert.deepEqual(taken, ['number:1', 'number:2', 'number:3'])
  assert.equal(ran, 0, 'reading an argument ran the script\'s code')
  // This side got text, and only for the three calls that were text.
  assert.deepEqual(run.seen.calls.map(args => args.map(arg => typeof arg)), [['string', 'string'], ['string', 'string'], ['string', 'string']])
  assert.deepEqual(run.seen.calls[0], ['goto', '["https://example.com/"]'])
  assert.equal(run.seen.calls[2][1].length, MAX_TEXT)
})

test('call gives the script a positive whole number or 0, whatever this side answers', async () => {
  const answers = [{ secret: 1 }, 'text', NaN, -1, 1.5, Infinity, null, undefined, () => 1, 7]
  const run = await probe(`
    const got = []
    for (let index = 0; index < ${answers.length}; index += 1) got.push(call('goto', '[]'))
    finish(JSON.stringify(got.map(value => typeof value + ':' + value)), null)
  `, { call: () => answers.shift() })
  assert.deepEqual(reported(run), ['number:0', 'number:0', 'number:0', 'number:0', 'number:0', 'number:0', 'number:0', 'number:0', 'number:0', 'number:7'])
})

test('an error of this side never reaches the script', async () => {
  const fail = () => { throw new Error('host detail: /a/host/path') }
  const run = await probe(`
    let out
    try { out = ['call', typeof call('goto', '[]'), call('goto', '[]')] } catch (error) { out = ['threw', String(error && error.message), String(error && error.stack)] }
    let done
    try { done = ['finish', typeof finish('first', null)] } catch (error) { done = ['threw', String(error && error.message)] }
    finish(JSON.stringify([out, done]), null)
  `, { call: fail, finish: (answer) => { if (answer === 'first') fail() } })
  assert.equal(run.seen.finishes.length, 2)
  assert.deepEqual(JSON.parse(run.seen.finishes[1][0]), [['call', 'number', 0], ['finish', 'undefined']])
})

test('finish takes text or null for each of its two arguments and answers nothing', async () => {
  const run = await probe(`
    let ran = 0
    const spy = { toString() { ran += 1; return 'answer' }, toJSON() { ran += 1; return 'answer' } }
    const results = [
      finish('answer', null), finish(null, 'failed'), finish(null, null), finish('', ''),
      finish(spy, null), finish(null, spy), finish(1, null), finish(undefined, null), finish('answer'), finish(),
      finish(new String('answer'), null), finish(['answer'], null), finish(Symbol('answer'), null), finish(() => 'answer', null),
    ]
    finish(JSON.stringify({ results: results.map(value => typeof value), ran }), null)
  `)
  const { finishes } = run.seen
  const notText = [null, 'Script produced an answer that is not text.']
  assert.deepEqual(finishes.slice(0, 14), [
    ['answer', null], [null, 'failed'], [null, null], ['', ''],
    notText, notText, notText, notText, notText, notText, notText, notText, notText, notText,
  ])
  const { results, ran } = JSON.parse(finishes[14][0])
  assert.deepEqual(results, results.map(() => 'undefined'))
  assert.equal(ran, 0, 'reading an argument ran the script\'s code')
})

test('what this side gives back is a number, a boolean, and text or null', async () => {
  const run = await probe(`
    const got = []
    return (...args) => { got.push(args.map(value => value === null ? 'null' : typeof value)); if (got.length === 4) finish(JSON.stringify(got), null) }
  `)
  run.sandbox.settle(1, true, 'value')
  run.sandbox.settle(2, false, 'message')
  run.sandbox.settle(3, true, null)
  // Not text: it arrives as null, not as an object of this side.
  run.sandbox.settle(4, 'yes', { host: process })
  assert.deepEqual(reported(run), [
    ['number', 'boolean', 'string'], ['number', 'boolean', 'string'], ['number', 'boolean', 'null'], ['number', 'boolean', 'null'],
  ])
})

test('the interpreter may allocate up to its limit and no more', async () => {
  assert.equal(MEMORY_LIMIT, 64 * 1024 * 1024)
  const run = await probe(`
    const kept = []
    let error = 'none'
    try { for (;;) kept.push(new Array(100000).fill(kept.length)) } catch (caught) { error = caught.name + ': ' + caught.message }
    const arrays = kept.length
    kept.length = 0
    finish(JSON.stringify({ error, arrays }), null)
  `)
  const { error, arrays } = reported(run)
  assert.equal(error, 'InternalError: out of memory')
  // Each array is 100,000 numbers: tens of megabytes fit, hundreds do not.
  assert.ok(arrays > 10 && arrays < 200, `${arrays} arrays`)
})

test('past its stack limit the script gets an error of its own', async () => {
  const run = await probe(`
    let depth = 0
    const down = () => { depth += 1; down() }
    let error = 'none'
    try { down() } catch (caught) { error = caught.name + ': ' + caught.message }
    finish(JSON.stringify({ error, deep: depth > 500 && depth < 5000 }), null)
  `)
  assert.deepEqual(reported(run), { error: 'InternalError: stack overflow', deep: true })
})

test('a structure too deep for the interpreter ends the run with a stack error, once', async () => {
  const run = await probe(`
    let nested = []
    for (let index = 0; index < 100000; index += 1) nested = [nested]
    finish(String(JSON.stringify(nested).length), null)
  `)
  assert.deepEqual(run.seen.finishes, [[null, 'InternalError: stack overflow']])
  // The interpreter is not entered again after it failed.
  run.sandbox.settle(1, true, 'late')
  assert.equal(run.seen.finishes.length, 1)
})
