package ai.namastex.automagik

import android.Manifest
import android.app.Application
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

/**
 * The chat composer's mic writes into the draft that is current when the words arrive, not the one it had at the tap:
 * sending or typing while it listens must not bring back, or overwrite, what the person did meanwhile.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class ChatComposerMicTest {
    @get:Rule val compose = createComposeRule()

    /** Stands in for Android's recognizer; the test decides when the words arrive. */
    private class FakeEngine : DictateEngine {
        var result: ((String) -> Unit)? = null
        override fun start(onResult: (String) -> Unit, onError: (Int) -> Unit) { result = onResult }
        override fun stop() {}
        override fun destroy() {}
        fun heard(words: String) = result?.invoke(words)
    }

    @Before fun grantMicrophone() {
        shadowOf(ApplicationProvider.getApplicationContext<Application>()).grantPermissions(Manifest.permission.RECORD_AUDIO)
    }

    @Test fun wordsArrivingAfterSendJoinTheEmptyDraft() {
        var draft by mutableStateOf("")
        val engine = FakeEngine()
        compose.setContent { ChatComposer(draft, { draft = it }, { draft = "" }, enabled = true, name = "Reviewer", engine = engine) }
        compose.onNode(hasSetTextAction()).performTextInput("hello")
        compose.onNodeWithContentDescription("Speak").performClick()
        compose.onNodeWithContentDescription("Send message").performClick()
        compose.runOnIdle { assertEquals("", draft) }
        engine.heard("world")
        compose.runOnIdle { assertEquals("world", draft) }
    }

    @Test fun wordsArrivingAfterTypingKeepWhatWasTyped() {
        var draft by mutableStateOf("")
        val engine = FakeEngine()
        compose.setContent { ChatComposer(draft, { draft = it }, { draft = "" }, enabled = true, name = "Reviewer", engine = engine) }
        compose.onNode(hasSetTextAction()).performTextInput("hello")
        compose.onNodeWithContentDescription("Speak").performClick()
        compose.onNode(hasSetTextAction()).performTextInput(" there")
        compose.runOnIdle { assertEquals("hello there", draft) }
        engine.heard("world")
        compose.runOnIdle { assertEquals("hello there world", draft) }
    }
}
