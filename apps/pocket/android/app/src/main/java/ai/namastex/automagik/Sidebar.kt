package ai.namastex.automagik

import org.json.JSONObject

/** One entry of Herdr desktop's program table (assets/programs.json): what a terminal runs, and its icon. */
data class Program(val key: String, val name: String, val icon: String, val tint: Boolean)

/** Herdr desktop's program table and its rules for naming what a terminal runs. */
class Programs(table: JSONObject) {
    private val shells = table.optJSONArray("shells")?.let { a -> (0 until a.length()).map { a.getString(it) } }.orEmpty().toSet()
    private val interpreters = table.optJSONArray("interpreters")?.let { a -> (0 until a.length()).map { a.getString(it) } }.orEmpty().toSet()
    private val byKey = LinkedHashMap<String, Program>()
    private val byAlias = HashMap<String, Program>()
    init {
        val programs = table.optJSONObject("programs") ?: JSONObject()
        for (key in programs.keys()) {
            val p = programs.getJSONObject(key)
            val program = Program(key, p.optString("name", key), p.optString("icon"), p.optBoolean("tint", true))
            byKey[key] = program
            for (field in listOf("run", "match")) p.optJSONArray(field)?.let { a -> for (i in 0 until a.length()) byAlias.putIfAbsent(a.getString(i), program) }
        }
    }
    private fun find(name: String) = byKey[name] ?: byAlias[name]
    val agent get() = byKey["agent"] ?: Program("agent", "Agent", "icons/agent.svg", true)
    val shell get() = byKey["shell"] ?: Program("shell", "Shell", "icons/shell.svg", true)
    val program get() = byKey["program"] ?: Program("program", "Program", "icons/program.svg", true)

    /** The agent's own report wins; otherwise what it runs, looking through interpreters and wrappers.
     *  As on the desktop, a shell or an unlisted program is named by its process ("zsh", "my-tool"). */
    fun of(t: CoreTerminal): Program {
        if (t.app.isNotBlank()) return find(t.app) ?: agent
        val command = command(t.argv) ?: return program
        return if (command in shells) shell.copy(name = command)
            else find(command) ?: find(command.substringBefore('.')) ?: program.copy(name = command)
    }

    /** The command an argv runs: past `env NAME=v`, `sudo`, `node`, `sh -c '"$@"' sh cmd` and the like. */
    fun command(argv: List<String>): String? {
        var rest = argv.map { it.substringAfterLast('/') }.zip(argv)
        while (rest.isNotEmpty()) {
            val (name, _) = rest.first()
            when {
                name.contains('=') && !name.startsWith("-") -> rest = rest.drop(1)
                name in shells && rest.getOrNull(1)?.first == "-c" && rest.getOrNull(2)?.second == "\"\$@\"" -> rest = rest.drop(4)
                name in interpreters -> rest = rest.drop(1).dropWhile { it.first.startsWith("-") }
                else -> return name.ifBlank { null }
            }
        }
        return argv.firstOrNull()?.substringAfterLast('/')?.ifBlank { null }
    }
}

/** A row of the drawer, as Herdr desktop's spaces-agents sidebar draws it. Keys are unique even when a terminal shows twice. */
sealed interface SidebarRow { val key: String }
data class MachineHeaderRow(override val key: String, val hostId: String, val machine: String, val title: String,
    val connected: Boolean, val state: String, val folded: Boolean) : SidebarRow
/** [tail] is the desktop's repo · branch text, with [ahead]/[behind] beside it; a [nested] worktree draws a branch glyph. */
data class SpaceRow(override val key: String, val hostId: String, val space: PocketSpace, val letter: String, val color: String,
    val nested: Boolean, val tail: String = "", val ahead: Int = 0, val behind: Int = 0,
    /** Line 2: the space's project in its machine's Space Row feed; null for nested worktrees and projects the feed lacks. */
    val stats: SpaceStats? = null) : SidebarRow
data class AgentRow(override val key: String, val hostId: String, val terminal: CoreTerminal, val label: String, val program: Program,
    val status: String, val machineLabel: String?, val nested: Boolean,
    /** The stats button: a pane labelled `bot=<id>` on a machine whose meter doc has a Space Row feed. */
    val bot: BotStats? = null,
    /** A bot of the project's tree ([BotTree]): its id, and its depth (0 the main bot, 1 its direct reports, 2+ members). */
    val botId: String? = null, val depth: Int = 0) : SidebarRow
data class KidRow(override val key: String, val hostId: String, val terminal: CoreTerminal, val label: String, val program: Program,
    val status: String, val lines: List<String>, val nested: Boolean, val bot: BotStats? = null,
    /** Under a bot of the tree: that bot's depth, so the helper sits beneath it. */
    val depth: Int = 0) : SidebarRow
/** A category header of a project's bot tree, in bots.json order (desktop visibleRows "category"). */
data class CategoryRow(override val key: String, val hostId: String, val id: String, val title: String, val nested: Boolean) : SidebarRow
/** A bot of the tree with no live pane: the desktop draws it asleep (or planned); there is no terminal to open. */
data class SleepingBotRow(override val key: String, val hostId: String, val id: String, val label: String, val depth: Int,
    val nested: Boolean, val planned: Boolean) : SidebarRow

/** A space row's line 2: its project in the feed. */
data class SpaceStats(val feed: SpaceFeed.Feed, val project: SpaceFeed.Project)
/** A bot row's card: [bot] is null when the feed has no figures for it (every cell "–"). */
data class BotStats(val id: String, val name: String, val feed: SpaceFeed.Feed, val bot: SpaceFeed.Bot?, val names: SpaceFeed.Names?)

/** What one connection contributes: its spaces (local first in document order, then remote), terminals and machines. */
data class SidebarHost(val hostId: String, val name: String, val connected: Boolean, val spaces: List<PocketSpace>,
    val terminals: List<CoreTerminal>, val machines: List<LinkedMachine>, val colors: Map<String, String> = emptyMap(),
    /** Git answers by [Sidebar.gitKey]; null means not a repository, missing means not known yet. */
    val git: Map<String, GitInfo?> = emptyMap(),
    /** The Space Row feed per machine ("" is the core's own) and bots.json names by "machine|project key". */
    val space: Map<String, SpaceFeed.Feed> = emptyMap(), val bots: Map<String, SpaceFeed.Names> = emptyMap(),
    /** Each project's bots as its registry defines them, by "machine|project key" ([MachineState.members]). */
    val members: Map<String, List<Teams.Member>> = emptyMap())

/**
 * A project's bot tree as Herdr desktop orders it (herdr/mods/am-sidebar rows.js buildTree and rankedTree): the main bot;
 * then its direct reports by category, categories in bots.json order, each category's bots by rank; then the
 * uncategorised by rank. A member nests under its effective lead (model.js effectiveLead). Pure, for the unit tests.
 */
object BotTree {
    /** model.js RANKS: a bot's place among its siblings. */
    val RANKS = listOf("captain", "dev", "tester", "reviewer", "fixer", "integrator", "pm", "owner")
    data class Node(val member: Teams.Member, val members: List<Node>)
    data class Category(val id: String, val title: String, val bots: List<Node>)
    data class Tree(val main: Node?, val categories: List<Category>, val uncategorised: List<Node>)

    /** [categories]: id to title, in bots.json order. */
    fun build(bots: List<Teams.Member>, categories: Map<String, String>): Tree {
        val main = bots.firstOrNull { it.main }
        val leads = bots.associate { it.id to effectiveLead(bots, it) }
        val placed = HashSet<String>()
        fun node(b: Teams.Member): Node {
            placed += b.id
            val members = if (b.planned) emptyList()
                else bots.filter { it.id !in placed && it !== main && leads[it.id] == b.id }.map(::node)
            return Node(b, members)
        }
        // No main bot: every bot at the top, nothing nested.
        if (main == null) return Tree(null, emptyList(), byRank(bots.map { node(it).copy(members = emptyList()) }))
        placed += main.id
        val direct = bots.filter { it !== main && leads[it.id] == main.id }
        val grouped = categories.map { (id, title) -> Category(id, title, direct.filter { it.category == id && it.id !in placed }.map(::node)) }
            .filter { it.bots.isNotEmpty() }
        val uncategorised = direct.filter { it.id !in placed }.map(::node)
        return Tree(node(main).copy(members = emptyList()), grouped.map { it.copy(bots = byRank(it.bots)) }, byRank(uncategorised))
    }

    /** Whom [bot] reports to: its lead, else the main bot; a lead missing, planned, a main bot or a cycle back is the main bot. */
    fun effectiveLead(bots: List<Teams.Member>, bot: Teams.Member): String {
        val main = bots.firstOrNull { it.main } ?: return ""
        if (bot === main) return ""
        val byId = bots.associateBy { it.id }
        fun leadOf(b: Teams.Member) = b.lead ?: main.id
        val first = leadOf(bot)
        if (first == main.id) return main.id
        val target = byId[first] ?: return main.id
        if (target.planned || target.main) return main.id
        val seen = hashSetOf(bot.id)
        var cur: Teams.Member? = target
        while (cur != null && cur !== main && !cur.main && !cur.planned) {
            if (cur.id in seen) return if (cur.id == bot.id) main.id else first
            seen += cur.id
            cur = byId[leadOf(cur)]
        }
        return first
    }

    // Captains (a rank, or no rank and a team) first, then by rank, then the unranked; file order within each (rows.js byRank).
    private fun rankOf(n: Node) = n.member.rank?.let { RANKS.indexOf(it) } ?: if (n.members.isNotEmpty()) 0 else RANKS.size
    fun byRank(nodes: List<Node>): List<Node> = nodes.withIndex().sortedWith(compareBy<IndexedValue<Node>>({ rankOf(it.value) }, { it.index }))
        .map { it.value.copy(members = byRank(it.value.members)) }

    /** One line of the drawn tree, every bot open: a bot at its depth, a category header, or where a bot's helpers go. */
    sealed interface Entry
    data class Bot(val member: Teams.Member, val depth: Int) : Entry
    data class Header(val id: String, val title: String) : Entry
    data class Helpers(val member: Teams.Member, val depth: Int) : Entry

    /** visibleRows with every fold open: each bot, then its members, then its helpers; the main bot's helpers come last. */
    fun entries(tree: Tree): List<Entry> {
        val out = mutableListOf<Entry>()
        fun bot(n: Node, depth: Int) {
            out += Bot(n.member, depth)
            if (n.member.planned) return
            n.members.forEach { bot(it, depth + 1) }
            out += Helpers(n.member, depth)
        }
        val main = tree.main
        if (main == null) { tree.uncategorised.forEach { bot(it, 0) }; return out }
        out += Bot(main.member, 0)
        for (c in tree.categories) { out += Header(c.id, c.title); c.bots.forEach { bot(it, 1) } }
        tree.uncategorised.forEach { bot(it, 1) }
        out += Helpers(main.member, 0)
        return out
    }
}

object Sidebar {
    /** Herdr desktop's avatar palette (spaces-agents MARK), by the space.colors names it stores. */
    val MARK = linkedMapOf("ansi6" to 0xff22a99a, "ansi3" to 0xffe3814f, "ansi4" to 0xff5b8def,
        "ansi5" to 0xff8b7cf6, "ansi2" to 0xff3fae6a, "ansi1" to 0xffd9649a)

    fun rows(hosts: List<SidebarHost>, programs: Programs, folded: Set<String> = emptySet()): List<SidebarRow> {
        val out = mutableListOf<SidebarRow>()
        for (host in hosts) {
            val remotes = (host.spaces.map { it.machine } + host.machines.map { it.name }).filter { it.isNotBlank() }.distinct().sorted()
            // Desktop draws machine headers only once another machine is known; the phone also needs them to tell hosts apart.
            val headers = remotes.isNotEmpty() || hosts.size > 1
            val byAddress = host.terminals.associateBy { it.address }
            fun info(machine: String, space: PocketSpace) = host.git[gitKey(machine, place(space, byAddress))]
            val groups = (listOf("") + remotes).associateWith { machine ->
                GitInfo.ordered(host.spaces.filter { it.machine == machine }) { info(machine, it) }
            }
            // Each project's bot tree sits under its first space in sidebar order (rows.js placeTrees); a terminal a tree
            // holds (a bot's pane or its helpers) is not listed again as a space's agent.
            val trees = trees(host, groups, programs) { machine, space -> info(machine, space) }
            val held = trees.values.flatMap { (_, rows) -> rows }.mapNotNull { r -> (r as? AgentRow)?.terminal?.address ?: (r as? KidRow)?.terminal?.address }.toSet()
            for ((machine, ordered) in groups) {
                val foldKey = "${host.hostId}|$machine"
                val linked = host.machines.find { it.name == machine }
                if (headers) out += MachineHeaderRow("m:$foldKey", host.hostId, machine, if (machine.isBlank()) host.name else machine,
                    if (machine.isBlank()) host.connected else host.connected && linked?.connected == true,
                    if (machine.isBlank()) "" else linked?.state?.replace('_', ' ')?.ifBlank { null } ?: "asleep", foldKey in folded)
                if (headers && foldKey in folded) continue
                for ((space, nested) in ordered) {
                    val git = info(machine, space)
                    // The machine's own feed, by the space's project key; a worktree maps to its main checkout's project.
                    val feed = host.space[machine]
                    val project = SpaceFeed.projectKey(git)
                    val stats = feed?.project(project)?.takeIf { !nested }?.let { SpaceStats(feed, it) }
                    out += SpaceRow("s:${host.hostId}:${space.id}", host.hostId, space, letter(space.name), host.colors[space.id] ?: "ansi6", nested,
                        git?.tail(space.name, nested).orEmpty(), git?.ahead ?: 0, git?.behind ?: 0, stats)
                    trees.values.find { it.first == space.id }?.let { out += it.second }
                    val bot = { t: CoreTerminal -> feed?.let { f -> botStats(t, f, project, host.bots["$machine|$project"]) } }
                    agents(host, space, programs, nested, out, bot, held)
                }
            }
        }
        return out
    }

    /** Each project with a registry: the space its tree is drawn under, and the tree's rows (every bot open). */
    private fun trees(host: SidebarHost, groups: Map<String, List<Pair<PocketSpace, Boolean>>>, programs: Programs,
                      info: (String, PocketSpace) -> GitInfo?): Map<String, Pair<String, List<SidebarRow>>> {
        val known = host.members.values.flatten().map { it.id }.toSet()
        val placed = LinkedHashMap<String, Pair<String, List<SidebarRow>>>()
        for ((machine, ordered) in groups) for ((space, nested) in ordered) {
            val project = SpaceFeed.projectKey(info(machine, space)) ?: continue
            val where = "$machine|$project"
            val bots = host.members[where].orEmpty()
            if (where in placed || bots.isEmpty()) continue
            val tree = BotTree.build(bots, host.bots[where]?.categories.orEmpty())
            val feed = host.space[machine]
            // A bot's pane: a live terminal on the project's machine labelled with its id, the most urgent if several (as Team).
            fun pane(id: String) = host.terminals.filter { it.live && it.labels["bot"]?.trim() == id && it.address.substringBefore('/', "") == machine }
                .minByOrNull { Teams.urgency(Teams.poseOf(it, 0L)) }
            val rows = mutableListOf<SidebarRow>()
            val prefix = "${host.hostId}:$where"
            for (e in BotTree.entries(tree)) when (e) {
                is BotTree.Header -> rows += CategoryRow("c:$prefix:${e.id}", host.hostId, e.id, e.title, nested)
                is BotTree.Bot -> {
                    val t = pane(e.member.id)
                    rows += if (t == null) SleepingBotRow("b:$prefix:${e.member.id}", host.hostId, e.member.id, e.member.name, e.depth, nested, e.member.planned)
                        else AgentRow("b:$prefix:${e.member.id}", host.hostId, t, e.member.name, programs.of(t), agentStatus(t),
                            t.address.substringBefore('/', "").ifBlank { null }, nested, feed?.let { botStats(t, it, project, host.bots[where]) },
                            e.member.id, e.depth)
                }
                is BotTree.Helpers -> pane(e.member.id)?.let { t ->
                    kids(host, t.address, emptyList(), "b:$prefix:${e.member.id}", programs, nested, rows, setOf(t.address),
                        skip = { it.labels["bot"]?.trim() in known }, depth = e.depth)
                }
            }
            placed[where] = space.id to rows
        }
        return placed
    }

    /** The terminal a row opens; null for headers, categories and bots with no pane. */
    fun refOf(row: SidebarRow): TerminalRef? = when (row) {
        is AgentRow -> TerminalRef(row.hostId, row.terminal.address)
        is KidRow -> TerminalRef(row.hostId, row.terminal.address)
        else -> null
    }

    /** The agents drawn in the same space as [ref]'s first row, in the tree's order: from its space row to the next. */
    fun spaceAgents(rows: List<SidebarRow>, ref: TerminalRef): List<TerminalRef> {
        val at = rows.indexOfFirst { refOf(it) == ref }
        if (at < 0) return emptyList()
        var start = at
        while (start > 0 && rows[start] !is SpaceRow && rows[start] !is MachineHeaderRow) start--
        var end = at
        while (end + 1 < rows.size && rows[end + 1] !is SpaceRow && rows[end + 1] !is MachineHeaderRow) end++
        return rows.subList(start, end + 1).mapNotNull(::refOf).distinct()
    }

    /** The terminal strip: [spaceAgents] with the names the drawer gives them. */
    fun strip(rows: List<SidebarRow>, ref: TerminalRef): List<Pair<TerminalRef, String>> = spaceAgents(rows, ref).map { r ->
        r to when (val row = rows.first { refOf(it) == r }) { is AgentRow -> row.label; is KidRow -> row.label; else -> r.address }
    }

    /** A swipe: the agent [step] places along [ref] in its space, or null past either end (never into another space). */
    fun neighbour(rows: List<SidebarRow>, ref: TerminalRef, step: Int): TerminalRef? {
        val agents = spaceAgents(rows, ref)
        val i = agents.indexOf(ref)
        return if (i < 0) null else agents.getOrNull(i + step)
    }

    /**
     * Code's Tasks filter: only the rows that open an agent in [refs] (the agents on a task branch), with the machine,
     * space and category above each kept one; everything else goes.
     */
    fun only(rows: List<SidebarRow>, refs: Set<TerminalRef>): List<SidebarRow> {
        val out = mutableListOf<SidebarRow>()
        var machine: SidebarRow? = null; var space: SidebarRow? = null; var category: SidebarRow? = null
        for (row in rows) when (row) {
            is MachineHeaderRow -> { machine = row; space = null; category = null }
            is SpaceRow -> { space = row; category = null }
            is CategoryRow -> category = row
            else -> if (refOf(row)?.let { it in refs } == true) {
                listOfNotNull(machine, space, category).forEach { out += it }
                machine = null; space = null; category = null
                out += row
            }
        }
        return out
    }

    fun letter(name: String) = name.firstOrNull()?.uppercase() ?: "?"

    /** Where git runs for a space: the first of its terminals with a working directory, else the space's folder. */
    fun place(space: PocketSpace, byAddress: Map<String, CoreTerminal>): String =
        space.tabs.flatMap { it.terminals }.firstNotNullOfOrNull { byAddress[it]?.cwd?.ifBlank { null } } ?: space.folder
    fun gitKey(machine: String, place: String) = "$machine|$place"

    // agents() order: the space's tabs, then panes; plain shells and programs with a pane get no row.
    /** A pane's bot card, when it carries a `bot=<id>` label (desktop BOT_LABEL); a bot the feed lacks has every field null. */
    fun botStats(t: CoreTerminal, feed: SpaceFeed.Feed, project: String?, names: SpaceFeed.Names?): BotStats? {
        val id = t.labels["bot"]?.trim()?.ifBlank { null } ?: return null
        return BotStats(id, names?.bots?.get(id) ?: id, feed, feed.project(project)?.bots?.get(id), names)
    }

    private fun agents(host: SidebarHost, space: PocketSpace, programs: Programs, nested: Boolean, out: MutableList<SidebarRow>,
                       bot: (CoreTerminal) -> BotStats? = { null }, held: Set<String> = emptySet()) {
        val byAddress = host.terminals.associateBy { it.address }
        data class Candidate(val terminal: CoreTerminal, val tab: PocketTab, val program: Program)
        val candidates = space.tabs.flatMap { tab ->
            tab.terminals.mapNotNull { byAddress[it] }.filter { it.live && it.address !in held }.map { Candidate(it, tab, programs.of(it)) }
                .filter { it.terminal.status.isNotBlank() || it.program.key == "hermes" }
        }
        val labels = candidates.map { c -> label(c.tab, lead(c.tab, byAddress, programs), programs) }
        val details = labels.map { if (it.isNumeric()) null else it }
        val seen = details.groupingBy { it.orEmpty() }.eachCount()
        candidates.forEachIndexed { i, c ->
            var detail = details[i]
            if (detail == null && (seen[""] ?: 0) > 1) detail = labels[i]
            val ownTitle = clean(c.terminal.rawTitle)
            if (detail != null && ownTitle.isNotBlank() && (seen[detail] ?: 0) > 1) detail = ownTitle
            val name = detail ?: if (labels[i].isNumeric()) c.program.name.ifBlank { labels[i] } else labels[i]
            val path = "a:${host.hostId}:${space.id}:${c.tab.id}:${c.terminal.address}"
            out += AgentRow(path, host.hostId, c.terminal, name, c.program, agentStatus(c.terminal),
                c.terminal.address.substringBefore('/', "").ifBlank { null }, nested, bot(c.terminal))
            kids(host, c.terminal.address, emptyList(), path, programs, nested, out, setOf(c.terminal.address), bot, skip = { it.address in held })
        }
    }

    // Every live terminal started by this one, on any machine, depth first, in core order.
    private fun kids(host: SidebarHost, parent: String, lines: List<String>, path: String, programs: Programs, nested: Boolean,
                     out: MutableList<SidebarRow>, ancestors: Set<String>, bot: (CoreTerminal) -> BotStats? = { null },
                     skip: (CoreTerminal) -> Boolean = { false }, depth: Int = 0) {
        if (lines.size >= 8) return
        val children = host.terminals.filter { it.live && it.address !in ancestors && isChild(it, parent) && !skip(it) }
        children.forEachIndexed { i, k ->
            val last = i == children.lastIndex
            val program = programs.of(k)
            val key = "$path>${k.address}"
            out += KidRow(key, host.hostId, k, k.hcName.ifBlank { k.template }.ifBlank { program.name }.ifBlank { k.address },
                program, kidStatus(k.status), lines + if (last) "└" else "├", nested, bot(k), depth)
            kids(host, k.address, lines + if (last) "" else "│", key, programs, nested, out, ancestors + k.address, bot, skip, depth)
        }
    }

    // A parent is recorded relative to the child's machine; addresses here are qualified by machine.
    private fun isChild(t: CoreTerminal, parent: String): Boolean {
        if (t.parent.isBlank()) return false
        if (t.parent == parent) return true
        val machine = t.address.substringBefore('/', "")
        return machine.isNotBlank() && "$machine/${t.parent}" == parent && !t.parent.contains('/')
    }

    private fun lead(tab: PocketTab, byAddress: Map<String, CoreTerminal>, programs: Programs): Pair<CoreTerminal, Program>? {
        val terminals = tab.terminals.mapNotNull { byAddress[it] }
        val agent = terminals.firstOrNull { it.status.isNotBlank() || it.app.isNotBlank() } ?: terminals.firstOrNull() ?: return null
        return agent to programs.of(agent)
    }

    private fun label(tab: PocketTab, lead: Pair<CoreTerminal, Program>?, programs: Programs): String {
        val (terminal, program) = lead ?: return tab.name
        val live = clean(terminal.rawTitle)
        val telling = live.isNotBlank() && live != program.name && !Regex("""^[~/]|^[A-Za-z]:\\""").containsMatchIn(live) &&
            '@' !in live && live.lowercase() != program.key
        return if (tab.name == program.name && telling) live else tab.name
    }

    /** A title without leading decoration (spinners, bullets), as desktop's clean(). */
    fun clean(title: String) = title.dropWhile { !it.isLetterOrDigit() }.trim()

    private fun String.isNumeric() = isNotEmpty() && all { it.isDigit() }
    fun agentStatus(t: CoreTerminal) = when (t.status) { "error" -> "blocked"; "" -> if (programsHermes(t)) "unknown" else ""; else -> t.status }
    private fun programsHermes(t: CoreTerminal) = t.app.isBlank() && t.argv.any { it.substringAfterLast('/') == "hermes" }
    /** Sub-agents never show the finished dot: their done reads as idle, an error as needing you. */
    fun kidStatus(status: String) = when (status) { "error" -> "blocked"; "done" -> "idle"; else -> status }
}
