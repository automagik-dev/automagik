package ai.namastex.automagik

import org.junit.Assert.assertEquals
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
}
