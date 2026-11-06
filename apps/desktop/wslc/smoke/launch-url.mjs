// CHECK 2's comparison of the ready frame's url with the line DSH printed, and its message.
//
// Both sides are DSH's own bytes and are compared unmasked: the token is part of the evidence
// (a frame carrying another token did not carry DSH's line), so masking either side for the
// comparison would drop the assertion's point. Only the failure message masks, with the same
// `token=<masked>` shape the smoke's other messages use.
//
// The smoke must not compare the moment the ready frame arrives: the frame comes on the
// launcher's stdout and DSH's line on its stderr, two pipes with no order between them even
// though the launcher writes stderr first. It compares after the driver's `close()`, which waits
// for the child's 'close' — both pipes closed, every stderr chunk delivered — so arrival order
// cannot decide the check.

/** `url` with its launch token masked, for a message; never for a comparison. */
export const maskUrl = url => String(url).replace(/token=[^&\s]+/, 'token=<masked>')

/** The URL of the first `dsh web:` line in `stderr`, raw; null when there is none. */
export function printedLaunchUrl(stderr) {
  const match = String(stderr).match(/dsh web: (\S+)/)
  return match ? match[1] : null
}

/** Why `readyUrl` is not the URL DSH printed (`stderr`); null when it is. The message masks. */
export function launchUrlMismatch(readyUrl, stderr) {
  const printed = printedLaunchUrl(stderr)
  if (printed === readyUrl) return null
  const shown = printed === null ? ' (no launch line on stderr)' : ` (${maskUrl(printed)})`
  return `ready's url ${maskUrl(readyUrl)} is not the one DSH printed${shown}`
}
