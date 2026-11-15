use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::Mutex,
    time::{Duration, Instant},
};

const ERROR: &str = "Could not save the export.";
const MAX_EXPORT_BYTES: usize = 64 * 1024 * 1024;
const TOKEN_TTL: Duration = Duration::from_secs(300);
const MAX_PENDING: usize = 8;

#[derive(Default)]
pub(crate) struct ExportState(Mutex<HashMap<String, (PathBuf, Instant)>>);

fn validate(name: &str, size: usize) -> Result<&str, String> {
    if size > MAX_EXPORT_BYTES
        || name.is_empty()
        || name.encode_utf16().count() > 200
        || name
            .chars()
            .any(|c| c.is_control() || "<>:\"/\\|?*".contains(c))
        || name.ends_with(['.', ' '])
    {
        return Err(ERROR.into());
    }
    let stem = name
        .split('.')
        .next()
        .unwrap_or("")
        .trim_end_matches(' ')
        .to_ascii_uppercase();
    let reserved = matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || ["COM", "LPT"].iter().any(|prefix| {
            stem.strip_prefix(prefix).is_some_and(|suffix| {
                matches!(
                    suffix,
                    "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "¹" | "²" | "³"
                )
            })
        });
    if reserved {
        return Err(ERROR.into());
    }
    let extension = Path::new(name)
        .extension()
        .and_then(|v| v.to_str())
        .unwrap_or("");
    if !["txt", "md", "json", "csv", "zip"]
        .iter()
        .any(|v| extension.eq_ignore_ascii_case(v))
    {
        return Err(ERROR.into());
    }
    Ok(extension)
}

#[tauri::command]
pub(crate) async fn choose_export(
    window: tauri::WebviewWindow,
    name: String,
) -> Result<Option<String>, String> {
    super::verify_caller(&window).map_err(|_| ERROR.to_string())?;
    let extension = validate(&name, 0)?.to_owned();
    #[cfg(windows)]
    {
        use tauri::Manager;
        let hwnd = window.hwnd().map_err(|_| ERROR.to_string())?.0 as usize;
        let path =
            tauri::async_runtime::spawn_blocking(move || -> Result<Option<PathBuf>, String> {
                use std::os::windows::ffi::OsStringExt;
                use windows_sys::Win32::UI::Controls::Dialogs::*;
                let mut filename = vec![0u16; 32768];
                let suggested: Vec<u16> = name.encode_utf16().collect();
                filename[..suggested.len()].copy_from_slice(&suggested);
                let filter: Vec<u16> = format!("Export (*.{extension})\0*.{extension}\0\0")
                    .encode_utf16()
                    .collect();
                let default_extension: Vec<u16> = extension.encode_utf16().chain(Some(0)).collect();
                // SAFETY: Buffers remain live through the modal dialog; HWND belongs to the verified window.
                let mut dialog: OPENFILENAMEW = unsafe { std::mem::zeroed() };
                dialog.lStructSize = std::mem::size_of::<OPENFILENAMEW>() as u32;
                dialog.hwndOwner = hwnd as _;
                dialog.lpstrFilter = filter.as_ptr();
                dialog.nFilterIndex = 1;
                dialog.lpstrFile = filename.as_mut_ptr();
                dialog.nMaxFile = filename.len() as u32;
                dialog.lpstrDefExt = default_extension.as_ptr();
                dialog.Flags = OFN_OVERWRITEPROMPT | OFN_PATHMUSTEXIST | OFN_NOCHANGEDIR;
                if unsafe { GetSaveFileNameW(&mut dialog) } == 0 {
                    return if unsafe { CommDlgExtendedError() } == 0 {
                        Ok(None)
                    } else {
                        Err(ERROR.into())
                    };
                }
                let end = filename
                    .iter()
                    .position(|&c| c == 0)
                    .ok_or_else(|| ERROR.to_string())?;
                Ok(Some(PathBuf::from(std::ffi::OsString::from_wide(
                    &filename[..end],
                ))))
            })
            .await
            .map_err(|_| ERROR.to_string())??;
        let Some(path) = path else { return Ok(None) };
        super::verify_caller(&window).map_err(|_| ERROR.to_string())?;
        let state = window.state::<ExportState>();
        let mut pending = state.0.lock().map_err(|_| ERROR.to_string())?;
        pending.retain(|_, (_, created)| created.elapsed() < TOKEN_TTL);
        if pending.len() >= MAX_PENDING {
            return Err(ERROR.into());
        }
        let token = uuid::Uuid::new_v4().to_string();
        pending.insert(token.clone(), (path, Instant::now()));
        Ok(Some(token))
    }
    #[cfg(not(windows))]
    {
        let _ = (extension, name);
        Err(ERROR.into())
    }
}

#[tauri::command]
pub(crate) async fn write_export(
    window: tauri::WebviewWindow,
    token: String,
    bytes: Vec<u8>,
) -> Result<(), String> {
    use tauri::Manager;
    super::verify_caller(&window).map_err(|_| ERROR.to_string())?;
    let state = window.state::<ExportState>();
    let entry = state
        .0
        .lock()
        .map_err(|_| ERROR.to_string())?
        .remove(&token);
    let (path, created) = entry.ok_or_else(|| ERROR.to_string())?;
    if created.elapsed() >= TOKEN_TTL || bytes.len() > MAX_EXPORT_BYTES {
        return Err(ERROR.into());
    }
    tauri::async_runtime::spawn_blocking(move || std::fs::write(path, bytes))
        .await
        .map_err(|_| ERROR.to_string())?
        .map_err(|_| ERROR.to_string())
}

#[tauri::command]
pub(crate) fn discard_export(window: tauri::WebviewWindow, token: String) -> Result<(), String> {
    use tauri::Manager;
    super::verify_caller(&window).map_err(|_| ERROR.to_string())?;
    window
        .state::<ExportState>()
        .0
        .lock()
        .map_err(|_| ERROR.to_string())?
        .remove(&token);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{validate, MAX_EXPORT_BYTES};
    #[test]
    fn accepts_supported_names_and_bounds_size() {
        for name in [
            "notes.txt",
            "notes.md",
            "notes.json",
            "notes.csv",
            "notes.ZIP",
        ] {
            assert!(validate(name, MAX_EXPORT_BYTES).is_ok());
        }
        for name in [
            "",
            "../notes.txt",
            "notes.exe",
            "notes.txt ",
            "a:b.txt",
            "a\0.txt",
            "CON.txt",
            "nul.json",
            "COM1.csv",
            "lpt³.zip",
            "con .md",
        ] {
            assert!(validate(name, 1).is_err());
        }
        assert!(validate("notes.zip", MAX_EXPORT_BYTES + 1).is_err());
    }
}
