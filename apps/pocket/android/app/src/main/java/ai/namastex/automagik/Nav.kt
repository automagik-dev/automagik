package ai.namastex.automagik

/**
 * Where the person is: a bottom tab (or Settings, reached from the gear), what is open on top of it (a project, a
 * space, a terminal), and the rules Back follows. A terminal covers its tab, so leaving it shows that tab again.
 */
object Nav {
    const val TEAMS = "teams"
    const val TODAY = "overview"
    const val PROJECTS = "projects"
    const val TASKS = "tasks"
    const val MACHINES = "machines"
    const val SETTINGS = "settings"
    val TABS = listOf(TEAMS, TODAY, PROJECTS, TASKS, MACHINES)
    /** Where the app opens, and where Back from any other tab goes: Teams, in its All view. */
    const val HOME = TEAMS

    data class Place(val screen: String = HOME, val project: String? = null, val space: Pair<String, String>? = null,
                     val selected: TerminalRef? = null)

    /** One step back, innermost first: terminal, space, project, then any other screen to [HOME]; null leaves the app. */
    fun back(p: Place): Place? = when {
        p.selected != null -> p.copy(selected = null)
        p.space != null -> p.copy(space = null)
        p.project != null -> p.copy(project = null)
        p.screen != HOME -> Place(HOME)
        else -> null
    }

    /** A tab tapped in the bottom bar opens at its top, also when it is the one showing. */
    fun tab(screen: String) = Place(screen.takeIf { it in TABS || it == SETTINGS } ?: HOME)

    /** The bottom bar shows over every screen but a terminal, which has the whole screen. */
    fun barShown(p: Place) = p.selected == null
}
