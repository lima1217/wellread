use std::env;

fn main() {
    println!(
        "cargo:rustc-env=WELLREAD_TARGET={}",
        env::var("TARGET").expect("TARGET not set")
    );

    // Declare the app's own (non-plugin) commands in the ACL app manifest.
    // Since tauri 2.11, IPC from remote origins is always subject to ACL
    // resolution (upstream #15266); without a manifest the app commands have
    // no ACL entries at all and remote pages get "not allowed. Plugin not
    // found". The webdriver test harness serves the vitest tester page from
    // its own port, which is a remote origin, so it needs these permissions
    // granted via capabilities (see capabilities/webdriver-remote.json).
    // With a manifest defined, LOCAL windows also resolve app commands
    // through the ACL, so capabilities/default.json must grant them too.
    // Keep this list in sync with the generate_handler! list in lib.rs.
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "download_file",
            "upload_file",
            "get_environment_variable",
            "get_executable_dir",
            "is_updater_disabled",
            "allow_paths_in_scopes",
            "read_dir",
            "parse_epub_metadata",
            "extract_epub_cover_full",
            "parse_epub_full",
            "parse_mobi_metadata",
            "extract_mobi_cover_full",
            "set_traffic_lights",
            "show_lookup_popover",
            "clip_url",
            "verify_update_signature",
            "install_nightly_update",
            "get_eve_sidecar_info",
            "reload_eve_sidecar",
        ]),
    ))
    .expect("failed to run tauri-build");
}
