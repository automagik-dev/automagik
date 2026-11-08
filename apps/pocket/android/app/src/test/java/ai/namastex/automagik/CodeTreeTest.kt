package ai.namastex.automagik

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/** Code's drawer and swipe: the desktop's bot tree, by category, on the desktop's own recorded fixture. */
class CodeTreeTest {
    private val programs = Programs(JSONObject(File("src/main/assets/programs.json").readText()))

    /** A file of the monorepo, found from Gradle's working directory (the app module) upwards. */
    private fun repoFile(path: String): File {
        var dir: File? = File(System.getProperty("user.dir")).absoluteFile
        while (dir != null) {
            val f = File(dir, path)
            if (f.exists()) return f
            dir = dir.parentFile
        }
        error("$path not found above ${System.getProperty("user.dir")}")
    }

    private fun JSONObject.str(k: String) = if (isNull(k)) "" else optString(k, "")
    private fun JSONArray.objs() = (0 until length()).map { getJSONObject(it) }

    /** herdr/test/fixtures/sidebar/owner-2026-11-02.json as the phone reads a core: one host, git and registries per project. */
    private fun fixtureHost(state: JSONObject): SidebarHost {
        val terminals = state.getJSONArray("terminals").objs().map { t ->
            val labels = t.optJSONObject("labels")?.let { o -> o.keys().asSequence().associateWith { o.getString(it) } }.orEmpty()
            CoreTerminal(t.getString("address"), t.str("name").ifBlank { t.getString("address") }, t.str("cwd"), t.str("state"),
                t.str("status"), t.str("agent"), "", 80, 24, labels, hcName = t.str("name"), app = t.str("agent"), parent = t.str("parent"))
        }
        val spaces = state.getJSONArray("spaces").objs().map { s ->
            PocketSpace(s.getString("id"), s.str("name"), s.str("folder"), s.str("machine"),
                s.getJSONArray("tabs").objs().map { tab -> PocketTab(tab.getString("id"), tab.str("name"), tab.getJSONArray("panes").objs().map { it.getString("terminal") }) })
        }
        val byAddress = terminals.associateBy { it.address }
        val git = HashMap<String, GitInfo?>()
        val members = HashMap<String, List<Teams.Member>>()
        val names = HashMap<String, SpaceFeed.Names>()
        for (p in state.getJSONArray("projects").objs()) {
            val machine = p.str("machine"); val key = p.getString("key")
            val text = p.getJSONObject("file").toString()
            members["$machine|$key"] = Teams.registry.parse(text)
            names["$machine|$key"] = SpaceFeed.names(text)
            val ids = p.getJSONArray("spaces").let { a -> (0 until a.length()).map { a.getString(it) } }
            for (s in spaces.filter { it.id in ids }) git[Sidebar.gitKey(machine, Sidebar.place(s, byAddress))] = GitInfo("main", 0, 0, key, "$key/.git")
        }
        val machines = spaces.map { it.machine }.filter { it.isNotBlank() }.distinct().map { LinkedMachine(it, "connected") }
        return SidebarHost("mac", "Mac", true, spaces, terminals, machines, git = git, bots = names, members = members)
    }

    /** A space's rows: from its space row to the next space or machine. */
    private fun segment(rows: List<SidebarRow>, spaceId: String): List<SidebarRow> {
        val at = rows.indexOfFirst { it is SpaceRow && it.space.id == spaceId }
        if (at < 0) return emptyList()
        val end = (at + 1 until rows.size).firstOrNull { rows[it] is SpaceRow || rows[it] is MachineHeaderRow } ?: rows.size
        return rows.subList(at + 1, end)
    }

    /** The phone's rows as the desktop's golden writes them under its default folds: members and their helpers folded. */
    private fun asGolden(rows: List<SidebarRow>): List<String> {
        val main = rows.firstNotNullOfOrNull { r -> (r as? AgentRow)?.takeIf { it.depth == 0 && it.botId != null }?.key
            ?: (r as? SleepingBotRow)?.takeIf { it.depth == 0 }?.key }
        return rows.mapNotNull { r ->
            when {
                r is CategoryRow -> "category ${r.id}"
                r is AgentRow && r.botId != null && r.depth <= 1 -> "${if (r.depth == 0) "main" else "bot"} b:${r.botId}"
                r is SleepingBotRow && r.depth <= 1 -> "${if (r.depth == 0) "main" else "bot"} b:${r.id}"
                r is KidRow && main != null && r.key.substringBefore('>') == main -> "helper h:${r.terminal.address}"
                else -> null
            }
        }
    }

    @Test fun treeMatchesTheDesktopCategoryOrderOnItsFixture() {
        val dir = "herdr/test/fixtures/sidebar"
        val state = JSONObject(repoFile("$dir/owner-2026-11-02.json").readText())
        val golden = JSONObject(repoFile("$dir/owner-2026-11-02.golden.json").readText()).getJSONObject("rows")
        val rows = Sidebar.rows(listOf(fixtureHost(state)), programs)
        val tree = setOf("main", "category", "bot", "helper")
        var categories = 0
        for (id in golden.keys()) {
            // The golden's category fold id is c:<project id>:<category id>; the phone keeps the category id.
            val want = golden.getJSONObject(id).getJSONArray("rows").let { a -> (0 until a.length()).map { a.getString(it) } }
                .filter { it.substringBefore(' ') in tree }
                .map { if (it.startsWith("category ")) "category ${it.substringAfterLast(':')}" else it }
            categories += want.count { it.startsWith("category ") }
            assertEquals("space $id", want, asGolden(segment(rows, id)))
        }
        assertEquals(7, categories)
    }

    @Test fun membersNestUnderTheirLeadByRank() {
        val state = JSONObject(repoFile("herdr/test/fixtures/sidebar/owner-2026-11-02.json").readText())
        val rows = segment(Sidebar.rows(listOf(fixtureHost(state)), programs), "sp9d7f2575f71a6dbb5b4f6c790c55476b")
        fun depthOf(id: String) = rows.firstNotNullOf { r -> (r as? AgentRow)?.takeIf { it.botId == id }?.depth ?: (r as? SleepingBotRow)?.takeIf { it.id == id }?.depth }
        fun at(id: String) = rows.indexOfFirst { (it as? AgentRow)?.botId == id || (it as? SleepingBotRow)?.id == id }
        // Category 2's first captain, then its dev and its tester (rank order), before the second captain.
        val captain = at("b-gegmsi4sec")
        assertEquals(listOf(captain + 1, captain + 2), listOf(at("b-plef7q3ayj"), at("b-xexf7el22b")))
        assertTrue(at("b-plef7q3ayj") < at("b-xexf7el22b") && at("b-xexf7el22b") < at("b-x6kmwlno5n"))
        assertEquals(listOf(1, 2, 2), listOf(depthOf("b-gegmsi4sec"), depthOf("b-plef7q3ayj"), depthOf("b-xexf7el22b")))
    }

    @Test fun rankOrdersSiblingsAndALeadMissingFallsBackToTheMainBot() {
        fun m(id: String, rank: String? = null, lead: String? = null, category: String? = null, main: Boolean = false) =
            Teams.Member(id, id, main, null, category, lead, rank)
        val bots = listOf(m("main", main = true), m("pm", "pm", category = "a"), m("dev", "dev", category = "a"),
            m("solo", category = "a"), m("cap", category = "b"), m("cap-dev", "dev", lead = "cap"), m("lost", lead = "gone"))
        val tree = BotTree.build(bots, linkedMapOf("b" to "B", "a" to "A"))
        assertEquals(listOf("b", "a"), tree.categories.map { it.id })
        assertEquals(listOf("dev", "pm", "solo"), tree.categories[1].bots.map { it.member.id })
        assertEquals(listOf("cap-dev"), tree.categories[0].bots.single().members.map { it.member.id })
        assertEquals(listOf("lost"), tree.uncategorised.map { it.member.id })
    }

    // ---- swipe and the Tasks filter, on a synthetic host

    private fun t(address: String, status: String, parent: String = "", bot: String? = null) =
        CoreTerminal(address, address, "/w/a", "live", status, "claude-code", "", 80, 24, bot?.let { mapOf("bot" to it) }.orEmpty(),
            app = "claude-code", parent = parent)
    private val host = SidebarHost("mac", "Mac", true,
        listOf(PocketSpace("sa", "A", "/w/a", "", listOf(PocketTab("ta", "one", listOf("t0", "t1")), PocketTab("tb", "two", listOf("t2")))),
            PocketSpace("sb", "B", "/w/b", "", listOf(PocketTab("tc", "three", listOf("t4"))))),
        listOf(t("t0", "idle", bot = "b-main"), t("t1", "working"), t("t3", "blocked", parent = "t1"), t("t2", "done"), t("t4", "working")),
        emptyList(), git = mapOf(Sidebar.gitKey("", "/w/a") to GitInfo("main", 0, 0, "/w/a", "/w/a/.git")),
        members = mapOf("|/w/a" to listOf(Teams.Member("b-main", "Main", true, null))))
    private fun ref(a: String) = TerminalRef("mac", a)

    @Test fun swipeChangesTheSelectedAgentWithinTheSpace() {
        val rows = Sidebar.rows(listOf(host), programs)
        // The bot tree first, then the plain agents with their sub-agents, as the drawer draws space A.
        assertEquals(listOf("t0", "t1", "t3", "t2").map(::ref), Sidebar.spaceAgents(rows, ref("t1")))
        assertEquals(ref("t1"), Sidebar.neighbour(rows, ref("t0"), +1))
        assertEquals(ref("t3"), Sidebar.neighbour(rows, ref("t1"), +1))
        assertEquals(ref("t1"), Sidebar.neighbour(rows, ref("t3"), -1))
        // Past either end stays put: a swipe never leaves the space.
        assertNull(Sidebar.neighbour(rows, ref("t2"), +1))
        assertNull(Sidebar.neighbour(rows, ref("t0"), -1))
        assertNull(Sidebar.neighbour(rows, ref("t4"), +1))
        assertNull(Sidebar.neighbour(rows, ref("nowhere"), +1))
    }

    @Test fun aBotPaneShowsOnceInItsTree() {
        val rows = Sidebar.rows(listOf(host), programs)
        assertEquals(1, rows.count { Sidebar.refOf(it) == ref("t0") })
        assertEquals("Main", rows.filterIsInstance<AgentRow>().single { it.botId == "b-main" }.label)
    }

    @Test fun tasksFilterKeepsOnlyAgentsOnATaskWithTheirSpace() {
        val rows = Sidebar.rows(listOf(host), programs)
        val kept = Sidebar.only(rows, setOf(ref("t3"), ref("t4")))
        assertEquals(listOf("s:sa", "t3", "s:sb", "t4"), kept.map { r -> Sidebar.refOf(r)?.address ?: "s:${(r as SpaceRow).space.id}" })
        assertEquals(emptyList<SidebarRow>(), Sidebar.only(rows, emptySet()))
    }
}
