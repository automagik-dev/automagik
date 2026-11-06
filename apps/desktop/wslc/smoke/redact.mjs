// The smoke's log hygiene. The launcher's stderr carries DSH's output, including its `dsh web:`
// launch line, whose URL's token signs a browser in; the smoke forwards that stderr to a public
// CI log, so the token is masked before it is written.
//
// `maskSecrets` is pure and masks the shapes the launcher can print: a credential query or JSON
// field (`token=…`, `"token": "…"`, `api_key=…`, …), a `Bearer`/`Basic` authorization header,
// and the CDP tunnel's `/devtools/browser/<token>` path. Only the value becomes `[redacted]`;
// the key, the separator and the rest of the line stay.
//
// A pipe's reads land on any byte, so a token can be split across chunks: masking each chunk at
// the write site would miss it. `createLineMasker` holds the one partial line a chunk can leave
// and masks whole lines, so the token is always whole when it is masked. Complete lines are
// written as they arrive; the last one is written by `flush` when the stream ends.
import { StringDecoder } from 'node:string_decoder'

const KEY = '(?:access[_-]?token|refresh[_-]?token|id[_-]?token|token|api[_-]?key|apikey|client[_-]?secret|secret|password|passwd)'
// The key's end is boundary-anchored (so `tokens:`/`tokenizer` stay text), its start is not: a
// key can be the suffix of a longer word (`csrf_token=`), and a report cut can put text right
// against it. Masking reads whole sources, so the key is always whole when it is matched.
const PAIR = new RegExp(`(${KEY}\\b)(["']?\\s*[=:]\\s*)(["']?)([^\\s&"'#,;}\\)\\]]+)\\3`, 'gi')
const AUTH = /(\bauthorization\b["']?\s*[:=]\s*["']?(?:bearer|basic)\s+)([^\s"',;}\]]+)/gi
const CDP = /(\/devtools\/browser\/)([^/\s"'?#)]+)/gi

/** `text` with every secret value replaced by `[redacted]`, everything else unchanged. */
export function maskSecrets(text) {
  return String(text)
    .replace(PAIR, (_match, key, separator, quote) => `${key}${separator}${quote}[redacted]${quote}`)
    .replace(AUTH, (_match, prefix) => `${prefix}[redacted]`)
    .replace(CDP, (_match, prefix) => `${prefix}[redacted]`)
}

/**
 * A stderr forwarder that prefixes each complete line with `prefix` and masks it. `push` takes a
 * chunk and answers the lines it completed; `flush` answers the last, unterminated line.
 */
export function createLineMasker(prefix) {
  const decoder = new StringDecoder('utf8')
  let pending = ''
  const line = text => `${prefix}${maskSecrets(text)}\n`
  return {
    push(chunk) {
      const lines = (pending + decoder.write(chunk)).split('\n')
      pending = lines.pop()
      return lines.map(line).join('')
    },
    flush() {
      pending += decoder.end()
      if (pending === '') return ''
      const last = pending
      pending = ''
      return line(last)
    },
  }
}
