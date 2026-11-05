// Preloaded by test-guard.mjs into the runner and, through its --import, every test file's process
// (#422): stdout on a pipe is asynchronous on POSIX, so process.exit() under --test-force-exit drops
// the writes still queued, and with them the file's last results. A blocking handle has none queued.
// Worker threads and file or terminal stdout have nothing to change. Apache-2.0.
process.stdout._handle?.setBlocking?.(true);
