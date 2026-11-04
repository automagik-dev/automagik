package ai.namastex.automagik

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class WithMachineTest {
    @Test fun aReadingThatFinishesAfterItsMachineWasRemovedDoesNotBringItBack() {
        val saved = PocketState(hosts = listOf(HostProfile("h1", "Desk", "abc", "", 0)))
        val connected = saved.withMachine("h1") { it.copy(connected = true) }
        assertTrue(connected.machines.getValue("h1").connected)
        // removeHost: gone from the saved list and the shown machines; a late update changes nothing.
        val removed = connected.copy(hosts = emptyList(), machines = emptyMap())
        assertEquals(removed, removed.withMachine("h1") { it.copy(connected = false, error = "late") })
        // A machine shown but not saved (the preview) still updates.
        val preview = PocketState(machines = mapOf("p" to MachineState()))
        assertTrue(preview.withMachine("p") { it.copy(connected = true) }.machines.getValue("p").connected)
    }
}
