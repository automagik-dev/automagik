package ai.namastex.automagik

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** The Machines tab's cards: saved hosts, plus the preview's sample machine while the demo runs. */
class MachinesTest {
    private val preview = MachineState(connected = true, version = "preview", terminals = listOf(CoreTerminal("t1", "Shell", "~/work", "live", "", "zsh", "", 80, 24)))
    private val saved = HostProfile("h1", "Workstation", "10.0.0.2", "me")

    @Test fun demoShowsItsSampleMachineConnected() {
        val state = PocketState(hosts = listOf(saved), machines = mapOf("preview" to preview, "h1" to MachineState()), demo = true)
        assertEquals(listOf("preview" to preview), state.previewMachines())
        assertEquals("Connected · hc preview · 1 terminals", machineStatus(state.previewMachines().single().second))
    }

    @Test fun outsideTheDemoOnlySavedHostsShow() {
        assertTrue(PocketState(machines = mapOf("preview" to preview)).previewMachines().isEmpty())
        assertEquals("Not connected", machineStatus(MachineState())); assertEquals("Connecting…", machineStatus(MachineState(connecting = true)))
    }
}
