package ai.namastex.automagik

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.nio.file.Files

/** Machines saved over SSH before RFC 0008: shown, never connected, replaced once paired with QR. */
class LegacySshTest {
    private val ssh = HostProfile("s1", "Workstation", "workstation.example", "me", 2222, session = "work", linked = listOf("Laptop"))
    private val other = HostProfile("s2", "Server", "server.example", "me")
    private val desk = HostProfile("p1", "Desk", "0123456789ab", "", 0, transport = "iroh", ticket = "ticket-1")
    private val paired = HostProfile("p2", "Studio", "abcdef012345", "", 0, transport = "iroh", ticket = "ticket-2")

    @Test fun aSavedSshMachineShowsTheRepairState() {
        assertTrue(ssh.legacySsh)
        assertEquals("Pair again with QR", machineStatus(ssh, MachineState()))
        assertEquals("Pair with QR", LegacySsh.ACTION)
        assertTrue(ssh.address.endsWith("SSH, no longer supported"))
        // A paired desktop keeps its usual status.
        assertEquals("Not connected", machineStatus(desk, MachineState()))
    }

    @Test fun pairingFromTheCardReplacesItInPlace() {
        val hosts = LegacySsh.afterPairing(listOf(desk, ssh, other), paired, replacing = ssh.id)
        assertEquals(listOf("p1", "p2", "s2"), hosts.map { it.id })
        // The new card keeps the old entry's core session and remembered machines.
        assertEquals("work", hosts[1].session); assertEquals(listOf("Laptop"), hosts[1].linked)
    }

    @Test fun pairingAnAlreadyPairedDesktopStillRemovesTheSshEntry() {
        val again = desk.copy(ticket = "ticket-3")
        val hosts = LegacySsh.afterPairing(listOf(desk, ssh), again, replacing = ssh.id)
        assertEquals(listOf(again), hosts)
    }

    @Test fun pairingElsewhereLosesNothing() {
        assertEquals(listOf(ssh, other, paired), LegacySsh.afterPairing(listOf(ssh, other), paired, replacing = null))
        // Only a legacy entry is ever replaced.
        assertEquals(listOf(desk, paired), LegacySsh.afterPairing(listOf(desk), paired, replacing = desk.id))
    }

    @Test fun theSshKeyGoesOnlyOnceNoSshMachineRemains() {
        val root = Files.createTempDirectory("pocket-identity-").toFile()
        try {
            val key = File(root, "ssh/id_ed25519").apply { parentFile!!.mkdirs(); writeText("synthetic") }
            assertFalse(LegacySsh.deleteKeyIfUnused(root, listOf(desk, ssh)))
            assertTrue(key.exists())
            assertTrue(LegacySsh.deleteKeyIfUnused(root, listOf(desk)))
            assertFalse(File(root, "ssh").exists())
            assertTrue("nothing to delete is fine", LegacySsh.deleteKeyIfUnused(root, emptyList()))
        } finally { root.deleteRecursively() }
    }

    private val link = "herdr-pocket://pair?v=1&n=Studio&c=Zx9_-aB3cD4eF5gH6iJ7kQ&t=endpoint" + "abcdefghijklmnopqrstuvwxyz234567".repeat(4)
    private val saved = PocketState(hosts = listOf(desk, ssh))

    @Test fun theCardsButtonSetsTheRepairTargetAndCancelClearsIt() {
        val started = LegacySsh.start(saved, ssh.id)
        assertEquals(ssh.id, started.repairing)
        assertNull(LegacySsh.cancel(started).repairing)
        // Only a legacy card can be a target.
        assertNull(LegacySsh.start(saved, desk.id).repairing)
        assertNull(LegacySsh.start(saved, "gone").repairing)
    }

    @Test fun aScanFromTheCardPairsForThatCardAndUsesTheTargetUp() {
        val (after, scan) = LegacySsh.scanned(LegacySsh.start(saved, ssh.id), link)
        assertEquals(ssh.id, (scan as LegacySsh.Scan.Pair).replacing)
        assertEquals("Studio", scan.link.name)
        assertNull(after.repairing)
    }

    @Test fun aCancelledScanChangesNothingButTheTarget() {
        val (after, scan) = LegacySsh.scanned(LegacySsh.start(saved, ssh.id), null)
        assertEquals(LegacySsh.Scan.Cancelled, scan)
        assertNull(after.repairing); assertEquals(saved.hosts, after.hosts); assertNull(after.message)
    }

    @Test fun aWrongCodeLeavesNoStaleTarget() {
        val (after, scan) = LegacySsh.scanned(LegacySsh.start(saved, ssh.id), "https://example.com")
        assertEquals(LegacySsh.Scan.Invalid, scan)
        assertNull(after.repairing); assertEquals(LegacySsh.NOT_A_LINK, after.message)
        // So a later scan from the general dialog replaces nothing.
        assertNull((LegacySsh.scanned(after, link).second as LegacySsh.Scan.Pair).replacing)
    }

    @Test fun connectRefusesALegacyEntry() {
        assertEquals(LegacySsh.REFUSED, LegacySsh.refusal(ssh))
        assertNull(LegacySsh.refusal(desk))
    }

    @Test fun anUnreadableSavedListKeepsTheKey() {
        assertNull(LegacySsh.loadHosts("not json"))
        assertEquals(listOf(ssh), LegacySsh.loadHosts(org.json.JSONArray(listOf(ssh.json())).toString()))
        assertEquals(emptyList<HostProfile>(), LegacySsh.loadHosts(null))
        val root = Files.createTempDirectory("pocket-identity-").toFile()
        try {
            val key = File(root, "ssh/id_ed25519").apply { parentFile!!.mkdirs(); writeText("synthetic") }
            assertFalse(LegacySsh.deleteKeyIfUnused(root, LegacySsh.loadHosts("not json")))
            assertTrue(key.exists())
        } finally { root.deleteRecursively() }
    }

    @Test fun noSshClientIsLeftInTheApp() {
        assertThrows(ClassNotFoundException::class.java) { Class.forName("com.jcraft.jsch.JSch") }
    }
}
