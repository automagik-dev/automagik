package ai.namastex.automagik

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.withTimeout
import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import java.io.Closeable
import java.io.DataInputStream
import java.nio.channels.Channels
import java.nio.channels.Pipe
import java.util.Base64
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger

/**
 * The Teams reads ([HostReads]) through a real [CoreClient] to a fake core, where each linked machine answers its own
 * way: at once, never, only after the time-box, or with an error at once. A stalled or unreachable machine must hold
 * back only its own rows, never wedge the pool or a refresh, and a late answer must never land.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class HostReadsTest {
    /** How the fake core answers one call. */
    private sealed interface Reply {
        data class Now(val result: JSONObject) : Reply
        data class After(val ms: Long, val result: JSONObject, val sent: CompletableDeferred<Unit>) : Reply
        data object Never : Reply
        data class Fail(val message: String) : Reply
    }

    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private lateinit var client: CoreClient
    @Volatile private var lost: String? = null
    /** The fake core's answer to each call, by method and the machine it names ("" the core's own). */
    @Volatile private var answer: (String, String, JSONObject) -> Reply = { _, _, _ -> Reply.Never }

    @Before fun connect() = runBlocking {
        val toCore = Pipe.open(); val toPhone = Pipe.open()
        val coreOut = Channels.newOutputStream(toPhone.sink())
        scope.launch { runCatching {   // ends when the test closes the connection
            val input = DataInputStream(Channels.newInputStream(toCore.source()))
            while (input.read() != '\n'.code) Unit   // the hello line
            synchronized(coreOut) {
                coreOut.write("{\"jsonrpc\":\"2.0\",\"id\":0,\"result\":{\"generation\":1,\"framed\":true,\"version\":\"fake\"}}\n".toByteArray())
                coreOut.flush()
            }
            while (true) {
                val header = ByteArray(9); input.readFully(header)
                val (_, _, length) = Wire.header(header)
                val payload = ByteArray(length); input.readFully(payload)
                val request = JSONObject(String(payload))
                val params = request.optJSONObject("params") ?: JSONObject()
                val reply = answer(request.getString("method"), params.optString("on"), params)
                fun send(body: JSONObject) = synchronized(coreOut) {
                    coreOut.write(Wire.encode(0, Wire.DATA, body.put("jsonrpc", "2.0").put("id", request.getInt("id")).toString().toByteArray()))
                    coreOut.flush()
                }
                when (reply) {
                    is Reply.Now -> send(JSONObject().put("result", reply.result))
                    is Reply.Fail -> send(JSONObject().put("error", JSONObject().put("code", -32000).put("message", reply.message)))
                    is Reply.After -> launch { delay(reply.ms); send(JSONObject().put("result", reply.result)); reply.sent.complete(Unit) }
                    Reply.Never -> Unit
                }
            }
        } }
        client = CoreClient(Channels.newInputStream(toPhone.source()), Channels.newOutputStream(toCore.sink()),
            Closeable { toCore.sink().close(); toPhone.source().close() }, scope) { lost = it }
        withTimeout(5_000) { client.start() }
        Unit
    }
    @After fun close() { client.close(); scope.cancel(); db.close() }

    // The Teams cache on a real SQLite (Robolectric's), written by the one writer the view model uses.
    private val db = Room.inMemoryDatabaseBuilder(ApplicationProvider.getApplicationContext(), TeamsDb::class.java).allowMainThreadQueries().build()
    private val dao = db.teams()
    private val sync = TeamsSync(dao)
    private suspend fun cached() = TeamsCache.teams(dao.teams().first(), dao.bots().first())

    /** A test body that fails, never hangs, past [TEST_LIMIT]. */
    private fun bounded(block: suspend CoroutineScope.() -> Unit) = runBlocking { withTimeout(TEST_LIMIT) { block() } }

    // ---- what the fake core serves

    private fun layout(name: String) = JSONObject().put("value", JSONObject().put("spaces", JSONArray().put(JSONObject()
        .put("id", "s1").put("name", name).put("folder", "/srv/x")
        .put("tabs", JSONArray().put(JSONObject().put("id", "a").put("root", JSONObject().put("content", JSONObject().put("terminal", "t1"))))))))
    private fun stdout(bytes: ByteArray) = JSONObject().put("code", 0).put("stdout", Base64.getEncoder().encodeToString(bytes))
    private fun folders(params: JSONObject) = params.getJSONArray("argv").let { a -> (4 until a.length()).map(a::getString) }
    private fun script(params: JSONObject) = params.getJSONArray("argv").getString(2)
    /** [HostBatch.GIT]'s answer: every folder its own repository on [branch]. */
    private fun git(params: JSONObject, branch: String) = stdout(folders(params).withIndex().joinToString("") { (i, f) ->
        listOf("$i", "0", "# branch.head $branch", "0", f, "0", "$f/.git", "1", "").joinToString("") { "$it\u0000" }
    }.toByteArray())
    /** [HostBatch.FILES]' answer: a registry with one bot, "b-<machine>". */
    private fun registry(params: JSONObject, machine: String) = stdout(folders(params).indices.joinToString("") { i ->
        "$i\u0000ok\u0000{\"bots\":[{\"id\":\"b-${machine.ifBlank { "own" }}\",\"name\":\"Bot\",\"kind\":\"main\"}]}\u0000"
    }.toByteArray())
    /** A healthy machine: answers every read at once. */
    private fun healthy(method: String, machine: String, params: JSONObject, branch: String = "main"): Reply = when {
        method == "doc.get" -> Reply.Now(layout(machine.ifBlank { "Own" }))
        script(params) == HostBatch.GIT -> Reply.Now(git(params, branch))
        else -> Reply.Now(registry(params, machine))
    }

    // ---- one saved machine: its own core with a space, and linked machines fast, slow and down

    private fun pane(address: String) = CoreTerminal(address, "lead", if ('/' in address) "/srv/x" else "/w/own", "live", "blocked", "claude-code", "Run it?", 80, 24,
        labels = mapOf("bot" to "b-${address.substringBefore('/', "own")}"), statusMs = 7, kind = "permission")
    private val terminals = listOf(pane("t1"), pane("fast/t1"), pane("slow/t1"), pane("down/t1"))
    private val own = PocketSpace("s1", "Own", "/w/own", "", listOf(PocketTab("a", "A", listOf("t1"))))
    private val linked = listOf("fast", "slow", "down").map { LinkedMachine(it, "connected") }
    private val state = MutableStateFlow(MachineState(connected = true, session = 1, terminals = terminals, linked = linked, spaces = listOf(own)))
    private fun reads(pool: Semaphore = Semaphore(HostReads.POOL), limit: Long = TIME_BOX) =
        HostReads({ m, p -> client.call(m, p) }, { state.value }, { f -> state.update(f) }, pool, HostReads.Limits(limit, limit, limit))

    /** A refresh as the view model makes one: the linked layouts, then the reading. */
    /** A refresh as the view model makes one, waiting for its linked reading: the machines that reading laid out. */
    private suspend fun refresh(reads: HostReads, machines: List<String>): List<String> =
        reads.refresh(scope, terminals, listOf(own), machines, linked, System.currentTimeMillis(), {}, {})?.await()
            ?: error("a linked reading was still out")
    private fun folder(m: String) = m to (if (m.isBlank()) "/w/own" else "/srv/x")
    private fun ms(start: Long) = System.currentTimeMillis() - start

    /**
     * slow: its first layout and every git batch answer only after the time-box; fast and the core's own answer at once.
     * The review's five points, in order: (1) the core's own and fast go live and cached within the limit while slow
     * stays stale with no card; (2) slow's late answers never land; (3) slow costs one pool slot for one timeout, not one
     * per batch; (4) a machine removed during a reading leaves no rows; (5) an unlinked machine's rows go.
     */
    @Test fun aStalledMachineHoldsBackOnlyItsOwnRows() = bounded {
        val docs = AtomicInteger(); val slowExecs = AtomicInteger()
        val late = ConcurrentHashMap.newKeySet<CompletableDeferred<Unit>>()
        answer = { method, machine, params ->
            when {
                machine != "slow" -> healthy(method, machine, params)
                method == "doc.get" && docs.getAndIncrement() == 0 -> Reply.After(TIME_BOX + 600, layout("Late"), CompletableDeferred<Unit>().also { late += it })
                method == "doc.get" -> Reply.Now(layout("New"))
                else -> { slowExecs.incrementAndGet(); Reply.After(TIME_BOX + 600, git(params, "late"), CompletableDeferred<Unit>().also { late += it }) }
            }
        }
        // The cache from an earlier run: slow's project waiting on the person, and "old", a machine no longer linked.
        fun cachedTeam(m: String) = Teams.Team("h1|$m|/srv/x", "h1", m, "/srv/x", m, Teams.Icon.Letter, null,
            listOf(Teams.Bot("b-$m", "Bot", true, null, Teams.NEEDS_YOU, "Run it?", 7, TerminalRef("h1", "$m/t1"), "permission")))
        for (m in listOf("slow", "old")) TeamsCache.rows(listOf(cachedTeam(m))).let { (t, b) -> dao.replaceMachine("h1", m, t, b) }
        val pool = Semaphore(2)
        val reads = reads(pool)

        // A refresh while slow's layout is late gives up at the time-box (not the client's 30 s); the next one has it.
        var start = System.currentTimeMillis()
        assertEquals(listOf("fast"), refresh(reads, listOf("fast", "slow")))
        assertTrue("refresh took ${ms(start)} ms", ms(start) in TIME_BOX..(TIME_BOX + SLACK))
        assertEquals(listOf("fast", "slow"), refresh(reads, listOf("fast", "slow")))

        // One git pass, as the view model makes it: slow has 21 folders (two batches) and never answers in time.
        start = System.currentTimeMillis()
        val unsure = ConcurrentHashMap.newKeySet<Pair<String, String>>()
        // When the core's own and fast are cached, and whether slow had been given up by then.
        val cachedIn = async {
            while (cached().map { it.id }.toSet().let { "h1||/w/own" !in it || "h1|fast|/srv/x" !in it }) {
                sync.reading(mapOf("h1" to state.value), System.currentTimeMillis()); delay(20)
            }
            ms(start) to unsure.any { it.first == "slow" }
        }
        reads.git(listOf(folder(""), folder("fast"), folder("slow")) + (1..20).map { "slow" to "/srv/x$it" }) { m, f -> unsure += m to f }
        val pass = ms(start)
        // (1) the core's own and fast are live and cached before slow is given up (an order, so a loaded test machine
        // can't flake it), and within the limit plus slack.
        val (cachedMs, slowGivenUp) = cachedIn.await()
        assertTrue("cached only after slow was given up ($cachedMs ms)", !slowGivenUp)
        assertTrue("cached after $cachedMs ms", cachedMs < TIME_BOX + SLACK)
        // (3) slow: one call and one wait for its 21 folders, then given up; the pool is whole again.
        assertEquals(1, slowExecs.get())
        assertEquals(21, unsure.count { it.first == "slow" })
        assertTrue("the pass took $pass ms", pass in TIME_BOX..(TIME_BOX + SLACK))
        assertEquals(2, pool.availablePermits)
        val now = System.currentTimeMillis()
        val read = Teams.read(mapOf("h1" to state.value), now)
        assertEquals(setOf("h1|", "h1|fast"), read)
        sync.reading(mapOf("h1" to state.value), now)
        val shown = Teams.merge(Teams.live(mapOf("h1" to state.value), read, now), cached(), read, setOf("h1"))
        assertEquals(setOf("b-own", "b-fast"), Teams.deck(shown).map { it.second.id }.toSet())
        assertEquals(TerminalRef("h1", "fast/t1"), shown.single { it.machine == "fast" }.bots.single().ref)
        val slow = shown.single { it.machine == "slow" }
        assertTrue(slow.stale)
        assertNull(slow.bots.single().ref)
        assertTrue(state.value.spaces.any { it.machine == "slow" })   // laid out, but its git never answered

        // (2) slow's late layout and git answers arrive now: nothing changes, and the connection carries on.
        withTimeout(5_000) { late.toList().forEach { it.await() } }
        delay(200)
        assertEquals("New", state.value.spaces.single { it.machine == "slow" }.name)
        assertTrue(state.value.git.keys.none { it.startsWith("slow|") })
        assertNull(lost)
        assertEquals(listOf("fast", "slow"), refresh(reads, listOf("fast", "slow")))

        // (5) "old" went with the first reading of the core's own; slow's row stays while slow is linked, then goes.
        assertEquals(setOf("", "fast", "slow"), cached().map { it.machine }.toSet())
        state.update { it.copy(linked = it.linked.filter { l -> l.name != "slow" }) }
        sync.reading(mapOf("h1" to state.value), System.currentTimeMillis())
        assertEquals(setOf("", "fast"), cached().map { it.machine }.toSet())

        // (4) a reading taken before the machine was removed, whichever runs first, leaves nothing.
        val taken = mapOf("h1" to state.value)
        val racing = async(Dispatchers.IO) { sync.reading(taken, System.currentTimeMillis()) }
        sync.removed("h1")
        racing.await()
        sync.reading(taken, System.currentTimeMillis())
        assertEquals(emptyList<Teams.Team>(), cached())
    }

    @Test fun aLateAnswerNeverOverwritesWhatWasReadSince() = bounded {
        val calls = ConcurrentHashMap<String, AtomicInteger>()
        val lateDoc = CompletableDeferred<Unit>(); val lateGit = CompletableDeferred<Unit>()
        answer = { method, machine, params ->
            val n = calls.getOrPut("$method|${if (method == "doc.get") "" else script(params)}") { AtomicInteger() }.getAndIncrement()
            when {
                machine != "slow" -> healthy(method, machine, params)
                // slow's first doc and first git answer come only after the time-box, with what was true then.
                method == "doc.get" && n == 0 -> Reply.After(TIME_BOX + 600, layout("Late"), lateDoc)
                method == "doc.get" -> Reply.Now(layout("New"))
                script(params) == HostBatch.GIT && n == 0 -> Reply.After(TIME_BOX + 600, git(params, "late"), lateGit)
                else -> healthy(method, machine, params, branch = "new")
            }
        }
        val reads = reads()
        assertEquals(emptyList<String>(), refresh(reads, listOf("slow")))
        assertEquals(listOf("slow"), refresh(reads, listOf("slow")))
        reads.git(listOf(folder("slow"))) { _, _ -> }   // gives up
        reads.git(listOf(folder("slow"))) { _, _ -> }   // answered: branch "new"
        assertEquals("new", state.value.git[Sidebar.gitKey("slow", "/srv/x")]?.branch)
        // The late answers arrive now; nothing may change, and the connection carries on.
        withTimeout(5_000) { lateDoc.await(); lateGit.await() }
        delay(200)
        assertEquals("New", state.value.spaces.single { it.machine == "slow" }.name)
        assertEquals("new", state.value.git[Sidebar.gitKey("slow", "/srv/x")]?.branch)
        assertNull(lost)
        assertEquals(listOf("slow"), refresh(reads, listOf("slow")))
    }

    @Test fun anUnreachableMachineErrsFastAndHoldsBackNothing() = bounded {
        answer = { method, machine, params -> if (machine == "down") Reply.Fail("down: connection refused") else healthy(method, machine, params) }
        // A long time-box: an error must come back at once, not wait it out.
        val reads = reads(limit = 10_000)
        var start = System.currentTimeMillis()
        assertEquals(listOf("fast"), refresh(reads, listOf("fast", "down")))
        assertTrue("refresh took ${ms(start)} ms", ms(start) < SLACK)
        start = System.currentTimeMillis()
        val unsure = ConcurrentHashMap.newKeySet<Pair<String, String>>()
        reads.git(listOf(folder(""), folder("fast"), folder("down"))) { m, f -> unsure += m to f }
        assertTrue("git took ${ms(start)} ms", ms(start) < SLACK)
        assertEquals(setOf("down" to "/srv/x"), unsure.toSet())
        assertEquals(setOf("h1|", "h1|fast"), Teams.read(mapOf("h1" to state.value), System.currentTimeMillis()))
        // Its registry read fails too, at once, and keeps what was read before.
        state.update { it.copy(members = it.members + ("down|/srv/x" to listOf(Teams.Member("b-down", "Kept", true, null)))) }
        start = System.currentTimeMillis()
        reads.registries(listOf("down" to "/srv/x"))
        assertTrue(ms(start) < SLACK)
        assertEquals("Kept", state.value.members["down|/srv/x"]?.single()?.name)
        assertNull(lost)
    }

    @Test fun theCoresOwnMachineReadsOutsideThePool() = bounded {
        answer = { method, machine, params -> if (machine == "slow") Reply.Never else healthy(method, machine, params) }
        val pool = Semaphore(1)
        val reads = reads(pool)
        val stallStart = System.currentTimeMillis()
        val stalled = async(Dispatchers.IO) { reads.git(listOf(folder("slow"))) { _, _ -> } }
        withTimeout(SLACK) { while (pool.availablePermits > 0) delay(10) }   // slow holds the only slot
        // The core's own machine reads at once, while slow still holds it.
        val start = System.currentTimeMillis()
        reads.git(listOf(folder(""))) { _, _ -> }
        assertTrue("own took ${ms(start)} ms", ms(start) < SLACK)
        assertEquals(0, pool.availablePermits)
        assertTrue(state.value.git.containsKey(Sidebar.gitKey("", "/w/own")))
        // A linked machine waits for the slot: it can't finish before slow is given up.
        reads.git(listOf(folder("fast"))) { _, _ -> }
        assertTrue("fast finished ${ms(stallStart)} ms after the stall began", ms(stallStart) >= TIME_BOX)
        stalled.await()
        assertEquals(1, pool.availablePermits)
    }

    @Test fun aRefreshLandsTheCoresOwnFirstAndNeverWaitsForALinkedLayout() = bounded {
        val slowDocs = AtomicInteger()
        answer = { method, machine, params ->
            if (machine == "slow" && method == "doc.get") { slowDocs.incrementAndGet(); Reply.Never } else healthy(method, machine, params)
        }
        val reads = reads()
        val order = java.util.Collections.synchronizedList(mutableListOf<String>())
        val start = System.currentTimeMillis()
        val reading = reads.refresh(scope, terminals, listOf(own), listOf("fast", "slow"), linked, start,
            ownRead = {
                // The core's own terminals and spaces are already in when its alerts and git run.
                assertEquals(terminals, state.value.terminals)
                assertTrue("" in state.value.layouts && state.value.spaces.any { it.id == own.id })
                order += "own"
            }, linkedRead = { order += "linked" })
        assertTrue("refresh took ${ms(start)} ms", ms(start) < SLACK)
        assertEquals(listOf("own"), order)
        // fast lands as soon as it answers, while slow is still out.
        withTimeout(SLACK) { state.first { "fast" in it.layouts } }
        assertTrue(reading!!.isActive)
        assertEquals(listOf("", "fast"), state.value.spaces.map { it.machine })
        // A refresh meanwhile lands the core's own again, at once, and starts no second reading alongside: it runs
        // one more pass when this one ends.
        val again = System.currentTimeMillis()
        assertNull(reads.refresh(scope, terminals, listOf(own), listOf("fast", "slow"), linked, again, { order += "own" }, { order += "linked" }))
        assertTrue(ms(again) < SLACK)
        assertEquals(listOf("fast"), reading.await())
        assertEquals(listOf("own", "own", "linked", "linked"), order)
        assertEquals(2, slowDocs.get())
        assertTrue("slow" !in state.value.layouts)
    }

    @Test fun refreshesDuringALinkedReadingRunExactlyOneMoreWithTheNewestInputs() = bounded {
        val fastDocs = AtomicInteger(); val slowDocs = AtomicInteger()
        val fastName = java.util.concurrent.atomic.AtomicReference("Old")
        answer = { method, machine, params ->
            when {
                method == "doc.get" && machine == "fast" -> { fastDocs.incrementAndGet(); Reply.Now(layout(fastName.get())) }
                method == "doc.get" && machine == "slow" -> { slowDocs.incrementAndGet(); Reply.Never }
                else -> healthy(method, machine, params)
            }
        }
        val reads = reads()
        // Twenty refreshes at once from different threads (the connection's loop and pull to refresh): exactly one
        // starts a reading.
        val started = (1..20).map {
            async(Dispatchers.IO) { reads.refresh(scope, terminals, listOf(own), listOf("fast", "slow"), linked, System.currentTimeMillis(), {}, {}) }
        }.map { it.await() }.filterNotNull()
        assertEquals(1, started.size)
        // fast changes while slow holds the reading up; a refresh with the newest inputs (slow no longer listed) comes.
        withTimeout(SLACK) { state.first { "fast" in it.layouts } }
        fastName.set("Fresh")
        assertNull(reads.refresh(scope, terminals, listOf(own), listOf("fast"), linked, System.currentTimeMillis(), {}, {}))
        // When the reading ends, one more pass runs, with those inputs: fast is read again (no event needed), slow isn't.
        assertEquals(listOf("fast"), started.single().await())
        assertEquals("Fresh", state.value.spaces.single { it.machine == "fast" }.name)
        assertEquals(2, fastDocs.get())
        assertEquals(1, slowDocs.get())
        // Nothing is left out: the next refresh starts a reading again.
        assertTrue(reads.refresh(scope, terminals, listOf(own), listOf("fast"), linked, System.currentTimeMillis(), {}, {}) != null)
    }

    private companion object {
        const val TIME_BOX = 1_500L
        /** Room for a slow test machine; still far below the client's own 30 s. */
        const val SLACK = 1_000L
        /** No test here may run longer: a regression fails instead of hanging the suite. */
        const val TEST_LIMIT = 30_000L
    }
}
