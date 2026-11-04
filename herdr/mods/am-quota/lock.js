// One switch at a time, apart from the panel so `node --test` can prove a second click starts
// nothing: two interleaved switches would write the Keychain and the credential file from two
// snapshots, and whichever finished last would leave the panel's record wrong.
//
// Nor while bots restart: a restart reads the login the switch is replacing.
//
// The state is the view's own object (`{ busy, restarting }`), mutated in place — the panel already
// keeps it.

/** Starts a switch unless one is running, or bots are restarting. Answers null when it started,
 *  else the line to show. `text` is the busy line to show (the panel names the account by email). */
export function claim(state, provider, account, text = null) {
  if (state.busy) return `${state.busy} — one switch at a time`;
  if (state.restarting) return "bots are restarting: switch once they are done";
  state.busy = text ?? `switching ${provider} to ${account?.name ?? provider}…`;
  return null;
}

/** Marks the switch finished, success or failure. */
export function release(state) {
  state.busy = null;
}
