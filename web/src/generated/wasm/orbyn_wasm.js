/* @ts-self-types="./orbyn_wasm.d.ts" */

/**
 * An approval this trusted device started (steps 1, 3 and 4). Use it once.
 */
export class ApproverSession {
    static __wrap(ptr) {
        const obj = Object.create(ApproverSession.prototype);
        obj.__wbg_ptr = ptr;
        ApproverSessionFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        ApproverSessionFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_approversession_free(ptr, 0);
    }
    /**
     * The `CreateApproval` to send (step 1).
     * @returns {string}
     */
    get createJson() {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16) >>> 0;
            wasm.approversession_createJson(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export3(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * The new device's key fingerprint, to show next to the digits.
     * @returns {string}
     */
    deviceFingerprint() {
        let deferred2_0;
        let deferred2_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16) >>> 0;
            wasm.approversession_deviceFingerprint(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            var ptr1 = r0;
            var len1 = r1;
            if (r3) {
                ptr1 = 0; len1 = 0;
                throw takeFromExternrefTable0(r2);
            }
            deferred2_0 = ptr1;
            deferred2_1 = len1;
            return getStringFromWasm0(ptr1, len1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export3(deferred2_0, deferred2_1, 1);
        }
    }
    /**
     * Step 3: reads `GET /v1/devices/approvals/{id}` and returns the
     * `ApprovalNonce` to send to `…/reveal`. Refused if the server shows
     * other keys than this session started with.
     * @param {string} view_json
     * @returns {string}
     */
    reveal(view_json) {
        let deferred3_0;
        let deferred3_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16) >>> 0;
            const ptr0 = passStringToWasm0(view_json, wasm.__wbindgen_export5, wasm.__wbindgen_export6);
            const len0 = WASM_VECTOR_LEN;
            wasm.approversession_reveal(retptr, this.__wbg_ptr, ptr0, len0);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            var ptr2 = r0;
            var len2 = r1;
            if (r3) {
                ptr2 = 0; len2 = 0;
                throw takeFromExternrefTable0(r2);
            }
            deferred3_0 = ptr2;
            deferred3_1 = len2;
            return getStringFromWasm0(ptr2, len2);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export3(deferred3_0, deferred3_1, 1);
        }
    }
    /**
     * The six digits to show after `reveal`.
     * @returns {string | undefined}
     */
    sas() {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16) >>> 0;
            wasm.approversession_sas(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            if (r3) {
                throw takeFromExternrefTable0(r2);
            }
            let v1;
            if (r0 !== 0) {
                v1 = getStringFromWasm0(r0, r1);
                wasm.__wbindgen_export3(r0, r1 * 1, 1);
            }
            return v1;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
}
if (Symbol.dispose) ApproverSession.prototype[Symbol.dispose] = ApproverSession.prototype.free;

/**
 * A device's keys. The secret halves stay in WebAssembly unless exported.
 */
export class DeviceKeys {
    static __wrap(ptr) {
        const obj = Object.create(DeviceKeys.prototype);
        obj.__wbg_ptr = ptr;
        DeviceKeysFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        DeviceKeysFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_devicekeys_free(ptr, 0);
    }
    /**
     * The X25519 public key, base64url, as `NewDevice.agreement_key`.
     * @returns {string}
     */
    agreementKey() {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16) >>> 0;
            wasm.devicekeys_agreementKey(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export3(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * New random keys.
     * @returns {DeviceKeys}
     */
    static create() {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16) >>> 0;
            wasm.devicekeys_create(retptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            if (r2) {
                throw takeFromExternrefTable0(r1);
            }
            return DeviceKeys.__wrap(r0);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * The keys sealed under `wrap_secret` (see the README), for the host to
     * store. The secret bytes themselves never leave WebAssembly.
     * @param {Uint8Array | number[]} wrap_secret
     * @returns {Uint8Array}
     */
    export(wrap_secret) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16) >>> 0;
            const ptr0 = passArray8ToWasm0(wrap_secret, wasm.__wbindgen_export5);
            const len0 = WASM_VECTOR_LEN;
            wasm.devicekeys_export(retptr, this.__wbg_ptr, ptr0, len0);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            if (r3) {
                throw takeFromExternrefTable0(r2);
            }
            var v2 = getArrayU8FromWasm0(r0, r1).slice();
            wasm.__wbindgen_export3(r0, r1 * 1, 1);
            return v2;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Keys saved with `export` under the same wrapping secret.
     * @param {Uint8Array | number[]} sealed
     * @param {Uint8Array | number[]} wrap_secret
     * @returns {DeviceKeys}
     */
    static import(sealed, wrap_secret) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16) >>> 0;
            let ptr0, len0, ptr1, len1;
            try {
                ptr0 = passArray8ToWasm0(sealed, wasm.__wbindgen_export5);
                len0 = WASM_VECTOR_LEN;
                ptr1 = passArray8ToWasm0(wrap_secret, wasm.__wbindgen_export5);
                len1 = WASM_VECTOR_LEN;
            } catch (e) {
                if (ptr1) { wasm.__wbindgen_export3(ptr1, len1 * 1, 1); }
                if (ptr0) { wasm.__wbindgen_export3(ptr0, len0 * 1, 1); }
                throw e;
            }
            wasm.devicekeys_import(retptr, ptr0, len0, ptr1, len1);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            if (r2) {
                throw takeFromExternrefTable0(r1);
            }
            return DeviceKeys.__wrap(r0);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * The `signature` that lets this device cancel a scheduled account deletion, under
     * `orbyn/account-delete-cancel/v1`, over the account id, the device id and `signedAt`.
     * @param {string} account_id
     * @param {string} device_id
     * @param {number} signed_at
     * @returns {Uint8Array}
     */
    signAccountDeleteCancel(account_id, device_id, signed_at) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16) >>> 0;
            const val3 = +signed_at;
            let ptr0, len0, ptr1, len1;
            try {
                ptr0 = passStringToWasm0(account_id, wasm.__wbindgen_export5, wasm.__wbindgen_export6);
                len0 = WASM_VECTOR_LEN;
                ptr1 = passStringToWasm0(device_id, wasm.__wbindgen_export5, wasm.__wbindgen_export6);
                len1 = WASM_VECTOR_LEN;
            } catch (e) {
                if (ptr1) { wasm.__wbindgen_export3(ptr1, len1 * 1, 1); }
                if (ptr0) { wasm.__wbindgen_export3(ptr0, len0 * 1, 1); }
                throw e;
            }
            wasm.devicekeys_signAccountDeleteCancel(retptr, this.__wbg_ptr, ptr0, len0, ptr1, len1, val3);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            if (r3) {
                throw takeFromExternrefTable0(r2);
            }
            var v4 = getArrayU8FromWasm0(r0, r1).slice();
            wasm.__wbindgen_export3(r0, r1 * 1, 1);
            return v4;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * The `signature` that lets this device schedule the deletion of the whole account, under
     * `orbyn/account-delete/v1`, over the account id, the device id and `signedAt` (Unix seconds,
     * within five minutes of the server's clock). Each signature is accepted once.
     * @param {string} account_id
     * @param {string} device_id
     * @param {number} signed_at
     * @returns {Uint8Array}
     */
    signAccountDelete(account_id, device_id, signed_at) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16) >>> 0;
            const val3 = +signed_at;
            let ptr0, len0, ptr1, len1;
            try {
                ptr0 = passStringToWasm0(account_id, wasm.__wbindgen_export5, wasm.__wbindgen_export6);
                len0 = WASM_VECTOR_LEN;
                ptr1 = passStringToWasm0(device_id, wasm.__wbindgen_export5, wasm.__wbindgen_export6);
                len1 = WASM_VECTOR_LEN;
            } catch (e) {
                if (ptr1) { wasm.__wbindgen_export3(ptr1, len1 * 1, 1); }
                if (ptr0) { wasm.__wbindgen_export3(ptr0, len0 * 1, 1); }
                throw e;
            }
            wasm.devicekeys_signAccountDelete(retptr, this.__wbg_ptr, ptr0, len0, ptr1, len1, val3);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            if (r3) {
                throw takeFromExternrefTable0(r2);
            }
            var v4 = getArrayU8FromWasm0(r0, r1).slice();
            wasm.__wbindgen_export3(r0, r1 * 1, 1);
            return v4;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * The `device_signature` of `LoginFinish`, for the `login_id` from
     * `LoginStarted`.
     * @param {string} login_id
     * @returns {Uint8Array}
     */
    signLogin(login_id) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16) >>> 0;
            const ptr0 = passStringToWasm0(login_id, wasm.__wbindgen_export5, wasm.__wbindgen_export6);
            const len0 = WASM_VECTOR_LEN;
            wasm.devicekeys_signLogin(retptr, this.__wbg_ptr, ptr0, len0);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            if (r3) {
                throw takeFromExternrefTable0(r2);
            }
            var v2 = getArrayU8FromWasm0(r0, r1).slice();
            wasm.__wbindgen_export3(r0, r1 * 1, 1);
            return v2;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * The `device_signature` of `RegisterFinish`.
     * @param {string} email
     * @param {Uint8Array | number[]} upload
     * @returns {Uint8Array}
     */
    signRegistration(email, upload) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16) >>> 0;
            let ptr0, len0, ptr1, len1;
            try {
                ptr0 = passStringToWasm0(email, wasm.__wbindgen_export5, wasm.__wbindgen_export6);
                len0 = WASM_VECTOR_LEN;
                ptr1 = passArray8ToWasm0(upload, wasm.__wbindgen_export5);
                len1 = WASM_VECTOR_LEN;
            } catch (e) {
                if (ptr1) { wasm.__wbindgen_export3(ptr1, len1 * 1, 1); }
                if (ptr0) { wasm.__wbindgen_export3(ptr0, len0 * 1, 1); }
                throw e;
            }
            wasm.devicekeys_signRegistration(retptr, this.__wbg_ptr, ptr0, len0, ptr1, len1);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            if (r3) {
                throw takeFromExternrefTable0(r2);
            }
            var v3 = getArrayU8FromWasm0(r0, r1).slice();
            wasm.__wbindgen_export3(r0, r1 * 1, 1);
            return v3;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * The `signature` that lets this device change the account's second factor, under
     * `orbyn/totp-manage/v1`. `action` is `enrol`, `confirm` or `disable`; `code` is the six
     * digits for `confirm` and empty otherwise; `signedAt` is Unix seconds, within five minutes of
     * the server's clock. `accountId` and `deviceId` are the UUIDs of the session.
     * @param {string} account_id
     * @param {string} device_id
     * @param {string} action
     * @param {string} code
     * @param {number} signed_at
     * @returns {Uint8Array}
     */
    signTotpManage(account_id, device_id, action, code, signed_at) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16) >>> 0;
            const val5 = +signed_at;
            let ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3;
            try {
                ptr0 = passStringToWasm0(account_id, wasm.__wbindgen_export5, wasm.__wbindgen_export6);
                len0 = WASM_VECTOR_LEN;
                ptr1 = passStringToWasm0(device_id, wasm.__wbindgen_export5, wasm.__wbindgen_export6);
                len1 = WASM_VECTOR_LEN;
                ptr2 = passStringToWasm0(action, wasm.__wbindgen_export5, wasm.__wbindgen_export6);
                len2 = WASM_VECTOR_LEN;
                ptr3 = passStringToWasm0(code, wasm.__wbindgen_export5, wasm.__wbindgen_export6);
                len3 = WASM_VECTOR_LEN;
            } catch (e) {
                if (ptr3) { wasm.__wbindgen_export3(ptr3, len3 * 1, 1); }
                if (ptr2) { wasm.__wbindgen_export3(ptr2, len2 * 1, 1); }
                if (ptr1) { wasm.__wbindgen_export3(ptr1, len1 * 1, 1); }
                if (ptr0) { wasm.__wbindgen_export3(ptr0, len0 * 1, 1); }
                throw e;
            }
            wasm.devicekeys_signTotpManage(retptr, this.__wbg_ptr, ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, val5);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            if (r3) {
                throw takeFromExternrefTable0(r2);
            }
            var v6 = getArrayU8FromWasm0(r0, r1).slice();
            wasm.__wbindgen_export3(r0, r1 * 1, 1);
            return v6;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * The `signature` of a `TrustedDeviceProof`. `signed_at` is Unix seconds.
     * @param {string} email
     * @param {Uint8Array | number[]} credential_request
     * @param {number} signed_at
     * @returns {Uint8Array}
     */
    signTrustedStart(email, credential_request, signed_at) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16) >>> 0;
            const val3 = +signed_at;
            let ptr0, len0, ptr1, len1;
            try {
                ptr0 = passStringToWasm0(email, wasm.__wbindgen_export5, wasm.__wbindgen_export6);
                len0 = WASM_VECTOR_LEN;
                ptr1 = passArray8ToWasm0(credential_request, wasm.__wbindgen_export5);
                len1 = WASM_VECTOR_LEN;
            } catch (e) {
                if (ptr1) { wasm.__wbindgen_export3(ptr1, len1 * 1, 1); }
                if (ptr0) { wasm.__wbindgen_export3(ptr0, len0 * 1, 1); }
                throw e;
            }
            wasm.devicekeys_signTrustedStart(retptr, this.__wbg_ptr, ptr0, len0, ptr1, len1, val3);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            if (r3) {
                throw takeFromExternrefTable0(r2);
            }
            var v4 = getArrayU8FromWasm0(r0, r1).slice();
            wasm.__wbindgen_export3(r0, r1 * 1, 1);
            return v4;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Signs `message` under `context`.
     * @param {string} context
     * @param {Uint8Array | number[]} message
     * @returns {Uint8Array}
     */
    sign(context, message) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16) >>> 0;
            let ptr0, len0, ptr1, len1;
            try {
                ptr0 = passStringToWasm0(context, wasm.__wbindgen_export5, wasm.__wbindgen_export6);
                len0 = WASM_VECTOR_LEN;
                ptr1 = passArray8ToWasm0(message, wasm.__wbindgen_export5);
                len1 = WASM_VECTOR_LEN;
            } catch (e) {
                if (ptr1) { wasm.__wbindgen_export3(ptr1, len1 * 1, 1); }
                if (ptr0) { wasm.__wbindgen_export3(ptr0, len0 * 1, 1); }
                throw e;
            }
            wasm.devicekeys_sign(retptr, this.__wbg_ptr, ptr0, len0, ptr1, len1);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var v3 = getArrayU8FromWasm0(r0, r1).slice();
            wasm.__wbindgen_export3(r0, r1 * 1, 1);
            return v3;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * The Ed25519 public key, base64url, as `NewDevice.signing_key`.
     * @returns {string}
     */
    signingKey() {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16) >>> 0;
            wasm.devicekeys_signingKey(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export3(deferred1_0, deferred1_1, 1);
        }
    }
}
if (Symbol.dispose) DeviceKeys.prototype[Symbol.dispose] = DeviceKeys.prototype.free;

/**
 * An approval this new device joined (steps 2 and 5). Use it once.
 */
export class DeviceSession {
    static __wrap(ptr) {
        const obj = Object.create(DeviceSession.prototype);
        obj.__wbg_ptr = ptr;
        DeviceSessionFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        DeviceSessionFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_devicesession_free(ptr, 0);
    }
    /**
     * The `ApprovalNonce` to send to `…/nonce` (step 2).
     * @returns {string}
     */
    get nonceJson() {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16) >>> 0;
            wasm.devicesession_nonceJson(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export3(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * The six digits to show, once `GET /v1/devices/current` has the
     * approver's nonce. Refused if it does not match the commitment.
     * @param {string} view_json
     * @returns {string}
     */
    sas(view_json) {
        let deferred3_0;
        let deferred3_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16) >>> 0;
            const ptr0 = passStringToWasm0(view_json, wasm.__wbindgen_export5, wasm.__wbindgen_export6);
            const len0 = WASM_VECTOR_LEN;
            wasm.devicesession_sas(retptr, this.__wbg_ptr, ptr0, len0);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            var ptr2 = r0;
            var len2 = r1;
            if (r3) {
                ptr2 = 0; len2 = 0;
                throw takeFromExternrefTable0(r2);
            }
            deferred3_0 = ptr2;
            deferred3_1 = len2;
            return getStringFromWasm0(ptr2, len2);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export3(deferred3_0, deferred3_1, 1);
        }
    }
}
if (Symbol.dispose) DeviceSession.prototype[Symbol.dispose] = DeviceSession.prototype.free;

/**
 * Sign-in between its two requests.
 */
export class PendingLogin {
    static __wrap(ptr) {
        const obj = Object.create(PendingLogin.prototype);
        obj.__wbg_ptr = ptr;
        PendingLoginFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        PendingLoginFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_pendinglogin_free(ptr, 0);
    }
    /**
     * `LoginStart.credential_request`.
     * @returns {Uint8Array}
     */
    get request() {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16) >>> 0;
            wasm.pendinglogin_request(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var v1 = getArrayU8FromWasm0(r0, r1).slice();
            wasm.__wbindgen_export3(r0, r1 * 1, 1);
            return v1;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
}
if (Symbol.dispose) PendingLogin.prototype[Symbol.dispose] = PendingLogin.prototype.free;

/**
 * Sign-up between its two requests.
 */
export class PendingRegistration {
    static __wrap(ptr) {
        const obj = Object.create(PendingRegistration.prototype);
        obj.__wbg_ptr = ptr;
        PendingRegistrationFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        PendingRegistrationFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_pendingregistration_free(ptr, 0);
    }
    /**
     * `RegisterStart.registration_request`.
     * @returns {Uint8Array}
     */
    get request() {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16) >>> 0;
            wasm.pendingregistration_request(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var v1 = getArrayU8FromWasm0(r0, r1).slice();
            wasm.__wbindgen_export3(r0, r1 * 1, 1);
            return v1;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
}
if (Symbol.dispose) PendingRegistration.prototype[Symbol.dispose] = PendingRegistration.prototype.free;

/**
 * The sync engine for one device.
 */
export class SyncEngine {
    static __wrap(ptr) {
        const obj = Object.create(SyncEngine.prototype);
        obj.__wbg_ptr = ptr;
        SyncEngineFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        SyncEngineFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_syncengine_free(ptr, 0);
    }
    /**
     * Drops the batch waiting for an answer after any other refusal.
     * @param {string} zone
     */
    abandonUpload(zone) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16) >>> 0;
            const ptr0 = passStringToWasm0(zone, wasm.__wbindgen_export5, wasm.__wbindgen_export6);
            const len0 = WASM_VECTOR_LEN;
            wasm.syncengine_abandonUpload(retptr, this.__wbg_ptr, ptr0, len0);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeFromExternrefTable0(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Opens a `KeyEnvelopeList`, only from devices of `devices_json` this
     * device verifies; returns `{zones, refused}`. Call `retryQuarantined`
     * for each zone that got a key.
     * @param {string} envelopes_json
     * @param {string} devices_json
     * @returns {string}
     */
    acceptEnvelopes(envelopes_json, devices_json) {
        let deferred4_0;
        let deferred4_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16) >>> 0;
            let ptr0, len0, ptr1, len1;
            try {
                ptr0 = passStringToWasm0(envelopes_json, wasm.__wbindgen_export5, wasm.__wbindgen_export6);
                len0 = WASM_VECTOR_LEN;
                ptr1 = passStringToWasm0(devices_json, wasm.__wbindgen_export5, wasm.__wbindgen_export6);
                len1 = WASM_VECTOR_LEN;
            } catch (e) {
                if (ptr1) { wasm.__wbindgen_export3(ptr1, len1 * 1, 1); }
                if (ptr0) { wasm.__wbindgen_export3(ptr0, len0 * 1, 1); }
                throw e;
            }
            wasm.syncengine_acceptEnvelopes(retptr, this.__wbg_ptr, ptr0, len0, ptr1, len1);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            var ptr3 = r0;
            var len3 = r1;
            if (r3) {
                ptr3 = 0; len3 = 0;
                throw takeFromExternrefTable0(r2);
            }
            deferred4_0 = ptr3;
            deferred4_1 = len3;
            return getStringFromWasm0(ptr3, len3);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export3(deferred4_0, deferred4_1, 1);
        }
    }
    /**
     * Like `applyChanges`, for a page fetched with `since` (empty for a fetch
     * from the start). Required while a zone is fetched again after
     * `tokenExpired`; a page fetched with another token is refused.
     * @param {string} zone
     * @param {string | null | undefined} since
     * @param {string} page_json
     * @param {number} now
     * @returns {string}
     */
    applyChangesFrom(zone, since, page_json, now) {
        let deferred6_0;
        let deferred6_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16) >>> 0;
            const val4 = +now;
            let ptr0, len0, ptr1, len1, ptr2, len2;
            try {
                ptr0 = passStringToWasm0(zone, wasm.__wbindgen_export5, wasm.__wbindgen_export6);
                len0 = WASM_VECTOR_LEN;
                ptr1 = isLikeNone(since) ? 0 : passStringToWasm0(since, wasm.__wbindgen_export5, wasm.__wbindgen_export6);
                len1 = WASM_VECTOR_LEN;
                ptr2 = passStringToWasm0(page_json, wasm.__wbindgen_export5, wasm.__wbindgen_export6);
                len2 = WASM_VECTOR_LEN;
            } catch (e) {
                if (ptr2) { wasm.__wbindgen_export3(ptr2, len2 * 1, 1); }
                if (ptr1) { wasm.__wbindgen_export3(ptr1, len1 * 1, 1); }
                if (ptr0) { wasm.__wbindgen_export3(ptr0, len0 * 1, 1); }
                throw e;
            }
            wasm.syncengine_applyChangesFrom(retptr, this.__wbg_ptr, ptr0, len0, ptr1, len1, ptr2, len2, val4);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            var ptr5 = r0;
            var len5 = r1;
            if (r3) {
                ptr5 = 0; len5 = 0;
                throw takeFromExternrefTable0(r2);
            }
            deferred6_0 = ptr5;
            deferred6_1 = len5;
            return getStringFromWasm0(ptr5, len5);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export3(deferred6_0, deferred6_1, 1);
        }
    }
    /**
     * Applies one `ZoneChanges` page; returns what changed (`Applied`).
     * @param {string} zone
     * @param {string} page_json
     * @param {number} now
     * @returns {string}
     */
    applyChanges(zone, page_json, now) {
        let deferred5_0;
        let deferred5_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16) >>> 0;
            const val3 = +now;
            let ptr0, len0, ptr1, len1;
            try {
                ptr0 = passStringToWasm0(zone, wasm.__wbindgen_export5, wasm.__wbindgen_export6);
                len0 = WASM_VECTOR_LEN;
                ptr1 = passStringToWasm0(page_json, wasm.__wbindgen_export5, wasm.__wbindgen_export6);
                len1 = WASM_VECTOR_LEN;
            } catch (e) {
                if (ptr1) { wasm.__wbindgen_export3(ptr1, len1 * 1, 1); }
                if (ptr0) { wasm.__wbindgen_export3(ptr0, len0 * 1, 1); }
                throw e;
            }
            wasm.syncengine_applyChanges(retptr, this.__wbg_ptr, ptr0, len0, ptr1, len1, val3);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            var ptr4 = r0;
            var len4 = r1;
            if (r3) {
                ptr4 = 0; len4 = 0;
                throw takeFromExternrefTable0(r2);
            }
            deferred5_0 = ptr4;
            deferred5_1 = len4;
            return getStringFromWasm0(ptr4, len4);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export3(deferred5_0, deferred5_1, 1);
        }
    }
    /**
     * The next `UploadChanges`, or `undefined`. The same batch until its answer is applied.
     * @param {string} zone
     * @returns {string | undefined}
     */
    buildUpload(zone) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16) >>> 0;
            const ptr0 = passStringToWasm0(zone, wasm.__wbindgen_export5, wasm.__wbindgen_export6);
            const len0 = WASM_VECTOR_LEN;
            wasm.syncengine_buildUpload(retptr, this.__wbg_ptr, ptr0, len0);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            if (r3) {
                throw takeFromExternrefTable0(r2);
            }
            let v2;
            if (r0 !== 0) {
                v2 = getStringFromWasm0(r0, r1);
                wasm.__wbindgen_export3(r0, r1 * 1, 1);
            }
            return v2;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Compares one `ZoneList` page with this device; returns `{stale, next}`.
     * @param {string} zones_json
     * @returns {string}
     */
    checkZones(zones_json) {
        let deferred3_0;
        let deferred3_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16) >>> 0;
            const ptr0 = passStringToWasm0(zones_json, wasm.__wbindgen_export5, wasm.__wbindgen_export6);
            const len0 = WASM_VECTOR_LEN;
            wasm.syncengine_checkZones(retptr, this.__wbg_ptr, ptr0, len0);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            var ptr2 = r0;
            var len2 = r1;
            if (r3) {
                ptr2 = 0; len2 = 0;
                throw takeFromExternrefTable0(r2);
            }
            deferred3_0 = ptr2;
            deferred3_1 = len2;
            return getStringFromWasm0(ptr2, len2);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export3(deferred3_0, deferred3_1, 1);
        }
    }
    /**
     * Step 4, only after the person tapped "They match" on this device:
     * the `ConfirmApproval` to send to `…/confirm`. Uses the session up.
     * @param {ApproverSession} session
     * @param {string} devices_json
     * @returns {string}
     */
    confirmApproval(session, devices_json) {
        let deferred3_0;
        let deferred3_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16) >>> 0;
            _assertClass(session, ApproverSession);
            const ptr0 = passStringToWasm0(devices_json, wasm.__wbindgen_export5, wasm.__wbindgen_export6);
            const len0 = WASM_VECTOR_LEN;
            wasm.syncengine_confirmApproval(retptr, this.__wbg_ptr, session.__wbg_ptr, ptr0, len0);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            var ptr2 = r0;
            var len2 = r1;
            if (r3) {
                ptr2 = 0; len2 = 0;
                throw takeFromExternrefTable0(r2);
            }
            deferred3_0 = ptr2;
            deferred3_1 = len2;
            return getStringFromWasm0(ptr2, len2);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export3(deferred3_0, deferred3_1, 1);
        }
    }
    /**
     * Makes the zone's first key; returns its id.
     * @param {string} zone
     * @returns {string}
     */
    createZoneKey(zone) {
        let deferred3_0;
        let deferred3_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16) >>> 0;
            const ptr0 = passStringToWasm0(zone, wasm.__wbindgen_export5, wasm.__wbindgen_export6);
            const len0 = WASM_VECTOR_LEN;
            wasm.syncengine_createZoneKey(retptr, this.__wbg_ptr, ptr0, len0);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            var ptr2 = r0;
            var len2 = r1;
            if (r3) {
                ptr2 = 0; len2 = 0;
                throw takeFromExternrefTable0(r2);
            }
            deferred3_0 = ptr2;
            deferred3_1 = len2;
            return getStringFromWasm0(ptr2, len2);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export3(deferred3_0, deferred3_1, 1);
        }
    }
    /**
     * A new engine for this device (`SessionCreated.account_id` and `device_id`).
     * @param {DeviceKeys} keys
     * @param {string} account_id
     * @param {string} device_id
     * @returns {SyncEngine}
     */
    static create(keys, account_id, device_id) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16) >>> 0;
            _assertClass(keys, DeviceKeys);
            let ptr0, len0, ptr1, len1;
            try {
                ptr0 = passStringToWasm0(account_id, wasm.__wbindgen_export5, wasm.__wbindgen_export6);
                len0 = WASM_VECTOR_LEN;
                ptr1 = passStringToWasm0(device_id, wasm.__wbindgen_export5, wasm.__wbindgen_export6);
                len1 = WASM_VECTOR_LEN;
            } catch (e) {
                if (ptr1) { wasm.__wbindgen_export3(ptr1, len1 * 1, 1); }
                if (ptr0) { wasm.__wbindgen_export3(ptr0, len0 * 1, 1); }
                throw e;
            }
            wasm.syncengine_create(retptr, keys.__wbg_ptr, ptr0, len0, ptr1, len1);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            if (r2) {
                throw takeFromExternrefTable0(r1);
            }
            return SyncEngine.__wrap(r0);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * The `DeleteZone` body for `DELETE /v1/zones/{zone}`.
     * @param {string} zone
     * @returns {string}
     */
    deleteZoneProof(zone) {
        let deferred3_0;
        let deferred3_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16) >>> 0;
            const ptr0 = passStringToWasm0(zone, wasm.__wbindgen_export5, wasm.__wbindgen_export6);
            const len0 = WASM_VECTOR_LEN;
            wasm.syncengine_deleteZoneProof(retptr, this.__wbg_ptr, ptr0, len0);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            var ptr2 = r0;
            var len2 = r1;
            if (r3) {
                ptr2 = 0; len2 = 0;
                throw takeFromExternrefTable0(r2);
            }
            deferred3_0 = ptr2;
            deferred3_1 = len2;
            return getStringFromWasm0(ptr2, len2);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export3(deferred3_0, deferred3_1, 1);
        }
    }
    /**
     * @param {string} zone
     * @param {string} record_id
     */
    delete(zone, record_id) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16) >>> 0;
            let ptr0, len0, ptr1, len1;
            try {
                ptr0 = passStringToWasm0(zone, wasm.__wbindgen_export5, wasm.__wbindgen_export6);
                len0 = WASM_VECTOR_LEN;
                ptr1 = passStringToWasm0(record_id, wasm.__wbindgen_export5, wasm.__wbindgen_export6);
                len1 = WASM_VECTOR_LEN;
            } catch (e) {
                if (ptr1) { wasm.__wbindgen_export3(ptr1, len1 * 1, 1); }
                if (ptr0) { wasm.__wbindgen_export3(ptr0, len0 * 1, 1); }
                throw e;
            }
            wasm.syncengine_delete(retptr, this.__wbg_ptr, ptr0, len0, ptr1, len1);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeFromExternrefTable0(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * A `PutKeyEnvelopes` sealing every key of the zone to each device of
     * `devices_json` (a `DeviceList`) this device verifies, other than itself.
     * @param {string} zone
     * @param {string} devices_json
     * @returns {string}
     */
    envelopesFor(zone, devices_json) {
        let deferred4_0;
        let deferred4_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16) >>> 0;
            let ptr0, len0, ptr1, len1;
            try {
                ptr0 = passStringToWasm0(zone, wasm.__wbindgen_export5, wasm.__wbindgen_export6);
                len0 = WASM_VECTOR_LEN;
                ptr1 = passStringToWasm0(devices_json, wasm.__wbindgen_export5, wasm.__wbindgen_export6);
                len1 = WASM_VECTOR_LEN;
            } catch (e) {
                if (ptr1) { wasm.__wbindgen_export3(ptr1, len1 * 1, 1); }
                if (ptr0) { wasm.__wbindgen_export3(ptr0, len0 * 1, 1); }
                throw e;
            }
            wasm.syncengine_envelopesFor(retptr, this.__wbg_ptr, ptr0, len0, ptr1, len1);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            var ptr3 = r0;
            var len3 = r1;
            if (r3) {
                ptr3 = 0; len3 = 0;
                throw takeFromExternrefTable0(r2);
            }
            deferred4_0 = ptr3;
            deferred4_1 = len3;
            return getStringFromWasm0(ptr3, len3);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export3(deferred4_0, deferred4_1, 1);
        }
    }
    /**
     * Step 5, only after the person confirmed on this device (`typed` is the
     * approver's digits if the person typed them). Checks everything, then
     * trusts the approver and the devices it endorsed; returns the digits to
     * send to `…/code`. Uses the session up, also on failure.
     * @param {DeviceSession} session
     * @param {string} view_json
     * @param {string | null | undefined} typed
     * @param {number} now_secs
     * @returns {string}
     */
    finishApproval(session, view_json, typed, now_secs) {
        let deferred5_0;
        let deferred5_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16) >>> 0;
            _assertClass(session, DeviceSession);
            const val3 = +now_secs;
            let ptr0, len0, ptr1, len1;
            try {
                ptr0 = passStringToWasm0(view_json, wasm.__wbindgen_export5, wasm.__wbindgen_export6);
                len0 = WASM_VECTOR_LEN;
                ptr1 = isLikeNone(typed) ? 0 : passStringToWasm0(typed, wasm.__wbindgen_export5, wasm.__wbindgen_export6);
                len1 = WASM_VECTOR_LEN;
            } catch (e) {
                if (ptr1) { wasm.__wbindgen_export3(ptr1, len1 * 1, 1); }
                if (ptr0) { wasm.__wbindgen_export3(ptr0, len0 * 1, 1); }
                throw e;
            }
            wasm.syncengine_finishApproval(retptr, this.__wbg_ptr, session.__wbg_ptr, ptr0, len0, ptr1, len1, val3);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            var ptr4 = r0;
            var len4 = r1;
            if (r3) {
                ptr4 = 0; len4 = 0;
                throw takeFromExternrefTable0(r2);
            }
            deferred5_0 = ptr4;
            deferred5_1 = len4;
            return getStringFromWasm0(ptr4, len4);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export3(deferred5_0, deferred5_1, 1);
        }
    }
    /**
     * A live record as an `Item`, or `undefined`.
     * @param {string} zone
     * @param {string} record_id
     * @returns {string | undefined}
     */
    item(zone, record_id) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16) >>> 0;
            let ptr0, len0, ptr1, len1;
            try {
                ptr0 = passStringToWasm0(zone, wasm.__wbindgen_export5, wasm.__wbindgen_export6);
                len0 = WASM_VECTOR_LEN;
                ptr1 = passStringToWasm0(record_id, wasm.__wbindgen_export5, wasm.__wbindgen_export6);
                len1 = WASM_VECTOR_LEN;
            } catch (e) {
                if (ptr1) { wasm.__wbindgen_export3(ptr1, len1 * 1, 1); }
                if (ptr0) { wasm.__wbindgen_export3(ptr0, len0 * 1, 1); }
                throw e;
            }
            wasm.syncengine_item(retptr, this.__wbg_ptr, ptr0, len0, ptr1, len1);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            if (r3) {
                throw takeFromExternrefTable0(r2);
            }
            let v3;
            if (r0 !== 0) {
                v3 = getStringFromWasm0(r0, r1);
                wasm.__wbindgen_export3(r0, r1 * 1, 1);
            }
            return v3;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Step 2 on the new device: joins the approval of `GET /v1/devices/current`.
     * @param {string} view_json
     * @param {number} now_secs
     * @returns {DeviceSession}
     */
    joinApproval(view_json, now_secs) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16) >>> 0;
            const val2 = +now_secs;
            const ptr0 = passStringToWasm0(view_json, wasm.__wbindgen_export5, wasm.__wbindgen_export6);
            const len0 = WASM_VECTOR_LEN;
            wasm.syncengine_joinApproval(retptr, this.__wbg_ptr, ptr0, len0, val2);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            if (r2) {
                throw takeFromExternrefTable0(r1);
            }
            return DeviceSession.__wrap(r0);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Trusts a device the person checked another way (keys base64url).
     * @param {string} device_id
     * @param {string} signing_key
     * @param {string} agreement_key
     */
    pinDevice(device_id, signing_key, agreement_key) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16) >>> 0;
            let ptr0, len0, ptr1, len1, ptr2, len2;
            try {
                ptr0 = passStringToWasm0(device_id, wasm.__wbindgen_export5, wasm.__wbindgen_export6);
                len0 = WASM_VECTOR_LEN;
                ptr1 = passStringToWasm0(signing_key, wasm.__wbindgen_export5, wasm.__wbindgen_export6);
                len1 = WASM_VECTOR_LEN;
                ptr2 = passStringToWasm0(agreement_key, wasm.__wbindgen_export5, wasm.__wbindgen_export6);
                len2 = WASM_VECTOR_LEN;
            } catch (e) {
                if (ptr2) { wasm.__wbindgen_export3(ptr2, len2 * 1, 1); }
                if (ptr1) { wasm.__wbindgen_export3(ptr1, len1 * 1, 1); }
                if (ptr0) { wasm.__wbindgen_export3(ptr0, len0 * 1, 1); }
                throw e;
            }
            wasm.syncengine_pinDevice(retptr, this.__wbg_ptr, ptr0, len0, ptr1, len1, ptr2, len2);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeFromExternrefTable0(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Where to fetch the chain from (`GET /v1/keychain/protection?from=`): the verified head's
     * sequence, or the one an approver vouched for, or 1.
     * @returns {number}
     */
    protectionFrom() {
        const ret = wasm.syncengine_protectionFrom(this.__wbg_ptr);
        return ret;
    }
    /**
     * What this device knows about the protection level, as `{state, level}`: `verified` (the
     * whole chain was walked to the server's head and nothing stopped it, from an anchor this
     * device trusts: the only state in which Standard may be acted on, for escrow),
     * `provisional` (a verified setting that may not be the newest: show it as a guess), or
     * `unknown` (no level, and not Standard).
     * @returns {string}
     */
    protectionLevel() {
        let deferred2_0;
        let deferred2_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16) >>> 0;
            wasm.syncengine_protectionLevel(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            var ptr1 = r0;
            var len1 = r1;
            if (r3) {
                ptr1 = 0; len1 = 0;
                throw takeFromExternrefTable0(r2);
            }
            deferred2_0 = ptr1;
            deferred2_1 = len1;
            return getStringFromWasm0(ptr1, len1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export3(deferred2_0, deferred2_1, 1);
        }
    }
    /**
     * The sequence of the newest verified setting, 0 for none.
     * @returns {number}
     */
    protectionSeq() {
        const ret = wasm.syncengine_protectionSeq(this.__wbg_ptr);
        return ret;
    }
    /**
     * Forgets whole local zones, including their keys and queued uploads.
     * Takes a JSON array (at most 64 KiB / 1000 names); returns the sorted JSON
     * array of names actually removed. Invalid input changes nothing. The host
     * authorizes the names, fences late work and persists the snapshot. This
     * performs no remote deletion and leaves identity/trust/other zones intact.
     * @param {string} zones_json
     * @returns {string}
     */
    purgeLocalZones(zones_json) {
        let deferred3_0;
        let deferred3_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16) >>> 0;
            const ptr0 = passStringToWasm0(zones_json, wasm.__wbindgen_export5, wasm.__wbindgen_export6);
            const len0 = WASM_VECTOR_LEN;
            wasm.syncengine_purgeLocalZones(retptr, this.__wbg_ptr, ptr0, len0);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            var ptr2 = r0;
            var len2 = r1;
            if (r3) {
                ptr2 = 0; len2 = 0;
                throw takeFromExternrefTable0(r2);
            }
            deferred3_0 = ptr2;
            deferred3_1 = len2;
            return getStringFromWasm0(ptr2, len2);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export3(deferred3_0, deferred3_1, 1);
        }
    }
    /**
     * The zone's quarantined records, as `[{"record_id": ..., "reason": ...}]`
     * with the reason `missing_zone_key`, `open_failed` or `invalid_record`.
     * Never their bytes.
     * @param {string} zone
     * @returns {string}
     */
    quarantined(zone) {
        let deferred3_0;
        let deferred3_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16) >>> 0;
            const ptr0 = passStringToWasm0(zone, wasm.__wbindgen_export5, wasm.__wbindgen_export6);
            const len0 = WASM_VECTOR_LEN;
            wasm.syncengine_quarantined(retptr, this.__wbg_ptr, ptr0, len0);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            var ptr2 = r0;
            var len2 = r1;
            if (r3) {
                ptr2 = 0; len2 = 0;
                throw takeFromExternrefTable0(r2);
            }
            deferred3_0 = ptr2;
            deferred3_1 = len2;
            return getStringFromWasm0(ptr2, len2);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export3(deferred3_0, deferred3_1, 1);
        }
    }
    /**
     * A live record as `{"record_type": ..., "fields": Fields}`, or `undefined`.
     * @param {string} zone
     * @param {string} record_id
     * @returns {string | undefined}
     */
    record(zone, record_id) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16) >>> 0;
            let ptr0, len0, ptr1, len1;
            try {
                ptr0 = passStringToWasm0(zone, wasm.__wbindgen_export5, wasm.__wbindgen_export6);
                len0 = WASM_VECTOR_LEN;
                ptr1 = passStringToWasm0(record_id, wasm.__wbindgen_export5, wasm.__wbindgen_export6);
                len1 = WASM_VECTOR_LEN;
            } catch (e) {
                if (ptr1) { wasm.__wbindgen_export3(ptr1, len1 * 1, 1); }
                if (ptr0) { wasm.__wbindgen_export3(ptr0, len0 * 1, 1); }
                throw e;
            }
            wasm.syncengine_record(retptr, this.__wbg_ptr, ptr0, len0, ptr1, len1);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            if (r3) {
                throw takeFromExternrefTable0(r2);
            }
            let v3;
            if (r0 !== 0) {
                v3 = getStringFromWasm0(r0, r1);
                wasm.__wbindgen_export3(r0, r1 * 1, 1);
            }
            return v3;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * The body that signs `level` as the link after the server's newest link `head_json` (a
     * `ProtectionLink`), even one this device could not verify: it moves the chain past a link
     * signed by a removed device or a setting this device refused. The app must show the person
     * the setting and ask before calling it, and never sign on its own.
     * @param {string} level
     * @param {string} head_json
     * @param {number} now_secs
     * @returns {string}
     */
    resignProtection(level, head_json, now_secs) {
        let deferred5_0;
        let deferred5_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16) >>> 0;
            const val3 = +now_secs;
            let ptr0, len0, ptr1, len1;
            try {
                ptr0 = passStringToWasm0(level, wasm.__wbindgen_export5, wasm.__wbindgen_export6);
                len0 = WASM_VECTOR_LEN;
                ptr1 = passStringToWasm0(head_json, wasm.__wbindgen_export5, wasm.__wbindgen_export6);
                len1 = WASM_VECTOR_LEN;
            } catch (e) {
                if (ptr1) { wasm.__wbindgen_export3(ptr1, len1 * 1, 1); }
                if (ptr0) { wasm.__wbindgen_export3(ptr0, len0 * 1, 1); }
                throw e;
            }
            wasm.syncengine_resignProtection(retptr, this.__wbg_ptr, ptr0, len0, ptr1, len1, val3);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            var ptr4 = r0;
            var len4 = r1;
            if (r3) {
                ptr4 = 0; len4 = 0;
                throw takeFromExternrefTable0(r2);
            }
            deferred5_0 = ptr4;
            deferred5_1 = len4;
            return getStringFromWasm0(ptr4, len4);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export3(deferred5_0, deferred5_1, 1);
        }
    }
    /**
     * An engine from a `snapshot` sealed under the same wrapping secret.
     * @param {DeviceKeys} keys
     * @param {Uint8Array | number[]} sealed
     * @param {Uint8Array | number[]} wrap_secret
     * @param {number} now
     * @returns {SyncEngine}
     */
    static restore(keys, sealed, wrap_secret, now) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16) >>> 0;
            _assertClass(keys, DeviceKeys);
            const val3 = +now;
            let ptr0, len0, ptr1, len1;
            try {
                ptr0 = passArray8ToWasm0(sealed, wasm.__wbindgen_export5);
                len0 = WASM_VECTOR_LEN;
                ptr1 = passArray8ToWasm0(wrap_secret, wasm.__wbindgen_export5);
                len1 = WASM_VECTOR_LEN;
            } catch (e) {
                if (ptr1) { wasm.__wbindgen_export3(ptr1, len1 * 1, 1); }
                if (ptr0) { wasm.__wbindgen_export3(ptr0, len0 * 1, 1); }
                throw e;
            }
            wasm.syncengine_restore(retptr, keys.__wbg_ptr, ptr0, len0, ptr1, len1, val3);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            if (r2) {
                throw takeFromExternrefTable0(r1);
            }
            return SyncEngine.__wrap(r0);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Tries quarantined records again; returns what changed (`Applied`).
     * @param {string} zone
     * @param {number} now
     * @returns {string}
     */
    retryQuarantined(zone, now) {
        let deferred4_0;
        let deferred4_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16) >>> 0;
            const val2 = +now;
            const ptr0 = passStringToWasm0(zone, wasm.__wbindgen_export5, wasm.__wbindgen_export6);
            const len0 = WASM_VECTOR_LEN;
            wasm.syncengine_retryQuarantined(retptr, this.__wbg_ptr, ptr0, len0, val2);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            var ptr3 = r0;
            var len3 = r1;
            if (r3) {
                ptr3 = 0; len3 = 0;
                throw takeFromExternrefTable0(r2);
            }
            deferred4_0 = ptr3;
            deferred4_1 = len3;
            return getStringFromWasm0(ptr3, len3);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export3(deferred4_0, deferred4_1, 1);
        }
    }
    /**
     * Replaces the zone's current key with a new one signed by this device;
     * returns its id. Send it with `envelopesFor`.
     * @param {string} zone
     * @returns {string}
     */
    rotateZoneKey(zone) {
        let deferred3_0;
        let deferred3_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16) >>> 0;
            const ptr0 = passStringToWasm0(zone, wasm.__wbindgen_export5, wasm.__wbindgen_export6);
            const len0 = WASM_VECTOR_LEN;
            wasm.syncengine_rotateZoneKey(retptr, this.__wbg_ptr, ptr0, len0);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            var ptr2 = r0;
            var len2 = r1;
            if (r3) {
                ptr2 = 0; len2 = 0;
                throw takeFromExternrefTable0(r2);
            }
            deferred3_0 = ptr2;
            deferred3_1 = len2;
            return getStringFromWasm0(ptr2, len2);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export3(deferred3_0, deferred3_1, 1);
        }
    }
    /**
     * The `SetProtection` body for `POST /v1/keychain/protection`: `level` (`standard` or
     * `advanced`) as the next link of the chain this device verified, signed now.
     * @param {string} level
     * @param {number} now_secs
     * @returns {string}
     */
    signProtection(level, now_secs) {
        let deferred4_0;
        let deferred4_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16) >>> 0;
            const val2 = +now_secs;
            const ptr0 = passStringToWasm0(level, wasm.__wbindgen_export5, wasm.__wbindgen_export6);
            const len0 = WASM_VECTOR_LEN;
            wasm.syncengine_signProtection(retptr, this.__wbg_ptr, ptr0, len0, val2);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            var ptr3 = r0;
            var len3 = r1;
            if (r3) {
                ptr3 = 0; len3 = 0;
                throw takeFromExternrefTable0(r2);
            }
            deferred4_0 = ptr3;
            deferred4_1 = len3;
            return getStringFromWasm0(ptr3, len3);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export3(deferred4_0, deferred4_1, 1);
        }
    }
    /**
     * The `RemoveDevice` body that removes `device_json`, signed by this device.
     * @param {string} device_json
     * @returns {string}
     */
    signRemoval(device_json) {
        let deferred3_0;
        let deferred3_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16) >>> 0;
            const ptr0 = passStringToWasm0(device_json, wasm.__wbindgen_export5, wasm.__wbindgen_export6);
            const len0 = WASM_VECTOR_LEN;
            wasm.syncengine_signRemoval(retptr, this.__wbg_ptr, ptr0, len0);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            var ptr2 = r0;
            var len2 = r1;
            if (r3) {
                ptr2 = 0; len2 = 0;
                throw takeFromExternrefTable0(r2);
            }
            deferred3_0 = ptr2;
            deferred3_1 = len2;
            return getStringFromWasm0(ptr2, len2);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export3(deferred3_0, deferred3_1, 1);
        }
    }
    /**
     * How many records `restore` found with a newest stamp more than an hour
     * ahead of its `now`. They were kept but did not move the clock; log a
     * non-zero count.
     * @returns {number}
     */
    skippedFutureStamps() {
        const ret = wasm.syncengine_skippedFutureStamps(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * The engine's state sealed under `wrap_secret`, bound to this device's
     * keys. Zone keys inside it never leave WebAssembly in the clear.
     * @param {Uint8Array | number[]} wrap_secret
     * @returns {Uint8Array}
     */
    snapshot(wrap_secret) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16) >>> 0;
            const ptr0 = passArray8ToWasm0(wrap_secret, wasm.__wbindgen_export5);
            const len0 = WASM_VECTOR_LEN;
            wasm.syncengine_snapshot(retptr, this.__wbg_ptr, ptr0, len0);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            if (r3) {
                throw takeFromExternrefTable0(r2);
            }
            var v2 = getArrayU8FromWasm0(r0, r1).slice();
            wasm.__wbindgen_export3(r0, r1 * 1, 1);
            return v2;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Stages a new `Item`, or an edit of `before_json`.
     * @param {string} zone
     * @param {string} item_json
     * @param {string | null | undefined} before_json
     * @param {number} now
     */
    stageItem(zone, item_json, before_json, now) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16) >>> 0;
            const val4 = +now;
            let ptr0, len0, ptr1, len1, ptr2, len2;
            try {
                ptr0 = passStringToWasm0(zone, wasm.__wbindgen_export5, wasm.__wbindgen_export6);
                len0 = WASM_VECTOR_LEN;
                ptr1 = passStringToWasm0(item_json, wasm.__wbindgen_export5, wasm.__wbindgen_export6);
                len1 = WASM_VECTOR_LEN;
                ptr2 = isLikeNone(before_json) ? 0 : passStringToWasm0(before_json, wasm.__wbindgen_export5, wasm.__wbindgen_export6);
                len2 = WASM_VECTOR_LEN;
            } catch (e) {
                if (ptr2) { wasm.__wbindgen_export3(ptr2, len2 * 1, 1); }
                if (ptr1) { wasm.__wbindgen_export3(ptr1, len1 * 1, 1); }
                if (ptr0) { wasm.__wbindgen_export3(ptr0, len0 * 1, 1); }
                throw e;
            }
            wasm.syncengine_stageItem(retptr, this.__wbg_ptr, ptr0, len0, ptr1, len1, ptr2, len2, val4);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeFromExternrefTable0(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Stages already stamped `Fields`.
     * @param {string} zone
     * @param {string} record_type
     * @param {string} record_id
     * @param {string} fields_json
     */
    stage(zone, record_type, record_id, fields_json) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16) >>> 0;
            let ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3;
            try {
                ptr0 = passStringToWasm0(zone, wasm.__wbindgen_export5, wasm.__wbindgen_export6);
                len0 = WASM_VECTOR_LEN;
                ptr1 = passStringToWasm0(record_type, wasm.__wbindgen_export5, wasm.__wbindgen_export6);
                len1 = WASM_VECTOR_LEN;
                ptr2 = passStringToWasm0(record_id, wasm.__wbindgen_export5, wasm.__wbindgen_export6);
                len2 = WASM_VECTOR_LEN;
                ptr3 = passStringToWasm0(fields_json, wasm.__wbindgen_export5, wasm.__wbindgen_export6);
                len3 = WASM_VECTOR_LEN;
            } catch (e) {
                if (ptr3) { wasm.__wbindgen_export3(ptr3, len3 * 1, 1); }
                if (ptr2) { wasm.__wbindgen_export3(ptr2, len2 * 1, 1); }
                if (ptr1) { wasm.__wbindgen_export3(ptr1, len1 * 1, 1); }
                if (ptr0) { wasm.__wbindgen_export3(ptr0, len0 * 1, 1); }
                throw e;
            }
            wasm.syncengine_stage(retptr, this.__wbg_ptr, ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeFromExternrefTable0(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Step 1 on a trusted device: starts approving `device_json` (a pending
     * `Device` from `GET /v1/devices`). `now_secs` is Unix seconds.
     * @param {string} device_json
     * @param {number} now_secs
     * @returns {ApproverSession}
     */
    startApproval(device_json, now_secs) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16) >>> 0;
            const val2 = +now_secs;
            const ptr0 = passStringToWasm0(device_json, wasm.__wbindgen_export5, wasm.__wbindgen_export6);
            const len0 = WASM_VECTOR_LEN;
            wasm.syncengine_startApproval(retptr, this.__wbg_ptr, ptr0, len0, val2);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            if (r2) {
                throw takeFromExternrefTable0(r1);
            }
            return ApproverSession.__wrap(r0);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Takes a record out of the trash; returns it, or `undefined`.
     * @param {string} zone
     * @param {string} record_id
     * @returns {string | undefined}
     */
    takeFromTrash(zone, record_id) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16) >>> 0;
            let ptr0, len0, ptr1, len1;
            try {
                ptr0 = passStringToWasm0(zone, wasm.__wbindgen_export5, wasm.__wbindgen_export6);
                len0 = WASM_VECTOR_LEN;
                ptr1 = passStringToWasm0(record_id, wasm.__wbindgen_export5, wasm.__wbindgen_export6);
                len1 = WASM_VECTOR_LEN;
            } catch (e) {
                if (ptr1) { wasm.__wbindgen_export3(ptr1, len1 * 1, 1); }
                if (ptr0) { wasm.__wbindgen_export3(ptr0, len0 * 1, 1); }
                throw e;
            }
            wasm.syncengine_takeFromTrash(retptr, this.__wbg_ptr, ptr0, len0, ptr1, len1);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            if (r3) {
                throw takeFromExternrefTable0(r2);
            }
            let v3;
            if (r0 !== 0) {
                v3 = getStringFromWasm0(r0, r1);
                wasm.__wbindgen_export3(r0, r1 * 1, 1);
            }
            return v3;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * A `Stamp` for an edit made at `edit_at` (milliseconds), which may be
     * earlier than `now`: an edit queued while the app was closed. The clock's
     * rules hold: the stamp is never earlier than the last one this device
     * issued or saw. An `edit_at` after `now` is taken as `now`, silently.
     * @param {number} edit_at
     * @param {number} now
     * @returns {string}
     */
    tickAt(edit_at, now) {
        let deferred2_0;
        let deferred2_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16) >>> 0;
            wasm.syncengine_tickAt(retptr, this.__wbg_ptr, edit_at, now);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            var ptr1 = r0;
            var len1 = r1;
            if (r3) {
                ptr1 = 0; len1 = 0;
                throw takeFromExternrefTable0(r2);
            }
            deferred2_0 = ptr1;
            deferred2_1 = len1;
            return getStringFromWasm0(ptr1, len1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export3(deferred2_0, deferred2_1, 1);
        }
    }
    /**
     * A `Stamp` for a new edit at `now` (milliseconds).
     * @param {number} now
     * @returns {string}
     */
    tick(now) {
        let deferred2_0;
        let deferred2_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16) >>> 0;
            wasm.syncengine_tick(retptr, this.__wbg_ptr, now);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            var ptr1 = r0;
            var len1 = r1;
            if (r3) {
                ptr1 = 0; len1 = 0;
                throw takeFromExternrefTable0(r2);
            }
            deferred2_0 = ptr1;
            deferred2_1 = len1;
            return getStringFromWasm0(ptr1, len1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export3(deferred2_0, deferred2_1, 1);
        }
    }
    /**
     * Call on a `token_expired` answer to a fetch or an upload: the token is
     * forgotten, so `token(zone)` is empty and the zone is fetched from the start.
     * @param {string} zone
     */
    tokenExpired(zone) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16) >>> 0;
            const ptr0 = passStringToWasm0(zone, wasm.__wbindgen_export5, wasm.__wbindgen_export6);
            const len0 = WASM_VECTOR_LEN;
            wasm.syncengine_tokenExpired(retptr, this.__wbg_ptr, ptr0, len0);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeFromExternrefTable0(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * The zone's change token for `?since=`, or `undefined` to start from the beginning.
     * @param {string} zone
     * @returns {string | undefined}
     */
    token(zone) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16) >>> 0;
            const ptr0 = passStringToWasm0(zone, wasm.__wbindgen_export5, wasm.__wbindgen_export6);
            const len0 = WASM_VECTOR_LEN;
            wasm.syncengine_token(retptr, this.__wbg_ptr, ptr0, len0);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            let v2;
            if (r0 !== 0) {
                v2 = getStringFromWasm0(r0, r1);
                wasm.__wbindgen_export3(r0, r1 * 1, 1);
            }
            return v2;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Records another device deleted while this one had edits, as
     * `{record_id: Trashed}`.
     * @param {string} zone
     * @returns {string}
     */
    trash(zone) {
        let deferred3_0;
        let deferred3_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16) >>> 0;
            const ptr0 = passStringToWasm0(zone, wasm.__wbindgen_export5, wasm.__wbindgen_export6);
            const len0 = WASM_VECTOR_LEN;
            wasm.syncengine_trash(retptr, this.__wbg_ptr, ptr0, len0);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            var ptr2 = r0;
            var len2 = r1;
            if (r3) {
                ptr2 = 0; len2 = 0;
                throw takeFromExternrefTable0(r2);
            }
            deferred3_0 = ptr2;
            deferred3_1 = len2;
            return getStringFromWasm0(ptr2, len2);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export3(deferred3_0, deferred3_1, 1);
        }
    }
    /**
     * Applies a 409 `RecordChanged`; returns what changed (`Applied`).
     * @param {string} zone
     * @param {string} conflict_json
     * @param {number} now
     * @returns {string}
     */
    uploadConflicted(zone, conflict_json, now) {
        let deferred5_0;
        let deferred5_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16) >>> 0;
            const val3 = +now;
            let ptr0, len0, ptr1, len1;
            try {
                ptr0 = passStringToWasm0(zone, wasm.__wbindgen_export5, wasm.__wbindgen_export6);
                len0 = WASM_VECTOR_LEN;
                ptr1 = passStringToWasm0(conflict_json, wasm.__wbindgen_export5, wasm.__wbindgen_export6);
                len1 = WASM_VECTOR_LEN;
            } catch (e) {
                if (ptr1) { wasm.__wbindgen_export3(ptr1, len1 * 1, 1); }
                if (ptr0) { wasm.__wbindgen_export3(ptr0, len0 * 1, 1); }
                throw e;
            }
            wasm.syncengine_uploadConflicted(retptr, this.__wbg_ptr, ptr0, len0, ptr1, len1, val3);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            var ptr4 = r0;
            var len4 = r1;
            if (r3) {
                ptr4 = 0; len4 = 0;
                throw takeFromExternrefTable0(r2);
            }
            deferred5_0 = ptr4;
            deferred5_1 = len4;
            return getStringFromWasm0(ptr4, len4);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export3(deferred5_0, deferred5_1, 1);
        }
    }
    /**
     * Applies an `UploadResult`.
     * @param {string} zone
     * @param {string} result_json
     */
    uploadSucceeded(zone, result_json) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16) >>> 0;
            let ptr0, len0, ptr1, len1;
            try {
                ptr0 = passStringToWasm0(zone, wasm.__wbindgen_export5, wasm.__wbindgen_export6);
                len0 = WASM_VECTOR_LEN;
                ptr1 = passStringToWasm0(result_json, wasm.__wbindgen_export5, wasm.__wbindgen_export6);
                len1 = WASM_VECTOR_LEN;
            } catch (e) {
                if (ptr1) { wasm.__wbindgen_export3(ptr1, len1 * 1, 1); }
                if (ptr0) { wasm.__wbindgen_export3(ptr0, len0 * 1, 1); }
                throw e;
            }
            wasm.syncengine_uploadSucceeded(retptr, this.__wbg_ptr, ptr0, len0, ptr1, len1);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeFromExternrefTable0(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * The device ids of `devices_json` this device verifies by approval chain.
     * @param {string} devices_json
     * @returns {string}
     */
    verifyDevices(devices_json) {
        let deferred3_0;
        let deferred3_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16) >>> 0;
            const ptr0 = passStringToWasm0(devices_json, wasm.__wbindgen_export5, wasm.__wbindgen_export6);
            const len0 = WASM_VECTOR_LEN;
            wasm.syncengine_verifyDevices(retptr, this.__wbg_ptr, ptr0, len0);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            var ptr2 = r0;
            var len2 = r1;
            if (r3) {
                ptr2 = 0; len2 = 0;
                throw takeFromExternrefTable0(r2);
            }
            deferred3_0 = ptr2;
            deferred3_1 = len2;
            return getStringFromWasm0(ptr2, len2);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export3(deferred3_0, deferred3_1, 1);
        }
    }
    /**
     * Checks a `ProtectionChain` (from `GET /v1/keychain/protection?from=` `protectionFrom()`,
     * page by page, with its `more` flag) against the devices of `devices_json` this device
     * verifies, and moves the verified head forward over every link a trusted device signed or
     * committed to. Returns `{seq, state, level, stopped}`; `state` is `verified`, `provisional`
     * or `unknown` (see `protectionLevel`). Throws `protection_rollback` or `protection_fork`,
     * changing nothing.
     * @param {string} chain_json
     * @param {string} devices_json
     * @returns {string}
     */
    verifyProtection(chain_json, devices_json) {
        let deferred4_0;
        let deferred4_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16) >>> 0;
            let ptr0, len0, ptr1, len1;
            try {
                ptr0 = passStringToWasm0(chain_json, wasm.__wbindgen_export5, wasm.__wbindgen_export6);
                len0 = WASM_VECTOR_LEN;
                ptr1 = passStringToWasm0(devices_json, wasm.__wbindgen_export5, wasm.__wbindgen_export6);
                len1 = WASM_VECTOR_LEN;
            } catch (e) {
                if (ptr1) { wasm.__wbindgen_export3(ptr1, len1 * 1, 1); }
                if (ptr0) { wasm.__wbindgen_export3(ptr0, len0 * 1, 1); }
                throw e;
            }
            wasm.syncengine_verifyProtection(retptr, this.__wbg_ptr, ptr0, len0, ptr1, len1);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            var ptr3 = r0;
            var len3 = r1;
            if (r3) {
                ptr3 = 0; len3 = 0;
                throw takeFromExternrefTable0(r2);
            }
            deferred4_0 = ptr3;
            deferred4_1 = len3;
            return getStringFromWasm0(ptr3, len3);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export3(deferred4_0, deferred4_1, 1);
        }
    }
}
if (Symbol.dispose) SyncEngine.prototype[Symbol.dispose] = SyncEngine.prototype.free;

/**
 * Finishes sign-in with `LoginStarted.credential_response`; returns
 * `LoginFinish.credential_finalization`. A wrong password fails here with
 * `auth_failed`. Works once.
 * @param {PendingLogin} pending
 * @param {Uint8Array | number[]} password
 * @param {Uint8Array | number[]} response
 * @returns {Uint8Array}
 */
export function finishLogin(pending, password, response) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16) >>> 0;
        _assertClass(pending, PendingLogin);
        let ptr0, len0, ptr1, len1;
        try {
            ptr0 = passArray8ToWasm0(password, wasm.__wbindgen_export5);
            len0 = WASM_VECTOR_LEN;
            ptr1 = passArray8ToWasm0(response, wasm.__wbindgen_export5);
            len1 = WASM_VECTOR_LEN;
        } catch (e) {
            if (ptr1) { wasm.__wbindgen_export3(ptr1, len1 * 1, 1); }
            if (ptr0) { wasm.__wbindgen_export3(ptr0, len0 * 1, 1); }
            throw e;
        }
        wasm.finishLogin(retptr, pending.__wbg_ptr, ptr0, len0, ptr1, len1);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
        if (r3) {
            throw takeFromExternrefTable0(r2);
        }
        var v3 = getArrayU8FromWasm0(r0, r1).slice();
        wasm.__wbindgen_export3(r0, r1 * 1, 1);
        return v3;
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
 * Finishes sign-up with `RegisterStarted.registration_response`; returns
 * `RegisterFinish.registration_upload`. Works once.
 * @param {PendingRegistration} pending
 * @param {Uint8Array | number[]} password
 * @param {Uint8Array | number[]} response
 * @returns {Uint8Array}
 */
export function finishRegistration(pending, password, response) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16) >>> 0;
        _assertClass(pending, PendingRegistration);
        let ptr0, len0, ptr1, len1;
        try {
            ptr0 = passArray8ToWasm0(password, wasm.__wbindgen_export5);
            len0 = WASM_VECTOR_LEN;
            ptr1 = passArray8ToWasm0(response, wasm.__wbindgen_export5);
            len1 = WASM_VECTOR_LEN;
        } catch (e) {
            if (ptr1) { wasm.__wbindgen_export3(ptr1, len1 * 1, 1); }
            if (ptr0) { wasm.__wbindgen_export3(ptr0, len0 * 1, 1); }
            throw e;
        }
        wasm.finishRegistration(retptr, pending.__wbg_ptr, ptr0, len0, ptr1, len1);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
        if (r3) {
            throw takeFromExternrefTable0(r2);
        }
        var v3 = getArrayU8FromWasm0(r0, r1).slice();
        wasm.__wbindgen_export3(r0, r1 * 1, 1);
        return v3;
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
 * Reads an `Item` back from `Fields`, checking it fully.
 * @param {string} id
 * @param {string} fields_json
 * @returns {string}
 */
export function itemFromFields(id, fields_json) {
    let deferred4_0;
    let deferred4_1;
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16) >>> 0;
        let ptr0, len0, ptr1, len1;
        try {
            ptr0 = passStringToWasm0(id, wasm.__wbindgen_export5, wasm.__wbindgen_export6);
            len0 = WASM_VECTOR_LEN;
            ptr1 = passStringToWasm0(fields_json, wasm.__wbindgen_export5, wasm.__wbindgen_export6);
            len1 = WASM_VECTOR_LEN;
        } catch (e) {
            if (ptr1) { wasm.__wbindgen_export3(ptr1, len1 * 1, 1); }
            if (ptr0) { wasm.__wbindgen_export3(ptr0, len0 * 1, 1); }
            throw e;
        }
        wasm.itemFromFields(retptr, ptr0, len0, ptr1, len1);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
        var ptr3 = r0;
        var len3 = r1;
        if (r3) {
            ptr3 = 0; len3 = 0;
            throw takeFromExternrefTable0(r2);
        }
        deferred4_0 = ptr3;
        deferred4_1 = len3;
        return getStringFromWasm0(ptr3, len3);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
        wasm.__wbindgen_export3(deferred4_0, deferred4_1, 1);
    }
}

/**
 * Every field of `item_json` (an `Item`), or only what changed since
 * `before_json`, stamped with `stamp_json` (a `Stamp`). Returns `Fields`.
 * @param {string} item_json
 * @param {string | null | undefined} before_json
 * @param {string} stamp_json
 * @returns {string}
 */
export function itemToFields(item_json, before_json, stamp_json) {
    let deferred5_0;
    let deferred5_1;
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16) >>> 0;
        let ptr0, len0, ptr1, len1, ptr2, len2;
        try {
            ptr0 = passStringToWasm0(item_json, wasm.__wbindgen_export5, wasm.__wbindgen_export6);
            len0 = WASM_VECTOR_LEN;
            ptr1 = isLikeNone(before_json) ? 0 : passStringToWasm0(before_json, wasm.__wbindgen_export5, wasm.__wbindgen_export6);
            len1 = WASM_VECTOR_LEN;
            ptr2 = passStringToWasm0(stamp_json, wasm.__wbindgen_export5, wasm.__wbindgen_export6);
            len2 = WASM_VECTOR_LEN;
        } catch (e) {
            if (ptr2) { wasm.__wbindgen_export3(ptr2, len2 * 1, 1); }
            if (ptr1) { wasm.__wbindgen_export3(ptr1, len1 * 1, 1); }
            if (ptr0) { wasm.__wbindgen_export3(ptr0, len0 * 1, 1); }
            throw e;
        }
        wasm.itemToFields(retptr, ptr0, len0, ptr1, len1, ptr2, len2);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
        var ptr4 = r0;
        var len4 = r1;
        if (r3) {
            ptr4 = 0; len4 = 0;
            throw takeFromExternrefTable0(r2);
        }
        deferred5_0 = ptr4;
        deferred5_1 = len4;
        return getStringFromWasm0(ptr4, len4);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
        wasm.__wbindgen_export3(deferred5_0, deferred5_1, 1);
    }
}

/**
 * Lowercases and trims an email, or `undefined` when it is not one.
 * @param {string} email
 * @returns {string | undefined}
 */
export function normalizeEmail(email) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16) >>> 0;
        const ptr0 = passStringToWasm0(email, wasm.__wbindgen_export5, wasm.__wbindgen_export6);
        const len0 = WASM_VECTOR_LEN;
        wasm.normalizeEmail(retptr, ptr0, len0);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        let v2;
        if (r0 !== 0) {
            v2 = getStringFromWasm0(r0, r1);
            wasm.__wbindgen_export3(r0, r1 * 1, 1);
        }
        return v2;
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
 * Starts sign-in.
 * @param {Uint8Array | number[]} password
 * @returns {PendingLogin}
 */
export function startLogin(password) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16) >>> 0;
        const ptr0 = passArray8ToWasm0(password, wasm.__wbindgen_export5);
        const len0 = WASM_VECTOR_LEN;
        wasm.startLogin(retptr, ptr0, len0);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        if (r2) {
            throw takeFromExternrefTable0(r1);
        }
        return PendingLogin.__wrap(r0);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
 * Starts sign-up.
 * @param {Uint8Array | number[]} password
 * @returns {PendingRegistration}
 */
export function startRegistration(password) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16) >>> 0;
        const ptr0 = passArray8ToWasm0(password, wasm.__wbindgen_export5);
        const len0 = WASM_VECTOR_LEN;
        wasm.startRegistration(retptr, ptr0, len0);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        if (r2) {
            throw takeFromExternrefTable0(r1);
        }
        return PendingRegistration.__wrap(r0);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}
function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbg_Error_208446807d0d1e30: function(arg0, arg1) {
            const ret = Error(getStringFromWasm0(arg0, arg1));
            return ret;
        },
        __wbg___wbindgen_is_function_741ff2bb612836f5: function(arg0) {
            const ret = typeof(arg0) === 'function';
            return ret;
        },
        __wbg___wbindgen_is_object_8b968c3ab8e96595: function(arg0) {
            const val = arg0;
            const ret = typeof(val) === 'object' && val !== null;
            return ret;
        },
        __wbg___wbindgen_is_string_fc456fee5d3317de: function(arg0) {
            const ret = typeof(arg0) === 'string';
            return ret;
        },
        __wbg___wbindgen_is_undefined_be5b34249ff1fc15: function(arg0) {
            const ret = arg0 === undefined;
            return ret;
        },
        __wbg___wbindgen_throw_4c88d8bf264fd984: function(arg0, arg1) {
            throw new Error(getStringFromWasm0(arg0, arg1));
        },
        __wbg_call_a410eb4b59ed5965: function() { return handleError(function (arg0, arg1, arg2) {
            const ret = arg0.call(arg1, arg2);
            return ret;
        }, arguments); },
        __wbg_crypto_23f565a907d30078: function(arg0) {
            const ret = arg0.crypto;
            return ret;
        },
        __wbg_getRandomValues_8b6f1f663e6f188d: function() { return handleError(function (arg0, arg1) {
            globalThis.crypto.getRandomValues(getArrayU8FromWasm0(arg0, arg1));
        }, arguments); },
        __wbg_getRandomValues_d2908e0b99612b91: function() { return handleError(function (arg0, arg1) {
            arg0.getRandomValues(arg1);
        }, arguments); },
        __wbg_length_186163212ffe79c3: function(arg0) {
            const ret = arg0.length;
            return ret;
        },
        __wbg_msCrypto_d5f06fad6bf1409b: function(arg0) {
            const ret = arg0.msCrypto;
            return ret;
        },
        __wbg_new_with_length_01b143a7e5dd5a3e: function(arg0) {
            const ret = new Uint8Array(arg0 >>> 0);
            return ret;
        },
        __wbg_node_86166ff8ce1f2002: function(arg0) {
            const ret = arg0.node;
            return ret;
        },
        __wbg_process_91f425a63f58e399: function(arg0) {
            const ret = arg0.process;
            return ret;
        },
        __wbg_prototypesetcall_13162965d1fe7aa3: function(arg0, arg1, arg2) {
            Uint8Array.prototype.set.call(getArrayU8FromWasm0(arg0, arg1), arg2);
        },
        __wbg_randomFillSync_34b023059e3363de: function() { return handleError(function (arg0, arg1) {
            arg0.randomFillSync(arg1);
        }, arguments); },
        __wbg_require_9a7d8cc2e1d275c0: function() { return handleError(function () {
            const ret = module.require;
            return ret;
        }, arguments); },
        __wbg_static_accessor_GLOBAL_THIS_003ee833af9699fc: function() {
            const ret = typeof globalThis === 'undefined' ? undefined : globalThis;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_static_accessor_GLOBAL_e4293fb22cbe77da: function() {
            const ret = typeof global === 'undefined' ? undefined : global;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_static_accessor_SELF_53bb20457401453d: function() {
            const ret = typeof self === 'undefined' ? undefined : self;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_static_accessor_WINDOW_b5e0810bfecb7feb: function() {
            const ret = typeof window === 'undefined' ? undefined : window;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_subarray_58f388a9247ac0bb: function(arg0, arg1, arg2) {
            const ret = arg0.subarray(arg1 >>> 0, arg2 >>> 0);
            return ret;
        },
        __wbg_versions_6e128a981b0df859: function(arg0) {
            const ret = arg0.versions;
            return ret;
        },
        __wbindgen_generic_0000000000000001: function(arg0, arg1) {
            // Cast intrinsic for `Ref(Slice(U8)) -> NamedExternref("Uint8Array")`.
            const ret = getArrayU8FromWasm0(arg0, arg1);
            return ret;
        },
        __wbindgen_generic_0000000000000002: function(arg0, arg1) {
            // Cast intrinsic for `Ref(String) -> Externref`.
            const ret = getStringFromWasm0(arg0, arg1);
            return ret;
        },
        __wbindgen_init_externref_table: function() {
            const table = wasm.__wbindgen_externrefs;
            table.set(0, undefined);
            table.set(1024, undefined);
            table.set(1025, null);
            table.set(1026, true);
            table.set(1027, false);
        },
    };
    return {
        __proto__: null,
        "./orbyn_wasm_bg.js": import0,
    };
}

const ApproverSessionFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_approversession_free(ptr, 1));
const DeviceKeysFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_devicekeys_free(ptr, 1));
const DeviceSessionFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_devicesession_free(ptr, 1));
const PendingLoginFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_pendinglogin_free(ptr, 1));
const PendingRegistrationFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_pendingregistration_free(ptr, 1));
const SyncEngineFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_syncengine_free(ptr, 1));

function addToExternrefTable0(obj) {
    const idx = wasm.__wbindgen_export2();
    wasm.__wbindgen_externrefs.set(idx, obj);
    return idx;
}

function _assertClass(instance, klass) {
    if (!(instance instanceof klass)) {
        throw new Error(`expected instance of ${klass.name}`);
    }
}

function getArrayU8FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
}

let cachedDataViewMemory0 = null;
function getDataViewMemory0() {
    if (cachedDataViewMemory0 === null || cachedDataViewMemory0.buffer.detached === true || (cachedDataViewMemory0.buffer.detached === undefined && cachedDataViewMemory0.buffer !== wasm.memory.buffer)) {
        cachedDataViewMemory0 = new DataView(wasm.memory.buffer);
    }
    return cachedDataViewMemory0;
}

function getStringFromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return decodeText(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function handleError(f, args) {
    try {
        return f.apply(this, args);
    } catch (e) {
        const idx = addToExternrefTable0(e);
        wasm.__wbindgen_export(idx);
    }
}

function isLikeNone(x) {
    return x === undefined || x === null;
}

function passArray8ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 1, 1) >>> 0;
    getUint8ArrayMemory0().set(arg, ptr / 1);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passStringToWasm0(arg, malloc, realloc) {
    if (realloc === undefined) {
        const buf = cachedTextEncoder.encode(arg);
        const ptr = malloc(buf.length, 1) >>> 0;
        getUint8ArrayMemory0().subarray(ptr, ptr + buf.length).set(buf);
        WASM_VECTOR_LEN = buf.length;
        return ptr;
    }

    let len = arg.length;
    let ptr = malloc(len, 1) >>> 0;

    const mem = getUint8ArrayMemory0();

    let offset = 0;

    for (; offset < len; offset++) {
        const code = arg.charCodeAt(offset);
        if (code > 0x7F) break;
        mem[ptr + offset] = code;
    }
    if (offset !== len) {
        if (offset !== 0) {
            arg = arg.slice(offset);
        }
        ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
        const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
        const ret = cachedTextEncoder.encodeInto(arg, view);

        offset += ret.written;
        ptr = realloc(ptr, len, offset, 1) >>> 0;
    }

    WASM_VECTOR_LEN = offset;
    return ptr;
}

function takeFromExternrefTable0(idx) {
    const value = wasm.__wbindgen_externrefs.get(idx);
    wasm.__wbindgen_export4(idx);
    return value;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true });
cachedTextDecoder.decode();
const MAX_SAFARI_DECODE_BYTES = 2146435072;
let numBytesDecoded = 0;
function decodeText(bytes) {
    numBytesDecoded += bytes.length;
    if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
        cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true });
        cachedTextDecoder.decode();
        numBytesDecoded = bytes.length;
    }
    return cachedTextDecoder.decode(bytes);
}

const cachedTextEncoder = new TextEncoder();

if (!('encodeInto' in cachedTextEncoder)) {
    cachedTextEncoder.encodeInto = function (arg, view) {
        const buf = cachedTextEncoder.encode(arg);
        view.set(buf);
        return {
            read: arg.length,
            written: buf.length
        };
    };
}

let WASM_VECTOR_LEN = 0;

let wasmModule, wasmInstance, wasm;
function __wbg_finalize_init(instance, module) {
    wasmInstance = instance;
    wasm = instance.exports;
    wasmModule = module;
    cachedDataViewMemory0 = null;
    cachedUint8ArrayMemory0 = null;
    wasm.__wbindgen_start();
    return wasm;
}

async function __wbg_load(module, imports) {
    if (typeof Response === 'function' && module instanceof Response) {
        if (!module.ok) {
            throw new Error(`failed to fetch Wasm: ${module.status} ${module.statusText} fetching '${module.url}'`);
        }

        if (typeof WebAssembly.instantiateStreaming === 'function') {
            try {
                return await WebAssembly.instantiateStreaming(module, imports);
            } catch (e) {
                const validResponse = expectedResponseType(module.type);

                if (validResponse && module.headers.get('Content-Type') !== 'application/wasm') {
                    console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);

                } else { throw e; }
            }
        }

        const bytes = await module.arrayBuffer();
        return await WebAssembly.instantiate(bytes, imports);
    } else {
        const instance = await WebAssembly.instantiate(module, imports);

        if (instance instanceof WebAssembly.Instance) {
            return { instance, module };
        } else {
            return instance;
        }
    }

    function expectedResponseType(type) {
        switch (type) {
            case 'basic': case 'cors': case 'default': return true;
        }
        return false;
    }
}

function initSync(module) {
    if (wasm !== undefined) return wasm;


    if (module !== undefined) {
        if (Object.getPrototypeOf(module) === Object.prototype) {
            ({module} = module)
        } else {
            console.warn('using deprecated parameters for `initSync()`; pass a single object instead')
        }
    }

    const imports = __wbg_get_imports();
    if (!(module instanceof WebAssembly.Module)) {
        module = new WebAssembly.Module(module);
    }
    const instance = new WebAssembly.Instance(module, imports);
    return __wbg_finalize_init(instance, module);
}

let __wbg_init_promise;
async function __wbg_init(module_or_path) {
    if (wasm !== undefined) return wasm;
    if (__wbg_init_promise === undefined) {
        __wbg_init_promise = __wbg_init_once(module_or_path);
        __wbg_init_promise.catch(() => { __wbg_init_promise = undefined; });
    }
    return __wbg_init_promise;
}

async function __wbg_init_once(module_or_path) {

    if (module_or_path !== undefined) {
        if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
            ({module_or_path} = module_or_path)
        } else {
            console.warn('using deprecated parameters for the initialization function; pass a single object instead')
        }
    }

    if (module_or_path === undefined) {
        module_or_path = new URL('orbyn_wasm_bg.wasm', import.meta.url);
    }
    const imports = __wbg_get_imports();

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module);
}

export { initSync, __wbg_init as default };
