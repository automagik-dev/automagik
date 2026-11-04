package ai.namastex.automagik

/**
 * Reads the phone makes of many folders on one machine in one `machine.exec`, instead of one round trip each: git for
 * every space folder and agent directory, and every project's bot registry. On a desktop with a dozen projects across
 * several linked machines that is a handful of calls instead of a few hundred, which is most of the Teams tab's start.
 *
 * The scripts are fixed text, never built from data: they run as `sh -c <script> sh <path>...`, so a folder name only
 * ever reaches the shell as a positional parameter (`"$@"`), quoted wherever it is expanded, and is never parsed as
 * shell. Each answer is framed with NUL bytes (which no path or git output holds) and starts with its position, so it
 * maps back to its own folder; every field is capped with `head -c`.
 */
object HostBatch {
    /** Folders per call: keeps each answer small and lets the first results (the space folders) arrive early. */
    const val CHUNK = 16
    /** Most bytes kept of one git field (status headers, rev-parse, the origin URL). */
    const val FIELD_MAX = 4096
    /** Largest registry file read; a bigger one is refused like an unreadable one. */
    const val FILE_MAX = 256 * 1024

    /**
     * For each folder: `git status` (branch headers only; its stderr when it fails, to tell "not a git repository"),
     * `git rev-parse` for the top level and again for the common dir (apart, so a newline in a name can't shift them)
     * and the origin URL, each with `--no-optional-locks`, read only. Answers: position, then a code and an answer for
     * each of status, top level, common dir and origin; each NUL-terminated.
     */
    const val GIT = "LC_ALL=C; export LC_ALL\n" +   // git's messages in English: "not a git repository" is matched
        "i=0\n" +
        "for p in \"\$@\"; do\n" +
        "  s=\$(git -C \"\$p\" --no-optional-locks status --porcelain=v2 --branch --untracked-files=no 2>&1); sc=\$?\n" +
        "  if [ \"\$sc\" -eq 0 ]; then s=\$(printf '%s\\n' \"\$s\" | grep '^# '); fi\n" +
        "  t=\$(git -C \"\$p\" --no-optional-locks rev-parse --path-format=absolute --show-toplevel 2>/dev/null); tc=\$?\n" +
        "  c=\$(git -C \"\$p\" --no-optional-locks rev-parse --path-format=absolute --git-common-dir 2>/dev/null); cc=\$?\n" +
        "  o=\$(git -C \"\$p\" --no-optional-locks config --get remote.origin.url 2>/dev/null); oc=\$?\n" +
        "  printf '%s\\000%s\\000' \"\$i\" \"\$sc\"; printf '%s' \"\$s\" | head -c 4096\n" +
        "  printf '\\000%s\\000' \"\$tc\"; printf '%s' \"\$t\" | head -c 4096\n" +
        "  printf '\\000%s\\000' \"\$cc\"; printf '%s' \"\$c\" | head -c 4096\n" +
        "  printf '\\000%s\\000' \"\$oc\"; printf '%s' \"\$o\" | head -c 4096; printf '\\000'\n" +
        "  i=\$((i+1))\n" +
        "done\n"

    /**
     * For each file: position, then `ok` and at most [FILE_MAX] + 1 bytes of it, `none` when there is no such file, or
     * `err` when it can't be read; each NUL-terminated.
     */
    const val FILES = "i=0\n" +
        "for f in \"\$@\"; do\n" +
        "  if [ -f \"\$f\" ] && c=\$(head -c 262145 -- \"\$f\" 2>/dev/null); then\n" +
        "    printf '%s\\000ok\\000' \"\$i\"; printf '%s' \"\$c\"; printf '\\000'\n" +
        "  elif [ -e \"\$f\" ]; then printf '%s\\000err\\000\\000' \"\$i\"\n" +
        "  else printf '%s\\000none\\000\\000' \"\$i\"; fi\n" +
        "  i=\$((i+1))\n" +
        "done\n"

    /** The argv that runs [script] over [args]: the script is argv[2], the paths only ever "$@". */
    fun argv(script: String, args: List<String>): List<String> = listOf("sh", "-c", script, "sh") + args

    /** One folder's git answer. */
    sealed interface Git {
        data class Repo(val info: GitInfo) : Git
        /** Not a repository: an answer, like [Repo]. */
        data object NotRepo : Git
        /** Couldn't tell (machine away, odd error, cut-off answer): keep the last answer and try again later. */
        data object Unsure : Git
    }

    /** [GIT]'s answer for [folders], in their order; a folder whose answer is missing or out of place is [Git.Unsure]. */
    fun git(out: ByteArray, folders: List<String>): List<Git> {
        val records = records(out, 9)
        return folders.mapIndexed { i, folder ->
            val r = records.getOrNull(i)?.takeIf { it[0] == "$i" } ?: return@mapIndexed Git.Unsure
            val status = r[1].toIntOrNull(); val remote = r[7].toIntOrNull()
            when {
                status != 0 -> if ("not a git repository" in r[2]) Git.NotRepo else Git.Unsure
                r[3] != "0" || r[5] != "0" -> Git.Unsure
                // Exit 1 is no origin: a repository all the same, named by its own folder.
                remote != 0 && remote != 1 -> Git.Unsure
                else -> GitInfo.of(r[2], r[4], r[6], folder, if (remote == 0) r[8] else "")?.let { Git.Repo(it) } ?: Git.Unsure
            }
        }
    }

    /** One file's read. */
    sealed interface File {
        data class Found(val text: String) : File
        data object Missing : File
        /** Unreadable, too big, or no answer: keep what was read before. */
        data object Unreadable : File
    }

    /** [FILES]' answer for [count] files, in their order. */
    fun files(out: ByteArray, count: Int): List<File> {
        val records = records(out, 3)
        return (0 until count).map { i ->
            val r = records.getOrNull(i)?.takeIf { it[0] == "$i" } ?: return@map File.Unreadable
            when (r[1]) {
                "ok" -> if (r[2].toByteArray().size <= FILE_MAX) File.Found(r[2]) else File.Unreadable
                "none" -> File.Missing
                else -> File.Unreadable
            }
        }
    }

    /** The NUL-terminated fields of [out], [size] to a record; a trailing record cut short is dropped. */
    private fun records(out: ByteArray, size: Int): List<List<String>> {
        val fields = String(out, Charsets.UTF_8).split('\u0000')
        // split leaves the text after the last NUL: empty for a complete answer, a cut-off field otherwise.
        return fields.dropLast(1).chunked(size).filter { it.size == size }
    }
}
