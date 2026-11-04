package ai.namastex.automagik

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import kotlinx.coroutines.withTimeout
import org.json.JSONArray
import org.json.JSONObject

/**
 * The reads that fill one saved machine's Teams rows from its core: the docs of the machines it links to, and git and
 * the bot registries for every folder ([HostBatch]). Each machine is read on its own and at once (at most [pool] of
 * them), and every call is time-boxed, so a machine that stalls or can't be reached holds back only its own rows. A
 * call that gives up is over: [CoreClient] drops its answer if it comes later, so a late answer never overwrites what
 * was read since. [machine] reads this saved machine's state and [update] changes it.
 */
class HostReads(
    private val call: suspend (String, JSONObject) -> JSONObject,
    private val machine: () -> MachineState?,
    private val update: ((MachineState) -> MachineState) -> Unit,
    private val pool: Semaphore,
    private val limits: Limits = Limits(),
) {
    /** How long a doc read and a batch on the core's own machine or a linked one may take. */
    data class Limits(val doc: Long = 8_000L, val local: Long = 20_000L, val remote: Long = 15_000L)

    /** The doc [name] of each of [machines] ("" is the core's own), at once and time-boxed: null for one that didn't answer. */
    suspend fun docs(name: String, machines: List<String>): List<Pair<String, JSONObject?>> = coroutineScope {
        machines.map { m ->
            async { m to timeBoxed(limits.doc) { call("doc.get", JSONObject().put("name", name).apply { if (m.isNotBlank()) put("on", m) }) } }
        }.awaitAll()
    }

    /** What a linked reading reads: the machines ([names]), the terminals that name their spaces, and what runs after. */
    private class LinkedInputs(val terminals: List<CoreTerminal>, val names: List<String>, val linkedRead: suspend () -> Unit)
    private val lock = Any()
    /** A linked reading is out (guarded by [lock]). */
    private var running = false
    /** The newest inputs of a refresh that came while a reading was out: one more reading runs with them (by [lock]). */
    private var next: LinkedInputs? = null

    /**
     * One refresh. The core's own [terminals] and spaces ([own]) land at once, with the linked machines' spaces as last
     * read, and then [ownRead] runs (alerts, git): none of it waits for a linked machine. The linked machines' layouts
     * ([names]) are read in [scope], each landing as it answers, in Herdr's order; one that doesn't answer keeps its
     * spaces and isn't counted as read; [linkedRead] runs after. One reading at a time, so a stalled machine never piles
     * reads up: a refresh that comes while one is out starts none (null) but is kept, and when the reading ends one more
     * runs with the newest such inputs, so no linked change waits for the next event. The reading answers which
     * machines its last pass laid out.
     */
    suspend fun refresh(scope: CoroutineScope, terminals: List<CoreTerminal>, own: List<PocketSpace>, names: List<String>,
                        linked: List<LinkedMachine>, now: Long, ownRead: suspend () -> Unit, linkedRead: suspend () -> Unit): Deferred<List<String>>? {
        // The linked spaces taken inside the update, so a layout landing meanwhile is never overwritten.
        update { m -> reading(m, terminals, own + m.spaces.filter { it.machine.isNotBlank() && it.machine in names }, linked, emptyList(), now) }
        ownRead()
        return startLinked(scope, LinkedInputs(terminals, names, linkedRead))
    }

    /** Starts a linked reading with [inputs], or keeps them for one more pass if one is out (null). */
    private fun startLinked(scope: CoroutineScope, inputs: LinkedInputs): Deferred<List<String>>? {
        // Checked and claimed at once: refreshes come from more than one coroutine (the connection's, pull to refresh).
        val starts = synchronized(lock) { if (running) { next = inputs; false } else { running = true; true } }
        if (!starts) return null
        return scope.async {
            var pass = inputs
            var answered: List<String>
            while (true) {
                answered = readLinked(pass)
                pass.linkedRead()
                pass = synchronized(lock) { next.also { next = null; if (it == null) running = false } } ?: break
            }
            answered
        }.also { reading ->
            // Failed or cancelled (even before it started): freed. A refresh kept meanwhile still gets its pass, unless
            // the reading was cancelled (the connection or the app is going).
            reading.invokeOnCompletion { cause ->
                if (cause == null) return@invokeOnCompletion
                val kept = synchronized(lock) { running = false; next.also { next = null } }
                if (kept != null && cause !is CancellationException) startLinked(scope, kept)
            }
        }
    }

    /** One pass over [pass]'s linked machines, each landing as it answers: the ones laid out. */
    private suspend fun readLinked(pass: LinkedInputs): List<String> {
        val session = machine()?.session ?: return emptyList()
        return coroutineScope {
            pass.names.map { name ->
                async {
                    val doc = timeBoxed(limits.doc) { call("doc.get", JSONObject().put("name", "herdr-app").put("on", name)) }
                        ?: return@async null
                    val spaces = LayoutReader.spaces(doc.optJSONObject("value"), name, pass.terminals)
                    update { laidOut(it, name, spaces, session, System.currentTimeMillis()) }
                    name
                }
            }.awaitAll().filterNotNull()
        }
    }

    /**
     * Git for [folders] ((machine, folder) pairs), each machine at once, space folders first (in the order given), one
     * call per [HostBatch.CHUNK] folders. A folder with no clear answer goes to [unsure] and keeps its last answer.
     */
    suspend fun git(folders: List<Pair<String, String>>, unsure: (machine: String, folder: String) -> Unit) = coroutineScope {
        folders.groupBy({ it.first }, { it.second }).map { (m, list) -> async { slot(m) { gitMachine(m, list, unsure) } } }.awaitAll()
        Unit
    }

    /** Bot names and registries ([Teams.registry]) of [projects] ((machine, project key) pairs), each machine at once. */
    suspend fun registries(projects: List<Pair<String, String>>) = coroutineScope {
        projects.distinct().groupBy({ it.first }, { it.second }).map { (m, keys) -> async { slot(m) { readRegistries(m, keys) } } }.awaitAll()
        Unit
    }

    /** The core's own machine reads at once; a linked one waits for one of the [pool]'s slots, so stalled ones can't crowd it out. */
    private suspend fun <T> slot(m: String, block: suspend () -> T): T = if (m.isBlank()) block() else pool.withPermit { block() }

    private suspend fun gitMachine(m: String, folders: List<String>, unsure: (String, String) -> Unit) {
        val chunks = folders.chunked(HostBatch.CHUNK)
        for ((i, chunk) in chunks.withIndex()) {
            // A machine that didn't answer (timed out, unreachable) is given up for this pass: one wait, not one per batch.
            val out = exec(m, HostBatch.argv(HostBatch.GIT, chunk))
                ?: return chunks.drop(i).flatten().forEach { unsure(m, it) }
            val answers = HostBatch.git(out, chunk)
            val found = HashMap<String, GitInfo?>()
            chunk.zip(answers).forEach { (folder, answer) ->
                when (answer) {
                    is HostBatch.Git.Repo -> found[Sidebar.gitKey(m, folder)] = answer.info
                    HostBatch.Git.NotRepo -> found[Sidebar.gitKey(m, folder)] = null
                    HostBatch.Git.Unsure -> unsure(m, folder)
                }
            }
            if (found.isEmpty()) continue
            val named = machine()?.bots.orEmpty()
            update { it.copy(git = it.git + found) }
            // Projects first seen after the meter read: their bot names now, once (a missing file is stored as empty).
            val fresh = found.values.mapNotNull(SpaceFeed::projectKey).distinct().filter { "$m|$it" !in named }
            if (fresh.isNotEmpty()) readRegistries(m, fresh)
        }
    }

    private suspend fun readRegistries(m: String, projects: List<String>) {
        val state = machine() ?: return
        if (m.isNotBlank() && state.linked.find { it.name == m }?.connected != true) return
        for (chunk in projects.filter { it.startsWith("/") }.distinct().chunked(HostBatch.CHUNK)) {
            // One that didn't answer is given up for this pass; the projects not read keep what they had.
            val files = exec(m, HostBatch.argv(HostBatch.FILES, chunk.map(Teams.registry::path)))?.let { HostBatch.files(it, chunk.size) } ?: return
            val names = HashMap<String, SpaceFeed.Names>()
            val members = HashMap<String, List<Teams.Member>>()
            chunk.zip(files).forEach { (key, file) ->
                val k = "$m|$key"
                when (file) {
                    is HostBatch.File.Found -> { names[k] = SpaceFeed.names(file.text); members[k] = Teams.registry.parse(file.text) }
                    HostBatch.File.Missing -> { names[k] = SpaceFeed.Names(); members[k] = emptyList() }
                    // A read that failed keeps the bots read before.
                    HostBatch.File.Unreadable -> { names[k] = state.bots[k] ?: SpaceFeed.Names(); members[k] = state.members[k].orEmpty() }
                }
            }
            update { it.copy(bots = it.bots + names, members = it.members + members) }
        }
    }

    /** [argv] run on [m] ("" the core's own), time-boxed: its output, or null if it failed, timed out or exited non-zero. */
    private suspend fun exec(m: String, argv: List<String>): ByteArray? {
        val params = JSONObject().put("argv", JSONArray(argv))
        if (m.isNotBlank()) params.put("on", m)
        val r = timeBoxed(if (m.isBlank()) limits.local else limits.remote) { call("machine.exec", params) } ?: return null
        if (r.optBoolean("timed_out") || r.optInt("code", -1) != 0) return null
        return runCatching { java.util.Base64.getDecoder().decode(r.optString("stdout")) }.getOrNull()
    }

    companion object {
        /** At most this many machines read at once. */
        const val POOL = 6

        /**
         * [m] after a reading of its terminals and spaces: [laidOut] lists the linked machines whose layouts answered
         * (the core's own always did). Each machine's first reading in this session is when [Teams.ready]'s grace starts.
         */
        fun reading(m: MachineState, terminals: List<CoreTerminal>, spaces: List<PocketSpace>, linked: List<LinkedMachine>,
                    laidOut: Collection<String>, now: Long): MachineState {
            val layouts = if (m.readSession == m.session) m.layouts else emptyMap()
            return m.copy(terminals = terminals, spaces = spaces, linked = linked, error = null, readSession = m.session,
                layouts = layouts + (laidOut + "").filter { it !in layouts }.associateWith { now })
        }

        /**
         * [m] with linked machine [name]'s [spaces] from its layout, read in [session]: they replace its earlier ones,
         * in Herdr's order of the linked machines, and it counts as read ([MachineState.layouts]) from [now]. Nothing
         * changes if the connection moved on to another session, or [name] is no longer linked and up.
         */
        fun laidOut(m: MachineState, name: String, spaces: List<PocketSpace>, session: Int, now: Long): MachineState {
            if (m.session != session || m.readSession != session || m.linked.none { it.name == name && it.connected }) return m
            val order = m.linked.map { it.name }
            val all = (m.spaces.filter { it.machine != name } + spaces)
                .sortedBy { s -> if (s.machine.isBlank()) -1 else order.indexOf(s.machine).let { if (it < 0) Int.MAX_VALUE else it } }
            return m.copy(spaces = all, layouts = if (name in m.layouts) m.layouts else m.layouts + (name to now))
        }

        /** [block]'s answer, or null if it failed or took longer than [ms]; a real cancel is passed on. */
        suspend fun <T> timeBoxed(ms: Long, block: suspend () -> T): T? = try { withTimeout(ms) { block() } }
            catch (_: TimeoutCancellationException) { null } catch (e: CancellationException) { throw e } catch (_: Exception) { null }
    }
}

/**
 * The reads kept per saved machine, one per live connection: they hold its linked reading ([HostReads.refresh]), so
 * only the live connection's are kept. A connection that isn't the live one (closed, or replaced by a reconnect) gets
 * reads of its own, never kept, and its late loss never drops the live connection's.
 */
class KeptReads<C : Any, R : Any> {
    private val kept = java.util.concurrent.ConcurrentHashMap<String, Pair<C, R>>()
    /** [client]'s reads of [id], kept if it is the [live] connection; [make] makes new ones. */
    fun get(id: String, client: C, live: C?, make: () -> R): R {
        if (live !== client) return make()
        return kept.compute(id) { _, held -> if (held?.first === client) held else client to make() }!!.second
    }
    /** [client]'s connection to [id] was lost: its reads go, never another connection's. */
    fun lost(id: String, client: C) { kept.computeIfPresent(id) { _, held -> if (held.first === client) null else held } }
    /** [id] was disconnected or removed: whatever was kept goes. */
    fun drop(id: String) { kept.remove(id) }
}
