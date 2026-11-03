package ai.namastex.automagik

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

    /** Deletes the old SSH key folder older versions kept in no-backup storage, if [hosts] no longer need it. */
    fun deleteKeyIfUnused(identityRoot: File, hosts: List<HostProfile>): Boolean {
        if (!keyDeletable(hosts)) return false
        val folder = File(identityRoot, "ssh")
        return !folder.exists() || folder.deleteRecursively()
    }
}
