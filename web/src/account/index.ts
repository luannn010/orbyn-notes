import { AccountError } from "../domain/contracts";
import type { AccountService, AccountSession } from "../domain/contracts";
import type { SessionCreated } from "../generated/contracts/SessionCreated";
import type { CurrentDevice } from "../generated/contracts/CurrentDevice";
import type { PendingApproval } from "../generated/contracts/PendingApproval";
import {
  loadEngine,
  DeviceKeys,
  SyncEngine,
  normalizeEmail,
  startRegistration,
  finishRegistration,
  startLogin,
  finishLogin,
} from "../data/engine";
import type { DeviceSession } from "../data/engine";
import {
  newWrappingKey,
  wrappingSecret,
  readRecord,
  mutateRecord,
  signupRecovery,
} from "../data/database";
import type {
  DeviceRecord,
  SignupRecord,
  LocalAccessGrant,
} from "../data/database";
import {
  session,
  establish,
  lock,
  onLock,
  lockVersion,
  beginLock,
  completeLock,
  cancelLock,
  isLocking,
  onCompletedLock,
} from "./session";
import { solveSignupProof } from "./proof";
export const subscribeLock = onCompletedLock;
function b64(bytes: Uint8Array): string {
  let s = "";
  for (const byte of bytes) s += String.fromCharCode(byte);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function unb64(s: string): Uint8Array {
  return Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) =>
    c.charCodeAt(0),
  );
}
type Candidate = {
  email: string;
  keys: DeviceKeys;
  wrapKey: CryptoKey;
  existing?: DeviceRecord;
  signupRecovery?: boolean;
};
type VerifiedApproval = {
  approvalId: string;
  code: string;
  snapshot: Uint8Array;
  signingKey: string;
};
const APPROVAL_ZONE = "notes-local-approval";
const APPROVAL_RECORD = "verified-checkpoint";
export function createAccountService(options?: {
  engineUrl?: string;
}): AccountService {
  const configured =
    options?.engineUrl ??
    (import.meta as ImportMeta & { env?: Record<string, string> }).env
      ?.VITE_ENGINE_URL;
  let base: string | undefined;
  if (configured) {
    try {
      const url = new URL(configured);
      if (
        url.protocol !== "https:" &&
        !(
          url.protocol === "http:" &&
          ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
        )
      )
        throw new Error();
      if (url.username || url.password || url.search || url.hash)
        throw new Error();
      base = url.href.replace(/\/$/, "");
    } catch {
      throw new AccountError(
        "engine_unavailable",
        "The account service address is invalid.",
      );
    }
  }
  let token: string | undefined;
  let expiry = 0;
  let candidate: Candidate | undefined;
  let secondFactorId: string | undefined;
  let approval:
    | { engine: SyncEngine; session: DeviceSession; view: PendingApproval }
    | undefined;
  let verifiedApproval: VerifiedApproval | undefined;
  let verifiedEmail: { signupId: string; response: SessionCreated } | undefined;
  let busy = false;
  let epoch = 0;
  let operationEpoch = 0;
  function assertOperation() {
    if (epoch !== operationEpoch)
      throw new AccountError("cancelled", "The account request was cancelled.");
  }
  function discard() {
    epoch++;
    token = undefined;
    expiry = 0;
    candidate?.keys.free();
    candidate = undefined;
    secondFactorId = undefined;
    approval?.session.free();
    approval?.engine.free();
    approval = undefined;
    verifiedApproval = undefined;
    verifiedEmail = undefined;
  }
  onLock(discard);
  async function request<T>(
    path: string,
    body?: unknown,
    method = "POST",
    authenticated = false,
  ): Promise<T> {
    if (!base)
      throw new AccountError(
        "engine_unavailable",
        "Set VITE_ENGINE_URL to connect to the account service.",
      );
    if (authenticated && (!token || Date.now() >= expiry))
      throw new AccountError("session_expired", "Sign in again to continue.");
    const requestEpoch = epoch;
    let response: Response;
    try {
      response = await fetch(base + path, {
        method,
        headers: {
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
          ...(authenticated ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        credentials: "omit",
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(20000),
      });
    } catch {
      throw new AccountError(
        "network_error",
        "The account service could not be reached. Please retry.",
      );
    }
    if (requestEpoch !== epoch)
      throw new AccountError("cancelled", "The account request was cancelled.");
    if (!response.ok) {
      if (authenticated && response.status === 401) {
        token = undefined;
        expiry = 0;
      }
      let data: Record<string, unknown> = {};
      try {
        data = await response.json();
      } catch {
        /* A proxy may return an empty error. */
      }
      const code =
        typeof data.code === "string" && /^[a-z_]{1,64}$/.test(data.code)
          ? data.code
          : "account_failed";
      if (
        response.status === 428 &&
        code === "proof_required" &&
        path === "/v1/accounts/register/finish" &&
        body &&
        typeof body === "object" &&
        !("proof" in body)
      ) {
        const proof = await solveSignupProof(
          { challenge: data.challenge, bits: data.bits },
          assertOperation,
        );
        return request<T>(path, { ...body, proof }, method, authenticated);
      }
      const messages: Record<string, string> = {
        invite_invalid: "This invitation is invalid or no longer available.",
        invalid_email_code: "Check the email code and try again.",
        too_many_attempts: "Too many attempts. Please try again later.",
        auth_failed: "Check your email and password and try again.",
        second_factor_required: "Enter your authenticator or recovery code.",
        second_factor_failed: "Check the code and try again.",
        proof_required:
          "The account service requires a sign-up proof. Please try again later.",
        email_unverified: "Verify your email before signing in.",
      };
      throw new AccountError(
        code,
        messages[code] ?? "The account request failed. Please retry.",
      );
    }
    if (response.status === 204) return undefined as T;
    try {
      return (await response.json()) as T;
    } catch {
      throw new AccountError(
        "invalid_response",
        "The account service returned an invalid response.",
      );
    }
  }
  async function exclusive<T>(operation: () => Promise<T>): Promise<T> {
    if (isLocking())
      throw new AccountError("logout_pending", "Wait for sign-out to finish.");
    if (busy)
      throw new AccountError(
        "request_busy",
        "Wait for the current account request to finish.",
      );
    busy = true;
    operationEpoch = epoch;
    try {
      return await operation();
    } catch (error) {
      if (error instanceof AccountError) throw error;
      const code =
        error instanceof Error
          ? /^([a-z_]+):/.exec(error.message)?.[1]
          : undefined;
      const known: Record<string, string> = {
        auth_failed: "Check your email and password and try again.",
        engine_unavailable: "The verified encryption engine could not load.",
        open_failed: "This browser’s saved keys could not be opened.",
        crypto_failed: "The encryption engine could not complete this request.",
        invalid_input: "The account request was invalid.",
      };
      throw new AccountError(
        code && known[code] ? code : "local_account_failed",
        code && known[code]
          ? known[code]!
          : "This browser could not complete the account request. Please retry.",
      );
    } finally {
      busy = false;
    }
  }
  async function email(input: string): Promise<string> {
    if (!base)
      throw new AccountError(
        "engine_unavailable",
        "Set VITE_ENGINE_URL to connect to the account service.",
      );
    await loadEngine();
    const normalized = normalizeEmail(input);
    if (!normalized)
      throw new AccountError("invalid_email", "Enter a valid email address.");
    return normalized;
  }
  async function prepare(address: string): Promise<Candidate> {
    const existing = await readRecord<DeviceRecord>("devices", address);
    const signup = existing ? undefined : await signupRecovery(address);
    const wrapKey =
      existing?.wrapKey ?? signup?.wrapKey ?? (await newWrappingKey());
    let keys: DeviceKeys;
    if (existing || signup) {
      const secret = await wrappingSecret(wrapKey);
      try {
        keys = DeviceKeys.import((existing ?? signup)!.sealedKeys, secret);
      } finally {
        secret.fill(0);
      }
    } else keys = DeviceKeys.create();
    return {
      email: address,
      keys,
      wrapKey,
      existing,
      signupRecovery: !!signup,
    };
  }
  function device(keys: DeviceKeys) {
    return {
      name: "Notes browser",
      platform: "web" as const,
      signing_key: keys.signingKey(),
      agreement_key: keys.agreementKey(),
    };
  }
  async function accept(
    response: SessionCreated,
    source: Candidate,
    firstDevice = false,
  ): Promise<AccountSession> {
    if (
      !response ||
      typeof response.token !== "string" ||
      !response.token ||
      !["trusted", "pending"].includes(response.device_state) ||
      ![response.account_id, response.device_id].every(
        (v) => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v),
      ) ||
      !Number.isFinite(Date.parse(response.expires_at))
    )
      throw new AccountError(
        "invalid_response",
        "The account service returned an invalid session.",
      );
    if (
      response.device_state === "trusted" &&
      !firstDevice &&
      !source.existing?.verifiedTrust &&
      !source.signupRecovery
    )
      throw new AccountError(
        "device_approval_unverified",
        "This browser has not verified its device approval. Complete approval before opening its library.",
      );
    if (
      source.existing &&
      (source.existing.accountId !== response.account_id ||
        source.existing.deviceId !== response.device_id)
    )
      throw new AccountError(
        "device_mismatch",
        "The service returned a different device. Existing browser keys were preserved.",
      );
    const secret = await wrappingSecret(source.wrapKey);
    try {
      const sealedKeys = source.keys.export(secret);
      await mutateRecord<DeviceRecord>("devices", source.email, (current) => {
        assertOperation();
        if (
          current &&
          (current.accountId !== response.account_id ||
            current.deviceId !== response.device_id)
        )
          throw new AccountError(
            "device_conflict",
            "Another sign-in changed this browser’s account. Please retry.",
          );
        return (
          current ?? {
            email: source.email,
            accountId: response.account_id,
            deviceId: response.device_id,
            wrapKey: source.wrapKey,
            sealedKeys,
            generation: 0,
            verifiedTrust:
              (firstDevice || !!source.signupRecovery) &&
              response.device_state === "trusted",
          }
        );
      });
    } finally {
      secret.fill(0);
    }
    const value: AccountSession = {
      accountId: response.account_id,
      deviceId: response.device_id,
      email: source.email,
      deviceState: response.device_state,
    };
    const signingKey = source.keys.signingKey();
    await mutateRecord<LocalAccessGrant>("access", "active", () => {
      assertOperation();
      return value.deviceState === "trusted"
        ? {
            email: value.email,
            accountId: value.accountId,
            deviceId: value.deviceId,
            signingKey,
          }
        : undefined;
    });
    // establish closes previous stores; install bearer only after that lock callback ran.
    assertOperation();
    establish(value);
    token = response.token;
    expiry = Date.parse(response.expires_at);
    return value;
  }
  async function activeDevice(): Promise<CurrentDevice> {
    const current = session();
    if (!current) throw new AccountError("locked", "Sign in to continue.");
    const view = await request<CurrentDevice>(
      "/v1/devices/current",
      undefined,
      "GET",
      true,
    );
    if (view.device.id !== current.deviceId)
      throw new AccountError(
        "device_mismatch",
        "The service returned a different device.",
      );
    return view;
  }
  async function approvalCheckpoint(
    current: AccountSession,
  ): Promise<VerifiedApproval | undefined> {
    if (verifiedApproval) return verifiedApproval;
    const stored = await readRecord<DeviceRecord>("devices", current.email);
    if (
      !stored?.verifiedTrust ||
      !stored.approvalCheckpointId ||
      !stored.snapshot
    )
      return undefined;
    const secret = await wrappingSecret(stored.wrapKey);
    let keys: DeviceKeys | undefined;
    let engine: SyncEngine | undefined;
    try {
      keys = DeviceKeys.import(stored.sealedKeys, secret);
      engine = SyncEngine.restore(keys, stored.snapshot, secret, Date.now());
      const raw = engine.record(APPROVAL_ZONE, APPROVAL_RECORD);
      if (!raw)
        throw new AccountError(
          "approval_checkpoint_invalid",
          "The saved device approval could not be restored.",
        );
      const fields = JSON.parse(raw).fields;
      const approvalId = fields.approvalId?.value,
        code = fields.code?.value;
      if (
        approvalId !== stored.approvalCheckpointId ||
        typeof code !== "string" ||
        !/^\d{6}$/.test(code)
      )
        throw new AccountError(
          "approval_checkpoint_invalid",
          "The saved device approval could not be restored.",
        );
      verifiedApproval = {
        approvalId,
        code,
        snapshot: stored.snapshot,
        signingKey: keys.signingKey(),
      };
      return verifiedApproval;
    } finally {
      engine?.free();
      keys?.free();
      secret.fill(0);
    }
  }
  async function finishVerifiedApproval(
    current: AccountSession,
    checkpoint: VerifiedApproval,
  ): Promise<AccountSession> {
    // Durable local cryptographic evidence precedes the irreversible server effect.
    // If this aborts, the in-memory receipt survives so the consumed ceremony is not needed again.
    await mutateRecord<DeviceRecord>("devices", current.email, (record) => {
      assertOperation();
      if (
        !record ||
        record.accountId !== current.accountId ||
        record.deviceId !== current.deviceId
      )
        throw new AccountError(
          "device_mismatch",
          "This browser’s account device changed.",
        );
      return {
        ...record,
        verifiedTrust: true,
        approvalCheckpointId: checkpoint.approvalId,
        snapshot: checkpoint.snapshot,
        generation: record.generation + 1,
      };
    });
    let view = await activeDevice();
    if (view.device.state !== "trusted") {
      if (view.approval?.id !== checkpoint.approvalId)
        throw new AccountError(
          "approval_expired",
          "This verified approval is no longer active. Start device approval again.",
        );
      await request(
        `/v1/devices/approvals/${checkpoint.approvalId}/code`,
        { code: checkpoint.code },
        "POST",
        true,
      );
      view = await activeDevice();
    }
    if (view.device.state !== "trusted")
      throw new AccountError(
        "approval_waiting",
        "The device has not been approved.",
      );
    // A network failure after POST is recovered by reading current state next time;
    // a grant-write failure is recovered from the already sealed checkpoint after reload.
    await mutateRecord<LocalAccessGrant>("access", "active", () => {
      assertOperation();
      return {
        email: current.email,
        accountId: current.accountId,
        deviceId: current.deviceId,
        signingKey: checkpoint.signingKey,
      };
    });
    const value: AccountSession = { ...current, deviceState: "trusted" };
    const bearer = token,
      expires = expiry;
    assertOperation();
    establish(value);
    token = bearer;
    expiry = expires;
    return value;
  }
  return {
    current: async () => {
      if (isLocking()) return null;
      // Retained local access is distinct from the HTTP bearer session, which is never persisted.
      if (expiry && Date.now() >= expiry) {
        token = undefined;
        expiry = 0;
      }
      const active = session();
      if (active) return active;
      const before = lockVersion();
      const grant = await readRecord<LocalAccessGrant>("access", "active");
      if (!grant) return null;
      const stored = await readRecord<DeviceRecord>("devices", grant.email);
      if (
        !stored ||
        !stored.verifiedTrust ||
        stored.accountId !== grant.accountId ||
        stored.deviceId !== grant.deviceId
      )
        throw new AccountError(
          "local_access_invalid",
          "Saved local access does not match this browser’s keys. Sign in again.",
        );
      await loadEngine();
      const secret = await wrappingSecret(stored.wrapKey);
      let keys: DeviceKeys | undefined;
      try {
        keys = DeviceKeys.import(stored.sealedKeys, secret);
        if (keys.signingKey() !== grant.signingKey)
          throw new AccountError(
            "local_access_invalid",
            "Saved local access does not match this browser’s keys. Sign in again.",
          );
      } finally {
        keys?.free();
        secret.fill(0);
      }
      if (before !== lockVersion() || isLocking()) return session();
      const value: AccountSession = {
        email: grant.email,
        accountId: grant.accountId,
        deviceId: grant.deviceId,
        deviceState: "trusted",
      };
      establish(value);
      return value;
    },
    checkInvite: (invite) =>
      exclusive(() => request<void>("/v1/invites/check", { invite })),
    register: (input) =>
      exclusive(async () => {
        const address = await email(input.email);
        if (input.password.length < 1 || input.password.length > 1024)
          throw new AccountError(
            "invalid_password",
            "Enter a password of at most 1024 characters.",
          );
        const wrapKey = await newWrappingKey();
        const keys = DeviceKeys.create();
        const password = new TextEncoder().encode(input.password);
        let pending: ReturnType<typeof startRegistration> | undefined;
        try {
          pending = startRegistration(password);
          const started = await request<{ registration_response: string }>(
            "/v1/accounts/register/start",
            { email: address, registration_request: b64(pending.request) },
          );
          const upload = finishRegistration(
            pending,
            password,
            unb64(started.registration_response),
          );
          const finished = await request<{ signup_id: string }>(
            "/v1/accounts/register/finish",
            {
              email: address,
              registration_upload: b64(upload),
              device: device(keys),
              device_signature: b64(keys.signRegistration(address, upload)),
              invite: input.invite,
            },
          );
          if (typeof finished.signup_id !== "string")
            throw new AccountError(
              "invalid_response",
              "Missing sign-up identifier.",
            );
          const secret = await wrappingSecret(wrapKey);
          try {
            const value: SignupRecord = {
              email: address,
              wrapKey,
              sealedKeys: keys.export(secret),
              createdAt: Date.now(),
            };
            await mutateRecord<SignupRecord>(
              "signups",
              finished.signup_id,
              () => {
                assertOperation();
                return value;
              },
            );
          } finally {
            secret.fill(0);
          }
          return { signupId: finished.signup_id };
        } finally {
          password.fill(0);
          pending?.free();
          keys.free();
        }
      }),
    verifyEmail: (input) =>
      exclusive(async () => {
        await loadEngine();
        const stored = await readRecord<SignupRecord>(
          "signups",
          input.signupId,
        );
        if (!stored)
          throw new AccountError(
            "signup_missing",
            "Start sign-up again in this browser.",
          );
        const secret = await wrappingSecret(stored.wrapKey);
        let keys: DeviceKeys;
        try {
          keys = DeviceKeys.import(stored.sealedKeys, secret);
        } finally {
          secret.fill(0);
        }
        try {
          // Retain the original registering keys and durable verification intent before
          // the server consumes its one-time code. Reload recovery logs in with THESE
          // keys, never a newly generated pending device.
          await mutateRecord<SignupRecord>(
            "signups",
            input.signupId,
            (current) => {
              assertOperation();
              if (!current)
                throw new AccountError(
                  "signup_missing",
                  "Start sign-up again in this browser.",
                );
              return { ...current, verificationAttempted: true };
            },
          );
          const response =
            verifiedEmail?.signupId === input.signupId
              ? verifiedEmail.response
              : await request<SessionCreated>("/v1/accounts/email/verify", {
                  signup_id: input.signupId,
                  code: input.code,
                });
          verifiedEmail = { signupId: input.signupId, response };
          const value = await accept(
            response,
            {
              email: stored.email,
              keys,
              wrapKey: stored.wrapKey,
            },
            true,
          );
          try {
            await mutateRecord<SignupRecord>(
              "signups",
              input.signupId,
              () => undefined,
            );
          } catch {
            /* Session/grant already committed; an obsolete sealed recovery receipt can be cleaned on a later account operation. */
          }
          return value;
        } finally {
          keys.free();
        }
      }),
    resendEmail: (signupId) =>
      exclusive(() =>
        request<void>("/v1/accounts/email/resend", { signup_id: signupId }),
      ),
    signIn: (input) =>
      exclusive(async () => {
        const address = await email(input.email);
        candidate?.keys.free();
        candidate = undefined;
        secondFactorId = undefined;
        const source = await prepare(address);
        const password = new TextEncoder().encode(input.password);
        let pending: ReturnType<typeof startLogin> | undefined;
        let retain = false;
        try {
          pending = startLogin(password);
          const credential = pending.request;
          const signedAt = Math.floor(Date.now() / 1000);
          const started = await request<{
            login_id: string;
            credential_response: string;
          }>("/v1/sessions/login/start", {
            email: address,
            credential_request: b64(credential),
            ...(source.existing
              ? {
                  trusted_device: {
                    signing_key: source.keys.signingKey(),
                    signed_at: signedAt,
                    signature: b64(
                      source.keys.signTrustedStart(
                        address,
                        credential,
                        signedAt,
                      ),
                    ),
                  },
                }
              : {}),
          });
          const finalization = finishLogin(
            pending,
            password,
            unb64(started.credential_response),
          );
          let response: SessionCreated;
          try {
            response = await request<SessionCreated>(
              "/v1/sessions/login/finish",
              {
                login_id: started.login_id,
                credential_finalization: b64(finalization),
                device: device(source.keys),
                device_signature: b64(source.keys.signLogin(started.login_id)),
              },
            );
          } catch (error) {
            if (
              error instanceof AccountError &&
              error.code === "second_factor_required"
            ) {
              candidate = source;
              secondFactorId = started.login_id;
              retain = true;
            }
            throw error;
          }
          return await accept(response, source);
        } finally {
          password.fill(0);
          pending?.free();
          if (!retain) source.keys.free();
        }
      }),
    completeSecondFactor: (input) =>
      exclusive(async () => {
        if (!candidate || !secondFactorId)
          throw new AccountError("login_missing", "Start sign-in again.");
        const source = candidate;
        const response = await request<SessionCreated>(
          "/v1/sessions/login/second-factor",
          {
            login_id: secondFactorId,
            code: input.code ?? null,
            recovery_code: input.recoveryCode ?? null,
          },
        );
        return accept(response, source);
      }),
    pendingDevice: () =>
      exclusive(async () => {
        const current = session();
        if (!current) throw new AccountError("locked", "Sign in to continue.");
        if (current.deviceState === "trusted")
          return { status: "trusted" as const };
        const checkpoint = await approvalCheckpoint(current);
        if (checkpoint) {
          await finishVerifiedApproval(current, checkpoint);
          return { status: "trusted" as const };
        }
        const view = await activeDevice();
        if (view.device.state === "trusted")
          throw new AccountError(
            "approval_restart",
            "Sign in again to resume this approved device.",
          );
        if (!view.approval) return { status: "waiting" as const };
        if (!approval || approval.view.id !== view.approval.id) {
          approval?.session.free();
          approval?.engine.free();
          approval = undefined;
          const stored = await readRecord<DeviceRecord>(
            "devices",
            current.email,
          );
          if (!stored)
            throw new AccountError(
              "keys_missing",
              "This browser has no device keys.",
            );
          const secret = await wrappingSecret(stored.wrapKey);
          let keys: DeviceKeys | undefined;
          let engine: SyncEngine | undefined;
          try {
            keys = DeviceKeys.import(stored.sealedKeys, secret);
            engine = SyncEngine.create(
              keys,
              current.accountId,
              current.deviceId,
            );
            const joined = engine.joinApproval(
              JSON.stringify(view.approval),
              Date.now() / 1000,
            );
            approval = { engine, session: joined, view: view.approval };
            engine = undefined;
          } finally {
            engine?.free();
            keys?.free();
            secret.fill(0);
          }
        }
        approval.view = view.approval;
        if (!view.approval.device_nonce)
          await request(
            `/v1/devices/approvals/${view.approval.id}/nonce`,
            JSON.parse(approval.session.nonceJson),
            "POST",
            true,
          );
        if (!view.approval.approver_nonce)
          return { status: "waiting" as const };
        return {
          status: "compare" as const,
          sas: approval.session.sas(JSON.stringify(view.approval)),
        };
      }),
    confirmDevice: (code) =>
      exclusive(async () => {
        const current = session();
        if (!current) throw new AccountError("locked", "Sign in to continue.");
        if (current.deviceState === "trusted") return current;
        const checkpoint = await approvalCheckpoint(current);
        if (checkpoint) return finishVerifiedApproval(current, checkpoint);
        if (!approval)
          throw new AccountError(
            "approval_missing",
            "Refresh device approval first.",
          );
        const view = await activeDevice();
        if (
          !view.approval ||
          view.approval.id !== approval.view.id ||
          !view.approval.signature
        )
          throw new AccountError(
            "approval_waiting",
            "Confirm the matching digits on your trusted device first.",
          );
        const ceremony = approval;
        approval = undefined;
        try {
          const verifiedCode = ceremony.engine.finishApproval(
            ceremony.session,
            JSON.stringify(view.approval),
            code,
            Date.now() / 1000,
          );
          const stored = await readRecord<DeviceRecord>(
            "devices",
            current.email,
          );
          if (!stored)
            throw new AccountError(
              "keys_missing",
              "This browser has no device keys.",
            );
          const secret = await wrappingSecret(stored.wrapKey);
          let keys: DeviceKeys | undefined;
          try {
            keys = DeviceKeys.import(stored.sealedKeys, secret);
            ceremony.engine.createZoneKey(APPROVAL_ZONE);
            const stamp = JSON.parse(ceremony.engine.tick(Date.now()));
            ceremony.engine.stage(
              APPROVAL_ZONE,
              "approval_checkpoint",
              APPROVAL_RECORD,
              JSON.stringify({
                approvalId: { value: view.approval.id, stamp },
                code: { value: verifiedCode, stamp },
              }),
            );
            verifiedApproval = {
              approvalId: view.approval.id,
              code: verifiedCode,
              snapshot: ceremony.engine.snapshot(secret),
              signingKey: keys.signingKey(),
            };
          } finally {
            keys?.free();
            secret.fill(0);
          }
          return await finishVerifiedApproval(current, verifiedApproval!);
        } finally {
          ceremony.session.free();
          ceremony.engine.free();
        }
      }),
    cancelDevice: () =>
      exclusive(async () => {
        if (approval)
          await request(
            `/v1/devices/approvals/${approval.view.id}/cancel`,
            {},
            "POST",
            true,
          );
        lock();
      }),
    signOut: async () => {
      const bearer = token;
      const address = base;
      beginLock();
      try {
        await mutateRecord<LocalAccessGrant>(
          "access",
          "active",
          () => undefined,
        );
      } catch {
        cancelLock();
        throw new AccountError(
          "local_lock_failed",
          "Sign-out could not be saved in this browser. Please retry.",
        );
      }
      completeLock();
      if (bearer && address) {
        try {
          const response = await fetch(address + "/v1/sessions/current", {
            method: "DELETE",
            headers: { Authorization: `Bearer ${bearer}` },
            credentials: "omit",
            redirect: "error",
            signal: AbortSignal.timeout(10000),
          });
          if (!response.ok && response.status !== 401) throw new Error();
        } catch {
          throw new AccountError(
            "revoke_failed",
            "This browser is locked. The server session could not be revoked; retry when online.",
          );
        }
      }
    },
  };
}
