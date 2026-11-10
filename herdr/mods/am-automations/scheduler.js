// The scheduler release this panel installs and drives: our build of the vendored fork
// (herdr/scheduler/, UPSTREAM.md), not upstream DnzzL's own release. When `herdr-automations` is
// missing (#220) the panel offers repairCommand() as the install line: Copy copies it, Install runs
// it, and only a click does. The sha256s are our release's checksums.txt, pinned here (`sha256` the
// two darwin builds, `linux` the two Linux ones), and herdr/scripts/scheduler-pin.mjs checks all four
// against that release. install.sh reads this file out of the pack tarball it has just verified and
// installs the same build, so it holds no pin of its own. Pure: no `herdr`, so Node reads the same
// pins the panel installs. Apache-2.0.
export const SCHEDULER = Object.freeze({
  repo: "automagik-dev/automagik",
  version: "0.12.1-am.1",
  sha256: Object.freeze({
    arm64: "bcfa2d499668cefedf5c6f465c30331adaeda1eb0341b1982be240d727fad4de",
    amd64: "f106185b80994074fd439af1f2db23c1eb3464f13710f6e1ae325dd990695c2e",
  }),
  linux: Object.freeze({
    arm64: "c45a14eadc7adb81e00456c59bede897ed39a79f1421ff4a993769a5b75d8e2c",
    amd64: "4db0b9e4f13e29d43b2b1af0daa3e647c42c0bc5d8d075d059a8fe9f6082aa13",
  }),
});

/** The command that installs the scheduler to ~/.local/bin, hash-checked, for this machine's
 * `uname -m` and `uname -s` (anything but Linux reads as a Mac; a subshell, so the terminal it is
 * pasted in stays where it was). Its scratch folder is removed whether it worked or not, and the
 * subshell exits with the install's own status. */
export function repairCommand(machine, os = "Darwin") {
  const linux = os === "Linux";
  const arch = machine === "x86_64" || machine === "amd64" ? "amd64" : "arm64";
  const url = `https://github.com/${SCHEDULER.repo}/releases/download/herdr-automations-v${SCHEDULER.version}/herdr-automations_${linux ? "linux" : "darwin"}_${arch}`;
  return `(mkdir -p ~/.local/bin && d="$(mktemp -d)" && cd "$d" && curl -fsSLo herdr-automations ${url}`
    + ` && echo "${(linux ? SCHEDULER.linux : SCHEDULER.sha256)[arch]}  herdr-automations" | ${linux ? "sha256sum -c" : "shasum -a 256 -c"}`
    + ' && chmod 755 herdr-automations && mv herdr-automations ~/.local/bin/; s=$?; cd /; [ -z "$d" ] || rm -rf "$d"; exit "$s")';
}
