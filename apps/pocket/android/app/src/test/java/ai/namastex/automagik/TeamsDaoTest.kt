package ai.namastex.automagik

import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** The Teams cache's queries on a real SQLite (Robolectric's), in memory. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class TeamsDaoTest {
    private lateinit var db: TeamsDb
    private lateinit var dao: TeamsDao

    @Before fun open() {
        db = Room.inMemoryDatabaseBuilder(ApplicationProvider.getApplicationContext(), TeamsDb::class.java).allowMainThreadQueries().build()
        dao = db.teams()
    }
    @After fun close() = db.close()

    private fun team(host: String, id: String, vararg bots: Pair<String, String>) = Teams.Team("$host||/work/$id", host, "", "/work/$id", id,
        Teams.Icon.Emoji("🧪"), "ansi3", bots.mapIndexed { i, (b, pose) -> Teams.Bot(b, b.uppercase(), i == 0, null, pose, "msg $b", i * 10L,
            TerminalRef(host, "t$i"), "") }, merged = 4.0, agentMin = null)

    private suspend fun write(hosts: List<String>, teams: List<Teams.Team>) {
        val (t, b) = TeamsCache.rows(teams)
        dao.replace(hosts, t, b)
    }
    private suspend fun read() = TeamsCache.teams(dao.teams().first(), dao.bots().first())

    @Test fun aReadingReplacesItsMachinesRowsOnly() = runTest {
        val one = team("h1", "one", "a" to Teams.WORKING, "b" to Teams.NEEDS_YOU)
        val two = team("h2", "two", "c" to Teams.IDLE)
        write(listOf("h1", "h2"), listOf(one, two))
        assertEquals(listOf(one, two), read())
        // h1 reads again with one bot gone and its pose changed; h2's rows stay as they were.
        val again = team("h1", "one", "a" to Teams.DONE)
        write(listOf("h1"), listOf(again))
        assertEquals(setOf(again, two), read().toSet())
        // A machine whose reading has no projects any more leaves nothing behind.
        write(listOf("h2"), emptyList())
        assertEquals(listOf(again), read())
    }

    // ---- TeamsSync: the path the ViewModel takes.

    private fun machine(spaces: Int = 1, feedTasks: List<String> = emptyList()): MachineState {
        val terminals = listOf(CoreTerminal("t1", "lead", "/work/one", "live", "blocked", "claude-code", "Run it?", 80, 24,
            labels = mapOf("bot" to "b-aaaaaaaaaa"), statusMs = 5, kind = "permission"))
        val all = listOf(PocketSpace("s1", "One", "/work/one", "", listOf(PocketTab("a", "A", listOf("t1")))),
            PocketSpace("s2", "Two", "/work/two", "", emptyList()))
        val git = mapOf(Sidebar.gitKey("", "/work/one") to GitInfo("dev", 0, 0, "/work/one", "/work/one/.git"),
            Sidebar.gitKey("", "/work/two") to GitInfo("dev", 0, 0, "/work/two", "/work/two/.git"))
        val feed = SpaceFeed.Feed(null, false, mapOf("/work/one" to SpaceFeed.Project(null, null, null, null, null, emptyMap(),
            feedTasks.map { SpaceFeed.TaskWork(it, listOf(SpaceFeed.TaskBot("b-aaaaaaaaaa", 10.0))) })))
        return MachineState(connected = true, session = 1, readSession = 1, readMs = 0, terminals = terminals, spaces = all.take(spaces),
            git = git, space = mapOf("" to feed))
    }

    @Test fun removingAMachinePurgesItsCache() = runTest {
        val sync = TeamsSync(dao)
        sync.reading(mapOf("h1" to machine(), "h2" to machine()), 1_000L)
        assertEquals(setOf("h1", "h2"), read().map { it.hostId }.toSet())
        sync.removed("h1")
        assertEquals(setOf("h2"), read().map { it.hostId }.toSet())
    }

    @Test fun aMachineWhoseSpacesClosedIsEmptiedAndOneStillBeingReadIsKept() = runTest {
        val sync = TeamsSync(dao)
        sync.reading(mapOf("h1" to machine(spaces = 2)), 1_000L)
        assertEquals(2, read().size)
        // Read again with no space left: zero projects replace the old ones (no needs-you card lingers in the cache).
        sync.reading(mapOf("h1" to machine(spaces = 0)), 2_000L)
        assertEquals(emptyList<Teams.Team>(), read())
        sync.reading(mapOf("h1" to machine(spaces = 1)), 3_000L)
        // Connected again but this session not read yet: its cache stays as it was.
        sync.reading(mapOf("h1" to machine(spaces = 0).copy(session = 2)), 4_000L)
        assertEquals(1, read().size)
    }

    @Test fun anUnchangedReadingWritesNothing() = runTest {
        val sync = TeamsSync(dao)
        sync.reading(mapOf("h1" to machine()), 1_000L)
        // Mark the cache behind the writer's back: an identical reading must leave the mark, a changed one replaces it.
        val (t, b) = TeamsCache.rows(read().map { it.copy(name = "marked") })
        dao.replace(listOf("h1"), t, b)
        sync.reading(mapOf("h1" to machine()), 1_500L)
        assertEquals("marked", read().single().name)
        sync.reading(mapOf("h1" to machine().let { it.copy(terminals = it.terminals.map { x -> x.copy(status = "working") }) }), 2_000L)
        assertEquals("One", read().single().name)
    }

    @Test fun eachFeedHasItsOwnMergeBaseline() = runTest {
        val sync = TeamsSync(dao)
        assertEquals(emptySet<String>(), sync.reading(mapOf("h1" to machine(feedTasks = listOf("gh-1"))), 1_000L))
        // A second machine's feed arrives with merges of its own: its baseline, nothing jumps.
        assertEquals(emptySet<String>(), sync.reading(mapOf("h1" to machine(feedTasks = listOf("gh-1")),
            "h2" to machine(feedTasks = listOf("gh-7", "gh-8"))), 2_000L))
        // A new merge on h1 jumps h1's bot only.
        assertEquals(setOf("h1||/work/one|b-aaaaaaaaaa"), sync.reading(mapOf("h1" to machine(feedTasks = listOf("gh-1", "gh-2")),
            "h2" to machine(feedTasks = listOf("gh-7", "gh-8"))), 3_000L))
    }

    @Test fun peaksOnlyRiseAndOlderDaysGo() = runTest {
        dao.raisePeaks("2026-11-02", mapOf("" to 9))
        dao.raisePeaks("2026-11-03", mapOf("" to 3, "h1||/work/one" to 2))
        dao.raisePeaks("2026-11-03", mapOf("" to 2, "h1||/work/one" to 4))
        val today = dao.day("2026-11-03").first().associate { it.scope to it.peak }
        assertEquals(mapOf("" to 3, "h1||/work/one" to 4), today)
        assertEquals(emptyList<DayStatRow>(), dao.day("2026-11-02").first())
        // Zero working is a real peak (0), not a missing one.
        dao.raisePeaks("2026-11-03", mapOf("h1||/work/two" to 0))
        assertEquals(0, dao.peak("2026-11-03", "h1||/work/two"))
    }
}
