plugins {
    id("com.android.application") version "8.9.1" apply false
    id("org.jetbrains.kotlin.android") version "2.1.20" apply false
    id("org.jetbrains.kotlin.plugin.compose") version "2.1.20" apply false
    // Room's code generator (the Teams tab's local cache). Its version is the Kotlin version, then KSP's own.
    id("com.google.devtools.ksp") version "2.1.20-2.0.1" apply false
}
