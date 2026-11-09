package ai.namastex.automagik

import kotlinx.coroutines.delay
import org.json.JSONArray
import org.json.JSONObject

/**
 * The options an agent waits on, read off its screen, for the notification's buttons and the terminal screen's answer
 * row. Pressing one sends the arrow
 * keys and Enter that pick it, but only after the screen is read again and still shows the same dialog: the same
 * question or approval text above the same menu.
 */
object Prompt {
    /**
     * A numbered menu at the bottom of the screen; [cursor] is the highlighted option's index, and [dialog] is the
     * prompt's own text above it (the question, or the approval's header and command), kept so a tap can check the
     * agent still asks the same thing, not merely offers the same options.
     */
    data class Menu(val options: List<String>, val cursor: Int, val dialog: String = "")
    /**
     * A button: the option's index in its menu and its text. [always] marks a permission's "don't ask again" option,
     * drawn as [button] ("Always allow") because its own text is long; [label] keeps the whole text for the outcome.
     */
    data class Choice(val index: Int, val label: String, val always: Boolean = false) {
        val button get() = if (always) "Always allow" else label
    }

    private val OPTION = Regex("""^\s*(❯|›|>)?\s*(\d{1,2})\.\s+(\S.*?)\s*$""")
    /** A drawn separator inside a menu (Claude Code puts one before "Chat about this"). */
    private val RULE = Regex("""^[\s─━╌┄-]+$""")
    /** The screen-wide `─` rule that opens a dialog; the separators inside it are indented, so this is not one. */
    private val OPEN = Regex("""^[─━]{8,}\s*$""")
    /** Claude Code's rotating hint inside a permission dialog: not the prompt, so it is not compared. */
    private val TIP = Regex("""^Tip:""")
    /** Any run of whitespace: the pane wraps a long line at the phone's width, and that is layout, not text. */
    private val SPACE = Regex("""\s+""")
    private val FREE_TEXT = listOf("type something", "chat about this")

    /** The last numbered menu on [screen] (1., 2., … in order, one highlighted), or null if there isn't one. */
    fun menu(screen: String): Menu? {
        val lines = screen.lines()
        val end = lines.indexOfLast { OPTION.matches(it) }
        if (end < 0) return null
        val found = mutableListOf<Pair<Int, MatchResult>>()
        // Walk up from the last option: other options, or their indented descriptions and wrapped lines.
        var i = end
        while (i >= 0) {
            val m = OPTION.matchEntire(lines[i])
            when {
                m != null -> found.add(0, i to m)
                RULE.matches(lines[i]) -> {}
                lines[i].isBlank() || !lines[i].startsWith(" ") -> break
            }
            if (m != null && m.groupValues[2] == "1") break
            i--
        }
        val numbers = found.map { it.second.groupValues[2].toInt() }
        if (numbers != (1..numbers.size).toList() || numbers.size < 2) return null
        val cursor = found.indexOfFirst { it.second.groupValues[1].isNotEmpty() }
        if (cursor < 0 || found.count { it.second.groupValues[1].isNotEmpty() } != 1) return null
        return Menu(found.map { it.second.groupValues[3] }, cursor, dialog(lines, found.first().first))
    }

    /**
     * The prompt's own text above a menu starting at [start]: the lines between the `─` rule that opens the dialog
     * and the options, or, when the screen draws no rule, the indented block above them (Codex separates its prompt
     * from its options with blank lines). A blank line and then unindented text is the agent's earlier output, not the
     * prompt. Rotating tip lines, inner separators and blank lines are not text.
     */
    private fun dialog(lines: List<String>, start: Int): String {
        val above = ArrayDeque<String>()
        var blank = false
        var i = start - 1
        while (i >= 0) {
            val line = lines[i]
            if (line.isBlank()) { blank = true; i--; continue }
            if (RULE.matches(line)) {
                if (OPEN.matches(line)) break
            } else {
                // Only a prompt directly above the options may be flush left; after a blank, that is older output.
                if (blank && !line.startsWith(" ")) break
                if (!TIP.containsMatchIn(line.trim())) above.addFirst(line.trim())
                blank = false
            }
            i--
        }
        return above.joinToString("\n")
    }

    /** The kinds of blocked agent that wait on a numbered menu. */
    val KINDS = setOf("permission", "question")
    /** No cap on a question's answers: the terminal screen has room for all of them, unlike a notification. */
    const val ALL = Int.MAX_VALUE

    /** A key hint after an option, as Codex draws them: "Yes, proceed (y)", "No, and tell Codex what to do differently (esc)". */
    private val HINT = Regex("""\s*\((?:esc|enter|tab|shift\+tab|[a-z])\)\s*$""", RegexOption.IGNORE_CASE)
    private fun plain(label: String) = label.replace(HINT, "").trim()
    /** The one-time Yes: Claude Code's "Yes", Codex's "Yes, proceed" and "Yes, just this once". */
    private fun isYes(label: String) = plain(label).lowercase() in setOf("yes", "yes, proceed", "yes, just this once")
    private fun isNo(label: String) = plain(label).let { it.equals("No", true) || it.startsWith("No,", true) || it.startsWith("No ", true) }
    private val ALWAYS = Regex("""\b(?:don['’]t|do not) ask again\b|\balways allow\b|\bin the future\b""", RegexOption.IGNORE_CASE)

    /**
     * A Yes that also stops the agent asking again: Claude Code's "Yes, and don't ask again for …" and "Yes, and always
     * allow access to …", Codex's "Yes, and don't ask again for …" and "Yes, and allow this host in the future". Never a
     * mode change ("Yes, and switch to auto mode", "Yes, allow all edits during this session (shift+tab)").
     */
    fun isAlways(label: String) = plain(label).let { it.startsWith("Yes", true) && ALWAYS.containsMatchIn(it) && !it.contains("mode", true) }

    /** What an always option covers, for the notification's text: "don't ask again for npm test commands in this project". */
    fun scope(label: String) = plain(label).replace(Regex("""^Yes,\s*(?:and\s+)?""", RegexOption.IGNORE_CASE), "")

    /**
     * The buttons for a [kind] of prompt: a permission gets its Yes, its "don't ask again" option when it has one
     * ([isAlways]), and its No, in that order; never a mode change, and nothing at all without both a Yes and a No. A
     * question gets up to [limit] of its own answers (not "Type something" or "Chat about this").
     */
    fun choices(kind: String, menu: Menu?, limit: Int = 3): List<Choice> {
        menu ?: return emptyList()
        val all = menu.options.mapIndexed { i, label -> Choice(i, label) }
        return when (kind) {
            "permission" -> {
                val yes = all.firstOrNull { isYes(it.label) }
                val no = all.lastOrNull { isNo(it.label) }
                if (yes == null || no == null) emptyList()
                else listOfNotNull(yes, all.firstOrNull { it.index != yes.index && it.index != no.index && isAlways(it.label) }?.copy(always = true), no)
            }
            "question" -> all.filter { c -> FREE_TEXT.none { c.label.lowercase().startsWith(it) } }.take(limit)
            else -> emptyList()
        }
    }

    /** The keys that move from the menu's cursor to [index] and pick it. */
    fun keys(menu: Menu, index: Int): List<String> {
        require(index in menu.options.indices)
        val step = index - menu.cursor
        return List(kotlin.math.abs(step)) { if (step > 0) "down" else "up" } + "enter"
    }

    /** The menu still on screen is the one the button was made from (same options in the same order). */
    fun unchanged(then: List<String>, now: Menu?) = now != null && now.options == then

    /**
     * The prompt above that menu still reads as it did when the button was made, its lines compared as words: a line
     * re-wrapped at the phone's width is the same dialog. A blank capture on either side never matches, not even
     * against another blank, because then there is no text to compare.
     */
    fun sameDialog(then: String, now: Menu?): Boolean {
        if (now == null) return false
        val before = then.trim().replace(SPACE, " ")
        val after = now.dialog.trim().replace(SPACE, " ")
        return before.isNotEmpty() && after.isNotEmpty() && before == after
    }

    /** Nothing was pressed because the dialog on screen is no longer the one the button was made from. */
    const val CHANGED = "Answered elsewhere or changed; look again"
    /** Nothing was pressed because the dialog above the menu was blank on one side, so there was no text to check. */
    const val NOT_READABLE = "Pocket can't read this dialog; open the agent to answer"

    /**
     * A tapped option, through [call] (the core's terminal.get, terminal.read and terminal.keys): the agent is read
     * again first, and nothing is pressed unless it still asks [msg] with the same [options] and the same [dialog]
     * text above them. Then it is read back: "You chose" only once the prompt went (not blocked any more, or another
     * turn or question), else [Chat.NOT_TAKEN] after [verifyMs] (a key herdr-core reports typed can still leave the
     * prompt there). Returns what to show.
     */
    suspend fun choose(call: suspend (String, JSONObject) -> JSONObject, address: String, msg: String, dialog: String,
                       options: List<String>, index: Int, label: String, verifyMs: Long = VERIFY_MS,
                       pause: suspend (Long) -> Unit = { delay(it) }, clock: () -> Long = System::currentTimeMillis): String {
        val now = CoreTerminal.parse(call("terminal.get", JSONObject().put("terminal", address)))
        if (!now.attention || now.message != msg) return CHANGED
        val menu = menu(call("terminal.read", JSONObject().put("terminal", address).put("lines", 0)).optString("text"))
        if (menu == null) return CHANGED
        if (dialog.isBlank() || menu.dialog.isBlank()) return NOT_READABLE
        if (!sameDialog(dialog, menu)) return CHANGED
        if (!unchanged(options, menu)) return "Not sent: its options changed. Open the agent to answer."
        call("terminal.keys", JSONObject().put("terminal", address).put("keys", JSONArray(keys(menu, index))))
        val deadline = clock() + verifyMs
        while (true) {
            val after = CoreTerminal.parse(call("terminal.get", JSONObject().put("terminal", address)))
            if (!after.attention || after.turn != now.turn || after.message != msg) return "You chose: $label"
            if (clock() >= deadline) return Chat.NOT_TAKEN
            pause(250)
        }
    }

    /** How long after the keys [choose] watches for the prompt to go, as the bridge's approve.js VERIFY_MS. */
    const val VERIFY_MS = 5_000L
}
