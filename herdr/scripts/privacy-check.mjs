#!/usr/bin/env node
// Keeps personal data out of this public repository: absolute home paths, the owner's private
// host, machine and account names, personal email addresses, credentials and local database
// files, in text files and in image metadata (PNG text chunks, readable strings elsewhere).
//
//   node scripts/privacy-check.mjs              scan every tracked and untracked, not-ignored file
//                                               of the repository whose git top level holds this script
//   node scripts/privacy-check.mjs --hash TERM  print a deny entry for TERM (add it to the list)
//
// Prints `file:line: rule: match` per hit and exits 1 when there is any.
//
// The scan root is the repository's git top level (`git rev-parse --show-toplevel`, run in this
// script's folder), not the folder holding the script: the pack's copy, at `scripts/` of the
// pack, scans the pack; this monorepo's copy, at `herdr/scripts/`, scans the monorepo. The list
// is the one beside this script, and its path inside the root is computed from the root, so its
// own allowed text stays exempt in both layouts.
//
// The private names are never written in the tree: scripts/privacy-list.json keeps each one as
// the sha256 of its normal form (lowercased, separators — space, tab, `.`, `-`, `_`, `=` —
// removed). Each word of a line, and each run of up to four words joined by separators, is
// normalised the same way and hashed, so `a-b`, `a_b`, `a b`, `a.b`, `AB` and `A - B` all match
// an entry made from any of them. An entry may be `exact` (one word as written, never one
// joined from several: `a b` does not match it) and `lowercaseOnly` (`A` does not match it),
// for short names that are also ordinary words or labels. Where hits overlap, the longest wins.
//
// The hashes keep the names out of grep and out of this file; they do not keep them secret.
// The list is short and the names are short, so anyone can recover them by hashing guesses.
//
// The same file lists what is not personal data: placeholder user names (`users`), placeholder
// emails (`emails`), and exact text allowed in one named file (`lines`, whose `file` is relative
// to the scan root); only that text is cut out of the line, the rest of the line is still
// scanned. The list holds one entry per file and text: a text is cut from every line of its
// file, so a repeat would change nothing and is refused. A text that ends in a home path's user
// name (a home path for the user `ana`) is cut only where the name ends there too: a longer one
// in the same file (the same path for `anabel`) is not cut and is still a hit, so an entry never
// hides the front of another path. Folders still holding hits wait in `pending`, one entry per folder with the issue
// that will clean it (a whole top-level folder, or one part of `apps/` for its own squad); they
// are skipped until then, and the list only shrinks (test/privacy-check.test.mjs holds the
// folders it may still name, so adding one fails there).
//
// A pending folder is a path from the scan root and is never re-based. In the pack's standalone
// layout the root is the pack, so the monorepo's entries (`apps/...`) name folders the pack does
// not have and skip nothing there: an entry skips a folder only where the scan root has it at
// that same path.
//
// The list is checked before it is used (checkList): every key has its type, and a key the
// checker does not know is refused, so a misspelt `pending` or `why` cannot pass in silence.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { dirname, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";

/** The list beside this script: one list, for the pack and for the monorepo. */
export const LIST_PATH = fileURLToPath(new URL("privacy-list.json", import.meta.url));
/** The list's path when the pack itself is the repository (standalone use). */
export const LIST_FILE = "scripts/privacy-list.json";

const HOME = /(?:\/Users\/|\/home\/|[A-Za-z]:\\Users\\)([A-Za-z0-9._-]+)/g;
const EMAIL = /\b[A-Za-z0-9._%+-]+@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,})\b/g;
const EMAIL_OK = /(?:^|\.)(?:example(?:\.(?:com|org|net))?|test|invalid|localhost|users\.noreply\.github\.com)$/i;
const SECRETS = [
  /\bgh[pousr]_[A-Za-z0-9]{30,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{40,}/g,
  /\bsk-(?:ant-)?[A-Za-z0-9_-]{32,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/g,
];
const DB_FILE = /(?:^|\/)(?:genie\.db|[^/]+\.(?:db|sqlite|sqlite3|db-wal|db-shm))$/i;
const SEPARATORS = /[ \t._=-]+/g;
const RUNS = /[A-Za-z0-9]+(?:[ \t._=-]+[A-Za-z0-9]+)*/g;
const MAX_PARTS = 4;

/** A term's normal form: lowercased, separators removed. */
export const normalise = (term) => term.toLowerCase().replace(SEPARATORS, "");

/** The deny-list hash of a term: sha256 of its normal form, hex. */
export const hashTerm = (term) => createHash("sha256").update(normalise(term)).digest("hex");

/** Every word and joined run of up to MAX_PARTS words in a line: `{ text, index, single }`. */
function candidates(line) {
  const out = [];
  for (const m of line.matchAll(RUNS)) {
    const words = [...m[0].matchAll(/[A-Za-z0-9]+/g)];
    for (let i = 0; i < words.length; i++) {
      for (let j = i; j < Math.min(words.length, i + MAX_PARTS); j++) {
        const start = words[i].index, end = words[j].index + words[j][0].length;
        out.push({ text: m[0].slice(start, end), index: m.index + start, single: i === j });
      }
    }
  }
  return out;
}

/**
 * A matcher over deny entries `{ sha256, exact?, lowercaseOnly? }` for one candidate:
 * true when its normal form hashes to an entry whose flags it meets. Hashes are memoized.
 */
export function denyMatcher(deny = []) {
  const entries = new Map(deny.map((d) => [d.sha256, d]));
  const memo = new Map();
  return ({ text, single = true }) => {
    const key = normalise(text);
    let sha = memo.get(key);
    if (sha === undefined) memo.set(key, (sha = hashTerm(key)));
    const entry = entries.get(sha);
    if (!entry) return false;
    if (entry.exact && !single) return false;
    return !entry.lowercaseOnly || text === text.toLowerCase();
  };
}

/** The denied candidates of a line, longest first where they overlap, in line order. */
function deniedNames(line, denied) {
  const kept = [];
  const found = candidates(line).filter(denied).sort((a, b) => b.text.length - a.text.length);
  for (const c of found) {
    const end = c.index + c.text.length;
    if (!kept.some((k) => c.index < k.index + k.text.length && k.index < end)) kept.push(c);
  }
  return kept.sort((a, b) => a.index - b.index);
}

/** A character a home path's user name may hold (HOME's own class). */
const NAME_CHAR = /[A-Za-z0-9._-]/;
/** Whether an allowed text ends in a home path's user name, which a longer name could extend. */
const endsInHomeName = (text) => [...text.matchAll(HOME)].some((m) => m.index + m[0].length === text.length);

/**
 * `line` with every allowed span cut out (replaced by a space, so words do not join). A span
 * that ends in a home path's user name is cut only where that name ends: followed by a name
 * character, it is the front of a longer path, which stays in the line and is still scanned.
 */
function cutAllowed(line, spans) {
  for (const s of spans) {
    if (!s) continue;
    if (!endsInHomeName(s)) { line = line.split(s).join(" "); continue; }
    let out = "";
    let from = 0;
    for (let at = line.indexOf(s); at !== -1; at = line.indexOf(s, from)) {
      const end = at + s.length;
      const longer = end < line.length && NAME_CHAR.test(line[end]);
      out += line.slice(from, at) + (longer ? s : " ");
      from = end;
    }
    line = out + line.slice(from);
  }
  return line;
}

/** The hits in one file's text: `{ file, line, rule, match }`. Pure. `listFile` is the list's
 * own path from the scan root: its lines name allowed text that may appear in the list itself. */
export function scan(file, text, list = {}, denied = denyMatcher(list.deny), listFile = LIST_FILE) {
  const hits = [];
  const users = new Set(list.users ?? []);
  const emails = new Set(list.emails ?? []);
  // An allowed text is allowed in the file it names, and in the list that names it.
  const spans = (list.lines ?? []).filter((l) => l.file === file || file === listFile).map((l) => l.text);
  if (DB_FILE.test(file)) hits.push({ file, line: 0, rule: "db-file", match: file });
  text.split("\n").forEach((raw, i) => {
    const line = cutAllowed(raw, spans);
    const hit = (rule, match) => hits.push({ file, line: i + 1, rule, match });
    for (const m of line.matchAll(HOME)) if (!users.has(m[1])) hit("home-path", m[0]);
    for (const c of deniedNames(line, denied)) hit("private-name", c.text);
    for (const m of line.matchAll(EMAIL)) if (!EMAIL_OK.test(m[1]) && !emails.has(m[0])) hit("email", m[0]);
    for (const re of SECRETS) for (const m of line.matchAll(re)) hit("secret", `${m[0].slice(0, 8)}…`);
  });
  return hits;
}

/** Printable ASCII runs of 6 or more characters, one per line. */
const strings = (buf) => (buf.toString("latin1").match(/[\x20-\x7e]{6,}/g) ?? []).join("\n");

/**
 * The text a PNG carries outside its pixels: tEXt, zTXt and iTXt (inflated when compressed),
 * and the readable strings of every other ancillary chunk (eXIf, XMP...). Pixel data is skipped.
 */
export function pngText(buf) {
  const out = [];
  for (let o = 8; o + 12 <= buf.length;) {
    const len = buf.readUInt32BE(o), type = buf.toString("latin1", o + 4, o + 8);
    const data = buf.subarray(o + 8, o + 8 + len);
    o += 12 + len;
    if (["IHDR", "PLTE", "IDAT", "IEND"].includes(type)) continue;
    const nul = data.indexOf(0);
    try {
      if (type === "tEXt") out.push(data.toString("latin1").replace("\0", ": "));
      else if (type === "zTXt") out.push(`${data.toString("latin1", 0, nul)}: ${inflateSync(data.subarray(nul + 2)).toString("latin1")}`);
      else if (type === "iTXt") {
        const compressed = data[nul + 1] === 1;
        let p = nul + 3;
        for (let k = 0; k < 2; k++) p = data.indexOf(0, p) + 1;  // language tag, translated keyword
        const body = data.subarray(p);
        out.push(`${data.toString("latin1", 0, nul)}: ${(compressed ? inflateSync(body) : body).toString("utf8")}`);
      } else out.push(strings(data));
    } catch {
      out.push(strings(data));
    }
  }
  return out.join("\n");
}

/** The text to scan in a file: itself, a PNG's metadata, or another binary's readable strings. */
export function fileText(buf) {
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return pngText(buf);
  return buf.includes(0) ? strings(buf) : buf.toString("utf8");
}

/** A resolved path where the filesystem has one, so a symlinked temp folder keeps one identity. */
const canonical = (path) => {
  try { return realpathSync(path); } catch { return path; }
};

/** The repository's top level: the git top level of the folder holding this script. */
export function repoRoot() {
  const out = execFileSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: dirname(fileURLToPath(import.meta.url)),
    encoding: "utf8",
  });
  return canonical(out.trim());
}

/** `path` as git names it from `root`: relative, with forward slashes. */
export function repoPath(root, path = LIST_PATH) {
  return relative(canonical(root), canonical(path)).split(sep).join("/");
}

/** The list's path from the scan root: `herdr/scripts/…` here, `scripts/…` in the pack. */
export const listFileFor = (root) => repoPath(root, LIST_PATH);

const isObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
const isText = (value) => typeof value === "string" && value !== "";
/** The list's keys, and each entry's keys with the type each must have (`required` or not). */
const LIST_SHAPE = {
  deny: {
    sha256: { required: true, ok: (v) => typeof v === "string" && /^[0-9a-f]{64}$/.test(v), is: "a sha256 in lowercase hex" },
    kind: { required: true, ok: isText, is: "a non-empty string" },
    exact: { required: false, ok: (v) => typeof v === "boolean", is: "true or false" },
    lowercaseOnly: { required: false, ok: (v) => typeof v === "boolean", is: "true or false" },
  },
  users: null,
  emails: null,
  lines: {
    file: { required: true, ok: isText, is: "a non-empty string" },
    text: { required: true, ok: isText, is: "a non-empty string" },
    why: { required: true, ok: isText, is: "a non-empty string" },
  },
  pending: {
    folder: { required: true, ok: isText, is: "a non-empty string" },
    issue: { required: true, ok: isText, is: "a non-empty string" },
  },
};

/**
 * Checks a list's shape and returns it: an object whose keys are `deny`, `users`, `emails`,
 * `lines` and `pending` (each optional, each an array), with every entry's keys known and of
 * their type, and no `lines` entry repeating another's file and text. Throws one
 * `privacy-list: ...` line naming the key and the entry's index, never an entry's text.
 * pendingFolders checks what a pending folder and issue may be.
 */
export function checkList(list) {
  const fail = (what) => { throw new Error(`privacy-list: ${what}`); };
  if (!isObject(list)) fail("the list must be an object");
  for (const key of Object.keys(list)) {
    if (!Object.hasOwn(LIST_SHAPE, key)) fail(`unknown key "${key}" (known: ${Object.keys(LIST_SHAPE).join(", ")})`);
    const entries = list[key];
    if (!Array.isArray(entries)) fail(`${key} must be an array`);
    const shape = LIST_SHAPE[key];
    entries.forEach((entry, i) => {
      const at = `${key}[${i}]`;
      if (shape === null) {
        if (!isText(entry)) fail(`${at} must be a non-empty string`);
        return;
      }
      if (!isObject(entry)) fail(`${at} must be an object`);
      for (const name of Object.keys(entry)) {
        if (!Object.hasOwn(shape, name)) fail(`${at} has the unknown key "${name}" (known: ${Object.keys(shape).join(", ")})`);
      }
      for (const [name, { required, ok, is }] of Object.entries(shape)) {
        if (!Object.hasOwn(entry, name)) {
          if (required) fail(`${at} has no ${name}`);
        } else if (!ok(entry[name])) fail(`${at}.${name} must be ${is}`);
      }
    });
  }
  // One entry per file and text: an allowed text is cut from every line of its file already.
  const pairs = new Map();
  (list.lines ?? []).forEach((entry, i) => {
    const pair = JSON.stringify([entry.file, entry.text]);
    if (pairs.has(pair)) fail(`lines[${i}] repeats lines[${pairs.get(pair)}]: one entry per file and text`);
    pairs.set(pair, i);
  });
  return list;
}

/** The list as data, checked (checkList): the one beside the script unless another path is given. */
export function loadList(file = LIST_PATH) {
  return checkList(JSON.parse(readFileSync(file, "utf8")));
}

/** The pending folders of a list, `{ folder, issue }`, one entry per folder. A folder is
 * repo-relative and may be nested when one part belongs to its own squad (`apps/pocket`). */
export function pendingFolders(list = {}) {
  const entries = (list.pending ?? []).map((entry) => {
    const folder = String(entry?.folder ?? "").replace(/\/+$/, "");
    const issue = String(entry?.issue ?? "");
    const segments = folder.split("/");
    if (!folder || folder.startsWith("/") || segments.some((s) => !s || s === "." || s === "..")
      || !/^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/.test(folder) || !/^#\d+$/.test(issue)) {
      throw new Error("privacy-list: each pending entry needs a folder path and an issue (#123)");
    }
    return { folder, issue };
  });
  const folders = new Set();
  for (const { folder } of entries) {
    if (folders.has(folder)) throw new Error(`privacy-list: duplicate pending folder: ${folder}`);
    folders.add(folder);
  }
  return entries;
}

/** Tracked and untracked, not-ignored files of the repository at `root`. */
export function repoFiles(root) {
  const out = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: root });
  return out.toString("utf8").split("\0").filter(Boolean);
}

/** Scan the repository at `root`; files listed by git but gone from disk are skipped, and the
 * list's pending folders are skipped until their issue cleans them. */
export function scanRepo(root, list = loadList()) {
  const denied = denyMatcher(list.deny);
  const listFile = listFileFor(root);
  const pending = pendingFolders(list).map(({ folder }) => `${folder}/`);
  const hits = [];
  for (const file of repoFiles(root)) {
    if (pending.some((prefix) => file.startsWith(prefix))) continue;
    let buf;
    try { buf = readFileSync(`${root}/${file}`); } catch { continue; }
    hits.push(...scan(file, fileText(buf), list, denied, listFile));
  }
  return hits;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [flag, term] = process.argv.slice(2);
  if (flag === "--hash") {
    if (!term) { console.error("usage: privacy-check.mjs --hash TERM"); process.exit(2); }
    // Add `"exact": true` and/or `"lowercaseOnly": true` by hand for a short or common word.
    console.log(JSON.stringify({ sha256: hashTerm(term), kind: "machine" }));
    process.exit(0);
  }
  const root = repoRoot();
  let list, pending;
  try {
    list = loadList();
    pending = pendingFolders(list);
  } catch (error) {
    console.error(String(error?.message ?? error));
    process.exit(2);
  }
  const note = pending.length
    ? `${pending.length} folder(s) pending ${[...new Set(pending.map((p) => p.issue))].join(", ")}:`
      + ` ${pending.map((p) => p.folder).join(", ")}`
    : "";
  const hits = scanRepo(root, list);
  for (const h of hits) console.error(`${h.file}:${h.line}: ${h.rule}: ${h.match}`);
  if (hits.length) {
    console.error(`privacy-check: ${hits.length} hit(s). Replace with a placeholder (~/..., proxy.example.com),`
      + ` or, if it is not personal data, add it to ${listFileFor(root)}.`);
    if (note) console.error(`privacy-check: ${note}`);
    process.exit(1);
  }
  console.log(note ? `privacy-check: clean (${note})` : "privacy-check: clean");
}
