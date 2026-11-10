package ai.namastex.automagik

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.Send
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import java.text.DateFormat
import java.util.Date

/**
 * The chat's thumb sizes, from Chat.dc.html: the decision card's 52 px buttons and the composer's 56 px pill with its
 * 17 px field. One source for the mock's targets, and the render test reads it back.
 */
object ChatStyle {
    val CARD_RADIUS = 22.dp
    val CARD_BUTTON_HEIGHT = 52.dp
    val CARD_BUTTON_RADIUS = 26.dp
    val CARD_BUTTON_TEXT = 16.sp
    val CARD_CONFIRM_TEXT = 17.sp
    val PENDING_MAX_HEIGHT = 300.dp
    val COMPOSER_RADIUS = 28.dp
    val COMPOSER_HEIGHT = 56.dp
    val COMPOSER_TEXT = 17.sp
}

/** What the chat bar says the bot is: its name, the pet to draw (null reads as Genie) and the pose for the open state. */
data class ChatIdentity(val name: String, val pet: String?, val pose: String)

/** The bot's registry id: the chat's served id, else its `dsh:<id>`, else the pane's `bot` label. */
private fun chatBotId(chat: Chat.Terminal?, terminal: CoreTerminal?): String? =
    chat?.registryId?.takeIf { it.isNotBlank() }
        ?: chat?.terminal?.takeIf { Chat.isDsh(it) }?.substringAfter(Chat.DSH_PREFIX)?.takeIf { it.isNotBlank() }
        ?: terminal?.labels?.get("bot")?.trim()?.takeIf { it.isNotBlank() }

/**
 * The chat bar's bot: the listing's title, the registry member's name, then the pane's title; a chat with none is
 * [Cockpit.BOT]. The pet is the member's, so a bot without one wears Genie ([Pets.load] falls back).
 */
fun chatIdentity(chat: Chat.Terminal?, terminal: CoreTerminal?, members: Collection<Teams.Member>, pose: String): ChatIdentity {
    val member = chatBotId(chat, terminal)?.let { id -> members.find { it.id == id } }
    val name = listOfNotNull(chat?.title, member?.name, terminal?.title)
        .map { ChatText.clean(it).trim() }.firstOrNull { it.isNotEmpty() } ?: Cockpit.BOT
    return ChatIdentity(name, member?.pet, pose)
}

/** The pet's pose: an open card always needs the person, however late the status line is; gone or offline dozes. */
fun chatPose(s: Chat.State): String = when {
    s.approval != null || s.question != null -> Teams.NEEDS_YOU
    s.gone || s.offline -> Teams.ASLEEP
    // A live pane's words, as Teams.poseOf reads them: done and error are not sleep.
    s.status.state == "working" -> Teams.WORKING
    s.status.state == "blocked" -> Teams.NEEDS_YOU
    s.status.state == "done" -> Teams.DONE
    s.status.state == "error" -> Teams.FAILED
    s.status.state == "idle" -> Teams.IDLE
    else -> Teams.ASLEEP
}

/** The open card, fixed above the composer: a question first, then an approval, each once. */
fun chatPending(s: Chat.State): List<Chat.Row> =
    listOfNotNull(s.question?.takeIf { it.open }, s.approval?.takeIf { it.open }).distinctBy { it.id }

/** The transcript rows the message list draws: the fixed card is not also left scrolling in it. */
fun chatListRows(s: Chat.State): List<Chat.Row> {
    val fixed = chatPending(s).map { it.id }.toSet()
    return if (fixed.isEmpty()) s.rows else s.rows.filterNot { it.id in fixed }
}

/** The bar's second line, as the chat has always said it: state word, then the engine's message. */
fun chatStateLine(s: Chat.State): String = when {
    s.gone -> "Ended"
    s.offline -> "Machine offline"
    else -> stateName(s.status.state) + s.status.msg.takeIf { it.isNotBlank() }?.let { " · " + ChatText.clean(it) }.orEmpty()
}

/**
 * Prose spans as the text a Compose [Text] draws: every span's characters as they are, nothing parsed as markup.
 * A link is an annotation over its own target, handed to [open] only on a tap; nothing else is clickable.
 */
fun chatAnnotated(spans: List<ChatText.Span>, open: (String) -> Unit): AnnotatedString = buildAnnotatedString {
    val style = TextLinkStyles(SpanStyle(textDecoration = TextDecoration.Underline))
    for (span in spans) when (span) {
        is ChatText.Plain -> append(span.text)
        is ChatText.Link -> { val start = length; append(span.text); addLink(LinkAnnotation.Url(span.text, style) { open(span.text) }, start, length) }
    }
}

/**
 * A chat (RFC 0015 delivery 5): a terminal's agent, or an Automagik Bot's chat (`dsh:`; it takes writes only when the
 * bridge's hello says `dshWrite`). Rows are plain text ([ChatText]); which buttons show is [ChatActions]'s alone, and
 * without a message box the bottom line says why ([ChatActions.whyNoSend]). [onShowTerminal] is null where there is
 * no terminal.
 */
@Composable fun ChatPane(vm: PocketViewModel, ref: TerminalRef, onShowTerminal: (() -> Unit)?, onBack: () -> Unit, modifier: Modifier = Modifier) {
    DisposableEffect(ref) { vm.openChat(ref); onDispose { vm.closeChat(ref) } }
    val s = vm.chat.collectAsStateWithLifecycle().value?.takeIf { it.terminal == ref.address } ?: Chat.State(ref.address)
    val app by vm.state.collectAsStateWithLifecycle()
    val chat = vm.botChats.collectAsStateWithLifecycle().value[ref.hostId]?.getOrNull()?.find { it.terminal == ref.address }
    val terminal = app.machines[ref.hostId]?.terminals?.find { it.address == ref.address }
    val members = remember(app.machines[ref.hostId]?.members) {
        app.machines[ref.hostId]?.members?.values?.flatten().orEmpty()
    }
    val pose = chatPose(s)
    val identity = remember(chat, terminal, members, pose) { chatIdentity(chat, terminal, members, pose) }
    val openLink = rememberLinkOpener()
    val list = rememberLazyListState()
    var draft by remember(ref) { mutableStateOf("") }
    var confirmDraft by remember(ref) { mutableStateOf<Chat.Message?>(null) }
    val rows = remember(s.rows, s.approval?.id, s.question?.id) { chatListRows(s) }
    val pending = remember(s.question, s.approval) { chatPending(s) }
    val count = rows.size + s.screen.size + s.messages.size + s.receipts.size
    LaunchedEffect(count) { val items = list.layoutInfo.totalItemsCount; if (count > 0 && items > 0) list.animateScrollToItem(items - 1) }
    Column(modifier.background(Canvas)) {
        ChatBar(s, identity, onBack, onShowTerminal?.takeIf { ChatActions.canShowTerminal(s) }, vm::chatInterrupt, vm::reconnectChat)
        s.notice?.let { notice ->
            Row(Modifier.fillMaxWidth().background(Raised).padding(start = 14.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(notice, fontSize = 12.sp, color = Ink, modifier = Modifier.weight(1f))
                IconButton(onClick = vm::dismissChatNotice) { Icon(Icons.Outlined.Close, "Dismiss", Modifier.size(16.dp), tint = Muted) }
            }
        }
        LazyColumn(Modifier.fillMaxWidth().weight(1f).alpha(if (s.offline || s.gone) .55f else 1f), state = list,
            contentPadding = PaddingValues(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            if (rows.isNotEmpty() && s.more) item("earlier") {
                TextButton(onClick = vm::chatEarlier, modifier = Modifier.fillMaxWidth()) { Text("Load earlier", fontSize = 12.sp) }
            }
            if (s.screenOnly) item("screen-only") { Hint("History appears when this pane’s transcript is found.") }
            items(rows, key = { "r:" + it.id }) { ChatRowView(it, s, vm, openLink) }
            if (s.screen.isNotEmpty()) item("live") { Hint("Live from the screen") }
            items(s.screen, key = { "s:" + it.id }) { ChatRowView(it, s, vm, openLink) }
            items(s.receipts, key = { "x:" + it.id }) { ReceiptCard(it, identity.name, vm::dismissReceipt) }
            items(s.messages, key = { "m:" + it.id }) { m -> MessageView(m, s, onSendNow = { confirmDraft = it }, onCancel = vm::chatCancelHeld, onRetry = vm::chatRetry) }
            if (count == 0 && pending.isEmpty() && s.error == null) item("empty") { Hint(if (s.connected) "No messages yet." else "Connecting chat…") }
        }
        val why = ChatActions.whyNoSend(s)
        Column(Modifier.fillMaxWidth().background(Chrome).navigationBarsPadding()) {
            if (pending.isNotEmpty()) Column(Modifier.fillMaxWidth().heightIn(max = ChatStyle.PENDING_MAX_HEIGHT)
                .verticalScroll(rememberScrollState())
                .padding(start = 12.dp, end = 12.dp, top = 8.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)) {
                for (row in pending) PendingCard(row, s, vm)
            }
            if (why != null) Text(why, fontSize = 12.sp, color = Muted,
                modifier = Modifier.fillMaxWidth().padding(horizontal = 18.dp, vertical = 14.dp))
            else if (ChatActions.canSend(s)) ChatComposer(draft, { draft = it }, { vm.chatSend(draft); draft = "" }, draft.isNotBlank(), identity.name)
        }
    }
    confirmDraft?.let { m ->
        AlertDialog(onDismissRequest = { confirmDraft = null }, title = { Text("Send now?") },
            text = { Text(if (m.why == "draft") Chat.DRAFT_WARNING + "." else "The terminal isn’t ready for it yet; it goes as soon as you send it.") },
            confirmButton = { TextButton(onClick = { vm.chatSendHeld(m); confirmDraft = null }) { Text("Send now") } },
            dismissButton = { TextButton(onClick = { confirmDraft = null }) { Text("Cancel") } })
    }
}

@Composable private fun ChatBar(s: Chat.State, identity: ChatIdentity, onBack: () -> Unit, onShowTerminal: (() -> Unit)?, onInterrupt: () -> Unit, onReconnect: () -> Unit) {
    Column(Modifier.fillMaxWidth().background(Chrome)) {
        Row(Modifier.fillMaxWidth().padding(start = 8.dp, end = 8.dp, top = 8.dp, bottom = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, "Back to agents") }
            Surface(color = Surface, shape = RoundedCornerShape(24.dp), border = BorderStroke(1.dp, Border),
                modifier = Modifier.weight(1f).height(48.dp)) {
                Row(Modifier.fillMaxSize().padding(start = 6.dp, end = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.size(36.dp)) {
                        PetView(identity.pet, identity.pose, 36.dp)
                        Box(Modifier.align(Alignment.BottomEnd).size(12.dp).background(stateColor(s.status.state), CircleShape)
                            .border(2.dp, Surface, CircleShape))
                    }
                    Spacer(Modifier.width(10.dp))
                    Column(Modifier.weight(1f)) {
                        Text(identity.name, fontSize = 16.sp, fontWeight = FontWeight.Bold, color = Ink,
                            maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text(chatStateLine(s), fontSize = 12.sp, color = Muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                }
            }
            if (ChatActions.canInterrupt(s)) IconButton(onClick = onInterrupt) { Icon(Icons.Outlined.StopCircle, "Interrupt", tint = Blocked) }
            if (onShowTerminal != null) IconButton(onClick = onShowTerminal) { Icon(Icons.Outlined.Terminal, "Show terminal", tint = Ink) }
        }
        s.error?.let { error ->
            Row(Modifier.fillMaxWidth().padding(start = 14.dp, end = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(error, fontSize = 12.sp, color = Blocked, modifier = Modifier.weight(1f))
                if (error != Chat.NO_CHAT && error != Chat.UPDATE_LINK) TextButton(onClick = onReconnect) { Text("Reconnect", fontSize = 12.sp) }
            }
        }
        HorizontalDivider(color = Border)
    }
}

/** The composer at the mock's size: a 56 dp pill with a 17 px field and Send (no attach or mic yet). */
@Composable private fun ChatComposer(draft: String, onDraft: (String) -> Unit, onSend: () -> Unit, enabled: Boolean, name: String) {
    Surface(color = Surface, shape = RoundedCornerShape(ChatStyle.COMPOSER_RADIUS), border = BorderStroke(1.dp, Border),
        modifier = Modifier.fillMaxWidth().padding(start = 12.dp, end = 12.dp, top = 8.dp, bottom = 8.dp).heightIn(min = ChatStyle.COMPOSER_HEIGHT)) {
        Row(Modifier.fillMaxWidth().padding(start = 18.dp, end = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            BasicTextField(draft, onDraft, maxLines = 5,
                textStyle = TextStyle(color = Ink, fontSize = ChatStyle.COMPOSER_TEXT, lineHeight = 22.sp),
                cursorBrush = SolidColor(Accent),
                modifier = Modifier.weight(1f).padding(vertical = 14.dp),
                decorationBox = { field ->
                    Box {
                        if (draft.isEmpty()) Text("Message $name", fontSize = ChatStyle.COMPOSER_TEXT, color = Muted,
                            maxLines = 1, overflow = TextOverflow.Ellipsis)
                        field()
                    }
                })
            IconButton(onClick = onSend, enabled = enabled, modifier = Modifier.size(48.dp)) {
                Icon(Icons.AutoMirrored.Outlined.Send, "Send message", tint = if (enabled) Accent else Muted)
            }
        }
    }
}

@Composable private fun Hint(text: String) { Text(text, fontSize = 11.sp, color = Muted, modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp)) }

/** Row text, plain: prose with tap-only links, fenced code monospace. */
@Composable fun ChatTextView(text: String, openLink: (String, Boolean) -> Unit, color: androidx.compose.ui.graphics.Color = Ink) {
    val blocks = remember(text) { ChatText.blocks(text) }
    SelectionContainer {
        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            for (b in blocks) when (b) {
                is ChatText.Prose -> Text(remember(b) { chatAnnotated(b.spans) { url -> openLink(url, true) } }, fontSize = 14.sp, lineHeight = 20.sp, color = color)
                is ChatText.Code -> Mono(b.text)
            }
        }
    }
}

@Composable private fun Mono(text: String) {
    Surface(color = TermBg, shape = RoundedCornerShape(8.dp)) {
        Text(ChatText.clean(text), fontFamily = FontFamily.Monospace, fontSize = 12.sp, lineHeight = 17.sp, color = TermInk,
            modifier = Modifier.horizontalScroll(rememberScrollState()).padding(10.dp), softWrap = false)
    }
}

/** A tool's input or output: collapsed to one line until tapped. */
@Composable private fun Collapsed(label: String, body: String) {
    var open by remember(body) { mutableStateOf(false) }
    Column {
        Text(ChatText.clean(label), fontSize = 12.sp, color = Muted, maxLines = if (open) Int.MAX_VALUE else 1, overflow = TextOverflow.Ellipsis,
            modifier = Modifier.clickable(enabled = body.isNotBlank()) { open = !open })
        if (open && body.isNotBlank()) { Spacer(Modifier.height(4.dp)); Mono(body) }
    }
}

@Composable private fun ChatRowView(row: Chat.Row, s: Chat.State, vm: PocketViewModel, openLink: (String, Boolean) -> Unit) {
    when (row.kind) {
        "text" -> {
            val mine = row.role == "user"
            Row(Modifier.fillMaxWidth(), horizontalArrangement = if (mine) Arrangement.End else Arrangement.Start) {
                Surface(color = if (mine) Accent.copy(alpha = .14f) else Surface, shape = RoundedCornerShape(12.dp), border = if (mine) null else BorderStroke(1.dp, Border),
                    modifier = Modifier.widthIn(max = 560.dp)) {
                    Column(Modifier.padding(10.dp, 8.dp)) {
                        ChatTextView(row.text, openLink)
                        if (row.cut) Text("Cut here: open in the terminal for the rest.", fontSize = 11.sp, color = Muted)
                        if (row.interrupted) Text(Chat.STOPPED, fontSize = 11.sp, color = Muted)
                    }
                }
            }
        }
        "tool-call" -> Collapsed("▸ ${row.tool}${row.summary.takeIf { it.isNotBlank() && it != row.tool }?.let { ": $it" }.orEmpty()}", row.input)
        "tool-result" -> Collapsed(if (row.ok) "  ↳ result" else "  ↳ failed", row.output)
        "status" -> Hint(ChatText.clean(row.msg.ifBlank { row.state }))
        "tokens" -> {}
        "approval", "question" -> PendingCard(row, s, vm)
        else -> if (row.text.isNotBlank()) ChatTextView(row.text, openLink, Muted)
    }
}

/** An approval or a question: buttons only where [ChatActions] gives them; else what to do instead. */
@Composable private fun PendingCard(row: Chat.Row, s: Chat.State, vm: PocketViewModel) {
    val choices = ChatActions.choices(s, row)
    Surface(color = Blocked.copy(alpha = .08f), shape = RoundedCornerShape(ChatStyle.CARD_RADIUS),
        border = BorderStroke(1.5.dp, Blocked.copy(alpha = .5f)), modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(12.dp)) {
            Text(if (row.kind == "approval") "Needs your approval" else "Question", fontSize = 15.sp, fontWeight = FontWeight.Bold, color = Blocked)
            Spacer(Modifier.height(4.dp))
            val what = if (row.kind == "approval") listOf(row.tool, row.summary).filter { it.isNotBlank() }.distinct().joinToString(": ") else row.prompt
            if (what.isNotBlank() && what != Chat.ANSWER_ON_COMPUTER) Text(ChatText.clean(what), fontSize = 13.sp, color = Ink)
            if (row.input.isNotBlank()) { Spacer(Modifier.height(6.dp)); Mono(row.input) }
            Spacer(Modifier.height(10.dp))
            val options = ChatActions.options(s, row)
            if (options.isNotEmpty()) QuestionOptions(row, s, options, vm)
            else if (choices.isEmpty()) Text(ChatActions.pendingNote(s, row), fontSize = 12.sp, color = Muted)
            else Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                // The mock's order: No, Always, Yes, with Yes taking the wider third.
                for (c in choices.sortedBy { when (it) { "deny" -> 0; "allow-always" -> 1; else -> 2 } }) {
                    val weight = if (c == "allow") 1.4f else 1f
                    val shape = RoundedCornerShape(ChatStyle.CARD_BUTTON_RADIUS)
                    val button = Modifier.weight(weight).height(ChatStyle.CARD_BUTTON_HEIGHT)
                    when (c) {
                        "deny" -> OutlinedButton(onClick = { vm.chatAnswer(row, c) }, modifier = button, shape = shape,
                            colors = ButtonDefaults.outlinedButtonColors(contentColor = Ink), border = BorderStroke(1.5.dp, Border),
                            contentPadding = PaddingValues(horizontal = 8.dp)) {
                            Text("No", fontSize = ChatStyle.CARD_BUTTON_TEXT, fontWeight = FontWeight.SemiBold)
                        }
                        "allow-always" -> OutlinedButton(onClick = { vm.chatAnswer(row, c) }, modifier = button, shape = shape,
                            colors = ButtonDefaults.outlinedButtonColors(contentColor = Accent), border = BorderStroke(1.5.dp, Accent),
                            contentPadding = PaddingValues(horizontal = 8.dp)) {
                            Text("Always", fontSize = ChatStyle.CARD_BUTTON_TEXT, fontWeight = FontWeight.Bold)
                        }
                        else -> Button(onClick = { vm.chatAnswer(row, c) }, modifier = button, shape = shape,
                            colors = ButtonDefaults.buttonColors(containerColor = Accent, contentColor = OnAccent),
                            contentPadding = PaddingValues(horizontal = 8.dp)) {
                            Text("Yes", fontSize = ChatStyle.CARD_CONFIRM_TEXT, fontWeight = FontWeight.Bold)
                        }
                    }
                }
            }
        }
    }
}

/**
 * A card that closed while the phone was away (#733): the Bot, the kind of card and when it closed, what it asked, and
 * how it ended as bots-dsh's settled entry says, or [Chat.CLOSED_AWAY] with no outcome claimed. It stays until dismissed.
 */
@Composable private fun ReceiptCard(r: Chat.Receipt, bot: String, onDismiss: (String) -> Unit) {
    val time = remember(r.at) { DateFormat.getTimeInstance(DateFormat.SHORT).format(Date(r.at)) }
    Surface(color = Surface, shape = RoundedCornerShape(12.dp), border = BorderStroke(1.dp, Border), modifier = Modifier.fillMaxWidth()) {
        Row(Modifier.padding(start = 12.dp, top = 8.dp, bottom = 8.dp), verticalAlignment = Alignment.Top) {
            Column(Modifier.weight(1f).padding(top = 2.dp)) {
                Text(ChatText.clean(Chat.receiptHeading(r, bot, time)), fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = Muted)
                if (r.label.isNotBlank() && r.label != Chat.ANSWER_ON_COMPUTER) { Spacer(Modifier.height(4.dp)); Text(ChatText.clean(r.label), fontSize = 13.sp, color = Ink) }
                Spacer(Modifier.height(4.dp))
                Text(ChatText.clean(Chat.receiptText(r)), fontSize = 12.sp, color = Ink)
            }
            IconButton(onClick = { onDismiss(r.id) }) { Icon(Icons.Outlined.Close, "Dismiss", Modifier.size(16.dp), tint = Muted) }
        }
    }
}

/**
 * A question's options, as the engine named them (option 1 first): a tap answers a single-select; a multi-select is
 * ticked, then submitted; a single-select also takes a typed answer. What is sent is [ChatActions.questionAnswer]'s.
 */
@Composable private fun QuestionOptions(row: Chat.Row, s: Chat.State, options: List<String>, vm: PocketViewModel) {
    var picked by remember(row.id) { mutableStateOf(listOf<Int>()) }
    var typed by remember(row.id) { mutableStateOf("") }
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        options.forEachIndexed { i, label ->
            if (row.multi) Row(Modifier.fillMaxWidth().heightIn(min = ChatStyle.CARD_BUTTON_HEIGHT)
                .clickable { picked = if (i in picked) picked - i else picked + i }, verticalAlignment = Alignment.CenterVertically) {
                Checkbox(checked = i in picked, onCheckedChange = { picked = if (it) picked + i else picked - i })
                Text(ChatText.clean(label), fontSize = ChatStyle.CARD_BUTTON_TEXT, color = Ink)
            }
            else OutlinedButton(onClick = { vm.chatAnswerQuestion(row, listOf(i)) },
                modifier = Modifier.fillMaxWidth().heightIn(min = ChatStyle.CARD_BUTTON_HEIGHT), shape = RoundedCornerShape(ChatStyle.CARD_BUTTON_RADIUS)) {
                Text(ChatText.clean(label), fontSize = ChatStyle.CARD_BUTTON_TEXT)
            }
        }
        if (row.multi) Button(onClick = { vm.chatAnswerQuestion(row, picked) }, enabled = picked.isNotEmpty(),
            modifier = Modifier.heightIn(min = ChatStyle.CARD_BUTTON_HEIGHT), shape = RoundedCornerShape(ChatStyle.CARD_BUTTON_RADIUS)) {
            Text("Submit", fontSize = ChatStyle.CARD_BUTTON_TEXT)
        }
        if (ChatActions.canType(s, row)) Row(verticalAlignment = Alignment.CenterVertically) {
            OutlinedTextField(typed, { typed = it.replace("\n", " ") }, placeholder = { Text("Or type an answer…", fontSize = 13.sp) },
                textStyle = TextStyle(fontSize = 16.sp), modifier = Modifier.weight(1f), singleLine = true, shape = RoundedCornerShape(ChatStyle.CARD_BUTTON_RADIUS))
            TextButton(onClick = { vm.chatAnswerQuestion(row, emptyList(), typed) }, enabled = typed.isNotBlank()) { Text("Send", fontSize = 13.sp) }
        }
    }
}

/** A message this phone wrote, until the transcript shows it. */
@Composable private fun MessageView(m: Chat.Message, s: Chat.State, onSendNow: (Chat.Message) -> Unit, onCancel: (Chat.Message) -> Unit, onRetry: (Chat.Message) -> Unit) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
        Surface(color = Accent.copy(alpha = .08f), shape = RoundedCornerShape(12.dp), border = BorderStroke(1.dp, Accent.copy(alpha = .3f)), modifier = Modifier.widthIn(max = 560.dp)) {
            Column(Modifier.padding(10.dp, 8.dp)) {
                Text(ChatText.clean(m.text), fontSize = 14.sp, lineHeight = 20.sp, color = Ink)
                Spacer(Modifier.height(4.dp))
                Text(when (m.state) {
                    // A DSH chat's `sent` is final (bots-dsh prompted the Session); a terminal's waits for the transcript.
                    "sent" -> if (s.dsh) "Sent" else "Sending…"
                    "sending" -> "Sending…"
                    "queued" -> "Queued: the agent reads it after this turn"
                    "held" -> when (m.why) { "draft" -> "The terminal has a half-typed message"; "dialog" -> "Waiting: a question is open in the terminal"
                        "working" -> "Waiting for the agent to finish"; else -> "Waiting to send" }
                    "refused" -> "Not sent" + m.reason.takeIf { it.isNotBlank() }?.let { " ($it)" }.orEmpty()
                    "maybe" -> "Maybe not sent"
                    else -> m.state
                }, fontSize = 11.sp, color = if (m.state == "refused" || m.state == "maybe") Blocked else Muted)
                if (ChatActions.canSendHeld(s, m)) Row {
                    TextButton(onClick = { onSendNow(m) }) { Text("Send now", fontSize = 12.sp) }
                    TextButton(onClick = { onCancel(m) }) { Text("Cancel", fontSize = 12.sp) }
                }
                if (ChatActions.canRetry(s, m)) TextButton(onClick = { onRetry(m) }) { Text("Retry", fontSize = 12.sp) }
            }
        }
    }
}

/** The Automagik Bots' chats on machine [hostId], and whether its bridge takes phone writes there, to open one. */
@Composable fun BotChatsDialog(vm: PocketViewModel, hostId: String, onDismiss: () -> Unit) {
    LaunchedEffect(hostId) { vm.loadBotChats(hostId) }
    val result = vm.botChats.collectAsStateWithLifecycle().value[hostId]
    val writable = ChatActions.botChatsWritable(result, vm.botWrites.collectAsStateWithLifecycle().value[hostId])
    AlertDialog(onDismissRequest = onDismiss, title = { Text("Bot chats") },
        text = {
            Column(Modifier.heightIn(max = 420.dp).verticalScroll(rememberScrollState())) {
                ChatActions.botChatsLine(writable)?.let { line ->
                    Text(line, fontSize = 12.sp, color = Muted)
                    Spacer(Modifier.height(10.dp))
                }
                when {
                    result == null -> CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
                    result.isFailure -> Text(result.exceptionOrNull()?.message ?: "Couldn’t read the chats.", fontSize = 13.sp, color = Blocked)
                    result.getOrNull().isNullOrEmpty() -> Text("No Automagik Bot chats on this computer.", fontSize = 13.sp, color = Muted)
                    else -> for (t in result.getOrThrow()) Row(Modifier.fillMaxWidth().clickable { onDismiss(); vm.selectTerminal(TerminalRef(hostId, t.terminal)) }.padding(vertical = 10.dp),
                        verticalAlignment = Alignment.CenterVertically) {
                        Dot(stateColor(t.status))
                        Spacer(Modifier.width(10.dp))
                        Text(ChatText.clean(t.title).ifBlank { t.terminal }, fontSize = 14.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                }
            }
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text("Close") } })
}
