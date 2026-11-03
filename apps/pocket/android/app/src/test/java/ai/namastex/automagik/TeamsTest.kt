package ai.namastex.automagik

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.time.ZoneOffset

class TeamsTest {
    private fun fixture(name: String) = javaClass.getResource("/teams/$name")!!.readText()
    private fun terminal(status: String, live: Boolean = true, statusMs: Long = 0, bot: String? = null) =
        CoreTerminal("t1", "x", "/w", if (live) "live" else "exited", status, "claude-code", "", 80, 24,
            labels = bot?.let { mapOf("bot" to it) } ?: emptyMap(), statusMs = statusMs)

    // ---- state -> pose -> pet row

    @Test fun posesFollowTheDesktopRule() {
        val now = 100 * 60_000L
        assertEquals(Teams.ASLEEP, Teams.poseOf(null, now))
        assertEquals(Teams.ASLEEP, Teams.poseOf(terminal("working", live = false), now))
        assertEquals(Teams.WORKING, Teams.poseOf(terminal("working"), now))
        assertEquals(Teams.NEEDS_YOU, Teams.poseOf(terminal("blocked"), now))
        assertEquals(Teams.FAILED, Teams.poseOf(terminal("error"), now))
        assertEquals(Teams.DONE, Teams.poseOf(terminal("done"), now))
        assertEquals(Teams.IDLE, Teams.poseOf(terminal("idle", statusMs = now - 9 * 60_000L), now))
        assertEquals(Teams.ASLEEP, Teams.poseOf(terminal("idle", statusMs = now - 10 * 60_000L), now))
        // No status time yet: idle with no asleep timer, as on the desktop.
        assertEquals(Teams.IDLE, Teams.poseOf(terminal("idle"), now))
        assertEquals(Teams.IDLE, Teams.poseOf(terminal(""), now))
    }

    @Test fun posesPlayTheirPetRows() {
        assertEquals(Teams.PetRow(null, "running"), Teams.petRow(Teams.WORKING))
        assertEquals(Teams.PetRow("waving", "waiting"), Teams.petRow(Teams.NEEDS_YOU))
        assertEquals(Teams.PetRow(null, "review"), Teams.petRow(Teams.DONE))
        assertEquals(Teams.PetRow(null, "failed"), Teams.petRow(Teams.FAILED))
        assertEquals(Teams.PetRow(null, "sleep"), Teams.petRow(Teams.ASLEEP))
        assertEquals(Teams.PetRow(null, "idle"), Teams.petRow("unknown"))
        assertEquals("jumping", Teams.EVENT_ROWS["merged"])
        // Every row a pose plays is in the atlas (sleep is the strip).
        for (r in Teams.STATE_ROWS.values) for (row in listOfNotNull(r.once, r.row)) assertTrue(row, row == "sleep" || row in PetAtlas.ROWS)
    }

    /** The monorepo's own file: apps/bots-dsh/src/client/<name>, found from wherever Gradle runs the tests. */
    private fun botsDsh(name: String): String {
        var dir: File? = File(System.getProperty("user.dir")).absoluteFile
        while (dir != null) {
            val f = File(dir, "apps/bots-dsh/src/client/$name")
            if (f.isFile) return f.readText()
            dir = dir.parentFile
        }
        error("apps/bots-dsh/src/client/$name not found above ${System.getProperty("user.dir")}")
    }

    @Test fun poseMapMatchesTheBotTeamsPetJs() {
        val js = botsDsh("pet.js")
        val block = js.substringAfter("export const STATE_ROWS = Object.freeze({").substringBefore("\n})")
        val entry = Regex("""'?([\w-]+)'?: Object\.freeze\(\{ (?:once: '([\w-]+)', )?row: '([\w-]+)' \}\)""")
        val fromJs = entry.findAll(block).associate { m -> m.groupValues[1] to Teams.PetRow(m.groupValues[2].ifEmpty { null }, m.groupValues[3]) }
        assertEquals(Teams.STATE_ROWS, fromJs)
        val events = js.substringAfter("export const EVENT_ROWS = Object.freeze({").substringBefore("\n})")
        val fromJsEvents = Regex("""'?([\w-]+)'?: Object\.freeze\(\{ once: '([\w-]+)' \}\)""").findAll(events).associate { it.groupValues[1] to it.groupValues[2] }
        assertEquals(Teams.EVENT_ROWS, fromJsEvents)
    }

    @Test fun atlasRowsMatchTheBotTeamsPoses() {
        val js = botsDsh("pet-poses.js")
        val block = js.substringAfter("export const ROWS = Object.freeze({").substringBefore("\n})")
        fun ms(expr: String): List<Long> = if (expr.startsWith("[")) expr.trim('[', ']').split(',').map { it.trim().toLong() }
            else Regex("""even\((\d+), (\d+), (\d+)\)""").find(expr)!!.destructured.let { (n, a, b) -> List(n.toInt() - 1) { a.toLong() } + b.toLong() }
        val rows = Regex("""'?([\w-]+)'?: \{ row: (\d+), ms: (\[[^\]]*]|even\([^)]*\)) \}""").findAll(block)
            .associate { m -> m.groupValues[1] to PetAtlas.Row(m.groupValues[2].toInt(), ms(m.groupValues[3])) }
        assertEquals(PetAtlas.ROWS, rows)
        assertTrue(js.contains("export const SLEEP = Object.freeze({ ms: Array(${PetAtlas.SLEEP.size}).fill(${PetAtlas.SLEEP.first()}) })"))
        assertTrue(js.contains("export const CELL = Object.freeze({ width: ${PetAtlas.CELL_W}, height: ${PetAtlas.CELL_H}, columns: 8 })"))
    }

    // ---- registry and live state, from synthetic fixtures

    @Test fun registryParsesHerdrBotsJson() {
        val bots = Teams.registry.parse(fixture("bots.json"))
        assertEquals(listOf("b-aaaaaaaaaa", "b-bbbbbbbbbb", "b-cccccccccc", "b-dddddddddd"), bots.map { it.id })
        assertEquals(Teams.Member("b-aaaaaaaaaa", "Lead", main = true, pet = "kitty-blue"), bots[0])
        assertEquals("Builder", bots[1].name)   // the first entry of a repeated id wins
        assertNull(bots[2].pet)                 // no look: Genie
        assertNull(bots[3].pet)                 // a look that isn't one path segment is no pet
        assertEquals("b-dddddddddd", bots[3].name)
        assertEquals(emptyList<Teams.Member>(), Teams.registry.parse("not json"))
        assertEquals(emptyList<Teams.Member>(), Teams.registry.parse(null))
        assertEquals("/work/example/.herdr/bots.json", Teams.registry.path("/work/example/"))
    }

    private fun machine(): MachineState {
        val terminals = JSONObject(fixture("terminals.json")).getJSONArray("terminals").objects().map(CoreTerminal::parse)
        val spaces = listOf(
            PocketSpace("s1", "Example", "/work/example", "", listOf(PocketTab("a", "Main", listOf("t1", "t3", "t5")))),
            PocketSpace("s2", "Example worktree", "/work/example-wt", "", listOf(PocketTab("b", "Wt", listOf("t2")))),
            PocketSpace("s3", "Site", "/work/site", "", listOf(PocketTab("c", "Shell", listOf("t4")))))
        val git = mapOf(
            Sidebar.gitKey("", "/work/example") to GitInfo("dev", 0, 0, "/work/example", "/work/example/.git"),
            Sidebar.gitKey("", "/work/example-wt") to GitInfo("feat/x", 0, 0, "/work/example-wt", "/work/example/.git"),
            Sidebar.gitKey("", "/work/site") to GitInfo("main", 0, 0, "/work/site", "/work/site/.git"))
        return MachineState(connected = true, terminals = terminals, spaces = spaces, git = git,
            members = mapOf("|/work/example" to Teams.registry.parse(fixture("bots.json"))),
            icons = mapOf("s1" to Teams.Icon.Emoji("🧪"), "s2" to Teams.Icon.Emoji("🌲")), colors = mapOf("s1" to "ansi3"))
    }

    @Test fun teamsComeFromSpacesRegistryAndLabelledPanes() {
        val teams = Teams.build(mapOf("h1" to machine()), now = 10_000L)
        // One project per main checkout: the worktree space folds in, and the first space names it and gives its icon.
        assertEquals(listOf("h1||/work/example", "h1||/work/site"), teams.map { it.id })
        val example = teams[0]
        assertEquals("Example", example.name)
        assertEquals(Teams.Icon.Emoji("🧪"), example.icon)
        assertEquals("ansi3", example.color)
        assertEquals(Teams.Icon.Letter, teams[1].icon)
        assertEquals("S", teams[1].letter)
        val bots = example.bots.associateBy { it.id }
        assertEquals(Teams.WORKING, bots.getValue("b-aaaaaaaaaa").pose)
        assertEquals(Teams.NEEDS_YOU, bots.getValue("b-bbbbbbbbbb").pose)
        assertEquals("permission", bots.getValue("b-bbbbbbbbbb").kind)
        assertEquals(TerminalRef("h1", "t2"), bots.getValue("b-bbbbbbbbbb").ref)
        // A registry bot whose only pane has exited is asleep, with no terminal to open.
        assertEquals(Teams.ASLEEP, bots.getValue("b-cccccccccc").pose)
        assertNull(bots.getValue("b-cccccccccc").ref)
        // A labelled pane the registry doesn't list still shows, named by its id.
        assertEquals("b-eeeeeeeeee", bots.getValue("b-eeeeeeeeee").name)
        assertEquals(Teams.DONE, bots.getValue("b-eeeeeeeeee").pose)
        // Rows: needs-you first, then working, done, asleep (two asleep ones by name: "b-dddddddddd" before "Checker").
        assertEquals(listOf("b-bbbbbbbbbb", "b-aaaaaaaaaa", "b-eeeeeeeeee", "b-dddddddddd", "b-cccccccccc"), example.bots.map { it.id })
        assertEquals(1, example.needsYou)
        assertEquals(1, example.working)
        assertEquals(emptyList<Teams.Bot>(), teams[1].bots)
        assertEquals(listOf("b-bbbbbbbbbb"), Teams.deck(teams).map { it.second.id })
    }

    // ---- reorder

    private fun team(id: String, vararg poses: String) = Teams.Team(id, "h", "", id, id, Teams.Icon.Letter, null,
        poses.mapIndexed { i, p -> Teams.Bot("$id-$i", "$id$i", false, null, p, "", i.toLong(), TerminalRef("h", "$id$i"), "") })

    @Test fun projectsThatNeedYouJumpAheadAndTheRestKeepHerdrsOrder() {
        val a = team("a", Teams.WORKING, Teams.WORKING)
        val b = team("b", Teams.IDLE)
        val c = team("c", Teams.NEEDS_YOU)
        val d = team("d", Teams.NEEDS_YOU, Teams.NEEDS_YOU)
        assertEquals(listOf("a", "b"), Teams.order(listOf(a, b)).map { it.id })   // working never reorders
        val after = Teams.order(listOf(a, b, c, d))
        assertEquals(listOf("d", "c", "a", "b"), after.map { it.id })
        assertEquals(listOf("d", "c"), Teams.jumped(listOf("a", "b", "c", "d"), after))
        assertEquals(emptyList<String>(), Teams.jumped(after.map { it.id }, after))
        assertEquals(emptyList<String>(), Teams.jumped(listOf("b", "a"), Teams.order(listOf(a, b))))
    }

    @Test fun allListsEveryBotMostUrgentFirst() {
        val rows = Teams.allRows(listOf(team("a", Teams.IDLE, Teams.WORKING), team("b", Teams.NEEDS_YOU, Teams.ASLEEP)))
        assertEquals(listOf(Teams.NEEDS_YOU, Teams.WORKING, Teams.IDLE, Teams.ASLEEP), rows.map { it.second.pose })
    }

    // ---- icons and colours

    @Test fun iconsFollowHerdrsSpaceIconAndFallBackToTheLetter() {
        assertEquals(Teams.Icon.Emoji("🧠"), Teams.icon(JSONObject("""{"kind":"emoji","char":"🧠"}""")))
        assertEquals(Teams.Icon.Image("space-icons/s1-1.png"), Teams.icon(JSONObject("""{"kind":"image","file":"space-icons/s1-1.png"}""")))
        assertEquals(Teams.Icon.Image("space-icons/old.png"), Teams.icon("space-icons/old.png"))
        assertEquals(Teams.Icon.Letter, Teams.icon(JSONObject("""{"kind":"emoji","char":""}""")))
        assertEquals(Teams.Icon.Letter, Teams.icon(JSONObject("""{"kind":"sticker"}""")))
        assertEquals(Teams.Icon.Letter, Teams.icon(null))
        // The am.* keys win; the old keys count only when the new one isn't there yet.
        val both = Teams.looks(JSONObject("""{"am.sidebar.icons":{"s1":{"kind":"emoji","char":"A"}},"spaces-agents.icons":{"s1":{"kind":"emoji","char":"B"}},
            "space.colors":{"s1":"ansi1"}}"""))
        assertEquals(Teams.Icon.Emoji("A"), both.icons["s1"])
        assertEquals("ansi1", both.colors["s1"])
        assertEquals(Teams.Looks(), Teams.looks(JSONObject("{}")))
        assertTrue(Teams.safeIconFile("space-icons/s1-17.png"))
        assertTrue(!Teams.safeIconFile("space-icons/../shared.json") && !Teams.safeIconFile("/etc/passwd") && !Teams.safeIconFile("space-icons/a/b.png"))
    }

    @Test fun tileColoursAreHerdrsOwn() {
        assertEquals(0x22a99a, Teams.colorRgb(null, dark = true))
        assertEquals(0xe3814f, Teams.colorRgb("ansi3", dark = false))
        assertEquals(0x123456, Teams.colorRgb("#123456", dark = true))
        assertEquals(0xaabbcc, Teams.colorRgb("#abc", dark = true))
        assertNull(Teams.colorRgb("transparent", dark = true))
        assertEquals(SpaceColors.rgb("ansi12", true), Teams.colorRgb("ansi12", dark = true))
    }

    // ---- the strip: null is "–", zero is a number

    @Test fun stripShowsADashForMissingFiguresAndZeroAsZero() {
        val none = Teams.strip(listOf(team("a", Teams.IDLE)), peak = null)
        assertEquals(Teams.Strip(null, null, null), none)
        assertEquals("–", Fmt.count(none.merged))
        assertEquals("–", Fmt.minutes(none.agentMin))
        val some = Teams.strip(listOf(team("a").copy(merged = 7.0, agentMin = 132.0), team("b").copy(merged = 0.0), team("c")), peak = 3)
        assertEquals(Teams.Strip(7.0, 132.0, 3), some)
        assertEquals("2h 12m", Fmt.minutes(some.agentMin))
        assertEquals("0", Fmt.count(Teams.strip(listOf(team("b").copy(merged = 0.0)), 0).merged))
        assertNull(Teams.agentMinutes(null))
        assertNull(Teams.agentMinutes(SpaceFeed.Project(null, null, null, null, null, emptyMap())))
        assertEquals(0.0, Teams.agentMinutes(SpaceFeed.Project(null, null, null, null, null, emptyMap(), emptyList()))!!, 0.0)
        assertEquals(mapOf("a" to 2, "b" to 0, "" to 2), Teams.working(listOf(team("a", Teams.WORKING, Teams.WORKING), team("b", Teams.IDLE))))
    }

    @Test fun feedTasksGiveAgentTimeAndCelebrations() {
        val doc = JSONObject("""{"generated_at":"2026-11-02T18:30:00Z","space":{"version":1,"projects":{"/work/example":{"merges":{"n":2},
            "tasks":[{"task":"gh-1","bots":[{"bot":"b-aaaaaaaaaa","work_min":25},{"bot":"b-bbbbbbbbbb","work_min":null}]},{"task":"gh-2","bots":[{"bot":"b-aaaaaaaaaa","work_min":11}]}]}}}}""")
        val feed = SpaceFeed.parse(doc)!!
        assertEquals(36.0, Teams.agentMinutes(feed.project("/work/example"))!!, 0.0)
        val m = machine().copy(space = mapOf("" to feed))
        val team = Teams.build(mapOf("h1" to m), 10_000L).first()
        assertEquals(2.0, team.merged!!, 0.0)
        assertEquals(36.0, team.agentMin!!, 0.0)
        val seen = Teams.merges(mapOf("h1" to m))
        assertEquals(emptySet<String>(), Teams.celebrations(null, seen))   // the first reading is the baseline
        assertEquals(emptySet<String>(), Teams.celebrations(seen, seen))
        val before = seen - "h1||/work/example|gh-2|b-aaaaaaaaaa"
        assertEquals(setOf("h1||/work/example|b-aaaaaaaaaa"), Teams.celebrations(before, seen))
        assertEquals("${team.id}|b-aaaaaaaaaa", Teams.celebrations(before, seen).single())
    }

    // ---- cache and offline

    @Test fun cachedProjectsOfOfflineMachinesStayAndAreStale() {
        val live = listOf(team("a", Teams.WORKING).copy(hostId = "h1"))
        val cached = listOf(team("a", Teams.IDLE).copy(hostId = "h1"), team("b", Teams.NEEDS_YOU).copy(hostId = "h2"))
        val merged = Teams.merge(live, cached, connected = setOf("h1"))
        assertEquals(listOf("a", "b"), merged.map { it.id })
        assertEquals(Teams.WORKING, merged[0].bots.single().pose)
        assertTrue(merged[1].stale)
        assertNull(merged[1].bots.single().ref)   // an offline machine's terminal can't be opened
        assertEquals(emptyList<Pair<Teams.Team, Teams.Bot>>(), Teams.deck(merged.drop(1)))
    }

    @Test fun aSpaceWaitsForItsGitAnswerAndTheCacheCoversAMachineStillBeingRead() {
        val m = machine()
        assertEquals(emptyList<Teams.Team>(), Teams.build(mapOf("h1" to m.copy(git = emptyMap())), 10_000L))
        // Not a repository (git answered null): a project of its own, keyed by the space.
        val site = Teams.build(mapOf("h1" to m.copy(git = m.git + (Sidebar.gitKey("", "/work/site") to null))), 10_000L).last()
        assertEquals("h1||space:s3", site.id)
        val cached = Teams.build(mapOf("h1" to m), 10_000L)
        val shown = Teams.merge(emptyList(), cached, connected = setOf("h1"))
        assertEquals(cached, shown)   // connected, nothing read yet: the cache, still openable
    }

    @Test fun rowsRoundTripTheModel() {
        val teams = Teams.build(mapOf("h1" to machine()), 10_000L).map { it.copy(merged = 3.0) }
        val (t, b) = TeamsCache.rows(teams)
        assertEquals(teams, TeamsCache.teams(t.reversed(), b.reversed()))
    }

    @Test fun rowTimesReadLikeAChatList() {
        val zone = ZoneOffset.UTC
        val now = java.time.Instant.parse("2026-11-03T15:00:00Z").toEpochMilli()
        assertEquals("", Teams.time(0, now, zone))
        assertEquals("14:05", Teams.time(java.time.Instant.parse("2026-11-03T14:05:00Z").toEpochMilli(), now, zone))
        assertEquals("Yesterday", Teams.time(java.time.Instant.parse("2026-11-02T23:59:00Z").toEpochMilli(), now, zone))
        assertEquals("2026-11-03", Teams.day(now, zone))
    }
}
