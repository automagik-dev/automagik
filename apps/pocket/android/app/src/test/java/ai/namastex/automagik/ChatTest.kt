package ai.namastex.automagik

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

/** The chat's model, its button gate and its text rendering (RFC 0015 delivery 5). */
class ChatTest {
    private fun j(text: String) = JSONObject(text)
    private fun state(terminal: String = "t1") = Chat.reduce(Chat.State(terminal), j("""{"type":"snapshot","reset":false,"rows":[],"screen":[],
        "status":{"state":"idle","kind":null,"msg":""},"approval":null,"held":[]}"""))
    private fun approval(open: Boolean = true, choices: String = """["allow","deny"]""") =
        """{"id":"approval:c1","kind":"approval","source":"status","tool":"Bash","summary":"npm test","input":"npm test","call":"c1","choices":$choices,"open":$open}"""
    private fun blocked(s: Chat.State) = Chat.reduce(s, j("""{"type":"status","status":{"state":"blocked","kind":"permission","msg":"Allow?"}}"""))

    // ---- rendering: plain text only, nothing loads or runs

    /** No image block exists; a lone tag is one plain span, its characters exactly as written. */
    @Test fun imgTagRendersAsPlainTextAndLoadsNothing() {
        val blocks = ChatText.blocks("<img src=x>")
        assertEquals(listOf(ChatText.Prose(listOf(ChatText.Plain("<img src=x>")))), blocks)
        val withUrl = ChatText.blocks("""<img src="https://evil.example/pixel.png" onerror="fetch('https://evil.example')">""")
        val spans = (withUrl.single() as ChatText.Prose).spans
        assertEquals("""<img src="https://evil.example/pixel.png" onerror="fetch('https://evil.example')">""", spans.joinToString("") { it.text })
        // The URL is only a link that shows its own target, opened on a tap; nothing fetches it.
        assertTrue(spans.filterIsInstance<ChatText.Link>().all { it.text.startsWith("https://evil.example") })
        assertTrue(withUrl.all { it is ChatText.Prose || it is ChatText.Code })
    }

    @Test fun scriptTagRendersAsPlainTextAndRunsNothing() {
        val text = "<script>alert(document.cookie)</script>"
        assertEquals(listOf(ChatText.Prose(listOf(ChatText.Plain(text)))), ChatText.blocks(text))
        val mixed = "before <script src=\"https://evil.example/x.js\"></script> after"
        val spans = (ChatText.blocks(mixed).single() as ChatText.Prose).spans
        assertEquals(mixed, spans.joinToString("") { it.text })
        assertEquals(listOf("https://evil.example/x.js"), spans.filterIsInstance<ChatText.Link>().map { it.text })
    }

    @Test fun markdownImageIsATapOnlyLinkNeverAnImage() {
        val spans = (ChatText.blocks("![logo](https://evil.example/logo.png)").single() as ChatText.Prose).spans
        assertEquals("![logo](https://evil.example/logo.png)", spans.joinToString("") { it.text })
        assertEquals(listOf(ChatText.Link("https://evil.example/logo.png")), spans.filterIsInstance<ChatText.Link>())
    }

    @Test fun onlyHttpLinksBecomeLinks() {
        val spans = (ChatText.blocks("javascript:alert(1) file:///etc/passwd data:text/html,<b>x</b>").single() as ChatText.Prose).spans
        assertTrue(spans.none { it is ChatText.Link })
    }

    @Test fun escapeSequencesAndControlCharactersAreRemoved() {
        assertEquals("red plain\ttab\nline", ChatText.clean("\u001b[31mred\u001b[0m plain\ttab\r\nline\u0007\u0000"))
        assertEquals("title gone", ChatText.clean("\u001b]0;evil\u0007title gone"))
        assertEquals("pasted", ChatText.clean("\u001b[200~pasted\u001b[201~"))
        assertEquals("ab", ChatText.clean("a\u009b31mb\u007f"))
    }

    @Test fun fencedCodeIsItsOwnMonospaceBlock() {
        val blocks = ChatText.blocks("Run this:\n```sh\nrm -rf <dir>\n```\nDone")
        assertEquals(listOf(ChatText.Prose(listOf(ChatText.Plain("Run this:"))), ChatText.Code("rm -rf <dir>"), ChatText.Prose(listOf(ChatText.Plain("Done")))), blocks)
        assertEquals(listOf(ChatText.Code("never closed")), ChatText.blocks("```\nnever closed"))
    }

    // ---- read only: a DSH chat gets no action, whatever its rows claim

    @Test fun dshChatOffersNoActionsEvenWhenRowsClaimChoices() {
        val s = blocked(state("dsh:bot-1"))
        // A hostile or mistaken row: open, answerable, with choices.
        val claimed = Chat.reduce(s, j("""{"type":"approval","row":${approval()}}"""))
        assertTrue(claimed.readOnly)
        assertEquals(emptyList<String>(), ChatActions.choices(claimed, claimed.approval))
        assertFalse(ChatActions.canSend(claimed))
        assertFalse(ChatActions.canInterrupt(claimed))
        assertFalse(ChatActions.canShowTerminal(claimed))
        val held = Chat.Message("m1", "hi", "held", "draft")
        assertFalse(ChatActions.canSendHeld(claimed.copy(messages = listOf(held)), held))
        assertFalse(ChatActions.canRetry(claimed, Chat.Message("m2", "hi", "maybe")))
    }

    @Test fun dshApprovalShowsAnswerOnTheComputer() {
        val row = """{"id":"dsh:s:4:approval","turn":0,"at":null,"source":"session","kind":"approval","tool":"","summary":"Answer on the computer","choices":[],"open":true,"answerable":false}"""
        val s = Chat.reduce(state("dsh:bot-1"), j("""{"type":"approval","row":$row}"""))
        assertNotNull(s.approval)
        assertEquals(emptyList<String>(), ChatActions.choices(s, s.approval))
        assertEquals(Chat.ANSWER_ON_COMPUTER, ChatActions.passive(s))
        val question = Chat.reduce(s, j("""{"type":"question","row":{"id":"q","kind":"question","prompt":"Answer on the computer","options":[],"multi":false,"answerable":false}}"""))
        assertEquals(emptyList<String>(), ChatActions.choices(question, question.question))
    }

    @Test fun terminalApprovalGetsOnlyTheEngineChoices() {
        val s = Chat.reduce(blocked(state()), j("""{"type":"approval","row":${approval(choices = """["allow","allow-always","deny","press-9"]""")}}"""))
        assertEquals(listOf("allow", "allow-always", "deny"), ChatActions.choices(s, s.approval))
        assertEquals(Chat.ANSWER_IN_TERMINAL, ChatActions.passive(s))
        // No choices from the engine (an unrecognised dialog): no buttons.
        val none = Chat.reduce(s, j("""{"type":"approval","row":${approval(choices = "[]")}}"""))
        assertEquals(emptyList<String>(), ChatActions.choices(none, none.approval))
        // Offline or disconnected: nothing to press.
        assertEquals(emptyList<String>(), ChatActions.choices(s.copy(offline = true), s.approval))
        assertEquals(emptyList<String>(), ChatActions.choices(s.copy(connected = false), s.approval))
    }

    // ---- questions: the engine's options, tapped as the digits chat/question.js reads

    private fun question(multi: Boolean = false, answerable: Boolean = true) =
        """{"id":"question:1:2.0","kind":"question","source":"status","turn":3,"prompt":"Which database?","options":["Postgres","SQLite"],"multi":$multi,"answerable":$answerable,"call":"1:2.0","open":true}"""
    private fun asked(s: Chat.State, row: String) = Chat.reduce(Chat.reduce(s, j("""{"type":"status","status":{"state":"blocked","kind":"question","msg":"Which database?"}}""")), j("""{"type":"question","row":$row}"""))

    @Test fun questionRowShowsItsOptionsAndATapIsThatOptionsDigit() {
        val s = asked(state(), question())
        assertEquals(listOf("Postgres", "SQLite"), ChatActions.options(s, s.question))
        assertTrue(ChatActions.canType(s, s.question))
        assertEquals("2" to null, ChatActions.questionAnswer(s, s.question, listOf(1)))
        assertEquals(ChatActions.OTHER to "MySQL 8", ChatActions.questionAnswer(s, s.question, emptyList(), " MySQL 8 "))
        // One option on a single-select, in range; a typed answer is one line, not blank.
        for (picked in listOf(listOf(0, 1), listOf(2), listOf(-1), emptyList())) assertNull(ChatActions.questionAnswer(s, s.question, picked))
        for (text in listOf("", "  ", "two\nlines")) assertNull(ChatActions.questionAnswer(s, s.question, emptyList(), text))
        // Approval buttons are not question options, and the other way round.
        assertEquals(emptyList<String>(), ChatActions.choices(s, s.question))
    }

    @Test fun multiSelectQuestionSubmitsTheTickedDigitsAndTakesNoTypedAnswer() {
        val s = asked(state(), question(multi = true))
        assertEquals(listOf("Postgres", "SQLite"), ChatActions.options(s, s.question))
        assertFalse(ChatActions.canType(s, s.question))
        assertEquals("2,1" to null, ChatActions.questionAnswer(s, s.question, listOf(1, 0)))
        assertNull(ChatActions.questionAnswer(s, s.question, listOf(1, 1)))
        assertNull(ChatActions.questionAnswer(s, s.question, emptyList(), "x"))
    }

    /** A phone that opens the chat after the question was raised (an app restart, another device) gets it from the snapshot. */
    @Test fun questionInTheSnapshotShowsOnAFreshChatAndCanBeAnswered() {
        val fresh = Chat.reduce(Chat.State("t1"), j("""{"type":"snapshot","reset":false,"rows":[],"screen":[],
            "status":{"state":"blocked","kind":"question","msg":"Which database?"},"approval":null,"question":${question()},"held":[]}"""))
        assertEquals("question:1:2.0", fresh.question?.id)
        assertEquals(listOf("Postgres", "SQLite"), ChatActions.options(fresh, fresh.question))
        assertEquals("2" to null, ChatActions.questionAnswer(fresh, fresh.question, listOf(1)))
        // A closed question in the snapshot, or none: no card.
        val closed = question().replace("\"open\":true", "\"open\":false")
        assertNull(Chat.reduce(fresh, j("""{"type":"snapshot","reset":false,"rows":[],"screen":[],"status":{"state":"blocked","kind":"question"},"question":$closed,"held":[]}""")).question)
        assertNull(Chat.reduce(fresh, j("""{"type":"snapshot","reset":false,"rows":[],"screen":[],"status":{"state":"working"},"question":null,"held":[]}""")).question)
    }

    @Test fun questionWithoutTheEngineOptionsOffersNothingToTap() {
        for (s in listOf(asked(state(), question(answerable = false)), asked(state("dsh:bot-1"), question()),
            asked(state(), question()).copy(offline = true), asked(state(), question()).copy(connected = false))) {
            assertEquals(emptyList<String>(), ChatActions.options(s, s.question))
            assertNull(ChatActions.questionAnswer(s, s.question, listOf(0)))
            assertNull(ChatActions.questionAnswer(s, s.question, emptyList(), "x"))
        }
        // An approval row never gets question options.
        val a = Chat.reduce(blocked(state()), j("""{"type":"approval","row":${approval()}}"""))
        assertEquals(emptyList<String>(), ChatActions.options(a, a.approval))
    }

    @Test fun approvalClosesWhenTheEngineSaysSo() {
        val s = Chat.reduce(blocked(state()), j("""{"type":"approval","row":${approval()}}"""))
        assertEquals("approval:c1", s.approval?.id)
        assertNull(Chat.reduce(s, j("""{"type":"approval","row":${approval(open = false)}}""")).approval)
    }

    @Test fun interruptOnlyWhileTheAgentIsBusy() {
        assertFalse(ChatActions.canInterrupt(state()))
        assertTrue(ChatActions.canInterrupt(Chat.reduce(state(), j("""{"type":"status","status":{"state":"working"}}"""))))
        assertTrue(ChatActions.canInterrupt(blocked(state())))
        assertTrue(ChatActions.canShowTerminal(state()))
    }

    // ---- the stream's events

    @Test fun snapshotRowsAndScreenFold() {
        var s = Chat.reduce(Chat.State("t1"), j("""{"type":"snapshot","reset":false,"rows":[{"id":"1:1.0","kind":"text","role":"user","text":"hi","source":"transcript"}],
            "screen":[{"id":"screen:1","kind":"text","role":"assistant","text":"thinking"}],"status":{"state":"working"},"approval":null,"held":[]}"""))
        assertTrue(s.connected)
        assertEquals("1:1.0", s.cursor)
        assertEquals(1, s.screen.size)
        s = Chat.reduce(s, j("""{"type":"rows","rows":[{"id":"1:2.0","kind":"text","role":"assistant","text":"hello"},{"id":"1:1.0","kind":"text","role":"user","text":"hi!"}]}"""))
        assertEquals(listOf("1:1.0", "1:2.0"), s.rows.map { it.id })
        assertEquals("hi!", s.rows[0].text)
        s = Chat.reduce(s, j("""{"type":"screen","rows":[]}"""))
        assertEquals(emptyList<Chat.Row>(), s.screen)
        // A reset (the bridge restarted) replaces the rows with the latest page.
        s = Chat.reduce(s, j("""{"type":"snapshot","reset":true,"rows":[{"id":"1:9.0","kind":"text","role":"assistant","text":"new"}],"screen":[],"status":{"state":"idle"},"approval":null,"held":[]}"""))
        assertEquals(listOf("1:9.0"), s.rows.map { it.id })
    }

    @Test fun aDshSnapshotWithoutScreenOrHeldStillFolds() {
        val s = Chat.reduce(Chat.State("dsh:b"), j("""{"type":"snapshot","rows":[{"id":"r","kind":"text","role":"assistant","text":"x"}]}"""))
        assertEquals(1, s.rows.size)
        assertTrue(s.connected)
        assertEquals(s, Chat.reduce(s, j("""{"type":"something-new"}""")))
    }

    @Test fun goneOfflineAndScreenOnly() {
        val s = Chat.reduce(blocked(state()), j("""{"type":"approval","row":${approval()}}"""))
        val offline = Chat.reduce(s, j("""{"type":"offline"}"""))
        assertTrue(offline.offline); assertNull(offline.approval); assertFalse(ChatActions.canSend(offline))
        val gone = Chat.reduce(s, j("""{"type":"gone"}"""))
        assertTrue(gone.gone); assertFalse(ChatActions.canSend(gone))
        assertTrue(Chat.reduce(s, j("""{"type":"source","source":"none"}""")).screenOnly)
    }

    @Test fun heldMessageThenSendNowThenMatched() {
        var s = state()
        s = s.copy(messages = listOf(Chat.Message("m1", "run tests", "sending")))
        s = Chat.answered(s, "m1", "run tests", j("""{"state":"held","id":"m1","why":"draft"}"""))
        val held = s.messages.single()
        assertEquals("held", held.state); assertEquals("draft", held.why)
        assertTrue(ChatActions.canSendHeld(s, held))
        s = Chat.reduce(s, j("""{"type":"sent","id":"m1","state":"sent"}"""))
        s = Chat.reduce(s, j("""{"type":"sending","id":"m1"}"""))
        assertEquals("sending", s.messages.single().state)
        s = Chat.reduce(s, j("""{"type":"matched","id":"m1","row":"1:3.0"}"""))
        assertTrue(s.messages.isEmpty())
    }

    @Test fun resubscribeKeepsOnlyWhatTheBridgeStillHolds() {
        val s = state().copy(messages = listOf(Chat.Message("a", "x", "held", "draft"), Chat.Message("b", "y", "held", "working"), Chat.Message("c", "z", "sending")))
        val after = Chat.reduce(s, j("""{"type":"snapshot","rows":[],"held":[{"id":"b","why":"dialog"}]}"""))
        assertEquals(listOf("b" to "dialog", "c" to ""), after.messages.map { it.id to it.why })
    }

    @Test fun refusedAndUnansweredSends() {
        val refused = Chat.answered(state(), "m", "x", j("""{"state":"refused","id":"m","reason":"empty"}"""))
        assertEquals("refused", refused.messages.single().state)
        val maybe = Chat.unanswered(state(), "m", "x")
        assertEquals("maybe", maybe.messages.single().state)
        assertTrue(ChatActions.canRetry(maybe, maybe.messages.single()))
    }

    @Test fun earlierPagesGoBeforeAndStopWhenEmpty() {
        val s = Chat.reduce(state(), j("""{"type":"rows","rows":[{"id":"1:5.0","kind":"text","text":"b"}]}"""))
        val more = Chat.earlier(s, JSONArray("""[{"id":"1:4.0","kind":"text","text":"a"},{"id":"1:5.0","kind":"text","text":"b"}]"""))
        assertEquals(listOf("1:4.0", "1:5.0"), more.rows.map { it.id })
        assertTrue(more.more)
        assertFalse(Chat.earlier(more, JSONArray()).more)
    }

    @Test fun answerNotices() {
        assertNull(Chat.answerNotice(j("""{"ok":true,"pressed":"done","sent":true}""")))
        assertEquals("The question changed; nothing was pressed.", Chat.answerNotice(j("""{"ok":false,"reason":"changed"}""")))
        assertEquals(Chat.ANSWER_ON_COMPUTER, Chat.answerNotice(j("""{"state":"refused","ok":false,"reason":"read-only"}""")))
        assertEquals("Stopped partway: the question moved on. Finish in the terminal.", Chat.answerNotice(j("""{"ok":false,"reason":"stopped","sent":true}""")))
        // Keys sent but the dialog stayed past the bridge's read-back: not taken, never a success.
        assertEquals("Not taken: answer on the Mac.", Chat.answerNotice(j("""{"ok":true,"pressed":"uncertain","sent":true}""")))
    }

    @Test fun aPendingRowSaysAnsweredOnlyWhenTheBridgeSawItTaken() {
        val s = Chat.State("t1", connected = true)
        val row = Chat.Row("approval:c1", "approval", open = true)
        assertEquals("Answered.", ChatActions.pendingNote(s, row.copy(why = "answered")))
        assertEquals("Not taken: answer on the Mac.", ChatActions.pendingNote(s, row.copy(why = "not-taken")))
        assertEquals(Chat.ANSWER_IN_TERMINAL, ChatActions.pendingNote(s, row))
    }

    @Test fun chatTabOnlyForAgentsTheBridgeReads() {
        fun t(agent: String, app: String = "", argv: List<String> = emptyList(), state: String = "live") =
            CoreTerminal("t1", "x", "/", state, "idle", agent, "", 80, 24, app = app, argv = argv)
        assertTrue(Chat.offered(t("Claude Code", app = "claude-code")))
        assertTrue(Chat.offered(t("node", argv = listOf("/usr/local/bin/codex"))))
        assertTrue(Chat.offered(t("omp")))
        assertFalse(Chat.offered(t("zsh")))
        assertFalse(Chat.offered(t("claude", app = "claude-code", state = "finished")))
        assertFalse(Chat.offered(null))
    }
}
