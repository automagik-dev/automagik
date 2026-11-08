package ai.namastex.automagik

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
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
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle

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
    val openLink = rememberLinkOpener()
    val list = rememberLazyListState()
    var draft by remember(ref) { mutableStateOf("") }
    var confirmDraft by remember(ref) { mutableStateOf<Chat.Message?>(null) }
    val count = s.rows.size + s.screen.size + s.messages.size + (if (s.approval != null) 1 else 0) + (if (s.question != null) 1 else 0)
    LaunchedEffect(count) { val items = list.layoutInfo.totalItemsCount; if (count > 0 && items > 0) list.animateScrollToItem(items - 1) }
    Column(modifier.background(Canvas)) {
        ChatBar(s, onBack, onShowTerminal?.takeIf { ChatActions.canShowTerminal(s) }, vm::chatInterrupt, vm::reconnectChat)
        s.notice?.let { notice ->
            Row(Modifier.fillMaxWidth().background(Raised).padding(start = 14.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(notice, fontSize = 12.sp, color = Ink, modifier = Modifier.weight(1f))
                IconButton(onClick = vm::dismissChatNotice) { Icon(Icons.Outlined.Close, "Dismiss", Modifier.size(16.dp), tint = Muted) }
            }
        }
        LazyColumn(Modifier.fillMaxWidth().weight(1f).alpha(if (s.offline || s.gone) .55f else 1f), state = list,
            contentPadding = PaddingValues(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            if (s.rows.isNotEmpty() && s.more) item("earlier") {
                TextButton(onClick = vm::chatEarlier, modifier = Modifier.fillMaxWidth()) { Text("Load earlier", fontSize = 12.sp) }
            }
            if (s.screenOnly) item("screen-only") { Hint("History appears when this pane’s transcript is found.") }
            items(s.rows, key = { "r:" + it.id }) { ChatRowView(it, s, vm, openLink) }
            if (s.screen.isNotEmpty()) item("live") { Hint("Live from the screen") }
            items(s.screen, key = { "s:" + it.id }) { ChatRowView(it, s, vm, openLink) }
            s.question?.let { q -> item("q:" + q.id) { ChatRowView(q, s, vm, openLink) } }
            s.approval?.let { a -> item("a:" + a.id) { ChatRowView(a, s, vm, openLink) } }
            items(s.messages, key = { "m:" + it.id }) { m -> MessageView(m, s, onSendNow = { confirmDraft = it }, onCancel = vm::chatCancelHeld, onRetry = vm::chatRetry) }
            if (count == 0 && s.error == null) item("empty") { Hint(if (s.connected) "No messages yet." else "Connecting chat…") }
        }
        val why = ChatActions.whyNoSend(s)
        if (why != null) Text(why, fontSize = 12.sp, color = Muted,
            modifier = Modifier.fillMaxWidth().background(Chrome).padding(14.dp).navigationBarsPadding())
        else if (ChatActions.canSend(s)) Row(Modifier.fillMaxWidth().background(Chrome).padding(10.dp, 4.dp).navigationBarsPadding(), verticalAlignment = Alignment.CenterVertically) {
            OutlinedTextField(draft, { draft = it }, placeholder = { Text("Message this agent…", fontSize = 12.sp) }, modifier = Modifier.weight(1f), maxLines = 5, shape = RoundedCornerShape(12.dp))
            IconButton(onClick = { vm.chatSend(draft); draft = "" }, enabled = draft.isNotBlank()) { Icon(Icons.AutoMirrored.Outlined.Send, "Send message", tint = Accent) }
        }
    }
    confirmDraft?.let { m ->
        AlertDialog(onDismissRequest = { confirmDraft = null }, title = { Text("Send now?") },
            text = { Text(if (m.why == "draft") Chat.DRAFT_WARNING + "." else "The terminal isn’t ready for it yet; it goes as soon as you send it.") },
            confirmButton = { TextButton(onClick = { vm.chatSendHeld(m); confirmDraft = null }) { Text("Send now") } },
            dismissButton = { TextButton(onClick = { confirmDraft = null }) { Text("Cancel") } })
    }
}

@Composable private fun ChatBar(s: Chat.State, onBack: () -> Unit, onShowTerminal: (() -> Unit)?, onInterrupt: () -> Unit, onReconnect: () -> Unit) {
    Column(Modifier.fillMaxWidth().background(Chrome)) {
        Row(Modifier.fillMaxWidth().padding(end = 4.dp).heightIn(min = 48.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, "Back to agents") }
            Dot(stateColor(s.status.state))
            Spacer(Modifier.width(8.dp))
            Text(when {
                s.gone -> "Ended"
                s.offline -> "Machine offline"
                else -> stateName(s.status.state) + s.status.msg.takeIf { it.isNotBlank() }?.let { " · " + ChatText.clean(it) }.orEmpty()
            }, fontSize = 12.sp, color = Muted, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
            if (ChatActions.canInterrupt(s)) TextButton(onClick = onInterrupt) { Icon(Icons.Outlined.StopCircle, null, Modifier.size(16.dp)); Spacer(Modifier.width(4.dp)); Text("Interrupt", fontSize = 12.sp) }
            if (onShowTerminal != null) TextButton(onClick = onShowTerminal) { Icon(Icons.Outlined.Terminal, null, Modifier.size(16.dp)); Spacer(Modifier.width(4.dp)); Text("Show terminal", fontSize = 12.sp) }
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
    Surface(color = Blocked.copy(alpha = .08f), shape = RoundedCornerShape(12.dp), border = BorderStroke(1.dp, Blocked.copy(alpha = .4f)), modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(12.dp)) {
            Text(if (row.kind == "approval") "Needs your approval" else "Question", fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = Blocked)
            Spacer(Modifier.height(4.dp))
            val what = if (row.kind == "approval") listOf(row.tool, row.summary).filter { it.isNotBlank() }.distinct().joinToString(": ") else row.prompt
            if (what.isNotBlank() && what != Chat.ANSWER_ON_COMPUTER) Text(ChatText.clean(what), fontSize = 13.sp, color = Ink)
            if (row.input.isNotBlank()) { Spacer(Modifier.height(6.dp)); Mono(row.input) }
            Spacer(Modifier.height(8.dp))
            val options = ChatActions.options(s, row)
            if (options.isNotEmpty()) QuestionOptions(row, s, options, vm)
            else if (choices.isEmpty()) Text(ChatActions.pendingNote(s, row), fontSize = 12.sp, color = Muted)
            else Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                for (c in choices) {
                    val label = when (c) { "allow" -> "Allow"; "allow-always" -> "Always allow"; else -> "Deny" }
                    if (c == "deny") OutlinedButton(onClick = { vm.chatAnswer(row, c) }) { Text(label, fontSize = 13.sp) }
                    else Button(onClick = { vm.chatAnswer(row, c) }) { Text(label, fontSize = 13.sp) }
                }
            }
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
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        options.forEachIndexed { i, label ->
            if (row.multi) Row(Modifier.fillMaxWidth().clickable { picked = if (i in picked) picked - i else picked + i }, verticalAlignment = Alignment.CenterVertically) {
                Checkbox(checked = i in picked, onCheckedChange = { picked = if (it) picked + i else picked - i })
                Text(ChatText.clean(label), fontSize = 13.sp, color = Ink)
            }
            else OutlinedButton(onClick = { vm.chatAnswerQuestion(row, listOf(i)) }, modifier = Modifier.fillMaxWidth()) { Text(ChatText.clean(label), fontSize = 13.sp) }
        }
        if (row.multi) Button(onClick = { vm.chatAnswerQuestion(row, picked) }, enabled = picked.isNotEmpty()) { Text("Submit", fontSize = 13.sp) }
        if (ChatActions.canType(s, row)) Row(verticalAlignment = Alignment.CenterVertically) {
            OutlinedTextField(typed, { typed = it.replace("\n", " ") }, placeholder = { Text("Or type an answer…", fontSize = 12.sp) },
                modifier = Modifier.weight(1f), singleLine = true, shape = RoundedCornerShape(12.dp))
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
