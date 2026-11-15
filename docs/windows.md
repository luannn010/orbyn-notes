# Local Windows shell

The Tauri2/WebView2 shell bundles the web UI and WASM. Its stable identity is
`com.kinqsradio.orbyn.notes`; the desktop profile is separate from browser Notes.
Use without an account opens the existing isolated encrypted local workspace and
remembers that choice. No backend or internet connection is required, and browser
or signed-in data is never copied into it automatically.

## Build

Use Windows with Node24, Rust1.90+ MSVC, Visual Studio C++/Windows SDK and WebView2.
From `web`, run `npm ci` then `npm run desktop:build`. This produces an unsigned
local debug executable and NSIS test installer in the user-scoped native target
cache. Use `npm run desktop:build -- --release` for release-mode compilation.
The script scopes Rust PATH/cache and an empty `VITE_ENGINE_URL` to the child.
Frontend/WASM assets are embedded; no Vite server is required at runtime.
Building does not install a runtime, service or Windows startup registration.
Account/server integration is outside this local build; changing endpoint/origin
requires CSP and storage-compatibility review rather than a CORS workaround.

## Notes and Quick note

- Ctrl+N: blank main-pane note, title focus; Enter moves to its body. Empty drafts
  never add a record, count or Trash entry. First text or a starter is saved locally.
- Ctrl+Shift+N: open/focus the native400×204 Quick note, initially always on top.
  It works from another app while Notes runs in the tray. If OS registration fails,
  the app reports that state; the Notes menu and tray still open capture.
- Quick note has plain text, tags and safe links, without starters. Escape/close
  waits for a successful save or explicit copy of failed text. Ctrl+Enter/Open in
  Notes requires the current saved revision and admitted main-window navigation.
- Closing main hides it and releases its close freeze. Menu/tray Quit Notes probes
  both windows and cancels rather than dropping unsaved work. Quit before replacing
  an executable; single-instance activation otherwise focuses the old process.

Reference: Notes artifact b66f1d8, new-note/new-note-states/new-note-starter,
quick-note/quick-note-states/new-note-phone. Planner links remain Planned.
Undo of an already saved starter clears that same note but retains its record.

## Native boundaries

Only verified local main/quick webviews receive their explicit capabilities.
External navigation/arbitrary new windows are denied. Close request IDs are scoped
per label; events target only that window, and listeners use Window.listen.
Missing listeners fail closed. Native creation leaves synchronous event/command
callbacks because WebView2 can deadlock there on Windows.

Main alone can initiate coordinated Quit and owner transitions. Quit seals new
capture admission; nonce-bound replies, cancellation and timeout preserve drafts.
Handoff transmits only owner scope, note ID and UUID token. Both native and
renderer sides reject stale acknowledgments. Signed-in replacement and local-mode
changes require Quick to close first under its normal save/copy guards.

Markdown, JSON, CSV and binary ZIP export use native save dialogs. Destinations are
opaque one-use grants with expiry, payload bounds and owner/freshness checks; paths
are not exposed to the renderer. Cancellation does not claim a successful save.
The restricted external-source command opens validated HTTP(S) URLs in the system
browser after checking caller, URL and live window; it is not a shell interface.
Browser builds retain ordinary safe downloads and external anchors.

Packaged CSP allows local assets, styles/fonts/WASM and local IPC, with no engine
origin. Development adds only the configured loopback Vite endpoint. There are no
renderer filesystem/process/destroy/global-shortcut permissions.

Primary APIs: [global shortcuts](https://v2.tauri.app/plugin/global-shortcut/),
[tray](https://v2.tauri.app/learn/system-tray/),
[capabilities](https://v2.tauri.app/security/capabilities/),
[WebviewWindowBuilder](https://docs.rs/tauri/2.12.5/tauri/webview/struct.WebviewWindowBuilder.html).

## Trying a new local candidate

Save or copy any current drafts, then use Menu → Quit Notes (or the tray menu)
before starting a newer executable. Closing main only hides it for Quick note. The stable app identity enforces a
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
