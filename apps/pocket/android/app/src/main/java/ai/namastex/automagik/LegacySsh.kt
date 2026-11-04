package ai.namastex.automagik

import org.json.JSONArray
import java.io.File

/**
 * Machines saved over SSH before SSH was dropped (RFC 0008). The app never connects to one again: its card stays,
 * greyed, with one way forward, "Pair with QR". Once that computer pairs through Pocket Link the old entry goes,
 * and once no such entry is left the phone's old SSH key is deleted too.
 */
object LegacySsh {
    /** A legacy card's status line, in place of the connection status. */
    const val STATUS = "Pair again with QR"
    /** A legacy card's one button: it opens the QR scanner. */
    const val ACTION = "Pair with QR"
    /** What connecting to one says, should anything still ask. */
    const val REFUSED = "SSH is no longer supported. Pair this computer again with QR."
    const val NOT_A_LINK = "That isn’t a Pocket Link pairing link."

    /** What a finished QR scan does: nothing (cancelled), say it wasn't a pairing code, or pair. */
    sealed interface Scan {
        data object Cancelled : Scan
        data object Invalid : Scan
        /** [replacing]: the legacy card whose "Pair with QR" opened this scan, or null. */
        data class Pair(val link: PairingLink, val replacing: String?) : Scan
    }

    /** A legacy card's "Pair with QR": the scan it opens is for that card. Any other id is ignored. */
    fun start(state: PocketState, hostId: String): PocketState =
        if (state.hosts.any { it.id == hostId && it.legacySsh }) state.copy(repairing = hostId) else state

    /** Pairing started anywhere else (the general dialog, a pasted or external link) replaces no card. */
    fun cancel(state: PocketState): PocketState = state.copy(repairing = null)

    /** A scan's result, cancelled or not, uses up the re-pair target, so nothing later can pick up a stale one. */
    fun scanned(state: PocketState, text: String?): kotlin.Pair<PocketState, Scan> {
        val cleared = cancel(state)
        if (text == null) return cleared to Scan.Cancelled
        val link = PairingLink.parse(text) ?: return cleared.copy(message = NOT_A_LINK) to Scan.Invalid
        return cleared to Scan.Pair(link, state.repairing)
    }

    /** Why [connect][PocketViewModel.connect] won't dial [profile], or null when it may. */
    fun refusal(profile: HostProfile): String? = if (profile.legacySsh) REFUSED else null

    /** The saved machines from preferences, or null when they can't be read (not the same as none saved). */
    fun loadHosts(json: String?): List<HostProfile>? =
        runCatching { JSONArray(json ?: "[]").objects().map(HostProfile::parse) }.getOrNull()

    /**
     * The saved machines after [paired] paired through Pocket Link, started from the legacy card [replacing] (or from
     * anywhere else, when null). [paired] takes the place of an earlier card of the same desktop, else of [replacing],
     * else goes last. The legacy entry is removed only here, after the pairing succeeded: nothing is lost on a failed
     * or cancelled scan. A new card keeps the legacy entry's core session and its remembered machines.
     */
    fun afterPairing(hosts: List<HostProfile>, paired: HostProfile, replacing: String?): List<HostProfile> {
        val old = hosts.find { it.id == replacing && it.legacySsh }
        val known = hosts.any { it.id == paired.id }
        val profile = if (old != null && !known) paired.copy(session = old.session, linked = old.linked) else paired
        val placed = when {
            known -> hosts.map { if (it.id == profile.id) profile else it }
            old != null -> hosts.map { if (it.id == old.id) profile else it }
            else -> hosts + profile
        }
        return if (old != null && known) placed.filter { it.id != old.id } else placed
    }

    /** The phone's old SSH key may go once no machine saved over SSH is left to pair again. */
    fun keyDeletable(hosts: List<HostProfile>): Boolean = hosts.none { it.legacySsh }

    /** Deletes the old SSH key folder older versions kept in no-backup storage, if [hosts] no longer need it.
     *  [hosts] null: the saved list couldn't be read, so SSH entries may still be there and the key stays. */
    fun deleteKeyIfUnused(identityRoot: File, hosts: List<HostProfile>?): Boolean {
        if (hosts == null || !keyDeletable(hosts)) return false
        val folder = File(identityRoot, "ssh")
        return !folder.exists() || folder.deleteRecursively()
    }
}
