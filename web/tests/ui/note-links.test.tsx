import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import type { Editor } from "@tiptap/react";
import type { NoteDocument } from "../../src/domain/contracts";
import type {
  LinkRepairIntent,
  NoteLinkService,
  NoteTarget,
} from "../../src/links/contracts";
import { NoteLinkPicker } from "../../src/ui/NoteLinkPicker";
import { NoteLinksPanel } from "../../src/ui/NoteLinksPanel";
import { checkClose } from "../../src/desktop/closeGuard";
import {
  NOTE_FRAGMENT_MIME,
  decodeNoteFragment,
  encodeNoteFragment,
} from "../../src/ui/noteLinkClipboard";
import { RichEditor } from "../../src/ui/RichEditor";
const live = vi.hoisted(() => ({ editor: null as Editor | null }));
vi.mock("@tiptap/react", async (original) => {
  const actual = await original<typeof import("@tiptap/react")>();
  return {
    ...actual,
    useEditor: (
      options: import("@tiptap/react").UseEditorOptions,
      deps?: import("react").DependencyList,
    ) => {
      const editor = actual.useEditor(options, deps);
      live.editor = editor;
      return editor;
    },
  };
});
const target: NoteTarget = {
  kind: "note",
  accountId: "11111111-1111-4111-8111-111111111111",
  libraryEpoch: "22222222-2222-4222-8222-222222222222",
  noteId: "opaque target",
};
const doc: NoteDocument = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        { type: "text", text: "Before " },
        { type: "noteLink", attrs: { version: 1, target } },
      ],
    },
  ],
};
function service() {
  let title = "Current title";
  const listeners = new Set<() => void>();
  const value: NoteLinkService = {
    admission: vi.fn(async () => ({
      mode: "current" as const,
      token: { epoch: target.libraryEpoch, revision: 1 },
      graph: "ready" as const,
    })),
    currentToken: vi.fn(),
    search: vi.fn(async () => ({
      token: { epoch: target.libraryEpoch, revision: 1 },
      items: [
        {
          target,
          title,
          noteRevision: 1,
          updatedAt: "2026-11-11T00:00:00Z",
          thisNote: false,
        },
      ],
      next: null,
    })),
    reference: vi.fn(async () => ({
      token: { epoch: target.libraryEpoch, revision: 1 },
      target,
    })),
    resolve: vi.fn(async () => ({
      status: "available" as const,
      target,
      title,
      noteRevision: 1,
      token: { epoch: target.libraryEpoch, revision: 1 },
    })),
    outgoing: vi.fn(),
    backlinks: vi.fn(),
    linkedNoteIds: vi.fn(),
    verifyGraph: vi.fn(),
    cancelVerification: vi.fn(),
    prepareRepair: vi.fn(),
    commitRepair: vi.fn(),
    prepareExport: vi.fn(),
    exportFiles: vi.fn(),
    assertFreshExport: vi.fn(),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    onInvalidate: () => () => {},
    close: vi.fn(),
  };
  return {
    value,
    rename(name: string) {
      title = name;
      listeners.forEach((fn) => fn());
    },
  };
}
beforeEach(() => {
  window.scrollBy = vi.fn();
  live.editor = null;
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
  Object.defineProperty(Range.prototype, "getClientRects", {
    configurable: true,
    value: () => [],
  });
  Object.defineProperty(Range.prototype, "getBoundingClientRect", {
    configurable: true,
    value: () => new DOMRect(10, 10, 1, 16),
  });
  HTMLElement.prototype.scrollIntoView = vi.fn();
});
it.each(["plain", "journal"] as const)(
  "rejects loaded references and real reference transactions before %s callback",
  async (policy) => {
    const changes = vi.fn();
    const view = render(
      <RichEditor document={doc} documentPolicy={policy} onChange={changes} />,
    );
    await screen.findByRole("alert");
    expect(screen.queryByText("Current title")).not.toBeInTheDocument();
    expect(changes).not.toHaveBeenCalled();
    view.unmount();
    render(
      <RichEditor
        document={{ type: "doc", content: [{ type: "paragraph" }] }}
        documentPolicy={policy}
        onChange={changes}
      />,
    );
    await waitFor(() => expect(live.editor).toBeTruthy());
    act(() => {
      live.editor!.commands.insertContent({
        type: "noteLink",
        attrs: { version: 1, target },
      });
    });
    expect(changes).not.toHaveBeenCalled();
    expect(JSON.stringify(live.editor!.getJSON())).not.toContain("noteLink");
  },
);
it("resolves authorized current labels and rename without changing the stored atom or firing onChange", async () => {
  const f = service(),
    changes = vi.fn();
  render(
    <RichEditor
      document={doc}
      documentPolicy="notes"
      noteLinks={{ service: f.value, noteId: "source", onOpen: vi.fn() }}
      onChange={changes}
    />,
  );
  await screen.findByRole("button", { name: "Open note: Current title" });
  act(() => f.rename("Renamed now"));
  await screen.findByRole("button", { name: "Open note: Renamed now" });
  expect(changes).not.toHaveBeenCalled();
  expect(live.editor!.getJSON()).toEqual(doc);
  expect(JSON.stringify(live.editor!.getJSON())).not.toContain("Renamed");
});
it("inserts the actual chosen target through one normal editor transaction, not a cached label", async () => {
  const f = service(),
    changes = vi.fn();
  render(
    <RichEditor
      document={{
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "Here" }] },
        ],
      }}
      documentPolicy="notes"
      noteLinks={{ service: f.value, noteId: "source", onOpen: vi.fn() }}
      onChange={changes}
    />,
  );
  await waitFor(() => expect(live.editor).toBeTruthy());
  fireEvent.click(screen.getByRole("button", { name: "Link a note" }));
  await screen.findByRole("option");
  fireEvent.click(screen.getByRole("option"));
  await waitFor(() => expect(changes).toHaveBeenCalledTimes(1));
  expect(JSON.stringify(live.editor!.getJSON())).toContain("opaque target");
  expect(JSON.stringify(live.editor!.getJSON())).not.toContain("Current title");
});

function held<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
it("keeps real editor input and rejects a stale insertion point after held reference admission", async () => {
  const f = service(),
    changes = vi.fn();
  const delayed = held<Awaited<ReturnType<NoteLinkService["reference"]>>>();
  vi.mocked(f.value.reference).mockReturnValueOnce(delayed.promise);
  render(
    <RichEditor
      document={{
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "Original" }] },
        ],
      }}
      documentPolicy="notes"
      noteLinks={{ service: f.value, noteId: "source", onOpen: vi.fn() }}
      onChange={changes}
    />,
  );
  await waitFor(() => expect(live.editor).toBeTruthy());
  fireEvent.click(screen.getByRole("button", { name: "Link a note" }));
  fireEvent.click(await screen.findByRole("option"));
  expect(checkClose()).toBe("draft");
  act(() => {
    live.editor!.view.dispatch(live.editor!.state.tr.insertText("new ", 1));
  });
  await act(async () =>
    delayed.resolve({
      token: { epoch: target.libraryEpoch, revision: 1 },
      target,
    }),
  );
  await screen.findByText(
    "This insertion point changed. Choose where to link again.",
  );
  expect(live.editor!.state.doc.textContent).toContain("new Original");
  expect(JSON.stringify(live.editor!.getJSON())).not.toContain("noteLink");
});
it("leaves IME Enter with the composition owner and only inserts on a later deliberate Enter", async () => {
  const f = service(),
    choose = vi.fn();
  render(
    <NoteLinkPicker
      owner={{ service: f.value, noteId: "source", onOpen: vi.fn() }}
      anchor={() => new DOMRect(10, 10, 1, 16)}
      isCurrent={() => true}
      onChoose={choose}
      onClose={vi.fn()}
    />,
  );
  const input = screen.getByRole("combobox");
  await screen.findByRole("option");
  fireEvent.compositionStart(input);
  fireEvent.keyDown(input, { key: "Enter", isComposing: true });
  expect(f.value.reference).not.toHaveBeenCalled();
  fireEvent.compositionEnd(input);
  fireEvent.keyDown(input, { key: "Enter" });
  await waitFor(() => expect(choose).toHaveBeenCalledWith(target));
  expect(f.value.reference).toHaveBeenCalledTimes(1);
});
it("fences late query results rather than publishing an older A result in B", async () => {
  const f = service(),
    a = held<Awaited<ReturnType<NoteLinkService["search"]>>>();
  vi.mocked(f.value.search).mockImplementation(async (query) =>
    query === "A"
      ? a.promise
      : {
          token: { epoch: target.libraryEpoch, revision: 1 },
          items: [
            {
              target,
              title: "Result B",
              noteRevision: 1,
              updatedAt: "2026-11-11",
              thisNote: false,
            },
          ],
          next: null,
        },
  );
  render(
    <NoteLinkPicker
      owner={{ service: f.value, noteId: "source", onOpen: vi.fn() }}
      anchor={() => new DOMRect(10, 10, 1, 16)}
      isCurrent={() => true}
      onChoose={vi.fn()}
      onClose={vi.fn()}
    />,
  );
  const input = screen.getByRole("combobox");
  fireEvent.change(input, { target: { value: "A" } });
  await waitFor(() =>
    expect(f.value.search).toHaveBeenCalledWith("A", "source", undefined),
  );
  fireEvent.change(input, { target: { value: "B" } });
  await screen.findByRole("option", { name: /Result B/ });
  await act(async () =>
    a.resolve({
      token: { epoch: target.libraryEpoch, revision: 1 },
      items: [
        {
          target,
          title: "Old A",
          noteRevision: 1,
          updatedAt: "2026-11-11",
          thisNote: false,
        },
      ],
      next: null,
    }),
  );
  expect(screen.queryByText("Old A")).not.toBeInTheDocument();
  expect(screen.getByRole("combobox")).toHaveValue("B");
});
it("does not turn pending or paused graph queries into zero incoming or outgoing counts", async () => {
  const f = service();
  const progress = {
    verifiedNotes: 1,
    totalNotes: 2,
    verifiedHistory: 0,
    totalHistory: 0,
    utf8Units: 1,
    nodeVisits: 1,
  };
  vi.mocked(f.value.backlinks).mockResolvedValue({
    status: "paused-limit",
    progress,
  });
  vi.mocked(f.value.outgoing).mockResolvedValue({
    status: "pending",
    progress,
  });
  render(
    <NoteLinksPanel
      service={f.value}
      noteId="source"
      dirty
      onOpen={vi.fn()}
      onClose={vi.fn()}
    />,
  );
  await screen.findByText(
    "Note-link checking is paused. Continue to check the remaining notes.",
  );
  expect(screen.queryByText("No notes link here yet.")).not.toBeInTheDocument();
  expect(screen.queryByText("No links in this note.")).not.toBeInTheDocument();
  expect(
    screen.getByText("Links update after this note is saved."),
  ).toBeVisible();
  expect(f.value.verifyGraph).not.toHaveBeenCalled();
});

it("retries the identical opaque repair and re-queries rather than treating its historical receipt as ready", async () => {
  const f = service(),
    token = { epoch: target.libraryEpoch, revision: 1 };
  const intent = { operationId: "synthetic-ui-repair" } as LinkRepairIntent;
  const progress = {
    verifiedNotes: 0,
    totalNotes: 1,
    verifiedHistory: 0,
    totalHistory: 0,
    utf8Units: 0,
    nodeVisits: 0,
  };
  vi.mocked(f.value.admission).mockResolvedValue({
    mode: "index-recovery",
    token,
    reason: "index-invalid",
  });
  vi.mocked(f.value.currentToken).mockResolvedValue(token);
  vi.mocked(f.value.backlinks).mockResolvedValue({
    status: "invalid",
    code: "index-invalid",
  });
  vi.mocked(f.value.outgoing).mockResolvedValue({
    status: "invalid",
    code: "index-invalid",
  });
  vi.mocked(f.value.prepareRepair).mockResolvedValue(intent);
  vi.mocked(f.value.commitRepair)
    .mockRejectedValueOnce(Error("Unknown commit result"))
    .mockImplementationOnce(async () => {
      vi.mocked(f.value.backlinks).mockResolvedValue({
        status: "pending",
        progress,
      });
      vi.mocked(f.value.outgoing).mockResolvedValue({
        status: "pending",
        progress,
      });
      return {
        operationId: intent.operationId,
        committedToken: { ...token, revision: 2 },
        indexDigest: "a".repeat(64),
        replayed: true,
      };
    });
  render(
    <NoteLinksPanel
      service={f.value}
      noteId="source"
      dirty={false}
      onOpen={vi.fn()}
      onClose={vi.fn()}
    />,
  );
  fireEvent.click(await screen.findByRole("button", { name: "Rebuild index" }));
  fireEvent.click(
    within(
      screen.getByRole("dialog", { name: "Rebuild note links?" }),
    ).getByRole("button", { name: "Rebuild index" }),
  );
  fireEvent.click(
    await screen.findByRole("button", { name: "Retry same repair" }),
  );
  await waitFor(() => expect(f.value.commitRepair).toHaveBeenCalledTimes(2));
  expect(f.value.commitRepair).toHaveBeenNthCalledWith(1, intent);
  expect(f.value.commitRepair).toHaveBeenNthCalledWith(2, intent);
  expect(f.value.prepareRepair).toHaveBeenCalledTimes(1);
  await waitFor(() =>
    expect(screen.queryByText("Retry same repair")).not.toBeInTheDocument(),
  );
  expect(screen.queryByText("No notes link here yet.")).not.toBeInTheDocument();
  expect(screen.queryByText("No links in this note.")).not.toBeInTheDocument();
  expect(f.value.verifyGraph).not.toHaveBeenCalled();
});

it("copies exact reference identity via the private fragment and pastes Notes-only without cached titles", async () => {
  const f = service(),
    changes = vi.fn(),
    data = new Map<string, string>();
  const clipboard = {
    setData: (type: string, value: string) => data.set(type, value),
    getData: (type: string) => data.get(type) ?? "",
    types: [NOTE_FRAGMENT_MIME, "text/plain"],
  };
  const view = render(
    <RichEditor
      document={doc}
      documentPolicy="notes"
      noteLinks={{ service: f.value, noteId: "source", onOpen: vi.fn() }}
      onChange={vi.fn()}
    />,
  );
  await screen.findByRole("button", { name: "Open note: Current title" });
  act(() => {
    live.editor!.commands.selectAll();
  });
  fireEvent.copy(screen.getByRole("textbox", { name: "Note content" }), {
    clipboardData: clipboard,
  });
  expect(data.get(NOTE_FRAGMENT_MIME)).toContain("opaque target");
  expect(data.get(NOTE_FRAGMENT_MIME)).not.toContain("Current title");
  expect(data.get("text/plain")).toContain("orbyn-notes://note/v1/");
  view.unmount();
  const plain = render(
    <RichEditor
      document={{ type: "doc", content: [{ type: "paragraph" }] }}
      onChange={changes}
    />,
  );
  fireEvent.paste(screen.getByRole("textbox", { name: "Note content" }), {
    clipboardData: clipboard,
  });
  expect(JSON.stringify(live.editor!.getJSON())).not.toContain(
    '"type":"noteLink"',
  );
  expect(live.editor!.state.doc.textContent).toContain(
    "orbyn-notes://note/v1/",
  );
  plain.unmount();
  render(
    <RichEditor
      document={{ type: "doc", content: [{ type: "paragraph" }] }}
      documentPolicy="notes"
      noteLinks={{ service: f.value, noteId: "source2", onOpen: vi.fn() }}
      onChange={changes}
    />,
  );
  await act(async () => {});
  fireEvent.paste(screen.getByRole("textbox", { name: "Note content" }), {
    clipboardData: clipboard,
  });
  expect(JSON.stringify(live.editor!.getJSON())).toContain('"type":"noteLink"');
  expect(JSON.stringify(live.editor!.getJSON())).toContain("opaque target");
});
it("rejects duplicate/unknown fragment fields and oversized UTF8 before accepting a rich paste", () => {
  const raw = encodeNoteFragment(doc.content, 0, 0);
  expect(() =>
    decodeNoteFragment(raw.replace('{"version":1', '{"version":2,"version":1')),
  ).toThrow();
  expect(() =>
    decodeNoteFragment(raw.replace('"openEnd":0', '"openEnd":0,"extra":true')),
  ).toThrow();
  expect(() => decodeNoteFragment("界".repeat(3_000_000))).toThrow();
  expect(() => decodeNoteFragment(raw)).not.toThrow();
});

it("supersedes a held backlink across outgoing navigation, a new A admission and panel close", async () => {
  const f = service(),
    open = vi.fn(),
    first = held<Awaited<ReturnType<NoteLinkService["reference"]>>>(),
    latest = held<Awaited<ReturnType<NoteLinkService["reference"]>>>();
  const a = { ...target, noteId: "A" },
    b = { ...target, noteId: "B" };
  vi.mocked(f.value.backlinks).mockResolvedValue({
    status: "ready",
    token: { epoch: target.libraryEpoch, revision: 1 },
    items: [
      {
        sourceId: "A",
        sourceRevision: 1,
        title: "Incoming A",
        occurrences: 1,
        snippet: "Actual source snippet",
      },
    ],
  });
  vi.mocked(f.value.outgoing).mockResolvedValue({
    status: "ready",
    token: { epoch: target.libraryEpoch, revision: 1 },
    items: [
      {
        target: b,
        occurrences: 1,
        resolution: {
          status: "available",
          target: b,
          title: "Outgoing B",
          noteRevision: 1,
          token: { epoch: target.libraryEpoch, revision: 1 },
        },
      },
    ],
  });
  vi.mocked(f.value.reference)
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(latest.promise);
  render(
    <NoteLinksPanel
      service={f.value}
      noteId="source"
      dirty={false}
      onOpen={open}
      onClose={vi.fn()}
    />,
  );
  fireEvent.click(await screen.findByRole("button", { name: /Incoming A/ }));
  fireEvent.click(screen.getByRole("button", { name: "Outgoing B" }));
  fireEvent.click(screen.getByRole("button", { name: /Incoming A/ }));
  await act(async () =>
    latest.resolve({
      target: a,
      token: { epoch: target.libraryEpoch, revision: 1 },
    }),
  );
  expect(open).toHaveBeenNthCalledWith(1, b);
  expect(open).toHaveBeenNthCalledWith(2, a);
  await act(async () =>
    first.resolve({
      target: a,
      token: { epoch: target.libraryEpoch, revision: 1 },
    }),
  );
  expect(open).toHaveBeenCalledTimes(2);
  const closing = held<Awaited<ReturnType<NoteLinkService["reference"]>>>();
  vi.mocked(f.value.reference).mockReturnValueOnce(closing.promise);
  fireEvent.click(screen.getByRole("button", { name: /Incoming A/ }));
  fireEvent.click(
    screen.getByRole("button", { name: "Close links and backlinks" }),
  );
  await act(async () =>
    closing.resolve({
      target: a,
      token: { epoch: target.libraryEpoch, revision: 1 },
    }),
  );
  expect(open).toHaveBeenCalledTimes(2);
});
it("lets actual ProseMirror Undo reach history when the inserted chip button is keyboard focused", async () => {
  const f = service(),
    changes = vi.fn(),
    open = vi.fn();
  render(
    <RichEditor
      document={{
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "Here" }] },
        ],
      }}
      documentPolicy="notes"
      noteLinks={{ service: f.value, noteId: "source", onOpen: open }}
      onChange={changes}
    />,
  );
  await waitFor(() => expect(live.editor).toBeTruthy());
  fireEvent.click(screen.getByRole("button", { name: "Link a note" }));
  fireEvent.click(await screen.findByRole("option"));
  const chip = await screen.findByRole("button", {
    name: "Open note: Current title",
  });
  chip.focus();
  fireEvent.keyDown(chip, { key: "z", code: "KeyZ", ctrlKey: true });
  await waitFor(() =>
    expect(JSON.stringify(live.editor!.getJSON())).not.toContain(
      '"type":"noteLink"',
    ),
  );
  expect(open).not.toHaveBeenCalled();
  expect(changes.mock.calls.length).toBeGreaterThanOrEqual(2);
});
