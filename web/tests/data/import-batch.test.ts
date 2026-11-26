// @vitest-environment node
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { initSync, DeviceKeys } from "../../src/generated/wasm/orbyn_wasm.js";
import { openNotesStore } from "../../src/data";
import { establish, lock } from "../../src/account/session";
import {
  mutateRecord,
  newWrappingKey,
  readRecord,
  wrappingSecret,
} from "../../src/data/database";
import type { DeviceRecord } from "../../src/data/database";
import type { NotesLibraryStore } from "../../src/library/contracts";
import type { Note } from "../../src/domain/contracts";

const identity = {
  accountId: "11111111-1111-4111-8111-111111111111",
  deviceId: "22222222-2222-4222-8222-222222222222",
  email: "import-batch@example.test",
  deviceState: "trusted" as const,
};
const input: Pick<Note, "title" | "document" | "tags"> = {
  title: "Synthetic import",
  document: {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text: "Retained writing" }],
      },
    ],
  },
  tags: ["Imported"],
};
const entries = () => [
  { creationId: crypto.randomUUID(), input },
  {
    creationId: crypto.randomUUID(),
    input: { ...input, title: "Second import" },
  },
];
const handles: NotesLibraryStore[] = [];
const open = async () => {
  const store = await openNotesStore(identity);
  handles.push(store);
  return store;
};
const ready = async (store: NotesLibraryStore) => {
  const read = await store.library.read();
  if (read.mode !== "ready") throw new Error("Fixture is not ready");
  return read.snapshot;
};
beforeAll(async () => {
  initSync({
    module: await readFile(
      new URL("../../src/generated/wasm/orbyn_wasm_bg.wasm", import.meta.url),
    ),
  });
});
beforeEach(async () => {
  lock();
  vi.stubGlobal("indexedDB", new IDBFactory());
  const wrapKey = await newWrappingKey(),
    secret = await wrappingSecret(wrapKey),
    keys = DeviceKeys.create();
  try {
    await mutateRecord<DeviceRecord>("devices", identity.email, () => ({
      ...identity,
      wrapKey,
      sealedKeys: keys.export(secret),
      generation: 0,
    }));
  } finally {
    keys.free();
    secret.fill(0);
  }
  establish(identity);
});
afterEach(() => {
  for (const handle of handles.splice(0)) handle.close();
  vi.restoreAllMocks();
  lock();
});

it("creates all imported notes with one encrypted device-record commit", async () => {
  const store = await open(),
    before = await ready(store),
    batch = entries();
  const prior = (await readRecord<DeviceRecord>("devices", identity.email))!;
  const put = vi.spyOn(IDBObjectStore.prototype, "put");
  // The baseline adapter exercises the existing import's per-note writer until
  // the optional batch capability is implemented; removal must fail this oracle.
  const created = store.createBatch
    ? await store.createBatch(batch, { expectedEpoch: before.token.epoch })
    : await (async () => {
        const result = [];
        for (const item of batch)
          result.push(await store.create(item.input, item.creationId));
        return result;
      })();
  expect(put.mock.calls).toHaveLength(1);
  expect(created.map((note) => note.id)).toEqual(
    batch.map((item) => item.creationId),
  );
  const after = await ready(store);
  expect(after.notes).toEqual(created);
  expect(after.metadata).toHaveLength(2);
  expect(after.tags.map((tag) => tag.name)).toEqual(["Imported"]);
  expect(after.token.revision).toBe(before.token.revision + 1);
  expect(
    (await readRecord<DeviceRecord>("devices", identity.email))!.generation,
  ).toBe(prior.generation + 1);
});

it("replays exact IDs without a put and rejects conflicting replay atomically", async () => {
  const store = await open(),
    before = await ready(store),
    batch = entries();
  const options = { expectedEpoch: before.token.epoch };
  const first = await store.createBatch!(batch, options);
  const put = vi.spyOn(IDBObjectStore.prototype, "put");
  expect(await store.createBatch!(batch, options)).toEqual(first);
  expect(put).not.toHaveBeenCalled();
  await expect(
    store.createBatch!(
      [
        { creationId: crypto.randomUUID(), input },
        { ...batch[0]!, input: { ...input, title: "Competing content" } },
      ],
      options,
    ),
  ).rejects.toMatchObject({ code: "revision_conflict" });
  expect(put).not.toHaveBeenCalled();
  expect((await ready(store)).notes).toEqual(first);
});

it("validates all inputs and chunk bounds before any writer opens", async () => {
  const store = await open(),
    state = await ready(store),
    options = { expectedEpoch: state.token.epoch };
  const sign = vi.spyOn(crypto.subtle, "sign");
  const put = vi.spyOn(IDBObjectStore.prototype, "put");
  await expect(
    store.createBatch!(
      [
        entries()[0]!,
        {
          creationId: crypto.randomUUID(),
          input: { ...input, title: "x".repeat(501) },
        },
      ],
      options,
    ),
  ).rejects.toThrow("invalid_note");
  const duplicate = entries()[0]!;
  await expect(
    store.createBatch!([duplicate, duplicate], options),
  ).rejects.toThrow("Creation IDs must be distinct");
  await expect(
    store.createBatch!(
      Array.from({ length: 11 }, () => entries()[0]!),
      options,
    ),
  ).rejects.toThrow("at most 10");
  const large = {
    ...input,
    document: {
      type: "doc" as const,
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "x".repeat(510_000) }],
        },
      ],
    },
  };
  await expect(
    store.createBatch!(
      entries().map((entry) => ({ ...entry, input: large })),
      options,
    ),
  ).rejects.toThrow("smaller transactions");
  expect(sign).not.toHaveBeenCalled();
  expect(put).not.toHaveBeenCalled();
});

it("rolls back the whole chunk on quota failure and retries the same IDs", async () => {
  const store = await open(),
    before = await ready(store),
    batch = entries(),
    options = { expectedEpoch: before.token.epoch };
  const put = vi
    .spyOn(IDBObjectStore.prototype, "put")
    .mockImplementationOnce(() => {
      throw new DOMException("Synthetic quota", "QuotaExceededError");
    });
  await expect(store.createBatch!(batch, options)).rejects.toThrow(
    "Synthetic quota",
  );
  put.mockRestore();
  expect(await ready(store)).toEqual(before);
  expect(await store.createBatch!(batch, options)).toHaveLength(2);
});

it("retains the original epoch across a same-handle erase and delayed wrapping crypto", async () => {
  const store = await open(),
    state = await ready(store),
    batch = entries();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const real = crypto.subtle.sign.bind(crypto.subtle);
  vi.spyOn(crypto.subtle, "sign").mockImplementationOnce(
    async (algorithm, key, data) => {
      await gate;
      return real(algorithm, key, data);
    },
  );
  const pending = store.createBatch!(batch, {
    expectedEpoch: state.token.epoch,
  });
  await store.erase();
  release();
  await expect(pending).rejects.toMatchObject({
    code: "library_epoch_changed",
  });
  await expect(
    store.createBatch!(batch, { expectedEpoch: state.token.epoch }),
  ).rejects.toMatchObject({ code: "library_epoch_changed" });
  expect((await ready(store)).notes).toEqual([]);
});

it("cancels before commit with no put and keeps cancellation out of failed persistence", async () => {
  const store = await open(),
    state = await ready(store),
    controller = new AbortController();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const real = crypto.subtle.sign.bind(crypto.subtle);
  vi.spyOn(crypto.subtle, "sign").mockImplementationOnce(
    async (algorithm, key, data) => {
      await gate;
      return real(algorithm, key, data);
    },
  );
  const put = vi.spyOn(IDBObjectStore.prototype, "put");
  const pending = store.createBatch!(entries(), {
    expectedEpoch: state.token.epoch,
    signal: controller.signal,
  });
  controller.abort();
  release();
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  expect(put).not.toHaveBeenCalled();
  expect(store.persistence()).toEqual({ status: "ready" });
  expect((await ready(store)).notes).toEqual([]);
});

it("aborts an in-flight IDB transaction after put without publishing partial notes", async () => {
  const store = await open(),
    state = await ready(store),
    controller = new AbortController();
  const real = IDBObjectStore.prototype.put;
  vi.spyOn(IDBObjectStore.prototype, "put").mockImplementationOnce(function (
    this: IDBObjectStore,
    ...args
  ) {
    const request = Reflect.apply(real, this, args) as IDBRequest;
    queueMicrotask(() => controller.abort());
    return request;
  });
  await expect(
    store.createBatch!(entries(), {
      expectedEpoch: state.token.epoch,
      signal: controller.signal,
    }),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(store.persistence()).toEqual({ status: "ready" });
  expect(await ready(store)).toEqual(state);
});

it("does not call a committed batch cancelled and safely retries an unknown observer outcome", async () => {
  const store = await open(),
    state = await ready(store),
    batch = entries(),
    controller = new AbortController();
  const post = vi
    .spyOn(BroadcastChannel.prototype, "postMessage")
    .mockImplementationOnce(() => {
      controller.abort();
      throw new Error("Synthetic post-commit observer failure");
    });
  await expect(
    store.createBatch!(batch, {
      expectedEpoch: state.token.epoch,
      signal: controller.signal,
    }),
  ).rejects.toThrow("observer failure");
  post.mockRestore();
  expect((await ready(store)).notes).toHaveLength(2);
  const put = vi.spyOn(IDBObjectStore.prototype, "put");
  expect(
    await store.createBatch!(batch, { expectedEpoch: state.token.epoch }),
  ).toHaveLength(2);
  expect(put).not.toHaveBeenCalled();
});

it("returns committed success when cancellation arrives during notification", async () => {
  const store = await open(),
    state = await ready(store),
    controller = new AbortController();
  vi.spyOn(BroadcastChannel.prototype, "postMessage").mockImplementationOnce(
    () => {
      controller.abort();
    },
  );
  const created = await store.createBatch!(entries(), {
    expectedEpoch: state.token.epoch,
    signal: controller.signal,
  });
  expect(created).toHaveLength(2);
  expect(controller.signal.aborted).toBe(true);
  expect(store.persistence()).toEqual({ status: "ready" });
  expect((await ready(store)).notes).toEqual(created);
});
