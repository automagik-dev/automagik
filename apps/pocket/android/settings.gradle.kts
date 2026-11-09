// A sandboxed pane can mount the OS home read-only. AGP then cannot create its default debug
// keystore under it, and assembleDebug stops before the tests run. AGP reads ANDROID_USER_HOME,
// ANDROID_SDK_HOME and ANDROID_PREFS_ROOT for the same Android preferences folder, and stops with
// AndroidLocationsException when they name different paths, so point the prefs at a stable location
// only when that home is not writable AND none of the three is already named by the environment or
// a -D flag: an existing name of any of the three is adopted as it is. The location is under
// Gradle's user home, not under build/, so clean does not churn the debug keystore (and the
// signature of the debug or fallback-signed APKs built here); none of those builds ship. A
// developer machine and CI keep ~/.android, and the release signing block still reads user.home.
val osHomeWritable = File(System.getProperty("user.home")).canWrite()
val androidPrefsNamed = listOf("ANDROID_USER_HOME", "ANDROID_SDK_HOME", "ANDROID_PREFS_ROOT")
    .any { !System.getenv(it).isNullOrBlank() || !System.getProperty(it).isNullOrBlank() }
if (!osHomeWritable && !androidPrefsNamed) {
    System.setProperty("ANDROID_USER_HOME", File(gradle.gradleUserHomeDir, "android-user-home").absolutePath)
}
pluginManagement { repositories { google(); mavenCentral(); gradlePluginPortal() } }
dependencyResolutionManagement { repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS); repositories { google(); mavenCentral() } }
rootProject.name = "HerdrPocket"
include(":app")
