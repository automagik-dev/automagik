// A stand-in `agy` for tests (#793): `models` prints the fixture table captured from agy
// 1.5.3, `--help` its fixture help and `--version` 1.5.3. Every call is appended to
// `$AGY_FAKE_LOG`, a line each, so a test can prove the pack refreshed at most once. Tests
// never run the real CLI. Plain Node, like the other fakes.
import { appendFileSync, readFileSync } from "node:fs";

const fixture = (name) => readFileSync(new URL(`./fixtures/agy/${name}`, import.meta.url), "utf8");
const args = process.argv.slice(2);
if (process.env.AGY_FAKE_LOG) appendFileSync(process.env.AGY_FAKE_LOG, `${args.join(" ")}\n`);
if (args[0] === "models") process.stdout.write(fixture("models-1.5.3.txt"));
else if (args[0] === "--help" || args[0] === "-h") process.stdout.write(fixture("help-1.5.3.txt"));
else if (args[0] === "--version") process.stdout.write("1.5.3\n");
else process.exit(args.length ? 1 : 0);
