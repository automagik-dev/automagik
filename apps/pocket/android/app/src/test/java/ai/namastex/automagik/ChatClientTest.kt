package ai.namastex.automagik

import kotlinx.coroutines.*
import kotlinx.coroutines.channels.Channel
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.Closeable
import java.io.DataInputStream
import java.io.OutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread

/** [ChatClient] against a fake Pocket Link chat route that speaks chat.mjs's framing over in-memory streams. */
class ChatClientTest {
    /** The bridge's side: answers hello, records every frame the phone sends, answers requests with [answer]. */
    private class FakeBridge(chat: Boolean, val answer: (JSONObject) -> JSONObject = { JSONObject() }) {
        val toPhone = Channel<ByteArray>(Channel.UNLIMITED)
        val fromPhone = Channel<ByteArray>(Channel.UNLIMITED)
        val requests = LinkedBlockingQueue<JSONObject>()
        val credits = LinkedBlockingQueue<Pair<Int, Int>>()
        val closes = LinkedBlockingQueue<Int>()
        val phoneOut = object : OutputStream() {
            override fun write(b: Int) = write(byteArrayOf(b.toByte()), 0, 1)
            override fun write(b: ByteArray, off: Int, len: Int) { fromPhone.trySend(b.copyOfRange(off, off + len)) }
        }
        val phoneIn = ChannelInputStream(toPhone)

        fun send(bytes: ByteArray) { toPhone.trySend(bytes) }
        fun frame(channel: Int, kind: Int, payload: ByteArray) = send(Wire.encode(channel, kind, payload))

        init {
            thread(isDaemon = true) {
                val input = DataInputStream(ChannelInputStream(fromPhone))
                val line = StringBuilder()
                while (true) { val c = input.read(); if (c == -1) return@thread; if (c == 10) break; line.append(c.toChar()) }
                val hello = JSONObject(line.toString())
                val result = JSONObject().put("generation", 1).put("framed", true).apply { if (chat) put("chat", 1).put("credit", 256 * 1024) }
                send((JSONObject().put("jsonrpc", "2.0").put("id", hello.get("id")).put("result", result).toString() + "\n").toByteArray())
                try {
                    while (true) {
                        val head = ByteArray(9); input.readFully(head)
                        val (channel, kind, length) = Wire.header(head)
                        val payload = ByteArray(length); input.readFully(payload)
                        when {
                            channel == 0 && kind == Wire.DATA -> {
                                val m = JSONObject(String(payload, Charsets.UTF_8))
                                requests.put(m)
                                val reply = JSONObject().put("jsonrpc", "2.0").put("id", m.get("id")).put("result", answer(m))
                                frame(0, Wire.DATA, reply.toString().toByteArray())
                            }
                            kind == Wire.CREDIT -> credits.put(channel to ByteBuffer.wrap(payload).order(ByteOrder.LITTLE_ENDIAN).int)
                            kind == Wire.CLOSE -> closes.put(channel)
                        }
                    }
                } catch (_: Exception) { }
            }
        }
    }

    private fun withChat(bridge: FakeBridge, test: suspend CoroutineScope.(ChatClient) -> Unit) = runBlocking {
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
        val core = CoreClient(bridge.phoneIn, bridge.phoneOut, Closeable { bridge.toPhone.close() }, scope) { }
        try { withTimeout(10_000) { test(ChatClient.start(core)) } } finally { core.close(); scope.cancel() }
    }

    private fun LinkedBlockingQueue<JSONObject>.next() = poll(5, TimeUnit.SECONDS) ?: error("no request")

    @Test fun anOlderBridgeWithoutChatSaysToUpdatePocketLink() = runBlocking {
        val bridge = FakeBridge(chat = false)
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
        try {
            val e = runCatching { withTimeout(10_000) { ChatClient.start(CoreClient(bridge.phoneIn, bridge.phoneOut, Closeable { }, scope) { }) } }.exceptionOrNull()
            assertTrue(e is ChatUnsupported)
            assertEquals(Chat.UPDATE_LINK, e?.message)
        } finally { scope.cancel() }
        assertTrue(ChatClient.refusedRoute(IllegalStateException("connection failed: peer refused ALPN herdr-pocket/chat/1")))
        assertFalse(ChatClient.refusedRoute(IllegalStateException("timed out")))
    }

    @Test fun listsAndSubscribesThenGrantsCreditForEachEvent() {
        val bridge = FakeBridge(chat = true) { m ->
            when (m.getString("method")) {
                "chat.list" -> JSONObject("""{"terminals":[{"terminal":"t3","machine":null,"agent":"claude","title":"API","status":{"state":"working"},"chat":"transcript"},
                    {"terminal":"dsh:b1","machine":null,"agent":"dsh","title":"Omni","status":{"state":"idle"},"chat":"session"}]}""")
                "chat.subscribe" -> JSONObject().put("channel", 1)
                else -> JSONObject()
            }
        }
        withChat(bridge) { chat ->
            val list = chat.list()
            assertEquals(listOf("t3", "dsh:b1"), list.map { it.terminal })
            assertEquals(listOf(false, true), list.map { it.readOnly })
            assertEquals("working", list[0].status)
            val events = Channel<JSONObject>(Channel.UNLIMITED)
            val channel = chat.subscribe("t3", "1:4.0", { events.trySend(it) }) { }
            assertEquals(1, channel)
            assertEquals("chat.list", bridge.requests.next().getString("method"))
            val subscribe = bridge.requests.next()
            assertEquals("t3", subscribe.getJSONObject("params").getString("terminal"))
            assertEquals("1:4.0", subscribe.getJSONObject("params").getString("after"))
            val snapshot = """{"type":"snapshot","reset":false,"rows":[{"id":"1:5.0","kind":"text","role":"assistant","text":"<img src=x>"}],"screen":[],"status":{"state":"working"},"approval":null,"held":[]}""" + "\n"
            bridge.frame(1, Wire.DATA, snapshot.toByteArray())
            val e = events.receive()
            assertEquals("snapshot", e.getString("type"))
            assertEquals("<img src=x>", Chat.reduce(Chat.State("t3"), e).rows.single().text)
            assertEquals(1 to snapshot.toByteArray().size, bridge.credits.poll(5, TimeUnit.SECONDS))
            chat.unsubscribe(channel)
            assertEquals(1, bridge.closes.poll(5, TimeUnit.SECONDS))
        }
    }

    @Test fun writesGoToTheBridgeForATerminal() {
        val bridge = FakeBridge(chat = true) { m -> if (m.getString("method") == "chat.send") JSONObject().put("state", "held").put("id", "m1").put("why", "draft") else JSONObject().put("ok", true) }
        withChat(bridge) { chat ->
            assertEquals("held", chat.send("t3", "run tests", "m1").getString("state"))
            val send = bridge.requests.next()
            assertEquals("chat.send", send.getString("method"))
            val params = send.getJSONObject("params")
            assertEquals(listOf("t3", "run tests", "m1"), listOf("terminal", "text", "id").map { params.getString(it) })
            assertEquals(3, params.length())
            chat.sendHeld("t3", "m1"); assertEquals("chat.sendHeld", bridge.requests.next().getString("method"))
            chat.answer("t3", "approval:c1", "allow"); assertEquals("chat.answer", bridge.requests.next().getString("method"))
            chat.interrupt("t3"); assertEquals("chat.interrupt", bridge.requests.next().getString("method"))
        }
    }

    /** A DSH chat is read only: the phone sends no write for it at all, and answers as the bridge would. */
    @Test fun phoneNeverWritesOnADshChat() {
        val bridge = FakeBridge(chat = true) { JSONObject().put("ok", true) }
        withChat(bridge) { chat ->
            for (answer in listOf(chat.send("dsh:b1", "hi", "m1"), chat.sendHeld("dsh:b1", "m1"), chat.cancelHeld("dsh:b1", "m1"),
                chat.answer("dsh:b1", "dsh:s:1:approval", "allow"), chat.interrupt("dsh:b1"))) {
                assertEquals("refused", answer.getString("state"))
                assertEquals("read-only", answer.getString("reason"))
                assertEquals(Chat.ANSWER_ON_COMPUTER, answer.getString("message"))
            }
            // A read still goes, so the queue holds exactly that one request.
            chat.list()
            assertEquals("chat.list", bridge.requests.next().getString("method"))
            assertTrue(bridge.requests.isEmpty())
        }
    }
}
