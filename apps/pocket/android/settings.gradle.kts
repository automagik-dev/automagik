// A sandboxed pane can mount the OS home read-only. AGP then cannot create its default debug
// keystore under it, and assembleDebug stops before the tests run. Point Android's prefs at a
// stable location only when that home is not writable AND neither the environment nor a -D flag
// already names one: AGP stops with AndroidLocationsException when the env var and the system
// property name different paths, so an existing ANDROID_USER_HOME is adopted as it is. The
// location is under Gradle's user home, not under build/, so clean does not churn the debug keystore
// (and the signature of the debug or fallback-signed APKs built here); none of those builds ship. A
// developer machine and CI keep ~/.android, and the release signing block still reads user.home.
val osHomeWritable = File(System.getProperty("user.home")).canWrite()
val androidUserHomeNamed = !System.getenv("ANDROID_USER_HOME").isNullOrBlank() || !System.getProperty("ANDROID_USER_HOME").isNullOrBlank()
if (!osHomeWritable && !androidUserHomeNamed) {
    System.setProperty("ANDROID_USER_HOME", File(gradle.gradleUserHomeDir, "android-user-home").absolutePath)
}
pluginManagement { repositories { google(); mavenCentral(); gradlePluginPortal() } }
dependencyResolutionManagement { repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS); repositories { google(); mavenCentral() } }
rootProject.name = "HerdrPocket"
include(":app")
