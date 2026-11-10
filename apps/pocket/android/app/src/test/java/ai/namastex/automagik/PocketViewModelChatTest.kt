package ai.namastex.automagik

import android.app.Application
import androidx.lifecycle.viewModelScope
import androidx.test.core.app.ApplicationProvider
import java.util.concurrent.CopyOnWriteArrayList
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * The view model's chat wiring (#754): a fake chat link emits the bridge's snapshot, status and gone events, so the
 * tests drive [PocketViewModel.openChat], `chatEvent`, [PocketViewModel.closeChat], `markSeen` and `resumeLater`
 * exactly as production does. No device, emulator or installed app.
 */
@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class PocketViewModelChatTest {
    private val dispatcher = StandardTestDispatcher()
    /** The view model's init loops, parked: these tests drive only the chat wiring, never the app's background reads. */
    private val initDispatcher = StandardTestDispatcher()
    private val host = "box"
    private lateinit var vm: PocketViewModel

    @Before fun setUp() {
        Dispatchers.setMain(dispatcher)
        val app: Application = ApplicationProvider.getApplicationContext()
        app.getSharedPreferences("pocket", 0).edit().clear().commit()
        vm = PocketViewModel(app, initDispatcher)
        vm.saveHost(HostProfile(host, "Box", "box", "phone", transport = "iroh"))
    }

    @After fun tearDown() {
        vm.closeChat()
        vm.viewModelScope.cancel()
        Dispatchers.resetMain()
    }

    private fun ref(id: String) = TerminalRef(host, "dsh:$id")

    private fun row(id: String, status: String, kind: String = "", msg: String = ""): Chat.Terminal =
        Chat.Terminal.parse(JSONObject().put("terminal", "dsh:$id").put("machine", JSONObject.NULL).put("agent", "dsh")
            .put("title", "Lead").put("status", JSONObject().put("state", status).put("kind", kind.ifBlank { JSONObject.NULL })
                .put("msg", msg).put("turn", 0)).put("chat", "session"))

    private fun snapshot(rows: List<String> = listOf("""{"id":"r1","kind":"text","role":"assistant","text":"hello"}"""),
                         status: String = "working", question: String? = null, approval: String? = null): String =
        JSONObject().put("type", "snapshot").put("reset", true)
            .put("rows", JSONArray(rows.map(::JSONObject)))
            .put("screen", JSONArray())
            .put("status", JSONObject().put("state", status))
            .put("question", question?.let { JSONObject(it) } ?: JSONObject.NULL)
            .put("approval", approval?.let { JSONObject(it) } ?: JSONObject.NULL)
            .put("held", JSONArray()).toString()

    /**
     * One chat route's fake: [subscribe] records the bridge's event callback and completes [subscribed]. The test then
     * emits each event itself and drains it with `runCurrent()`, so no virtual Main step is left pending while the test
     * waits on the background open.
     */
    private class FakeLink(private val rows: List<Chat.Terminal>) : ChatLink {
        override val dshWrite = true
        val subscribed = CompletableDeferred<Unit>()
        @Volatile var closed = false
        @Volatile private var event: ((JSONObject) -> Unit)? = null

        override suspend fun list() = rows

        override suspend fun subscribe(terminal: String, after: String?, event: (JSONObject) -> Unit,
                                       closed: (String) -> Unit): Int {
            this.event = event
            // The VM's subscribe has returned and [event] is installed: an event posted after this cannot miss it.
            subscribed.complete(Unit)
            return 1
        }

        fun emit(json: String) {
            val callback = checkNotNull(event) { "emit before subscribe" }
            callback(JSONObject(json))
        }

        override suspend fun backfill(terminal: String, before: String, limit: Int) = JSONArray()
        override suspend fun send(terminal: String, text: String, id: String) = JSONObject()
        override suspend fun sendHeld(terminal: String, id: String) = JSONObject()
        override suspend fun cancelHeld(terminal: String, id: String) = JSONObject()
        override suspend fun answer(terminal: String, row: String, choice: String, text: String?) = JSONObject()
        override suspend fun interrupt(terminal: String) = JSONObject()
        override fun close() { closed = true }
    }

    /** The fake bridge's route: every open is a fresh [FakeLink], listed with [rows]. */
    private class FakeBridge(@Volatile var rows: List<Chat.Terminal> = emptyList()) {
        val links = CopyOnWriteArrayList<FakeLink>()
        val opener: suspend (String, CoroutineScope, (String) -> Unit) -> ChatLink = { _, _, _ ->
            FakeLink(rows).also { links += it }
        }

        suspend fun opened(index: Int): FakeLink = withContext(Dispatchers.IO) {
            withTimeout(10_000) {
                while (links.size <= index) delay(5)
                links[index]
            }
        }

        suspend fun subscribed(index: Int): FakeLink = opened(index).also { link ->
            withContext(Dispatchers.IO) { withTimeout(10_000) { link.subscribed.await() } }
        }

        /** Whether the [index]th link is closed, once the view model's job ran the `finally` that closes it. */
        suspend fun awaitClosed(index: Int): Boolean = opened(index).let { link ->
            withContext(Dispatchers.IO) {
                withTimeoutOrNull(10_000) { while (!link.closed) delay(5) }
                link.closed
            }
        }
    }

    private suspend fun awaitBotChats(hostId: String = host) = withContext(Dispatchers.IO) {
        withTimeout(10_000) { while (vm.botChats.value[hostId] == null) delay(5) }
    }

    /** Row 1: an event for the open card updates it in place, with no second state and no duplicate rows. */
    @Test fun aChatEventForTheOpenCardUpdatesItInPlace() = runTest(dispatcher) {
        val bridge = FakeBridge()
        vm.chatOpener = bridge.opener
        vm.openChat(ref("s1"))
        val link = bridge.subscribed(0)
        link.emit(snapshot(status = "blocked",
            question = """{"id":"q1","kind":"question","open":true,"prompt":"Choose a branch","options":["main","dev"]}"""))
        runCurrent()
        val before = vm.chat.value!!
        assertEquals(ref("s1"), TerminalRef(host, before.terminal))
        assertEquals("Choose a branch", before.question?.prompt)
        assertEquals(listOf("r1"), before.rows.map { it.id })

        link.emit("""{"type":"question","row":{"id":"q1","kind":"question","open":true,"prompt":"Choose a file","options":["a","b"]}}""")
        runCurrent()
        val after = vm.chat.value!!
        assertEquals(before.terminal, after.terminal)
        assertEquals("Choose a file", after.question?.prompt)
        assertEquals("q1", after.question?.id)
        assertEquals(listOf("r1"), after.rows.map { it.id })
    }

    /** Row 2: closeChat clears the open card and leaves its receipt in the watch, as Home's Done line. */
    @Test fun closeChatClearsTheOpenCardAndKeepsItsReceipt() = runTest(dispatcher) {
        val bridge = FakeBridge(listOf(row("s1", "blocked", kind = "permission")))
        vm.chatOpener = bridge.opener
        vm.loadBotChats(host)
        awaitBotChats()

        vm.openChat(ref("s1"))
        val link = bridge.subscribed(1)
        link.emit(snapshot(status = "blocked",
            approval = """{"id":"a1","kind":"approval","open":true,"prompt":"Run it?","choices":["allow","deny"]}"""))
        runCurrent()
        assertEquals("a1", vm.chat.value?.approval?.id)
        // The card closes with bots-dsh's receipt, then the turn finishes: the watch says Done and keeps the receipt.
        link.emit("""{"type":"approval","row":{"id":"a1","kind":"approval","open":false,
            "receipt":{"by":"phone","name":"Pixel","outcome":"allow","at":1}}}""")
        runCurrent()
        link.emit("""{"type":"status","status":{"state":"idle"}}""")
        runCurrent()

        val key = ChatWatch.key(host, "dsh:s1")
        assertEquals("done", vm.chatWatch.value[key]?.status)
        vm.closeChat()
        assertNull(vm.chat.value)
        assertTrue("closeChat closes the chat's link", bridge.awaitClosed(1))
        val kept = vm.chatWatch.value.getValue(key)
        assertEquals("done", kept.status)
        assertEquals("Answered on the phone (Pixel): Allow", kept.receipt)

        val chats = Cockpit.chats(mapOf(host to vm.botChats.value[host]!!.getOrThrow()), vm.chatWatch.value,
            vm.botWrites.value, emptyList(), 1_000)
        val done = chats.agents.single().second
        assertEquals(Cockpit.DONE, Cockpit.rank(done.status))
        assertEquals("Answered on the phone (Pixel): Allow", done.message)
    }

    /**
     * Row 2's replacement path: the second chat opens while the first is still open, so `openChat` itself cancels
     * the replaced chat's job, and only that job's `finally` closes the old link (never a prior `closeChat`).
     */
    @Test fun aSecondChatClosesTheLinkOfTheChatItReplaces() = runTest(dispatcher) {
        val bridge = FakeBridge()
        vm.chatOpener = bridge.opener
        vm.openChat(ref("s1"))
        val first = bridge.subscribed(0)
        first.emit(snapshot(status = "working"))
        runCurrent()
        assertEquals("dsh:s1", vm.chat.value?.terminal)

        vm.openChat(ref("s2"))
        val second = bridge.subscribed(1)
        runCurrent()
        assertEquals("dsh:s2", vm.chat.value?.terminal)
        assertTrue("opening a second chat closes the replaced chat's link", bridge.awaitClosed(0))
        assertFalse("the open chat's link stays open", second.closed)
    }

    /**
     * Row 4: a resuming DSH chat reconnects after the first delay with the same ref and `resuming`; after
     * [Chat.RESUME_DELAYS_MS] it stops reconnecting and shows the Reconnect (not-answering) state.
     */
    @Test fun resumeLaterReopensTheLastChatAfterARestart() = runTest(dispatcher) {
        val bridge = FakeBridge()
        vm.chatOpener = bridge.opener
        vm.openChat(ref("s1"))
        val first = bridge.subscribed(0)
        first.emit(snapshot(status = "working"))
        runCurrent()

        first.emit("""{"type":"gone","reason":"unavailable"}""")
        runCurrent()
        assertEquals(true, vm.chat.value?.resuming)
        assertEquals(Chat.RESUMING, vm.chat.value?.error)
        assertEquals(1, bridge.links.size)

        // Every later connection answers `gone` as well: the test emits it after that connection's subscribe latch,
        // then drains the Main step it queues, so the chat walks the whole RESUME_DELAYS_MS ladder in order.
        var next = 1
        for (wait in Chat.RESUME_DELAYS_MS) {
            advanceTimeBy(wait)
            runCurrent()
            val link = bridge.subscribed(next)
            link.emit("""{"type":"gone","reason":"unavailable"}""")
            runCurrent()
            assertEquals(ref("s1"), TerminalRef(host, vm.chat.value!!.terminal))
            if (next == 1) {
                assertEquals(true, vm.chat.value?.resuming)
                assertEquals(Chat.RESUMING, vm.chat.value?.error)
            }
            next++
        }
        assertEquals(Chat.RESUME_DELAYS_MS.size + 1, bridge.links.size)
        assertEquals(false, vm.chat.value?.resuming)
        assertEquals(Chat.NOT_ANSWERING, vm.chat.value?.error)
        assertEquals("dsh:s1", vm.chat.value?.terminal)
    }

    /** Row 5: an event of a closed chat, or of a generation another chat replaced, is ignored and never reopens it. */
    @Test fun anEventForAStaleOrClosedChatIsIgnored() = runTest(dispatcher) {
        val bridge = FakeBridge()
        vm.chatOpener = bridge.opener
        vm.openChat(ref("s1"))
        val old = bridge.subscribed(0)
        old.emit(snapshot(status = "working", rows = listOf("""{"id":"a1","kind":"text","role":"assistant","text":"one"}""")))
        runCurrent()

        vm.closeChat()
        assertNull(vm.chat.value)
        old.emit(snapshot(status = "blocked"))
        old.emit("""{"type":"gone","reason":"unavailable"}""")
        runCurrent()
        advanceTimeBy(Chat.RESUME_DELAYS_MS.sum())
        runCurrent()
        assertNull(vm.chat.value)
        assertEquals(1, bridge.links.size)

        // A second chat is open: the first one's late events must not touch it, nor make it resume.
        vm.openChat(ref("s2"))
        val current = bridge.subscribed(1)
        current.emit(snapshot(status = "working", rows = listOf("""{"id":"b1","kind":"text","role":"assistant","text":"two"}""")))
        runCurrent()
        old.emit(snapshot(status = "blocked"))
        old.emit("""{"type":"gone","reason":"unavailable"}""")
        runCurrent()
        assertEquals("dsh:s2", vm.chat.value?.terminal)
        assertEquals("two", vm.chat.value?.rows?.single()?.text)
        assertEquals(false, vm.chat.value?.resuming)
        assertEquals(listOf("b1"), vm.chat.value?.rows?.map { it.id })
    }

    /**
     * Row 3: markSeen takes the looked-at chat's finished turn out of Home, and Home's needs-you count and badge are
     * clear. The answer's status events are what decrement needs-you (a blocked chat still needs you); markSeen then
     * turns its Done into the phone's Idle, with the count and badge derived through [Cockpit] and [Projects.Pulse].
     */
    @Test fun markSeenClearsTheLookedAtChatsDoneAndKeepsHomeClear() = runTest(dispatcher) {
        val bridge = FakeBridge(listOf(row("s1", "blocked", kind = "permission")))
        vm.chatOpener = bridge.opener
        vm.loadBotChats(host)
        awaitBotChats()
        fun home(): Projects.Pulse = Projects.pulse(listOf(SidebarHost(host, "Box", true, emptyList(), emptyList(), emptyList())),
            vm.state.value.seen, Cockpit.chats(mapOf(host to vm.botChats.value[host]!!.getOrThrow()), vm.chatWatch.value,
                vm.botWrites.value, emptyList(), 1_000))
        assertEquals(1, home().needsYou)
        assertEquals(1, Nav.badge(Nav.HOME_TAB, home().needsYou, 0))

        vm.openChat(ref("s1"))
        val link = bridge.subscribed(1)
        link.emit(snapshot(status = "blocked",
            approval = """{"id":"a1","kind":"approval","open":true,"prompt":"Run it?","choices":["allow","deny"]}"""))
        runCurrent()
        assertEquals("a1", vm.chat.value?.approval?.id)
        link.emit("""{"type":"approval","row":{"id":"a1","kind":"approval","open":false,
            "receipt":{"by":"phone","name":"Pixel","outcome":"allow","at":1}}}""")
        runCurrent()
        link.emit("""{"type":"status","status":{"state":"working"}}""")
        runCurrent()
        assertEquals(0, home().needsYou)
        assertEquals(0, Nav.badge(Nav.HOME_TAB, home().needsYou, 0))
        link.emit("""{"type":"status","status":{"state":"idle"}}""")
        runCurrent()
        val done = home()
        assertEquals(0, done.needsYou)
        assertEquals(0, Nav.badge(Nav.HOME_TAB, done.needsYou, 0))
        assertEquals(listOf("dsh:s1"), done.sections.single { it.rank == Cockpit.DONE }.entries.map { it.ref.address })

        // Leaving the open chat is production's markSeen path; its seen key is the chat's finished turn.
        val turn = vm.chatWatch.value.getValue(ChatWatch.key(host, "dsh:s1")).turn
        vm.selectTerminal(ref("s1"))
        vm.detach()
        assertTrue(Cockpit.seenKey(ref("s1"), turn) in vm.state.value.seen)
        val seen = home()
        assertEquals(0, seen.needsYou)
        assertEquals(0, Nav.badge(Nav.HOME_TAB, seen.needsYou, 0))
        assertNull(seen.sections.find { it.rank == Cockpit.DONE })
        assertEquals(listOf("dsh:s1"), seen.sections.first { it.rank == Cockpit.IDLE }.entries.map { it.ref.address })
        assertEquals("Answered on the phone (Pixel): Allow", vm.chatWatch.value.getValue(ChatWatch.key(host, "dsh:s1")).receipt)
    }

    /** The preview opens its one sample main-bot chat with no bridge at all: the fixture is the whole chat. */
    @Test fun thePreviewOpensItsSampleMainBotChatWithoutABridge() {
        var opened = false
        vm.chatOpener = { _, _, _ -> opened = true; error("the preview must not open a chat link") }
        vm.enterDemo()
        val bubbles = Teams.bubbles(Teams.build(vm.state.value.machines, System.currentTimeMillis()), ChatDemo.chats())
        assertEquals(Teams.Opens.DshChat(ChatDemo.ref), bubbles.single { it.team.name == "herdr" }.opens)
        val listing = vm.botChats.value[ChatDemo.HOST]?.getOrNull().orEmpty()
        assertEquals("Captain", listing.first { it.terminal == ChatDemo.TERMINAL }.title)
        assertEquals("Reader", listing.first { it.terminal == ChatDemo.READ_ONLY_TERMINAL }.title)
        vm.openChat(ChatDemo.ref)
        val chat = checkNotNull(vm.chat.value)
        assertEquals(ChatDemo.TERMINAL, chat.terminal)
        assertEquals("approval", chat.approval?.kind)
        assertEquals("question", chat.question?.kind)
        assertTrue(chat.rows.any { it.kind == "text" && it.role == "assistant" && it.text.length >= 400 })
        assertFalse(opened)
        vm.chatAnswer(checkNotNull(chat.approval), "allow")
        assertEquals(ChatDemo.SAMPLE_ONLY, vm.chat.value?.notice)
        assertNull("the sample approval leaves after its answer", vm.chat.value?.approval)
        assertEquals("question", vm.chat.value?.question?.kind)
        vm.chatAnswerQuestion(checkNotNull(vm.chat.value?.question), listOf(0))
        assertNull("the sample question leaves after its answer", vm.chat.value?.question)
        // The read-only sample opens too: its question is pinned and the phone offers no answer controls.
        vm.openChat(ChatDemo.readOnlyRef)
        val readOnly = checkNotNull(vm.chat.value)
        assertEquals(ChatDemo.READ_ONLY_TERMINAL, readOnly.terminal)
        assertTrue(readOnly.readOnly)
        assertEquals(Chat.ANSWER_ON_COMPUTER, readOnly.question?.prompt)
        // A preview terminal with no sample chat keeps the old message: no rows from Captain.
        vm.openChat(TerminalRef(ChatDemo.HOST, "t6"))
        val other = checkNotNull(vm.chat.value)
        assertEquals("t6", other.terminal)
        assertTrue(other.rows.isEmpty())
        assertEquals("Chat needs a connected machine.", other.error)
        vm.leaveDemo()
        assertTrue(vm.botChats.value[ChatDemo.HOST] == null)
    }
}
