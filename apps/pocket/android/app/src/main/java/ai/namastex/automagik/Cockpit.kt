package ai.namastex.automagik

/**
 * The home screen: Herdr desktop's agents mod in its priority order (mods/agents/main.js), of which the cockpit
 * shows Needs you, then Done, and keeps Working and Idle one tap away.
 */
object Cockpit {
    const val BLOCKED = 4
    const val DONE = 3
    const val WORKING = 2
    const val IDLE = 1
    private val TITLES = mapOf(BLOCKED to "Needs you", DONE to "Done", WORKING to "Working", IDLE to "Idle")

    /** An agent and its rank; [kids] are sub-agents that need the person and have no row of their own. */
    data class Entry(val ref: TerminalRef, val terminal: CoreTerminal, val rank: Int, val kids: List<Pair<TerminalRef, CoreTerminal>> = emptyList())
    data class Section(val rank: Int, val entries: List<Entry>) {
        val title get() = TITLES.getValue(rank)
    }

    /** The agents mod's word for an agent: error reads as blocked, and done as idle once the person looked at it here. */
    fun status(t: CoreTerminal, seen: Boolean) = when {
        t.status == "error" -> "blocked"
        t.status == "done" && seen -> "idle"
        else -> t.status
    }
    /** A sub-agent's word: never done (it reports to its parent, and the parent's done is the news). */
    fun kidStatus(t: CoreTerminal, seen: Boolean) = status(t, seen).let { if (it == "done") "idle" else it }
    fun rank(status: String) = when (status) { "blocked" -> BLOCKED; "done" -> DONE; "working" -> WORKING; "idle" -> IDLE; else -> 0 }

    /**
     * [terminals] from every machine. Agents are live terminals with a status that the desktop shows in a pane ([paned]),
     * or that have no live parent to report to. A parent ranks as its most urgent sub-agent. Within a rank, the most
     * recent status change comes first. [seen]: the person has looked at this finished turn on the phone.
     */
    fun sections(terminals: List<Pair<TerminalRef, CoreTerminal>>, paned: (TerminalRef) -> Boolean,
                 seen: (TerminalRef, CoreTerminal) -> Boolean): List<Section> {
        val live = terminals.filter { it.second.live }
        val byRef = live.toMap()
        val children = live.filter { it.second.parent.isNotBlank() }.groupBy { (ref, t) -> TerminalRef(ref.hostId, t.parent) }
        fun descendants(ref: TerminalRef, path: Set<TerminalRef> = setOf(ref)): List<Pair<TerminalRef, CoreTerminal>> =
            children[ref].orEmpty().filter { it.first !in path }.flatMap { listOf(it) + descendants(it.first, path + it.first) }
        val agents = live.filter { (ref, t) ->
            t.status.isNotBlank() && (paned(ref) || t.parent.isBlank() || TerminalRef(ref.hostId, t.parent) !in byRef)
        }
        val rows = agents.map { it.first }.toSet()
        val entries = agents.map { (ref, t) ->
            val kids = descendants(ref)
            val kidRanks = kids.map { (r, k) -> rank(kidStatus(k, seen(r, k))) }
            val rank = maxOf(rank(status(t, seen(ref, t))), kidRanks.maxOrNull() ?: 0).coerceAtLeast(IDLE)
            val waiting = if (rank == BLOCKED) kids.filterIndexed { i, (r, _) -> kidRanks[i] == BLOCKED && r !in rows } else emptyList()
            Entry(ref, t, rank, waiting)
        }
        return entries.sortedWith(compareByDescending<Entry> { it.rank }.thenByDescending { it.terminal.statusMs }.thenBy { it.ref.hostId }.thenBy { it.ref.address })
            .groupBy { it.rank }.map { (rank, list) -> Section(rank, list) }
    }

    /** The key a looked-at finished turn is remembered by; a new turn finishing shows as Done again. */
    fun seenKey(ref: TerminalRef, t: CoreTerminal) = seenKey(ref, t.turn)
    fun seenKey(ref: TerminalRef, turn: Long) = "${ref.hostId}|${ref.address}|$turn"

    // ---- The Automagik Bots' `dsh:` chats as Home agents (#732, RFC 0015 D29: one conversation, one row).
    /** What a Bot chat's card says where a terminal's says its program. */
    const val BOT = "Automagik Bot"
    /** A blocked chat on a machine whose Pocket Link or Automagik takes no phone writes: the row says so. */
    const val READ_ONLY = "Read only on the phone: answer on the computer"
    /** A chat row's address on its card: the Session id says nothing to a person. */
    fun addressLabel(ref: TerminalRef) = if (Chat.isDsh(ref.address)) "Bot chat" else ref.address

    /**
     * The chats' share of Home: [agents] are chats with no Herdr pane of their own, rows of their own on Home;
     * [panes] are the panes of Bots that also have a chat, each with the chat's status word and kind, so the pane's
     * row (which opens the chat, [Teams.paneChats]) takes the more urgent of the two and the Bot counts once.
     */
    data class Chats(val agents: List<Pair<TerminalRef, CoreTerminal>> = emptyList(), val panes: Map<TerminalRef, Pair<String, String>> = emptyMap())

    /**
     * Home's agents from the Bots' `dsh:` chats of every read machine ([dsh], by host id, as chat.list gave them):
     * every shown chat (a chat listed `shown: false` opens nothing, so it is no row). The word is [watched]'s
     * ([ChatWatch]), else the row's. A blocked chat's line is what it asks when the row says, else, on a machine that
     * takes no phone writes ([writes]), [READ_ONLY]. A Bot with a labelled pane ([teams], by registry id as
     * [Teams.bubbles] joins them) is its pane's row, in [Chats.panes].
     */
    fun chats(dsh: Map<String, List<Chat.Terminal>>, watched: Map<String, ChatWatch.Watched>, writes: Map<String, Boolean>,
              teams: List<Teams.Team>, now: Long): Chats {
        val agents = mutableListOf<Pair<TerminalRef, CoreTerminal>>()
        val panes = mutableMapOf<TerminalRef, Pair<String, String>>()
        for ((hostId, rows) in dsh) for (c in rows) {
            if (!c.dsh || !c.shown) continue
            val w = watched[ChatWatch.key(hostId, c.terminal)]
            val word = w?.status ?: c.status.takeIf { it == "blocked" || it == "working" } ?: "idle"
            val pane = teams.filter { it.hostId == hostId && !it.stale }.flatMap { it.bots }
                .firstOrNull { b -> b.ref != null && (c.registryId?.let { it == b.id } ?: (c.terminal == Chat.DSH_PREFIX + b.id)) }?.ref
            if (pane != null) { panes[pane] = word to c.kind; continue }
            val message = when (word) {
                "blocked" -> c.msg.ifBlank { if (writes[hostId] == true) "" else READ_ONLY }
                "done" -> w?.receipt.orEmpty()
                else -> ""
            }
            agents += TerminalRef(hostId, c.terminal) to CoreTerminal(c.terminal, c.title.ifBlank { BOT }, "", "live", word, BOT, message, 0, 0,
                app = "dsh", statusMs = w?.since ?: now, turn = w?.turn ?: 0, kind = if (word == "blocked") c.kind else "")
        }
        return Chats(agents, panes)
    }

    /** [terminals] with each pane in [chats]' panes raised to its chat's word when that is the more urgent. */
    fun raised(terminals: List<Pair<TerminalRef, CoreTerminal>>, chats: Chats): List<Pair<TerminalRef, CoreTerminal>> =
        if (chats.panes.isEmpty()) terminals else terminals.map { (ref, t) ->
            val (word, kind) = chats.panes[ref] ?: return@map ref to t
            if (rank(word) > rank(t.status)) ref to t.copy(status = word, kind = kind) else ref to t
        }
}
