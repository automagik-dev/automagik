package ai.namastex.automagik

import android.webkit.WebView
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

/** Suspect 1: the terminal page pauses while the app is stopped. pauseTimers has no shadow, so it is left out here. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class BackgroundWebViewTest {
    @Test fun aStoppedTerminalPagePausesAndAStartedOneResumes() {
        val page = WebView(ApplicationProvider.getApplicationContext())
        page.started(false, timers = false)
        assertTrue("paused", shadowOf(page).wasOnPauseCalled())
        page.started(true, timers = false)
        assertTrue("resumed", shadowOf(page).wasOnResumeCalled())
    }
}
