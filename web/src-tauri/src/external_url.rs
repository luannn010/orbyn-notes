const ERROR: &str = "Could not open the source. Copy its URL and open it in your browser.";

pub(crate) fn validate(value: &str) -> Result<tauri::Url, String> {
    if value.encode_utf16().count() > 8192
        || value
            .chars()
            .any(|c| c <= '\u{20}' || c == '\u{7f}' || c == '\\')
    {
        return Err(ERROR.into());
    }
    let Some((scheme, rest)) = value.split_once("://") else {
        return Err(ERROR.into());
    };
    if !scheme.eq_ignore_ascii_case("https") && !scheme.eq_ignore_ascii_case("http") {
        return Err(ERROR.into());
    }
    let authority = rest.split(['/', '?', '#']).next().unwrap_or_default();
    if authority.is_empty() || authority.contains('@') {
        return Err(ERROR.into());
    }
    let url = tauri::Url::parse(value).map_err(|_| ERROR.to_string())?;
    if !matches!(url.scheme(), "http" | "https")
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err(ERROR.into());
    }
    Ok(url)
}

#[tauri::command]
pub(crate) async fn open_external_url(
    window: tauri::WebviewWindow,
    url: String,
) -> Result<(), String> {
    super::verify_caller(&window).map_err(|_| ERROR.to_string())?;
    let url = validate(&url)?;
    #[cfg(windows)]
    {
        let (sender, receiver) = std::sync::mpsc::sync_channel(1);
        let live_window = window.clone();
        window
            .run_on_main_thread(move || {
                let handoff = || -> Result<(), String> {
                    // Recheck the injected live owner at dispatch time; never carry a bare HWND across the queue.
                    super::verify_caller(&live_window).map_err(|_| ERROR.to_string())?;
                    let hwnd = live_window.hwnd().map_err(|_| ERROR.to_string())?;
                    let destination: Vec<u16> =
                        url.as_str().encode_utf16().chain(Some(0)).collect();
                    let verb = [b'o' as u16, b'p' as u16, b'e' as u16, b'n' as u16, 0];
                    // SAFETY: this is the existing Wry STA thread and its live owned window. Both terminated
                    // buffers stay live through the call; no parameters or executable path are accepted.
                    let result = unsafe {
                        windows_sys::Win32::UI::Shell::ShellExecuteW(
                            hwnd.0 as _,
                            verb.as_ptr(),
                            destination.as_ptr(),
                            std::ptr::null(),
                            std::ptr::null(),
                            windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL,
                        )
                    };
                    if (result as isize) > 32 {
                        Ok(())
                    } else {
                        Err(ERROR.into())
                    }
                };
                let _ = sender.send(handoff());
            })
            .map_err(|_| ERROR.to_string())?;
        tauri::async_runtime::spawn_blocking(move || receiver.recv())
            .await
            .map_err(|_| ERROR.to_string())?
            .map_err(|_| ERROR.to_string())?
    }
    #[cfg(not(windows))]
    {
        let _ = url;
        Err(ERROR.into())
    }
}

#[cfg(test)]
mod tests {
    use super::validate;

    #[test]
    fn accepts_only_complete_web_destinations() {
        for value in [
            "http://example.test/",
            "HTTPS://EXAMPLE.test/path?q=one&next=two#section",
            "https://example.test/日本語?q=✓",
            "http://127.0.0.1:9910/",
            "https://[::1]:9910/",
        ] {
            assert!(validate(value).is_ok());
        }
    }

    #[test]
    fn rejects_other_schemes_credentials_and_ambiguous_input() {
        for value in [
            "",
            "//example.test/path",
            "https:example.test",
            "https:///example.test",
            "file:///C:/Windows/win.ini",
            "mailto:synthetic@example.test",
            "javascript:alert(1)",
            "data:text/plain,hello",
            "ms-settings:privacy",
            "C:/Windows/notepad.exe",
            r"\\server\share",
            r"https://example.test\other",
            "https://user:synthetic@example.test/",
            "https://user@example.test/",
            "https://@example.test/",
            "https://example.test/a b",
            " https://example.test/",
            "https://example.test/\n",
            "https://example.test/\0",
            "https://example.test/\u{7f}",
            "https://",
            "https://?q=missing-host",
        ] {
            assert!(validate(value).is_err());
        }
    }

    #[test]
    fn bounds_utf16_input_and_never_echoes_a_rejected_destination() {
        let prefix = "https://example.test/";
        assert!(validate(&(prefix.to_owned() + &"a".repeat(8192 - prefix.len()))).is_ok());
        assert!(validate(&(prefix.to_owned() + &"a".repeat(8193 - prefix.len()))).is_err());
        assert!(validate(&(prefix.to_owned() + &"📝".repeat(4096))).is_err());
        let secret = "https://user:synthetic-secret@example.test/";
        assert!(!validate(secret).unwrap_err().contains(secret));
    }
}
