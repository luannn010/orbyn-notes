import type { AccountSession } from "../domain/contracts";
import { AccountError } from "../domain/contracts";
let active: AccountSession | null = null;
let version = 0;
let locking = false;
const listeners = new Set<() => void>();
const completedListeners = new Set<() => void>();
const channel =
  typeof BroadcastChannel === "undefined"
    ? null
    : new BroadcastChannel("orbyn-notes-lock-v1");
channel?.addEventListener("message", (event) => {
  const message = event.data;
  if (
    message?.type === "lock" ||
    (message?.type === "account" &&
      (!active ||
        active.accountId !== message.accountId ||
        active.deviceId !== message.deviceId))
  )
    lock(false);
});
export function session(): AccountSession | null {
  return active ? { ...active } : null;
}
export function establish(value: AccountSession): void {
  if (locking)
    throw new AccountError("logout_pending", "Wait for sign-out to finish.");
  lock(false);
  active = { ...value };
  // Same-account windows may edit together; switching accounts locks other windows.
  channel?.postMessage({
    type: "account",
    accountId: value.accountId,
    deviceId: value.deviceId,
  });
}
export function lockVersion(): number {
  return version;
}
export function lock(broadcast = true): void {
  version++;
  active = null;
  for (const listener of listeners) listener();
  if (!locking) {
    for (const listener of completedListeners) listener();
    if (broadcast) channel?.postMessage({ type: "lock" });
  }
}
// Internal invalidation is immediate. Public completion waits for durable grant removal.
export function beginLock(): void {
  locking = true;
  lock(false);
}
export function completeLock(): void {
  locking = false;
  lock();
}
export function cancelLock(): void {
  locking = false;
}
export function isLocking(): boolean {
  return locking;
}
export function onCompletedLock(listener: () => void): () => void {
  completedListeners.add(listener);
  return () => completedListeners.delete(listener);
}
export function onLock(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export function requireSession(accountId: string, deviceId: string): void {
  if (
    !active ||
    active.accountId !== accountId ||
    active.deviceId !== deviceId ||
    active.deviceState !== "trusted"
  )
    throw new AccountError(
      "locked",
      "Sign in to unlock this browser’s library.",
    );
}
