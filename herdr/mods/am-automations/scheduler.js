// The scheduler release this panel installs and drives: our build of the vendored fork
// (herdr/scheduler/, UPSTREAM.md), not upstream DnzzL's own release. When `herdr-automations` is
// missing (#220) the panel offers repairCommand() as the install line to copy; it never runs it.
// The sha256s are our release's checksums.txt, pinned here (macOS only, as part.json says), and
// herdr/scripts/scheduler-pin.mjs checks them against that release. Pure: no `herdr`, so Node reads
// the same pins the panel installs. Apache-2.0.
export const SCHEDULER = Object.freeze({
  repo: "automagik-dev/automagik",
  version: "0.12.1-am.1",
  sha256: Object.freeze({
    arm64: "PENDING-SHA256",
    amd64: "PENDING-SHA256",
  }),
});

/** The command that installs the scheduler to ~/.local/bin, hash-checked, for this Mac's `uname -m`
 * (a subshell, so the terminal it is pasted in stays where it was). */
export function repairCommand(machine) {
  const arch = machine === "x86_64" ? "amd64" : "arm64";
  const url = `https://github.com/${SCHEDULER.repo}/releases/download/herdr-automations-v${SCHEDULER.version}/herdr-automations_darwin_${arch}`;
  return `(mkdir -p ~/.local/bin && cd "$(mktemp -d)" && curl -fsSLo herdr-automations ${url}`
    + ` && echo "${SCHEDULER.sha256[arch]}  herdr-automations" | shasum -a 256 -c`
    + " && chmod 755 herdr-automations && mv herdr-automations ~/.local/bin/)";
}
