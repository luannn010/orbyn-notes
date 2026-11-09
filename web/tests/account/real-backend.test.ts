// @vitest-environment node
import { it, expect } from "vitest";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { IDBFactory } from "fake-indexeddb";
import { initSync } from "../../src/generated/wasm/orbyn_wasm.js";
import { createAccountService } from "../../src/account";
import { lock } from "../../src/account/session";
import { openNotesStore } from "../../src/data";
const engineUrl = process.env.NOTES_TEST_ENGINE_URL;
const invite = process.env.NOTES_TEST_INVITE;
const mailbox = process.env.NOTES_TEST_MAILBOX;
// Explicit opt-in only. No account test may contact a configured production service.
it.skipIf(!engineUrl || !invite || !mailbox)(
  "real local OPAQUE, synthetic email, retained offline library and pending new device",
  async () => {
    const url = new URL(engineUrl!);
    expect(["127.0.0.1", "localhost", "[::1]"]).toContain(url.hostname);
    initSync({
      module: await readFile(
        new URL("../../src/generated/wasm/orbyn_wasm_bg.wasm", import.meta.url),
      ),
    });
    Object.defineProperty(globalThis, "indexedDB", {
      value: new IDBFactory(),
      configurable: true,
    });
    lock();
    const service = createAccountService({ engineUrl });
    const email = `notes-real-${Date.now()}@example.test`;
    const password = "Synthetic-only-OPAQUE-fixture-2026!";
    await service.checkInvite(invite!);
    const signup = await service.register({ email, password, invite: invite! });
    let code: string | undefined;
    const deadline = Date.now() + 45000;
    while (!code && Date.now() < deadline) {
      for (const filename of await readdir(mailbox!)) {
        if (!filename.endsWith(".eml")) continue;
        const message = await readFile(join(mailbox!, filename), "utf8");
        if (message.includes(email)) {
          code = /^Subject:.*?code is ([A-Z0-9-]+)/im.exec(message)?.[1];
          if (code) break;
        }
      }
      if (!code) await new Promise((resolve) => setTimeout(resolve, 500));
    }
    expect(
      code,
      "Synthetic TLS SMTP verification email within45s",
    ).toBeTruthy();
    const verified = await service.verifyEmail({
      signupId: signup.signupId,
      code: code!,
    });
    expect(verified.deviceState).toBe("trusted");
    const store = await openNotesStore(verified);
    const note = await store.create({
      title: "Real OPAQUE retained fixture",
      document: { type: "doc", content: [] },
      tags: ["synthetic"],
    });
    lock(false);
    const local = createAccountService();
    expect(await local.current()).toEqual(verified);
    const reopened = await openNotesStore(verified);
    expect(await reopened.get(note.id)).toEqual(note);
    await local.signOut();
    expect(await createAccountService().current()).toBeNull();
    const signedIn = await service.signIn({ email, password });
    expect(signedIn).toEqual(verified);
    const signedInStore = await openNotesStore(signedIn);
    expect(await signedInStore.get(note.id)).toEqual(note);
    await expect(
      service.signIn({ email, password: "wrong-synthetic-password" }),
    ).rejects.toMatchObject({ code: "auth_failed" });
    expect(await signedInStore.get(note.id)).toEqual(note);
    await service.signOut();
    Object.defineProperty(globalThis, "indexedDB", {
      value: new IDBFactory(),
      configurable: true,
    });
    const fresh = createAccountService({ engineUrl });
    const pending = await fresh.signIn({ email, password });
    expect(pending.deviceState).toBe("pending");
    expect(await fresh.pendingDevice()).toEqual({ status: "waiting" });
    await expect(openNotesStore(pending)).rejects.toThrow("Sign in");
    await fresh.signOut();
    expect(await createAccountService().current()).toBeNull();
  },
  90000,
);
