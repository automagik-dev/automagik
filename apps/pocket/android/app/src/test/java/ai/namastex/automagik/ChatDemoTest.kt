package ai.namastex.automagik

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The preview's sample main-bot chat: the three things it must show, and the bubble that opens it. */
class ChatDemoTest {
    @Test fun theSampleChatHasAPendingApprovalAQuestionAndALongAnswer() {
        val s = ChatDemo.state()
        assertEquals(ChatDemo.TERMINAL, s.terminal)
        assertTrue(Chat.isDsh(s.terminal))
        assertTrue(s.connected && s.dshWrite)
        val approval = requireNotNull(s.approval)
        assertEquals("approval", approval.kind)
        assertTrue(approval.open && approval.answerable)
        assertTrue("allow" in approval.choices)
        val question = requireNotNull(s.question)
        assertEquals("question", question.kind)
        assertTrue(question.open && question.answerable)
        assertTrue(question.options.size >= 2)
        val reply = s.rows.filter { it.kind == "text" && it.role == "assistant" }.maxOf { it.text.length }
        assertTrue("the sample answer is long enough to scroll", reply >= 400)
        assertTrue(s.rows.any { it.kind == "text" && it.role == "user" })
        assertTrue("a failed tool result is drawn", s.rows.any { it.kind == "tool-result" && !it.ok })
        val receipt = requireNotNull(s.receipts.singleOrNull())
        assertEquals("approval", receipt.kind)
        assertTrue(receipt.settled)
    }

    @Test fun theListingIsTheSampleMainBot() {
        val rows = ChatDemo.listing()
        assertEquals(2, rows.size)
        val row = rows.first { it.terminal == ChatDemo.TERMINAL }
        assertEquals(ChatDemo.TERMINAL, row.terminal)
        assertTrue(row.dsh && row.shown)
        assertEquals("blocked", row.status)
        assertEquals(ChatDemo.BOT, row.registryId)
        val main = SpendDemo.MEMBERS.values.flatten().single { it.id == ChatDemo.BOT }
        assertTrue(main.main)
        assertEquals(Teams.GENIE, main.pet)
        assertEquals(main.name, row.title)
    }

    @Test fun theReadOnlySampleChatShowsTheComputerQuestion() {
        val s = ChatDemo.readOnlyState()
        assertTrue(s.readOnly)
        assertFalse(s.dshWrite)
        assertTrue(s.rows.any { it.kind == "text" })
        val question = requireNotNull(s.question)
        assertEquals("question", question.kind)
        assertFalse(question.open)
        assertFalse(question.answerable)
        assertTrue(question.options.isEmpty())
        assertEquals(Chat.ANSWER_ON_COMPUTER, question.prompt)
        assertEquals(Chat.ANSWER_ON_COMPUTER, ChatActions.pendingNote(s, question))
        assertEquals(ChatDemo.READ_ONLY_TERMINAL, ChatDemo.stateFor(ChatDemo.readOnlyRef)?.terminal)
        assertEquals(ChatDemo.TERMINAL, ChatDemo.stateFor(ChatDemo.ref)?.terminal)
        assertNull(ChatDemo.stateFor(TerminalRef(ChatDemo.HOST, "t6")))
    }

    @Test fun theTeamScreenServesTheSampleChatOnlyInTheDemo() {
        val live = mapOf("box" to listOf(Chat.Terminal("dsh:s1", "", "dsh", "Lead", "idle", "session")))
        assertEquals(ChatDemo.chats(), dshChats(demo = true, last = live, hosts = listOf("box")))
        assertEquals(live, dshChats(demo = false, last = live, hosts = listOf("box")))
        assertEquals(emptyMap<String, List<Chat.Terminal>>(), dshChats(demo = false, last = live, hosts = emptyList()))
    }

    @Test fun theSampleMainBotsBubbleOpensTheChat() {
        val main = Teams.Bot(ChatDemo.BOT, "Captain", main = true, pet = null, pose = Teams.NEEDS_YOU, message = "",
            statusMs = 0, ref = TerminalRef(ChatDemo.HOST, "t2"), kind = "approval")
        val team = Teams.Team("preview|herdr", ChatDemo.HOST, "", "space:sp1", "herdr", Teams.Icon.Letter, null, listOf(main))
        val bubble = Teams.bubbles(listOf(team), ChatDemo.chats()).single()
        assertEquals(Teams.Opens.DshChat(ChatDemo.ref), bubble.opens)
    }
}
