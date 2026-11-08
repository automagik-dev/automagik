// electron-builder afterSign hook (macOS): notarize the signed app, then staple and validate it
// through the retrying script, before the zip/dmg targets are packed.
//
// Why a hook of our own: electron-builder's built-in notarization calls @electron/notarize, and
// that version (2.5.0, pinned in package-lock.json) always staples immediately after the
// submission; it has no `staple: false`. That staple is the second unprotected CloudKit
// round-trip (#704). electron-builder.yml therefore turns the integration off
// (`mac.notarize: false`) and this hook keeps the two steps apart:
//
//   1. notarytool submit a zip of the signed app with the API-key credentials and wait;
//   2. scripts/staple-retry.sh at the repository root staples and validates the .app, retrying
//      only Apple's transient network errors and failing on a real rejection.
//
// afterSign runs after the app is signed and before the zip/dmg are built, so the updater's zip
// carries the stapled app; the dmg is notarized and stapled by
// .github/workflows/desktop-build.yml.
const { spawnSync } = require('node:child_process')
const { existsSync, mkdtempSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { basename, dirname, join, resolve } = require('node:path')

const STAPLE_RETRY = resolve(__dirname, '..', '..', '..', 'scripts', 'staple-retry.sh')

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options })
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    error: result.error,
  }
}

// notarytool in JSON mode still prints its human progress to stderr; the verdict is the last
// JSON object on stdout. This is apps/desktop/src/dsh-tui.js's lastJson, copied because that
// module is ESM and this hook is CommonJS: scan the lines from the end and take the last one
// that parses as a JSON object.
function lastJson(text) {
  const lines = String(text ?? '').trim().split(/\r?\n/)
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim()
    if (!line.startsWith('{')) continue
    try { return JSON.parse(line) } catch { /* not the verdict */ }
  }
  return null
}

/** Print one child stream's lines to the build log; stdout and stderr stay separate. */
function printOutput(stream, text) {
  for (const line of String(text ?? '').split(/\r?\n/)) {
    if (line.trim()) console.log(`[after-sign] ${stream}: ${line}`)
  }
}

exports.default = async function afterSign(context) {
  if (context.electronPlatformName !== 'darwin') return

  const key = process.env.APPLE_API_KEY
  const keyId = process.env.APPLE_API_KEY_ID
  const issuer = process.env.APPLE_API_ISSUER
  if (!key || !keyId || !issuer) {
    console.log('[after-sign] no App Store Connect API key: the app is not notarized or stapled')
    return
  }

  const appPath = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  if (!existsSync(appPath)) {
    throw new Error(`after-sign: the signed app is missing: ${appPath}`)
  }

  // notarytool takes an archive, not a bundle: the same ditto zip @electron/notarize makes.
  const temp = mkdtempSync(join(tmpdir(), 'automagik-notarize-'))
  try {
    const zipPath = join(temp, 'app.zip')
    const zip = run(
      'ditto',
      ['-c', '-k', '--sequesterRsrc', '--keepParent', basename(appPath), zipPath],
      { cwd: dirname(appPath) },
    )
    if (zip.status !== 0) {
      const detail = `${zip.stdout}${zip.stderr}`.trim()
      throw new Error(
        `after-sign: failed to zip the app for notarization (exit ${zip.status})${detail ? `\n\n${detail}` : ''}`,
      )
    }

    console.log('[after-sign] notarizing the app with notarytool (no staple in this step)')
    const submit = run('xcrun', [
      'notarytool', 'submit', zipPath,
      '--key', key, '--key-id', keyId, '--issuer', issuer,
      '--wait', '--timeout', '30m', '--output-format', 'json',
    ])
    // notarytool prints human progress on stderr even in JSON mode: log both streams, but
    // read the verdict from stdout only, so a progress line can never hide an acceptance.
    printOutput('notarytool stdout', submit.stdout)
    printOutput('notarytool stderr', submit.stderr)
    const verdict = lastJson(submit.stdout)
    if (submit.status !== 0 || verdict?.status !== 'Accepted') {
      throw new Error(
        `after-sign: the app was not accepted by the notary service (exit ${submit.status}, status: ${verdict?.status ?? 'unparsable'})`,
      )
    }
    console.log(`[after-sign] notarization accepted${verdict.id ? ` (id: ${verdict.id})` : ''}`)
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }

  console.log('[after-sign] stapling and validating the app before the zip/dmg targets')
  const staple = run('bash', [STAPLE_RETRY, appPath], { stdio: 'inherit' })
  if (staple.status !== 0) {
    throw new Error(`after-sign: staple/validate failed for the app (exit ${staple.status}${staple.error ? `: ${staple.error.message}` : ''})`)
  }
  console.log('[after-sign] the app is stapled and validated; the zip/dmg will carry it')
}
