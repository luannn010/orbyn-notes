# Architecture

The web beta implementation is local and has not been released.

Orbyn Notes will follow Orbyn Planner's shape: one web UI (React, Vite and TypeScript) shipped as a web app and as Tauri 2 apps for desktop and phone, on the device core from [orbyn-engine](https://github.com/orbyn-dev/orbyn-engine). Notes are records in their own zones, encrypted on the device before upload and synced through the engine. Each device keeps the whole library and works offline.

Rules that change go in this file with the change.

## Single-browser web beta

`web/` contains the React/Vite/TypeScript application. The UI consumes the
`NotesStore`, account and Markdown-transfer interfaces in `src/domain/contracts.ts`.
Domain, persistence and account behavior are independent of the presentation layer.
The structured document supports paragraphs, headings, lists, task items and links.
Search is a local projection of titles, textual document content and tags.

The engine revision and generated artifact provenance are pinned in
`web/engine-pin.json`. Generated TypeScript contracts and the browser WASM package
belong to the same engine revision. Engine code retains its MIT/Apache notices.
Authentication uses real OPAQUE and engine device keys; fixtures are test-only.
New accounts use the engine's existing invite and email-verification protocol.
Existing accounts use its sign-in, second-factor and pending-device protocol.

There are no Notes uploads in this beta. One account's whole local library is
held in an engine snapshot sealed with its device keys. IndexedDB holds the sealed
keys and snapshot with a non-extractable WebCrypto HMAC key used to derive the
wrapping secret. Plaintext notes and persistent bearer tokens are not stored in
localStorage, application caches or diagnostics. Reading, changing and committing
the sealed library occurs within one IndexedDB read/write transaction, with
revision checks so competing edits do not silently overwrite each other.

Saved means that the encrypted local write committed. A failed write retains the
visible draft, reports the failure and offers copy/retry. A revision conflict
preserves the saved version and the attempted draft; a conflict copy is a new note.
Other tabs re-read after a committed change. Sign-out broadcasts a local lock and
clears decrypted views; erasing notes is a separate account-scoped action.

A successful trusted account flow may retain a local-access grant, bound to the
stored account, device and signing public key. This grant lets an already-used
browser reopen its library offline. It is not an HTTP session or evidence of
current server authorization. Network bearer tokens remain in memory, pending
devices receive no local grant, and explicit sign-out removes the grant. Browser
data deletion removes the keys as well as the library; this beta has no synced or
recoverable server copy. Exported Markdown is readable outside the app.

First-device trust is rooted in the account server. If verification succeeds but
the local commit fails, the browser retains the original sealed signup keys for
password-authenticated recovery. A verification-attempt marker selects those
keys; it is not cryptographic proof that email verification succeeded. Recovery
still requires successful OPAQUE authentication and a trusted server response,
and never replaces an existing local device record. Established-device approval
requires the engine's verified ceremony. A sealed approval checkpoint is committed
before acknowledging its one-use code, so a failed subsequent write can retry.

The production service worker precaches a versioned application-shell allowlist:
HTML, JavaScript, CSS, fonts and WASM. It never caches account/API requests, notes,
sessions or generated exports. New workers wait for old windows to close rather
than replacing a running editor. IndexedDB schema changes require separate
compatibility review; changing the shell cache does not migrate user data.

Deferred: cross-device sync, attachments, Planner links, Study, Journal, Clipper,
public sharing, other native platforms and billing. Their visible navigation and
claims are omitted from the beta.

## Local Windows shell

The local Windows build embeds the existing web UI in Tauri2/WebView2 with a
44px custom caption. Native window controls and the system menu use narrowly
scoped commands for the local main window. Remote navigation and new windows
are denied. Normal close waits for the application draft/operation guards and a
matching close-request acknowledgement. The WebView profile remains separate
from browser profiles; builds do not migrate or erase it. This is an unsigned
local build, with no installer or public release qualification. See
[Windows build and boundaries](windows.md).

## Delivery boundary: encrypted-owners

Versioned library and Collections owners capture account/epoch authority for every commit. Migration and workspace erase use the pinned engine adaptation and preserve the previous encrypted snapshot on failure. Account identity, trust, approval checkpoints and unrelated zones are retained. These domain adapters precede workspace wiring in this delivery stack.

## Delivery boundary: journal-vault

Journal uses a separately protected envelope and private-form recovery. Account, epoch and genuine borrowed-owner closure revoke access before any late read or crypto result can publish. This clears live references and views, without claiming allocator zeroization or remote deletion. The Journal view is wired in a later slice.

## Delivery boundary: native-link-transport

The local main window alone may acknowledge bounded note intents or request validated HTTP(S) source opening. Commands independently verify the current injected caller URL. External URLs receive a fixed OS open verb with no argument expansion; arbitrary navigation and filesystem commands are unavailable.

## Delivery boundary: journal-interface

Journal removes unlocked content and populated credential forms synchronously on terminal owner revocation. Replaced or unmounted subscriptions cannot read dead owners or republish late crypto results. Stored writing remains encrypted and can reopen through a fresh eligible owner.
