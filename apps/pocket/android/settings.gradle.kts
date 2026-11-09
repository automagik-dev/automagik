// A sandboxed pane can mount the OS home read-only. AGP then cannot create its default debug
// keystore under it, and assembleDebug stops before the tests run. AGP reads ANDROID_USER_HOME,
// ANDROID_SDK_HOME and ANDROID_PREFS_ROOT for the same Android preferences folder, and stops with
// AndroidLocationsException when they name different paths, so point the prefs at a stable location
// only when that home is not writable AND none of the three is already named by the environment or
// a -D flag: an existing name of any of the three is adopted as it is. The location is under
// Gradle's user home, not under build/, so clean does not churn the debug keystore (and the
// signature of the debug or fallback-signed APKs built here); none of those builds ship. A
// developer machine and CI keep ~/.android, and the release signing block still reads user.home.
//
// Two AGP details the predicate follows, so AGP never sees two paths at once:
// - ANDROID_SDK_HOME and ANDROID_PREFS_ROOT must name a folder (AGP appends .android to it); AGP
//   ignores a name that is not a folder and falls back to the read-only home. Its analytics creates
//   the folder first when it can, so a name AGP can create counts as named too; only a name AGP
//   cannot create (a read-only parent) is ignored here, so the stable path is set and AGP falls
//   back to it. A set-but-empty value is different: AGP reads it as named, and resolves the empty
//   path to its working directory (writable in the sandbox), not the OS home. Overwriting that name
//   with the stable path would give AGP two different paths and stop the build, so an empty value
//   is adopted as it is; app/build.gradle.kts pins the debug keystore, which an empty path leaves
//   relative, to the stable folder.
// - ANDROID_USER_HOME names the prefs folder itself and counts as named even when the folder does
//   not exist; an empty value counts too, as above.
val osHomeWritable = File(System.getProperty("user.home")).canWrite()
fun canCreateFolder(folder: File): Boolean {
    var ancestor: File? = folder.parentFile
    while (ancestor != null && !ancestor.exists()) ancestor = ancestor.parentFile
    return ancestor?.let { it.isDirectory && it.canWrite() } == true
}
fun prefsNameNamed(name: String, needsFolder: Boolean): Boolean =
    listOf(System.getenv(name), System.getProperty(name)).any { value ->
        when {
            value == null -> false
            value.isEmpty() -> true
            !needsFolder -> true
            File(value).isDirectory -> true
            File(value).exists() -> false
            else -> canCreateFolder(File(value))
        }
    }
val androidPrefsNamed = prefsNameNamed("ANDROID_USER_HOME", needsFolder = false) ||
    prefsNameNamed("ANDROID_SDK_HOME", needsFolder = true) ||
    prefsNameNamed("ANDROID_PREFS_ROOT", needsFolder = true)
if (!osHomeWritable && !androidPrefsNamed) {
    System.setProperty("ANDROID_USER_HOME", File(gradle.gradleUserHomeDir, "android-user-home").absolutePath)
}
pluginManagement { repositories { google(); mavenCentral(); gradlePluginPortal() } }
dependencyResolutionManagement { repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS); repositories { google(); mavenCentral() } }
rootProject.name = "HerdrPocket"
include(":app")
