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
    /**
     * An Automagik Bot's chat (bots-dsh, dsh-source.mjs): read only on the phone unless the bridge's hello says
     * `dshWrite: true` (RFC 0015, Amendments 2026-11-07).
     */
    const val DSH_PREFIX = "dsh:"
    const val ANSWER_ON_COMPUTER = "Answer on the computer"
    const val ANSWER_IN_TERMINAL = "Answer in the terminal"
    /** A key sent, but the prompt was still there when read back: never shown as answered. */
    const val NOT_TAKEN = "Not taken: answer on the Mac."
    const val UPDATE_LINK = "Update Pocket Link on this computer for chat"
    const val DRAFT_WARNING = "Sends your half-typed terminal text with it"
    const val NO_CHAT = "This terminal has no chat. Herdr shows Claude, Codex and omp terminals as chats."
    /** Programs the bridge reads as chats (chat/find.js `APPS`), as herdr-core names them. */
    private val AGENTS = setOf("claude-code", "claude", "codex", "omp")
    /** Rows kept per open chat; older ones come back with Load earlier. */
    const val MAX_ROWS = 1000

    /** An Automagik Bot's chat: no terminal pane, approvals answered as DSH raised them. */
    fun isDsh(terminal: String) = terminal.startsWith(DSH_PREFIX)

    /** Whether the phone refuses writes on [terminal]: a DSH chat, on a bridge that did not say `dshWrite: true`. */
    fun readOnly(terminal: String, dshWrite: Boolean = false) = isDsh(terminal) && !dshWrite

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
        val prompt: String = "", val cut: Boolean = false, val why: String = "", val state: String = "", val msg: String = "",
        /** A question's option labels, in order (option 1 first), and whether several can be picked. */
        val options: List<String> = emptyList(), val multi: Boolean = false
    ) {
        companion object {
            fun parse(j: JSONObject?): Row? {
                if (j == null) return null
                val id = j.optString("id").takeIf { it.isNotEmpty() } ?: return null
                fun s(k: String) = if (j.isNull(k)) "" else j.optString(k, "")
                return Row(id, s("kind"), s("source"), j.optLong("turn", 0), s("role"), s("text"), s("tool"), s("summary"),
                    s("input"), s("output"), j.optBoolean("ok", true), s("call"), j.optJSONArray("choices").strings(),
                    j.optBoolean("open", false), j.optBoolean("answerable", true), s("prompt"), j.optBoolean("cut", false),
                    s("why"), s("state"), s("msg"), j.optJSONArray("options").strings(), j.optBoolean("multi", false))
            }
        }
    }

    data class Status(val state: String = "idle", val kind: String = "", val msg: String = "") {
        companion object {
            fun parse(j: JSONObject?) = if (j == null) null else Status(j.optString("state", "idle"), if (j.isNull("kind")) "" else j.optString("kind"), j.optString("msg"))
        }
    }

    /**
     * A message this phone wrote, by its own id: sending, sent, queued, held (with why), refused, or maybe not sent
     * ("maybe": no answer seen; Retry sends the same id, which the bridge or bots-dsh takes at most once).
     */
    data class Message(val id: String, val text: String, val state: String, val why: String = "", val reason: String = "")

    /**
     * A chat.list row. [shown]: false when bots-dsh lists a project Bot whose project has no yes in `shown[]` (RFC 0015
     * `:751-755`); a row without the field (an older bots-dsh, which serves every Bot) is shown.
     */
    data class Terminal(val terminal: String, val machine: String, val agent: String, val title: String, val status: String, val chat: String,
                        val shown: Boolean = true) {
        /** An Automagik Bot's chat (listed by bots-dsh), not a terminal's. */
        val dsh: Boolean get() = isDsh(terminal)
        companion object {
            fun parse(j: JSONObject) = Terminal(j.optString("terminal"), if (j.isNull("machine")) "" else j.optString("machine"),
                j.optString("agent"), j.optString("title"), j.optJSONObject("status")?.optString("state").orEmpty(), j.optString("chat"),
                j.opt("shown") != false)
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
        val more: Boolean = true,
        /** The bridge's hello said `dshWrite: true`: a DSH chat takes send, answer and interrupt. */
        val dshWrite: Boolean = false
    ) {
        val readOnly: Boolean get() = Chat.readOnly(terminal, dshWrite)
        val dsh: Boolean get() = isDsh(terminal)
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
                question = Row.parse(e.optJSONObject("question"))?.takeIf { it.open },
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

    /**
     * The answer to chat.send (or sendHeld) for message [id]. On a DSH chat `offline` is a socket that did not
     * answer in time, so the prompt may have gone: "maybe", never a plain refusal or a success.
     */
    fun answered(s: State, id: String, text: String, answer: JSONObject): State {
        val state = answer.optString("state")
        if (state == "refused" && s.dsh && answer.optString("reason") == "offline") return unanswered(s, id, text)
        if (state == "refused") return s.copy(messages = upsert(s.messages, Message(id, text, "refused", reason = answer.optString("reason"))))
        return s.copy(messages = upsert(s.messages, (s.messages.find { it.id == id } ?: Message(id, text, state))
            .let { m -> if (m.state == "sending" && state == "sent" && !s.dsh) m else m.copy(state = state.ifBlank { "sent" }, why = answer.optString("why")) }))
    }

    /** An answer the phone sent and did not see answered: tapping again sends the same one, taken at most once. */
    const val ANSWER_MAYBE = "Maybe not sent. Tap it again: it is answered at most once."

    /**
     * What the chat says after an approval tap (chat.answer's answer, approve.js reasons, or on a [dsh] chat the
     * bots-dsh socket's refusals passed through by the bridge); null for a plain success.
     */
    fun answerNotice(a: JSONObject, dsh: Boolean = false): String? = when {
        a.optString("reason") == "read-only" -> ANSWER_ON_COMPUTER
        a.optBoolean("ok") -> if (a.optString("pressed") == "uncertain") NOT_TAKEN else null
        dsh -> when (a.optString("reason")) {
            "settled" -> receipt(a.optJSONObject("receipt"))
            "changed" -> "The question changed; nothing was answered."
            "offline" -> ANSWER_MAYBE
            "busy" -> "Still answering the last tap."
            "rate" -> "Too many taps. Wait a moment."
            "not-shown" -> "Show this project in Automagik first."
            "not-watching" -> "This chat moved on. Reopen it."
            "text-on-approval", "invalid" -> "Not answered: that answer doesn't fit. $ANSWER_ON_COMPUTER."
            "empty" -> "Type an answer first."
            "too-long" -> "That answer is too long."
            else -> "Not answered. $ANSWER_ON_COMPUTER."
        }
        else -> when (a.optString("reason")) {
            "changed" -> "The question changed; nothing was pressed."
            "closed", "no-such-row" -> "That question is already closed."
            "answered" -> "Already answered."
            "stopped" -> "Stopped partway: the question moved on. Finish in the terminal."
            "in-flight" -> "Still answering the last tap."
            else -> "Not answered. $ANSWER_IN_TERMINAL."
        }
    }

    /**
     * What the chat says after an interrupt: sent, refused (a DSH chat passes the socket's reason through), or not
     * confirmed when no answer came or the socket did not answer in time (never repeated by itself).
     */
    fun interruptNotice(a: JSONObject?, dsh: Boolean): String = when {
        a?.optBoolean("ok") == true -> "Interrupt sent."
        a != null && dsh && a.optString("reason") !in setOf("", "offline") -> "Interrupt not sent: ${answerNotice(a, dsh = true)}"
        else -> "Interrupt not confirmed. Check the ${if (dsh) "computer" else "terminal"}."
    }

    /** Who answered a request first (bots-dsh's settled entry); never more than it says. */
    private fun receipt(r: JSONObject?): String {
        if (r == null) return "Already answered."
        if (r.optString("outcome") == "withdrawn") return "No longer needed."
        val outcome = when (val o = r.optString("outcome")) { "allow" -> "Allow"; "deny" -> "Deny"; else -> o }
        val where = when (r.optString("by")) {
            "phone" -> "on the phone" + r.optString("name").takeIf { it.isNotBlank() }?.let { " ($it)" }.orEmpty()
            "computer" -> "on the computer"
            else -> ""
        }
        return listOf("Already answered", where).filter { it.isNotEmpty() }.joinToString(" ") + (if (outcome.isNotEmpty()) ": $outcome." else ".")
    }

    /** A send that got no answer (the link dropped, or it timed out): never sent again by itself, shown with Retry. */
    fun unanswered(s: State, id: String, text: String) = s.copy(messages = upsert(s.messages, Message(id, text, "maybe")))

    /** What a reconnect keeps of [s]: messages whose outcome is unknown (still sending, or maybe), as maybe, with Retry. */
    fun unknown(s: State): List<Message> = s.messages.filter { it.state == "maybe" || it.state == "sending" }.map { it.copy(state = "maybe") }

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
 * Which buttons a chat shows: the only place that decides it. A read-only DSH chat (a bridge without
 * `dshWrite`) gets none of them, whatever its rows claim; the bridge refuses those writes too
 * (dsh-source.mjs `refusedDsh`). A writable one never offers allow for session (RFC 0015 Amendments).
 */
object ChatActions {
    /** Allowed keys, as the engine names them (approve.js); anything else is never offered. */
    private val CHOICES = listOf("allow", "allow-always", "deny")

    fun canSend(s: Chat.State) = !s.readOnly && s.connected && !s.gone && !s.offline
    fun canInterrupt(s: Chat.State) = canSend(s) && s.status.state in setOf("working", "blocked")
    fun canShowTerminal(s: Chat.State) = !s.dsh
    fun canSendHeld(s: Chat.State, m: Chat.Message) = canSend(s) && m.state == "held"
    fun canRetry(s: Chat.State, m: Chat.Message) = canSend(s) && m.state == "maybe"

    /** The approval's buttons: only on a writable chat, an open row the engine raised, with choices it named. */
    fun choices(s: Chat.State, row: Chat.Row?): List<String> {
        if (row == null || s.readOnly || !canSend(s) || !row.open || !row.answerable || row.kind != "approval") return emptyList()
        return CHOICES.filter { it in row.choices && !(s.dsh && it == "allow-always") }
    }

    /** The choice that types a question's own answer (chat/question.js `OTHER`). */
    const val OTHER = "other"

    /** A question's options to tap: only on a writable chat, an open answerable row the engine raised, with options it named. */
    fun options(s: Chat.State, row: Chat.Row?): List<String> {
        if (row == null || s.readOnly || !canSend(s) || !row.open || !row.answerable || row.kind != "question") return emptyList()
        return row.options
    }

    /** Whether the question also takes a typed answer: a single-select with options (a multi-select's was never probed). */
    fun canType(s: Chat.State, row: Chat.Row?) = row != null && !row.multi && options(s, row).isNotEmpty()

    /**
     * The chat.answer `choice` for the options picked, 0-based as drawn: one option on a single-select (its digit),
     * one or more on a multi-select (digits joined by ","); null for anything else.
     */
    fun questionChoice(s: Chat.State, row: Chat.Row?, picked: List<Int>): String? {
        val n = options(s, row).size
        if (n == 0 || picked.isEmpty() || picked.any { it !in 0 until n } || picked.toSet().size != picked.size) return null
        if (row?.multi != true && picked.size != 1) return null
        return picked.joinToString(",") { (it + 1).toString() }
    }

    /**
     * What a tap on a question sends as chat.answer's (choice, text): the options [picked], or the typed [text] (one
     * line, single-select only) with choice [OTHER]. Null when the row does not offer it: nothing is sent.
     */
    fun questionAnswer(s: Chat.State, row: Chat.Row?, picked: List<Int>, text: String? = null): Pair<String, String?>? {
        if (text == null) return questionChoice(s, row, picked)?.let { it to null }
        val typed = text.trim()
        if (!canType(s, row) || typed.isEmpty() || typed.any { it == '\n' || it == '\r' } || picked.isNotEmpty()) return null
        return OTHER to typed
    }

    /** What an approval or question without buttons says instead. */
    fun passive(s: Chat.State) = if (s.dsh) Chat.ANSWER_ON_COMPUTER else Chat.ANSWER_IN_TERMINAL

    /** What a pending row without buttons says: answered (the bridge saw it taken), not taken, or [passive]. */
    fun pendingNote(s: Chat.State, row: Chat.Row) = when (row.why) { "answered" -> "Answered."; "not-taken" -> Chat.NOT_TAKEN; else -> passive(s) }
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
