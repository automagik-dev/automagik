// The program a terminal runs, by its argv: the first word, or what a
// `sh -c '"$@"; …' sh <cmd> …` wrapper runs. A leading `env [-i] [-u NAME…] NAME=value …`
// is looked through to the program it execs (a Claude launch's `-u CLAUDE_CONFIG_DIR`, #453);
// any other env option is not, and leaves the program as "env".
const word = (s) => (typeof s === "string" ? s.split("/").pop() : null);
const ASSIGN = /^[A-Za-z_][A-Za-z0-9_]*=/;

/** Where `env`'s options end in `rest` (from 1): past -i and each unset; its own index otherwise. */
function pastOptions(rest) {
  let i = 1;
  for (;;) {
    const w = rest[i];
    if (w === "-u" || w === "--unset") i += 2;
    else if (w === "-i" || w === "-" || w === "--ignore-environment" || /^(-u.|--unset=)/.test(w ?? "")) i += 1;
    else return i;
  }
}

export function command(argv) {
  if (!argv?.length) return null;
  let rest = argv;
  if (["sh", "bash", "zsh", "dash"].includes(word(argv[0])) && argv[1] === "-c" && /^\s*"\$@"/.test(argv[2] ?? "")) rest = argv.slice(4);
  if (word(rest[0]) === "env") {
    let i = pastOptions(rest);
    while (i < rest.length && ASSIGN.test(rest[i])) i++;
    if (i < rest.length && !rest[i].startsWith("-")) return word(rest[i]);
  }
  return word(rest[0]);
}
