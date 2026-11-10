package ai.namastex.automagik

import android.os.Build
import android.view.HapticFeedbackConstants
import androidx.activity.compose.BackHandler
import androidx.compose.animation.core.Animatable
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.LocalLifecycleOwner
import kotlinx.coroutines.launch

/**
 * Home's needs-you deck: one card per entry of Home's own Needs you list. Swipe right for Yes, left for No, up for
 * the agent; the same three buttons sit under the card. A card with a chat and no terminal menu opens its chat instead.
 * After the last answer, the all clear says how many requests were answered and the bot hops once.
 *
 * [cards] is Home's list ([Teams.deckCards]); a future "Answer all" button opens this same screen.
 */
@Composable fun DeckScreen(cards: List<Teams.DeckCard>, vm: PocketViewModel, connected: Boolean,
                           onClose: () -> Unit, onOpen: (TerminalRef) -> Unit, onBackToTeams: () -> Unit) {
    BackHandler(onBack = onClose)
    // Cards whose answer reached the agent leave at once, before the next reading shows the agent moved on.
    var answered by remember { mutableStateOf(setOf<String>()) }
    // The requests seen since the deck opened, for the offline message: Home's own count drops to zero with the link.
    var seen by remember { mutableIntStateOf(cards.size) }
    LaunchedEffect(cards.size) { seen = maxOf(seen, cards.size) }
    val waiting = (seen - answered.size).coerceAtLeast(0)
    val view = Teams.deckView(cards, answered, connected, waiting)
    Box(Modifier.fillMaxSize().background(Canvas).statusBarsPadding().navigationBarsPadding().padding(horizontal = 16.dp, vertical = 12.dp)) {
        Column(Modifier.fillMaxSize(), horizontalAlignment = Alignment.CenterHorizontally) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text("Needs you", fontSize = 20.sp, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
                if (view is Teams.DeckView.Cards) {
                    Box(Modifier.clip(RoundedCornerShape(16.dp)).background(amber().copy(alpha = .15f))
                        .border(1.dp, amber().copy(alpha = .5f), RoundedCornerShape(16.dp)).padding(horizontal = 12.dp, vertical = 5.dp)) {
                        Text("${view.cards.size} left", color = amber(), fontSize = 14.sp, fontWeight = FontWeight.Bold)
                    }
                    Spacer(Modifier.width(8.dp))
                }
                IconButton(onClick = onClose) { Icon(Icons.Outlined.Close, "Close the deck", tint = Muted) }
            }
            when (view) {
                is Teams.DeckView.Cards -> {
                    val card = view.cards.first()
                    key(Teams.deckKey(card)) {
                        DeckCard(vm, card, behind = view.cards.size - 1, Modifier.weight(1f),
                            onAnswered = { answered = answered + Teams.deckKey(card) }, onOpen = { onOpen(card.ref) })
                    }
                }
                Teams.DeckView.Clear -> DeckEnd(Teams.DONE, "All clear", if (answered.isEmpty()) "No bot is waiting on you."
                    else "You answered ${answered.size} ${if (answered.size == 1) "request" else "requests"}. Your bots are back to work.",
                    celebrate = answered.isNotEmpty(), action = "Back to Teams", onAction = onBackToTeams, Modifier.weight(1f))
                is Teams.DeckView.Offline -> DeckEnd(Teams.ASLEEP, "Offline: can't answer",
                    if (view.waiting == 1) "1 bot was waiting when the connection dropped. Reconnect to answer."
                    else "${view.waiting} bots were waiting when the connection dropped. Reconnect to answer.",
                    celebrate = false, action = "Back to Home", onAction = onClose, Modifier.weight(1f))
            }
        }
    }
}

/** The deck's end: all clear (one hop of Genie's) or offline (no celebration: nothing was answered). */
@Composable private fun DeckEnd(pose: String, title: String, text: String, celebrate: Boolean, action: String,
                                onAction: () -> Unit, modifier: Modifier) {
    Column(modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
        Spacer(Modifier.weight(1f))
        PetView(Teams.GENIE, pose, 132.dp, celebrate = if (celebrate) Unit else null)
        Spacer(Modifier.height(12.dp))
        Text(title, fontSize = 28.sp, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center)
        Spacer(Modifier.height(8.dp))
        Text(text, color = Muted, fontSize = 16.sp, lineHeight = 24.sp, textAlign = TextAlign.Center)
        Spacer(Modifier.weight(1f))
        Button(onClick = onAction, modifier = Modifier.fillMaxWidth().height(54.dp), shape = RoundedCornerShape(27.dp),
            colors = ButtonDefaults.buttonColors(containerColor = Accent, contentColor = OnAccent)) {
            Text(action, fontSize = 17.sp, fontWeight = FontWeight.SemiBold)
        }
    }
}

/**
 * One card: who asks, the project, what it asks, the pending commands read off its screen, and the three answers.
 * A permission's Yes and No go through [PocketViewModel.answer] with the dialog text, as the terminal's buttons do;
 * anything the phone can't read, and every chat card, is answered by opening it.
 */
@Composable private fun DeckCard(vm: PocketViewModel, card: Teams.DeckCard, behind: Int, modifier: Modifier,
                                 onAnswered: () -> Unit, onOpen: () -> Unit) {
    val scope = rememberCoroutineScope()
    val view = LocalView.current
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    // Read again every 2 s, as the terminal screen does: a menu that wasn't drawn yet, or changed, shows its answers.
    // Not while the app is stopped ([Background.poll]). A chat card has no terminal menu to read.
    val menu by produceState<Prompt.Menu?>(null, card.ref, card.chat) {
        if (card.chat != null) { value = null; return@produceState }
        Background.poll(lifecycle.started(), 2_000) { vm.readMenu(card.ref) }.collect { value = it }
    }
    val choices = remember(menu, card.kind, card.chat) {
        if (card.chat == null && card.kind == "permission") Prompt.choices(card.kind, menu) else emptyList()
    }
    val yes = choices.firstOrNull()
    val no = choices.lastOrNull()?.takeIf { choices.size >= 2 }
    var sending by remember { mutableStateOf(false) }
    val dx = remember { Animatable(0f) }
    val dy = remember { Animatable(0f) }
    val threshold = with(LocalDensity.current) { 110.dp.toPx() }
    val amber = amber()
    fun send(choice: Prompt.Choice?) {
        val m = menu ?: return
        if (choice == null || sending) return
        sending = true
        view.performHapticFeedback(if (Build.VERSION.SDK_INT >= 30) HapticFeedbackConstants.CONFIRM else HapticFeedbackConstants.VIRTUAL_KEY)
        // The card leaves only when the answer reached the agent; otherwise it comes back (the outcome shows as a message).
        vm.answer(card.ref, card.message, m.dialog, m.options, choice) { sent ->
            sending = false
            if (sent) onAnswered() else scope.launch { launch { dx.animateTo(0f) }; dy.animateTo(0f) }
        }
    }
    Column(modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
        Box(Modifier.weight(1f).fillMaxWidth().padding(vertical = 10.dp), contentAlignment = Alignment.Center) {
            // The cards still waiting, peeking out under this one.
            for (i in minOf(behind, 2) downTo 1) Box(Modifier.fillMaxWidth(1f - i * .05f).fillMaxHeight(.92f).offset(y = (i * 10).dp)
                .clip(RoundedCornerShape(24.dp)).background(Surface.copy(alpha = 1f - i * .3f)).border(1.dp, Border, RoundedCornerShape(24.dp)))
            Column(Modifier.fillMaxWidth().fillMaxHeight(.94f)
                .graphicsLayer { translationX = dx.value; translationY = dy.value; rotationZ = dx.value / 40f }
                .clip(RoundedCornerShape(24.dp)).background(Surface).border(1.5.dp, amber.copy(alpha = .65f), RoundedCornerShape(24.dp))
                .pointerInput(card.ref, yes, no, card.chat) {
                    detectDragGestures(onDragEnd = {
                        scope.launch {
                            when (Teams.swipe(dx.value, dy.value, threshold, yes != null && menu != null, no != null && menu != null)) {
                                Teams.Swipe.YES -> { dx.animateTo(size.width * 1.5f); send(yes) }
                                Teams.Swipe.NO -> { dx.animateTo(-size.width * 1.5f); send(no) }
                                Teams.Swipe.OPEN -> { launch { dx.animateTo(0f) }; dy.animateTo(0f); onOpen() }
                                Teams.Swipe.NONE -> { launch { dx.animateTo(0f) }; dy.animateTo(0f) }
                            }
                        }
                    }) { change, drag -> change.consume(); scope.launch { dx.snapTo(dx.value + drag.x); dy.snapTo(minOf(0f, dy.value + drag.y)) } }
                }.padding(20.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Dot(amber, 8); Spacer(Modifier.width(8.dp))
                    Text(card.where.ifBlank { "Home" }, color = Muted, fontSize = 13.sp, maxLines = 1, overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f))
                    Text(listOf(card.agent, Teams.time(card.statusMs, System.currentTimeMillis())).filter { it.isNotBlank() }.joinToString(" · "),
                        color = Muted, fontSize = 12.sp, maxLines = 1)
                }
                Spacer(Modifier.weight(.55f))
                PetView(Teams.GENIE, Teams.NEEDS_YOU, 104.dp)
                Spacer(Modifier.height(10.dp))
                Text(card.title, fontSize = 22.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(statusLabel("blocked", card.kind), color = amber, fontSize = 13.sp)
                Spacer(Modifier.height(12.dp))
                Text(card.message.ifBlank { if (card.opensChat) "Waiting for your reply" else "Waiting for you" },
                    fontSize = 17.sp, lineHeight = 24.sp, textAlign = TextAlign.Center, maxLines = 4, overflow = TextOverflow.Ellipsis)
                menu?.dialog?.takeIf { it.isNotBlank() }?.let {
                    Spacer(Modifier.height(10.dp))
                    Text(it, fontFamily = FontFamily.Monospace, fontSize = 13.sp, lineHeight = 19.sp, maxLines = 6,
                        overflow = TextOverflow.Ellipsis, modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(Canvas).padding(12.dp))
                }
                Spacer(Modifier.weight(1f))
                Text(when {
                    card.opensChat -> "Swipe up, or tap Open chat, to answer there"
                    yes != null -> "Swipe right for Yes, left for No"
                    else -> "Answer this one in its terminal: swipe up"
                }, color = Muted, fontSize = 12.sp, textAlign = TextAlign.Center)
            }
            // The stamps, as the card leans.
            val lean = (dx.value / threshold).coerceIn(-1f, 1f)
            if (lean > .1f && yes != null) Stamp("YES", Ok, Modifier.align(Alignment.TopStart).padding(28.dp).alpha(lean))
            if (lean < -.1f && no != null) Stamp("NO", Blocked, Modifier.align(Alignment.TopEnd).padding(28.dp).alpha(-lean))
        }
        Text("← No  ·  ↑ Open  ·  Yes →", color = Muted, fontSize = 12.sp)
        Spacer(Modifier.height(10.dp))
        // The same three answers as buttons, at thumb's reach.
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            OutlinedButton(onClick = { send(no) }, enabled = no != null && !sending, modifier = Modifier.weight(1f).height(56.dp)) { Text("No") }
            OutlinedButton(onClick = onOpen, modifier = Modifier.weight(1f).height(56.dp)) { Text(if (card.opensChat) "Open chat" else "Open") }
            Button(onClick = { send(yes) }, enabled = yes != null && !sending, modifier = Modifier.weight(1f).height(56.dp),
                colors = ButtonDefaults.buttonColors(containerColor = Ok)) { Text("Yes") }
        }
    }
}

@Composable private fun Stamp(text: String, color: Color, modifier: Modifier) {
    Text(text, color = color, fontSize = 30.sp, fontWeight = FontWeight.Black,
        modifier = modifier.graphicsLayer { rotationZ = if (text == "YES") -14f else 14f }
            .border(3.dp, color, RoundedCornerShape(8.dp)).padding(horizontal = 10.dp, vertical = 2.dp))
}
