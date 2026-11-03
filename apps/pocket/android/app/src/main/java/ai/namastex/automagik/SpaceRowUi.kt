package ai.namastex.automagik

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.CallMerge
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.sin

/** The card a tap opens as a bottom sheet: a line 2 chip's, or a bot's. */
sealed interface StatsSheet
enum class Chip { MERGES, TIME, FIRST_PASS, SPENT, TOKENS }
data class ChipSheet(val stats: SpaceStats, val chip: Chip) : StatsSheet
data class BotSheet(val stats: BotStats) : StatsSheet

/** A Herdr theme token (rules section 5), Automagik dark or light by the phone's setting. */
@Composable @ReadOnlyComposable fun herdr(token: String): Color = Color(0xff000000.toInt() or SpaceColors.rgb(token, LocalPalette.current.dark))
private fun mono(size: TextUnit, weight: FontWeight = FontWeight.Normal) = TextStyle(fontFamily = FontFamily.Monospace, fontSize = size,
    fontWeight = weight, fontFeatureSettings = "tnum")

private val CHIP_ICON = mapOf(Chip.MERGES to Icons.AutoMirrored.Outlined.CallMerge, Chip.TIME to Icons.Outlined.Schedule,
    Chip.FIRST_PASS to Icons.Outlined.CheckCircle, Chip.SPENT to Icons.Outlined.Toll, Chip.TOKENS to Icons.Outlined.ViewInAr)
private val CHIP_TINT = mapOf(Chip.MERGES to "ansi2", Chip.TIME to "dim", Chip.FIRST_PASS to "ansi2", Chip.SPENT to "ansi3", Chip.TOKENS to "ansi5")

/** Line 2 of a space row (rules section 6): one line that clips at the edge, never wraps; chips don't shrink. */
@Composable fun SpaceLine2(s: SpaceStats, modifier: Modifier = Modifier, onChip: (Chip) -> Unit) {
    val p = s.project
    Box(modifier.fillMaxWidth().clipToBounds()) {
        Row(Modifier.wrapContentWidth(Alignment.Start, unbounded = true), horizontalArrangement = Arrangement.spacedBy(9.dp),
            verticalAlignment = Alignment.CenterVertically) {
            p.merges?.items?.firstOrNull()?.forge?.takeIf { it == "github" || it == "gitlab" }?.let { forge ->
                Icon(Icons.Outlined.Code, if (forge == "github") "GitHub" else "GitLab", Modifier.size(12.dp), tint = herdr(if (forge == "gitlab") "ansi3" else "dim"))
            }
            SpaceFeed.line2(p).zip(Chip.entries).forEach { (c, chip) -> LineChip(chip, c, onChip) }
        }
    }
}

@Composable private fun LineChip(chip: Chip, c: SpaceFeed.LineChip, onChip: (Chip) -> Unit) {
    Row(Modifier.clip(RoundedCornerShape(4.dp)).clickable { onChip(chip) }.padding(vertical = 2.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(CHIP_ICON.getValue(chip), chip.name.lowercase().replace('_', ' '), Modifier.size(12.dp), tint = herdr(CHIP_TINT.getValue(chip)))
        Spacer(Modifier.width(3.dp))
        Text(c.text, style = mono(11.5.sp), color = herdr(if (c.isNull) "dim" else "foreground"), maxLines = 1, softWrap = false)
        c.good?.let { good ->
            Spacer(Modifier.width(1.dp))
            Text(c.arrow.glyph, fontSize = 8.sp, color = herdr(if (good) "ansi2" else "ansi1"), maxLines = 1)
        }
    }
}

/** A bot row's stats button: three bars. The phone has no hover, so it always shows. */
@Composable fun StatsButton(onClick: () -> Unit) {
    Box(Modifier.size(26.dp).clip(RoundedCornerShape(5.dp)).clickable(onClick = onClick), contentAlignment = Alignment.Center) {
        Icon(Icons.Outlined.BarChart, "Bot stats", Modifier.size(14.dp), tint = SidebarDim)
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable fun StatsSheetHost(sheet: StatsSheet, onDismiss: () -> Unit) {
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = herdr("popover"), contentColor = herdr("foreground")) {
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(start = 20.dp, end = 20.dp, bottom = 28.dp)) {
            when (sheet) {
                is ChipSheet -> ChipCard(sheet.stats, sheet.chip)
                is BotSheet -> BotCard(sheet.stats)
            }
        }
    }
}

// Cards (rules section 7): header, body, footer; a card whose whole section is missing is its header only.

@Composable private fun Header(icon: ImageVector, tint: String, title: String, big: String?, was: String?) {
    Row(verticalAlignment = Alignment.Top) {
        Icon(icon, null, Modifier.padding(top = 3.dp).size(16.dp), tint = herdr(tint))
        Spacer(Modifier.width(8.dp))
        Text(title, fontSize = 15.sp, fontWeight = FontWeight.Medium, color = herdr("foreground"), modifier = Modifier.weight(1f).padding(top = 1.dp))
        if (big != null) Column(horizontalAlignment = Alignment.End) {
            Text(big, style = mono(20.sp, FontWeight.Medium), color = herdr(if (big == SpaceFeed.DASH) "dim" else "foreground"))
            was?.let { Text("was $it", fontSize = 11.5.sp, color = herdr("muted")) }
        }
    }
}

@Composable private fun Footer(feed: SpaceFeed.Feed) {
    Spacer(Modifier.height(14.dp))
    Text(Fmt.asOf(feed.generatedMs) + if (feed.truncated) " · lists trimmed to fit" else "", fontSize = 11.sp, color = herdr("dim"))
}

@Composable private fun Sub(text: String) { Spacer(Modifier.height(4.dp)); Text(text, fontSize = 12.sp, color = herdr("muted")) }

@Composable private fun ChipCard(s: SpaceStats, chip: Chip) {
    val p = s.project
    val icon = CHIP_ICON.getValue(chip); val tint = CHIP_TINT.getValue(chip)
    val dark = LocalPalette.current.dark
    when (chip) {
        Chip.MERGES -> {
            val m = p.merges
            Header(icon, tint, "Merges", Fmt.count(m?.n), m?.prevN?.let(Fmt::count))
            m ?: return
            val types = SpaceFeed.typeOrder(m.byType.keys)
            Spacer(Modifier.height(10.dp))
            Pie(types.map { t ->
                val n = m.byType[t]
                Slice(t, n, herdr(SpaceColors.type(t)), Fmt.count(n), Fmt.count(n)) {
                    val items = m.items.filter { it.type == t }
                    items.take(9).forEach { ItemLine(it.task, it.url, Fmt.minutes(it.leadMin), it.leadMin == null) }
                    if (items.size > 9) Text("+${items.size - 9}", style = mono(11.sp), color = herdr("dim"))
                    if (items.isEmpty()) Text(SpaceFeed.DASH, style = mono(11.sp), color = herdr("dim"))
                }
            })
        }
        Chip.TIME -> {
            val t = p.time
            Header(icon, tint, "Worktree → merge", Fmt.minutes(t?.medianMin), t?.prevMedianMin?.let(Fmt::minutes))
            t ?: return
            val colors = SpaceColors.scale(6, dark)
            Spacer(Modifier.height(10.dp))
            Pie(t.bands.mapIndexed { i, n ->
                val label = t.labels.getOrNull(i)?.ifBlank { null } ?: "band ${i + 1}"
                Slice(label, n, Color(0xff000000.toInt() or colors[i.coerceAtMost(colors.lastIndex)]), Fmt.count(n), Fmt.count(n)) {
                    Text("$label: ${Fmt.count(n)}", fontSize = 12.sp, color = herdr("muted"))
                }
            })
            Spacer(Modifier.height(10.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Cell("fastest", Fmt.minutes(t.fastest?.min), "ansi2", t.fastest?.task, t.fastest?.url, Modifier.weight(1f))
                Cell("average", Fmt.minutes(t.avgMin), null, null, null, Modifier.weight(1f))
                Cell("slowest", Fmt.minutes(t.slowest?.min), "ansi1", t.slowest?.task, t.slowest?.url, Modifier.weight(1f))
            }
        }
        Chip.FIRST_PASS -> {
            val f = p.firstPass
            Header(icon, tint, "First pass", Fmt.share(f?.share), f?.prevShare?.let(Fmt::share))
            f ?: return
            val labels = listOf("first try", "1 fix", "2 fixes", "3+ fixes")
            val colors = SpaceColors.scale(4, dark)
            Spacer(Modifier.height(10.dp))
            Pie(f.fixes.take(4).mapIndexed { i, n ->
                Slice(labels[i], n, Color(0xff000000.toInt() or colors[i]), Fmt.count(n), Fmt.count(n)) {
                    Text(Fmt.count(n), style = mono(12.sp), color = herdr("muted"))
                }
            })
        }
        Chip.SPENT -> {
            val sp = p.spent
            Header(icon, tint, "Spent, 24 h", Fmt.dollars(sp?.realUsd), sp?.prevRealUsd?.let(Fmt::dollars))
            sp ?: return
            Sub("${Fmt.share(sp.codexWeekShare)} of a Codex week")
            Spacer(Modifier.height(10.dp))
            Pie(sp.byModel.keys.sorted().map { id ->
                val usd = sp.byModel[id]
                Slice(id, usd, herdr(SpaceFeed.modelColor(p, id)), "", Fmt.dollars(usd)) {
                    Text("$id: ${Fmt.dollars(usd)}", fontSize = 12.sp, color = herdr("muted"))
                }
            }, insideLabels = false)
        }
        Chip.TOKENS -> {
            val tk = p.tokens
            Header(icon, tint, "Tokens", Fmt.tokens(tk?.total), tk?.prevTotal?.let(Fmt::tokens))
            tk ?: return
            Sub("cache hit ${Fmt.share(tk.cacheHit)}")
            Spacer(Modifier.height(10.dp))
            Pie(tk.byModel.keys.sorted().map { id ->
                val m = tk.byModel.getValue(id)
                Slice(id, m.size, herdr(SpaceFeed.modelColor(p, id)), "", null) {
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        Cell("input", Fmt.tokens(m.input), null, null, null, Modifier.weight(1f))
                        Cell("output", Fmt.tokens(m.output), null, null, null, Modifier.weight(1f))
                        Cell("cache read", Fmt.tokens(m.cacheRead), null, null, null, Modifier.weight(1f))
                    }
                    Spacer(Modifier.height(6.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        Cell("turns", Fmt.count(m.turns), null, null, null, Modifier.weight(1f))
                        Cell("reasoning", Fmt.share(m.reasoningShare), null, null, null, Modifier.weight(1f))
                        Cell("cache hit", Fmt.share(m.cacheHit), null, null, null, Modifier.weight(1f))
                    }
                }
            }, insideLabels = false)
        }
    }
    Footer(s.feed)
}

@Composable private fun ItemLine(task: String?, url: String?, value: String, dim: Boolean) {
    val uri = LocalUriHandler.current
    Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(5.dp)).clickable(enabled = url != null) { url?.let { runCatching { uri.openUri(it) } } }
        .padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(task ?: SpaceFeed.DASH, style = mono(12.sp, FontWeight.Medium), color = herdr(if (url != null) "ansi4" else "foreground"),
            maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
        Text(value, style = mono(12.sp), color = herdr(if (dim) "dim" else "muted"))
    }
}

@Composable private fun Cell(label: String, value: String, tint: String?, task: String?, url: String?, modifier: Modifier = Modifier) {
    val uri = LocalUriHandler.current
    Column(modifier.clip(RoundedCornerShape(6.dp)).background(herdr("foreground").copy(alpha = 0.06f))
        .clickable(enabled = url != null) { url?.let { runCatching { uri.openUri(it) } } }.padding(horizontal = 8.dp, vertical = 6.dp)) {
        Text(label.uppercase(), fontSize = 9.5.sp, letterSpacing = 0.5.sp, color = herdr("dim"), maxLines = 1)
        Text(value, style = mono(13.sp, FontWeight.SemiBold), color = herdr(if (value == SpaceFeed.DASH) "dim" else tint ?: "foreground"), maxLines = 1)
        if (task != null) Text(task, style = mono(10.sp), color = herdr(if (url != null) "ansi4" else "muted"), maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

/** A pie slice: [value] sizes it (null or 0 draws nothing but keeps its legend entry), [inside] is written in it, [legend] beside it. */
private class Slice(val label: String, val value: Double?, val color: Color, val inside: String, val legend: String?,
                    val detail: @Composable ColumnScope.() -> Unit)

/** The "pizza" pie (rules section 7): from 12 o'clock clockwise; a tapped slice or legend entry pulls out 4 dp, the rest dim. */
@Composable private fun Pie(slices: List<Slice>, insideLabels: Boolean = true) {
    var picked by remember(slices.size) { mutableStateOf<Int?>(null) }
    val total = slices.sumOf { (it.value ?: 0.0).coerceAtLeast(0.0) }
    val surface = herdr("popover"); val dim = herdr("dim")
    val measurer = rememberTextMeasurer()
    val labelStyle = mono(9.5.sp, FontWeight.SemiBold).copy(color = surface)
    Row(verticalAlignment = Alignment.CenterVertically) {
        Canvas(Modifier.size(112.dp).padding(6.dp).pointerInput(slices, total) {
            detectTapGestures { o ->
                val c = Offset(size.width / 2f, size.height / 2f)
                if (total <= 0 || hypot(o.x - c.x, o.y - c.y) > size.width / 2f) { picked = null; return@detectTapGestures }
                val angle = ((Math.toDegrees(atan2((o.y - c.y).toDouble(), (o.x - c.x).toDouble())) + 90 + 360) % 360)
                var start = 0.0
                for ((i, s) in slices.withIndex()) {
                    val sweep = (s.value ?: 0.0).coerceAtLeast(0.0) / total * 360
                    if (sweep > 0 && angle >= start && angle < start + sweep) { picked = if (picked == i) null else i; return@detectTapGestures }
                    start += sweep
                }
            }
        }) {
            if (total <= 0) return@Canvas
            val r = size.minDimension / 2f
            val pull = 4.dp.toPx()
            var start = -90f
            for ((i, s) in slices.withIndex()) {
                val sweep = ((s.value ?: 0.0).coerceAtLeast(0.0) / total * 360).toFloat()
                if (sweep <= 0f) continue
                val mid = Math.toRadians((start + sweep / 2).toDouble())
                val d = if (picked == i) pull else 0f
                val shift = Offset((cos(mid) * d).toFloat(), (sin(mid) * d).toFloat())
                val alpha = if (picked != null && picked != i) 0.35f else 1f
                val topLeft = Offset(size.width / 2f - r, size.height / 2f - r) + shift
                drawArc(s.color.copy(alpha = alpha), start, sweep, true, topLeft, Size(2 * r, 2 * r))
                drawArc(surface, start, sweep, true, topLeft, Size(2 * r, 2 * r), style = Stroke(1.6.dp.toPx()))
                if (insideLabels && s.inside.isNotEmpty() && sweep / 360f >= 0.07f) {
                    val t = measurer.measure(s.inside, labelStyle)
                    val at = Offset(size.width / 2f + (cos(mid) * r * 0.62f).toFloat(), size.height / 2f + (sin(mid) * r * 0.62f).toFloat()) + shift
                    drawText(t, topLeft = Offset(at.x - t.size.width / 2f, at.y - t.size.height / 2f), alpha = alpha)
                }
                start += sweep
            }
        }
        Spacer(Modifier.width(14.dp))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            slices.forEachIndexed { i, s ->
                val empty = (s.value ?: 0.0) <= 0.0
                Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(5.dp)).clickable { picked = if (picked == i) null else i }
                    .padding(vertical = 3.dp, horizontal = 2.dp), verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.size(8.dp).background(if (empty) dim else s.color, CircleShape))
                    Spacer(Modifier.width(7.dp))
                    Text(s.label, fontSize = 12.sp, color = herdr(if (empty) "dim" else "muted"), maxLines = 1, overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f))
                    s.legend?.let { Text(it, style = mono(11.5.sp, FontWeight.Medium), color = herdr(if (it == SpaceFeed.DASH || empty) "dim" else "foreground")) }
                }
            }
        }
    }
    picked?.let { i ->
        Spacer(Modifier.height(8.dp))
        Column(Modifier.fillMaxWidth()) { slices.getOrNull(i)?.detail?.invoke(this) }
    }
}

/** The bot card (rules section 8). A bot the feed lacks shows "–" in every cell and no breakdown. */
@Composable private fun BotCard(s: BotStats) {
    val b = s.bot
    Header(Icons.Outlined.BarChart, "dim", s.name, null, null)
    Spacer(Modifier.height(10.dp))
    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        Cell("$ / task", Fmt.dollars(b?.usdPerTask), null, null, null, Modifier.weight(1f))
        Cell("time / task", Fmt.minutes(b?.minPerTask), null, null, null, Modifier.weight(1f))
        Cell("24 h", Fmt.dollars(b?.usd24h), null, null, null, Modifier.weight(1f))
    }
    val parts = b?.parts.orEmpty()
    if (parts.isEmpty()) { Spacer(Modifier.height(10.dp)); Text("no breakdown yet", fontSize = 12.sp, color = herdr("dim")) }
    else {
        val bar = parts.withIndex().filter { (it.value.usd ?: 0.0) > 0.0 }
        val sum = bar.sumOf { it.value.usd ?: 0.0 }
        if (bar.isNotEmpty()) Row(Modifier.padding(top = 12.dp, bottom = 8.dp).fillMaxWidth().height(8.dp).clip(RoundedCornerShape(3.dp)),
            horizontalArrangement = Arrangement.spacedBy(1.dp)) {
            bar.forEach { (i, part) -> Box(Modifier.weight(((part.usd ?: 0.0) / sum).toFloat()).fillMaxHeight().background(herdr(SpaceColors.part(i, part.key)))) }
        } else Spacer(Modifier.height(10.dp))
        parts.forEachIndexed { i, part ->
            Row(Modifier.fillMaxWidth().padding(vertical = 2.dp), verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(8.dp).background(herdr(SpaceColors.part(i, part.key)), RoundedCornerShape(2.dp)))
                Spacer(Modifier.width(7.dp))
                Text(SpaceFeed.partLabel(part, b?.partsKind, s.names), fontSize = 12.sp, color = herdr("muted"), maxLines = 1,
                    overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                Text(Fmt.dollars(part.usd), style = mono(11.5.sp, FontWeight.SemiBold), color = herdr(if (part.usd == null) "dim" else "foreground"))
            }
        }
    }
    Footer(s.feed)
}
