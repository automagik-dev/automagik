fn main() {
    // An app manifest makes `spike_bridge` an ACL-checked command (permission `allow-spike-bridge`),
    // which is what lets a capability grant it to the remote origin http://127.0.0.1:*.
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(&["spike_bridge"])),
    )
    .expect("tauri build");
}
