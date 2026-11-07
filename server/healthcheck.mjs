#!/usr/bin/env node
// Docker's health check, in the image's own node: GET the web app on 127.0.0.1 and print the
// HTTP code. Only 401 is healthy: the auth fence is up. A 200 means the fence answered without
// a session, which is not a healthy server; anything else, or no answer, prints 000 and fails.
// No curl, no journalctl, no cookie.
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
    response.on('end', () => process.exit(response.statusCode === 401 ? 0 : 1))
  },
)
request.on('timeout', () => {
  request.destroy()
  fail()
})
request.on('error', fail)
