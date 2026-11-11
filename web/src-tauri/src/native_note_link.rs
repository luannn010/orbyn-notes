use std::{ffi::OsString, sync::Mutex};
use tauri::{Emitter, Manager, WebviewWindow};

const MAX_SEQUENCE: u64 = 9_007_199_254_740_991;
const PREFIX: &str = "orbyn-notes://note/v1/";

#[derive(Clone, serde::Serialize)]
pub(crate) struct Pending {
    sequence: u64,
    uri: String,
}
#[derive(serde::Serialize)]
pub(crate) struct Snapshot {
    sequence: u64,
    pending: Option<Pending>,
}
#[derive(Clone, serde::Serialize)]
pub(crate) struct Sequence {
    sequence: u64,
}
#[derive(Default)]
pub(crate) struct Broker {
    sequence: u64,
    pending: Option<Pending>,
}
impl Broker {
    fn advance(&mut self) -> Result<u64, String> {
        if self.sequence >= MAX_SEQUENCE {
            self.pending = None;
            return Err("Reference sequence is exhausted.".into());
        }
        self.sequence += 1;
        Ok(self.sequence)
    }
    fn accept(&mut self, uri: String) -> Result<Sequence, String> {
        let sequence = self.advance()?;
        self.pending = Some(Pending { sequence, uri });
        Ok(Sequence { sequence })
    }
    fn snapshot(&self) -> Snapshot {
        Snapshot {
            sequence: self.sequence,
            pending: self.pending.clone(),
        }
    }
    fn ack(&mut self, sequence: u64) -> bool {
        if sequence == 0 || self.pending.as_ref().map(|p| p.sequence) != Some(sequence) {
            return false;
        }
        self.pending = None;
        true
    }
    fn retire(&mut self) -> Result<Sequence, String> {
        self.pending = None;
        Ok(Sequence {
            sequence: self.advance()?,
        })
    }
}

// Envelope admission only. Independent TS decoding validates the canonical
// JSON, UTF8 identity and scope before the guarded application handoff.
fn envelope(uri: &str) -> bool {
    if !uri.is_ascii() || uri.len() > 8192 {
        return false;
    }
    let Some(payload) = uri.strip_prefix(PREFIX) else {
        return false;
    };
    if payload.is_empty() || payload.len() > 8000 || payload.len() % 4 == 1 {
        return false;
    }
    let mut last = 0;
    for byte in payload.bytes() {
        last = match byte {
            b'A'..=b'Z' => byte - b'A',
            b'a'..=b'z' => byte - b'a' + 26,
            b'0'..=b'9' => byte - b'0' + 52,
            b'-' => 62,
            b'_' => 63,
            _ => return false,
        };
    }
    match payload.len() % 4 {
        2 => last & 15 == 0,
        3 => last & 3 == 0,
        _ => true,
    }
}
pub(crate) fn startup(args: impl IntoIterator<Item = OsString>) -> Option<String> {
    let mut args = args.into_iter();
    args.next()?; // Executable metadata may contain any valid OS path.
    let operand = args.next()?;
    if args.next().is_some() {
        return None;
    }
    let uri = operand.to_str()?;
    envelope(uri).then(|| uri.to_owned())
}
enum Activation {
    Reveal,
    Reference(String),
    Ignore,
}
fn repeated(args: &[String]) -> Activation {
    match args.len() {
        1 => Activation::Reveal,
        2 if envelope(&args[1]) => Activation::Reference(args[1].clone()),
        _ => Activation::Ignore,
    }
}
pub(crate) fn initial_broker() -> Broker {
    let mut broker = Broker::default();
    if let Some(uri) = startup(std::env::args_os()) {
        let _ = broker.accept(uri);
    }
    broker
}
pub(crate) fn activate(app: &tauri::AppHandle, args: Vec<String>) {
    let activation = repeated(&args);
    if matches!(activation, Activation::Ignore) {
        return;
    }
    // Native window reveal is independent of guarded renderer navigation.
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.show();
        let _ = main.unminimize();
        let _ = main.set_focus();
    }
    let Activation::Reference(uri) = activation else {
        return;
    };
    let state = app.state::<Mutex<Broker>>();
    let Ok(mut broker) = state.lock() else {
        return;
    };
    let Ok(sequence) = broker.accept(uri) else {
        return;
    };
    drop(broker);
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.emit_to(
            tauri::EventTarget::WebviewWindow {
                label: "main".into(),
            },
            "notes-reference-pending",
            sequence,
        );
    }
}
#[tauri::command]
pub(crate) fn note_link_snapshot(window: WebviewWindow) -> Result<Snapshot, String> {
    super::verify_caller(&window)?;
    let state = window.state::<Mutex<Broker>>();
    let broker = state
        .lock()
        .map_err(|_| "Reference broker is unavailable.")?;
    Ok(broker.snapshot())
}
#[tauri::command]
pub(crate) fn note_link_ack(window: WebviewWindow, sequence: u64) -> Result<bool, String> {
    super::verify_caller(&window)?;
    let state = window.state::<Mutex<Broker>>();
    let mut broker = state
        .lock()
        .map_err(|_| "Reference broker is unavailable.")?;
    Ok(broker.ack(sequence))
}
#[tauri::command]
pub(crate) fn note_link_retire(window: WebviewWindow) -> Result<Sequence, String> {
    super::verify_caller(&window)?;
    let state = window.state::<Mutex<Broker>>();
    let mut broker = state
        .lock()
        .map_err(|_| "Reference broker is unavailable.")?;
    broker.retire()
}

#[cfg(test)]
mod tests {
    use super::*;
    const URI: &str = "orbyn-notes://note/v1/eyJ2IjoxfQ";
    #[test]
    fn raw_arguments_are_exact_and_executable_path_is_not_uri_input() {
        assert_eq!(
            startup([OsString::from("C:/用户/Notes.exe"), URI.into()]),
            Some(URI.into())
        );
        assert!(
            matches!(repeated(&["C:/用户/Notes.exe".into(), URI.into()]), Activation::Reference(value) if value == URI)
        );
        for uri in [
            "orbyn-notes://note/v1/YR",
            "orbyn-notes://note/v1/A",
            "orbyn-notes://note/v1/YQ=",
            "orbyn-notes://note/v1/",
            "orbyn-notes://note/v2/YQ",
            "ORBYN-notes://note/v1/YQ",
            "orbyn-notes://note/v1/YQ#x",
            "orbyn-notes://note/v1/YQ?x",
            "orbyn-notes://note/v1/%59Q",
            "orbyn-notes://note/v1/é",
            "orbyn-notes://note/v1/�",
            " orbyn-notes://note/v1/YQ",
            "orbyn-notes://note/v1/YQ\n",
        ] {
            assert!(!envelope(uri), "admitted malformed operand");
        }
        assert!(!envelope(&format!("{PREFIX}{}", "A".repeat(8001))));
        assert!(startup(["app.exe".into()]).is_none());
        assert!(matches!(
            repeated(&["C:/用户/Notes.exe".into()]),
            Activation::Reveal
        ));
        assert!(matches!(repeated(&[]), Activation::Ignore));
        assert!(matches!(
            repeated(&["app.exe".into(), "--unknown".into()]),
            Activation::Ignore
        ));
        assert!(matches!(
            repeated(&["app.exe".into(), "orbyn-notes://note/v1/�".into()]),
            Activation::Ignore
        ));
        assert!(startup(["app.exe".into(), URI.into(), URI.into()]).is_none());
        assert!(matches!(
            repeated(&["app.exe".into(), URI.into(), "extra".into()]),
            Activation::Ignore
        ));
    }
    #[cfg(windows)]
    #[test]
    fn malformed_utf16_operand_is_rejected_without_lossy_startup_alias() {
        use std::os::windows::ffi::OsStringExt;
        assert!(startup(["app.exe".into(), OsString::from_wide(&[0xd800])]).is_none());
    }
    #[test]
    fn shared_exact_valid_reference_vectors_pass_transport_without_normalization() {
        let vectors: serde_json::Value =
            serde_json::from_str(include_str!("../../tests/vectors/note-reference.json")).unwrap();
        for vector in vectors["valid"].as_array().unwrap() {
            let uri = vector["uri"].as_str().unwrap();
            assert!(envelope(uri));
            assert_eq!(
                startup(["C:/用户/Notes.exe".into(), uri.into()]),
                Some(uri.into())
            );
        }
    }
    #[test]
    fn bounded_replacement_conditional_ack_and_retirement() {
        let mut broker = Broker::default();
        assert!(broker.snapshot().pending.is_none());
        let first = broker.accept(URI.into()).unwrap().sequence;
        let second = broker.accept(URI.into()).unwrap().sequence;
        assert!(!broker.ack(first));
        assert_eq!(broker.snapshot().pending.unwrap().sequence, second);
        let barrier = broker.retire().unwrap().sequence;
        assert!(barrier > second);
        assert!(!broker.ack(second));
        assert!(broker.snapshot().pending.is_none());
        let newer = broker.accept(URI.into()).unwrap().sequence;
        assert!(newer > barrier);
        assert!(broker.ack(newer));
        assert!(!broker.ack(newer));
    }
    #[test]
    fn exhaustion_never_wraps_or_preserves_replayable_pending() {
        let mut broker = Broker {
            sequence: MAX_SEQUENCE - 1,
            pending: None,
        };
        assert_eq!(broker.accept(URI.into()).unwrap().sequence, MAX_SEQUENCE);
        assert!(broker.accept(URI.into()).is_err());
        assert!(broker.pending.is_none());
        assert!(broker.retire().is_err());
        assert_eq!(broker.sequence, MAX_SEQUENCE);
    }
}
