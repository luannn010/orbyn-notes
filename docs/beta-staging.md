# Web beta staging

This is a single-browser Notes beta. Notes are encrypted in this browser and are
not uploaded or synced. Clearing site data removes both the notes and the keys
needed to open them. Export Markdown before clearing data or changing browsers.

## Build and test

From `web/`, on Node.js 24:

```sh
npm ci
npm run check
npm test
npm run build
```

The foundational account/storage layer can also be checked with
`npm run check:data`, `npm run test:data` and `npm run verify:engine`.
Ordinary unit runs exclude the opt-in real-backend test and Playwright journey.
For the latter, serve the production build on loopback and provide
`NOTES_E2E_URL`, `NOTES_E2E_INVITE` (a fresh synthetic code) and
`NOTES_E2E_MAILBOX_DIR` (a disposable TLS mailbox directory), then run
`npm run test:e2e`. Set `NOTES_E2E_SCALE=1` for the 1,000-note profile.
The account test separately requires `NOTES_TEST_ENGINE_URL`,
`NOTES_TEST_INVITE` and `NOTES_TEST_MAILBOX`. Both harnesses restrict the API
to loopback; never use real tester credentials or production mailboxes.
Keep browser profiles, downloaded exports and mailbox contents out of CI artifacts.
Use a fresh disposable database for repeated qualification rather than altering
the engine's rate-limit policy or deleting rate-limit history.

Set `VITE_ENGINE_URL` to the approved staging engine origin **before** building.
Vite configuration is part of the built output. An absent engine must show an
explicit unavailable state; never substitute test authentication in a beta build.
Keep production and staging account services separate. Do not put credentials or
operator tokens in `VITE_` variables, which are public in the browser bundle.

## Host the build

Serve `web/dist/` through HTTPS. Keep the Notes origin stable: browser storage and
keys are bound to it. Configure the engine's allowed origins for that exact HTTPS
origin. Serve the WebAssembly module as `application/wasm`; allow its compilation
with `script-src 'self' 'wasm-unsafe-eval'`, without unrestricted `unsafe-eval`.
Restrict `connect-src` to the approved account API, bundle local fonts and assets,
and disallow framing and object embeds. Test the final policy against the actual
build before inviting anyone.

Serve versioned assets with immutable caching and the entry document with
revalidation. The service worker may cache the application shell only: never
account responses, session tokens, decrypted notes or exports. An update must
retain the local database and must not reload over unsaved edits.

Keep the previous build available for rollback. Database changes require a
compatible reader or an explicit migration and recovery procedure before rollout;
rolling back JavaScript alone does not roll back browser data.

## Shared account invites

Leave the engine in invite mode (`ORBYN_SIGNUP=invite`). Existing Orbyn accounts
can sign in; invitation codes gate new accounts, not Notes-specific admission.
Provision codes with the engine's existing operator CLI:

```sh
orbyn invite create --count 5 --expires-days 14 --label notes-beta
orbyn invite list
orbyn invite revoke <short-id>
```

The command prints a code once. Keep it out of logs, tickets and screenshots;
send it privately through the operator's existing channel. `list` never returns
the code. Do not automate distribution or add a request-invite portal for this
beta. Use real mail delivery for testers, not staging log-codes mode. Generating
codes, sending them and deploying remain operator actions after review.

## Before inviting testers

- Exercise sign-up, email verification, an existing account and pending-device
  handling against the exact pinned engine build and real delivery configuration.
- Check invalid, expired, revoked and used invites, network retry, throttling and
  a code redeemed while another sign-up is waiting.
- Create a note, reload, restart the browser and reopen offline. Search, tag,
  trash, restore and export it. Confirm the export can be imported separately.
- Verify failed writes preserve the visible draft and never show Saved. Test two
  tabs and account switching without disclosing or overwriting another library.
- Inspect IndexedDB, localStorage, application caches and diagnostics using
  synthetic content; no plaintext note payload may be retained there.
- Verify Light, Dark, Dim, keyboard navigation, reduced motion and narrow screens.
- Record the tested source revision, engine pin, built-file hashes, test profile,
  remaining limitations and independent security-review result.

No sync, attachments, sharing, Study, Journal, Clipper, native app or payment
capability is part of this beta. Do not describe any of them as shipped.
