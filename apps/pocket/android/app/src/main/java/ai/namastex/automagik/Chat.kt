package ai.namastex.automagik

import org.json.JSONArray
import org.json.JSONObject

/**
 * The phone's half of the live chat (RFC 0015 delivery 5): what Pocket Link's `herdr-pocket/chat/1`
 * route sends (herdr/mods/pocket-link/bridge/chat.mjs, chat/engine.js), folded into one state, and
 * the one place that decides which buttons a chat shows ([ChatActions]).
 *
 * Rows live only here, in memory: never in preferences, Room or the log (docs/privacy.md).
 */
object Chat {
    /** An Automagik Bot's chat (bots-dsh, dsh-source.mjs): read only on the phone. */
    const val DSH_PREFIX = "dsh:"
    const val ANSWER_ON_COMPUTER = "Answer on the computer"
    const val ANSWER_IN_TERMINAL = "Answer in the terminal"
    const val UPDATE_LINK = "Update Pocket Link on this computer for chat"
    const val DRAFT_WARNING = "Sends your half-typed terminal text with it"
    const val NO_CHAT = "This terminal has no chat. Herdr shows Claude, Codex and omp terminals as chats."
    /** Programs the bridge reads as chats (chat/find.js `APPS`), as herdr-core names them. */
    private val AGENTS = setOf("claude-code", "claude", "codex", "omp")
    /** Rows kept per open chat; older ones come back with Load earlier. */
    const val MAX_ROWS = 1000

    fun readOnly(terminal: String) = terminal.startsWith(DSH_PREFIX)

    /** A terminal worth offering a Chat tab: the program the bridge decodes runs in it (find.js `agentOf`). */
    fun offered(t: CoreTerminal?): Boolean {
        if (t == null || !t.live) return false
        return listOf(t.app, t.argv.firstOrNull().orEmpty().substringAfterLast('/'), t.agent).any { it.lowercase() in AGENTS }
    }

    data class Row(
        val id: String, val kind: String, val source: String = "", val turn: Long = 0,
        val role: String = "", val text: String = "", val tool: String = "", val summary: String = "",
        val input: String = "", val output: String = "", val ok: Boolean = true, val call: String = "",
        val choices: List<String> = emptyList(), val open: Boolean = false, val answerable: Boolean = true,
        val prompt: String = "", val cut: Boolean = false, val why: String = "", val state: String = "", val msg: String = ""
    ) {
        companion object {
            fun parse(j: JSONObject?): Row? {
                if (j == null) return null
                val id = j.optString("id").takeIf { it.isNotEmpty() } ?: return null
                fun s(k: String) = if (j.isNull(k)) "" else j.optString(k, "")
                return Row(id, s("kind"), s("source"), j.optLong("turn", 0), s("role"), s("text"), s("tool"), s("summary"),
                    s("input"), s("output"), j.optBoolean("ok", true), s("call"), j.optJSONArray("choices").strings(),
                    j.optBoolean("open", false), j.optBoolean("answerable", true), s("prompt"), j.optBoolean("cut", false),
                    s("why"), s("state"), s("msg"))
            }
        }
    }

    data class Status(val state: String = "idle", val kind: String = "", val msg: String = "") {
        companion object {
            fun parse(j: JSONObject?) = if (j == null) null else Status(j.optString("state", "idle"), if (j.isNull("kind")) "" else j.optString("kind"), j.optString("msg"))
        }
    }

    /** A message this phone wrote, by its own id: sending, sent, queued, held (with why), refused, or maybe not sent. */
    data class Message(val id: String, val text: String, val state: String, val why: String = "", val reason: String = "")

    data class Terminal(val terminal: String, val machine: String, val agent: String, val title: String, val status: String, val chat: String) {
        val readOnly: Boolean get() = Chat.readOnly(terminal)
        companion object {
            fun parse(j: JSONObject) = Terminal(j.optString("terminal"), if (j.isNull("machine")) "" else j.optString("machine"),
                j.optString("agent"), j.optString("title"), j.optJSONObject("status")?.optString("state").orEmpty(), j.optString("chat"))
        }
    }

    data class State(
        val terminal: String, val rows: List<Row> = emptyList(), val screen: List<Row> = emptyList(),
        val status: Status = Status(), val approval: Row? = null, val question: Row? = null,
        val messages: List<Message> = emptyList(), val connected: Boolean = false, val error: String? = null,
        /** A short answer to the last action ("The question changed; nothing was pressed"). */
        val notice: String? = null,
        /** The terminal ended, or the chat closed for good. */
        val gone: Boolean = false,
        /** herdr-core went away: the last rows stay, greyed, and nothing is sent. */
        val offline: Boolean = false,
        /** No transcript found: history appears once it is. */
        val screenOnly: Boolean = false,
        val more: Boolean = true
    ) {
        val readOnly: Boolean get() = Chat.readOnly(terminal)
        /** Where a resubscribe resumes: the newest transcript row. */
        val cursor get() = rows.lastOrNull()?.id
        val oldest get() = rows.firstOrNull()?.id
    }

    /** One event from a subscription's stream (chat.mjs `event`), folded into [s]. Unknown events change nothing. */
    fun reduce(s: State, e: JSONObject): State = when (e.optString("type")) {
        "snapshot" -> {
            val rows = e.optJSONArray("rows").rows()
            val kept = if (e.optBoolean("reset")) rows else merge(s.rows, rows)
            s.copy(rows = kept.takeLast(MAX_ROWS), screen = e.optJSONArray("screen").rows(),
                status = Status.parse(e.optJSONObject("status")) ?: s.status,
                approval = Row.parse(e.optJSONObject("approval"))?.takeIf { it.open },
                messages = held(s.messages, e.optJSONArray("held")), connected = true, gone = false, offline = false, error = null)
        }
        "rows" -> s.copy(rows = merge(s.rows, e.optJSONArray("rows").rows()).takeLast(MAX_ROWS))
        "screen" -> s.copy(screen = e.optJSONArray("rows").rows())
        "status" -> s.copy(status = Status.parse(e.optJSONObject("status")) ?: s.status,
            question = s.question.takeIf { e.optJSONObject("status")?.optString("state") == "blocked" })
        "source" -> s.copy(screenOnly = e.optString("source") == "none")
        "approval" -> Row.parse(e.optJSONObject("row")).let { r -> s.copy(approval = r?.takeIf { it.open }) }
        "question" -> s.copy(question = Row.parse(e.optJSONObject("row")))
        "held" -> message(s, e.optString("id")) { it.copy(state = "held", why = e.optString("why")) }
        "sent" -> message(s, e.optString("id")) { it.copy(state = e.optString("state", "sent").ifBlank { "sent" }, why = "") }
        "sending" -> message(s, e.optString("id")) { it.copy(state = "sending", why = "") }
        "matched" -> s.copy(messages = s.messages.filterNot { it.id == e.optString("id") })
        "cancelled" -> s.copy(messages = s.messages.filterNot { it.id == e.optString("id") })
        "gone" -> s.copy(gone = true, connected = false, approval = null, question = null)
        "offline" -> s.copy(offline = true, approval = null, question = null)
        else -> s
    }

    /** Older rows from chat.backfill, before what is shown; none left means no more. */
    fun earlier(s: State, page: JSONArray?): State {
        val older = page.rows().filter { r -> s.rows.none { it.id == r.id } }
        return s.copy(rows = (older + s.rows).take(MAX_ROWS), more = older.isNotEmpty())
    }

    /** The answer to chat.send (or sendHeld) for message [id]. */
    fun answered(s: State, id: String, text: String, answer: JSONObject): State {
        val state = answer.optString("state")
        if (state == "refused") return s.copy(messages = upsert(s.messages, Message(id, text, "refused", reason = answer.optString("reason"))))
        return s.copy(messages = upsert(s.messages, (s.messages.find { it.id == id } ?: Message(id, text, state))
            .let { m -> if (m.state == "sending" && state == "sent") m else m.copy(state = state.ifBlank { "sent" }, why = answer.optString("why")) }))
    }

    /** What the chat says after an approval tap (chat.answer's answer, approve.js reasons); null for a plain success. */
    fun answerNotice(a: JSONObject): String? = when {
        a.optString("reason") == "read-only" -> ANSWER_ON_COMPUTER
        a.optBoolean("ok") -> if (a.optString("pressed") == "uncertain") "Pressed. Check the terminal that it took." else null
        else -> when (a.optString("reason")) {
            "changed" -> "The question changed; nothing was pressed."
            "closed", "no-such-row" -> "That question is already closed."
            "answered" -> "Already answered."
            "in-flight" -> "Still answering the last tap."
            else -> "Not answered. $ANSWER_IN_TERMINAL."
        }
    }

    /** A send that got no answer (the link dropped, or it timed out): never sent again by itself, shown with Retry. */
    fun unanswered(s: State, id: String, text: String) = s.copy(messages = upsert(s.messages, Message(id, text, "maybe")))

    private fun message(s: State, id: String, change: (Message) -> Message): State {
        val m = s.messages.find { it.id == id } ?: return s
        return s.copy(messages = s.messages.map { if (it.id == id) change(m) else it })
    }

    private fun upsert(list: List<Message>, m: Message) = if (list.any { it.id == m.id }) list.map { if (it.id == m.id) m else it } else list + m

    /** The bridge's held list is the truth for held messages after a (re)subscribe; ours keep their text. */
    private fun held(mine: List<Message>, held: JSONArray?): List<Message> {
        val ids = (0 until (held?.length() ?: 0)).mapNotNull { held?.optJSONObject(it) }.associate { it.optString("id") to it.optString("why") }
        return mine.mapNotNull { m -> when {
            m.id in ids -> m.copy(state = "held", why = ids.getValue(m.id))
            m.state == "held" -> null
            else -> m
        } }
    }

    /** New rows after the old, each id once (a newer copy of a row replaces it in place). */
    fun merge(old: List<Row>, new: List<Row>): List<Row> {
        if (new.isEmpty()) return old
        val at = old.withIndex().associate { it.value.id to it.index }
        val out = old.toMutableList()
        for (r in new) { val i = at[r.id]; if (i != null) out[i] = r else out += r }
        return out
    }

    private fun JSONArray?.rows(): List<Row> = if (this == null) emptyList() else (0 until length()).mapNotNull { Row.parse(optJSONObject(it)) }
    private fun JSONArray?.strings(): List<String> = if (this == null) emptyList() else (0 until length()).map { optString(it) }.filter { it.isNotEmpty() }
}

/**
 * Which buttons a chat shows: the only place that decides it. A DSH chat (read only) gets none of
 * them, whatever its rows claim; the bridge refuses those writes too (dsh-source.mjs `refusedDsh`).
 */
object ChatActions {
    /** Allowed keys, as the engine names them (approve.js); anything else is never offered. */
    private val CHOICES = listOf("allow", "allow-always", "deny")

    fun canSend(s: Chat.State) = !s.readOnly && s.connected && !s.gone && !s.offline
    fun canInterrupt(s: Chat.State) = canSend(s) && s.status.state in setOf("working", "blocked")
    fun canShowTerminal(s: Chat.State) = !s.readOnly
    fun canSendHeld(s: Chat.State, m: Chat.Message) = canSend(s) && m.state == "held"
    fun canRetry(s: Chat.State, m: Chat.Message) = canSend(s) && m.state == "maybe"

    /** The approval's buttons: only on a writable chat, an open row the engine raised, with choices it named. */
    fun choices(s: Chat.State, row: Chat.Row?): List<String> {
        if (row == null || s.readOnly || !canSend(s) || !row.open || !row.answerable || row.kind != "approval") return emptyList()
        return CHOICES.filter { it in row.choices }
    }

    /** What an approval or question without buttons says instead. */
    fun passive(s: Chat.State) = if (s.readOnly) Chat.ANSWER_ON_COMPUTER else Chat.ANSWER_IN_TERMINAL
}

/**
 * Row text as the phone shows it: plain text only (RFC 0015, "Rendering, both clients"). Escape
 * sequences and control characters are removed; raw HTML stays as the characters it is, never
 * parsed or rendered; nothing loads by itself; an http(s) link is a span showing its own target,
 * opened only on a tap. There is no image block: nothing here can fetch.
 */
object ChatText {
    sealed interface Span { val text: String }
    data class Plain(override val text: String) : Span
    /** A link, shown as its target: [text] is the target itself. */
    data class Link(override val text: String) : Span

    sealed interface Block
    data class Prose(val spans: List<Span>) : Block
    /** A fenced code block, shown monospace. */
    data class Code(val text: String) : Block

    private val ESCAPES = Regex("\u001b\\[[0-?]*[ -/]*[@-~]|\u001b\\][^\u0007\u001b]*(\u0007|\u001b\\\\)?|\u001b[PX^_][^\u001b]*(\u001b\\\\)?|\u001b[@-Z\\\\-_]|\u009b[0-?]*[ -/]*[@-~]")

    /** ANSI and other escape sequences gone; then every control but newline and tab. CRLF becomes LF. */
    fun clean(text: String): String = ESCAPES.replace(text.replace("\r\n", "\n"), "")
        .filter { c -> c == '\n' || c == '\t' || !(c.isISOControl() || c == '\u007f') }

    fun spans(text: String): List<Span> {
        val out = mutableListOf<Span>()
        var at = 0
        for (range in Links.find(text)) {
            val url = text.substring(range)
            if (Links.browsable(url) == null) continue
            if (range.first > at) out += Plain(text.substring(at, range.first))
            out += Link(url)
            at = range.last + 1
        }
        if (at < text.length) out += Plain(text.substring(at))
        return out
    }

    /** [text] as blocks: fenced code apart, the rest prose. */
    fun blocks(text: String): List<Block> {
        val cleaned = clean(text)
        val out = mutableListOf<Block>()
        val prose = StringBuilder()
        val code = StringBuilder()
        var inCode = false
        fun flushProse() { if (prose.isNotEmpty()) { out += Prose(spans(prose.toString().trimEnd('\n'))); prose.clear() } }
        for (line in cleaned.split('\n')) {
            if (line.trimStart().startsWith("```")) {
                if (inCode) { out += Code(code.toString().trimEnd('\n')); code.clear() } else flushProse()
                inCode = !inCode
                continue
            }
            (if (inCode) code else prose).append(line).append('\n')
        }
        if (inCode) out += Code(code.toString().trimEnd('\n'))
        flushProse()
        return out.filterNot { it is Prose && it.spans.isEmpty() }
    }
}
