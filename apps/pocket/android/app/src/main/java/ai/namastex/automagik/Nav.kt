package ai.namastex.automagik

/**
 * Where the person is: a bottom tab, what is open on top of it (a project, a space, a terminal), and the rules Back
 * follows. A terminal covers its tab, so leaving it shows that tab again. The four tabs replace the five tabs and the
 * Settings gear of Teams v1 (docs/decisions/four-tabs.md).
 */
object Nav {
    /** Home: the needs-you cockpit, with spend as a chip (it was Today). */
    const val HOME_TAB = "overview"
    const val TEAM = "teams"
    /** Code: the projects, the desktop's spaces tree and the tasks (it was Projects and Tasks). */
    const val CODE = "projects"
    /** Settings, with the machines and pairing (it was the gear and Machines). */
    const val SETTINGS = "settings"
    val TABS = listOf(HOME_TAB, TEAM, CODE, SETTINGS)
    /** Where the app opens, and where Back from any other tab goes: Team, in its All view. */
    const val HOME = TEAM

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
    fun tab(screen: String) = Place(screen.takeIf { it in TABS } ?: HOME)

    /** The bottom bar shows over every screen but a terminal, which has the whole screen. */
    fun barShown(p: Place) = p.selected == null

    /** The count on a tab: Home carries how many agents need the person (Today's badge), Team how many bots. */
    fun badge(tab: String, agentsNeedYou: Int, botsNeedYou: Int) = when (tab) {
        HOME_TAB -> agentsNeedYou
        TEAM -> botsNeedYou
        else -> 0
    }
}
