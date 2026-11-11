package ai.namastex.automagik

import android.Manifest
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

/**
 * The mic shared by the side-button panel and both composers: Android's speech recognizer fills the message box, plain
 * speech to text. The button is always shown; a first tap asks for the microphone permission (already declared in the
 * manifest), and a denial or a failed listen says why with a toast, so the button never fails silently. The same system
 * recognizer and destination serve every place; nothing is sent to a new place.
 */
@Composable fun Dictate(onHeard: (String) -> Unit) {
    val context = LocalContext.current
    val heard by rememberUpdatedState(onHeard)
    var listening by remember { mutableStateOf(false) }
    val recognizer = remember(context) {
        if (SpeechRecognizer.isRecognitionAvailable(context)) runCatching { SpeechRecognizer.createSpeechRecognizer(context) }.getOrNull() else null
    }
    DisposableEffect(recognizer) { onDispose { recognizer?.destroy() } }

    fun say(message: String) { Toast.makeText(context, message, Toast.LENGTH_LONG).show() }

    fun start() {
        val r = recognizer ?: run { say("Speech recognition is not available on this phone."); return }
        r.setRecognitionListener(object : RecognitionListener {
            override fun onResults(results: Bundle?) {
                listening = false
                results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()?.takeIf { it.isNotBlank() }?.let(heard)
            }
            override fun onError(error: Int) { listening = false; say(dictateError(error)) }
            override fun onReadyForSpeech(params: Bundle?) {}
            override fun onBeginningOfSpeech() {}
            override fun onRmsChanged(rmsdB: Float) {}
            override fun onBufferReceived(buffer: ByteArray?) {}
            override fun onEndOfSpeech() {}
            override fun onPartialResults(partialResults: Bundle?) {}
            override fun onEvent(eventType: Int, params: Bundle?) {}
        })
        runCatching {
            r.startListening(Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM))
        }.onSuccess { listening = true }.onFailure { say("Speech recognition could not start. Try again.") }
    }

    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) start() else say(DICTATE_PERMISSION)
    }

    IconButton(onClick = {
        when {
            listening -> recognizer?.stopListening()
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
