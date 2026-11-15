import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../../src/desktop/window", () => ({ isDesktop: () => true }));
const native = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock("../../src/desktop/files", () => ({ saveDesktopFile: native.save }));
import { ClipsView } from "../../src/ui/ClipsView";
import type {
  Clip,
  ClipActionInput,
  ClipIntent,
  ClipMutationResult,
  ClipReceipt,
  ClipSnapshot,
  ClipsStore,
} from "../../src/clips/contracts";
import {
  ClipConflictError,
  ClipDuplicateError,
} from "../../src/clips/contracts";
import { checkClose } from "../../src/desktop/closeGuard";
const clipId = "11111111-1111-4111-8111-111111111111",
  epoch = "22222222-2222-4222-8222-222222222222",
  opId = "33333333-3333-4333-8333-333333333333";
const clip: Clip = {
  id: clipId,
  revision: 1,
  originalUrl: "https://example.test/a#part",
  canonicalUrl: "https://example.test/a",
  title: "Real source title",
  text: null,
  createdAt: "2026-11-11T00:00:00.000Z",
  updatedAt: "2026-11-11T00:00:00.000Z",
  readAt: null,
  readLater: false,
  archivedAt: null,
};
function fixture(items: Clip[] = []) {
  let snapshot: ClipSnapshot = {
    epoch,
    revision: 0,
    clips: { items, receipts: [] },
  };
  const listeners = new Set<() => void>(),
    invalidations = new Set<(reason: "epoch" | "closed") => void>(),
    intents = new Map<ClipIntent, ClipActionInput>();
  const prepare = vi.fn<ClipsStore["prepare"]>(async (_expected, input) => {
    const intent = Object.freeze({
      operationId: crypto.randomUUID(),
      clipId:
        input.kind === "create"
          ? crypto.randomUUID()
          : "clipId" in input
            ? input.clipId
            : clipId,
    }) as ClipIntent;
    intents.set(intent, structuredClone(input));
    return intent;
  });
  const commit = vi.fn<ClipsStore["commit"]>(async (intent) => {
    const input = intents.get(intent)!;
    const now = new Date().toISOString();
    let next = [...snapshot.clips.items],
      resultRevision: number | null = 1;
    if (input.kind === "create")
      next.push({
        ...clip,
        id: intent.clipId,
        title: input.title || "example.test",
        originalUrl: input.url,
        text: input.text || null,
        readLater: input.readLater,
        createdAt: now,
        updatedAt: now,
      });
    else if (input.kind === "undo-create") {
      next = next.filter((item) => item.id !== clipId);
      resultRevision = null;
    } else
      next = next.map((item) =>
        item.id !== input.clipId
          ? item
          : {
              ...item,
              revision: item.revision + 1,
              ...(input.kind === "set-read"
                ? { readAt: input.read ? now : null }
                : input.kind === "set-read-later"
                  ? { readLater: input.readLater }
                  : { archivedAt: input.archived ? now : null }),
            },
      );
    const receipt: ClipReceipt = {
      operationId: intent.operationId,
      digest: "a".repeat(64),
      kind: input.kind,
      clipId: intent.clipId,
      resultRevision,
      at: now,
      changed: true,
    };
    snapshot = {
      epoch,
      revision: snapshot.revision + 1,
      clips: { items: next, receipts: [...snapshot.clips.receipts, receipt] },
    };
    return { snapshot, receipt, changed: true, replayed: false };
  });
  const api: ClipsStore = {
    read: vi.fn(async () => structuredClone(snapshot)),
    prepare,
    commit,
    subscribe: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    onInvalidate: (fn) => {
      invalidations.add(fn);
      return () => invalidations.delete(fn);
    },
    persistence: () => ({ status: "ready" }),
    close: vi.fn(),
  };
  return {
    api,
    prepare,
    commit,
    invalidate(reason: "epoch" | "closed") {
      if (reason === "epoch")
        snapshot = {
          epoch: "44444444-4444-4444-8444-444444444444",
          revision: 0,
          clips: { items: [], receipts: [] },
        };
      for (const listener of invalidations) listener(reason);
    },
    get snapshot() {
      return snapshot;
    },
  };
}

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
  native.save.mockReset();
});

afterEach(() => vi.unstubAllGlobals());

it("does not claim a cancelled native export was saved", async () => {
  native.save.mockResolvedValue(false);
  const f = fixture([clip]);
  render(<ClipsView store={f.api} />);
  fireEvent.click(await screen.findByRole("button", { name: "Export Clips" }));
  const dialog = screen.getByRole("dialog", { name: "Export Clips" });
  fireEvent.click(within(dialog).getByText("Export"));
  await waitFor(() => expect(native.save).toHaveBeenCalledOnce());
  await waitFor(() => expect(within(dialog).getByText("Export")).toBeEnabled());
  expect(screen.queryByText("Clips export saved")).not.toBeInTheDocument();
  expect(native.save.mock.calls[0]![1]).toBeInstanceOf(Blob);
});

it("rejects a native export when the account closes during the dialog", async () => {
  let finish!: () => void;
  const write = vi.fn();
  native.save.mockImplementation(async (_name, _blob, beforeWrite) => {
    await new Promise<void>((resolve) => { finish = resolve; });
    await beforeWrite();
    write();
    return true;
  });
  const f = fixture([clip]);
  render(<ClipsView store={f.api} />);
  fireEvent.click(await screen.findByRole("button", { name: "Export Clips" }));
  fireEvent.click(within(screen.getByRole("dialog", { name: "Export Clips" })).getByText("Export"));
  await waitFor(() => expect(native.save).toHaveBeenCalledOnce());
  act(() => f.invalidate("closed"));
  await act(async () => { finish(); });
  expect(write).not.toHaveBeenCalled();
  expect(screen.queryByText("Clips export saved")).not.toBeInTheDocument();
});
