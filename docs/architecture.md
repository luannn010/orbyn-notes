# Architecture

The web beta implementation is local and has not been released.

Orbyn Notes will follow Orbyn Planner's shape: one web UI (React, Vite and TypeScript) shipped as a web app and as Tauri 2 apps for desktop and phone, on the device core from [orbyn-engine](https://github.com/orbyn-dev/orbyn-engine). Notes are records in their own zones, encrypted on the device before upload and synced through the engine. Each device keeps the whole library and works offline.

Rules that change go in this file with the change.

## Single-browser web beta

`web/` contains the React/Vite/TypeScript application. The UI consumes the
`NotesStore`, account and Markdown-transfer interfaces in `src/domain/contracts.ts`,
plus the library and collections interfaces in their owning modules.
Domain, persistence and account behavior are independent of the presentation layer.
The structured document supports paragraphs, headings, lists, task items and links.
Search projects active Note titles, textual content and tags, saved Clips, and
actual Study card directions. Its integration/native qualification remains open.

The engine revision and generated artifact provenance are pinned in
`web/engine-pin.json`. Generated TypeScript contracts and the browser WASM package
use the recorded engine base. The current WASM build adds the reviewed local-zone
purge source patch recorded separately in that pin; it is not presented as part of
the base commit. Engine code retains its MIT/Apache notices.
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

## Library and local collections

The library writer owns `notes-local` and `notes-library-v1` in the same encrypted
snapshot transaction. Its catalog records pins, exact tag names/colors, bounded
immutable note versions and mutation receipts. Renaming or merging tags changes
membership atomically; restoring a version restores its title/document while
retaining current tags and pin state. Trash has explicit restore and empty actions;
the current implementation does not automatically purge notes after 30 days.

The account-scoped `CollectionsStore` owns `notes-collections-v1/workspace`. Study,
the sealed Journal envelope and Clips share its epoch/revision CAS and one writer.
Collection schema3 supports anchored Study sources alongside legacy sources;
schema2 introduced Clips. Strict schema1 or schema2 validation precedes pure
read normalization; the first successful write persists schema3. A read alone
does not rewrite an existing record. Unknown versions, wrong authenticated
record types and corrupt payloads fail closed. The size cap adds exactly
the empty Clips field's UTF8 overhead to the schema1 cap, preserving readability
for valid legacy payloads at that boundary. Writes still reject capacity overflow,
including growth in a revision's serialized digits, without changing storage.

Study persists decks, Basic/Reversed/Cloze entries, derived cards, review events
and preferences. Its current scheduler is versioned `orbyn-interval-v1`. Grades
and Undo use durable event identities and revision checks. Daily admission uses
the stored local timezone and day-start boundary. CSV transfer handles the
rendered front/back text and tags as independent rows. Import creates new Basic
cards; original card types, scheduling history and source anchors are not
restored. CSV is not a complete Study backup or Anki history transfer.

The Study settings form borrows that same account-lifetime Collections owner.
An explicit Save patches only edited preference keys under epoch/revision checks;
conflicts retain raw edits and require a deliberate reload before retry. An
unconfirmed save is checked by reading the actual saved values, without replaying
the write. Dirty forms guard local navigation and native close. Owner closure,
account lock and epoch replacement clear their draft and pending continuations.
Caps apply to the next normal queue and do not replace a held queue or its captured
answer time. Due repetitions of already admitted cards and explicit Study more can
exceed the caps. The day-start hour changes derived daily grouping, leaving review
timestamps, schedules, stored timezone and algorithm unchanged. Visibility changes
follow a committed snapshot. The Undo toast uses a separate monotonic presentation
clock, paused by hover, focus, hidden documents or covering UI; expiry changes no
review event or Undo authority. Reminder delivery and connected Study services
remain incomplete.

Review motion retains only scoped card/entry IDs and revision scalars. Outgoing
text is resolved from the current authorized snapshot, and an edit, removal or
scope change retires the phase. Reveal timestamps and confirmed review history
advance through their existing domain actions; visual completion never writes
either. Grading is admitted only after the answer has finished entering. The
toast's separate exit phase does not create a second dwell clock or an Undo
deadline.

Study subscribes to internal lock, genuine owner-close and observed epoch events
before its first read. These callbacks synchronously clear private projections
and retire pending read/commit generations. Recovery explicitly asks the parent
to open a fresh owner under the existing navigation guards, rather than retrying
a closed handle. Another owner's erase can commit before this owner reads the
new epoch; synchronous clearing is guaranteed at local observation, not at an
unobserved remote commit. Cold-loader tickets belong to that same owner lifetime.

Study source creation uses the existing library snapshot writer to commit the
entry, derived cards, source anchor and retry receipt atomically, with both
library and Collections revision checks. Library metadata schema2 adds anchors
and separate bounded source receipts; strict schema1 migration adds exactly the
two empty fields' serialized overhead to its size cap. No fourth zone or
IndexedDB schema change is introduced. Anchor creation lineage survives receipt
pruning, and its current mapped revision is separate from its creation revision.

The editor supplies actual ProseMirror steps from an acknowledged saved base.
The writer replays and verifies those steps against the exact saved and final
documents before mapping attached passages. Supported surrounding edits and
formatting retain attachment; replacing selected content, including identical
text, detaches it. Unproved document or history replacements also detach it.
There is no quote-search fallback. Proof and combined anchor-mapping work have
explicit bounds; exceeding them requires an explicit replacement decision.
That confirmed recovery uses `NotesLibrary.replaceDocument`, which invalidates
attached sources even when the final document bytes are unchanged. It is a
distinct writer operation; ordinary metadata saves cannot stand in for it.
Source resolution reads the authenticated note, library and Collections state
together and rechecks freshness before the target editor validates and highlights
the passage. Unavailable and legacy sources cannot claim a verified highlight.
Create Undo has a separate stable retry identity and the original five-second
admission deadline; changed cards, schedules or anchors reject Undo. The source
UI and remaining design-frame qualification are still being verified locally.

Journal uses a separate passphrase and non-extractable AES256-GCM key derived with
PBKDF2-SHA256, 600000 iterations. Fresh IVs and account/collection-epoch associated
data bind each envelope. General Notes search, history and Markdown export do not
include Journal plaintext. The vault removes its plaintext projection before
awaiting lock encryption and checks overdue absence on return as well as on timer
delivery. Unsaved body, habit-form and link-form intent can be retained in paired
encrypted recovery within that window; reopening requires real passphrase proof.
No browser restart recovery of these uncommitted forms is promised. JavaScript
strings cannot be guaranteed to have been physically erased from process memory.
Exports are deliberate readable files with manual-recovery limits.

Clips stores validated HTTP(S) links and optional actual pasted text. It does not
fetch a page as part of local Save link. Duplicate comparison uses a separate
canonical URL; the validated original URL is retained. Read/read-later/archive
flags are independent. Prepared mutation input is captured before asynchronous
work and fingerprinted, with stable operation identities retained for explicit
unknown-result reconciliation. Durable bounded receipts distinguish changed and
no-op operations. A receipt-only no-op increments the collections revision while
leaving the clip revision unchanged. Create Undo requires the original unmodified
clip and expires five seconds after atomic admission, without restarting on replay.
Clips export includes complete JSON, readable items and recovery guidance.

Each store captures the account lock generation. Same-identity reauthentication,
sign-out, closure and collection epoch changes revoke old asynchronous work.
Views clear held drafts and generated downloads on invalidation. A previously
prepared operation is never silently adopted into a new collection epoch.

Whole-workspace erase validates the existing owned records and captures their
revisions before purging exactly the three content zone owners. The producer
purge removes their keys and cached uploads as well as current records. Fresh
keys, empty replacement records and new epochs commit atomically in the same
IndexedDB transaction. Account/device identity, trust/protection, the separate
approval checkpoint and unrelated zones remain. Failure preserves the previous
snapshot. Replacement stamps retain the required round-trip clock watermark
under the producer's normal future-stamp policy; the generic bare purge API has
only a live-instance clock guarantee. External exports and other copies are not
wiped by local erase.

## Windows shell and remaining scope

The local Windows build embeds the web UI in a Tauri2 shell with custom caption
controls and guarded close. Its WebView profile is separate from a normal browser
profile. The restricted source-opening command hands validated HTTP(S) destinations
to the OS; other native navigation and new-window requests remain denied. See
[Windows boundaries and build instructions](windows.md). Local builds do not
constitute a public release or a completed release qualification.

Still incomplete: cross-device sync, attachments, Planner linking, per-note
protected locks, browser extension capture and extraction, reader highlights and
the clip-to-note bridge, full Study source-selection qualification, FSRS/Anki transfer,
agent integrations, public sharing, other native platforms and billing. The
local module slices above do not qualify every approved design frame. Unsupported
integration states must remain explicit; fixtures and generated API types do not
count as working services.
