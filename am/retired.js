// Retired agents: programs Herdr's agent table still lists but their makers retired, each mapped
// to the agent that replaces it. Google ended Gemini CLI for individuals (2026-11-02: "migrate to
// the Antigravity suite"), so `gemini` runs Antigravity. Keyed as knownAgents() keys an agent.
// No picker or menu offers a retired agent; a saved one keeps working (it reads as its
// replacement where the pack resolves it, and shows as "<name> (retired)" in the automations form).
//
// The one list. am-sidebar holds the source; am-automations and am-new-menu carry byte-equal
// copies (each mod must load on its own, so none imports another's folder), and
// test/retired-agents.test.mjs fails when a copy drifts. Edit this file, then copy it to
// mods/am-automations/retired.js and mods/am-new-menu/retired.js. Pure: no imports. Apache-2.0.
export const LEGACY_AGENTS = Object.freeze({ gemini: "antigravity" });

/** The retired keys, LEGACY_AGENTS' own. */
export const RETIRED = new Set(Object.keys(LEGACY_AGENTS));

/** Whether `key` names a retired agent. */
export const isRetired = (key) => typeof key === "string" && Object.hasOwn(LEGACY_AGENTS, key);
