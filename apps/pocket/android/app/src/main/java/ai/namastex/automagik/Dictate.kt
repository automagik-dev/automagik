package ai.namastex.automagik

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Mic
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.runtime.*
import androidx.compose.ui.platform.LocalContext
import androidx.core.content.ContextCompat

/** What the mic says when the person has not allowed the microphone. */
const val DICTATE_PERMISSION = "Microphone permission is needed to dictate. Allow it in Settings."

/** The speech engine behind the mic: Android's recognizer in the app, a fake in a test. */
internal interface DictateEngine {
    /** Starts listening; [onResult] gets the first word sequence, [onError] the recognizer's error. */
    fun start(onResult: (String) -> Unit, onError: (Int) -> Unit)
    fun stop()
    fun destroy()
}

/** Android's own recognizer: the same system `SpeechRecognizer` the side-button panel always used. */
private class PhoneDictateEngine(private val recognizer: SpeechRecognizer) : DictateEngine {
    override fun start(onResult: (String) -> Unit, onError: (Int) -> Unit) {
        recognizer.setRecognitionListener(object : RecognitionListener {
            override fun onResults(results: Bundle?) {
                results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()?.takeIf { it.isNotBlank() }?.let(onResult)
            }
            override fun onError(error: Int) { onError(error) }
            override fun onReadyForSpeech(params: Bundle?) {}
            override fun onBeginningOfSpeech() {}
            override fun onRmsChanged(rmsdB: Float) {}
            override fun onBufferReceived(buffer: ByteArray?) {}
            override fun onEndOfSpeech() {}
            override fun onPartialResults(partialResults: Bundle?) {}
            override fun onEvent(eventType: Int, params: Bundle?) {}
        })
        recognizer.startListening(Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM))
    }

    override fun stop() = recognizer.stopListening()
    override fun destroy() = recognizer.destroy()
}

/** The phone's recognizer, or null when the phone has none; a test passes its own [DictateEngine]. */
@Composable internal fun rememberPhoneEngine(): DictateEngine? {
    val context = LocalContext.current
    return remember(context) {
        if (!SpeechRecognizer.isRecognitionAvailable(context)) null else
            runCatching { SpeechRecognizer.createSpeechRecognizer(context) }.getOrNull()?.let(::PhoneDictateEngine)
    }
}

/**
 * The mic shared by the side-button panel and both composers: Android's speech recognizer fills the message box, plain
 * speech to text. The button is always shown; a first tap asks for the microphone permission (already declared in the
 * manifest), and a denial or a failed listen says why with a toast, so the button never fails silently. The words go to
 * the latest [onHeard] (not the one from the tap), so a draft sent or typed while listening is respected. The same
 * system recognizer and destination serve every place; nothing is sent to a new place.
 */
@Composable internal fun Dictate(engine: DictateEngine? = rememberPhoneEngine(), onHeard: (String) -> Unit) {
    val context = LocalContext.current
    val heard by rememberUpdatedState(onHeard)
    var listening by remember { mutableStateOf(false) }
    DisposableEffect(engine) { onDispose { engine?.destroy() } }

    fun say(message: String) { Toast.makeText(context, message, Toast.LENGTH_LONG).show() }

    fun start() {
        val e = engine ?: run { say("Speech recognition is not available on this phone."); return }
        runCatching {
            e.start({ words -> listening = false; heard(words) }, { error -> listening = false; say(dictateError(error)) })
        }.onSuccess { listening = true }.onFailure { say("Speech recognition could not start. Try again.") }
    }

    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) start() else say(DICTATE_PERMISSION)
    }

    IconButton(onClick = {
        when {
            listening -> engine?.stop()
            ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED -> start()
            else -> permission.launch(Manifest.permission.RECORD_AUDIO)
        }
    }) { Icon(Icons.Outlined.Mic, if (listening) "Stop listening" else "Speak", tint = if (listening) Blocked else Accent) }
}

/** What a failed listen says, by the recognizer's error: a network failure must not look like a silent button. */
fun dictateError(error: Int): String = when (error) {
    SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> DICTATE_PERMISSION
    SpeechRecognizer.ERROR_NETWORK, SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> "Speech recognition needs a connection. Check your network and try again."
    SpeechRecognizer.ERROR_NO_MATCH, SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "Didn’t catch that. Tap the mic and try again."
    SpeechRecognizer.ERROR_AUDIO -> "Speech recognition could not use the microphone. Try again."
    SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> "The recognizer is busy. Try again in a moment."
    SpeechRecognizer.ERROR_SERVER -> "The speech service failed. Try again."
    SpeechRecognizer.ERROR_CLIENT -> "Speech recognition stopped. Try again."
    else -> "Speech recognition failed. Try again."
}

/** What a field holds after [heard] arrives: the words alone, or after the typed draft with one space, never a stray one. */
fun dictated(text: String, heard: String): String {
    val words = heard.trim()
    return when {
        words.isEmpty() -> text
        text.isBlank() -> words
        else -> text.trimEnd() + " " + words
    }
}
