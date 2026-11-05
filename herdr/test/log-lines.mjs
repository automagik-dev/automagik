// The test fakes' shared call logs (HC_FAKE_LOG, HERDR_APP_FAKE_LOG, hc.json.doubles): one line
// per call, appended by every fake process while others read the log (#421). A writer appends a
// whole line in one write() on a file opened O_APPEND, so lines never interleave; a reader that
// lands inside a write can still see its line only in part, and only ever the last one. So a
// reader keeps the lines up to the last newline: the one still being written is seen whole by the
// next read. A torn line anywhere else is a real fixture bug, and JSON.parse still throws on it.
import { closeSync, openSync, readFileSync, writeSync } from "node:fs";

/** The complete lines of a log's text: up to its last newline, empty lines left out. */
export const completeLines = (text) => text.slice(0, text.lastIndexOf("\n") + 1).split("\n").filter(Boolean);

/** A log's complete lines. */
export const readLines = (file) => completeLines(readFileSync(file, "utf8"));

/** A JSON-lines log's complete rows. */
export const readJsonLines = (file) => readLines(file).map((l) => JSON.parse(l));

/** Appends one line in a single write() (O_APPEND: other appends never land inside it). */
export function appendLine(file, line) {
  const bytes = Buffer.from(`${line}\n`);
  const fd = openSync(file, "a");
  try {
    const n = writeSync(fd, bytes);
    if (n !== bytes.length) throw new Error(`${file}: wrote ${n} of ${bytes.length} bytes of one line`);
  } finally {
    closeSync(fd);
  }
}
