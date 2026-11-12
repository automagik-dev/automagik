// Where a browser_exec script runs: QuickJS, a JavaScript interpreter compiled to
// WebAssembly. The script and everything it can reach live in the interpreter's own
// memory, which is one WebAssembly array; no object of this process's JavaScript (Node)
// can be handed to it, because the two do not share objects at all. What crosses is what
// this file copies across, and that is two functions:
//
//   call(name, args)        both text; answers a number, the call's id, or 0 for "no"
//   finish(answer, error)   each text or null; answers nothing
//
// Each copies text out of the interpreter and nothing else, and never throws: the
// interpreter would turn an exception of this side into an error of its own that carries
// this side's message and stack. The other direction is one function of the script's
// side, `settle`, called with a number, a boolean and text or null.
//
// test/browser-script-sandbox.test.js checks that these two are the whole surface.
import variant from '@jitl/quickjs-singlefile-mjs-release-sync'
import { newQuickJSWASMModuleFromVariant } from 'quickjs-emscripten-core'

// The stack the interpreter may use: about 1,500 nested calls. Past it the script gets
// an error of its own (stack overflow). The limit stays well under this process's own
// stack, which the interpreter's calls are made on; where a deep structure still runs
// through it, the run ends with the same error.
//
// Memory has no limit here. The interpreter's own limit counts one allocation at a time
// in this build, not the total, so the total is capped where it cannot be miscounted: the
// runner starts this process with a cap on any WebAssembly memory (script-runner.js).
const STACK_LIMIT = 256 * 1024
// The longest text `call` takes: the host refuses longer helper arguments.
export const MAX_TEXT = 4_000_000

// Runs inside the interpreter. It keeps its own copies of the built-ins it uses, so a
// script that rewrites JSON or Promise breaks only itself, and it holds `call` and
// `finish` in its closure: the script gets the helpers, never the two functions.
export const PRELUDE = `(function (call, finish, namesJson, body) {
  'use strict'
  const { parse, stringify } = JSON
  const toText = String
  const PromiseOf = Promise
  const ErrorOf = Error
  const names = parse(namesJson)
  // "TypeError: cannot read property 'x' of null": the kind of error is half the message.
  const describe = error => {
    try {
      // The interpreter throws null when it has no memory left to make an error with.
      if (error === null) return 'Script threw null (the interpreter does that when it is out of memory).'
      if (typeof error !== 'object' || !('message' in error)) return toText(error)
      const name = typeof error.name === 'string' && error.name !== 'Error' ? error.name + ': ' : ''
      return name + toText(error.message)
    } catch { return 'Script failed.' }
  }
  const waiting = { __proto__: null }
  const ask = name => (...args) => new PromiseOf((resolve, reject) => {
    // JSON turns a trailing undefined into null, which would defeat a helper's default.
    while (args.length > 0 && args[args.length - 1] === undefined) args.length -= 1
    const json = stringify(args)
    if (typeof json === 'string' && json.length > ${MAX_TEXT}) {
      reject(new ErrorOf('Helper arguments are larger than 4 MB.'))
      return
    }
    const id = call(name, json)
    if (!(id > 0)) {
      reject(new ErrorOf('Helper arguments must be plain JSON values.'))
      return
    }
    waiting[id] = {
      resolve: (value) => {
        try { resolve(value === null ? undefined : parse(value)) } catch (error) { reject(error) }
      },
      reject: message => reject(new ErrorOf(message)),
    }
  })
  const helpers = []
  for (let index = 0; index < names.length; index += 1) helpers[index] = ask(names[index])
  let answer
  const done = (value) => { answer = value }
  const timers = { __proto__: null }
  let lastTimer = 0
  const setTimeout = (fn, ms, ...rest) => {
    const timer = ++lastTimer
    const id = call('wait', stringify([+ms || 0]))
    if (!(id > 0)) return timer
    timers[timer] = true
    waiting[id] = {
      resolve: () => {
        if (!timers[timer]) return
        delete timers[timer]
        if (typeof fn === 'function') fn(...rest)
      },
      reject: () => {},
    }
    return timer
  }
  const clearTimeout = (timer) => { delete timers[timer] }
  const noop = () => {}
  const console = { log: noop, info: noop, warn: noop, error: noop, debug: noop }
  const settle = (id, ok, value) => {
    const waiter = waiting[id]
    if (waiter === undefined) return
    delete waiting[id]
    if (ok) waiter.resolve(value)
    else waiter.reject(typeof value === 'string' ? value : 'The helper failed.')
  }
  const end = (value) => {
    let text = null
    try { text = value === undefined ? null : toText(value) } catch (error) { finish(null, describe(error)); return }
    finish(text, null)
  }
  let run
  try {
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
    run = new AsyncFunction(...names, 'done', 'setTimeout', 'clearTimeout', 'console', '"use strict";\\n' + body)
  } catch (error) {
    finish(null, describe(error))
    return settle
  }
  run(...helpers, done, setTimeout, clearTimeout, console).then(value => end(answer ?? value), error => finish(null, describe(error)))
  return settle
})`

// call(name, args) → a positive id, or anything else for "no"; finish(answer, error).
// Both are this side's and get text (finish: or null) only. Resolves to start(names,
// body) and settle(id, ok, text), plus the context for the tests.
export async function openSandbox({ call, finish, prelude = PRELUDE }) {
  const QuickJS = await newQuickJSWASMModuleFromVariant(variant)
  const runtime = QuickJS.newRuntime()
  runtime.setMaxStackSize(STACK_LIMIT)
  // import() and import statements find nothing to load.
  runtime.setModuleLoader(() => ({ error: new Error('Imports are not available.') }))
  const context = runtime.newContext()

  // Text out of the interpreter, or undefined for anything that is not text or is too long.
  const text = (handle) => {
    if (handle === undefined || context.typeof(handle) !== 'string') return undefined
    // The length first: a text too long is refused before a copy of it is made here.
    const length = context.getProp(handle, 'length').consume(value => context.getNumber(value))
    return length <= MAX_TEXT ? context.getString(handle) : undefined
  }
  // Text or null out of the interpreter; undefined for anything else, a missing argument
  // included.
  const textOrNull = (handle) => {
    if (handle === undefined) return undefined
    const type = context.typeof(handle)
    if (type === 'string') return context.getString(handle)
    return type === 'object' && context.sameValue(handle, context.null) ? null : undefined
  }

  const callFunction = context.newFunction('call', (nameHandle, argsHandle) => {
    let id = 0
    try {
      const name = text(nameHandle)
      const args = text(argsHandle)
      if (name !== undefined && args !== undefined) id = call(name, args)
    } catch {}
    return context.newNumber(Number.isSafeInteger(id) && id > 0 ? id : 0)
  })
  const finishFunction = context.newFunction('finish', (answerHandle, errorHandle) => {
    try {
      const answer = textOrNull(answerHandle)
      const error = textOrNull(errorHandle)
      if (answer === undefined || error === undefined) finish(null, 'Script produced an answer that is not text.')
      else finish(answer, error)
    } catch {}
    return context.undefined
  })

  // Once the interpreter itself failed (no memory left to report an error with, or this
  // process's stack ran out under it), its state is not to be entered again: the run ends
  // here, with the error said from this side.
  let broken = false
  const breakWith = (message) => {
    if (broken) return
    broken = true
    finish(null, message)
  }
  // The name and message of an error of the interpreter, read without running its code.
  const describe = (handle) => {
    try {
      const read = key => context.getProp(handle, key).consume(value => context.typeof(value) === 'string' ? context.getString(value) : '')
      const name = read('name')
      const message = read('message')
      return name && message ? `${name}: ${message}` : name || message || 'Script failed.'
    } catch { return 'Script failed.' }
  }
  // Every entry into the interpreter, then the promise reactions it left to run. A
  // reaction of the script that throws rejects a promise of the script; one that fails
  // here could not even do that.
  const enter = (fn) => {
    if (broken) return
    try {
      fn()
      while (!broken && runtime.hasPendingJob()) {
        const result = runtime.executePendingJobs()
        if (result.error) result.error.consume(error => breakWith(describe(error)))
      }
    } catch (error) {
      breakWith(error instanceof RangeError ? 'InternalError: stack overflow' : 'Script failed.')
    }
  }

  let settleHandle
  return {
    context,
    start(names, body) {
      enter(() => {
        const install = context.unwrapResult(context.evalCode(prelude, 'browser_exec'))
        const namesHandle = context.newString(JSON.stringify(names))
        const bodyHandle = context.newString(body)
        try {
          const result = context.callFunction(install, context.undefined, callFunction, finishFunction, namesHandle, bodyHandle)
          if (result.error) result.error.consume(error => breakWith(describe(error)))
          else settleHandle = result.value
        } finally {
          install.dispose()
          namesHandle.dispose()
          bodyHandle.dispose()
        }
      })
    },
    settle(id, ok, value) {
      enter(() => {
        if (settleHandle === undefined || context.typeof(settleHandle) !== 'function') return
        const idHandle = context.newNumber(id)
        const valueHandle = typeof value === 'string' ? context.newString(value) : context.null
        try {
          const result = context.callFunction(settleHandle, context.undefined, idHandle, ok ? context.true : context.false, valueHandle)
          if (result.error) result.error.consume(error => breakWith(describe(error)))
          else result.value.dispose()
        } finally {
          idHandle.dispose()
          if (typeof value === 'string') valueHandle.dispose()
        }
      })
    },
  }
}
