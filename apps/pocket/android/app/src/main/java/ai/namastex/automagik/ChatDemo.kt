package ai.namastex.automagik

/**
 * The preview's one main-bot chat: Captain, the sample `herdr` project's main bot ([SpendDemo]), waiting on an approval
 * with a question in hand and a long answer already in the transcript. Made up, like [SpendDemo]: no machine, no
 * network, and a tap on its controls only says [SAMPLE_ONLY].
 */
object ChatDemo {
    /** The preview machine's id, as [PocketViewModel.enterDemo] adds it. */
    const val HOST = "preview"
    /** The sample `herdr` project's main bot ([SpendDemo.MEMBERS]). */
    const val BOT = "b-demo-captain"
    /** The `dsh:` terminal a Bot chat is addressed by. */
    const val TERMINAL = Chat.DSH_PREFIX + BOT
    /** What a tap on the sample chat's controls says: nothing is sent from the preview. */
    const val SAMPLE_ONLY = "Sample chat: nothing is sent from the preview."
    private const val ASK = "Run the Android unit tests"

    val ref = TerminalRef(HOST, TERMINAL)

    /** The chat.list row a real bridge would serve for [BOT], so Team's bubble opens the chat like a live main bot's. */
    fun listing(): List<Chat.Terminal> = listOf(Chat.Terminal(TERMINAL, "", "dsh", "Captain", "blocked", "sample",
        registryId = BOT, kind = "approval", msg = "Needs your approval: $ASK", turn = 7))

    private val CHATS = mapOf(HOST to listing())

    /** The listed chats by host id, keyed like [PocketViewModel.botChats] and the Team screen's `dsh`. */
    fun chats(): Map<String, List<Chat.Terminal>> = CHATS

    private val LONG = """
        The Android chat pass is ready for review. What changed:

        • A bot's bubble in Team opens the bot's chat, and the same chat opens from its row on Home.
        • An open approval or question stays fixed above the composer while the transcript scrolls.
        • The composer is one pill with Send; the keyboard no longer covers it.
        • The chat bar carries the bot's pet, its name and what it is doing.

        I left the app id, the version and the release metadata alone. The first unit-test run failed on a stale cache;
        the rerun is green, and lint reports only the dependency warnings that were already there.

        If the drawer copy looks too long on a small screen, say so and I will shorten it before the next build.
        Otherwise I will check the generated release notes and attach the debug build.
    """.trimIndent()

    /**
     * The chat the sample main bot would be in: a user's request, its long answer, a failed test run and the green
     * rerun, a receipt for an earlier approval, and the open approval and question it is waiting on, with the phone
     * allowed to write (as a bridge with `dshWrite` does).
     */
    fun state(terminal: String = TERMINAL, now: Long = System.currentTimeMillis()) = Chat.State(
        terminal = terminal,
        rows = listOf(
            Chat.Row("sample-1", "text", role = "user", text = "Finish the release notes for the Android chat work, then check the build."),
            Chat.Row("sample-2", "text", role = "assistant", text = LONG),
            Chat.Row("sample-3", "tool-call", tool = "Bash", summary = "Run the Android unit tests",
                input = "./gradlew :app:testDebugUnitTest"),
            Chat.Row("sample-4", "tool-result", ok = false, output = "FAILURE: 2 tests failed on a stale test cache."),
            Chat.Row("sample-5", "tool-call", tool = "Bash", summary = "Rerun the Android unit tests",
                input = "./gradlew :app:testDebugUnitTest --rerun-tasks"),
            Chat.Row("sample-6", "tool-result", output = "BUILD SUCCESSFUL · unit tests green")),
        status = Chat.Status("blocked", "approval", "Needs your approval: $ASK"),
        approval = Chat.Row("sample-approval", "approval", source = "claude-code", turn = 7, tool = "Bash",
            summary = ASK, input = "./gradlew :app:testDebugUnitTest", choices = listOf("allow", "allow-always", "deny"),
            open = true, answerable = true),
        question = Chat.Row("sample-question", "question", source = "claude-code", turn = 7,
            prompt = "Which build should the notes cover?",
            options = listOf("The current preview", "The next tagged build", "Both, in separate sections"),
            open = true, answerable = true),
        receipts = listOf(Chat.Receipt("sample-receipt", "approval", label = "Bash: $ASK", by = "phone", name = "Preview",
            outcome = "allow", at = now - 3 * 60_000L)),
        done = listOf("sample-receipt"),
        connected = true, dshWrite = true, more = false, synced = true)
}
