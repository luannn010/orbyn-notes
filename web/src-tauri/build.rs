fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "capture_open",
            "capture_scope",
            "capture_require_closed",
            "capture_owner_changed",
            "capture_pin",
            "capture_show_main",
            "capture_handoff",
            "capture_handoff_result",
            "capture_shortcut_status",
            "capture_quit_reply",
            "capture_quit",
            "finish_close",
            "show_system_menu",
            "open_external_url",
            "note_link_snapshot",
            "note_link_ack",
            "note_link_retire",
            "choose_export",
            "write_export",
            "discard_export",
        ]),
    ))
    .expect("failed to build native application resources");
}
