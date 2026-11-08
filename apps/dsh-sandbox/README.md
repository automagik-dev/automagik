# dsh-sandbox: the hc socket mask for dsh-tui panes

The DSH lane's part of #624 (tracked by #631): a `bwrap` runner wrapper that hides the
herdr-core socket, the user's `~/.ssh` and the known container runtime sockets from a sandboxed
dsh-tui pane, and binds the pane's filtering proxy at the exact real core socket path inside
the sandbox. The Herdr lane owns the proxy itself and the pack/shim integration; this folder
owns the runner, the profile row snippet and the install/check helper. #631 is a shared wish,
so its pull requests say `Refs #631`, never `Fixes`.

The first cut is **Linux/bwrap only**. macOS (Seatbelt rule on the socket folder) and Windows
(ACL or named-pipe equivalent) need their own mount model and are later steps; this folder
ships no mask path for them, so there is nothing to enable there until that lands.

## Ownership

- **DSH lane** (this folder): the runner wrapper, the profile row snippet, the install/check
  helper, their tests and this contract.
- **Herdr lane**: the per-pane filtering proxy, the shim's pane environment and proxy lifecycle,
  the pack's copy of the wrapper and its call to the helper.
- #631 is the shared wish for both lanes, so pull requests here say `Refs #631`, never `Fixes`.

## Files

- `bin/hc-socket-mask.mjs`: the sandbox provider's `runnerCommand`. It inserts mount args
  before `--`, then execs `bwrap`. Mode 100755, Node ESM, no dependencies.
- `profile/sandbox-row.yml`: the profile row snippet, OFF by default. `{{WRAPPER}}` is a
  placeholder only the helper substitutes.
- `bin/dsh-sandbox.mjs`: `install` / `check` for the managed profile block. Node ESM, no
  dependencies.
- `test/wrapper.test.mjs`: hermetic runner tests (fake `bwrap`, temp Unix sockets, fake
  container list).
- `test/profile.test.mjs`: hermetic helper tests (temp profiles and temp wrappers only).

## Names (the contract with the Herdr lane)

- `DSH_SANDBOX_MASK=1`: the pack sets it at pane start. Exactly `1` turns the mask on; absent
  or anything else is today's behavior (the wrapper runs `bwrap` with exactly the arguments it
  received).
- `AM_HC_REAL_SOCKET`: the pane's real herdr-core socket, handed over by the dsh-tui shim.
  `HC_TERMINAL_SOCKET` is the fallback when it is absent.
- `AM_HC_PROXY_SOCKET`: the host-side per-pane proxy socket the Herdr lane starts; the wrapper
  binds it at `AM_HC_REAL_SOCKET` inside the sandbox and always hides its folder. It must be an
  absolute path: unset or relative is fatal (the wrapper cannot hide a folder it cannot name,
  and another pane's proxy could be impersonated).
- `--pack-root <dir>`: the wrapper's own leading word before the bwrap profile args, written by
  `dsh-sandbox install` into the row. It names the stable execution folder
  (`<data home>/automagik-herdr/dsh-sandbox`); the wrapper binds its parent
  (`<data home>/automagik-herdr`) read-only last, so the pack's `hcPane.mjs`, `bin/run.sh`,
  guard and the approved rosters under `approved/` cannot be rewritten from inside a writable
  workspace.
- `hc-socket-mask: `: the prefix of every wrapper line. It is the profile row's
  `runnerFailureSignatures` entry, so DSH reports a wrapper refusal as a runner failure.

The runner receives `[...runnerCommand, ...bwrapProfileArgs(policy), '--', ...command]` and
must leave the profile args, the separator and the command intact.

## What the mask does

With `DSH_SANDBOX_MASK=1` the wrapper inserts these mounts after the profile args and before
the `--`, in this order:

1. `--tmpfs <dirname(AM_HC_REAL_SOCKET)>` - hides the core socket and the holder sockets beside
   it (and any other listener in the core's runtime folder).
2. `--tmpfs <dirname(dirname(AM_HC_PROXY_SOCKET))>` - hides the shared `automagik-hc-proxy`
   folder, so every other pane's proxy socket is unreachable. When the path is also a live Unix
   socket, the bind comes first: `--bind <proxy> <real>` (the proxy answers at the path the
   client already uses, so `HC_TERMINAL_SOCKET`, `core.lock` and the client's address check need
   no rewrite), then the shared folder's tmpfs; the bind resolves its source before that tmpfs.
   When the socket is missing or not a socket, the shared folder is still hidden (with no bind),
   and the pane starts with no core socket. An unset or relative path is fatal before `bwrap`:
   the wrapper cannot name the folder to hide, so another pane's proxy could be impersonated.
   The parent must be the `automagik-hc-proxy` folder; anything else is fatal. The hidden folder
   is the proxy's, never the attach ledger's: the CLI in the pane still reads `attach.jsonl`.
3. `$HOME/.ssh` when it exists, following symlinks: a directory is shadowed with
   `--tmpfs <canonical path>`, anything else is bound over with
   `--bind /dev/null <canonical path>`. Absent, nothing is added (there is nothing to hide).
   `HOME` must be an absolute path.
4. For each existing container runtime socket, `--bind /dev/null <socket>`, canonicalized and
   deduplicated. The fixed list is:
   - `/var/run/docker.sock`
   - `/run/docker.sock`
   - `/run/containerd/containerd.sock`
   - `/run/podman/podman.sock`
   - `/run/user/<uid>/docker.sock` (rootless Docker, only when the platform has a uid)
   - `/run/user/<uid>/podman/podman.sock` (rootless Podman, only with a uid)

   Only paths that exist are masked; a test passes its own fake list, so no test looks at a live
   `docker.sock`.

5. When the row carries `--pack-root`, `--ro-bind <its parent> <its parent>`, after the
   profile args and the masks above, so it wins over a writable workspace bind. The pack's
   helper, runner and guard and the approved rosters live under that parent (the stable folder
   and `approved/`); without this a sandboxed bot inside the writable project could rewrite them
   and start a worker that runs the changed file outside the sandbox, or forge its next
   approval.

Everything else is the profile's own bwrap policy (`--ro-bind / /`, `--dev /dev`,
`--unshare-pid`, `--proc /proc`, `--die-with-parent`, the workspace binds). The wrapper adds no
network or port rule: the sandbox is a file-effect boundary, not a network one.

## Fail-closed rules

Before running `bwrap`, the wrapper refuses with one `hc-socket-mask: ` line and a nonzero exit
(no `bwrap`, so no pane) when:

- the real socket path (`AM_HC_REAL_SOCKET`, else `HC_TERMINAL_SOCKET`) is absent or not
  absolute;
- the real socket path has no folder of its own to hide (`dirname` is `/`);
- `AM_HC_PROXY_SOCKET` is unset or not absolute (the shared proxy folder cannot be hidden, so
  another pane's proxy could be impersonated);
- `HOME` is absent or not absolute (the runner will not guess where `~/.ssh` is);
- the runner arguments have no `--` separator (the command cannot be preserved);
- `--pack-root` is relative, missing or not a folder, or is not
  `<data home>/automagik-herdr/dsh-sandbox` (the data parent could not be made read-only);
- the proxy parent is not the `automagik-hc-proxy` folder, or it is the real socket path or an
  ancestor of it (masking it would hide the real socket or a shared system folder);
- `AM_HC_PROXY_SOCKET` is absolute but its folder is the real socket path or one of its parents
  (masking that folder would hide the proxy again), whether or not a bind is added.

When `AM_HC_PROXY_SOCKET` is absolute but missing or not a Unix socket, the wrapper prints one
`hc-socket-mask: ` line, hides the proxy's host folder along with the real folder, `~/.ssh` (if
present) and the container sockets, and runs `bwrap` with **no core socket**: the pane starts
and its `hc` calls fail closed. This is the "proxy not up yet" case and a non-socket path; it
never falls back to the real socket. **The pack must always set an absolute
`AM_HC_PROXY_SOCKET`**: an unset or relative one refuses the pane instead of starting it without
the folder mask.

With the switch off, nothing above applies: the wrapper runs `bwrap` with exactly the argv it
was handed, which is today's behavior.

## Localhost admin ports

This cut cannot deny TCP ports, so an admin endpoint must not listen on localhost TCP from a
sandboxed pane's point of view. The rule is: admin endpoints stay on **root-only Unix sockets**
(owned by root, mode 0600), which the pane's uid 1000 cannot connect to. The Caddy admin
listener was already moved to one. The wrapper masks the known container runtime sockets above;
any service that still listens on a localhost TCP port is reachable from the sandbox and needs
its own decision (a process/network boundary, #629 or later), not this wrapper.

## Rollout

Nothing here is installed on a live profile today. The order:

1. This PR lands the runner, the row snippet, the helper, the tests and the CI job. It installs
   nothing and changes no live profile.
2. The Herdr lane's proxy PR adds the per-pane proxy and sets, in the pane environment it
   starts: `DSH_SANDBOX_MASK=1`, `AM_HC_REAL_SOCKET=<the pane's real core socket>` and
   `AM_HC_PROXY_SOCKET=<the absolute host proxy socket>`. It starts the proxy before DSH and
   refuses the pane if the proxy cannot start; the wrapper refuses a pane without an absolute
   proxy path.
3. At enablement the pack (`herdr/mods/am-sidebar/dshTui.mjs`) copies `bin/hc-socket-mask.mjs`
   **byte-equal** from the pack release to a stable path, the way
   `node scripts/am-copies.mjs --check` treats the am copies, then runs
   `dsh-sandbox install --profile <the dsh-tui profile> --wrapper <that absolute path>`. The
   pack owns when; this folder owns how.
4. Until steps 2-3 are deployed together, the row is inert: with no `DSH_SANDBOX_MASK=1` the
   wrapper is a pass-through, and with the switch but no proxy the pane fails closed instead of
   reaching the real socket.

The pack carries the wrapper in its own release; this repository's release lane never ships
`apps/dsh-sandbox/` (`scripts/lane.ts` `NEVER_SHIPPED`), so a change here alone cuts no release
and never becomes a plugin tarball.

## Helper usage

The default profile is `$DSH_HOME/profiles/dsh-tui/cordis.patch.yml`, with `DSH_HOME` defaulting
to `~/.dsh`.

```sh
# Install (or re-install) the managed row. The wrapper must exist, be executable and be named by
# an absolute path (a relative one is refused).
node apps/dsh-sandbox/bin/dsh-sandbox.mjs install \
  --wrapper /path/to/hc-socket-mask.mjs --pack-root /path/to/data/automagik-herdr/dsh-sandbox

# Check it without writing: exit 0 when the block is there exactly once and matches.
node apps/dsh-sandbox/bin/dsh-sandbox.mjs check \
  --wrapper /path/to/hc-socket-mask.mjs --pack-root /path/to/data/automagik-herdr/dsh-sandbox

# A temp profile, as the tests and the pack's dry run use.
node apps/dsh-sandbox/bin/dsh-sandbox.mjs install \
  --profile /tmp/cordis.patch.yml --wrapper /path/to/hc-socket-mask.mjs \
  --pack-root /path/to/data/automagik-herdr/dsh-sandbox
```

`install` backs an existing profile up to
`<profile>.dsh-sandbox-backup-<ISO-timestamp>`, writes through a sibling temp file and a rename,
and is idempotent: an already-current block is not rewritten and takes no new backup. The block
is marked `# dsh-sandbox begin` / `# dsh-sandbox end`; install replaces it in place (or appends
it), and refuses to guess when the markers are duplicated or broken. `check` only reads. Exit
codes: `0` installed/current, `1` refusal or mismatch, `2` usage.

The helper understands three top-level layer shapes: an empty/comments-only file, the DSH
template's lone `[]`, and a block array. `install` replaces the lone `[]` line (keeping the
template comments) and appends after an empty/comments-only file or an existing block array,
then requires the result to be one block array again; it refuses a mapping, a scalar or a
non-empty flow array without writing. This is a top-level shape check, not a YAML parser.
`check` applies the same shape check before it compares the managed block, so the corrupted
`[]` plus block state is never reported as current.

## Tests

```sh
node --check apps/dsh-sandbox/bin/*.mjs
node --test 'apps/dsh-sandbox/test/*.test.mjs'
```

The runner tests put a fake `bwrap` first on a temp `PATH` and assert the argv it records; the
proxy sockets are real `net.createServer()` sockets under temp folders. CLI-level tests drop the
host-dependent container `--bind /dev/null` pairs by shape and never stat a live path; their
exact targets are asserted only by the pure-helper tests with an explicit fake container list.
So no test reads, creates or connects to a live core, a live `docker.sock` or a live profile.
The helper tests write only temp profiles. `ci.yml`'s
`dsh-sandbox` job runs both on every change under `apps/dsh-sandbox/` and on every change to
the workflow itself.
