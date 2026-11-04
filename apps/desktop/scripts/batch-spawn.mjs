// Running a Windows batch file (npm.cmd, a .bat) from Node. Node 18.20.2 and later refuse to
// spawn one without a shell (`spawnSync npm.cmd EINVAL`, CVE-2024-27980), and with
// `shell: true` they join the arguments with spaces, unquoted, into cmd.exe's command line. So
// a batch file gets `shell: true` and every argument quoted here; anything else runs without a
// shell, as before. An argument cmd.exe would still read into (a `"`, a `%`, a line break) is
// refused rather than escaped: nothing the build passes has one.

const BATCH = /\.(cmd|bat)$/i
const UNSAFE = /["%\r\n]/
// A name or a backslashed path cmd.exe reads as one word. The batch file itself is quoted only
// when it is not one: started by a quoted bare name ("npm.cmd"), a batch file finds itself in
// the current folder (%~dp0) instead of its own, and npm.cmd then looks for npm there. A `/`
// path is quoted too: unquoted, cmd.exe reads `./x.cmd` as the command `.`.
const PLAIN = /^[\w.:\\-]+$/

/** One argument as cmd.exe and the C runtime behind it read it back, unchanged. */
export function quoteForCmd(arg) {
  const text = String(arg)
  if (UNSAFE.test(text) || text.includes('\u0000')) throw new Error(`refusing to pass ${JSON.stringify(text)} through cmd.exe: it holds a ", a % or a line break`)
  // Backslashes right before the closing quote would escape it: double them.
  return `"${text.replace(/(\\+)$/, '$1$1')}"`
}

/**
 * The [file, args, options] to hand execFileSync or spawn for `file`: on Windows a batch file
 * runs through cmd.exe with its arguments quoted; everything else is passed on as it is.
 */
export function batchSafe(file, args = [], options = {}, platform = process.platform) {
  if (platform !== 'win32' || !BATCH.test(file)) return [file, args, options]
  return [PLAIN.test(file) ? file : quoteForCmd(file), args.map(quoteForCmd), { ...options, shell: true }]
}
