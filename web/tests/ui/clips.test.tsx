import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
async function openForm() {
  fireEvent.click(
    (await screen.findAllByRole("button", { name: "Save a link" }))[0]!,
  );
  return screen.getByRole("dialog", { name: "Save a link" });
}
function result(
  item = clip,
  at = new Date().toISOString(),
): ClipMutationResult {
  return {
    snapshot: { epoch, revision: 1, clips: { items: [item], receipts: [] } },
    receipt: {
      operationId: opId,
      digest: "a".repeat(64),
      kind: "create",
      clipId: item.id,
      resultRevision: 1,
      at,
      changed: true,
    },
    changed: true,
    replayed: false,
  };
}
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
  vi.stubGlobal("navigator", {
    onLine: true,
    clipboard: { writeText: vi.fn(async () => {}) },
  });
  URL.createObjectURL = vi.fn(() => "blob:clips-test");
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => vi.unstubAllGlobals());
it("shows only real link/text provenance and independent filters", async () => {
  const second = {
    ...clip,
    id: "55555555-5555-4555-8555-555555555555",
    title: "Pasted source",
    text: "<script>not executable</script>",
    readAt: new Date().toISOString(),
    readLater: true,
  };
  render(<ClipsView store={fixture([clip, second]).api} />);
  await screen.findByRole("button", { name: /Real source title/ });
  fireEvent.click(screen.getByRole("button", { name: /^Unread/ }));
  expect(
    screen.queryByRole("button", { name: /Pasted source/ }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /^Read later/ }));
  fireEvent.click(screen.getByRole("button", { name: /Pasted source/ }));
  expect(
    screen.getByText("<script>not executable</script>"),
  ).toBeInTheDocument();
  expect(document.querySelector("script")).toBeNull();
  expect(screen.queryByText(/min read|% read/)).not.toBeInTheDocument();
});
it("guards input immediately and requires explicit dirty discard", async () => {
  const f = fixture();
  render(<ClipsView store={f.api} />);
  const dialog = await openForm();
  fireEvent.change(within(dialog).getByLabelText("Clip URL"), {
    target: { value: "https://example.test/draft" },
  });
  expect(checkClose()).toBe("draft");
  fireEvent.click(within(dialog).getByText("Cancel"));
  fireEvent.click(screen.getByText("Keep editing"));
  expect(within(dialog).getByLabelText("Clip URL")).toHaveValue(
    "https://example.test/draft",
  );
  fireEvent.click(within(dialog).getByText("Cancel"));
  fireEvent.click(screen.getByText("Discard changes"));
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(checkClose()).toBe("allowed");
  expect(f.prepare).not.toHaveBeenCalled();
});
it("retains the exact opaque intent through unknown-result explicit reload/retry", async () => {
  const f = fixture();
  f.commit
    .mockRejectedValueOnce(new Error("Commit result unknown"))
    .mockResolvedValueOnce(result());
  render(<ClipsView store={f.api} />);
  const dialog = await openForm();
  fireEvent.change(within(dialog).getByLabelText("Clip URL"), {
    target: { value: clip.originalUrl },
  });
  fireEvent.click(within(dialog).getByText("Save link"));
  await screen.findByText("Commit result unknown");
  expect(within(dialog).getByLabelText("Clip URL")).toHaveValue(
    clip.originalUrl,
  );
  expect(screen.getByText("Retry same action")).toBeDisabled();
  fireEvent.click(screen.getByText("Reload saved clips"));
  await waitFor(() =>
    expect(screen.getByText("Retry same action")).toBeEnabled(),
  );
  fireEvent.click(screen.getByText("Retry same action"));
  await screen.findByText("Link saved");
  expect(f.prepare).toHaveBeenCalledTimes(1);
  expect(f.commit.mock.calls[1]?.[0]).toBe(f.commit.mock.calls[0]?.[0]);
});
it("keeps CAS-conflicted input for explicit review without auto replay", async () => {
  const f = fixture();
  f.commit.mockRejectedValue(new ClipConflictError(f.snapshot));
  render(<ClipsView store={f.api} />);
  const dialog = await openForm();
  fireEvent.change(within(dialog).getByLabelText("Clip URL"), {
    target: { value: clip.originalUrl },
  });
  fireEvent.click(within(dialog).getByText("Save link"));
  await screen.findByText(/Clips changed/);
  expect(screen.queryByText("Retry same action")).not.toBeInTheDocument();
  fireEvent.click(screen.getByText("Reload saved clips"));
  await waitFor(() =>
    expect(screen.getByText("Keep draft and clear action")).toBeEnabled(),
  );
  fireEvent.click(screen.getByText("Keep draft and clear action"));
  expect(within(dialog).getByLabelText("Clip URL")).toHaveValue(
    clip.originalUrl,
  );
  expect(f.commit).toHaveBeenCalledTimes(1);
});
it("requires deliberate duplicate Save again with a fresh intent", async () => {
  const f = fixture([clip]);
  f.commit.mockRejectedValueOnce(new ClipDuplicateError(clip));
  render(<ClipsView store={f.api} />);
  const dialog = await openForm();
  fireEvent.change(within(dialog).getByLabelText("Clip URL"), {
    target: { value: clip.originalUrl },
  });
  fireEvent.click(within(dialog).getByText("Save link"));
  const duplicate = await screen.findByRole("dialog", {
    name: "Already saved",
  });
  expect(f.prepare).toHaveBeenCalledTimes(1);
  fireEvent.click(within(duplicate).getByText("Save again"));
  await screen.findByText("Link saved");
  expect(f.prepare).toHaveBeenCalledTimes(2);
  expect(f.prepare.mock.calls[1]?.[1]).toMatchObject({ allowDuplicate: true });
  expect(f.commit.mock.calls[1]?.[0]).not.toBe(f.commit.mock.calls[0]?.[0]);
});
it("drops held input and fences a late commit on epoch replacement", async () => {
  const f = fixture();
  const pending = deferred<ClipMutationResult>();
  f.commit.mockReturnValue(pending.promise);
  render(<ClipsView store={f.api} />);
  const dialog = await openForm();
  fireEvent.change(within(dialog).getByLabelText("Clip URL"), {
    target: { value: clip.originalUrl },
  });
  fireEvent.change(within(dialog).getByLabelText("Selected text (optional)"), {
    target: { value: "Private pasted draft" },
  });
  fireEvent.click(within(dialog).getByText("Save link"));
  await waitFor(() => expect(f.commit).toHaveBeenCalled());
  act(() => f.invalidate("epoch"));
  expect(
    screen.queryByDisplayValue("Private pasted draft"),
  ).not.toBeInTheDocument();
  await act(async () => pending.resolve(result()));
  await screen.findByText("No clips yet");
  expect(screen.queryByText("Link saved")).not.toBeInTheDocument();
  expect(checkClose()).toBe("allowed");
});
it("does not offer Undo for a delayed expired confirmation", async () => {
  const f = fixture();
  f.commit.mockResolvedValue(
    result(clip, new Date(Date.now() - 6000).toISOString()),
  );
  render(<ClipsView store={f.api} />);
  const dialog = await openForm();
  fireEvent.change(within(dialog).getByLabelText("Clip URL"), {
    target: { value: clip.originalUrl },
  });
  fireEvent.click(within(dialog).getByText("Save link"));
  await screen.findByText("Link saved");
  expect(
    screen.queryByRole("button", { name: "Undo" }),
  ).not.toBeInTheDocument();
});
it("opens only on a user action and never marks it read", async () => {
  const f = fixture([clip]),
    open = vi.fn(async () => {
      throw new Error("Native opener unavailable");
    });
  render(<ClipsView store={f.api} onOpenExternal={open} />);
  fireEvent.click(
    await screen.findByRole("button", { name: /Real source title/ }),
  );
  expect(open).not.toHaveBeenCalled();
  expect(screen.getByText(/Only the link is saved/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Open original" }));
  await screen.findByText(/Couldn’t open the original page/);
  expect(open).toHaveBeenCalledWith(clip.originalUrl);
  expect(f.prepare).not.toHaveBeenCalled();
});
it("provides a safe web anchor and keeps copy error separate from persistence", async () => {
  const f = fixture([clip]);
  vi.mocked(navigator.clipboard.writeText).mockRejectedValue(
    new Error("Denied"),
  );
  render(<ClipsView store={f.api} />);
  fireEvent.click(
    await screen.findByRole("button", { name: /Real source title/ }),
  );
  expect(screen.getByRole("link", { name: "Open original" })).toHaveAttribute(
    "rel",
    "noopener noreferrer",
  );
  fireEvent.click(screen.getByText("Copy link"));
  await screen.findByText(/Couldn’t copy the link/);
  expect(f.prepare).not.toHaveBeenCalled();
});
it("requires plaintext export consent and revokes its URL on account close", async () => {
  const f = fixture([clip]);
  render(<ClipsView store={f.api} />);
  fireEvent.click(await screen.findByRole("button", { name: "Export Clips" }));
  expect(URL.createObjectURL).not.toHaveBeenCalled();
  const dialog = screen.getByRole("dialog", { name: "Export Clips" });
  expect(dialog).toHaveTextContent("automatic restore are not available");
  fireEvent.click(within(dialog).getByText("Export"));
  await screen.findByRole("link", { name: "Download Clips export" });
  act(() => f.invalidate("closed"));
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:clips-test");
  expect(
    screen.queryByRole("link", { name: "Download Clips export" }),
  ).not.toBeInTheDocument();
});

it("returns from a duplicate to editable input without losing pasted text", async () => {
  const f = fixture([clip]);
  f.commit.mockRejectedValueOnce(new ClipDuplicateError(clip));
  render(<ClipsView store={f.api} />);
  const dialog = await openForm();
  fireEvent.change(within(dialog).getByLabelText("Clip URL"), {
    target: { value: clip.originalUrl },
  });
  fireEvent.change(within(dialog).getByLabelText("Selected text (optional)"), {
    target: { value: "Keep this duplicate draft" },
  });
  fireEvent.click(within(dialog).getByText("Save link"));
  const duplicate = await screen.findByRole("dialog", {
    name: "Already saved",
  });
  fireEvent.click(within(duplicate).getByText("Back to draft"));
  const restored = screen.getByRole("dialog", { name: "Save a link" });
  expect(
    within(restored).getByLabelText("Selected text (optional)"),
  ).toHaveValue("Keep this duplicate draft");
  expect(within(restored).getByLabelText("Clip URL")).toBeEnabled();
  expect(checkClose()).toBe("draft");
  expect(f.prepare).toHaveBeenCalledTimes(1);
});
it("ignores an older read after synchronous epoch invalidation", async () => {
  const f = fixture();
  const pending = deferred<ClipSnapshot>();
  vi.mocked(f.api.read).mockReturnValueOnce(pending.promise);
  render(<ClipsView store={f.api} />);
  act(() => f.invalidate("epoch"));
  await screen.findByText("No clips yet");
  await act(async () =>
    pending.resolve({
      epoch,
      revision: 1,
      clips: { items: [clip], receipts: [] },
    }),
  );
  expect(
    screen.queryByText("Clips is no longer available."),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: /Real source title/ }),
  ).not.toBeInTheDocument();
});

it("admits duplicate Open synchronously so Keep editing cannot race its held read", async () => {
  const f = fixture([clip]);
  f.commit.mockRejectedValueOnce(new ClipDuplicateError(clip));
  render(<ClipsView store={f.api} />);
  let dialog = await openForm();
  fireEvent.change(within(dialog).getByLabelText("Clip URL"), {
    target: { value: clip.originalUrl },
  });
  fireEvent.change(within(dialog).getByLabelText("Selected text (optional)"), {
    target: { value: "Original clicked draft" },
  });
  fireEvent.click(within(dialog).getByText("Save link"));
  dialog = await screen.findByRole("dialog", { name: "Already saved" });
  const held = deferred<ClipSnapshot>();
  vi.mocked(f.api.read).mockReturnValueOnce(held.promise);
  fireEvent.click(within(dialog).getByText("Open clip"));
  const confirm = screen.getByRole("dialog", {
    name: "Open saved clip and discard this draft?",
  });
  fireEvent.click(within(confirm).getByText("Discard draft and open"));
  expect(within(confirm).getByText("Keep editing")).toBeDisabled();
  fireEvent.click(within(confirm).getByText("Keep editing"));
  fireEvent.change(within(dialog).getByLabelText("Selected text (optional)"), {
    target: {
      value: "A newer draft must not be admitted while transition waits",
    },
  });
  expect(within(dialog).getByLabelText("Selected text (optional)")).toHaveValue(
    "Original clicked draft",
  );
  await act(async () => held.resolve(f.snapshot));
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(screen.getByRole("heading", { name: clip.title })).toBeInTheDocument();
});
it("admits clicked Save again before its held read and never captures a later draft", async () => {
  const f = fixture([clip]);
  f.commit.mockRejectedValueOnce(new ClipDuplicateError(clip));
  render(<ClipsView store={f.api} />);
  let dialog = await openForm();
  fireEvent.change(within(dialog).getByLabelText("Clip URL"), {
    target: { value: clip.originalUrl },
  });
  fireEvent.change(within(dialog).getByLabelText("Title (optional)"), {
    target: { value: "Clicked duplicate title" },
  });
  fireEvent.click(within(dialog).getByText("Save link"));
  dialog = await screen.findByRole("dialog", { name: "Already saved" });
  const held = deferred<ClipSnapshot>();
  vi.mocked(f.api.read).mockReturnValue(held.promise);
  const before = vi.mocked(f.api.read).mock.calls.length;
  fireEvent.click(within(dialog).getByText("Save again"));
  fireEvent.click(within(dialog).getByText("Save again"));
  expect(vi.mocked(f.api.read)).toHaveBeenCalledTimes(before + 1);
  expect(within(dialog).getByText("Back to draft")).toBeDisabled();
  fireEvent.click(within(dialog).getByText("Back to draft"));
  fireEvent.change(within(dialog).getByLabelText("Title (optional)"), {
    target: { value: "Unrelated later title" },
  });
  await act(async () => held.resolve(f.snapshot));
  await screen.findByText("Link saved");
  expect(f.prepare.mock.calls[1]?.[1]).toMatchObject({
    title: "Clicked duplicate title",
    allowDuplicate: true,
  });
  expect(f.prepare).toHaveBeenCalledTimes(2);
});
it.each([false, true])(
  "suppresses late native opening error after selection change (return to A=%s)",
  async (returnToA) => {
    const other = {
      ...clip,
      id: "66666666-6666-4666-8666-666666666666",
      title: "Clip B",
      originalUrl: "https://example.test/b",
      canonicalUrl: "https://example.test/b",
    };
    const f = fixture([clip, other]);
    const held = deferred<void>();
    const open = vi.fn(() => held.promise);
    render(<ClipsView store={f.api} onOpenExternal={open} />);
    fireEvent.click(
      await screen.findByRole("button", { name: /Real source title/ }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Open original" }));
    fireEvent.click(screen.getByText("← Back to clips"));
    fireEvent.click(screen.getByRole("button", { name: /Clip B/ }));
    if (returnToA) {
      fireEvent.click(screen.getByText("← Back to clips"));
      fireEvent.click(
        screen.getByRole("button", { name: /Real source title/ }),
      );
    }
    await act(async () => held.reject(new Error("Late native failure")));
    expect(
      screen.queryByText(/Couldn’t open the original page/),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: returnToA ? clip.title : "Clip B" }),
    ).toBeInTheDocument();
  },
);

it.each(["success", "failure"] as const)(
  "fences held clipboard %s feedback after A to B to A",
  async (outcome) => {
    const other = {
      ...clip,
      id: "66666666-6666-4666-8666-666666666666",
      title: "Clip B",
      originalUrl: "https://example.test/b",
      canonicalUrl: "https://example.test/b",
    };
    const f = fixture([clip, other]),
      held = deferred<void>();
    vi.mocked(navigator.clipboard.writeText).mockReturnValueOnce(held.promise);
    render(<ClipsView store={f.api} />);
    fireEvent.click(
      await screen.findByRole("button", { name: /Real source title/ }),
    );
    fireEvent.click(screen.getByText("Copy link"));
    fireEvent.click(screen.getByText("← Back to clips"));
    fireEvent.click(screen.getByRole("button", { name: /Clip B/ }));
    fireEvent.click(screen.getByText("← Back to clips"));
    fireEvent.click(screen.getByRole("button", { name: /Real source title/ }));
    await act(async () => {
      if (outcome === "success") held.resolve();
      else held.reject(new Error("Clipboard denied late"));
    });
    expect(
      screen.queryByText(/Couldn’t copy the link/),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Link copied")).not.toBeInTheDocument();
  },
);

it("initializes persisted reader preferences when Clips opens before the editor or Settings", async () => {
  localStorage.setItem(
    "notes.editor.v1",
    JSON.stringify({
      textSize: "large",
      lineWidth: "wide",
      markdown: true,
      spellcheck: true,
    }),
  );
  document.documentElement.style.removeProperty("--notes-editor-size");
  document.documentElement.style.removeProperty("--notes-editor-width");
  const f = fixture([{ ...clip, text: "Reader preference text" }]);
  render(<ClipsView store={f.api} />);
  fireEvent.click(
    await screen.findByRole("button", { name: /Real source title/ }),
  );
  expect(
    document.documentElement.style.getPropertyValue("--notes-editor-size"),
  ).toBe("16px");
  expect(
    document.documentElement.style.getPropertyValue("--notes-editor-width"),
  ).toBe("800px");
  act(() => {
    localStorage.setItem(
      "notes.editor.v1",
      JSON.stringify({
        textSize: "small",
        lineWidth: "narrow",
        markdown: true,
        spellcheck: true,
      }),
    );
    window.dispatchEvent(
      new StorageEvent("storage", { key: "notes.editor.v1" }),
    );
  });
  expect(
    document.documentElement.style.getPropertyValue("--notes-editor-size"),
  ).toBe("12px");
  expect(
    document.documentElement.style.getPropertyValue("--notes-editor-width"),
  ).toBe("640px");
  expect(screen.getByText("Reader preference text")).toBeInTheDocument();
  expect(f.prepare).not.toHaveBeenCalled();
  localStorage.removeItem("notes.editor.v1");
});
