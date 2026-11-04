// The folder rule for an agent's transcript on this computer (RFC 0015 "Finding a terminal's
// transcript", the folder rule; RFC 0014 "The chat projection" 2). A transcript path from a
// hook payload is used only when it is inside the agent's own transcript folder under the
// home: Claude's .claude/projects, Codex's .codex/sessions, omp's .omp/agent/sessions. The
// text is checked first (absolute, no `.`, `..` or empty segment, no control character, a
// .jsonl name, no backslash), then the file and the folder are resolved with realpath: a symlink
// out of the folder is refused, a folder that is itself a link (a dotfiles ~/.claude) is
// followed, the real path must be a regular .jsonl file too, and a file not written yet is
// refused. CLAUDE_CONFIG_DIR, CODEX_HOME and omp's XDG folder are not
// followed. Its local cases are the shared vectors in test/fixtures/transcript-folder-rule.json
// (RFC 0015 delivery 1's chat/ rule reads the same file). Not loaded by Herdr (node: imports);
// the briefing hook and the tests share it. Apache-2.0.
import { realpathSync, statSync } from "node:fs";

/** Each agent's transcript folder, relative to the home. */
export const TRANSCRIPT_FOLDERS = Object.freeze({
  claude: ".claude/projects",
  codex: ".codex/sessions",
  omp: ".omp/agent/sessions",
});

const MAX_PATH = 4096;

/** Whether `path` passes the textual half of the rule: absolute, clean segments, .jsonl. */
export function transcriptShape(path) {
  if (typeof path !== "string" || !path.startsWith("/") || path.length > MAX_PATH) return false;
  if (/[\u0000-\u001f\u007f\\]/.test(path) || !path.endsWith(".jsonl")) return false;
  return path.slice(1).split("/").every((s) => s !== "" && s !== "." && s !== "..");
}

/**
 * The real path of `path` when it is a transcript of `agent` (claude, codex or omp) strictly
 * inside that agent's folder under `home` (an absolute path; the caller passes the home, this
 * reads no environment), else null. Never throws.
 */
export function transcriptRealPath(path, agent, home) {
  try {
    if (!Object.hasOwn(TRANSCRIPT_FOLDERS, agent) || !transcriptShape(path)) return null;
    if (typeof home !== "string" || !home.startsWith("/")) return null;
    const root = realpathSync(`${home.replace(/\/+$/, "")}/${TRANSCRIPT_FOLDERS[agent]}`);
    const real = realpathSync(path);
    if (!real.startsWith(`${root.replace(/\/+$/, "")}/`) || !real.endsWith(".jsonl")) return null;
    return statSync(real).isFile() ? real : null;
  } catch { return null; }
}
