#!/usr/bin/env node
// Docker's health check, in the image's own node: GET the web app on 127.0.0.1 and print the
// HTTP code. 401 is the healthy answer without a browser session (the auth fence is up);
// 200 is healthy too (a fresh launch URL's token was accepted). Anything else, or no answer,
// prints 000 and fails. No curl, no journalctl, no cookie.
import http from 'node:http'
import { PORT } from './lib.mjs'

const fail = () => {
  process.stdout.write('000\n')
  process.exit(1)
}

const request = http.get(
  { host: '127.0.0.1', port: PORT, path: '/', timeout: 4000, headers: { connection: 'close' } },
  (response) => {
    process.stdout.write(`${response.statusCode}\n`)
    response.resume()
    response.on('end', () => process.exit(response.statusCode === 401 || response.statusCode === 200 ? 0 : 1))
  },
)
request.on('timeout', () => {
  request.destroy()
  fail()
})
request.on('error', fail)
