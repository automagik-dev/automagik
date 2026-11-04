// The `herdr` surface am-quota's panel imports, all in memory: files are a Map (nothing on disk is
// read or written), `exec` only records its calls and answers from `state.exec` (nothing is
// spawned), and the platform is Linux, so the panel never asks for a Keychain item at all.
export const state = {
  appHome: "/stub-app",
  home: "/stub-home",
  platform: "linux",
  files: new Map(),
  calls: [],
  exec: () => ({ code: 0, stdout: "", stderr: "" }),
};

export const appHome = () => state.appHome;
export const home = () => state.home;
export const window = () => ({ platform: state.platform });
// Each theme token reads as its own name, so a test can say which colour a line was drawn in.
export const theme = () => new Proxy({}, { get: (_t, k) => (typeof k === "string" ? `t.${k}` : undefined) });
export async function readTextFile(path) {
  return state.files.has(path) ? state.files.get(path) : null;
}
export async function writeTextFile(path, text, expected) {
  const now = state.files.has(path) ? state.files.get(path) : null;
  if ((expected ?? null) !== now) throw new Error(`stale write to ${path}`);
  state.files.set(path, text);
}
export async function exec(command, args = []) {
  state.calls.push([command, ...args]);
  return state.exec(command, args);
}
