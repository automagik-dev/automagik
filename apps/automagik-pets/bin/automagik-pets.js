#!/usr/bin/env node
// automagik-pets: bakes one of the team's characters, in one ink, into a Codex v2 pet folder,
// with no browser.
//
//   automagik-pets bake <character>-<colour> [--home <bots home>] [--json]
//   automagik-pets --version [--json]
//
// The folder is <bots home>/pets/<character>-<colour>/; the bots home is --home, else
// $AUTOMAGIK_BOTS_HOME, else $AUTOMAGIK_HOME/bots, else ~/.automagik/bots. With --json the
// last stdout line is {"ok":true,"dir":"..."} or {"ok":false,"error":"..."}, and anything else
// goes to stderr. A failure exits 1; a wrong command line exits 2.

const USAGE = 'usage: automagik-pets bake <character>-<colour> [--home <dir>] [--json] | automagik-pets --version [--json]'

function parse(argv) {
  const options = { json: false, home: undefined, version: false, positional: [] }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--json') options.json = true
    else if (arg === '--version' || arg === '-v') options.version = true
    else if (arg === '--home' || arg.startsWith('--home=')) {
      // A folder is never taken from the next option: in '--home --json' the folder is missing
      // and --json still counts, so the error answers as JSON.
      const value = arg === '--home' ? argv[index + 1] : arg.slice('--home='.length)
      const folder = value !== undefined && value.trim() !== '' && !value.startsWith('-')
      if (arg === '--home' && folder) index += 1
      if (folder) options.home = value
      else options.usage = `--home needs a folder${value ? `, not ${value}` : ''}`
    }
    else if (arg.startsWith('-')) options.usage = `unknown option ${arg}`
    else options.positional.push(arg)
  }
  return options
}

async function main(argv) {
  const options = parse(argv)
  const say = (result, human) => {
    if (options.json) process.stdout.write(`${JSON.stringify(result)}\n`)
    else if (result.ok) process.stdout.write(`${human}\n`)
    else process.stderr.write(`automagik-pets: ${result.error}\n`)
  }
  if (options.usage) {
    say({ ok: false, error: `${options.usage}; ${USAGE}` })
    return 2
  }
  try {
    // Loaded here, so a missing image library still answers in the agreed shape.
    const { VERSION, bakePet } = await import('../src/bake.js')
    if (options.version) {
      say({ ok: true, version: VERSION }, VERSION)
      return 0
    }
    const [command, id, ...rest] = options.positional
    if (command !== 'bake' || id === undefined || rest.length > 0) {
      say({ ok: false, error: USAGE })
      return 2
    }
    const { dir } = await bakePet(id, { home: options.home })
    say({ ok: true, dir }, dir)
    return 0
  } catch (error) {
    say({ ok: false, error: error?.message ?? String(error) })
    return 1
  }
}

process.exitCode = await main(process.argv.slice(2))
