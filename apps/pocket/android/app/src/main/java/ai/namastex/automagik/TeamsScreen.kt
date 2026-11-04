package ai.namastex.automagik

import android.content.Context
import android.graphics.BitmapFactory
import android.view.HapticFeedbackConstants
import androidx.activity.compose.BackHandler
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.GridView
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.graphics.createBitmap
import com.caverock.androidsvg.SVG
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.security.MessageDigest

/** The desktop's space images, copied to the phone once ([PocketViewModel] fetches them), drawn at tile size. */
object SpaceIcons {
    private fun file(context: Context, hostId: String, file: String): File {
        val hash = MessageDigest.getInstance("SHA-256").digest("$hostId|$file".toByteArray()).take(12).joinToString("") { "%02x".format(it) }
        return File(context.filesDir, "space-icons/$hash.${file.substringAfterLast('.').lowercase()}")
    }
    fun cached(context: Context, hostId: String, file: String) = file(context, hostId, file).isFile
    fun save(context: Context, hostId: String, file: String, bytes: ByteArray) {
        val to = file(context, hostId, file).apply { parentFile?.mkdirs() }
        File(to.path + ".tmp").apply { writeBytes(bytes); renameTo(to) }
    }
    /** The image at [px] square, or null when it isn't here or doesn't draw. Blocking. */
    fun load(context: Context, hostId: String, file: String, px: Int): ImageBitmap? = runCatching {
        val f = file(context, hostId, file).takeIf { it.isFile } ?: return null
        if (f.extension == "svg") {
            val svg = SVG.getFromString(f.readText())
            svg.documentWidth = px.toFloat(); svg.documentHeight = px.toFloat()
            createBitmap(px, px).also { svg.renderToCanvas(android.graphics.Canvas(it)) }.asImageBitmap()
        } else BitmapFactory.decodeFile(f.path)?.asImageBitmap()
    }.getOrNull()
}

/** The amber of a request for the person: Herdr's ansi3 in the theme the phone shows. */
@Composable @ReadOnlyComposable fun amber() = Color(0xff000000 or SpaceColors.rgb("ansi3", LocalPalette.current.dark).toLong())

/**
 * The Teams tab's projects: the connected machines' live reading, and the cached rows of machines that aren't
 * connected (the preview shows only its own). Recomputed every 30 s, so an idle bot falls asleep on time.
 */
@Composable fun rememberTeams(state: PocketState, vm: PocketViewModel): List<Teams.Team> {
    val cached by vm.cachedTeams.collectAsState()
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(Unit) { while (true) { delay(30_000); now = System.currentTimeMillis() } }
    return remember(state.machines, state.hosts, state.demo, cached, now) {
        // Live only for a machine read far enough (as the cache is written), each linked machine on its own; until then,
        // its cached projects, stale: shown at once, never answered from.
        val read = Teams.read(state.machines, now)
        val live = Teams.live(state.machines, read, now)
        if (state.demo) live else Teams.merge(live, cached, read, state.hosts.map { it.id }.toSet())
    }
}

/**
 * Teams: the project circles (All first; in All, a project that needs the person jumps ahead with an amber halo and a
 * haptic tick), today's progress, then the bots, IM-like. A row opens its bot's terminal; the needs-you deck answers
 * requests by swiping.
 */
@Composable fun TeamsScreen(state: PocketState, vm: PocketViewModel, teams: List<Teams.Team>, onOpen: (TerminalRef) -> Unit) {
    val peaks by vm.peaks.collectAsState()
    val celebrations by vm.celebrations.collectAsState()
    var selectedId by rememberSaveable { mutableStateOf<String?>(null) }
    var deckOpen by rememberSaveable { mutableStateOf(false) }
    val ordered = remember(teams) { Teams.order(teams) }
    val selected = ordered.find { it.id == selectedId }
    LaunchedEffect(selected == null) { if (selected == null) selectedId = null }
    // A haptic tick when a project jumps ahead because it needs the person.
    val view = LocalView.current
    var before by remember { mutableStateOf<List<String>?>(null) }
    LaunchedEffect(ordered.map { it.id to it.needsYou }) {
        val was = before
        if (was != null && Teams.jumped(was, ordered).isNotEmpty()) view.performHapticFeedback(HapticFeedbackConstants.CLOCK_TICK)
        before = ordered.map { it.id }
    }
    val shown = if (selected == null) ordered else listOf(selected)
    val rows = remember(shown) { if (selected == null) Teams.allRows(shown) else selected.bots.map { selected to it } }
    val deck = remember(teams) { Teams.deck(teams) }
    val offline = teams.any { it.stale }
    val peak = if (state.demo) Teams.working(teams)[selected?.id ?: ""] else peaks[selected?.id ?: ""]
    val connected = state.machines.values.any { it.connected }
    Box(Modifier.fillMaxSize()) {
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 16.dp)) {
            item(key = "bar") {
                LazyRow(contentPadding = PaddingValues(horizontal = 14.dp, vertical = 12.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    item(key = "all") { ProjectCircle(null, selected == null, needsYou = 0, onClick = { selectedId = null }) }
                    items(ordered, key = { it.id }) { t ->
                        ProjectCircle(t, t.id == selectedId, t.needsYou, Modifier.animateItem(), onClick = { selectedId = t.id })
                    }
                }
            }
            item(key = "strip") { ProgressStrip(Teams.strip(shown, peak)) }
            if (deck.isNotEmpty() || (offline && teams.any { it.stale && it.needsYou > 0 })) item(key = "deck") {
                Row(Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 6.dp).clip(RoundedCornerShape(12.dp))
                    .background(amber().copy(alpha = .14f)).clickable { deckOpen = true }.padding(horizontal = 14.dp, vertical = 11.dp),
                    verticalAlignment = Alignment.CenterVertically) {
                    Dot(amber(), 8); Spacer(Modifier.width(10.dp))
                    val n = deck.size + teams.filter { it.stale }.sumOf { it.needsYou }
                    Text(if (n == 1) "1 bot needs you" else "$n bots need you", fontWeight = FontWeight.SemiBold, fontSize = 14.sp, modifier = Modifier.weight(1f))
                    Text("Review", color = Accent, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
                }
            }
            if (!connected || offline) item(key = "offline") {
                Text(if (connected) "Some machines are offline · last known state" else "Offline · last known state",
                    color = Muted, fontSize = 12.sp, modifier = Modifier.padding(horizontal = 18.dp, vertical = 4.dp))
            }
            if (rows.isEmpty()) item(key = "empty") {
                Text(if (selected == null) "No bots yet. A bot shows here once its project's registry lists it, or its pane carries its id."
                    else "No bots in ${selected.name} yet.", color = Muted, fontSize = 13.sp, modifier = Modifier.padding(24.dp))
            }
            items(rows, key = { (t, b) -> "${t.id}|${b.id}" }) { (t, b) ->
                // A merge celebrates for two minutes after it is seen: a row scrolled back later doesn't jump again.
                val celebrate = celebrations["${t.id}|${b.id}"]?.takeIf { System.currentTimeMillis() - it < 120_000 }
                BotRow(state, vm, t, b, showProject = selected == null, celebrate = celebrate,
                    modifier = Modifier.animateItem(), onOpen = onOpen)
            }
        }
        if (deckOpen) NeedsYouDeck(vm, teams, connected, onClose = { deckOpen = false }, onOpen = { deckOpen = false; onOpen(it) })
    }
}

/** A project's circle: its Herdr icon (emoji or image) on its tile colour, else its letter; All is a grid. */
@Composable fun ProjectCircle(team: Teams.Team?, selected: Boolean, needsYou: Int, modifier: Modifier = Modifier, size: Dp = 52.dp,
                              onClick: (() -> Unit)? = null) {
    val amber = amber()
    val halo = if (needsYou > 0) rememberInfiniteTransition(label = "halo").animateFloat(.35f, 1f,
        infiniteRepeatable(tween(900), RepeatMode.Reverse), label = "halo").value else 0f
    val label = team?.let { if (needsYou > 0) "${it.name}, $needsYou need you" else it.name } ?: "All projects"
    Column(modifier.semantics { contentDescription = label }, horizontalAlignment = Alignment.CenterHorizontally) {
        Box(Modifier.size(size + 8.dp), contentAlignment = Alignment.Center) {
            if (needsYou > 0) Box(Modifier.size(size + 8.dp).border(3.dp, amber.copy(alpha = halo), CircleShape))
            ProjectIcon(team, size, Modifier.then(if (onClick != null) Modifier.clip(CircleShape).clickable(onClick = onClick) else Modifier))
            if (needsYou > 0) Box(Modifier.align(Alignment.TopEnd).defaultMinSize(20.dp, 20.dp).background(amber, CircleShape).padding(horizontal = 5.dp),
                contentAlignment = Alignment.Center) {
                Text("$needsYou", color = Color(0xff1b1b1e), fontSize = 11.sp, fontWeight = FontWeight.Bold)
            }
        }
        if (onClick != null) Box(Modifier.padding(top = 2.dp).size(5.dp).background(if (selected) Accent else Color.Transparent, CircleShape))
    }
}

/** A project's face at [size]: what Herdr draws for its space. */
@Composable fun ProjectIcon(team: Teams.Team?, size: Dp, modifier: Modifier = Modifier) {
    val dark = LocalPalette.current.dark
    val tile = team?.let { Teams.colorRgb(it.color, dark) }?.let { Color(0xff000000 or it.toLong()) }
    Box(modifier.size(size).clip(CircleShape).background(tile ?: Raised), contentAlignment = Alignment.Center) {
        when (val icon = team?.icon) {
            null -> Icon(Icons.Outlined.GridView, null, tint = Ink, modifier = Modifier.size(size * .46f))
            is Teams.Icon.Emoji -> Text(icon.char, fontSize = (size.value * .5f).sp)
            is Teams.Icon.Image -> {
                val context = LocalContext.current
                val px = with(LocalDensity.current) { size.roundToPx() }
                val version = LocalIconsVersion.current
                val image by produceState<ImageBitmap?>(null, icon.file, team.hostId, px, version) {
                    value = withContext(Dispatchers.IO) { SpaceIcons.load(context, team.hostId, icon.file, px) }
                }
                image?.let { Image(it, null, Modifier.fillMaxSize()) } ?: Letter(team, size, tile)
            }
            Teams.Icon.Letter -> Letter(team, size, tile)
        }
    }
}

/** Raised when a space image or a pet arrives, so icons already on screen read their file again. */
val LocalIconsVersion = compositionLocalOf { 0 }

@Composable private fun Letter(team: Teams.Team, size: Dp, tile: Color?) =
    Text(team.letter, color = if (tile != null) Color.White else Ink, fontSize = (size.value * .42f).sp, fontWeight = FontWeight.Bold)

/** Today's numbers for the view: tasks merged and the agents' time on them (the feed's 24 h), and the peak of agents at once. */
@Composable fun ProgressStrip(s: Teams.Strip) {
    Row(Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 4.dp).clip(RoundedCornerShape(12.dp)).background(Surface)
        .padding(vertical = 10.dp)) {
        StripCell(Fmt.count(s.merged), s.merged == null, "tasks done · 24h", Modifier.weight(1f))
        StripCell(Fmt.minutes(s.agentMin), s.agentMin == null, "agent time · 24h", Modifier.weight(1f))
        StripCell(s.peak?.toString() ?: SpaceFeed.DASH, s.peak == null, "peak agents today", Modifier.weight(1f))
    }
}

@Composable private fun StripCell(value: String, isNull: Boolean, label: String, modifier: Modifier) {
    Column(modifier, horizontalAlignment = Alignment.CenterHorizontally) {
        Text(value, fontSize = 19.sp, fontWeight = FontWeight.SemiBold, fontFamily = FontFamily.Monospace,
            color = if (isNull) LocalPalette.current.dim else Ink, maxLines = 1)
        Text(label, fontSize = 11.sp, color = Muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

/** A bot, IM-like: its pet in the pose for its state, its name, what it says and when, and the bot card button. */
@Composable fun BotRow(state: PocketState, vm: PocketViewModel, team: Teams.Team, bot: Teams.Bot, showProject: Boolean, celebrate: Long?,
                       modifier: Modifier = Modifier, onOpen: (TerminalRef) -> Unit) {
    val feed = state.machines[team.hostId]?.space?.get(team.machine)
    val names = state.machines[team.hostId]?.bots?.get("${team.machine}|${team.key}")
    val now = System.currentTimeMillis()
    val color = when (bot.pose) { Teams.NEEDS_YOU -> amber(); Teams.FAILED -> Blocked; Teams.WORKING -> Working; Teams.DONE -> Done; else -> Muted }
    Row(modifier.fillMaxWidth().clickable(enabled = bot.ref != null) { bot.ref?.let(onOpen) }
        .background(if (bot.needsYou) amber().copy(alpha = .07f) else Color.Transparent)
        .padding(start = 14.dp, end = 6.dp, top = 8.dp, bottom = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(52.dp)) {
            Box(Modifier.size(52.dp).clip(CircleShape).background(Surface), contentAlignment = Alignment.BottomCenter) {
                PetView(bot.pet, bot.pose, 50.dp, celebrate = celebrate)
            }
            if (showProject) ProjectIcon(team, 18.dp, Modifier.align(Alignment.BottomEnd).border(1.5.dp, Canvas, CircleShape))
        }
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(bot.name, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f, fill = false), color = if (bot.pose == Teams.ASLEEP) Muted else Ink)
                if (bot.main) {
                    Spacer(Modifier.width(6.dp))
                    Text("MAIN", fontSize = 9.5.sp, fontWeight = FontWeight.Bold, color = Accent,
                        modifier = Modifier.border(1.dp, Accent.copy(alpha = .5f), RoundedCornerShape(4.dp)).padding(horizontal = 4.dp, vertical = 1.dp))
                }
                Spacer(Modifier.weight(1f))
                Text(Teams.time(bot.statusMs, now), fontSize = 11.5.sp, color = Muted, maxLines = 1)
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                Dot(color, 7); Spacer(Modifier.width(6.dp))
                Text(Teams.line(bot), fontSize = 13.sp, color = if (bot.needsYou) Ink else Muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
        if (feed != null) StatsButton { vm.openStats(BotSheet(BotStats(bot.id, bot.name, feed, feed.project(team.key)?.bots?.get(bot.id), names))) }
        else Spacer(Modifier.width(8.dp))
    }
}

/**
 * The needs-you deck: one card per waiting bot. Right is Yes, left is No (a permission's own options, through the same
 * path as the terminal's answer buttons), up opens the bot's terminal. A question, or a menu the phone can't read, is
 * answered in the terminal. An empty deck is the "all clear" moment.
 */
@Composable fun NeedsYouDeck(vm: PocketViewModel, teams: List<Teams.Team>, connected: Boolean, onClose: () -> Unit, onOpen: (TerminalRef) -> Unit) {
    BackHandler(onBack = onClose)
    // Cards whose answer reached the agent: they leave at once, before the next reading shows the bot moved on.
    var answered by remember { mutableStateOf(setOf<String>()) }
    val view = Teams.deckView(teams, answered, connected)
    Box(Modifier.fillMaxSize().background(Canvas).clickable(enabled = false) {}.padding(16.dp)) {
        Column(Modifier.fillMaxSize(), horizontalAlignment = Alignment.CenterHorizontally) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text(if (view is Teams.DeckView.Cards) "Needs you · ${view.cards.size} left" else "Needs you", fontSize = 17.sp,
                    fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
                TextButton(onClick = onClose) { Text("Close") }
            }
            when (view) {
                is Teams.DeckView.Cards -> {
                    val (team, bot) = view.cards.first()
                    key(Teams.deckKey(bot)) { DeckCard(vm, team, bot, behind = view.cards.size - 1, Modifier.weight(1f),
                        onAnswered = { answered = answered + Teams.deckKey(bot) }, onOpen = { bot.ref?.let(onOpen) }) }
                }
                Teams.DeckView.Clear -> DeckEnd(Teams.IDLE, "All clear", "No bot is waiting on you.", celebrate = true, Modifier.weight(1f), onClose)
                is Teams.DeckView.Offline -> DeckEnd(Teams.ASLEEP, "Offline: can't answer",
                    if (view.waiting == 0) "No machine is connected. Reconnect to see who needs you."
                    else "${if (view.waiting == 1) "1 bot was" else "${view.waiting} bots were"} waiting when the connection dropped. Reconnect to answer.",
                    celebrate = false, Modifier.weight(1f), onClose)
            }
        }
    }
}

/** The deck's end: all clear (one hop of Genie's) or offline (no celebration: nothing was answered). */
@Composable private fun DeckEnd(pose: String, title: String, text: String, celebrate: Boolean, modifier: Modifier, onClose: () -> Unit) {
    Column(modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
        Spacer(Modifier.weight(1f))
        PetView(Teams.GENIE, pose, 140.dp, celebrate = if (celebrate) Unit else null)
        Spacer(Modifier.height(12.dp))
        Text(title, fontSize = 24.sp, fontWeight = FontWeight.SemiBold)
        Text(text, color = Muted, fontSize = 14.sp, textAlign = TextAlign.Center)
        Spacer(Modifier.weight(1f))
        Button(onClick = onClose, modifier = Modifier.fillMaxWidth().height(52.dp)) { Text("Back to Teams") }
    }
}

@Composable private fun DeckCard(vm: PocketViewModel, team: Teams.Team, bot: Teams.Bot, behind: Int, modifier: Modifier,
                                 onAnswered: () -> Unit, onOpen: () -> Unit) {
    val ref = bot.ref ?: return
    val scope = rememberCoroutineScope()
    val view = LocalView.current
    // Read again every 2 s, as the terminal screen does: a menu that wasn't drawn yet, or changed, shows its answers.
    val menu by produceState<Prompt.Menu?>(null, ref) { while (true) { value = vm.readMenu(ref); delay(2_000) } }
    val choices = remember(menu, bot.kind) { if (bot.kind == "permission") Prompt.choices(bot.kind, menu) else emptyList() }
    val yes = choices.firstOrNull()
    val no = choices.lastOrNull()?.takeIf { choices.size >= 2 }
    var sending by remember { mutableStateOf(false) }
    val dx = remember { Animatable(0f) }
    val dy = remember { Animatable(0f) }
    val threshold = with(LocalDensity.current) { 110.dp.toPx() }
    fun send(choice: Prompt.Choice?) {
        val m = menu ?: return
        if (choice == null || sending) return
        sending = true
        view.performHapticFeedback(if (android.os.Build.VERSION.SDK_INT >= 30) HapticFeedbackConstants.CONFIRM else HapticFeedbackConstants.VIRTUAL_KEY)
        // The card leaves only when the answer reached the agent; otherwise it comes back (the outcome shows as a message).
        vm.answer(ref, bot.message, m.options, choice) { sent ->
            sending = false
            if (sent) onAnswered() else scope.launch { launch { dx.animateTo(0f) }; dy.animateTo(0f) }
        }
    }
    Column(modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
        Box(Modifier.weight(1f).fillMaxWidth().padding(vertical = 12.dp), contentAlignment = Alignment.Center) {
            // The cards still waiting, peeking out under this one.
            for (i in minOf(behind, 2) downTo 1) Box(Modifier.fillMaxWidth(1f - i * .05f).fillMaxHeight(.92f).offset(y = (i * 10).dp)
                .clip(RoundedCornerShape(20.dp)).background(Surface.copy(alpha = 1f - i * .3f)).border(1.dp, Border, RoundedCornerShape(20.dp)))
            Column(Modifier.fillMaxWidth().fillMaxHeight(.92f)
                .graphicsLayer { translationX = dx.value; translationY = dy.value; rotationZ = dx.value / 40f }
                .clip(RoundedCornerShape(20.dp)).background(Surface).border(1.5.dp, amber().copy(alpha = .6f), RoundedCornerShape(20.dp))
                .pointerInput(ref, yes, no) {
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
                Row(verticalAlignment = Alignment.CenterVertically) {
                    ProjectIcon(team, 22.dp); Spacer(Modifier.width(8.dp))
                    Text(team.name, color = Muted, fontSize = 13.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                Spacer(Modifier.weight(.6f))
                PetView(bot.pet, Teams.NEEDS_YOU, 132.dp)
                Spacer(Modifier.height(10.dp))
                Text(bot.name, fontSize = 22.sp, fontWeight = FontWeight.SemiBold)
                Text(statusLabel("blocked", bot.kind), color = amber(), fontSize = 13.sp)
                Spacer(Modifier.height(12.dp))
                Text(bot.message.ifBlank { "Waiting for you" }, fontSize = 15.sp, textAlign = TextAlign.Center, maxLines = 5, overflow = TextOverflow.Ellipsis)
                Spacer(Modifier.weight(1f))
                Text(when {
                    yes != null && no != null -> "Yes: ${yes.button.take(48)}\nNo: ${no.label.take(48)}"
                    else -> "Answer this one in its terminal: swipe up."
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
            OutlinedButton(onClick = { send(no) }, enabled = no != null && !sending, modifier = Modifier.weight(1f).height(52.dp)) { Text("No") }
            OutlinedButton(onClick = onOpen, modifier = Modifier.weight(1f).height(52.dp)) { Text("Open") }
            Button(onClick = { send(yes) }, enabled = yes != null && !sending, modifier = Modifier.weight(1f).height(52.dp),
                colors = ButtonDefaults.buttonColors(containerColor = Ok)) { Text("Yes") }
        }
    }
}

@Composable private fun Stamp(text: String, color: Color, modifier: Modifier) {
    Text(text, color = color, fontSize = 30.sp, fontWeight = FontWeight.Black,
        modifier = modifier.graphicsLayer { rotationZ = if (text == "YES") -14f else 14f }
            .border(3.dp, color, RoundedCornerShape(8.dp)).padding(horizontal = 10.dp, vertical = 2.dp))
}
