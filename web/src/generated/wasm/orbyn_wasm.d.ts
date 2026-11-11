/* tslint:disable */
/* eslint-disable */

/**
 * An approval this trusted device started (steps 1, 3 and 4). Use it once.
 */
export class ApproverSession {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * The new device's key fingerprint, to show next to the digits.
     */
    deviceFingerprint(): string;
    /**
     * Step 3: reads `GET /v1/devices/approvals/{id}` and returns the
     * `ApprovalNonce` to send to `…/reveal`. Refused if the server shows
     * other keys than this session started with.
     */
    reveal(view_json: string): string;
    /**
     * The six digits to show after `reveal`.
     */
    sas(): string | undefined;
    /**
     * The `CreateApproval` to send (step 1).
     */
    readonly createJson: string;
}

/**
 * A device's keys. The secret halves stay in WebAssembly unless exported.
 */
export class DeviceKeys {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * The X25519 public key, base64url, as `NewDevice.agreement_key`.
     */
    agreementKey(): string;
    /**
     * New random keys.
     */
    static create(): DeviceKeys;
    /**
     * The keys sealed under `wrap_secret` (see the README), for the host to
     * store. The secret bytes themselves never leave WebAssembly.
     */
    export(wrap_secret: Uint8Array | number[]): Uint8Array;
    /**
     * Keys saved with `export` under the same wrapping secret.
     */
    static import(sealed: Uint8Array | number[], wrap_secret: Uint8Array | number[]): DeviceKeys;
    /**
     * The `signature` that lets this device cancel a scheduled account deletion, under
     * `orbyn/account-delete-cancel/v1`, over the account id, the device id and `signedAt`.
     */
    signAccountDeleteCancel(account_id: string, device_id: string, signed_at: number): Uint8Array;
    /**
     * The `signature` that lets this device schedule the deletion of the whole account, under
     * `orbyn/account-delete/v1`, over the account id, the device id and `signedAt` (Unix seconds,
     * within five minutes of the server's clock). Each signature is accepted once.
     */
    signAccountDelete(account_id: string, device_id: string, signed_at: number): Uint8Array;
    /**
     * The `device_signature` of `LoginFinish`, for the `login_id` from
     * `LoginStarted`.
     */
    signLogin(login_id: string): Uint8Array;
    /**
     * The `device_signature` of `RegisterFinish`.
     */
    signRegistration(email: string, upload: Uint8Array | number[]): Uint8Array;
    /**
     * The `signature` that lets this device change the account's second factor, under
     * `orbyn/totp-manage/v1`. `action` is `enrol`, `confirm` or `disable`; `code` is the six
     * digits for `confirm` and empty otherwise; `signedAt` is Unix seconds, within five minutes of
     * the server's clock. `accountId` and `deviceId` are the UUIDs of the session.
     */
    signTotpManage(account_id: string, device_id: string, action: string, code: string, signed_at: number): Uint8Array;
    /**
     * The `signature` of a `TrustedDeviceProof`. `signed_at` is Unix seconds.
     */
    signTrustedStart(email: string, credential_request: Uint8Array | number[], signed_at: number): Uint8Array;
    /**
     * Signs `message` under `context`.
     */
    sign(context: string, message: Uint8Array | number[]): Uint8Array;
    /**
     * The Ed25519 public key, base64url, as `NewDevice.signing_key`.
     */
    signingKey(): string;
}

/**
 * An approval this new device joined (steps 2 and 5). Use it once.
 */
export class DeviceSession {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * The six digits to show, once `GET /v1/devices/current` has the
     * approver's nonce. Refused if it does not match the commitment.
     */
    sas(view_json: string): string;
    /**
     * The `ApprovalNonce` to send to `…/nonce` (step 2).
     */
    readonly nonceJson: string;
}

/**
 * Sign-in between its two requests.
 */
export class PendingLogin {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * `LoginStart.credential_request`.
     */
    readonly request: Uint8Array;
}

/**
 * Sign-up between its two requests.
 */
export class PendingRegistration {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * `RegisterStart.registration_request`.
     */
    readonly request: Uint8Array;
}

/**
 * The sync engine for one device.
 */
export class SyncEngine {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Drops the batch waiting for an answer after any other refusal.
     */
    abandonUpload(zone: string): void;
    /**
     * Opens a `KeyEnvelopeList`, only from devices of `devices_json` this
     * device verifies; returns `{zones, refused}`. Call `retryQuarantined`
     * for each zone that got a key.
     */
    acceptEnvelopes(envelopes_json: string, devices_json: string): string;
    /**
     * Like `applyChanges`, for a page fetched with `since` (empty for a fetch
     * from the start). Required while a zone is fetched again after
     * `tokenExpired`; a page fetched with another token is refused.
     */
    applyChangesFrom(zone: string, since: string | null | undefined, page_json: string, now: number): string;
    /**
     * Applies one `ZoneChanges` page; returns what changed (`Applied`).
     */
    applyChanges(zone: string, page_json: string, now: number): string;
    /**
     * The next `UploadChanges`, or `undefined`. The same batch until its answer is applied.
     */
    buildUpload(zone: string): string | undefined;
    /**
     * Compares one `ZoneList` page with this device; returns `{stale, next}`.
     */
    checkZones(zones_json: string): string;
    /**
     * Step 4, only after the person tapped "They match" on this device:
     * the `ConfirmApproval` to send to `…/confirm`. Uses the session up.
     */
    confirmApproval(session: ApproverSession, devices_json: string): string;
    /**
     * Makes the zone's first key; returns its id.
     */
    createZoneKey(zone: string): string;
    /**
     * A new engine for this device (`SessionCreated.account_id` and `device_id`).
     */
    static create(keys: DeviceKeys, account_id: string, device_id: string): SyncEngine;
    /**
     * The `DeleteZone` body for `DELETE /v1/zones/{zone}`.
     */
    deleteZoneProof(zone: string): string;
    delete(zone: string, record_id: string): void;
    /**
     * A `PutKeyEnvelopes` sealing every key of the zone to each device of
     * `devices_json` (a `DeviceList`) this device verifies, other than itself.
     */
    envelopesFor(zone: string, devices_json: string): string;
    /**
     * Step 5, only after the person confirmed on this device (`typed` is the
     * approver's digits if the person typed them). Checks everything, then
     * trusts the approver and the devices it endorsed; returns the digits to
     * send to `…/code`. Uses the session up, also on failure.
     */
    finishApproval(session: DeviceSession, view_json: string, typed: string | null | undefined, now_secs: number): string;
    /**
     * A live record as an `Item`, or `undefined`.
     */
    item(zone: string, record_id: string): string | undefined;
    /**
     * Step 2 on the new device: joins the approval of `GET /v1/devices/current`.
     */
    joinApproval(view_json: string, now_secs: number): DeviceSession;
    /**
     * Trusts a device the person checked another way (keys base64url).
     */
    pinDevice(device_id: string, signing_key: string, agreement_key: string): void;
    /**
     * Where to fetch the chain from (`GET /v1/keychain/protection?from=`): the verified head's
     * sequence, or the one an approver vouched for, or 1.
     */
    protectionFrom(): number;
    /**
     * What this device knows about the protection level, as `{state, level}`: `verified` (the
     * whole chain was walked to the server's head and nothing stopped it, from an anchor this
     * device trusts: the only state in which Standard may be acted on, for escrow),
     * `provisional` (a verified setting that may not be the newest: show it as a guess), or
     * `unknown` (no level, and not Standard).
     */
    protectionLevel(): string;
    /**
     * The sequence of the newest verified setting, 0 for none.
     */
    protectionSeq(): number;
    /**
     * Forgets whole local zones, including their keys and queued uploads.
     * Takes a JSON array (at most 64 KiB / 1000 names); returns the sorted JSON
     * array of names actually removed. Invalid input changes nothing. The host
     * authorizes the names, fences late work and persists the snapshot. This
     * performs no remote deletion and leaves identity/trust/other zones intact.
     */
    purgeLocalZones(zones_json: string): string;
    /**
     * The zone's quarantined records, as `[{"record_id": ..., "reason": ...}]`
     * with the reason `missing_zone_key`, `open_failed` or `invalid_record`.
     * Never their bytes.
     */
    quarantined(zone: string): string;
    /**
     * A live record as `{"record_type": ..., "fields": Fields}`, or `undefined`.
     */
    record(zone: string, record_id: string): string | undefined;
    /**
     * The body that signs `level` as the link after the server's newest link `head_json` (a
     * `ProtectionLink`), even one this device could not verify: it moves the chain past a link
     * signed by a removed device or a setting this device refused. The app must show the person
     * the setting and ask before calling it, and never sign on its own.
     */
    resignProtection(level: string, head_json: string, now_secs: number): string;
    /**
     * An engine from a `snapshot` sealed under the same wrapping secret.
     */
    static restore(keys: DeviceKeys, sealed: Uint8Array | number[], wrap_secret: Uint8Array | number[], now: number): SyncEngine;
    /**
     * Tries quarantined records again; returns what changed (`Applied`).
     */
    retryQuarantined(zone: string, now: number): string;
    /**
     * Replaces the zone's current key with a new one signed by this device;
     * returns its id. Send it with `envelopesFor`.
     */
    rotateZoneKey(zone: string): string;
    /**
     * The `SetProtection` body for `POST /v1/keychain/protection`: `level` (`standard` or
     * `advanced`) as the next link of the chain this device verified, signed now.
     */
    signProtection(level: string, now_secs: number): string;
    /**
     * The `RemoveDevice` body that removes `device_json`, signed by this device.
     */
    signRemoval(device_json: string): string;
    /**
     * How many records `restore` found with a newest stamp more than an hour
     * ahead of its `now`. They were kept but did not move the clock; log a
     * non-zero count.
     */
    skippedFutureStamps(): number;
    /**
     * The engine's state sealed under `wrap_secret`, bound to this device's
     * keys. Zone keys inside it never leave WebAssembly in the clear.
     */
    snapshot(wrap_secret: Uint8Array | number[]): Uint8Array;
    /**
     * Stages a new `Item`, or an edit of `before_json`.
     */
    stageItem(zone: string, item_json: string, before_json: string | null | undefined, now: number): void;
    /**
     * Stages already stamped `Fields`.
     */
    stage(zone: string, record_type: string, record_id: string, fields_json: string): void;
    /**
     * Step 1 on a trusted device: starts approving `device_json` (a pending
     * `Device` from `GET /v1/devices`). `now_secs` is Unix seconds.
     */
    startApproval(device_json: string, now_secs: number): ApproverSession;
    /**
     * Takes a record out of the trash; returns it, or `undefined`.
     */
    takeFromTrash(zone: string, record_id: string): string | undefined;
    /**
     * A `Stamp` for an edit made at `edit_at` (milliseconds), which may be
     * earlier than `now`: an edit queued while the app was closed. The clock's
     * rules hold: the stamp is never earlier than the last one this device
     * issued or saw. An `edit_at` after `now` is taken as `now`, silently.
     */
    tickAt(edit_at: number, now: number): string;
    /**
     * A `Stamp` for a new edit at `now` (milliseconds).
     */
    tick(now: number): string;
    /**
     * Call on a `token_expired` answer to a fetch or an upload: the token is
     * forgotten, so `token(zone)` is empty and the zone is fetched from the start.
     */
    tokenExpired(zone: string): void;
    /**
     * The zone's change token for `?since=`, or `undefined` to start from the beginning.
     */
    token(zone: string): string | undefined;
    /**
     * Records another device deleted while this one had edits, as
     * `{record_id: Trashed}`.
     */
    trash(zone: string): string;
    /**
     * Applies a 409 `RecordChanged`; returns what changed (`Applied`).
     */
    uploadConflicted(zone: string, conflict_json: string, now: number): string;
    /**
     * Applies an `UploadResult`.
     */
    uploadSucceeded(zone: string, result_json: string): void;
    /**
     * The device ids of `devices_json` this device verifies by approval chain.
     */
    verifyDevices(devices_json: string): string;
    /**
     * Checks a `ProtectionChain` (from `GET /v1/keychain/protection?from=` `protectionFrom()`,
     * page by page, with its `more` flag) against the devices of `devices_json` this device
     * verifies, and moves the verified head forward over every link a trusted device signed or
     * committed to. Returns `{seq, state, level, stopped}`; `state` is `verified`, `provisional`
     * or `unknown` (see `protectionLevel`). Throws `protection_rollback` or `protection_fork`,
     * changing nothing.
     */
    verifyProtection(chain_json: string, devices_json: string): string;
}

/**
 * Finishes sign-in with `LoginStarted.credential_response`; returns
 * `LoginFinish.credential_finalization`. A wrong password fails here with
 * `auth_failed`. Works once.
 */
export function finishLogin(pending: PendingLogin, password: Uint8Array | number[], response: Uint8Array | number[]): Uint8Array;

/**
 * Finishes sign-up with `RegisterStarted.registration_response`; returns
 * `RegisterFinish.registration_upload`. Works once.
 */
export function finishRegistration(pending: PendingRegistration, password: Uint8Array | number[], response: Uint8Array | number[]): Uint8Array;

/**
 * Reads an `Item` back from `Fields`, checking it fully.
 */
export function itemFromFields(id: string, fields_json: string): string;

/**
 * Every field of `item_json` (an `Item`), or only what changed since
 * `before_json`, stamped with `stamp_json` (a `Stamp`). Returns `Fields`.
 */
export function itemToFields(item_json: string, before_json: string | null | undefined, stamp_json: string): string;

/**
 * Lowercases and trims an email, or `undefined` when it is not one.
 */
export function normalizeEmail(email: string): string | undefined;

/**
 * Starts sign-in.
 */
export function startLogin(password: Uint8Array | number[]): PendingLogin;

/**
 * Starts sign-up.
 */
export function startRegistration(password: Uint8Array | number[]): PendingRegistration;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_approversession_free: (a: number, b: number) => void;
    readonly __wbg_devicekeys_free: (a: number, b: number) => void;
    readonly __wbg_devicesession_free: (a: number, b: number) => void;
    readonly __wbg_pendinglogin_free: (a: number, b: number) => void;
    readonly __wbg_pendingregistration_free: (a: number, b: number) => void;
    readonly __wbg_syncengine_free: (a: number, b: number) => void;
    readonly approversession_createJson: (a: number, b: number) => void;
    readonly approversession_deviceFingerprint: (a: number, b: number) => void;
    readonly approversession_reveal: (a: number, b: number, c: number, d: number) => void;
    readonly approversession_sas: (a: number, b: number) => void;
    readonly devicekeys_agreementKey: (a: number, b: number) => void;
    readonly devicekeys_create: (a: number) => void;
    readonly devicekeys_export: (a: number, b: number, c: number, d: number) => void;
    readonly devicekeys_import: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly devicekeys_sign: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly devicekeys_signAccountDelete: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly devicekeys_signAccountDeleteCancel: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly devicekeys_signLogin: (a: number, b: number, c: number, d: number) => void;
    readonly devicekeys_signRegistration: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly devicekeys_signTotpManage: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number) => void;
    readonly devicekeys_signTrustedStart: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly devicekeys_signingKey: (a: number, b: number) => void;
    readonly devicesession_nonceJson: (a: number, b: number) => void;
    readonly devicesession_sas: (a: number, b: number, c: number, d: number) => void;
    readonly finishLogin: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly finishRegistration: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly itemFromFields: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly itemToFields: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly normalizeEmail: (a: number, b: number, c: number) => void;
    readonly pendinglogin_request: (a: number, b: number) => void;
    readonly pendingregistration_request: (a: number, b: number) => void;
    readonly startLogin: (a: number, b: number, c: number) => void;
    readonly startRegistration: (a: number, b: number, c: number) => void;
    readonly syncengine_abandonUpload: (a: number, b: number, c: number, d: number) => void;
    readonly syncengine_acceptEnvelopes: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly syncengine_applyChanges: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly syncengine_applyChangesFrom: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => void;
    readonly syncengine_buildUpload: (a: number, b: number, c: number, d: number) => void;
    readonly syncengine_checkZones: (a: number, b: number, c: number, d: number) => void;
    readonly syncengine_confirmApproval: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly syncengine_create: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly syncengine_createZoneKey: (a: number, b: number, c: number, d: number) => void;
    readonly syncengine_delete: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly syncengine_deleteZoneProof: (a: number, b: number, c: number, d: number) => void;
    readonly syncengine_envelopesFor: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly syncengine_finishApproval: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => void;
    readonly syncengine_item: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly syncengine_joinApproval: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly syncengine_pinDevice: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => void;
    readonly syncengine_protectionFrom: (a: number) => number;
    readonly syncengine_protectionLevel: (a: number, b: number) => void;
    readonly syncengine_protectionSeq: (a: number) => number;
    readonly syncengine_purgeLocalZones: (a: number, b: number, c: number, d: number) => void;
    readonly syncengine_quarantined: (a: number, b: number, c: number, d: number) => void;
    readonly syncengine_record: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly syncengine_resignProtection: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly syncengine_restore: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly syncengine_retryQuarantined: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly syncengine_rotateZoneKey: (a: number, b: number, c: number, d: number) => void;
    readonly syncengine_signProtection: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly syncengine_signRemoval: (a: number, b: number, c: number, d: number) => void;
    readonly syncengine_skippedFutureStamps: (a: number) => number;
    readonly syncengine_snapshot: (a: number, b: number, c: number, d: number) => void;
    readonly syncengine_stage: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number) => void;
    readonly syncengine_stageItem: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => void;
    readonly syncengine_startApproval: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly syncengine_takeFromTrash: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly syncengine_tick: (a: number, b: number, c: number) => void;
    readonly syncengine_tickAt: (a: number, b: number, c: number, d: number) => void;
    readonly syncengine_token: (a: number, b: number, c: number, d: number) => void;
    readonly syncengine_tokenExpired: (a: number, b: number, c: number, d: number) => void;
    readonly syncengine_trash: (a: number, b: number, c: number, d: number) => void;
    readonly syncengine_uploadConflicted: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly syncengine_uploadSucceeded: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly syncengine_verifyDevices: (a: number, b: number, c: number, d: number) => void;
    readonly syncengine_verifyProtection: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly __wbindgen_export: (a: number) => void;
    readonly __wbindgen_export2: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_add_to_stack_pointer: (a: number) => number;
    readonly __wbindgen_export3: (a: number, b: number, c: number) => void;
    readonly __wbindgen_export4: (a: number) => void;
    readonly __wbindgen_export5: (a: number, b: number) => number;
    readonly __wbindgen_export6: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
