// Text that comes from an agent's process or protocol, as a chat may show it (#970, experience
// review 7): the end of the agent's stderr when it did not start, an error it answered with,
// the ids it says it offers. A turn that fails says why in the chat, and those words were shown
// as they came, with whatever a process writes when it dies: a home path, a stack trace, the
// odd credential in a command line.
//
// Kept apart from redact.js, which is a byte-equal copy shared with the welcome (its client
// included) and cannot read the home folder.
import { homedir } from 'node:os'
import { redactText } from './redact.js'

const escaped = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// The home folder where it stands as a path of its own. What may come before it: the start of
// the text, a space, a quote, a bracket, `=`, `,`, or `file://`. What may come after it: the
// end, a path separator, a space, a quote, a closing bracket, `:`, `,` or `;`. So the tail of a
// longer path or of a URL (`https://host/home/ada/x`, a doubled leading slash) and the start of another
// name (a longer name that starts the same, or the same name followed by `+` or an accented letter) are not it.
// On Windows a path is the same in either case and with either separator, mixed or doubled
// (as inside JSON), whichever way the home itself was written. A file URL (what a Node stack
// trace prints) is a path too: `file:///home/ada/x.mjs`, or with a drive after the third slash, with a
// space written `%20`.
function homePattern(home) {
  const windows = /^[A-Za-z]:[\\/]/.test(home) || home.startsWith('\\\\')
  // A name as it is written, or as a file URL writes it (a space is `%20` there).
  const either = (part) => {
    const encoded = encodeURI(part)
    return encoded === part ? escaped(part) : `(?:${escaped(part)}|${escaped(encoded)})`
  }
  const share = windows && home.startsWith('\\\\')
  const parts = windows ? home.split(/[\\/]+/).filter(part => part !== '') : undefined
  const body = windows
    ? `${share ? '[\\\\/]{2,}' : ''}${parts.map(either).join('[\\\\/]+')}`
    : home.split('/').map(either).join('/')
  // A file URL puts `file://` before a POSIX path and `file:///` before a drive.
  return new RegExp(`(?<=^|[\\s"'\`(\\[=,<>]|file://${windows ? '/?' : ''})${body}(?=$|[\\\\/\\s"'\`)\\]:,;<>])`, windows ? 'gi' : 'g')
}

// The home folder without a separator at its end; the root itself (and nothing) is no home.
function homeOf(home) {
  if (typeof home !== 'string') return undefined
  const trimmed = home.length > 1 ? home.replace(/[\\/]+$/, '') : home
  return trimmed.length > 1 && !/^[A-Za-z]:$/.test(trimmed) ? trimmed : undefined
}

/**
 * `text` with credential shapes masked, like everywhere else, and the person's home folder
 * written `~`. Only those two: a user name alone, a folder outside the home and a secret of no
 * known shape are not recognised, and a Windows short (8.3) name of the home is not either.
 * Nothing is added and nothing else is cut.
 * @param {unknown} text
 * @param {string} [home] the home folder; one that is a root (`/`, `C:\\`) or empty is left alone
 * @returns {string}
 */
export function shownText(text, home = homedir()) {
  const out = redactText(text)
  const folder = homeOf(home)
  return folder === undefined ? out : out.replace(homePattern(folder), '~')
}
