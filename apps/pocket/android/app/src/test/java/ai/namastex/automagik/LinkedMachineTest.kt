package ai.namastex.automagik

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test

class LinkedMachineTest {
    @Test fun listsEveryMachineAndCountsItsTerminalsByAddressPrefix() {
        val response = JSONObject("""{"machines":[{"name":"workstation","state":"connected"},{"name":"desktop","state":"disconnected"},{"name":""}],
            "terminals":[{"address":"t1"},{"address":"workstation/t1"},{"address":"workstation/t2"},{"address":"desktop/t8"}]}""")
        val terminals = response.getJSONArray("terminals").objects().map(CoreTerminal::parse)
        assertEquals(listOf(LinkedMachine("workstation", "connected", 2), LinkedMachine("desktop", "disconnected", 1)), LinkedMachine.list(response, terminals))
    }
    @Test fun hostProfileKeepsLinkedMachinesAndReadsOlderSavedHosts() {
        val host = HostProfile("id", "Mac", "10.0.0.2", "me", linked = listOf("workstation", "laptop"))
        assertEquals(host, HostProfile.parse(host.json()))
        val old = JSONObject("""{"id":"id","name":"Mac","host":"10.0.0.2","user":"me"}""")
        assertEquals(emptyList<String>(), HostProfile.parse(old).linked)
    }
}
