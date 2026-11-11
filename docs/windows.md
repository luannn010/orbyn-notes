# Local Windows shell

The native shell embeds the existing web application in WebView2. It keeps the
same encryption, IndexedDB and AccountService implementations. Its data belongs
to the stable app identity `com.kinqsradio.orbyn.notes` and is separate from web
browser profiles. Browser notes and account sessions are not migrated.

## Build

Use Windows with Node 24, the Rust MSVC toolchain in `%USERPROFILE%\.cargo\bin`,
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
External top-level navigation and all new-window requests are denied. The only
custom commands are `finish_close` and the parameter-free `show_system_menu`;
both verify the injected calling window and its current local URL. No renderer
permission can destroy the window or access the filesystem, shell or process.

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
