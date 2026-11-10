// The sidebar's usagemeter run (Group 6c): `usagemeter sync` once METER_FIRST_MS after load, then
// every METER_EVERY_MS while Herdr is open. No LaunchAgent and no daemon: Herdr's exec runs the
// one shared binary install.sh put in ~/.local/bin (Herdr started from the Dock may lack that
// folder on its PATH, so the path is absolute), through SYNC, which also puts that folder on
// PATH, as am-quota's AUTH_SCRIPT and agentPath.mjs do: usagemeter finds hc on PATH, and without
// hc no terminal, label or machine id reaches the meter. One run at a time, never more often than
// usagemeter's own 10-minute freshness check: the start time is shared across sidebar copies,
// and a copy never starts a run while its last one is still going. A missing binary is silent (SYNC
// exits 0), and so is any exit of the meter's: during its first sync after an upgrade from 0.3.0
// it may skip (exit 0: another sync, or an older meter, holds a lock), stop at a move it cannot
// prove (3) or at too little free space (4), each with nothing changed; the next run is due as usual.
// Then the same on each connected linked machine (SYNC through exec's `on`), one at a
// time: each machine's sync writes its own `herdr-meter` doc, which the phone reads there.
// The fleet coverage (RFC 0026 (e)): after a machine's sync, the same run asks its usagemeter
// for its bot-tag coverage and, at the end, writes the one fleet record beside the install
// record (meterFleet.js: the record; writeFleetRecord: the file, 0600). No timer of its own.
// Pure: no `herdr` import (exec, the shared value and the clock are passed in), so `node --test`
// runs it; main.js wires it to Herdr's exec, shared and timer. Apache-2.0.

import { FLEET_FILE, FLEET_HERE, FLEET_WINDOW, MACHINE_NAME, coverageEntry, exitReason, fleetRecord } from "./meterFleet.js";

export const METER_FIRST_MS = 30_000;
export const METER_EVERY_MS = 10 * 60 * 1000;
/**
 * The most one linked machine's sync may take (Herdr's exec ends a program at 30 s too): a machine
 * that hangs past it is left behind, the run goes on to the next one and ends, and the next run
 * is scheduled as usual. Timed with the caller's `sleep(ms)` (a mod has no timer functions: main.js
 * builds it on cx.timer, launch.js sleepOf); without one, only Herdr's own cap applies.
 */
export const METER_EXEC_LIMIT_MS = 30_000;
const TIMED_OUT = Symbol("timed out");

/** The shared value (Herdr's shared/setShared) holding when the last run started (ms). */
export const METER_KEY = "am.sidebar.meter-started";

/**
 * Run as `sh -c SYNC` on a linked machine (its own usagemeter sync; no binary there is silent),
 * and as `sh -c SYNC sh <bin>` here: $1, Herdr's absolute path, is the binary run, never the
 * default beside it. ~/.local/bin goes on PATH, after what is there and only when it is missing,
 * so usagemeter finds hc (hc exec and Herdr started from the Dock may run it without that folder). After, never before: an hc the person's PATH names first
 * stays first, the same order the CLI's realHcPath uses, so the sidebar's sync and `meter install`
 * reach the same hc. Pocket Link's bridge puts ~/.local/bin first because a LaunchAgent starts it
 * with a bare PATH, where nothing else would name hc.
 */
export const SYNC = `case ":$PATH:" in
*":$HOME/.local/bin:"*) ;;
*) PATH=\${PATH:+$PATH:}$HOME/.local/bin; export PATH ;;
esac
m=\${1:-$HOME/.local/bin/usagemeter}
[ -x "$m" ] || exit 0
exec "$m" sync`;

/**
 * Run as SYNC is (`sh -c COVERAGE` on a linked machine, `sh -c COVERAGE sh <bin>` here): that
 * machine's `usagemeter coverage --window <FLEET_WINDOW> --json`, a read of its own store (no
 * lock, no write, no hc call, no network). Exit 127 with no usagemeter there; else the meter's own exit.
 */
export const COVERAGE = `m=\${1:-$HOME/.local/bin/usagemeter}
[ -x "$m" ] || exit 127
exec "$m" coverage --window ${FLEET_WINDOW} --json`;

/**
 * The linked machines a run syncs: the connected ones of `hc machine ls` (the sidebar's list, no
 * temporary ones) when the person agreed to all of them (meterFleet.js meterScope `all`); else only
 * those `owned` names (the record's usagemeter-machines: a `meter install --machine M` put it
 * there), and none at all with `none`.
 */
export const syncTargets = (machines, scope = null, owned = []) => (scope === "none" ? [] : (machines ?? [])
  .filter((m) => m && m.state === "connected" && !m.temporary && typeof m.name === "string" && m.name)
  .filter((m) => scope === "all" || owned.includes(m.name)).map((m) => m.name));

/** The one shared usagemeter path, under the person's home (Herdr's `home()`). */
export const meterBin = (home) => `${home}/.local/bin/usagemeter`;

/** Where the fleet record is written, and the private folder its bytes are first put in. */
export const fleetPath = (appHome) => `${String(appHome).replace(/\/+$/, "")}/${FLEET_FILE}`;
const FLEET_SCRATCH = ".fleet-coverage.tmp";
// `sh -c FLEET_PREPARE sh <dir>`: a 0700 scratch folder beside the install record. The folder
// the record lives in is never made here: no install record, no fleet record (exit 3).
const FLEET_PREPARE = `set -u
umask 077
[ -d "$1" ] && [ ! -L "$1" ] || exit 3
s="$1/${FLEET_SCRATCH}"
if [ -L "$s" ]; then rm -f "$s"; fi
if [ -d "$s" ]; then rm -f "$s/record.json"; rmdir "$s" || exit 4; fi
mkdir "$s" || exit 4`;
// `sh -c FLEET_PLACE sh <dir> <file>`: 0600, then one rename over the last record.
const FLEET_PLACE = `set -u
s="$1/${FLEET_SCRATCH}"
if [ -L "$2" ] || { [ -e "$2" ] && [ ! -f "$2" ]; }; then rm -f "$s/record.json"; rmdir "$s"; exit 5; fi
chmod 600 "$s/record.json" && mv -f "$s/record.json" "$2"; code=$?
rm -f "$s/record.json"; rmdir "$s" 2>/dev/null
exit $code`;

/**
 * Writes the fleet record `text` at fleetPath(appHome), mode 0600, replacing the last one in one
 * rename (the latest only, no history). A mod's file functions take no mode, so the bytes are
 * first created (`writeText(path, text, null)`: create-only) inside a 0700 folder made under
 * umask 077, tightened to 0600 there and only then moved into place. Never follows a link at
 * the record's path, and never makes the folder it lives in. Resolves true when it was written;
 * false, with nothing changed and no scratch left, when not.
 */
export async function writeFleetRecord({ exec, writeText, appHome, text }) {
  const file = fleetPath(appHome);
  const dir = file.slice(0, file.lastIndexOf("/"));
  try {
    if ((await exec("sh", ["-c", FLEET_PREPARE, "sh", dir]))?.code !== 0) return false;
    let wrote = true;
    try { await writeText(`${dir}/${FLEET_SCRATCH}/record.json`, text, null); } catch { wrote = false; }
    // Run either way: it is what removes the scratch folder (with no file there, mv fails).
    const placed = await exec("sh", ["-c", FLEET_PLACE, "sh", dir, file]);
    return wrote && placed?.code === 0;
  } catch { return false; }
}

/**
 * One due `usagemeter sync`: `exec("sh", ["-c", SYNC, "sh", bin])` (Herdr's exec: resolves
 * `{ code, stdout, stderr }`, rejects only when sh itself can't start; no binary: SYNC exits 0), unless
 * this copy's run is still going (`state.busy`) or a run started less than METER_EVERY_MS ago
 * (`get(METER_KEY)`, from any copy). The start is stored with `set(METER_KEY, now())` before the
 * run, so a second caller in the meantime finds it fresh. No timeout of its own: Herdr's exec
 * gives a program at most 30 s, and usagemeter ends itself within its 20-second budget; a copy
 * never starts a second run while one it started is still going.
 * `machines`: the connected linked machines to sync after this computer, one at a time, within the
 * same run (`exec("sh", ["-c", SYNC], { on })`; a rejection or a failure there is silent), each
 * within METER_EXEC_LIMIT_MS when `sleep` (the caller's timer) is given.
 * `fleet` (RFC 0026 (e); null: no coverage is asked and no record written): `{ write(text),
 * disconnected, outOfScope }`. After each machine's sync, this computer's first, its COVERAGE is
 * run, inside that machine's one METER_EXEC_LIMIT_MS (a machine whose sync used it up is not
 * asked: `timeout`); whatever its sync did, a machine that syncs badly still answers for what its
 * store holds. Then the record (meterFleet.js fleetRecord) goes to `write`, which resolves
 * whether it was written; a machine that did not answer is in its `missing`, never counted as 0.
 * Resolves `{ started, why?, code?, on?, coverage?, wait }`: `started` says sh started here (whether a binary
 * was there to sync is not known: SYNC exits 0 without one), `code` its exit; why "busy", "fresh" or
 * "no-shell" (sh could not start) when it did not; wait is when to look again (ms); on: { machine:
 * code, null when it could not run, "timed out" past the limit }; coverage (with `fleet`):
 * { answered, machines, written }.
 */
export async function syncMeter({ exec, now = Date.now, bin, get = () => null, set = () => {}, state = {}, machines = [], sleep = null, fleet = null }) {
  if (state.busy) return { started: false, why: "busy", wait: METER_EVERY_MS };
  const at = now();
  const last = Number(get(METER_KEY));
  const age = at - last;
  if (Number.isFinite(last) && last > 0 && age >= 0 && age < METER_EVERY_MS) return { started: false, why: "fresh", wait: METER_EVERY_MS - age };
  state.busy = true;
  try { set(METER_KEY, at); } catch {}
  try {
    const answers = [];
    // One machine's coverage, within what is left of its limit (`limit`: its one timer, or null).
    const cover = async (machine, limit, timedOut) => {
      // A name the record cannot hold (MACHINE_NAME) is in none of its lists (fleetPlan's rule).
      if (!fleet || (machine && !MACHINE_NAME.test(machine))) return;
      const who = { machine: machine ?? FLEET_HERE, here: !machine };
      if (timedOut) { answers.push({ ...who, reason: "timeout" }); return; }
      try {
        const run = machine ? exec("sh", ["-c", COVERAGE], { on: machine }) : exec("sh", ["-c", COVERAGE, "sh", bin]);
        const r = await (limit ? Promise.race([run, limit]) : run);
        if (r === TIMED_OUT) answers.push({ ...who, reason: "timeout" });
        else if (r?.code !== 0) answers.push({ ...who, ...exitReason(r?.code) });
        else answers.push({ ...who, ...coverageEntry(who.machine, r.stdout, { here: who.here }) });
      } catch (e) {
        // Herdr ends a program at its own 30 s by rejecting: that one is a timeout too.
        answers.push({ ...who, reason: /tim(e|ed)[ -]?out|time limit/i.test(String(e?.message ?? e)) ? "timeout" : "unreachable" });
      }
    };
    const limitOf = () => (sleep ? sleep(METER_EXEC_LIMIT_MS).then(() => TIMED_OUT) : null);
    let here;
    const hereLimit = fleet ? limitOf() : null;
    try {
      const result = await exec("sh", ["-c", SYNC, "sh", bin]);
      here = { started: true, code: result?.code ?? null, wait: METER_EVERY_MS };
    } catch {
      here = { started: false, why: "no-shell", wait: METER_EVERY_MS };
    }
    await cover(null, hereLimit, false);
    const on = {};
    for (const machine of machines) {
      const limit = limitOf();
      let timedOut = false;
      try {
        const run = exec("sh", ["-c", SYNC], { on: machine });
        const r = await (limit ? Promise.race([run, limit]) : run);
        timedOut = r === TIMED_OUT;
        on[machine] = timedOut ? "timed out" : r?.code ?? null;
      } catch { on[machine] = null; }
      await cover(machine, limit, timedOut);
    }
    const out = machines.length ? { ...here, on } : here;
    if (!fleet) return out;
    const record = fleetRecord({ generatedAt: new Date(now()).toISOString(), answers, disconnected: fleet.disconnected ?? [], outOfScope: fleet.outOfScope ?? [] });
    let written = false;
    try { written = (await fleet.write(`${JSON.stringify(record)}\n`)) === true; } catch {}
    return { ...out, coverage: { answered: record.machines.length, machines: record.machines.length + record.missing.length, written } };
  } finally {
    state.busy = false;
  }
}
