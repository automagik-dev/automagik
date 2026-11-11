package ai.namastex.automagik

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Mic
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.runtime.*
import androidx.compose.ui.platform.LocalContext
import androidx.core.content.ContextCompat

/**
 * The mic shared by the side-button panel and both composers: Android's speech recognizer fills the message box, plain
 * speech to text. It is hidden without the microphone permission (asked in Settings) and without a recognizer on the
 * phone, so no button promises what cannot work. The same system recognizer and destination serve the panel and the
 * composers; nothing is sent to a new place.
 */
@Composable fun Dictate(onHeard: (String) -> Unit) {
    val context = LocalContext.current
    if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED ||
        !SpeechRecognizer.isRecognitionAvailable(context)) return
    var listening by remember { mutableStateOf(false) }
    val recognizer = remember { SpeechRecognizer.createSpeechRecognizer(context) }
    DisposableEffect(Unit) { onDispose { recognizer.destroy() } }
    IconButton(onClick = {
        if (listening) { recognizer.stopListening(); return@IconButton }
        recognizer.setRecognitionListener(object : RecognitionListener {
            override fun onResults(results: Bundle?) { listening = false; results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()?.let(onHeard) }
            override fun onError(error: Int) { listening = false }
            override fun onReadyForSpeech(params: Bundle?) {}
            override fun onBeginningOfSpeech() {}
            override fun onRmsChanged(rmsdB: Float) {}
            override fun onBufferReceived(buffer: ByteArray?) {}
            override fun onEndOfSpeech() {}
            override fun onPartialResults(partialResults: Bundle?) {}
            override fun onEvent(eventType: Int, params: Bundle?) {}
        })
        recognizer.startListening(Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM))
        listening = true
    }) { Icon(Icons.Outlined.Mic, if (listening) "Stop listening" else "Speak", tint = if (listening) Blocked else Accent) }
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
