package ai.namastex.automagik

/**
 * What the phone remembers of each Automagik Bot's `dsh:` chat between two readings, so Home can show a finished turn
 * as Done (bots-dsh says blocked, working or idle, never done) and keep its receipt. In memory only, like the chats
 * themselves (docs/privacy.md). Pure: the view model feeds it chat.list readings and the open chat's events.
 */
object ChatWatch {
    /**
     * [status] is Home's word for the chat: blocked, working, idle or done. [turn] is the phone's own count of the
     * turns it saw start, so a looked-at Done ([Cockpit.seenKey]) comes back when another turn finishes. [since]:
     * when the word last changed (ms). [receipt]: how this turn's request was answered, for its Done line. [left]: the
     * phone closed this chat since: a chat no phone watches can still list idle (a state read bots-dsh could not
     * make), so the next quiet reading is no finish; the next active one is the same turn going on.
     */
    data class Watched(val status: String, val turn: Long, val since: Long, val receipt: String = "", val left: Boolean = false)

    fun key(hostId: String, terminal: String) = "$hostId|$terminal"
    private fun active(status: String) = status == "blocked" || status == "working"

    /**
     * One observation of a chat as bots-dsh words it: a chat that goes quiet after being seen blocked or working is
     * done, and stays done until it is looked at or starts again; a start after idle or done is a new turn, and drops
     * the old receipt. A chat first seen quiet is idle: nothing happened while the phone watched.
     */
    fun observe(prev: Watched?, status: String, now: Long): Watched = when {
        active(status) -> when {
            prev == null -> Watched(status, 1, now)
            active(prev.status) -> if (prev.status == status && !prev.left) prev else prev.copy(status = status, since = if (prev.status == status) prev.since else now, left = false)
            else -> Watched(status, prev.turn + 1, now)
        }
        prev == null -> Watched("idle", 0, now)
        prev.left && active(prev.status) -> Watched("idle", prev.turn, now)
        active(prev.status) -> Watched("done", prev.turn, now, prev.receipt)
        else -> prev
    }

    /** The phone closed this chat: what it says next is not vouched for until it is seen active again. */
    fun left(watched: Map<String, Watched>, key: String): Map<String, Watched> {
        val w = watched[key] ?: return watched
        return if (w.left || !active(w.status)) watched else watched + (key to w.copy(left = true))
    }

    /** A reading of [hostId]'s chat.list: every row observed; a chat no longer listed is forgotten. */
    fun read(watched: Map<String, Watched>, hostId: String, rows: List<Chat.Terminal>, now: Long): Map<String, Watched> {
        val prefix = key(hostId, "")
        val kept = watched.filterKeys { !it.startsWith(prefix) }
        return kept + rows.associate { r -> key(hostId, r.terminal).let { k -> k to observe(watched[k], r.status, now) } }
    }

    /** The open chat's status event, for its own row. */
    fun status(watched: Map<String, Watched>, key: String, status: String, now: Long): Map<String, Watched> =
        watched + (key to observe(watched[key], status, now))

    /** A receipt the open chat saw: kept on the turn, so the Done line says how it was answered. */
    fun receipt(watched: Map<String, Watched>, key: String, line: String): Map<String, Watched> {
        val w = watched[key] ?: return watched
        return if (w.receipt == line) watched else watched + (key to w.copy(receipt = line))
    }
}
