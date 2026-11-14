# Local Windows shell

The native shell embeds the existing web application in WebView2. It keeps the
same encryption, IndexedDB and AccountService implementations. Its data belongs
to the stable app identity `com.kinqsradio.orbyn.notes` and is separate from web
browser profiles. Browser notes and account sessions are not migrated.

## Build

Use Windows with Node 24, Rust 1.90 or newer with the MSVC toolchain in `%USERPROFILE%\.cargo\bin`,
Visual Studio C++ build tools with the Windows SDK, and WebView2 installed.
From `web`:

```powershell
npm ci
npm run desktop:build
```

This creates an unsigned debug executable at
`%USERPROFILE%\.cache\orbyn-notes-native\target\debug\orbyn-notes.exe`.
Use `npm run desktop:build -- --release` for the release executable in `release`.
No installer, service, runtime installer or global configuration is created.
The script scopes Rust's PATH, target cache and public `VITE_ENGINE_URL` to the
build child process. The frontend is embedded from `web/dist`; running the EXE
does not require Vite or a production frontend server.

The configured existing engine endpoint is `http://127.0.0.1:8089`. Account
operations require that engine and its exact-origin CORS support for
`http://tauri.localhost`. There is no native HTTP proxy or credential bypass.
Changing the endpoint requires reviewing the build script and CSP together.
Do not change the native origin to work around CORS or storage failures.

## Boundary and close behavior

Only the local `main` webview receives the listed caption/event permissions.
External top-level navigation and all new-window requests are denied. The
caption commands are `finish_close` and the parameter-free `show_system_menu`;
both verify the injected calling window and its current local URL. No renderer
permission can destroy the window or access the filesystem or arbitrary processes.

The separate `open_external_url` command hands a deliberate HTTP(S) source action
to the Windows default browser. It independently checks the local injected caller,
rejects credentials, other schemes, ambiguous backslashes, raw control characters
and URLs over 8192 UTF16 units. It checks the live window again on its existing
COM STA thread before obtaining the owned handle. `ShellExecuteW` receives only a
validated URL, a fixed `open` verb and null argument/directory pointers. There is
no general shell or process command. OS acceptance means handoff only; it does not
mark a clip read or prove that a page loaded. Failure leaves the source copyable.
Other native platforms report opening unavailable until their adapter is built.
Browser builds use ordinary safe external anchors with `noopener noreferrer`.

Rust prevents every normal native close, then emits `notes-close-requested`
with `{ requestId }`. Repeated requests share the pending safe-integer ID.
The UI checks its current draft guards and outstanding operations, becomes
inert, then calls `finish_close({ requestId })`. Rust consumes the matching
request before destruction and restores it if destruction fails. There is no
timeout, deferred close replay, or force-close UI. Missing listeners fail closed.

The 44px custom caption uses actual native minimize, maximize and drag APIs.
Its title-region context menu uses the Windows system menu; selected Close
still follows the guarded native close path. Maximize-hover Snap layouts need
native hit testing and are not claimed by these custom controls. Keyboard
window-management behavior must be verified on the actual Windows build.

The CSP allows embedded scripts and WASM, local styles/fonts/assets and blob
downloads, Tauri local IPC, and the single configured engine origin. Inline
styles are allowed for the existing editor and theme styles; inline script and
general JavaScript evaluation are not enabled. Debug Vite access is restricted
to `127.0.0.1:5179`. No framework application menubar is created.

Primary implementation references: [Tauri configuration](https://v2.tauri.app/reference/config/),
[capabilities](https://v2.tauri.app/security/capabilities/),
[WebviewWindowBuilder](https://docs.rs/tauri/2.12.5/tauri/webview/struct.WebviewWindowBuilder.html),
and [application command permissions](https://docs.rs/tauri-build/2.7.4/tauri_build/struct.AppManifest.html).
The restricted source handoff follows [Microsoft ShellExecuteW](https://learn.microsoft.com/en-us/windows/win32/api/shellapi/nf-shellapi-shellexecutew).

## Trying a new local candidate

Save or explicitly discard any current draft, then close the older Notes window
normally before starting a newer executable. The stable app identity enforces a
single instance: opening another executable while the old process is running
focuses that existing process and does not replace its embedded frontend.
Keep the WebView profile; rebuilding does not require clearing keys or content.

For a candidate containing setup and search, check the optional Markdown setup,
then search real Notes, Clips and Study cards. Archived Clip results open internally
without changing read/archive state. A card result previews its exact direction
without recording a review. Journal and Trash must not appear in search. Exercise
Previous/Next, Back to search, a source change and a failed/paused operation; do not
interpret a pending or paused search as zero results. Confirm that returning to a
Note preserves its writing, selection and Undo history.

For a candidate containing Study settings, open Settings → Study before starting a
review, change a limit and choose Save changes, then reopen it. During a held
review, saving preferences must preserve the current card, revealed answer and
Undo history. Dirty Done, Escape and section changes must offer recovery; native
close must wait for an explicit save or discard and a new close request. Hovering
or focusing the Undo toast, or covering Study with Settings, pauses its remaining
five-second display time. Toast expiry does not remove review history.

For a motion candidate, check reveal and grading with both normal and reduced
motion. Early numeric input during the answer entrance must not grade or queue a
review; a fresh input after it settles can grade once. Open and close Settings
during a transition, then verify that the held card and Undo remain correct.
Changing accounts must remove private Study content immediately. Decorative
phases alone must not block native close; genuine unsaved work still does.

Browser automation against a disposable encrypted fixture does not qualify native
account entry, the OS file dialog, physical IME or Windows input behavior. A compiled
candidate is not a public release. Keep the previous executable until the new one
passes the required native checks. Setup/search introduces no new persistent corpus
schema, but rollback across a later schema change needs separate compatibility
verification. Never delete the app profile as a rollback step.
