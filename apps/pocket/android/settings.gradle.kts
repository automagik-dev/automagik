// A sandboxed pane can mount the OS home read-only. AGP then cannot create its default debug
// keystore at <user.home>/.android/debug.keystore, and assembleDebug stops before the tests run.
// Point Android's prefs at build/ only when that home is not writable: a developer machine and CI
// keep the normal location, and the release signing block still reads user.home itself.
if (!File(System.getProperty("user.home")).canWrite()) {
    System.setProperty("ANDROID_USER_HOME", File(rootDir, "app/build/android-user-home").absolutePath)
}
pluginManagement { repositories { google(); mavenCentral(); gradlePluginPortal() } }
dependencyResolutionManagement { repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS); repositories { google(); mavenCentral() } }
rootProject.name = "HerdrPocket"
include(":app")
