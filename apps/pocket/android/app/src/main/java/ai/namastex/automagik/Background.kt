package ai.namastex.automagik

import android.webkit.WebView
import androidx.lifecycle.Lifecycle
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.map

/**
 * What Pocket does while its screen is stopped (the app left, or the screen off): only what alerts need. The battery
 * sweep of 2026-11-07 found the stopped app streaming a terminal, reading every machine after each event, polling
 * menus and redialling an unreachable desktop every minute forever.
 */
object Background {
    /** In the background, a machine's full read (layouts, linked machines, Teams) at most this often, unless a status moved. */
    const val REFRESH_MS = 30_000L
    /** Tries at the usual pace ([RECONNECT_DELAYS]) before an unreachable machine is tried every [RECONNECT_SLOW_MS]. */
    const val RECONNECT_FAST = 8
    const val RECONNECT_SLOW_MS = 900_000L
    /** On the same network, a connect timeout drops the endpoint only every this many timeouts in a row. */
    const val REBIND_EVERY = 4
    private val RECONNECT_DELAYS = listOf(2_000L, 5_000L, 15_000L, 30_000L, 60_000L)

    /** What alerts and the watch notification read from a terminal list; a title or spinner redraw is not in it. */
    private fun pulse(terminals: List<CoreTerminal>) =
        terminals.map { listOf(it.address, it.state, it.status, it.kind, it.message, it.turn, it.parent) }

    /**
     * Whether an event reads the whole machine now: always on screen; in the background only when an agent's status,
     * turn or question changed since [before] (alerts stay at once), or [REFRESH_MS] after the last full read.
     */
    fun refresh(foreground: Boolean, before: List<CoreTerminal>?, now: List<CoreTerminal>, lastMs: Long, nowMs: Long): Boolean =
        foreground || before == null || pulse(before) != pulse(now) || nowMs - lastMs >= REFRESH_MS

    /** [read] every [period] ms while [active] is true, and nothing at all while it is false. */
    @OptIn(ExperimentalCoroutinesApi::class)
    fun <T> poll(active: Flow<Boolean>, period: Long, read: suspend () -> T): Flow<T> =
        active.distinctUntilChanged().flatMapLatest { on -> if (on) flow { while (true) { emit(read()); delay(period) } } else emptyFlow() }

    /** This flow's values only while [shown]; the latest again once it is shown again. */
    fun <T> Flow<T>.whileShown(shown: Flow<Boolean>): Flow<T> =
        combine(this, shown.distinctUntilChanged(), ::Pair).filter { it.second }.map { it.first }

    /** The wait before reconnect [attempt] (1 is the first): 2 s, then longer up to a minute, then every 15 minutes. */
    fun reconnectDelay(attempt: Int): Long =
        if (attempt > RECONNECT_FAST) RECONNECT_SLOW_MS else RECONNECT_DELAYS[(attempt - 1).coerceIn(0, RECONNECT_DELAYS.lastIndex)]

    /**
     * Whether a connect timeout drops the endpoint, which costs a new bind, relay dial and network probe: when the
     * phone's network changed since the bind ([boundOn], [now]), and on every [REBIND_EVERY]th timeout in a row.
     */
    fun rebind(boundOn: String?, now: String?, timeouts: Int): Boolean = boundOn != now || timeouts % REBIND_EVERY == 0

    /** What a stop let go of (the terminal's stream, the open chat), given back once on the next start. */
    class Held {
        private var terminal = false
        private var chat: TerminalRef? = null
        /** A second stop (the other activity) with nothing left attached never forgets the first's. */
        fun stop(terminal: Boolean, chat: TerminalRef?) {
            this.terminal = this.terminal || terminal
            if (chat != null) this.chat = chat
        }
        fun start(): Pair<Boolean, TerminalRef?> = (terminal to chat).also { terminal = false; chat = null }
    }
}

/** Whether this lifecycle is started, for [Background.poll]. */
fun Lifecycle.started(): Flow<Boolean> = currentStateFlow.map { it.isAtLeast(Lifecycle.State.STARTED) }

/** The terminal page paused while the app is stopped, and its JS timers too ([timers]; pauseTimers is process-wide). */
fun WebView.started(on: Boolean, timers: Boolean = true) {
    if (on) { onResume(); if (timers) resumeTimers() } else { onPause(); if (timers) pauseTimers() }
}
