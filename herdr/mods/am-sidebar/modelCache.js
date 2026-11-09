// The pack's cache of the models `agy models` lists for Antigravity (#793), and the one refresh
// that fills it. agy keeps no model list of its own to read (its cache folder holds
// conversations and onboarding, and `agy models` starts its language server and asks the
// service), so the pack keeps the last answer in its app home: the form and the CLI then read
// one small local file per render or pin check, never a network call. Callers refresh at most
// once a session, and a refresh that fails (agy isn't installed, isn't signed in, or printed no
// table) keeps the last list even when it is old. Pure: no `fs` or `child_process`; the caller
// injects `read`, `write` and `exec`. Apache-2.0.

/** Where the cache lives under an app home; the folder holds the pack's ledgers too. */
export const AG_MODELS_FILE = "automagik-herdr/antigravity-models.json";
/** A cache younger than this is used as it is: one `agy models` a day at most, and never per render. */
export const AG_MODELS_TTL_MS = 24 * 60 * 60 * 1000;
/** How long one `agy models` may take before the refresh is given up on (it starts a server). */
export const AG_MODELS_TIMEOUT_MS = 30_000;
// A list longer than this is not `agy models` (a corrupted file or a noisy program): refused.
const MAX_MODELS = 200;
// A model id the cache may keep: one word, never an option (it goes to --model).
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;

/** `~`-free path of the cache under `appHome` (a trailing slash is not doubled). */
export const agModelsPath = (appHome) => `${String(appHome).replace(/\/+$/, "")}/${AG_MODELS_FILE}`;

const oneLine = (text) => String(text ?? "").trim().split("\n").filter(Boolean).pop() ?? "";

/**
 * The models in `agy models`' stdout: one `id<TAB>label` line each (a run of spaces between the
 * two reads the same; a line with no separator, or an id that isn't one word, is skipped).
 * Duplicates keep the first; at most MAX_MODELS.
 */
export function parseAgModelsOutput(text) {
  const out = [];
  for (const line of String(text ?? "").split(/\r?\n/)) {
    const m = /^(\S+)(?:\t+| {2,})(.+?)\s*$/.exec(line);
    if (!m) continue;
    const id = m[1];
    if (!MODEL_ID.test(id) || out.some((x) => x.id === id)) continue;
    out.push({ id, label: m[2].trim() });
    if (out.length >= MAX_MODELS) break;
  }
  return out;
}

/** The cache text for `models` listed at `at` (a Date.now() number or an ISO string). */
export function agModelsCacheText(models, at = Date.now()) {
  const when = typeof at === "string" ? at : new Date(at).toISOString();
  const kept = (Array.isArray(models) ? models : []).filter((m) => typeof m?.id === "string" && MODEL_ID.test(m.id))
    .slice(0, MAX_MODELS).map((m) => ({ id: m.id, label: typeof m.label === "string" ? m.label : "" }));
  return `${JSON.stringify({ version: 1, source: "agy models", at: when, models: kept }, null, 2)}\n`;
}

/**
 * A cache text as { at, models: [{ id, label }] }, or null when it isn't the pack's cache (not
 * JSON, no models, a model id that isn't one word). An older file with bare strings still reads.
 */
export function parseAgModelsCache(text) {
  let data = null;
  try { data = typeof text === "string" && text ? JSON.parse(text) : null; } catch { return null; }
  if (!data || typeof data !== "object" || !Array.isArray(data.models)) return null;
  const models = [];
  for (const m of data.models) {
    const id = typeof m === "string" ? m : m?.id;
    if (typeof id !== "string" || !MODEL_ID.test(id) || models.some((x) => x.id === id)) continue;
    models.push({ id, label: typeof m?.label === "string" ? m.label : "" });
    if (models.length >= MAX_MODELS) break;
  }
  if (!models.length) return null;
  const at = typeof data.at === "string" && Number.isFinite(Date.parse(data.at)) ? data.at : null;
  return { at, models };
}

/** True when `cache` (parseAgModelsCache) was written less than AG_MODELS_TTL_MS before `now`. */
export function agModelsFresh(cache, now = Date.now()) {
  const at = Date.parse(cache?.at ?? "");
  return Number.isFinite(at) && now - at < AG_MODELS_TTL_MS;
}

const cached = (text) => parseAgModelsCache(text);

// What a failed refresh says for a person: one line, no stack, no home path of agy's own log.
const failure = (e) => `agy models couldn't run (${oneLine(e?.message ?? e) || "no answer"})`;
const refused = (r) => `agy models failed (${oneLine(r?.stderr || r?.stdout) || `exit ${r?.code ?? "?"}`})`;

/**
 * The cache under `appHome`, refreshed by running `agy models` when it is missing or older than
 * AG_MODELS_TTL_MS. `read(path)`/`write(path, text)` may be sync or async; `exec(command, args,
 * options)` must resolve `{ code, stdout, stderr }` (an `ENOENT` for a missing agy rejects).
 * Resolves { text (the cache text, the new one when written), cache, refreshed, why (the
 * fallback reason, else null) }. A failed refresh never throws and never drops a list already
 * cached; when agy is missing and nothing is cached, `text` stays null and `why` says so.
 */
export async function refreshAgModels({ appHome, read, write, exec, now = Date.now() }) {
  const path = agModelsPath(appHome);
  let text = null;
  try { text = await read(path); } catch { text = null; }
  const before = cached(text);
  if (before && agModelsFresh(before, now)) return { text, cache: before, refreshed: false, why: null };
  if (typeof exec !== "function") return { text, cache: before, refreshed: false, why: before ? "agy models was not run: the last list is kept" : null };
  let r;
  try { r = await exec("agy", ["models"], { timeout: AG_MODELS_TIMEOUT_MS }); } catch (e) {
    return { text, cache: before, refreshed: false, why: failure(e) };
  }
  if (r?.code !== 0) return { text, cache: before, refreshed: false, why: refused(r) };
  const models = parseAgModelsOutput(r?.stdout);
  if (!models.length) return { text, cache: before, refreshed: false, why: "agy models listed no models" };
  const next = agModelsCacheText(models, now);
  try { await write(path, next); } catch { return { text, cache: before, refreshed: false, why: "the model cache couldn't be written" }; }
  return { text: next, cache: cached(next), refreshed: true, why: null };
}

/**
 * refreshAgModels over synchronous `read`/`write`/`exec` (the CLI, whose pin checks are sync).
 * Same contract; `exec` returns `{ code, stdout, stderr }` and may throw for a missing agy.
 */
export function refreshAgModelsSync({ appHome, read, write, exec, now = Date.now() }) {
  const path = agModelsPath(appHome);
  let text = null;
  try { text = read(path); } catch { text = null; }
  const before = cached(text);
  if (before && agModelsFresh(before, now)) return { text, cache: before, refreshed: false, why: null };
  if (typeof exec !== "function") return { text, cache: before, refreshed: false, why: before ? "agy models was not run: the last list is kept" : null };
  let r;
  try { r = exec("agy", ["models"], { timeout: AG_MODELS_TIMEOUT_MS }); } catch (e) {
    return { text, cache: before, refreshed: false, why: failure(e) };
  }
  if (r?.code !== 0) return { text, cache: before, refreshed: false, why: refused(r) };
  const models = parseAgModelsOutput(r?.stdout);
  if (!models.length) return { text, cache: before, refreshed: false, why: "agy models listed no models" };
  const next = agModelsCacheText(models, now);
  try { write(path, next); } catch { return { text, cache: before, refreshed: false, why: "the model cache couldn't be written" }; }
  return { text: next, cache: cached(next), refreshed: true, why: null };
}
