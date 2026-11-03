// SPIKE harness only (cross-os.yml, Windows): loaded with NODE_OPTIONS=--require when
// apps/desktop/scripts/prepare-runtime.mjs fails without it. Node >= 18.20.2 refuses to spawn a
// .cmd or .bat without a shell (EINVAL, CVE-2024-27980), and prepare-runtime runs `npm.cmd`
// through execFileSync. This adds `shell: true` for those files only, so the matrix can still
// build the runtime on Windows and record that the script needs this fix.
const childProcess = require('node:child_process')
const { syncBuiltinESMExports } = require('node:module')

for (const name of ['execFileSync', 'execFile', 'spawnSync', 'spawn']) {
  const original = childProcess[name]
  childProcess[name] = function patched(file, args, options, ...rest) {
    if (typeof file === 'string' && /\.(cmd|bat)$/i.test(file)) {
      if (!Array.isArray(args)) {
        rest.unshift(options)
        options = args
        args = []
      }
      return original.call(this, file, args, { ...(options ?? {}), shell: true }, ...rest)
    }
    return original.apply(this, arguments)
  }
}
syncBuiltinESMExports()
