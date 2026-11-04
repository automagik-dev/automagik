package ai.namastex.automagik

import android.content.Context
import androidx.room.Dao
import androidx.room.Database
import androidx.room.Entity
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.Transaction
import androidx.room.Upsert
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.sync.withLock

/**
 * The Teams tab's local copy (SQLite, through Room), in the app's private storage: the projects, their bots and each
 * bot's last known state, so the tab opens at once and offline; and today's peak of simultaneous agents, which only the
 * phone counts. The desktop stays the source: every reading of a machine replaces that machine's rows.
 */
@Entity(tableName = "team")
data class TeamRow(@PrimaryKey val id: String, val hostId: String, val machine: String, val key: String, val name: String,
                   val emoji: String?, val image: String?, val color: String?, val position: Int,
                   val merged: Double?, val agentMin: Double?)

@Entity(tableName = "bot", primaryKeys = ["teamId", "id"])
data class BotRow(val teamId: String, val id: String, val hostId: String, val name: String, val main: Boolean, val pet: String?,
                  val pose: String, val message: String, val statusMs: Long, val address: String?, val kind: String, val position: Int)

/** The most agents seen working at once on [day] (yyyy-mm-dd, the phone's own date), for a [scope]: "" is All, else a team id. */
@Entity(tableName = "day_stat", primaryKeys = ["day", "scope"])
data class DayStatRow(val day: String, val scope: String, val peak: Int)

@Dao
interface TeamsDao {
    @Query("SELECT * FROM team ORDER BY position") fun teams(): Flow<List<TeamRow>>
    @Query("SELECT * FROM bot ORDER BY teamId, position") fun bots(): Flow<List<BotRow>>
    @Query("SELECT * FROM day_stat WHERE day = :day") fun day(day: String): Flow<List<DayStatRow>>

    @Query("DELETE FROM team WHERE hostId IN (:hosts)") suspend fun dropTeams(hosts: List<String>)
    @Query("DELETE FROM bot WHERE hostId IN (:hosts)") suspend fun dropBots(hosts: List<String>)
    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun insertTeams(rows: List<TeamRow>)
    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun insertBots(rows: List<BotRow>)

    /** [hosts]' rows become [teams] and [bots]: one transaction, so a reader never sees a machine half written. */
    @Transaction suspend fun replace(hosts: List<String>, teams: List<TeamRow>, bots: List<BotRow>) {
        dropBots(hosts); dropTeams(hosts); insertTeams(teams); insertBots(bots)
    }

    @Query("DELETE FROM bot WHERE teamId IN (SELECT id FROM team WHERE hostId = :host AND machine = :machine)")
    suspend fun dropMachineBots(host: String, machine: String)
    @Query("DELETE FROM team WHERE hostId = :host AND machine = :machine") suspend fun dropMachineTeams(host: String, machine: String)
    /** The rows of [host]'s [machine] ("" its own core, else a linked machine) become [teams] and [bots], in one transaction. */
    @Transaction suspend fun replaceMachine(host: String, machine: String, teams: List<TeamRow>, bots: List<BotRow>) {
        dropMachineBots(host, machine); dropMachineTeams(host, machine); insertTeams(teams); insertBots(bots)
    }

    @Query("DELETE FROM bot WHERE teamId IN (SELECT id FROM team WHERE hostId = :host AND machine NOT IN (:keep))")
    suspend fun dropBotsExcept(host: String, keep: List<String>)
    @Query("DELETE FROM team WHERE hostId = :host AND machine NOT IN (:keep)") suspend fun dropTeamsExcept(host: String, keep: List<String>)
    /** [host]'s rows of every machine but [keep] go: machines it no longer links to. */
    @Transaction suspend fun keepMachines(host: String, keep: List<String>) { dropBotsExcept(host, keep); dropTeamsExcept(host, keep) }

    @Query("SELECT peak FROM day_stat WHERE day = :day AND scope = :scope") suspend fun peak(day: String, scope: String): Int?
    @Upsert suspend fun putDay(row: DayStatRow)
    @Query("DELETE FROM day_stat WHERE day < :day") suspend fun dropBefore(day: String)

    /** Raises each scope's peak for [day] to what is working now, never lowers it; older days are dropped. */
    @Transaction suspend fun raisePeaks(day: String, working: Map<String, Int>) {
        dropBefore(day)
        for ((scope, n) in working) if (n > (peak(day, scope) ?: -1)) putDay(DayStatRow(day, scope, n))
    }
}

@Database(entities = [TeamRow::class, BotRow::class, DayStatRow::class], version = 1, exportSchema = false)
abstract class TeamsDb : RoomDatabase() {
    abstract fun teams(): TeamsDao
    companion object {
        @Volatile private var instance: TeamsDb? = null
        fun get(context: Context): TeamsDb = instance ?: synchronized(this) {
            // A cache: a schema change rebuilds it from the desktop rather than migrating it.
            instance ?: Room.databaseBuilder(context.applicationContext, TeamsDb::class.java, "teams.db")
                .fallbackToDestructiveMigration(dropAllTables = true).build().also { instance = it }
        }
    }
}

/** The model and its rows, both ways. */
object TeamsCache {
    fun rows(teams: List<Teams.Team>): Pair<List<TeamRow>, List<BotRow>> =
        teams.mapIndexed { i, t ->
            TeamRow(t.id, t.hostId, t.machine, t.key, t.name, (t.icon as? Teams.Icon.Emoji)?.char, (t.icon as? Teams.Icon.Image)?.file,
                t.color, i, t.merged, t.agentMin)
        } to teams.flatMap { t ->
            t.bots.mapIndexed { i, b -> BotRow(t.id, b.id, t.hostId, b.name, b.main, b.pet, b.pose, b.message, b.statusMs, b.ref?.address, b.kind, i) }
        }

    fun teams(teams: List<TeamRow>, bots: List<BotRow>): List<Teams.Team> {
        val byTeam = bots.groupBy { it.teamId }
        return teams.sortedBy { it.position }.map { r ->
            val icon = r.emoji?.let { Teams.Icon.Emoji(it) } ?: r.image?.let { Teams.Icon.Image(it) } ?: Teams.Icon.Letter
            Teams.Team(r.id, r.hostId, r.machine, r.key, r.name, icon, r.color,
                byTeam[r.id].orEmpty().sortedBy { it.position }.map { b ->
                    Teams.Bot(b.id, b.name, b.main, b.pet, b.pose, b.message, b.statusMs, b.address?.let { TerminalRef(b.hostId, it) }, b.kind)
                }, r.merged, r.agentMin)
        }
    }
}

/**
 * The one writer of the Teams cache. A reading of the machines replaces the rows of each machine read far enough
 * ([Teams.ready]: a saved machine's own core and each machine it links to, on its own), even when it has no project
 * left, and writes nothing when its rows didn't change; it raises today's peaks only above what it already wrote.
 * Once a saved machine's own core is read, the rows of machines it no longer links to go. A removed machine's rows go
 * at once, and a reading taken before the removal never writes them back. It also keeps each feed's merges, so a bot
 * celebrates only a merge its own feed newly lists.
 */
class TeamsSync(private val dao: TeamsDao) {
    private val lock = kotlinx.coroutines.sync.Mutex()
    private val written = HashMap<String, Pair<List<TeamRow>, List<BotRow>>>()
    private val peaks = HashMap<String, Int>()
    private val seen = HashMap<String, Set<String>>()
    /** Each host's machines whose rows were last kept ([TeamsDao.keepMachines]). */
    private val kept = HashMap<String, List<String>>()
    /** Hosts removed from the phone: a reading taken before the removal must not write them back. */
    private val gone = HashSet<String>()

    /** Writes what changed; returns the bots to celebrate, as "team id|bot id". */
    suspend fun reading(all: Map<String, MachineState>, now: Long): Set<String> = lock.withLock {
        val machines = all.filterKeys { it !in gone }
        val read = Teams.read(machines, now)
        val teams = Teams.live(machines, read, now)
        for ((host, m) in machines) {
            // Positions across the host's live projects, so its machines keep Herdr's order between them.
            val (hostTeams, hostBots) = TeamsCache.rows(teams.filter { it.hostId == host })
            for (machine in m.layouts.keys) {
                val scope = Teams.scope(host, machine)
                if (scope !in read) continue
                val rows = hostTeams.filter { it.machine == machine }.let { t -> t.map { it.id }.toSet().let { ids -> t to hostBots.filter { it.teamId in ids } } }
                if (written[scope] == rows) continue
                dao.replaceMachine(host, machine, rows.first, rows.second)
                written[scope] = rows
            }
            // Its own core read: the machines it no longer links to go, rows and all (else they'd stay stale forever).
            if (Teams.scope(host, "") in read) {
                val keep = (listOf("") + m.linked.map { it.name }).distinct().sorted()
                if (kept[host] != keep) {
                    dao.keepMachines(host, keep)
                    kept[host] = keep
                    written.keys.removeAll { it.startsWith("$host|") && it.removePrefix("$host|") !in keep }
                }
            }
        }
        if (read.isNotEmpty()) {
            val day = Teams.day(now)
            val higher = Teams.working(teams).filter { (scope, n) -> n > (peaks["$day|$scope"] ?: -1) }
            if (higher.isNotEmpty()) {
                dao.raisePeaks(day, higher)
                for ((scope, n) in higher) peaks["$day|$scope"] = n
            }
        }
        val jump = HashSet<String>()
        // A feed is one machine's (hostId|machine, like a scope): only those read count.
        for ((feed, merges) in Teams.merges(machines).filterKeys { it in read }) {
            jump += Teams.celebrations(seen[feed], merges)
            seen[feed] = merges
        }
        jump
    }

    /** A machine removed from the phone: its cached projects and bots go, and its feeds' baselines. */
    suspend fun removed(host: String) = lock.withLock {
        gone += host
        kept.remove(host)
        dao.replace(listOf(host), emptyList(), emptyList())
        written.keys.removeAll { it.startsWith("$host|") }
        seen.keys.removeAll { it.startsWith("$host|") }
    }
}
