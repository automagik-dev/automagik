package ai.namastex.automagik

import org.junit.Assert.assertEquals
import org.junit.Test

class KeptReadsTest {
    private val old = Any()
    private val new = Any()

    @Test fun anOldConnectionsLateLossAfterAReconnectKeepsTheNewOnesReads() {
        val kept = KeptReads<Any, String>()
        assertEquals("old", kept.get("h1", old, live = old) { "old" })
        // Reconnected: the new connection's reads replace the old one's and are kept.
        assertEquals("new", kept.get("h1", new, live = new) { "new" })
        assertEquals("new", kept.get("h1", new, live = new) { "again" })
        // The old connection's loss arrives late: the new connection keeps its reads (and its one linked reading).
        kept.lost("h1", old)
        assertEquals("new", kept.get("h1", new, live = new) { "again" })
        // Its own loss does drop them.
        kept.lost("h1", new)
        assertEquals("after", kept.get("h1", new, live = new) { "after" })
    }

    @Test fun aConnectionThatIsNotTheLiveOneIsNeverKept() {
        val kept = KeptReads<Any, String>()
        assertEquals("live", kept.get("h1", new, live = new) { "live" })
        // A pass still finishing on a replaced or closed connection gets reads of its own, and keeps nothing.
        assertEquals("stray", kept.get("h1", old, live = new) { "stray" })
        assertEquals("stray", kept.get("h1", old, live = null) { "stray" })
        assertEquals("live", kept.get("h1", new, live = new) { "other" })
        kept.drop("h1")
        assertEquals("fresh", kept.get("h1", new, live = new) { "fresh" })
    }
}
