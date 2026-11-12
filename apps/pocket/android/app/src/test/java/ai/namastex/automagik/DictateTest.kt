package ai.namastex.automagik

import android.speech.SpeechRecognizer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** The mic fills a composer's field: the heard words alone, or after the typed draft with exactly one space. */
class DictateTest {
    @Test fun heardWordsReplaceAnEmptyDraft() {
        assertEquals("open the gates", dictated("", "open the gates"))
        assertEquals("open the gates", dictated("   ", "  open the gates "))
    }

    @Test fun heardWordsFollowTheTypedDraftWithOneSpace() {
        assertEquals("run the tests now", dictated("run the tests", "now"))
        assertEquals("run the tests now", dictated("run the tests ", " now "))
    }

    @Test fun nothingHeardLeavesTheDraftAlone() {
        assertEquals("half typed", dictated("half typed", ""))
        assertEquals("half typed", dictated("half typed", "   "))
        assertEquals("", dictated("", " "))
    }

    /** A failed listen must say why: a network failure cannot look like a silent button. */
    @Test fun aFailedListenSaysWhy() {
        assertEquals(DICTATE_PERMISSION, dictateError(SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS))
        assertTrue(dictateError(SpeechRecognizer.ERROR_NETWORK).contains("connection"))
        assertTrue(dictateError(SpeechRecognizer.ERROR_NETWORK_TIMEOUT).contains("connection"))
        assertTrue(dictateError(SpeechRecognizer.ERROR_NO_MATCH).contains("catch"))
        assertEquals("Speech recognition failed. Try again.", dictateError(999))
    }
}
