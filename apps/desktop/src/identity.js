// The app's name, and the names its installed identity keeps. The app is Automagik; until
// 3.261023.x it shipped as Omni (automagik-dev/omni-desktop), and an install updates in place,
// so what the system and Electron filed under the old identity stays where it is:
//   appId ai.namastex.omni.desktop  macOS updates (Squirrel takes only the same id and signer),
//                                   TCC permissions, preferences
//   ~/.omni/desktop                 the app's own home (dsh.js appHome): profile, Bots, link
//   userData under "Omni"           Electron's window data: the page's storage, cookies, each
//                                   Bot browser's partition, the single-instance lock
//   Linux: omni-desktop             the executable, the desktop entry id, the deb package omni
//                                   (electron-builder.yml, package.json desktopName)
// Electron derives userData from the app's name, so without the pin below an updated app
// would start from an empty folder beside the old one. Pure Node: main.js applies it, tests
// read it without Electron.
import { join } from 'node:path'

/** What the app is called wherever a person sees it. */
export const PRODUCT = 'Automagik'

/** The name the app's Electron data is filed under: the one omni-desktop shipped. */
export const DATA_NAME = 'Omni'

/**
 * Where Electron keeps the window's data, given `app.getPath('appData')`: the folder the app
 * used as Omni (~/Library/Application Support/Omni, ~/.config/Omni). sessionData (the page's
 * storage and cookies, the Bot browsers' partitions) is in it, as Electron's default has it.
 */
export function dataPathsOf(appData) {
  const userData = join(appData, DATA_NAME)
  return { userData, sessionData: userData }
}
