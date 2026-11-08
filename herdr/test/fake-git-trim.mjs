// A `git` whose stdout is trimmed, as a Herdr exec answers the sidebar (#626, #665): the rule
// must read the state from porcelain v2's explicit field, never from a leading space. Runs the
// real git named by REAL_GIT and passes its exit status through. Tests that need it put a
// wrapper named `git` first on the CLI's PATH (cli.test.mjs scene, trimsGit).
import { spawnSync } from "node:child_process";

const real = process.env.REAL_GIT;
const r = spawnSync(real, process.argv.slice(2), { stdio: ["inherit", "pipe", "inherit"] });
if (r.error) {
  process.stderr.write(`fake-git-trim: ${real}: ${r.error.message}\n`);
  process.exit(127);
}
process.stdout.write(String(r.stdout ?? "").trim());
process.exit(typeof r.status === "number" ? r.status : 1);
