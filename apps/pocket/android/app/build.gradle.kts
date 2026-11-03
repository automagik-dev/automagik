import java.util.Properties

plugins { id("com.android.application"); id("org.jetbrains.kotlin.android"); id("org.jetbrains.kotlin.plugin.compose") }

// The release key. CI passes it in the environment; a maintainer's machine keeps it in ~/.config/herdr-pocket/signing.properties.
// Without it, builds are debug-signed and can't update, or be updated by, the published releases.
val signing = Properties().apply {
    val local = File(System.getProperty("user.home"), ".config/herdr-pocket/signing.properties")
    if (local.isFile) local.inputStream().use(::load)
    System.getenv("POCKET_SIGNING_STORE")?.let { setProperty("storeFile", it) }
    val password = System.getenv("POCKET_SIGNING_PASSWORD") ?: getProperty("passwordFile")?.let { File(it).takeIf(File::isFile)?.readText()?.trim() }
    password?.let { setProperty("password", it) }
}
// The release version is the monorepo's one version (AGENTS.md): the root package.json, three levels above this
// Gradle project, set by bun scripts/version.ts on each release. Never edited here.
val appVersion: String = (groovy.json.JsonSlurper().parse(rootProject.file("../../../package.json")) as Map<*, *>)["version"] as String
// One versionCode per version: major*1_000_000 + minor*1_000 + patch, so 3.57.0 is 3057000, above every build the old
// automagik-pocket published (minutes since 2025). Minor and patch stop at 999 (scripts/version.ts refuses more), or
// 3.1000.0 would be 4.0.0's code (docs/rfcs/0011-monorepo-parts-and-releases.md, "Pocket").
val versionFromName: Long = Regex("""^(\d+)\.(\d+)\.(\d+)$""").matchEntire(appVersion)?.destructured
    ?.let { (major, minor, patch) ->
        require(minor.toLong() <= 999 && patch.toLong() <= 999) { "version $appVersion: minor and patch stop at 999 (Pocket's versionCode)" }
        major.toLong() * 1_000_000 + minor.toLong() * 1_000 + patch.toLong()
    } ?: error("not a version: $appVersion")
// Testing self-update locally: -Ppocket.versionCode=1 builds an "older" copy that a normal build then updates.
val versionCodeOverride = providers.gradleProperty("pocket.versionCode").map { it.toLong() }

android {
    namespace = "ai.namastex.automagik"
    compileSdk = 35
    defaultConfig { applicationId = "ai.namastex.automagik"; minSdk = 26; targetSdk = 35; versionCode = versionCodeOverride.orElse(versionFromName).get().toInt(); versionName = appVersion; testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        // iroh ships a 9–14 MB library per ABI: phones, and x86_64 for Intel emulators. 32-bit x86 and MIPS phones are long gone.
        ndk { abiFilters += setOf("arm64-v8a", "armeabi-v7a", "x86_64") }
        // Where installed copies look for updates: latest.json on the monorepo's rolling pocket-lane release, which only a
        // Pocket release replaces (the APK stays on its vX.Y.Z release). A fork, or a local test server, points this at
        // its own with -Ppocket.updateUrl=.
        val updates = providers.gradleProperty("pocket.updateUrl").orElse("https://github.com/automagik-dev/automagik/releases/download/pocket-lane/latest.json")
        buildConfigField("String", "UPDATE_URL", "\"${updates.get()}\"") }
    signingConfigs { if (signing.getProperty("storeFile") != null && signing.getProperty("password") != null) create("pocket") {
        storeFile = file(signing.getProperty("storeFile")); storePassword = signing.getProperty("password")
        keyAlias = signing.getProperty("alias", "pocket"); keyPassword = signing.getProperty("password") } }
    buildFeatures { compose = true; buildConfig = true }
    buildTypes {
        // Debug builds use the release key too when it's here, so a build from Android Studio and the published ones update each other.
        debug { signingConfigs.findByName("pocket")?.let { signingConfig = it } }
        release { isMinifyEnabled = false; signingConfig = signingConfigs.findByName("pocket") ?: signingConfigs.getByName("debug") } }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    kotlinOptions { jvmTarget = "17" }
    packaging { resources.excludes += setOf("META-INF/versions/9/OSGI-INF/MANIFEST.MF", "META-INF/DEPENDENCIES", "META-INF/LICENSE*", "META-INF/NOTICE*",
        // The iroh jar also carries desktop libraries; Android takes its own from iroh-android's jni/.
        "darwin-*/**", "linux-*/**", "win32-*/**")
        // Compressed in the APK: about half the download, unpacked once at install.
        jniLibs.useLegacyPackaging = true }
    testOptions { unitTests.isReturnDefaultValues = true }
}
dependencies {
    implementation(platform("androidx.compose:compose-bom:2025.04.01"))
    implementation("androidx.core:core-ktx:1.16.0")
    implementation("androidx.activity:activity-compose:1.10.1")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.9.0")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.9.0")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.compose.ui:ui-tooling-preview")
    debugImplementation("androidx.compose.ui:ui-tooling")
    implementation("androidx.webkit:webkit:1.13.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")
    // iroh: dial a paired desktop by its key; direct when it can, an end-to-end encrypted relay when it can't.
    implementation("computer.iroh:iroh-android:1.2.0")
    // JNA, which iroh's bindings load, pinned above the 5.15.0 that iroh-android 1.2.0 asks for: 5.15.0's
    // libjnidispatch.so isn't 16 KB page-size ready (x86_64 LOAD segments 4 KB aligned; arm64 read-only RELRO
    // ends inside a writable page), and Play requires it for apps targeting API 35+. 5.17.0's AAR is 16 KB aligned.
    // The AAR is the Android build (classes plus jni/<abi>/libjnidispatch.so); iroh-android already leaves out the
    // desktop jar, so this is the only JNA in the APK. Remove the pin once iroh-android depends on JNA 5.17 or newer.
    implementation("net.java.dev.jna:jna:5.17.0@aar")
    // A bundled QR scanner (camera + ZXing): works without Google Play services.
    implementation("com.journeyapps:zxing-android-embedded:4.3.0")
    // Draws the desktop's own program icons (SVG), read from the person's desktop at runtime.
    implementation("com.caverock:androidsvg-aar:1.4")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20240303")
}
