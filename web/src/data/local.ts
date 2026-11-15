import type { AccountSession } from "../domain/contracts";
import { establish, lockVersion, session } from "../account/session";
import { AccountError } from "../domain/contracts";
import { DeviceKeys, loadEngine } from "./engine";
import {
  mutateRecord,
  newWrappingKey,
  wrappingSecret,
  type DeviceRecord,
} from "./database";

// Deliberately not an email address: account normalization can never select this key.
export const LOCAL_LIBRARY_KEY = "orbyn-notes:local-workspace";
const PREFERENCE = "orbyn-notes.local-only";

export function isLocalSession(value: Pick<AccountSession, "email">): boolean {
  return value.email === LOCAL_LIBRARY_KEY;
}

export function localModeSelected(): boolean {
  try {
    return localStorage.getItem(PREFERENCE) === "1";
  } catch {
    return false;
  }
}
export function selectLocalMode(selected: boolean): void {
  try {
    if (selected) localStorage.setItem(PREFERENCE, "1");
    else localStorage.removeItem(PREFERENCE);
  } catch {
    /* The explicit choice still applies in this tab. */
  }
}

/** Opens an isolated browser library. It creates no account, token or server trust grant. */
export async function openLocalSession(current: () => boolean = () => true): Promise<AccountSession> {
  const started = lockVersion();
  await loadEngine();
  const wrapKey = await newWrappingKey();
  const secret = await wrappingSecret(wrapKey);
  const keys = DeviceKeys.create();
  let saved: DeviceRecord | undefined;
  try {
    const candidate: DeviceRecord = {
      email: LOCAL_LIBRARY_KEY,
      accountId: crypto.randomUUID(),
      deviceId: crypto.randomUUID(),
      wrapKey,
      sealedKeys: keys.export(secret),
      generation: 0,
    };
    await mutateRecord<DeviceRecord>(
      "devices",
      LOCAL_LIBRARY_KEY,
      (current) => {
        if (current && current.email !== LOCAL_LIBRARY_KEY)
          throw new Error(
            "The local workspace identity is invalid. Saved data was not changed.",
          );
        saved = current ?? candidate;
        return saved;
      },
    );
  } finally {
    secret.fill(0);
    keys.free();
  }
  if (!saved) throw new Error("The local workspace could not be opened.");
  // The store's local session guard is shared; this state is never sent to the account API.
  const value: AccountSession = {
    email: LOCAL_LIBRARY_KEY,
    accountId: saved.accountId,
    deviceId: saved.deviceId,
    deviceState: "trusted",
  };
  const active = session();
  const same = active?.email === value.email && active.accountId === value.accountId && active.deviceId === value.deviceId;
  if (!current() || (lockVersion() !== started && !same))
    throw new AccountError("cancelled", "The local workspace request was cancelled.");
  if (!same) establish(value);
  return value;
}
