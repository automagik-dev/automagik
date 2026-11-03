package ai.namastex.automagik

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
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

    @Test fun noSshClientIsLeftInTheApp() {
        assertThrows(ClassNotFoundException::class.java) { Class.forName("com.jcraft.jsch.JSch") }
    }
}
