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
    @After fun close() { client.close(); scope.cancel() }

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
    private suspend fun refresh(reads: HostReads, machines: List<String>): List<String> {
        val (spaces, answered) = reads.layouts(machines, terminals, state.value.spaces)
        state.update { HostReads.reading(it, terminals, listOf(own) + spaces, linked, answered, System.currentTimeMillis()) }
        return answered
    }
    private fun folder(m: String) = m to (if (m.isBlank()) "/w/own" else "/srv/x")
    private fun ms(start: Long) = System.currentTimeMillis() - start

    @Test fun aStalledMachineHoldsBackOnlyItsOwnRowsAndNeverWedgesThePoolOrARefresh() = runBlocking {
        answer = { method, machine, params -> if (machine == "slow") Reply.Never else healthy(method, machine, params) }
        val reads = reads(pool = Semaphore(2))
        // A refresh while slow never answers: it gives up at the time-box (not the client's 30 s), every time.
        repeat(2) {
            val start = System.currentTimeMillis()
            assertEquals(listOf("fast"), refresh(reads, listOf("fast", "slow")))
            assertTrue("refresh took ${ms(start)} ms", ms(start) in TIME_BOX..(TIME_BOX + SLACK))
        }
        // Now slow's layout answers but its git stalls (what a slow linked machine did): its space waits for git,
        // and must not hold fast back. Git: fast and the core's own fill in without waiting for slow, which holds a
        // pool permit until its time-box.
        answer = { method, machine, params -> if (machine == "slow" && method != "doc.get") Reply.Never else healthy(method, machine, params) }
        assertEquals(listOf("fast", "slow"), refresh(reads, listOf("fast", "slow")))
        val start = System.currentTimeMillis()
        // Bounded: a regression must fail here, not hang the suite.
        val fastLive = async { withTimeout(3 * TIME_BOX) { state.first { Teams.read(mapOf("h1" to it), System.currentTimeMillis()).contains("h1|fast") } }; ms(start) }
        val unsure = ConcurrentHashMap.newKeySet<Pair<String, String>>()
        val stalled = async { reads.git(listOf(folder("slow"))) { m, f -> unsure += m to f } }
        reads.git(listOf(folder(""), folder("fast"))) { m, f -> unsure += m to f }
        assertTrue("fast went live after ${fastLive.await()} ms", fastLive.await() < TIME_BOX)
        stalled.await()
        assertEquals(setOf("slow" to "/srv/x"), unsure.toSet())
        assertTrue("the stall was given up at ${ms(start)} ms", ms(start) in TIME_BOX..(TIME_BOX + SLACK))
        // The pool is whole again: a pass now takes no time.
        val again = System.currentTimeMillis()
        reads.git(listOf(folder("fast"))) { _, _ -> }
        assertTrue(ms(again) < SLACK)

        // What the Teams tab shows: fast and the core's own live and answerable; slow from the cache, stale, no card.
        val now = System.currentTimeMillis()
        val read = Teams.read(mapOf("h1" to state.value), now)
        assertEquals(setOf("h1|", "h1|fast"), read)
        val cachedSlow = Teams.Team("h1|slow|/srv/x", "h1", "slow", "/srv/x", "Slow", Teams.Icon.Letter, null,
            listOf(Teams.Bot("b-slow", "Bot", true, null, Teams.NEEDS_YOU, "Run it?", 7, TerminalRef("h1", "slow/t1"), "permission")))
        val shown = Teams.merge(Teams.live(mapOf("h1" to state.value), read, now), listOf(cachedSlow), read, setOf("h1"))
        assertEquals(setOf("b-own", "b-fast"), Teams.deck(shown).map { it.second.id }.toSet())
        assertEquals(TerminalRef("h1", "fast/t1"), shown.single { it.machine == "fast" }.bots.single().ref)
        assertTrue(state.value.spaces.any { it.machine == "slow" })   // laid out, but its git never answered
        val slow = shown.single { it.machine == "slow" }
        assertTrue(slow.stale)
        assertNull(slow.bots.single().ref)
        assertEquals("Bot", shown.single { it.machine == "fast" }.bots.single().name)   // fast's registry was read too
        assertNull(lost)
    }

    @Test fun aLateAnswerNeverOverwritesWhatWasReadSince() = runBlocking {
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

    @Test fun anUnreachableMachineErrsFastAndHoldsBackNothing() = runBlocking {
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

    private companion object {
        const val TIME_BOX = 1_500L
        /** Room for a slow test machine; still far below the client's own 30 s. */
        const val SLACK = 1_000L
    }
}
