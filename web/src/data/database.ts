export type DeviceRecord = {
  email: string;
  accountId: string;
  deviceId: string;
  wrapKey: CryptoKey;
  sealedKeys: Uint8Array;
  snapshot?: Uint8Array;
  generation: number;
  verifiedTrust?: boolean;
  approvalCheckpointId?: string;
};
export type SignupRecord = {
  email: string;
  wrapKey: CryptoKey;
  sealedKeys: Uint8Array;
  createdAt: number;
  verificationAttempted?: boolean;
};
export async function signupRecovery(
  email: string,
): Promise<SignupRecord | undefined> {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("signups", "readonly");
      const cursor = tx.objectStore("signups").openCursor();
      let latest: SignupRecord | undefined;
      cursor.onsuccess = () => {
        const current = cursor.result;
        if (!current) return;
        const value = current.value as SignupRecord;
        if (
          value.email === email &&
          value.verificationAttempted &&
          (!latest || value.createdAt > latest.createdAt)
        )
          latest = value;
        current.continue();
      };
      tx.oncomplete = () => resolve(latest);
      tx.onabort = () =>
        reject(
          tx.error ??
            new Error("storage_failed: Signup recovery read aborted."),
        );
      tx.onerror = () => {};
    });
  } finally {
    db.close();
  }
}
export type LocalAccessGrant = {
  email: string;
  accountId: string;
  deviceId: string;
  signingKey: string;
};
export function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let failed = false;
    const request = indexedDB.open("orbyn-notes-local-v1", 3);
    request.onupgradeneeded = () => {
      if (failed) {
        request.transaction?.abort();
        return;
      }
      for (const store of ["devices", "signups", "access"])
        if (!request.result.objectStoreNames.contains(store))
          request.result.createObjectStore(store);
    };
    request.onsuccess = () => {
      const db = request.result;
      if (failed) {
        db.close();
        return;
      }
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => {
      failed = true;
      reject(
        new Error("storage_blocked: Close other Notes windows and retry."),
      );
    };
  });
}
export async function readRecord<T>(
  store: string,
  key: string,
): Promise<T | undefined> {
  const db = await openDatabase();
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const tx = db.transaction(store, "readonly");
      const req = tx.objectStore(store).get(key);
      let value: T | undefined;
      req.onsuccess = () => {
        value = req.result as T | undefined;
      };
      tx.oncomplete = () => resolve(value);
      tx.onabort = () =>
        reject(tx.error ?? new Error("storage_failed: Read aborted."));
      tx.onerror = () => {};
    });
  } finally {
    db.close();
  }
}
// Callback must be synchronous: WebCrypto/WASM preparation happens before this atomic CAS.
// Explicitly skip a put without changing the existing in-place callback contract.
export const UNCHANGED_RECORD: unique symbol = Symbol("unchanged-record");
export async function mutateRecord<T>(
  store: string,
  key: string,
  change: (current: T | undefined) => T | undefined | typeof UNCHANGED_RECORD,
): Promise<void> {
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(store, "readwrite");
      const objectStore = tx.objectStore(store);
      const req = objectStore.get(key);
      let failure: unknown;
      req.onsuccess = () => {
        try {
          const current = req.result as T | undefined;
          const next = change(current);
          if (next && typeof (next as { then?: unknown }).then === "function") {
            void Promise.resolve(next).catch(() => {});
            throw new Error(
              "storage_failed: Transaction callbacks must be synchronous.",
            );
          }
          if (next === UNCHANGED_RECORD) return;
          if (next === undefined) objectStore.delete(key);
          else objectStore.put(next, key);
        } catch (error) {
          failure = error;
          tx.abort();
        }
      };
      tx.oncomplete = () => resolve();
      tx.onabort = () =>
        reject(
          failure ?? tx.error ?? new Error("storage_failed: Write aborted."),
        );
      tx.onerror = () => {};
    });
  } finally {
    db.close();
  }
}
export async function wrappingSecret(key: CryptoKey): Promise<Uint8Array> {
  return new Uint8Array(
    await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode("orbyn/local-wrap/v1"),
    ),
  );
}
export function newWrappingKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
}
