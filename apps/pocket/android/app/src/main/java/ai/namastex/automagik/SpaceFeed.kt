package ai.namastex.automagik

import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.DateTimeParseException
import kotlin.math.abs
import kotlin.math.floor

/**
 * The Space Row feed: the `space` key of a machine's `herdr-meter` doc (space.version 1), drawn the way Herdr desktop
 * draws it, by the shared rendering rules (automagik-herdr docs/space-row-rendering.md). The phone computes nothing:
 * each number is a feed field, formatted by [Fmt]. Every key is optional; missing is null, and null shows as "–".
 */
object SpaceFeed {
    const val VERSION = 1
    const val DASH = "–"

    data class Item(val task: String?, val url: String?, val forge: String?, val type: String?, val leadMin: Double?)
    data class Merges(val n: Double?, val prevN: Double?, val byType: Map<String, Double?>, val items: List<Item>)
    data class Extreme(val task: String?, val url: String?, val min: Double?)
    data class Time(val medianMin: Double?, val prevMedianMin: Double?, val bands: List<Double?>, val labels: List<String?>,
                    val fastest: Extreme?, val avgMin: Double?, val slowest: Extreme?)
    data class FirstPass(val share: Double?, val prevShare: Double?, val fixes: List<Double?>)
    data class Spent(val realUsd: Double?, val prevRealUsd: Double?, val byModel: Map<String, Double?>, val codexWeekShare: Double?)
    data class ModelTokens(val input: Double?, val output: Double?, val cacheRead: Double?, val turns: Double?,
                           val reasoningShare: Double?, val cacheHit: Double?) {
        /** The slice size in the tokens pie; never printed. */
        val size get() = (input ?: 0.0) + (output ?: 0.0) + (cacheRead ?: 0.0)
    }
    data class Tokens(val total: Double?, val prevTotal: Double?, val cacheHit: Double?, val byModel: Map<String, ModelTokens>)
    data class Part(val key: String, val usd: Double?)
    data class Bot(val usdPerTask: Double?, val minPerTask: Double?, val usd24h: Double?, val otherUsd: Double?,
                   val partsKind: String?, val parts: List<Part>)
    data class Project(val merges: Merges?, val time: Time?, val firstPass: FirstPass?, val spent: Spent?, val tokens: Tokens?,
                       val bots: Map<String, Bot>)
    /** [generatedMs]: the doc's top-level `generated_at`, for "as of HH:MM". */
    data class Feed(val generatedMs: Long?, val truncated: Boolean, val projects: Map<String, Project>) {
        fun project(key: String?) = key?.let { projects[normal(it)] }
    }

    /** Bot and category names from a project's `.herdr/bots.json`. */
    data class Names(val bots: Map<String, String> = emptyMap(), val categories: Map<String, String> = emptyMap())

    /** A project key as the feed writes it: an absolute path with no trailing slash. */
    fun normal(path: String) = path.trimEnd('/').ifEmpty { "/" }

    /** The project a space belongs to: the parent of its repository's common git dir (git prints it as the real path). */
    fun projectKey(git: GitInfo?): String? = git?.common?.takeIf { it.startsWith("/") || it.startsWith("~") }
        ?.trimEnd('/')?.substringBeforeLast('/', "")?.let(::normal)

    /**
     * The `space` block of a `herdr-meter` doc; null when the doc has none, it isn't version [VERSION], or it doesn't
     * parse. Null means draw nothing: no line 2 and no stats buttons.
     */
    fun parse(doc: JSONObject?): Feed? = runCatching {
        val space = doc?.optJSONObject("space") ?: return null
        if (num(space, "version") != VERSION.toDouble()) return null
        val projects = LinkedHashMap<String, Project>()
        space.optJSONObject("projects")?.let { p -> for (k in p.keys()) p.optJSONObject(k)?.let { projects[normal(k)] = project(it) } }
        val at = str(doc, "generated_at") ?: str(doc, "generatedAt")
        Feed(at?.let { try { Instant.parse(it).toEpochMilli() } catch (_: DateTimeParseException) { null } },
            space.opt("truncated") == true, projects)
    }.getOrNull()

    fun names(text: String?): Names = runCatching {
        val o = JSONObject(text ?: return Names())
        fun pairs(a: JSONArray?, label: String) = a?.objects().orEmpty()
            .mapNotNull { e -> str(e, "id")?.let { id -> str(e, label)?.let { id to it } } }.toMap()
        Names(pairs(o.optJSONArray("bots"), "name"), pairs(o.optJSONArray("categories"), "title"))
    }.getOrDefault(Names())

    private fun num(o: JSONObject?, k: String): Double? =
        if (o == null || !o.has(k) || o.isNull(k)) null else (o.opt(k) as? Number)?.toDouble()?.takeIf { !it.isNaN() }
    private fun str(o: JSONObject?, k: String): String? = o?.opt(k) as? String
    private fun nums(a: JSONArray?) = a?.let { (0 until it.length()).map { i -> (it.opt(i) as? Number)?.toDouble() } }.orEmpty()
    private fun numbers(o: JSONObject?): Map<String, Double?> {
        val out = LinkedHashMap<String, Double?>()
        o?.keys()?.forEach { k -> out[k] = num(o, k) }
        return out
    }

    private fun project(o: JSONObject) = Project(
        o.optJSONObject("merges")?.let { m ->
            Merges(num(m, "n"), num(m, "prev_n"), numbers(m.optJSONObject("by_type")),
                m.optJSONArray("items")?.objects().orEmpty().map { Item(str(it, "task"), str(it, "url"), str(it, "forge"), str(it, "type"), num(it, "lead_min")) })
        },
        o.optJSONObject("time")?.let { t ->
            fun ex(e: JSONObject?) = e?.let { Extreme(str(it, "task"), str(it, "url"), num(it, "min")) }
            val labels = t.optJSONArray("bands_labels")?.let { a -> (0 until a.length()).map { a.opt(it) as? String } }.orEmpty()
            Time(num(t, "median_min"), num(t, "prev_median_min"), nums(t.optJSONArray("bands")), labels,
                ex(t.optJSONObject("fastest")), num(t, "avg_min"), ex(t.optJSONObject("slowest")))
        },
        o.optJSONObject("first_pass")?.let { FirstPass(num(it, "share"), num(it, "prev_share"), nums(it.optJSONArray("fixes"))) },
        o.optJSONObject("spent")?.let { Spent(num(it, "real_usd"), num(it, "prev_real_usd"), numbers(it.optJSONObject("by_model")), num(it, "codex_week_share")) },
        o.optJSONObject("tokens")?.let { t ->
            val models = LinkedHashMap<String, ModelTokens>()
            t.optJSONObject("by_model")?.let { b -> for (k in b.keys()) b.optJSONObject(k)?.let { m ->
                models[k] = ModelTokens(num(m, "input"), num(m, "output"), num(m, "cache_read"), num(m, "turns"), num(m, "reasoning_share"), num(m, "cache_hit"))
            } }
            Tokens(num(t, "total"), num(t, "prev_total"), num(t, "cache_hit"), models)
        },
        LinkedHashMap<String, Bot>().also { out ->
            o.optJSONObject("bots")?.let { b -> for (k in b.keys()) b.optJSONObject(k)?.let { x ->
                out[k] = Bot(num(x, "usd_per_task"), num(x, "min_per_task"), num(x, "usd_24h"), num(x, "other_usd"), str(x, "parts_kind"),
                    x.optJSONArray("parts")?.objects().orEmpty().mapNotNull { p -> str(p, "key")?.let { Part(it, num(p, "usd")) } })
            } }
        })

    /** A part's legend label (rules section 8). */
    fun partLabel(part: Part, kind: String?, names: Names?): String = when {
        part.key == "other" -> "other"
        kind == "member" -> names?.bots?.get(part.key) ?: part.key
        kind == "category" -> names?.categories?.get(part.key) ?: part.key
        else -> part.key
    }

    /** Merge types in slice and legend order: the known ones, then unknown types A–Z. */
    val TYPES = listOf("feat", "fix", "test", "docs", "refactor", "perf", "ci", "build", "chore", "style", "revert")
    fun typeOrder(types: Collection<String>) = TYPES.filter { it in types } + types.filter { it !in TYPES }.sorted()

    /** One line 2 chip: its text, whether its value is null (dim, no arrow), and its arrow with good/bad (null: none). */
    data class LineChip(val key: String, val text: String, val isNull: Boolean, val arrow: Fmt.Arrow, val good: Boolean?)

    /** Line 2's five chips (rules sections 4 and 6), in order. A null value has no arrow, even if its compared fields moved. */
    fun line2(p: Project): List<LineChip> {
        fun chip(key: String, value: Double?, text: String, now: Double?, prev: Double?, upGood: Boolean): LineChip {
            val arrow = if (value == null) Fmt.Arrow.NONE else Fmt.arrow(now, prev)
            return LineChip(key, text, value == null, arrow, Fmt.good(arrow, upGood))
        }
        return listOf(
            chip("merges", p.merges?.n, Fmt.count(p.merges?.n), p.merges?.n, p.merges?.prevN, upGood = true),
            chip("time", p.time?.medianMin, Fmt.minutes(p.time?.medianMin), p.time?.medianMin, p.time?.prevMedianMin, upGood = false),
            chip("first_pass", p.firstPass?.share, Fmt.share(p.firstPass?.share), p.firstPass?.share, p.firstPass?.prevShare, upGood = true),
            chip("spent", p.spent?.codexWeekShare, Fmt.share(p.spent?.codexWeekShare), p.spent?.realUsd, p.spent?.prevRealUsd, upGood = false),
            chip("tokens", p.tokens?.total, Fmt.tokens(p.tokens?.total), p.tokens?.total, p.tokens?.prevTotal, upGood = false))
    }

    /** Every model of a project, sorted by UTF-16 code unit, so a model has one colour in both cards. */
    fun models(p: Project?): List<String> = ((p?.spent?.byModel?.keys.orEmpty()) + (p?.tokens?.byModel?.keys.orEmpty())).distinct().sorted()
    /** A model's colour token: its place in [models] at `i mod 8`. */
    fun modelColor(p: Project?, model: String) = SpaceColors.series(models(p).indexOf(model))
}

/** Number formats, character for character as the desktop prints them (rules section 3). Null is "–". */
object Fmt {
    private fun round(x: Double) = floor(x + 0.5)
    private fun fixed(x: Double, d: Int): String {
        var scale = 1L; repeat(d) { scale *= 10 }
        val r = round(x * scale).toLong()
        return if (d == 0) "$r" else "${r / scale}.${(r % scale).toString().padStart(d, '0')}"
    }
    private inline fun signed(x: Double?, f: (Double) -> String): String = when {
        x == null -> SpaceFeed.DASH
        x < 0 -> "-" + f(abs(x))
        else -> f(x)
    }

    fun count(x: Double?) = signed(x) { "${round(it).toLong()}" }
    fun minutes(x: Double?) = signed(x) {
        val m = round(it).toLong()
        if (m < 60) "${m}m" else { val h = m / 60; val r = m - 60 * h; if (r == 0L) "${h}h" else "${h}h ${r}m" }
    }
    fun share(x: Double?) = signed(x) { v -> val p = v * 100; when { v == 0.0 -> "0%"; p < 1 -> "<1%"; else -> "${round(p).toLong()}%" } }
    fun dollars(x: Double?) = signed(x) { v ->
        when { v == 0.0 -> "$0.00"; v < 0.01 -> "<$0.01"; v < 10 -> "$" + fixed(v, 2); v < 1000 -> "$" + round(v).toLong(); else -> "$" + fixed(v / 1000, 1) + "k" }
    }
    fun tokens(x: Double?) = signed(x) { v ->
        when {
            v < 1e3 -> "${round(v).toLong()}"
            v < 1e5 -> fixed(v / 1e3, 1) + "k"
            v < 1e6 -> "${round(v / 1e3).toLong()}k"
            v < 1e8 -> fixed(v / 1e6, 1) + "M"
            v < 1e9 -> "${round(v / 1e6).toLong()}M"
            else -> fixed(v / 1e9, 1) + "B"
        }
    }
    fun asOf(ms: Long?, zone: ZoneId = ZoneId.systemDefault()) =
        "as of " + (ms?.let { DateTimeFormatter.ofPattern("HH:mm").withZone(zone).format(Instant.ofEpochMilli(it)) } ?: SpaceFeed.DASH)

    /** Rules section 4: the way a value moved against its prior field; equal or either null is no arrow. */
    enum class Arrow(val glyph: String) { UP("▲"), DOWN("▼"), NONE("") }
    fun arrow(value: Double?, prev: Double?) = when {
        value == null || prev == null -> Arrow.NONE
        value > prev -> Arrow.UP
        value < prev -> Arrow.DOWN
        else -> Arrow.NONE
    }
    /** Whether an arrow is good (green) for a chip where higher is [upGood]; null for no arrow. */
    fun good(a: Arrow, upGood: Boolean): Boolean? = when (a) { Arrow.NONE -> null; Arrow.UP -> upGood; Arrow.DOWN -> !upGood }
}

/** Herdr's Automagik theme tokens as hex (rules section 5): the phone has no theme(), so both clients print these. */
object SpaceColors {
    private val DARK = mapOf("ansi1" to 0xe64d5d, "ansi2" to 0x009957, "ansi3" to 0xff9800, "ansi4" to 0x2b85e4, "ansi5" to 0xe44496,
        "ansi6" to 0x00a592, "ansi8" to 0x959595, "ansi9" to 0xff5a7a, "ansi10" to 0x00c972, "ansi11" to 0xff8a2e, "ansi12" to 0x5c78ff,
        "ansi13" to 0x976ee6, "ansi14" to 0x2ee6e0, "foreground" to 0xeeeeef, "muted" to 0x9b999d, "dim" to 0x6d6a71, "popover" to 0x2c2730)
    private val LIGHT = mapOf("ansi1" to 0xc7303f, "ansi2" to 0x007d47, "ansi3" to 0x8f621f, "ansi4" to 0x1f6cbc, "ansi5" to 0xb3427c,
        "ansi6" to 0x11796d, "ansi8" to 0x898989, "ansi9" to 0xcb285c, "ansi10" to 0x007d47, "ansi11" to 0xb34a00, "ansi12" to 0x082dff,
        "ansi13" to 0x7a5bb7, "ansi14" to 0x077696, "foreground" to 0x1b1b1e, "muted" to 0x656361, "dim" to 0x918d88, "popover" to 0xf6eee2)

    /** A token's RGB (no alpha). Unknown tokens are `dim`. */
    fun rgb(token: String, dark: Boolean): Int = (if (dark) DARK else LIGHT).let { it[token] ?: it.getValue("dim") }

    private val TYPE = mapOf("feat" to "ansi13", "fix" to "ansi11", "test" to "ansi14", "docs" to "ansi12", "refactor" to "ansi5",
        "perf" to "ansi10", "ci" to "ansi4", "build" to "ansi6", "chore" to "ansi8", "style" to "ansi9", "revert" to "ansi1")
    fun type(t: String) = TYPE[t] ?: "dim"

    /** The 8-colour list for models and bot parts, taken at `i mod 8`. */
    val SERIES = listOf("ansi4", "ansi6", "ansi3", "ansi5", "ansi2", "ansi12", "ansi13", "ansi14")
    fun series(i: Int) = SERIES[i.mod(SERIES.size)]
    /** A bot card part's colour token: the i-th of [SERIES] in feed order; the key `other` is always `dim`. */
    fun part(i: Int, key: String) = if (key == "other") "dim" else series(i)

    /** The good-to-bad scale: `ansi2` at 0, `ansi3` at 0.5, `ansi1` at 1, mixed per sRGB channel; [n] stops. */
    fun scale(n: Int, dark: Boolean): List<Int> = (0 until n).map { i ->
        val k = if (n == 1) 0.0 else i.toDouble() / (n - 1)
        val (a, b, t) = if (k <= 0.5) Triple(rgb("ansi2", dark), rgb("ansi3", dark), k / 0.5) else Triple(rgb("ansi3", dark), rgb("ansi1", dark), (k - 0.5) / 0.5)
        fun ch(c: Int, s: Int) = (c shr s) and 0xff
        listOf(16, 8, 0).fold(0) { acc, s -> acc or (floor(ch(a, s) + (ch(b, s) - ch(a, s)) * t + 0.5).toInt() shl s) }
    }
}
