package ai.namastex.automagik

import org.json.JSONArray
import org.json.JSONObject
import java.io.Closeable

/** The desktop's Pocket Link has no chat route yet (an older bridge): the terminal view is all there is. */
class ChatUnsupported : IllegalStateException(Chat.UPDATE_LINK)

/**
 * The `chat.*` methods of Pocket Link's `herdr-pocket/chat/1` route, over the same framing herdr-core speaks
 * ([CoreClient]). A write on a DSH chat (read only) is refused here, before anything is sent; the bridge refuses
 * it too (dsh-source.mjs).
 */
class ChatClient(private val core: CoreClient) : Closeable {
    companion object {
        /** The bridge's answer to a write the phone never sends: the same shape dsh-source.mjs `refusedDsh` gives. */
        fun refusedReadOnly(id: String? = null): JSONObject = JSONObject().put("state", "refused").put("ok", false)
            .put("reason", "read-only").put("message", Chat.ANSWER_ON_COMPUTER).apply { if (id != null) put("id", id) }

        /** Starts [core] and checks the bridge serves chat version 1. */
        suspend fun start(core: CoreClient): ChatClient {
            val hello = core.start()
            if (hello.optInt("chat") != 1) { core.close(); throw ChatUnsupported() }
            return ChatClient(core)
        }

        /** A connect that failed because the bridge does not offer the chat route (an older Pocket Link). */
        fun refusedRoute(e: Throwable): Boolean {
            val m = generateSequence(e) { it.cause }.mapNotNull { it.message?.lowercase() }.joinToString(" ")
            return "alpn" in m || "application protocol" in m || "no_application_protocol" in m
        }
    }

    private fun params(terminal: String) = JSONObject().put("terminal", terminal)

    suspend fun list(): List<Chat.Terminal> {
        val terminals = core.call("chat.list").optJSONArray("terminals") ?: JSONArray()
        return (0 until terminals.length()).mapNotNull { terminals.optJSONObject(it) }.map(Chat.Terminal::parse).filter { it.terminal.isNotEmpty() }
    }

    /**
     * Watches [terminal]'s chat from [after] (a row id, or null for the latest page). Each event line goes to
     * [event]; [closed] gets the reason the bridge closed it ("slow": resubscribe with the cursor).
     */
    suspend fun subscribe(terminal: String, after: String?, event: (JSONObject) -> Unit, closed: (String) -> Unit): Int {
        val p = params(terminal).apply { if (after != null) put("after", after) }
        val channel = core.call("chat.subscribe", p).getInt("channel")
        val partial = StringBuilder()
        core.stream(channel, { bytes ->
            partial.append(String(bytes, Charsets.UTF_8))
            while (true) {
                val end = partial.indexOf("\n")
                if (end < 0) break
                val line = partial.substring(0, end)
                partial.delete(0, end + 1)
                if (line.isNotBlank()) runCatching { JSONObject(line) }.getOrNull()?.let(event)
            }
        }, closed)
        return channel
    }

    fun unsubscribe(channel: Int) = runCatching { core.detach(channel) }

    suspend fun backfill(terminal: String, before: String, limit: Int = 50): JSONArray =
        core.call("chat.backfill", params(terminal).put("before", before).put("limit", limit)).optJSONArray("rows") ?: JSONArray()

    suspend fun send(terminal: String, text: String, id: String): JSONObject =
        if (Chat.readOnly(terminal)) refusedReadOnly(id) else core.call("chat.send", params(terminal).put("text", text).put("id", id))

    suspend fun sendHeld(terminal: String, id: String): JSONObject =
        if (Chat.readOnly(terminal)) refusedReadOnly(id) else core.call("chat.sendHeld", params(terminal).put("id", id))

    suspend fun cancelHeld(terminal: String, id: String): JSONObject =
        if (Chat.readOnly(terminal)) refusedReadOnly(id) else core.call("chat.cancelHeld", params(terminal).put("id", id))

    /** [text]: a question's typed answer, with choice [ChatActions.OTHER] only. */
    suspend fun answer(terminal: String, row: String, choice: String, text: String? = null): JSONObject =
        if (Chat.readOnly(terminal)) refusedReadOnly()
        else core.call("chat.answer", params(terminal).put("row", row).put("choice", choice).apply { if (text != null) put("text", text) })

    suspend fun interrupt(terminal: String): JSONObject =
        if (Chat.readOnly(terminal)) refusedReadOnly() else core.call("chat.interrupt", params(terminal))

    override fun close() = core.close()
}
