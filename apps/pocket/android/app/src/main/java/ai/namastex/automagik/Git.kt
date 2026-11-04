package ai.namastex.automagik

/** What git says about a space's folder, read the way Herdr desktop's spaces-agents sidebar reads it. */
data class GitInfo(val branch: String?, val ahead: Int, val behind: Int, val top: String, val common: String,
                   /** The origin remote as [Projects.remoteKey] writes it ("owner/repo"), or "" when there is none. */
                   val remote: String = "") {
    /** The folder that holds `.git`, or a bare repository's name without `.git`. */
    val repo: String get() = if (common.endsWith("/.git")) common.removeSuffix("/.git").substringAfterLast('/')
        else common.trimEnd('/').substringAfterLast('/').removeSuffix(".git")
    /** A worktree: its common git dir belongs to another checkout. */
    val linked: Boolean get() = common != "$top/.git"

    /** The row's tail: the repo unless nested or the space's own name, and the branch unless main, master or the name. */
    fun tail(name: String, nested: Boolean): String {
        fun same(a: String) = a.equals(name, ignoreCase = true)
        val raw = branch ?: "detached"
        val shown = if (same(raw) || raw == "master" || raw == "main") "" else raw
        val repo = if (nested || same(repo)) "" else repo
        return listOf(repo, shown).filter { it.isNotEmpty() }.joinToString(" · ")
    }

    companion object {
        /*
         * The phone runs only fixed, read-only git commands, each with `--no-optional-locks`: `status --porcelain=v2
         * --branch`, `rev-parse --path-format=absolute --show-toplevel --git-common-dir`, and `config --get
         * remote.origin.url` (exit 1 with no output: no origin). They go through a shell in one way only: the constant
         * script [HostBatch.GIT], run as `sh -c <script> sh <folder>...`, so that one call reads every folder of a machine
         * (one round trip per folder made the Teams tab take a minute on a desktop with many projects and machines). The
         * script is never built from data; a folder reaches it only as a quoted positional parameter.
         */

        /** From `status`, `rev-parse` and the origin URL, all run in [cwd]; null if rev-parse said too little. */
        fun parse(status: String, revParse: String, cwd: String, remote: String = ""): GitInfo? {
            // git before 2.31 doesn't know --path-format: rev-parse echoes it, and the common dir may come back relative.
            val lines = revParse.lines().map { it.trim() }.filter { it.isNotEmpty() && !it.startsWith("--") }
            val top = lines.getOrNull(0)?.trimEnd('/')?.takeIf { it.startsWith("/") } ?: return null
            val common = lines.getOrNull(1)?.let { absolute(it, cwd) } ?: return null
            return info(status, top, common, remote)
        }

        /**
         * From `status`, and the top level and common dir each read by a `rev-parse` of its own (so a folder name holding
         * a newline can't shift one into the other), all run in [cwd]; null if rev-parse said too little.
         */
        fun of(status: String, top: String, common: String, cwd: String, remote: String = ""): GitInfo? {
            // git before 2.31 doesn't know --path-format: rev-parse echoes it, and the common dir may come back relative.
            fun answer(s: String) = s.removePrefix("--path-format=absolute\n").trimEnd('\n')
            val t = answer(top).trimEnd('/').takeIf { it.startsWith("/") } ?: return null
            val c = answer(common).ifEmpty { return null }.let { absolute(it, cwd) }
            return info(status, t, c, remote)
        }

        private fun info(status: String, top: String, common: String, remote: String): GitInfo {
            var branch: String? = null; var ahead = 0; var behind = 0
            for (line in status.lineSequence()) {
                if (line.startsWith("# branch.head ")) branch = line.removePrefix("# branch.head ").trim()
                if (line.startsWith("# branch.ab ")) {
                    val (a, b) = line.removePrefix("# branch.ab ").trim().split(' ').map { it.drop(1).toIntOrNull() ?: 0 } + listOf(0, 0)
                    ahead = a; behind = b
                }
            }
            return GitInfo(branch, ahead, behind, top, common, Projects.remoteKey(remote).orEmpty())
        }

        fun absolute(path: String, cwd: String): String {
            val parts = ArrayDeque<String>()
            for (part in (if (path.startsWith("/")) path else "$cwd/$path").split('/')) when (part) {
                "", "." -> {}
                ".." -> parts.removeLastOrNull()
                else -> parts.addLast(part)
            }
            return "/" + parts.joinToString("/")
        }

        /** Spaces in sidebar order: each worktree moves under the first main checkout of its repo; true marks a nested one.
         *  A worktree whose main checkout has no space stays where it is. */
        fun <S> ordered(spaces: List<S>, info: (S) -> GitInfo?): List<Pair<S, Boolean>> {
            val mains = spaces.mapNotNull { s -> info(s)?.takeIf { !it.linked }?.common }.toSet()
            fun nested(s: S) = info(s)?.let { it.linked && it.common in mains } == true
            val placed = HashSet<String>()
            val out = mutableListOf<Pair<S, Boolean>>()
            for (s in spaces) {
                if (nested(s)) continue
                out += s to false
                val g = info(s)?.takeIf { !it.linked } ?: continue
                if (placed.add(g.common)) spaces.filter { nested(it) && info(it)?.common == g.common }.forEach { out += it to true }
            }
            return out
        }
    }
}
