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
