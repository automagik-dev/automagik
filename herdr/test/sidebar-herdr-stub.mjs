// form-herdr-stub.mjs plus what the sidebar itself (main.js) also imports, so a test can draw
// the whole sidebar: agents() and machines() rows set by the test (state.agentRows,
// state.machineRows), the agent order it hands Herdr (state.agentOrder), and a window in front.
// Each snapshot key's reads are counted in state.reads (each read copies the key in Herdr).
export * from "./form-herdr-stub.mjs";
import { state } from "./herdr-stub.mjs";

state.reads = {};
const counted = (key, read) => () => { state.reads[key] = (state.reads[key] ?? 0) + 1; return read(); };
export const spaces = counted("spaces", () => state.spaces);
export const panes = counted("panes", () => state.panes ?? []);
export const terminals = counted("terminals", () => state.terminals);
export const focused = counted("focused", () => state.focused);
export const agents = counted("agents", () => state.agentRows ?? []);
export const machines = counted("machines", () => state.machineRows ?? []);
export const setAgentOrder = (order) => { state.agentOrder = order; return null; };
export const window = () => ({ active: true });
export const props = () => null;
export const nextCommand = () => new Promise(() => {});
