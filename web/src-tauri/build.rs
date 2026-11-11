fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "finish_close",
            "show_system_menu",
            "open_external_url",
            "note_link_snapshot",
            "note_link_ack",
            "note_link_retire",
        ]),
    ))
    .expect("failed to build native application resources");
}
