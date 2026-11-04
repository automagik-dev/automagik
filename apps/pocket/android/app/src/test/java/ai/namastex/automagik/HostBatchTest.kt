package ai.namastex.automagik

import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Before
import org.junit.Test
import java.io.File
import java.nio.file.Files

/**
 * The batched reads run for real: [HostBatch]'s scripts under `sh`, against folders with hostile names, from a working
 * directory that must stay empty (where `$(touch …)` or a backtick would land). Nothing in a name may run, and each
 * answer must come back to its own folder.
 */
class HostBatchTest {
    private lateinit var root: File
    private lateinit var cwd: File

    /** Names a shell would act on if one ever parsed them. */
    private val hostile = listOf("with space", "quote'single", "dq\"double", "\$(touch pwned-dollar)", "`touch pwned-tick`",
        "semi;touch pwned-semi", "new\nline", "-leading", "--version", "amp&&touch pwned-amp", "pipe|touch pwned-pipe",
        "glob*?[x]", "\$HOME", "back\\slash", "tab\there", "redir>pwned-redir")

    @Before fun setUp() {
        assumeTrue("needs sh and git", runCatching { run(listOf("git", "--version"), File(".")).first == 0 }.getOrDefault(false))
        root = Files.createTempDirectory("hostbatch").toFile().canonicalFile
        cwd = File(root, "cwd").apply { mkdirs() }
    }
    @After fun tearDown() { if (::root.isInitialized) root.deleteRecursively() }

    private fun run(argv: List<String>, dir: File): Pair<Int, ByteArray> {
        val pb = ProcessBuilder(argv).directory(dir).redirectError(ProcessBuilder.Redirect.to(File("/dev/null")))
        pb.environment().keys.removeAll { it.startsWith("GIT_") }
        val p = pb.start()
        val out = p.inputStream.readBytes()
        return p.waitFor() to out
    }
    private fun git(dir: File, vararg args: String) = assertEquals(0, run(listOf("git", "-C", dir.path) + args, root).first)

    /** Every file under [root] except the folders this test made: anything else was created by a name that ran. */
    private fun strays(made: Set<File>): List<String> = root.walk().filter { f ->
        f != root && f != cwd && made.none { m -> f == m || f.startsWith(m) }
    }.map { it.path }.toList()

    @Test fun hostileFolderNamesRunNothingAndEachMapsToItsOwnGitAnswer() {
        // Even positions a repository (odd ones with an origin), odd positions a plain folder; then one that doesn't exist.
        val folders = hostile.mapIndexed { i, name ->
            File(root, name).apply {
                mkdirs()
                if (i % 2 == 0) { git(this, "init", "-q", "-b", "b$i"); if (i % 4 == 0) git(this, "remote", "add", "origin", "https://example.com/acme/r$i.git") }
            }
        }
        val missing = File(root, "missing \$(touch pwned-missing)")
        val paths = folders.map { it.path } + missing.path
        val (code, out) = run(HostBatch.argv(HostBatch.GIT, paths), cwd)
        assertEquals(0, code)
        assertEquals(emptyList<String>(), cwd.list()!!.toList())
        assertEquals(emptyList<String>(), strays(folders.toSet()))
        val answers = HostBatch.git(out, paths)
        assertEquals(paths.size, answers.size)
        folders.forEachIndexed { i, dir ->
            val a = answers[i]
            if (i % 2 == 0) {
                val info = (a as HostBatch.Git.Repo).info
                assertEquals(dir.path, info.top)
                assertEquals("${dir.path}/.git", info.common)
                assertEquals("b$i", info.branch)
                assertEquals(if (i % 4 == 0) "acme/r$i" else "", info.remote)
            } else assertEquals(dir.path, HostBatch.Git.NotRepo, a)
        }
        assertEquals(HostBatch.Git.Unsure, answers.last())
    }

    @Test fun relativeNamesWithALeadingDashAreFoldersNotOptions() {
        for (name in listOf("-leading", "--version", "-C")) File(root, name).also { it.mkdirs(); git(it, "init", "-q", "-b", "main") }
        val names = listOf("-leading", "--version", "-C")
        val answers = HostBatch.git(run(HostBatch.argv(HostBatch.GIT, names), root).second, names)
        names.zip(answers).forEach { (name, a) -> assertEquals(File(root, name).path, (a as HostBatch.Git.Repo).info.top) }
    }

    @Test fun hostileRegistryPathsRunNothingAndEachMapsToItsOwnFile() {
        val dirs = hostile.map { File(root, it).apply { mkdirs() } }
        dirs.forEach { d -> File(d, ".herdr").mkdirs(); File(d, ".herdr/bots.json").writeText("{\"name\":${org.json.JSONObject.quote(d.name)}}") }
        val big = File(root, "big").apply { mkdirs(); File(this, ".herdr").mkdirs(); File(this, ".herdr/bots.json").writeText("x".repeat(HostBatch.FILE_MAX + 1)) }
        val folder = File(root, "a folder \$(touch pwned-dir)").apply { mkdirs(); File(this, ".herdr/bots.json").mkdirs() }
        val keys = dirs + big + folder + File(root, "none `touch pwned-none`")
        val paths = keys.map { Teams.registry.path(it.path) }
        val (code, out) = run(HostBatch.argv(HostBatch.FILES, paths), cwd)
        assertEquals(0, code)
        assertEquals(emptyList<String>(), cwd.list()!!.toList())
        assertEquals(emptyList<String>(), strays((dirs + big + folder).toSet()))
        val files = HostBatch.files(out, paths.size)
        dirs.forEachIndexed { i, d -> assertEquals(d.name, org.json.JSONObject((files[i] as HostBatch.File.Found).text).getString("name")) }
        assertEquals(HostBatch.File.Unreadable, files[dirs.size])        // larger than FILE_MAX
        assertEquals(HostBatch.File.Unreadable, files[dirs.size + 1])    // a folder where the file should be
        assertEquals(HostBatch.File.Missing, files[dirs.size + 2])
    }

    @Test fun theArgvKeepsTheScriptFixedAndThePathsPositional() {
        val paths = listOf("/a b", "\$(x)")
        assertEquals(listOf("sh", "-c", HostBatch.GIT, "sh") + paths, HostBatch.argv(HostBatch.GIT, paths))
    }

    // ---- the parser alone

    private fun nul(vararg fields: String) = fields.joinToString("") { "$it\u0000" }.toByteArray()

    @Test fun aCutOffOrMisplacedAnswerIsUnsure() {
        val ok = nul("0", "0", "# branch.head main", "0", "/w/a", "0", "/w/a/.git", "1", "")
        val folders = listOf("/w/a", "/w/b", "/w/c")
        // b's record is cut off mid-field (no final NUL): a stays, b and c are unsure.
        val cut = ok + "1\u00000\u0000# branch".toByteArray()
        assertEquals(listOf(HostBatch.Git.Repo(GitInfo("main", 0, 0, "/w/a", "/w/a/.git")), HostBatch.Git.Unsure, HostBatch.Git.Unsure),
            HostBatch.git(cut, folders))
        // A record claiming another position never lands on this folder.
        assertEquals(HostBatch.Git.Unsure, HostBatch.git(nul("1", "0", "# branch.head main", "0", "/w/a", "0", "/w/a/.git", "1", ""), listOf("/w/a")).single())
        // Not a repository is an answer; another git failure is not.
        assertEquals(HostBatch.Git.NotRepo, HostBatch.git(nul("0", "128", "fatal: not a git repository (or any parent)", "128", "", "128", "", "1", ""), listOf("/w")).single())
        assertEquals(HostBatch.Git.Unsure, HostBatch.git(nul("0", "128", "fatal: unsafe repository", "128", "", "128", "", "1", ""), listOf("/w")).single())
        assertEquals(HostBatch.Git.Unsure, HostBatch.git(nul("0", "0", "# branch.head main", "0", "/w", "0", "/w/.git", "2", ""), listOf("/w")).single())
        // git before 2.31 echoes --path-format and may give a relative common dir.
        assertEquals(GitInfo("main", 0, 0, "/w", "/w/.git"), GitInfo.of("# branch.head main", "--path-format=absolute\n/w", "--path-format=absolute\n.git", "/w"))
        assertEquals(List(2) { HostBatch.File.Unreadable }, HostBatch.files(ByteArray(0), 2))
        assertTrue(HostBatch.files(nul("0", "ok", "{}", "1", "none", ""), 2) == listOf(HostBatch.File.Found("{}"), HostBatch.File.Missing))
    }
}
