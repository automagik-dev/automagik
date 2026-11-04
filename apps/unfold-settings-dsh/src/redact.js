// Secret values never leave this plugin. Everything served passes through `redact`: a value
// under a secret-looking key is replaced, whatever it is, and a string that carries a bearer
// credential, a Google API key, a standalone sk- key or a KEY=value assignment has that part replaced. Hashes and
// ids (artifact_id, *_sha256, boot ids) are not secrets and are kept: no length or hex rule.
export const REDACTED = '[redacted]'

const SECRET_KEY = /(token|secret|passw(or)?d|passphrase|(?:^|[_-])pass$|api[_-]?key|private[_-]?key|authorization|bearer|cookie|credential)/i
// Standalone sk- credentials, with no key,
// assignment or scheme around them. The family: sk-<body>, sk-proj-, sk-svcacct-, sk-admin-,
// sk-ant-api03-, sk-ant-admin01-, sk-ant-oat01- (each sub-prefix is in the body alphabet, so one rule
// covers them all). A START is a lower-case "sk-" not preceded by a letter, digit, "_" or "-" ("risk-",
// "desk-", "task-sk-" are not starts), or preceded by a serialized JSON escape \n \r \t. A KEY is a
// start then 20+ characters of [A-Za-z0-9_-] mixing upper case, lower case AND digits; the whole run
// is replaced. Kept (not credentials to this rule): runs without all three classes ("sk-learn",
// "sk-learn-pipeline-v2"), runs under 20, other families (sk_live_, rk_, ...). There is no length or
// entropy rule anywhere else, so hashes, ids and prose keep. STREAMING: a text that ENDS inside a run
// after a start (1+ body characters) is hidden whole, since the next delta may complete a key. The
// cost: a benign run at the very end of a text ("...uses sk-learn") is hidden until text follows it,
// and in a static string for good.
// Each rule is [pattern, replacement, gate]: a rule with a gate runs only on a text the gate finds
// something in, a literal its pattern cannot match without, so a text skips the rules it cannot meet.
const SECRET_TEXT = [
  // Whole-value priority: a credential key's value is secret as ONE unit, whatever it
  // starts with ("Bearer ", "Basic ", even an already-redacted marker, which is untrusted input),
  // so the key rules run first and no inner pattern can split a value they recognise.
  // A quoted value runs to its UNESCAPED closing quote (JSON: `\"` and `\\` do not end it; a
  // trailing lone `\` is an escape still to come), or to the end while it is still open (a
  // streamed `KEY="…` is hidden until its quote arrives). The `=` is found first and the name
  // looked for behind it, so a long word of names is one pass, with or without a value after it.
  [/\b([A-Z0-9_]+)=(?<=(?:TOKEN|SECRET|PASSWORD|API_KEY|APIKEY)[A-Z0-9_]*=)("(?:[^"\\]|\\[\s\S]|\\$)*(?:"|$)|'(?:[^'\\]|\\[\s\S]|\\$)*(?:'|$)|`(?:[^`\\]|\\[\s\S]|\\$)*(?:`|$)|\S+)/g, (_, name) => `${name}=${REDACTED}`, /=/],
  // A YAML block scalar under a name (`password: |` or `>`, then the lines under it) is hidden
  // whole, its key line kept, text before the name on that line too: YAML_KEY finds its key line
  // and yamlBlockEnd where the block ends. It runs before the name rules, so they leave its `|`
  // or `>` alone.
  [redactYamlBlocks, null, /:[\x00-\x09\x0B\x0C\x0E-\x20\x7F-\xA0\xAD\u061C\u1680\u180E\u2000-\u200F\u2028-\u202F\u205F-\u2064\u3000\uFEFF]*[&!>|]/],
  // `name: value` / `name=value`, in JSON too. A quoted value ("…", '…' or `…`; spaces and escapes
  // included) runs to its unescaped closing quote, or to the end while open. After a name, an
  // authorization scheme in any case (`authorization: bearer x`) keeps its word and hides what
  // follows; a scheme with no name is the case-sensitive rule below, so "basic steps" stays prose.
  // A name is passphrase, password, passwd, pass, secret, secret key, secret access key, token, api
  // key, private key or authorization, in any case, as a whole token with any prefix joined by _ or
  // - (db_password, x-api-key, aws_secret_access_key), also right after a - or -- (--api-key=x):
  // `bypass` and `tokenizer` are words, not names.
  [/(?=[A-Za-z0-9])(?:(?<![A-Za-z0-9_-])|(?<=(?<![A-Za-z0-9_-])-{1,2})|(?<=\\[nrt]))((?:[A-Za-z0-9]+[_-])*(?:passphrase|passw(?:or)?d|pass|secret(?:[_-](?:access[_-])?key)?|token|api[_-]?key|private[_-]?key|authorization))(["']?\s*[:=]\s*)(?:(["'`])(?:(?!\3)[^\\]|\\[\s\S]|\\$)*(\3|$)|(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+|(?![>|][-+0-9]*[ \t]*(?:[\r\n]|$))(?!Bearer\b|Basic\b|\[redacted\])[^\s"',}]+)/gi, (_, name, sep, q, close, scheme) => (q ? `${name}${sep}${q}${REDACTED}${close}` : scheme ? `${name}${sep}${scheme} ${REDACTED}` : `${name}${sep}${REDACTED}`), /[:=]/],
  // The same names in camelCase or PascalCase (accessToken, ClientSecret, dbPassword, DbPass,
  // apiKey, authToken), case sensitive and whole-token, so accessLevel, MaxTokens, passRate and
  // PassengerCount stay words.
  // A name is a key only with its value, so a firstPass in prose stays a word.
  [/(?=[A-Za-z0-9])(?:(?<![A-Za-z0-9_-])|(?<=(?<![A-Za-z0-9_-])-{1,2})|(?<=\\[nrt]))((?:[A-Za-z][a-z0-9]*(?![a-z0-9])(?:[A-Z][a-z0-9]*(?![a-z0-9]))*?(?:Token|Secret(?:(?:Access)?Key)?|Passw(?:or)?d|Passphrase|Pass|ApiKey|PrivateKey|Authorization)|(?:api|private)Key))(["']?\s*[:=]\s*)(?:(["'`])(?:(?!\3)[^\\]|\\[\s\S]|\\$)*(\3|$)|(Bearer|bearer|BEARER|Basic|basic|BASIC)\s+[A-Za-z0-9._~+/=-]+|(?![>|][-+0-9]*[ \t]*(?:[\r\n]|$))(?!(?:Bearer|bearer|BEARER|Basic|basic|BASIC)\b|\[redacted\])[^\s"',}]+)/g, (_, name, sep, q, close, scheme) => (q ? `${name}${sep}${q}${REDACTED}${close}` : scheme ? `${name}${sep}${scheme} ${REDACTED}` : `${name}${sep}${REDACTED}`), /Token|Secret|Pass|Key|Authorization/],
  // JSON inside a JSON string (`{\"password\": \"…\"}`): the value runs to its escaped closing
  // quote, its own escapes doubled, or to a bare quote that ends the outer string.
  [/(?=[A-Za-z0-9])(?:(?<![A-Za-z0-9_-])|(?<=(?<![A-Za-z0-9_-])-{1,2})|(?<=\\[nrt]))((?:[A-Za-z0-9]+[_-])*(?:passphrase|passw(?:or)?d|pass|secret(?:[_-](?:access[_-])?key)?|token|api[_-]?key|private[_-]?key|authorization))(\\"\s*:\s*)\\"((?:[^\\"]|\\[^\\"]|\\\\(?:\\[\s\S]|\\$|[^\\]|$)|\\$)*)(\\"|"|$)/gi, (_, name, sep, value, close) => `${name}${sep}\\"${REDACTED}${close}`, /\\"/],
  [/(?=[A-Za-z0-9])(?:(?<![A-Za-z0-9_-])|(?<=(?<![A-Za-z0-9_-])-{1,2})|(?<=\\[nrt]))((?:[A-Za-z][a-z0-9]*(?![a-z0-9])(?:[A-Z][a-z0-9]*(?![a-z0-9]))*?(?:Token|Secret(?:(?:Access)?Key)?|Passw(?:or)?d|Passphrase|Pass|ApiKey|PrivateKey|Authorization)|(?:api|private)Key))(\\"\s*:\s*)\\"((?:[^\\"]|\\[^\\"]|\\\\(?:\\[\s\S]|\\$|[^\\]|$)|\\$)*)(\\"|"|$)/g, (_, name, sep, value, close) => `${name}${sep}\\"${REDACTED}${close}`, /\\"/],
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/g, (_, scheme) => `${scheme} ${REDACTED}`],
  // A scheme in another case with no name before it ("bearer x9…") hides only a token-shaped word:
  // 16+ characters of the token alphabet with a digit, so "bearer bonds" and "basic steps" stay
  // prose. A run still open at the end of the text is hidden until it closes, so a token streamed
  // in parts shows no prefix.
  [/\b(bearer|basic)\s+(?=[A-Za-z0-9._~+/=-]*[0-9])[A-Za-z0-9._~+/=-]{16,}/gi, (_, scheme) => `${scheme} ${REDACTED}`],
  [/\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]+$/i, (_, scheme) => `${scheme} ${REDACTED}`],
  [/\bAIza[0-9A-Za-z_-]{20,}/g, () => REDACTED],
  // Standalone sk- credentials (the contract above): a whole key, then a still-open run at the end.
  [/(?:(?<![A-Za-z0-9_-])|(?<=\\[nrt]))sk-(?=[A-Za-z0-9_-]*[A-Z])(?=[A-Za-z0-9_-]*[a-z])(?=[A-Za-z0-9_-]*[0-9])[A-Za-z0-9_-]{20,}/g, () => REDACTED],
  [/(?:(?<![A-Za-z0-9_-])|(?<=\\[nrt]))sk-[A-Za-z0-9_-]+$/, () => REDACTED],
]

// A YAML key line under a credential name, read as untrusted text, not validated YAML: from the
// line end before it (group 1) and its indent (2), the name anywhere on the line as a whole token,
// quoted or not, then its `:`, an anchor (&a) and a tag (!!str) in either order, the `|` or `>`
// with its indicators and a comment, up to its own line end. A character that prints nothing
// (NUL, DEL, zero-width, BOM) counts as a space between them. The last two read an explicit key
// (`? password`, its `: |` on a later line, past any blank or comment lines): their indent is the
// key line's when the `:` line starts with it, otherwise none, so the block is hidden whole either
// way. Each is one pass: a blank or comment line skips no gap as a key line, so a gap is read once.
const YAML_KEY = [
  /(^|\r\n|\r(?!\n)|\n)(?=[^\r\n]*:[\x00-\x09\x0B\x0C\x0E-\x20\x7F-\xA0\xAD\u061C\u1680\u180E\u2000-\u200F\u2028-\u202F\u205F-\u2064\u3000\uFEFF]*[&!>|])(?=([ \t]*))\2([^\r\n]*?(?=[A-Za-z0-9])(?:(?<![A-Za-z0-9_-])|(?<=(?<![A-Za-z0-9_-])-{1,2})|(?<=\\[nrt])))((?:[A-Za-z0-9]+[_-])*(?:passphrase|passw(?:or)?d|pass|secret(?:[_-](?:access[_-])?key)?|token|api[_-]?key|private[_-]?key|authorization))((?:[\x00-\x09\x0B\x0C\x0E-\x20\x7F-\xA0\xAD\u061C\u1680\u180E\u2000-\u200F\u2028-\u202F\u205F-\u2064\u3000\uFEFF]*["'])?[\x00-\x09\x0B\x0C\x0E-\x20\x7F-\xA0\xAD\u061C\u1680\u180E\u2000-\u200F\u2028-\u202F\u205F-\u2064\u3000\uFEFF]*:[\x00-\x09\x0B\x0C\x0E-\x20\x7F-\xA0\xAD\u061C\u1680\u180E\u2000-\u200F\u2028-\u202F\u205F-\u2064\u3000\uFEFF]*(?:[&!][^&!\r\n\x00-\x09\x0B\x0C\x0E-\x20\x7F-\xA0\xAD\u061C\u1680\u180E\u2000-\u200F\u2028-\u202F\u205F-\u2064\u3000\uFEFF]*[\x00-\x09\x0B\x0C\x0E-\x20\x7F-\xA0\xAD\u061C\u1680\u180E\u2000-\u200F\u2028-\u202F\u205F-\u2064\u3000\uFEFF]*){0,4}[>|][-+0-9]*[\x00-\x09\x0B\x0C\x0E-\x20\x7F-\xA0\xAD\u061C\u1680\u180E\u2000-\u200F\u2028-\u202F\u205F-\u2064\u3000\uFEFF]*(?:#[^\r\n]*)?(?=[\r\n]|$))/gi,
  /(^|\r\n|\r(?!\n)|\n)(?=[^\r\n]*:[\x00-\x09\x0B\x0C\x0E-\x20\x7F-\xA0\xAD\u061C\u1680\u180E\u2000-\u200F\u2028-\u202F\u205F-\u2064\u3000\uFEFF]*[&!>|])(?=([ \t]*))\2([^\r\n]*?(?=[A-Za-z0-9])(?:(?<![A-Za-z0-9_-])|(?<=(?<![A-Za-z0-9_-])-{1,2})|(?<=\\[nrt])))((?:[A-Za-z][a-z0-9]*(?![a-z0-9])(?:[A-Z][a-z0-9]*(?![a-z0-9]))*?(?:Token|Secret(?:(?:Access)?Key)?|Passw(?:or)?d|Passphrase|Pass|ApiKey|PrivateKey|Authorization)|(?:api|private)Key))((?:[\x00-\x09\x0B\x0C\x0E-\x20\x7F-\xA0\xAD\u061C\u1680\u180E\u2000-\u200F\u2028-\u202F\u205F-\u2064\u3000\uFEFF]*["'])?[\x00-\x09\x0B\x0C\x0E-\x20\x7F-\xA0\xAD\u061C\u1680\u180E\u2000-\u200F\u2028-\u202F\u205F-\u2064\u3000\uFEFF]*:[\x00-\x09\x0B\x0C\x0E-\x20\x7F-\xA0\xAD\u061C\u1680\u180E\u2000-\u200F\u2028-\u202F\u205F-\u2064\u3000\uFEFF]*(?:[&!][^&!\r\n\x00-\x09\x0B\x0C\x0E-\x20\x7F-\xA0\xAD\u061C\u1680\u180E\u2000-\u200F\u2028-\u202F\u205F-\u2064\u3000\uFEFF]*[\x00-\x09\x0B\x0C\x0E-\x20\x7F-\xA0\xAD\u061C\u1680\u180E\u2000-\u200F\u2028-\u202F\u205F-\u2064\u3000\uFEFF]*){0,4}[>|][-+0-9]*[\x00-\x09\x0B\x0C\x0E-\x20\x7F-\xA0\xAD\u061C\u1680\u180E\u2000-\u200F\u2028-\u202F\u205F-\u2064\u3000\uFEFF]*(?:#[^\r\n]*)?(?=[\r\n]|$))/g,
  /(^|\r\n|\r(?!\n)|\n)(?=(?:(?![\x00-\x09\x0B\x0C\x0E-\x20\x7F-\xA0\xAD\u061C\u1680\u180E\u2000-\u200F\u2028-\u202F\u205F-\u2064\u3000\uFEFF]*(?:#|[\r\n]|$))[^\r\n]*(?:\r\n|\r(?!\n)|\n)(?:[\x00-\x09\x0B\x0C\x0E-\x20\x7F-\xA0\xAD\u061C\u1680\u180E\u2000-\u200F\u2028-\u202F\u205F-\u2064\u3000\uFEFF]*(?:#[^\r\n]*)?(?:\r\n|\r(?!\n)|\n))*|[^\r\n]*(?:\r\n|\r|\n))[\x00-\x09\x0B\x0C\x0E-\x20\x7F-\xA0\xAD\u061C\u1680\u180E\u2000-\u200F\u2028-\u202F\u205F-\u2064\u3000\uFEFF]*:[\x00-\x09\x0B\x0C\x0E-\x20\x7F-\xA0\xAD\u061C\u1680\u180E\u2000-\u200F\u2028-\u202F\u205F-\u2064\u3000\uFEFF]*(?:[&!][^&!\r\n\x00-\x09\x0B\x0C\x0E-\x20\x7F-\xA0\xAD\u061C\u1680\u180E\u2000-\u200F\u2028-\u202F\u205F-\u2064\u3000\uFEFF]*[\x00-\x09\x0B\x0C\x0E-\x20\x7F-\xA0\xAD\u061C\u1680\u180E\u2000-\u200F\u2028-\u202F\u205F-\u2064\u3000\uFEFF]*){0,4}[>|][-+0-9]*[\x00-\x09\x0B\x0C\x0E-\x20\x7F-\xA0\xAD\u061C\u1680\u180E\u2000-\u200F\u2028-\u202F\u205F-\u2064\u3000\uFEFF]*(?:#[^\r\n]*)?(?=[\r\n]|$))(?=((?:(?=([ \t]*))\3(?=[^\r\n]*(?:\r\n|\r|\n)(?:[\x00-\x09\x0B\x0C\x0E-\x20\x7F-\xA0\xAD\u061C\u1680\u180E\u2000-\u200F\u2028-\u202F\u205F-\u2064\u3000\uFEFF]*(?:#[^\r\n]*)?(?:\r\n|\r(?!\n)|\n))*\3[\x00-\x09\x0B\x0C\x0E-\x20\x7F-\xA0\xAD\u061C\u1680\u180E\u2000-\u200F\u2028-\u202F\u205F-\u2064\u3000\uFEFF]*:))?))([^\r\n]*?(?=[A-Za-z0-9])(?:(?<![A-Za-z0-9_-])|(?<=(?<![A-Za-z0-9_-])-{1,2})|(?<=\\[nrt])))((?:[A-Za-z0-9]+[_-])*(?:passphrase|passw(?:or)?d|pass|secret(?:[_-](?:access[_-])?key)?|token|api[_-]?key|private[_-]?key|authorization))((?:[\x00-\x09\x0B\x0C\x0E-\x20\x7F-\xA0\xAD\u061C\u1680\u180E\u2000-\u200F\u2028-\u202F\u205F-\u2064\u3000\uFEFF]*["'])?[\x00-\x09\x0B\x0C\x0E-\x20\x7F-\xA0\xAD\u061C\u1680\u180E\u2000-\u200F\u2028-\u202F\u205F-\u2064\u3000\uFEFF]*(?:#[^\r\n]*)?(?:\r\n|\r|\n)(?:[\x00-\x09\x0B\x0C\x0E-\x20\x7F-\xA0\xAD\u061C\u1680\u180E\u2000-\u200F\u2028-\u202F\u205F-\u2064\u3000\uFEFF]*(?:#[^\r\n]*)?(?:\r\n|\r(?!\n)|\n))*[\x00-\x09\x0B\x0C\x0E-\x20\x7F-\xA0\xAD\u061C\u1680\u180E\u2000-\u200F\u2028-\u202F\u205F-\u2064\u3000\uFEFF]*:[\x00-\x09\x0B\x0C\x0E-\x20\x7F-\xA0\xAD\u061C\u1680\u180E\u2000-\u200F\u2028-\u202F\u205F-\u2064\u3000\uFEFF]*(?:[&!][^&!\r\n\x00-\x09\x0B\x0C\x0E-\x20\x7F-\xA0\xAD\u061C\u1680\u180E\u2000-\u200F\u2028-\u202F\u205F-\u2064\u3000\uFEFF]*[\x00-\x09\x0B\x0C\x0E-\x20\x7F-\xA0\xAD\u061C\u1680\u180E\u2000-\u200F\u2028-\u202F\u205F-\u2064\u3000\uFEFF]*){0,4}[>|][-+0-9]*[\x00-\x09\x0B\x0C\x0E-\x20\x7F-\xA0\xAD\u061C\u1680\u180E\u2000-\u200F\u2028-\u202F\u205F-\u2064\u3000\uFEFF]*(?:#[^\r\n]*)?(?=[\r\n]|$))/gi,
  /(^|\r\n|\r(?!\n)|\n)(?=(?:(?![\x00-\x09\x0B\x0C\x0E-\x20\x7F-\xA0\xAD\u061C\u1680\u180E\u2000-\u200F\u2028-\u202F\u205F-\u2064\u3000\uFEFF]*(?:#|[\r\n]|$))[^\r\n]*(?:\r\n|\r(?!\n)|\n)(?:[\x00-\x09\x0B\x0C\x0E-\x20\x7F-\xA0\xAD\u061C\u1680\u180E\u2000-\u200F\u2028-\u202F\u205F-\u2064\u3000\uFEFF]*(?:#[^\r\n]*)?(?:\r\n|\r(?!\n)|\n))*|[^\r\n]*(?:\r\n|\r|\n))[\x00-\x09\x0B\x0C\x0E-\x20\x7F-\xA0\xAD\u061C\u1680\u180E\u2000-\u200F\u2028-\u202F\u205F-\u2064\u3000\uFEFF]*:[\x00-\x09\x0B\x0C\x0E-\x20\x7F-\xA0\xAD\u061C\u1680\u180E\u2000-\u200F\u2028-\u202F\u205F-\u2064\u3000\uFEFF]*(?:[&!][^&!\r\n\x00-\x09\x0B\x0C\x0E-\x20\x7F-\xA0\xAD\u061C\u1680\u180E\u2000-\u200F\u2028-\u202F\u205F-\u2064\u3000\uFEFF]*[\x00-\x09\x0B\x0C\x0E-\x20\x7F-\xA0\xAD\u061C\u1680\u180E\u2000-\u200F\u2028-\u202F\u205F-\u2064\u3000\uFEFF]*){0,4}[>|][-+0-9]*[\x00-\x09\x0B\x0C\x0E-\x20\x7F-\xA0\xAD\u061C\u1680\u180E\u2000-\u200F\u2028-\u202F\u205F-\u2064\u3000\uFEFF]*(?:#[^\r\n]*)?(?=[\r\n]|$))(?=((?:(?=([ \t]*))\3(?=[^\r\n]*(?:\r\n|\r|\n)(?:[\x00-\x09\x0B\x0C\x0E-\x20\x7F-\xA0\xAD\u061C\u1680\u180E\u2000-\u200F\u2028-\u202F\u205F-\u2064\u3000\uFEFF]*(?:#[^\r\n]*)?(?:\r\n|\r(?!\n)|\n))*\3[\x00-\x09\x0B\x0C\x0E-\x20\x7F-\xA0\xAD\u061C\u1680\u180E\u2000-\u200F\u2028-\u202F\u205F-\u2064\u3000\uFEFF]*:))?))([^\r\n]*?(?=[A-Za-z0-9])(?:(?<![A-Za-z0-9_-])|(?<=(?<![A-Za-z0-9_-])-{1,2})|(?<=\\[nrt])))((?:[A-Za-z][a-z0-9]*(?![a-z0-9])(?:[A-Z][a-z0-9]*(?![a-z0-9]))*?(?:Token|Secret(?:(?:Access)?Key)?|Passw(?:or)?d|Passphrase|Pass|ApiKey|PrivateKey|Authorization)|(?:api|private)Key))((?:[\x00-\x09\x0B\x0C\x0E-\x20\x7F-\xA0\xAD\u061C\u1680\u180E\u2000-\u200F\u2028-\u202F\u205F-\u2064\u3000\uFEFF]*["'])?[\x00-\x09\x0B\x0C\x0E-\x20\x7F-\xA0\xAD\u061C\u1680\u180E\u2000-\u200F\u2028-\u202F\u205F-\u2064\u3000\uFEFF]*(?:#[^\r\n]*)?(?:\r\n|\r|\n)(?:[\x00-\x09\x0B\x0C\x0E-\x20\x7F-\xA0\xAD\u061C\u1680\u180E\u2000-\u200F\u2028-\u202F\u205F-\u2064\u3000\uFEFF]*(?:#[^\r\n]*)?(?:\r\n|\r(?!\n)|\n))*[\x00-\x09\x0B\x0C\x0E-\x20\x7F-\xA0\xAD\u061C\u1680\u180E\u2000-\u200F\u2028-\u202F\u205F-\u2064\u3000\uFEFF]*:[\x00-\x09\x0B\x0C\x0E-\x20\x7F-\xA0\xAD\u061C\u1680\u180E\u2000-\u200F\u2028-\u202F\u205F-\u2064\u3000\uFEFF]*(?:[&!][^&!\r\n\x00-\x09\x0B\x0C\x0E-\x20\x7F-\xA0\xAD\u061C\u1680\u180E\u2000-\u200F\u2028-\u202F\u205F-\u2064\u3000\uFEFF]*[\x00-\x09\x0B\x0C\x0E-\x20\x7F-\xA0\xAD\u061C\u1680\u180E\u2000-\u200F\u2028-\u202F\u205F-\u2064\u3000\uFEFF]*){0,4}[>|][-+0-9]*[\x00-\x09\x0B\x0C\x0E-\x20\x7F-\xA0\xAD\u061C\u1680\u180E\u2000-\u200F\u2028-\u202F\u205F-\u2064\u3000\uFEFF]*(?:#[^\r\n]*)?(?=[\r\n]|$))/g,
]

/**
 * Where the block under a YAML key line ends: `at` is the key line's own line end, `indent` its
 * indent. A line scanner. The key line's line end (\n, \r\n or a lone \r, each one line end; an
 * LF or CR key's \r\n too) ends a block line, and any other \r or \n is a stray inside the value.
 * A line ends the block only when its first other character comes after spaces alone, no more of
 * them than its key's indent (a prefix of it). Any other line is value: a blank one, a deeper one,
 * one with a tab, a stray or a character that prints nothing (NUL, DEL, zero-width) before its
 * first other character. The block ends before the line end of that line, the less-indented line
 * after it, shown.
 */
function yamlBlockEnd(s, at, indent) {
  const eol = s.startsWith('\r\n', at) ? '\r\n' : s.charAt(at)
  let end = at
  while (eol && s.startsWith(eol, end)) {
    let from = end + eol.length
    if (eol === '\r' && s[from] === '\n') from++
    let next = s.indexOf(eol, from)
    if (next < 0) next = s.length
    const lead = /^[\s\x00-\x08\x0E-\x1F\x7F-\x9F\xAD\u061C\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064]*/.exec(s.slice(from, next))[0]
    if (from + lead.length < next && /^ *$/.test(lead) && indent.startsWith(lead)) break
    end = next
  }
  return end
}

// The YAML rule of SECRET_TEXT: a block with more than whitespace becomes one line under its key,
// the key line's own line end and indent then `  [redacted]`.
function redactYamlBlocks(s) {
  let out = s
  for (const re of YAML_KEY) {
    let done = ''
    let from = 0
    re.lastIndex = 0
    for (let m = re.exec(out); m; m = re.exec(out)) {
      const at = m.index + m[0].length
      const end = yamlBlockEnd(out, at, m[2])
      const block = out.slice(at, end)
      done += `${out.slice(from, at)}${/\S/.test(block) ? `${block.match(/^(?:\r\n?|\n)/)[0]}${m[2]}  ${REDACTED}` : block}`
      from = re.lastIndex = end
    }
    out = `${done}${out.slice(from)}`
  }
  return out
}

export function redactText(s) {
  let out = s
  for (const [re, fn, gate] of SECRET_TEXT) if (!gate || gate.test(out)) out = typeof re === 'function' ? re(out) : out.replace(re, fn)
  return out
}

export function redact(value, key = '') {
  if (key && SECRET_KEY.test(key) && value !== null && value !== undefined && typeof value !== 'boolean') return REDACTED
  if (typeof value === 'string') return redactText(value)
  if (Array.isArray(value)) return value.map((v) => redact(v))
  if (value && typeof value === 'object') {
    const out = {}
    for (const [k, v] of Object.entries(value)) out[k] = redact(v, k)
    return out
  }
  return value
}
