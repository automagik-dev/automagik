#!/usr/bin/env node
// Build the server image. No push: CI and an operator's machine build the same way.
//
//   node server/build.mjs [--tag automagik-server:local] [--version 3.90.1]
//                         [--dsh 0.2.2-rc.1] [--repository https://github.com/automagik-dev/automagik]
//                         [--no-cache]
import { execFileSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function argsOf(argv) {
  const args = { cache: true }
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index]
    if (name === '--no-cache') {
      args.cache = false
      continue
    }
    if (!name.startsWith('--')) throw new Error(`unexpected argument: ${name}`)
    const value = argv[index + 1]
    if (value === undefined) throw new Error(`${name} needs a value`)
    args[name.slice(2)] = value
    index += 1
  }
  return args
}

const args = argsOf(process.argv.slice(2))
const tag = args.tag || 'automagik-server:local'
const version = args.version || '3.90.1'
const dsh = args.dsh || '0.2.2-rc.1'
const repository = args.repository || 'https://github.com/automagik-dev/automagik'
const command = ['build', '--file', 'server/Dockerfile', '--tag', tag,
  '--build-arg', `AUTOMAGIK_VERSION=${version}`,
  '--build-arg', `DSH_VERSION=${dsh}`,
  '--build-arg', `AUTOMAGIK_REPOSITORY=${repository}`]
if (!args.cache) command.push('--no-cache')

console.log(`[build] docker ${command.join(' ')} ${ROOT}`)
execFileSync('docker', command, { cwd: ROOT, stdio: 'inherit' })

const bytes = Number(execFileSync('docker', ['image', 'inspect', tag, '--format', '{{.Size}}'], { encoding: 'utf8' }).trim())
const id = execFileSync('docker', ['image', 'inspect', tag, '--format', '{{.Id}}'], { encoding: 'utf8' }).trim()
console.log(`[build] image ${tag} ${id.slice(0, 19)} ${bytes} bytes (${(bytes / 1048576).toFixed(1)} MiB)`)
