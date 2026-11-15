use std::{collections::HashMap, sync::Mutex};
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindow};

#[derive(Default)]
pub struct CaptureState {
    scopes: HashMap<String, (String, String)>,
    creating: bool,
    owner_change: Option<String>,
    handoff: Option<Handoff>,
    quit: Option<(String, Vec<String>)>,
    pub shortcut_error: Option<String>,
}
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct Handoff {
    token: String,
    account_id: String,
    device_id: String,
    note_id: String,
}
pub(crate) fn verify(window: &WebviewWindow) -> Result<(), String> {
    if !matches!(window.label(), "main" | "quick-note")
        || !super::local_url(&window.url().map_err(|e| e.to_string())?)
    {
        return Err("Capture is unavailable from this document.".into());
    }
    Ok(())
}
pub fn show_main(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}
impl CaptureState {
    fn begin_open(&mut self) -> Result<(), String> {
        if self.owner_change.is_some() {
            return Err("Notes is changing workspace. Try Quick note when it finishes.".into());
        }
        if self.quit.is_some() {
            return Err("Notes is checking unfinished work before quitting.".into());
        }
        if self.creating {
            return Err("Quick note is opening. Try again in a moment.".into());
        }
        self.creating = true;
        Ok(())
    }
    fn begin_quit(&mut self, token: String, labels: Vec<String>) -> bool {
        if self.creating || self.quit.is_some() || self.owner_change.is_some() {
            return false;
        }
        self.quit = Some((token, labels));
        true
    }
}
fn open(app: &tauri::AppHandle) -> Result<(), String> {
    // Seal admission before native creation; Quit cannot snapshot a partial window set.
    app.state::<Mutex<CaptureState>>()
        .lock()
        .map_err(|_| "Capture state unavailable")?
        .begin_open()?;
    let result = (|| {
        if let Some(window) = app.get_webview_window("quick-note") {
            window.show().map_err(|e| e.to_string())?;
            return window.set_focus().map_err(|e| e.to_string());
        }
        tauri::WebviewWindowBuilder::new(
            app,
            "quick-note",
            WebviewUrl::App("index.html?capture=1".into()),
        )
        .title("Quick note — Orbyn Notes")
        .inner_size(400., 204.)
        .min_inner_size(320., 204.)
        .decorations(false)
        .always_on_top(true)
        .icon(tauri::include_image!("icons/32x32.png"))
        .map_err(|e| e.to_string())?
        .on_navigation(super::local_url)
        .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
        .build()
        .map_err(|e| e.to_string())?;
        Ok(())
    })();
    app.state::<Mutex<CaptureState>>()
        .lock()
        .map_err(|_| "Capture state unavailable")?
        .creating = false;
    result
}
#[tauri::command]
pub async fn capture_open(window: WebviewWindow) -> Result<(), String> {
    super::verify_caller(&window)?;
    let app = window.app_handle().clone();
    tauri::async_runtime::spawn_blocking(move || open(&app))
        .await
        .map_err(|_| "Quick note could not open. Try again.".to_string())?
}

// WebView2 creation can deadlock on Windows when called inside a native event
// handler. Let that callback return before a worker requests native creation.
// The worker still uses open's atomic admission, so Quit/workspace changes win
// safely if they start before this queued request reaches the broker.
fn spawn_capture_job<T: Send + 'static>(
    job: impl FnOnce() -> T + Send + 'static,
) -> std::io::Result<std::thread::JoinHandle<T>> {
    std::thread::Builder::new().name("notes-capture-open".into()).spawn(job)
}
fn open_from_event(app: &tauri::AppHandle) {
    let worker_app = app.clone();
    if spawn_capture_job(move || {
        if let Err(error) = open(&worker_app) {
            let _ = worker_app.emit_to("main", "notes-capture-error", error);
        }
    }).is_err() {
        let _ = app.emit_to("main", "notes-capture-error", "Quick note could not open. Try again.");
    }
}
#[tauri::command]
pub fn capture_scope(
    window: WebviewWindow,
    account_id: Option<String>,
    device_id: Option<String>,
) -> Result<(), String> {
    verify(&window)?;
    let state = window.state::<Mutex<CaptureState>>();
    let mut state = state.lock().map_err(|_| "Capture state unavailable")?;
    match (account_id, device_id) {
        (Some(account), Some(device))
            if !account.is_empty()
                && account.len() <= 128
                && !device.is_empty()
                && device.len() <= 128 =>
        {
            state
                .scopes
                .insert(window.label().into(), (account, device));
        }
        (None, None) => {
            state.scopes.remove(window.label());
            state.handoff = None;
        }
        _ => return Err("Invalid capture owner".into()),
    };
    Ok(())
}
#[tauri::command]
pub fn capture_require_closed(window: WebviewWindow) -> Result<String, String> {
    super::verify_caller(&window)?;
    let state = window.state::<Mutex<CaptureState>>();
    let mut state = state.lock().map_err(|_| "Capture state unavailable")?;
    if state.creating
        || state.quit.is_some()
        || state.owner_change.is_some()
        || window
            .app_handle()
            .get_webview_window("quick-note")
            .is_some()
    {
        return Err("Close Quick note before changing workspace or signing out. Unsaved text must be saved or copied first.".into());
    }
    let token = uuid::Uuid::new_v4().to_string();
    state.owner_change = Some(token.clone());
    Ok(token)
}
#[tauri::command]
pub fn capture_owner_changed(window: WebviewWindow, token: String) -> Result<(), String> {
    super::verify_caller(&window)?;
    let state = window.state::<Mutex<CaptureState>>();
    let mut state = state.lock().map_err(|_| "Capture state unavailable")?;
    if state.owner_change.as_deref() != Some(token.as_str()) {
        return Err("Workspace change expired".into());
    }
    state.owner_change = None;
    Ok(())
}
#[tauri::command]
pub fn capture_pin(window: WebviewWindow, pinned: bool) -> Result<(), String> {
    verify(&window)?;
    if window.label() != "quick-note" {
        return Err("Unavailable".into());
    }
    window.set_always_on_top(pinned).map_err(|e| e.to_string())
}
#[tauri::command]
pub fn capture_show_main(window: WebviewWindow) -> Result<(), String> {
    verify(&window)?;
    show_main(window.app_handle());
    Ok(())
}
#[tauri::command]
pub fn capture_handoff(
    window: WebviewWindow,
    note_id: String,
    token: String,
) -> Result<(), String> {
    verify(&window)?;
    if window.label() != "quick-note"
        || uuid::Uuid::parse_str(&note_id).is_err()
        || uuid::Uuid::parse_str(&token).is_err()
    {
        return Err("Invalid capture handoff".into());
    }
    let request = {
        let state = window.state::<Mutex<CaptureState>>();
        let mut state = state.lock().map_err(|_| "Capture state unavailable")?;
        let owner = state
            .scopes
            .get("quick-note")
            .ok_or("Open Notes to unlock this workspace first.")?
            .clone();
        if state.scopes.get("main") != Some(&owner) {
            return Err("Open Notes in the same workspace first.".into());
        }
        let request = Handoff {
            token,
            account_id: owner.0,
            device_id: owner.1,
            note_id,
        };
        state.handoff = Some(request.clone());
        request
    };
    show_main(window.app_handle());
    window
        .app_handle()
        .emit_to("main", "notes-capture-handoff", request)
        .map_err(|e| e.to_string())
}
#[tauri::command]
pub fn capture_handoff_result(
    window: WebviewWindow,
    token: String,
    accepted: bool,
) -> Result<(), String> {
    super::verify_caller(&window)?;
    let request = {
        let state = window.state::<Mutex<CaptureState>>();
        let mut state = state.lock().map_err(|_| "Capture state unavailable")?;
        let request = state.handoff.take().ok_or("Capture request expired")?;
        if request.token != token {
            state.handoff = Some(request);
            return Err("Capture request expired".into());
        }
        let owner = (request.account_id.clone(), request.device_id.clone());
        if state.scopes.get("main") != Some(&owner)
            || state.scopes.get("quick-note") != Some(&owner)
        {
            return Err("Workspace changed".into());
        }
        request
    };
    window
        .app_handle()
        .emit_to(
            "quick-note",
            "notes-capture-result",
            serde_json::json!({"token":request.token,"accepted":accepted}),
        )
        .map_err(|e| e.to_string())
}
#[tauri::command]
pub fn capture_shortcut_status(window: WebviewWindow) -> Result<Option<String>, String> {
    verify(&window)?;
    Ok(window
        .state::<Mutex<CaptureState>>()
        .lock()
        .map_err(|_| "Capture state unavailable")?
        .shortcut_error
        .clone())
}
fn cancel_quit(app: &tauri::AppHandle, token: &str) {
    let state = app.state::<Mutex<CaptureState>>();
    let Ok(mut state) = state.lock() else { return };
    if state.quit.as_ref().map(|v| v.0.as_str()) != Some(token) {
        return;
    }
    state.quit = None;
    drop(state);
    for window in app.webview_windows().values() {
        let _ = window.emit_to(window.label(), "notes-quit-cancelled", ());
    }
    show_main(app);
}
#[tauri::command]
pub fn capture_quit(window: WebviewWindow) -> Result<(), String> {
    super::verify_caller(&window)?;
    request_quit(window.app_handle());
    Ok(())
}
pub fn request_quit(app: &tauri::AppHandle) {
    let token = uuid::Uuid::new_v4().to_string();
    {
        let state = app.state::<Mutex<CaptureState>>();
        let Ok(mut state) = state.lock() else { return };
        if !state.begin_quit(
            token.clone(),
            app.webview_windows().keys().cloned().collect(),
        ) {
            return;
        }
    }
    for window in app.webview_windows().values() {
        let _ = window.emit_to(window.label(), "notes-quit-probe", token.clone());
    }
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(5));
        cancel_quit(&app, &token);
    });
}
#[tauri::command]
pub fn capture_quit_reply(
    window: WebviewWindow,
    token: String,
    allowed: bool,
) -> Result<(), String> {
    verify(&window)?;
    if !allowed {
        cancel_quit(window.app_handle(), &token);
        let _ = window.show();
        let _ = window.set_focus();
        return Ok(());
    }
    let complete = {
        let state = window.state::<Mutex<CaptureState>>();
        let mut state = state.lock().map_err(|_| "Capture state unavailable")?;
        let Some((current, pending)) = state.quit.as_mut() else {
            return Err("Quit expired".into());
        };
        if current != &token {
            return Err("Quit expired".into());
        }
        pending.retain(|label| label != window.label());
        pending.is_empty()
    };
    if complete {
        window.app_handle().exit(0)
    }
    Ok(())
}
pub fn setup(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    use tauri::menu::{Menu, MenuItem};
    use tauri::tray::TrayIconBuilder;
    let show = MenuItem::with_id(app, "show", "Open Notes", true, None::<&str>)?;
    let quick = MenuItem::with_id(app, "capture", "Quick note", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Notes", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quick, &quit])?;
    TrayIconBuilder::new()
        .icon(tauri::include_image!("icons/32x32.png"))
        .tooltip("Orbyn Notes")
        .menu(&menu)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_main(app),
            "capture" => open_from_event(app),
            "quit" => request_quit(app),
            _ => {}
        })
        .build(app)?;
    use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
    let result = app
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _, event| {
                    if event.state() == ShortcutState::Pressed {
                        open_from_event(app);
                    }
                })
                .build(),
        )
        .map_err(|e| e.to_string())
        .and_then(|_| {
            app.global_shortcut()
                .register("CommandOrControl+Shift+N")
                .map_err(|e| e.to_string())
        });
    if result.is_err() {
        app.state::<Mutex<CaptureState>>()
            .lock()
            .map_err(|_| "Capture state unavailable")?
            .shortcut_error = Some(
            "Ctrl+Shift+N is unavailable. Open Quick note from the Notes menu or tray instead."
                .into(),
        );
    }
    Ok(())
}

pub fn closed(app: &tauri::AppHandle, label: &str) {
    if let Ok(mut state) = app.state::<Mutex<CaptureState>>().lock() {
        state.scopes.remove(label);
        if label == "quick-note" {
            state.handoff = None;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{CaptureState, spawn_capture_job};
    #[test]
    fn native_event_capture_creation_runs_off_callback_without_blocking_it() {
        let caller = std::thread::current().id();
        let (started_tx, started_rx) = std::sync::mpsc::channel();
        let (release_tx, release_rx) = std::sync::mpsc::channel();
        let worker = spawn_capture_job(move || {
            started_tx.send(std::thread::current().id()).unwrap();
            release_rx.recv().unwrap();
        }).unwrap();
        let worker_id = started_rx.recv_timeout(std::time::Duration::from_secs(2)).unwrap();
        assert_ne!(caller, worker_id);
        // This line is reached while creation remains blocked on the worker.
        release_tx.send(()).unwrap();
        worker.join().unwrap();
    }

    #[test]
    fn owner_transition_seals_new_capture_and_quit_until_released() {
        let mut state = CaptureState::default();
        state.owner_change = Some("transition".into());
        assert!(state.begin_open().is_err());
        assert!(!state.begin_quit("quit".into(), vec!["main".into()]));
        state.owner_change = None;
        assert!(state.begin_open().is_ok());
    }
    #[test]
    fn quit_seals_new_capture_and_capture_seals_quit_snapshot() {
        let mut state = CaptureState::default();
        assert!(state.begin_quit("quit".into(), vec!["main".into()]));
        assert!(state.begin_open().is_err());
        state.quit = None;
        assert!(state.begin_open().is_ok());
        assert!(!state.begin_quit("other".into(), vec!["main".into()]));
        assert!(state.begin_open().is_err());
        state.creating = false;
        assert!(state.begin_quit("later".into(), vec!["main".into(), "quick-note".into()]));
    }
}
