// form-herdr-stub.mjs plus what the sidebar itself (main.js) also imports, so a test can draw
// the whole sidebar: agents() and machines() rows set by the test (state.agentRows,
// state.machineRows), the agent order it hands Herdr (state.agentOrder), and a window in front.
export * from "./form-herdr-stub.mjs";
import { state } from "./herdr-stub.mjs";

export const agents = () => state.agentRows ?? [];
export const machines = () => state.machineRows ?? [];
export const setAgentOrder = (order) => { state.agentOrder = order; return null; };
export const window = () => ({ active: true });
export const props = () => null;
export const nextCommand = () => new Promise(() => {});
