import { RETIRED } from "./retired.js";

// Programs Herdr's agent table still lists but their makers retired (retired.js, a byte-equal copy
// of the pack's one list in am-sidebar).
export { RETIRED };

// The menu's agents from knownAgents(): retired ones dropped first, then the installed ones (what
// ⌘1…9 count over, so the keys stay consecutive) and up to two not-installed suggestions.
export function menuAgents(list) {
  const visible = (list ?? []).filter((a) => !RETIRED.has(a?.key));
  const installed = visible.filter((a) => a.installed);
  return { installed, choices: [...installed, ...visible.filter((a) => !a.installed).slice(0, 2)] };
}
