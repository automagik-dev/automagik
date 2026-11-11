package ai.namastex.automagik

import android.Manifest
import android.app.Application
import android.graphics.Bitmap
import android.os.Handler
import android.os.Looper
import android.view.PixelCopy
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.io.File

/**
 * Landing capture only, never part of the app: copied into a scratch copy of apps/pocket by the steps in
 * apps/landing/assets/CAPTURES.md. Launches the real MainActivity, enters the app's own preview (the real
 * PocketViewModel.enterDemo, sample data) and saves what the real screens draw: Team and Home, light and dark.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "w393dp-h852dp-xxhdpi")
class PocketDemoShotsTest {
    @get:Rule val compose = createAndroidComposeRule<MainActivity>()

    private val out = File(requireNotNull(System.getenv("POCKET_SHOTS")) { "Set POCKET_SHOTS to an output folder" })

    @Before fun setUp() {
        // Draw through Android's HardwareRenderer (real shadows and layers), not a software canvas.
        System.setProperty("robolectric.pixelCopyRenderMode", System.getProperty("shots.render") ?: "hardware")
        shadowOf(ApplicationProvider.getApplicationContext<Application>()).grantPermissions(Manifest.permission.POST_NOTIFICATIONS)
        out.mkdirs()
    }

    /** Frames on the test clock, with real time in between for the pet atlas, which decodes on Dispatchers.IO. */
    private fun settle(ms: Long = 2_000) {
        var left = ms
        while (left > 0) {
            compose.mainClock.advanceTimeBy(100)
            compose.waitForIdle()
            Thread.sleep(40)
            left -= 100
        }
    }

    private fun shoot(name: String) {
        settle()
        val bitmap = grab()
        val file = File(out, "$name.png")
        file.outputStream().use { assertTrue(bitmap.compress(Bitmap.CompressFormat.PNG, 100, it)) }
        println("SHOT ${file.absolutePath} ${bitmap.width}x${bitmap.height}")
    }

    /** The activity's whole window, through Android's PixelCopy (Robolectric's native-graphics PixelCopy). */
    private fun grab(): Bitmap {
        val window = compose.activity.window
        val view = window.decorView
        val bitmap = Bitmap.createBitmap(view.width, view.height, Bitmap.Config.ARGB_8888)
        var code: Int? = null
        PixelCopy.request(window, bitmap, { code = it }, Handler(Looper.getMainLooper()))
        val looper = shadowOf(Looper.getMainLooper())
        var tries = 0
        while (code == null && tries++ < 300) { looper.idle(); if (code == null) Thread.sleep(10) }
        assertEquals(PixelCopy.SUCCESS, code)
        return bitmap
    }

    private fun capture(mode: String) {
        compose.mainClock.autoAdvance = false
        val vm = (compose.activity.application as PocketApplication).vm
        // What "Explore the interface" on the welcome screen calls.
        compose.runOnUiThread { vm.enterDemo() }
        // enterDemo opens Nav.HOME, which is the Team tab.
        shoot("pocket-team-$mode")
        compose.runOnUiThread { vm.navigate(Nav.HOME_TAB) }
        shoot("pocket-home-$mode")
    }

    @Test @Config(qualifiers = "+notnight") fun light() = capture("light")
    @Test @Config(qualifiers = "+night") fun dark() = capture("dark")
}
