/**
 * The ledger test-guard.mjs reads (#422): Node's TAP, without the tests' own output, so a test that
 * prints `1..99` cannot pass for the plan, plus what TAP does not carry. The runner replays each
 * test file's events but drops that file's plan, so a file is only known complete by its
 * `test:summary`, which reaches here from every file that got to the end:
 *
 *   # test-guard file <path>        the file the next results came from
 *   # test-guard files <json>       after the plan: each file, its enqueued and finished top-level
 *                                   tests, and whether its summary arrived
 *
 * A file with no tests sends no summary either, so it counts as truncated: from here it cannot be
 * told from a file that quit before its first result. Apache-2.0.
 */
import { relative, resolve } from "node:path";
import { tap } from "node:test/reporters";

export default async function* testGuardReporter(source) {
  const files = new Map();

  async function* watched() {
    let last;
    for await (const event of source) {
      const { type, data } = event;
      if (type === "test:stdout" || type === "test:stderr") continue;
      if (type === "test:summary") {
        const file = files.get(data.file);
        if (file) file.done = true;
      } else if ((type === "test:enqueue" || type === "test:pass" || type === "test:fail") && data.nesting === 0 && data.file) {
        // The runner's own entry for a test file is named after the file.
        const own = resolve(data.name) === data.file;
        if (own && type === "test:enqueue") files.set(data.file, { name: relative(process.cwd(), data.file), expected: 0, saw: 0, done: false });
        if (!own && files.has(data.file)) files.get(data.file)[type === "test:enqueue" ? "expected" : "saw"] += 1;
        if (type !== "test:enqueue" && data.file !== last) {
          last = data.file;
          yield { type: "test:diagnostic", data: { nesting: 0, message: `test-guard file ${relative(process.cwd(), data.file)}` } };
        }
      }
      yield event;
    }
  }

  yield* tap(watched());
  yield `# test-guard files ${JSON.stringify([...files.values()])}\n`;
}
