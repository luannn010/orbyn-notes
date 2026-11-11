#![cfg_attr(all(windows, not(test)), windows_subsystem = "windows")]

use std::sync::Mutex;
use tauri::{Emitter, Manager, WebviewWindow, WindowEvent};

const MAX_REQUEST_ID: u64 = 9_007_199_254_740_991;

#[derive(Default)]
struct CloseRequests {
    next: u64,
    pending: Option<u64>,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct CloseRequest {
    request_id: u64,
}

fn local_url(url: &tauri::Url) -> bool {
    let packaged = url.scheme() == "http"
        && url.host_str() == Some("tauri.localhost")
        && url.port_or_known_default() == Some(80);
    let development = cfg!(debug_assertions)
        && url.scheme() == "http"
        && url.host_str() == Some("127.0.0.1")
        && url.port() == Some(5179);
    (packaged || development) && url.username().is_empty() && url.password().is_none()
}

#[cfg(test)]
mod tests {
    use super::local_url;

    #[test]
    fn navigation_rejects_remote_and_lookalike_origins() {
        for candidate in [
            "https://example.com/",
            "http://tauri.localhost.attacker.example/",
            "http://tauri.localhost:8089/",
            "https://tauri.localhost/",
            "http://user@tauri.localhost/",
            "http://127.0.0.1:8089/",
            "http://localhost:5179/",
            "javascript:alert(1)",
            "data:text/html,hello",
            "file:///C:/Windows/win.ini",
        ] {
            assert!(
                !local_url(&candidate.parse().unwrap()),
                "allowed {candidate}"
            );
        }
        assert!(local_url(
            &"http://tauri.localhost/index.html".parse().unwrap()
        ));
        assert_eq!(
            local_url(&"http://127.0.0.1:5179/".parse().unwrap()),
            cfg!(debug_assertions),
        );
    }
}

fn verify_caller(window: &WebviewWindow) -> Result<(), String> {
    if window.label() != "main" || !local_url(&window.url().map_err(|e| e.to_string())?) {
        return Err("Window command is unavailable from this document.".into());
    }
    Ok(())
}

#[tauri::command]
async fn finish_close(window: WebviewWindow, request_id: u64) -> Result<(), String> {
    verify_caller(&window)?;
    let state = window.state::<Mutex<CloseRequests>>();
    {
        let mut requests = state.lock().map_err(|_| "Close state is unavailable.")?;
        if requests.pending != Some(request_id) || request_id == 0 {
            return Err("Close request is no longer current.".into());
        }
        // Consume before the native effect. There is no renderer destroy permission.
        requests.pending = None;
    }
    if let Err(error) = window.destroy() {
        let mut requests = state.lock().map_err(|_| "Close state is unavailable.")?;
        // A newer close must not be overwritten if it arrived during the effect.
        if requests.pending.is_none() {
            requests.pending = Some(request_id);
        }
        return Err(error.to_string());
    }
    Ok(())
}

#[tauri::command]
async fn show_system_menu(window: WebviewWindow) -> Result<(), String> {
    verify_caller(&window)?;
    #[cfg(windows)]
    {
        let handle = window.hwnd().map_err(|e| e.to_string())?;
        // Pass only the handle value across the main-thread dispatch. Tauri owns it.
        let hwnd_value = handle.0 as usize;
        let (sender, receiver) = std::sync::mpsc::sync_channel(1);
        window
            .run_on_main_thread(move || {
                use windows_sys::Win32::{Foundation::POINT, UI::WindowsAndMessaging::*};
                // SAFETY: the handle belongs to this live Tauri window. The menu is OS-owned,
                // POINT is initialized and valid, and only an OS-selected system command is sent.
                unsafe {
                    let hwnd = hwnd_value as _;
                    let menu = GetSystemMenu(hwnd, 0);
                    let mut point = POINT { x: 0, y: 0 };
                    if menu.is_null() || GetCursorPos(&mut point) == 0 {
                        let _ = sender.send(Err("System menu is unavailable.".to_string()));
                        return;
                    }
                    SetForegroundWindow(hwnd);
                    let command = TrackPopupMenuEx(
                        menu,
                        TPM_RETURNCMD | TPM_RIGHTBUTTON,
                        point.x,
                        point.y,
                        hwnd,
                        std::ptr::null(),
                    );
                    if command != 0 {
                        if PostMessageW(hwnd, WM_SYSCOMMAND, command as usize, 0) == 0 {
                            let _ = sender.send(Err("System command is unavailable.".to_string()));
                            return;
                        }
                    }
                    let _ = sender.send(Ok(()));
                }
            })
            .map_err(|e| e.to_string())?;
        return tauri::async_runtime::spawn_blocking(move || receiver.recv())
            .await
            .map_err(|e| e.to_string())?
            .map_err(|e| e.to_string())?;
    }
    #[cfg(not(windows))]
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .manage(Mutex::new(CloseRequests::default()))
        .invoke_handler(tauri::generate_handler![finish_close, show_system_menu])
        .setup(|app| {
            tauri::WebviewWindowBuilder::from_config(app, &app.config().app.windows[0])?
                .on_navigation(local_url)
                .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
                .build()?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                // Always fail closed, including startup, bridge failure and poisoned state.
                api.prevent_close();
                if window.label() != "main" {
                    return;
                }
                let state = window.state::<Mutex<CloseRequests>>();
                let Ok(mut requests) = state.lock() else {
                    return;
                };
                let request_id = match requests.pending {
                    Some(id) => id,
                    None => {
                        requests.next = if requests.next >= MAX_REQUEST_ID {
                            1
                        } else {
                            requests.next + 1
                        };
                        let id = requests.next;
                        requests.pending = Some(id);
                        id
                    }
                };
                drop(requests);
                // Emission failure never authorizes closure; the next explicit request retries.
                let _ = window.emit("notes-close-requested", CloseRequest { request_id });
            }
        })
        .run(tauri::generate_context!())
        .expect("failed to run Orbyn Notes");
}
