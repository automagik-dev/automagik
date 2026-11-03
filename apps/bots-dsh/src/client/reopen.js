// The chat on screen, kept across a restart of DSH alone. The Automagik desktop app restarts DSH
// without closing the window to put plugin updates in (apps/desktop src/auto-apply.js), and the
// page loads again on the same origin. The open chat is not in DSH's URL, and a cold start lands
// on the Main Bot, so this tab keeps the chat it shows in sessionStorage (this tab and origin
// only), and the app asks for it back by setting REOPEN just before it restarts DSH. A reload
// nobody asked for, or a new window, lands where it always did. Drafts need nothing here: DSH
// keeps them in localStorage, per origin.

export const OPEN_CHAT = 'omni-ui:open-chat'
export const REOPEN = 'omni-ui:reopen'

const storageOf = () => { try { return globalThis.sessionStorage ?? null } catch { return null } }

/** Note the chat on screen (a Session id), or forget it. */
export function rememberOpen(id, storage = storageOf()) {
  try {
    if (typeof id === 'string' && id !== '') storage?.setItem(OPEN_CHAT, id)
    else storage?.removeItem(OPEN_CHAT)
  } catch {}
}

/** The chat to reopen, once, when the app asked for it; else null. */
export function takeReopen(storage = storageOf()) {
  try {
    if (storage?.getItem(REOPEN) !== '1') return null
    storage.removeItem(REOPEN)
    const id = storage.getItem(OPEN_CHAT)
    return typeof id === 'string' && id !== '' ? id : null
  } catch {
    return null
  }
}
