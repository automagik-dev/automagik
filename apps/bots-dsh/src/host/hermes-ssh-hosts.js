import { execFile as runFile } from 'node:child_process'
import { readdir, open, realpath, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, parse, resolve, sep } from 'node:path'
import { promisify } from 'node:util'

const execute = promisify(runFile)
const LIMITS = { files: 64, bytes: 1024 * 1024, configBytes: 128 * 1024, knownBytes: 512 * 1024, depth: 8, directories: 128, aliases: 128, known: 512, timeout: 750, total: 5000 }
const literal = value => typeof value === 'string' && value.length > 0 && value.length <= 255
  && !value.startsWith('-') && /^[a-zA-Z0-9_.:[\]-]+$/.test(value)
const row = (alias, hostname = alias, user = '', port = '') => ({ alias, hostname, user, port })
const portOf = value => /^\d+$/.test(value) && Number(value) > 0 && Number(value) <= 65535 ? String(Number(value)) : ''

// SSH arguments may be quoted or escaped. Comments start only outside quotes.
function words(text) {
  const values = []
  let value = '', quote = '', escaped = false, started = false
  for (const character of text) {
    if (escaped) { value += character; escaped = false; started = true }
    else if (character === '\\') { escaped = true; started = true }
    else if (quote) { if (character === quote) quote = ''; else value += character }
    else if (character === '"' || character === "'") { quote = character; started = true }
    else if (character === '#') break
    else if (/\s/.test(character)) { if (started) values.push(value); value = ''; started = false }
    else { value += character; started = true }
  }
  if (quote || escaped) return []
  if (started) values.push(value)
  return values
}

function pattern(segment) {
  let source = '^'
  for (let index = 0; index < segment.length; index++) {
    const character = segment[index]
    if (character === '*') source += '.*'
    else if (character === '?') source += '.'
    else if (character === '[') {
      const end = segment.indexOf(']', index + 1)
      if (end === -1) return undefined
      const contents = segment.slice(index + 1, end)
      source += `[${contents.startsWith('!') ? '^' + contents.slice(1) : contents}]`
      index = end
    } else source += character.replace(/[\\^$+.(){}|\]]/g, '\\$&')
  }
  try { return new RegExp(source + '$') } catch { return undefined }
}

async function includeFiles(input, sshDir, budget, signal) {
  if (input.length > 4096) return []
  const expanded = input.startsWith('~/') ? join(dirname(sshDir), input.slice(2)) : input
  const absolute = isAbsolute(expanded) ? expanded : resolve(sshDir, expanded)
  const root = parse(absolute).root, segments = absolute.slice(root.length).split(sep).filter(Boolean)
  if (segments.length > 32) return []
  let paths = [root]
  for (const segment of segments) {
    if (signal?.aborted || !paths.length) return []
    if (!/[*?[]/.test(segment)) { paths = paths.map(path => join(path, segment)); continue }
    const match = pattern(segment)
    if (!match) return []
    const next = []
    for (const path of paths) {
      if (budget.directories++ >= LIMITS.directories) break
      try {
        for (const entry of (await readdir(path)).sort()) {
          if (match.test(entry)) next.push(join(path, entry))
          if (next.length >= LIMITS.files) break
        }
      } catch { /* One missing Include does not hide other hosts. */ }
      if (next.length >= LIMITS.files) break
    }
    paths = next
  }
  return paths
}

async function contents(path, maximum, budget, signal) {
  if (signal?.aborted || budget.files >= LIMITS.files || budget.bytes > LIMITS.bytes) return undefined
  try {
    const canonical = await realpath(path)
    if (budget.seen.has(canonical)) return undefined
    budget.seen.add(canonical)
    const info = await stat(canonical)
    if (!info.isFile() || info.size > maximum || info.size + budget.bytes > LIMITS.bytes) return undefined
    budget.files++
    const buffer = Buffer.alloc(Math.min(maximum, LIMITS.bytes - budget.bytes) + 1), file = await open(canonical, 'r')
    let length = 0
    try {
      while (length < buffer.length && !signal?.aborted) {
        const { bytesRead } = await file.read(buffer, length, buffer.length - length, length)
        if (!bytesRead) break
        length += bytesRead
      }
    } finally { await file.close() }
    budget.bytes += length
    if (length > maximum || budget.bytes > LIMITS.bytes || signal?.aborted) return undefined
    return buffer.toString('utf8', 0, length)
  } catch { return undefined }
}

async function aliasesIn(sshDir, budget, signal) {
  const aliases = new Set(), state = { match: false }
  async function visit(path, depth) {
    if (depth > LIMITS.depth || aliases.size >= LIMITS.aliases) return
    const text = await contents(path, LIMITS.configBytes, budget, signal)
    if (text === undefined) return
    for (const line of text.split(/\r?\n/)) {
      if (signal?.aborted || aliases.size >= LIMITS.aliases) break
      const directive = /^\s*([a-zA-Z][a-zA-Z0-9]*)\s*(?:=\s*)?(.*)$/.exec(line)
      if (!directive) continue
      const name = directive[1].toLowerCase(), values = words(directive[2])
      if (name === 'match') state.match = true
      else if (name === 'host') {
        state.match = false
        for (const value of values) if (literal(value)) { aliases.add(value); if (aliases.size >= LIMITS.aliases) break }
      } else if (name === 'include' && !state.match) {
        for (const value of values) for (const included of await includeFiles(value, sshDir, budget, signal)) await visit(included, depth + 1)
      }
    }
  }
  await visit(join(sshDir, 'config'), 0)
  return [...aliases]
}

async function resolveAlias(alias, execFile, env, signal, until) {
  const fallback = row(alias), milliseconds = Math.min(LIMITS.timeout, until - Date.now())
  if (signal?.aborted || milliseconds <= 0) return fallback
  const controller = new AbortController()
  let timer, abort
  const cancelled = new Promise(resolveFallback => {
    abort = () => { controller.abort(); resolveFallback(undefined) }
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) abort()
    timer = setTimeout(abort, milliseconds)
  })
  try {
    if (signal?.aborted) return fallback
    const result = await Promise.race([execFile('ssh', ['-G', alias], { env, shell: false, windowsHide: true, encoding: 'utf8', timeout: milliseconds, killSignal: 'SIGKILL', maxBuffer: 32 * 1024, signal: controller.signal }), cancelled])
    const text = typeof result === 'string' ? result : result?.stdout
    if (typeof text !== 'string' || Buffer.byteLength(text) > 32 * 1024 || signal?.aborted) return fallback
    const fields = new Map()
    for (const line of text.split(/\r?\n/)) {
      const field = /^\s*(hostname|user|port)(?:\s+|=)(.*?)\s*$/i.exec(line)
      if (field && !fields.has(field[1].toLowerCase())) fields.set(field[1].toLowerCase(), field[2])
    }
    const hostname = fields.get('hostname'), user = fields.get('user') ?? ''
    return row(alias, literal(hostname) ? hostname : alias, /^[a-zA-Z0-9_.@\\-]{1,255}$/.test(user) ? user : '', portOf(fields.get('port') ?? ''))
  } catch { return fallback }
  finally { clearTimeout(timer); signal?.removeEventListener('abort', abort) }
}

function knownIn(text, aliases) {
  const seen = new Set(aliases.flatMap(host => [host.alias.toLowerCase(), host.hostname.toLowerCase()])), known = []
  for (const line of (text ?? '').split(/\r?\n/)) {
    const values = line.trim().split(/\s+/)
    if (values[0]?.startsWith('@') || values.length < 3) continue
    const names = values[0]
    for (const name of (names ?? '').split(',')) {
      const bracket = /^\[([^\]]+)\]:(\d+)$/.exec(name)
      const hostname = bracket?.[1] ?? name, port = bracket ? portOf(bracket[2]) : ''
      if (!literal(hostname) || (bracket && !port) || seen.has(hostname.toLowerCase())) continue
      seen.add(hostname.toLowerCase()); known.push(row(hostname, hostname, '', port))
      if (known.length >= LIMITS.known) return known
    }
  }
  return known
}

// Called only by the host endpoint. Tests inject a disposable directory and executor;
// no IdentityFile directive is followed, and no extra ssh -G output leaves this module.
export async function discoverSshHosts({ signal, sshDir = join(homedir(), '.ssh'), execFile = execute, env = process.env } = {}) {
  const budget = { files: 0, bytes: 0, directories: 0, seen: new Set() }
  const aliases = (await aliasesIn(sshDir, budget, signal)).map(alias => row(alias))
  const until = Date.now() + LIMITS.total
  let cursor = 0
  await Promise.all(Array.from({ length: Math.min(4, aliases.length) }, async () => {
    while (cursor < aliases.length && !signal?.aborted) {
      const index = cursor++
      aliases[index] = await resolveAlias(aliases[index].alias, execFile, env, signal, until)
    }
  }))
  const known = await contents(join(sshDir, 'known_hosts'), LIMITS.knownBytes, budget, signal)
  return { aliases, knownHosts: knownIn(known, aliases) }
}
