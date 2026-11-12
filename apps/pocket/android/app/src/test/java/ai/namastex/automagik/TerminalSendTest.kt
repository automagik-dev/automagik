package ai.namastex.automagik

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** The terminal composer's Send follows the draft, not the preview or the connection label. */
class TerminalSendTest {
    @Test fun aDraftEnablesSend() {
        assertTrue(terminalSendEnabled("hello", sending = false))
        assertTrue(terminalSendEnabled("a four-line draft", sending = false))
    }

    @Test fun aBlankDraftOrAnInFlightSendKeepsItOff() {
        assertFalse(terminalSendEnabled("", sending = false))
        assertFalse(terminalSendEnabled("   ", sending = false))
        assertFalse(terminalSendEnabled("hello", sending = true))
    }
}
