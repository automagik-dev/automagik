package ai.namastex.automagik

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The four-tab shell (docs/decisions/four-tabs.md): which tabs, where the app opens, and where Back goes. */
class NavTest {
    private val ref = TerminalRef("mac", "t1")

    @Test fun tabsAreExactlyHomeTeamCodeSettings() {
        assertEquals(listOf(Nav.HOME_TAB, Nav.TEAM, Nav.CODE, Nav.SETTINGS), Nav.TABS)
        assertEquals(4, Nav.TABS.toSet().size)
        // Today's screens that are no tab any more open Team, the default, when asked for as a tab.
        for (gone in listOf("tasks", "machines")) assertEquals(Nav.Place(Nav.TEAM), Nav.tab(gone))
        for (tab in Nav.TABS) assertEquals(Nav.Place(tab), Nav.tab(tab))
    }

    @Test fun appOpensOnTeam() {
        assertEquals(Nav.TEAM, Nav.HOME)
        assertEquals(Nav.Place(Nav.TEAM), Nav.Place())
        assertEquals(Nav.TEAM, PocketState().screen)
    }

    @Test fun backFromAnyTabGoesToTeam() {
        for (tab in Nav.TABS - Nav.TEAM) assertEquals(tab, Nav.Place(Nav.TEAM), Nav.back(Nav.Place(tab)))
        assertNull(Nav.back(Nav.Place(Nav.TEAM)))
        // Innermost first: a terminal goes back to its tab, a space to its project, a project to Code's top.
        assertEquals(Nav.Place(Nav.HOME_TAB), Nav.back(Nav.Place(Nav.HOME_TAB, selected = ref)))
        assertEquals(Nav.Place(Nav.CODE, "repo:x"), Nav.back(Nav.Place(Nav.CODE, "repo:x", "mac" to "s1")))
        assertEquals(Nav.Place(Nav.CODE), Nav.back(Nav.Place(Nav.CODE, "repo:x")))
        assertEquals(Nav.Place(Nav.TEAM), Nav.back(Nav.back(Nav.Place(Nav.CODE, "repo:x"))!!))
    }

    @Test fun barHiddenOnATerminal() {
        for (tab in Nav.TABS) {
            assertFalse(tab, Nav.barShown(Nav.Place(tab, selected = ref)))
            assertTrue(tab, Nav.barShown(Nav.Place(tab)))
        }
        assertTrue(Nav.barShown(Nav.Place(Nav.CODE, "repo:x", "mac" to "s1")))
    }

    @Test fun badgeMovesFromTodayToHome() {
        assertEquals(3, Nav.badge(Nav.HOME_TAB, 3, 1))
        assertEquals(1, Nav.badge(Nav.TEAM, 3, 1))
        assertEquals(0, Nav.badge(Nav.CODE, 3, 1)); assertEquals(0, Nav.badge(Nav.SETTINGS, 3, 1))
    }
}
