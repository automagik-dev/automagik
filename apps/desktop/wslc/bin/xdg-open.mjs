#!/usr/bin/env node
// `xdg-open` and $BROWSER in the Linux image (RFC 0016, "Links out and sign-in callbacks"): the
// guest has no browser, so a link goes to the launcher over its Unix socket (lib/open.mjs), and
// Electron opens it on Windows. Only https: URLs go; the launcher decides and answers.
// Exit codes as xdg-open's: 1 not one URL, 3 no launcher to hand it to, 4 the launcher refused it.
import { createConnection } from 'node:net'
import { appHome } from '../../src/dsh.js'
import { openSocketOf } from '../lib/open.mjs'

const args = process.argv.slice(2)
if (args.length === 1 && (args[0] === '--version' || args[0] === '--help')) {
  console.log('xdg-open (Automagik Linux image): opens an https: link in the browser on the host')
  process.exit(0)
}
if (args.length !== 1) {
  console.error('usage: xdg-open <https: URL>')
  process.exit(1)
}

const done = (code, message) => {
  if (message) console.error(`xdg-open: ${message}`)
  process.exit(code)
}
const socket = createConnection(openSocketOf(appHome(process.env), process.env))
let reply = ''
socket.setTimeout(10_000, () => done(3, 'the Automagik launcher did not answer'))
socket.on('connect', () => socket.write(`${JSON.stringify({ url: args[0] })}\n`))
socket.on('data', (chunk) => { reply += chunk.toString('utf8') })
socket.on('error', error => done(3, `the Automagik launcher is not running (${error.code ?? error.message})`))
socket.on('end', () => {
  let answer
  try { answer = JSON.parse(reply) } catch { return done(4, 'the launcher answered something else') }
  if (answer?.ok === true) return done(0)
  done(4, answer?.error ?? 'refused')
})
