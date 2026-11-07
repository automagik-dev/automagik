package ai.namastex.automagik

import ai.namastex.automagik.Background.whileShown
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** What Pocket does while its screen is stopped (battery sweep 2026-11-07, suspects 1-4). */
@OptIn(ExperimentalCoroutinesApi::class)
class BackgroundTest {
    private fun t(address: String, status: String = "working", turn: Long = 1, title: String = "claude") =
        CoreTerminal(address, title, "/", "live", status, "claude", "", 80, 24, turn = turn)

    // Suspect 1: a stop lets go of the terminal stream and the chat; the next start takes them back, once.
    @Test fun aStopLetsGoOfTheStreamsAndTheNextStartTakesThemBack() {
        val held = Background.Held()
        val chat = TerminalRef("mac", "t1")
        held.stop(terminal = true, chat = chat)
        // The other activity's stop, with nothing left attached, never forgets what the first stop let go of.
        held.stop(terminal = false, chat = null)
        assertEquals(true to chat, held.start())
        assertEquals("given back once", false to null, held.start())
    }

    // Suspect 2: in the background an event reads the whole machine only when an agent's status moved, or every 30 s.
    @Test fun aRedrawInTheBackgroundWaits30sForTheFullRead() {
        val before = listOf(t("1"))
        val redrawn = listOf(t("1", title = "✳ Working"))
        assertFalse(Background.refresh(foreground = false, before, redrawn, lastMs = 0, nowMs = 5_000))
        assertTrue("30 s later", Background.refresh(foreground = false, before, redrawn, lastMs = 0, nowMs = 30_000))
    }

    @Test fun aStatusChangeInTheBackgroundIsReadAtOnce() {
        val before = listOf(t("1"))
        assertTrue("blocked", Background.refresh(false, before, listOf(t("1", status = "blocked")), 0, 1_000))
        assertTrue("a new turn", Background.refresh(false, before, listOf(t("1", turn = 2)), 0, 1_000))
        assertTrue("a new agent", Background.refresh(false, before, before + t("2"), 0, 1_000))
        assertTrue("the first read", Background.refresh(false, null, before, 0, 1_000))
        assertTrue("on screen", Background.refresh(true, before, before, 0, 1_000))
    }

    @Test fun teamsSyncWaitsForTheScreen() = runTest {
        val shown = MutableStateFlow(false)
        val live = MutableStateFlow(1)
        val synced = mutableListOf<Int>()
        val job = launch(UnconfinedTestDispatcher(testScheduler)) { live.whileShown(shown).collect { synced += it } }
        live.value = 2
        assertEquals("nothing while stopped", emptyList<Int>(), synced)
        shown.value = true
        assertEquals("the latest on start", listOf(2), synced)
        live.value = 3
        assertEquals(listOf(2, 3), synced)
        job.cancel()
    }

    // Suspect 3: an unreachable machine is tried fast a few times, then every 15 minutes; a timeout keeps the endpoint.
    @Test fun anUnreachableMachineIsTriedEvery15MinutesAfterItsFastTries() {
        assertEquals(2_000L, Background.reconnectDelay(1))
        assertEquals(60_000L, Background.reconnectDelay(5))
        assertEquals(60_000L, Background.reconnectDelay(Background.RECONNECT_FAST))
        assertEquals(900_000L, Background.reconnectDelay(Background.RECONNECT_FAST + 1))
        assertEquals(900_000L, Background.reconnectDelay(500))
    }

    @Test fun aTimeoutOnTheSameNetworkKeepsTheEndpoint() {
        assertFalse(Background.rebind("100", "100", timeouts = 1))
        assertFalse(Background.rebind("100", "100", timeouts = 3))
        assertTrue("every 4th timeout still rebinds", Background.rebind("100", "100", timeouts = 4))
        assertTrue("a new network", Background.rebind("100", "101", timeouts = 1))
    }

    // Suspect 4: the screens' menu polls read nothing while the activity is stopped.
    @Test fun aStoppedScreenPollsNothing() = runTest {
        val started = MutableStateFlow(true)
        var reads = 0
        val job = launch { Background.poll(started, 1_500) { reads++ }.collect { } }
        advanceTimeBy(4_000); runCurrent()
        assertEquals(3, reads)
        started.value = false; runCurrent()
        advanceTimeBy(60_000); runCurrent()
        assertEquals("stopped", 3, reads)
        started.value = true; runCurrent()
        assertEquals("started again", 4, reads)
        job.cancel()
    }
}
