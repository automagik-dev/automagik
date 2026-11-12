export * from "./am-markdown-herdr.mjs";
import { state, ui } from "./am-markdown-herdr.mjs";

export const settings = () => ({ zoom: 1 });
export const terminals = () => { ui.terminalReads += 1; return state.terminals; };
