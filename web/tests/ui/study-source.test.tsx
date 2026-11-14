import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { webcrypto } from "node:crypto";
import type { Editor } from "@tiptap/react";
import type {
  Note,
  NoteDocument,
  NotesStore,
} from "../../src/domain/contracts";
import type {
  CollectionsState,
  CollectionsStore,
} from "../../src/collections/contracts";
import type {
  NotesLibrary,
  LibrarySnapshot,
} from "../../src/library/contracts";
import type {
  MakeCardIntent,
  MakeCardResult,
  SavedNoteSelection,
  StudySourceService,
} from "../../src/study/sourceContracts";
import { emptyStudy } from "../../src/collections/validation";
import {
  captureSourceSelection,
  fingerprintSourceDocument,
  verifySourceEdit,
  mapSourcePassage,
  SourceCodecError,
} from "../../src/study/sourceCodec";
import {
  RichEditor,
  type EditorChangeTrace,
  type EditorSourceCapture,
} from "../../src/ui/RichEditor";
import { NoteEditor } from "../../src/ui/NoteEditor";
import {
  SourceCardComposer,
  SourceCardNotice,
} from "../../src/ui/SourceCardComposer";
import { checkClose } from "../../src/desktop/closeGuard";
const live = vi.hoisted(() => ({ editor: null as Editor | null }));
vi.mock("@tiptap/react", async (original) => {
  const actual = await original<typeof import("@tiptap/react")>();
  return {
    ...actual,
    useEditor: (
      options: import("@tiptap/react").UseEditorOptions,
      dependencies?: import("react").DependencyList,
    ) => {
      const editor = actual.useEditor(options, dependencies);
      live.editor = editor;
      return editor;
    },
  };
});
const epoch = "11111111-1111-4111-8111-111111111111",
  deckId = "22222222-2222-4222-8222-222222222222",
  entryId = "33333333-3333-4333-8333-333333333333",
  cardId = "44444444-4444-4444-8444-444444444444",
  anchorId = "55555555-5555-4555-8555-555555555555",
  operationId = "66666666-6666-4666-8666-666666666666";
const doc = (text: string): NoteDocument => ({
  type: "doc",
  content: [
    { type: "paragraph", content: text ? [{ type: "text", text }] : [] },
  ],
});
const initial: Note = {
  id: "opaque-source-note",
  revision: 1,
  title: "Source note",
  document: doc("NADH after"),
  tags: [],
  createdAt: "2026-11-11T00:00:00.000Z",
  updatedAt: "2026-11-11T00:00:00.000Z",
  trashedAt: null,
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
// UI boundary doubles below do not claim persistence/encryption qualification.
function owners(note: () => Note = () => initial) {
  const collection: CollectionsState = {
    version: 3,
    epoch,
    revision: 1,
    study: {
      ...emptyStudy(),
      decks: [
        {
          id: deckId,
          title: "Real chosen deck",
          createdAt: initial.createdAt,
          updatedAt: initial.updatedAt,
          revision: 1,
        },
      ],
    },
    journal: null,
    clips: { items: [], receipts: [] },
  };
  const collections: CollectionsStore = {
    read: vi.fn(async () => structuredClone(collection)),
    update: vi.fn(),
    subscribe: () => () => {},
    persistence: () => ({ status: "ready" }),
    close: vi.fn(),
  };
  const snapshot = (): LibrarySnapshot => ({
    token: { epoch, revision: 1 },
    notes: [note()],
    tags: [],
    metadata: [{ noteId: initial.id, revision: 1, pinned: false, tagIds: [] }],
    preferences: { sort: "edited" },
  });
  const library: NotesLibrary = {
    read: vi.fn(async () => ({ mode: "ready" as const, snapshot: snapshot() })),
    updateWithSourceSteps: vi.fn(),
    replaceDocument: vi.fn(),
    setPinned: vi.fn(),
    setSort: vi.fn(),
    createTag: vi.fn(),
    renameTag: vi.fn(),
    recolorTag: vi.fn(),
    mergeTag: vi.fn(),
    deleteTag: vi.fn(),
    history: vi.fn(),
    version: vi.fn(),
    restoreVersion: vi.fn(),
    changeTrash: vi.fn(),
    undoTrash: vi.fn(),
    emptyTrash: vi.fn(),
    eraseLegacy: vi.fn(),
  };
  const invalidations = new Set<(reason: "epoch" | "closed") => void>();
  const intent = Object.freeze({
    kind: "create",
    operationId,
    entryId,
  }) as MakeCardIntent;
  const result: MakeCardResult = {
    entryId,
    cardIds: [cardId],
    source: { status: "unavailable" as const, reason: "missing" as const },
    receipt: {
      operationId,
      digest: "a".repeat(64),
      kind: "create",
      at: new Date().toISOString(),
      entryId,
      cardIds: [cardId],
      anchorId,
      createOperationId: operationId,
      entryRevision: 1,
      cardRevisions: [1],
      anchorRevision: 1,
    },
    changed: true,
    replayed: false,
    tokens: {
      library: { epoch, revision: 2 },
      collections: { epoch, revision: 2 },
    },
  };
  const service: StudySourceService = {
    prepareCreate: vi.fn(async () => intent),
    prepareUndo: vi.fn(),
    commit: vi.fn(async () => result),
    resolve: vi.fn(async () => ({
      status: "unavailable" as const,
      reason: "missing" as const,
    })),
    annotations: vi.fn(async () => []),
    subscribe: () => () => {},
    persistence: () => ({ status: "ready" }),
    onInvalidate: (listener) => {
      invalidations.add(listener);
      return () => invalidations.delete(listener);
    },
    close: vi.fn(),
  };
  return {
    library,
    collections,
    service,
    intent,
    result,
    invalidate() {
      for (const listener of invalidations) listener("epoch");
    },
  };
}
function store(): NotesStore {
  return {
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    trash: vi.fn(),
    restore: vi.fn(),
    erase: vi.fn(),
    subscribe: () => () => {},
    persistence: () => ({ status: "ready" }),
    close: vi.fn(),
  };
}
async function capture(
  document = initial.document,
): Promise<{ capture: EditorSourceCapture; saved: SavedNoteSelection }> {
  const selection = captureSourceSelection(document, 1, 5),
    fingerprint = await fingerprintSourceDocument(document);
  return {
    capture: {
      document,
      selection,
      anchor: () => ({ left: 10, top: 10, bottom: 26 }),
      isCurrent: () => true,
      restore: vi.fn(),
    },
    saved: {
      noteId: initial.id,
      noteRevision: 1,
      libraryEpoch: epoch,
      fingerprint,
      passage: selection.passage,
    },
  };
}
beforeEach(() => {
  live.editor = null;
  vi.stubGlobal("crypto", webcrypto);
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
});
afterEach(() => vi.unstubAllGlobals());
it("admits one ordered actual trace for equal-byte replacement while ordinary content callback stays quiet", async () => {
  const changes = vi.fn();
  const view = render(
    <RichEditor
      document={initial.document}
      onChange={changes}
      traceTransactions
    />,
  );
  await waitFor(() => expect(live.editor).toBeTruthy());
  const before = live.editor!.state.doc;
  act(() => {
    live.editor!.view.dispatch(live.editor!.state.tr.insertText("NADH", 1, 5));
  });
  expect(live.editor!.state.doc.eq(before)).toBe(true);
  expect(changes).toHaveBeenCalledTimes(1);
  const [document, trace] = changes.mock.calls[0] as [
    NoteDocument,
    EditorChangeTrace,
  ];
  expect(trace.steps).toHaveLength(1);
  expect(
    mapSourcePassage(verifySourceEdit(trace.before, document, trace.steps), {
      from: 1,
      to: 5,
      quote: "NADH",
    }),
  ).toEqual({ status: "stale", reason: "passage-edited" });
  view.unmount();
  changes.mockClear();
  render(<RichEditor document={initial.document} onChange={changes} />);
  await waitFor(() => expect(live.editor?.isDestroyed).toBe(false));
  act(() => {
    live.editor!.view.dispatch(live.editor!.state.tr.insertText("NADH", 1, 5));
  });
  expect(changes).not.toHaveBeenCalled();
});
it("keeps Add disabled until both the older save and captured latest generation are acknowledged", async () => {
  let saved = initial;
  const first = deferred<Note>(),
    second = deferred<Note>();
  const o = owners(() => saved);
  const writer = vi
    .fn<NotesLibrary["updateWithSourceSteps"]>()
    .mockImplementationOnce(async () => {
      saved = await first.promise;
      return saved;
    })
    .mockImplementationOnce(async () => {
      saved = await second.promise;
      return saved;
    });
  render(
    <NoteEditor
      note={initial}
      store={store()}
      sourceWriter={writer}
      sourceLibrary={o.library}
      source={{ ...o, onOpenCard: vi.fn() }}
      onSaved={vi.fn()}
      onBack={vi.fn()}
      onTrash={vi.fn()}
      onExport={vi.fn()}
    />,
  );
  await waitFor(() => expect(live.editor).toBeTruthy());
  act(() => {
    live.editor!.commands.setContent(doc("NADH first"));
  });
  await waitFor(() => expect(writer).toHaveBeenCalledTimes(1));
  const firstDocument = writer.mock.calls[0]![1].document!;
  act(() => {
    live.editor!.commands.insertContentAt(5, " second");
    live.editor!.commands.setTextSelection({ from: 1, to: 5 });
  });
  const latestDocument = live.editor!.getJSON() as NoteDocument;
  fireEvent.click(screen.getAllByRole("button", { name: "Make a card" })[0]!);
  const dialog = screen.getByRole("dialog", { name: "Make a card" });
  fireEvent.change(within(dialog).getByRole("textbox", { name: "Front" }), {
    target: { value: "User-entered question" },
  });
  expect(within(dialog).getByText("Add card")).toBeDisabled();
  expect(o.service.prepareCreate).not.toHaveBeenCalled();
  await act(async () =>
    first.resolve({ ...initial, document: firstDocument, revision: 2 }),
  );
  await waitFor(() => expect(writer).toHaveBeenCalledTimes(2));
  expect(within(dialog).getByText("Add card")).toBeDisabled();
  await act(async () =>
    second.resolve({ ...initial, document: latestDocument, revision: 3 }),
  );
  await waitFor(() =>
    expect(within(dialog).getByText("Add card")).toBeEnabled(),
  );
  fireEvent.click(within(dialog).getByText("Add card"));
  await waitFor(() => expect(o.service.prepareCreate).toHaveBeenCalled());
  expect(vi.mocked(o.service.prepareCreate).mock.calls[0]?.[0]).toMatchObject({
    noteRevision: 3,
    passage: { from: 1, to: 5, quote: "NADH" },
  });
  expect(vi.mocked(o.service.prepareCreate).mock.calls[0]?.[2]).toMatchObject({
    front: "User-entered question",
    back: "NADH",
  });
});
it("retains one opaque create intent across unknown result and explicit reload/retry", async () => {
  const o = owners(),
    c = await capture();
  vi.mocked(o.service.commit)
    .mockRejectedValueOnce(new Error("Unknown create result"))
    .mockResolvedValueOnce(o.result);
  const added = vi.fn();
  render(
    <SourceCardComposer
      owners={o}
      capture={c.capture}
      stale={false}
      hidden={false}
      onReselect={vi.fn()}
      flush={async () => c.saved}
      onClose={vi.fn()}
      onAdded={added}
    />,
  );
  const dialog = screen.getByRole("dialog", { name: "Make a card" });
  fireEvent.change(within(dialog).getByRole("textbox", { name: "Front" }), {
    target: { value: "User question" },
  });
  await waitFor(() =>
    expect(within(dialog).getByText("Add card")).toBeEnabled(),
  );
  fireEvent.click(within(dialog).getByText("Add card"));
  await screen.findByText("Unknown create result");
  expect(within(dialog).getByRole("textbox", { name: "Front" })).toHaveValue(
    "User question",
  );
  expect(within(dialog).getByText("Retry same action")).toBeDisabled();
  fireEvent.click(within(dialog).getByText("Reload saved data"));
  await waitFor(() =>
    expect(within(dialog).getByText("Retry same action")).toBeEnabled(),
  );
  fireEvent.click(within(dialog).getByText("Retry same action"));
  await waitFor(() => expect(added).toHaveBeenCalledWith(o.result));
  expect(o.service.prepareCreate).toHaveBeenCalledTimes(1);
  expect(vi.mocked(o.service.commit).mock.calls[1]?.[0]).toBe(
    vi.mocked(o.service.commit).mock.calls[0]?.[0],
  );
});
it("clears held card fields and ignores a late result after source epoch revocation", async () => {
  const o = owners(),
    c = await capture(),
    held = deferred<MakeCardResult>();
  vi.mocked(o.service.commit).mockReturnValue(held.promise);
  const added = vi.fn(),
    close = vi.fn();
  const view = render(
    <SourceCardComposer
      owners={o}
      capture={c.capture}
      stale={false}
      hidden={false}
      onReselect={vi.fn()}
      flush={async () => c.saved}
      onClose={close}
      onAdded={added}
    />,
  );
  const dialog = screen.getByRole("dialog", { name: "Make a card" });
  fireEvent.change(within(dialog).getByRole("textbox", { name: "Front" }), {
    target: { value: "Private question" },
  });
  await waitFor(() =>
    expect(within(dialog).getByText("Add card")).toBeEnabled(),
  );
  fireEvent.click(within(dialog).getByText("Add card"));
  await waitFor(() => expect(o.service.commit).toHaveBeenCalled());
  act(() => o.invalidate());
  expect(close).toHaveBeenCalledWith(false);
  view.unmount();
  await act(async () => held.resolve(o.result));
  expect(added).not.toHaveBeenCalled();
  expect(checkClose()).toBe("allowed");
});
it("never interprets literal moustache context as generated extra blanks", async () => {
  const o = owners(),
    document = doc("NADH {{literal}} after"),
    c = await capture(document);
  render(
    <SourceCardComposer
      owners={o}
      capture={c.capture}
      stale={false}
      hidden={false}
      onReselect={vi.fn()}
      flush={async () => c.saved}
      onClose={vi.fn()}
      onAdded={vi.fn()}
    />,
  );
  expect(
    screen.getByRole("button", { name: "Fill in the blank" }),
  ).toBeDisabled();
  expect(screen.getByText(/Blank markers in this context/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Basic" })).toBeEnabled();
  expect(o.service.prepareCreate).not.toHaveBeenCalled();
});

it("never automatically downgrades an equal-document limit failure and captures explicit replacement immutably", async () => {
  let saved = initial;
  const o = owners(() => saved),
    replacement = deferred<Note>(),
    legacy = store();
  const writer = vi
    .fn<NotesLibrary["updateWithSourceSteps"]>()
    .mockRejectedValueOnce(new SourceCodecError("source_codec_limit"))
    .mockImplementation(async (_id, patch, revision) => {
      saved = { ...saved, ...patch, revision: revision + 1 };
      return saved;
    });
  vi.mocked(o.library.replaceDocument).mockImplementation(async () => {
    saved = await replacement.promise;
    return saved;
  });
  render(
    <NoteEditor
      note={initial}
      store={legacy}
      sourceWriter={writer}
      sourceLibrary={o.library}
      onSaved={vi.fn()}
      onBack={vi.fn()}
      onTrash={vi.fn()}
      onExport={vi.fn()}
    />,
  );
  await waitFor(() => expect(live.editor).toBeTruthy());
  act(() => {
    live.editor!.view.dispatch(live.editor!.state.tr.insertText("NADH", 1, 5));
  });
  await screen.findByText("Save without passage links");
  expect(o.library.replaceDocument).not.toHaveBeenCalled();
  expect(legacy.update).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("Save without passage links"));
  const dialog = screen.getByRole("dialog", {
    name: "Save and detach passage links?",
  });
  expect(dialog).toHaveTextContent("detach linked passages");
  expect(o.library.replaceDocument).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByText("Save and detach links"));
  await waitFor(() =>
    expect(o.library.replaceDocument).toHaveBeenCalledTimes(1),
  );
  const captured = vi.mocked(o.library.replaceDocument).mock.calls[0]!;
  expect(captured[0]).toBe(initial.id);
  expect(captured[2]).toBe(1);
  expect(captured[1].document).toEqual(initial.document);
  act(() => {
    live.editor!.commands.insertContentAt(5, " latest");
  });
  await act(async () => replacement.resolve({ ...initial, revision: 2 }));
  expect(
    vi.mocked(o.library.replaceDocument).mock.calls[0]?.[1].document,
  ).toEqual(initial.document);
  expect(screen.getByLabelText("Note content")).toHaveTextContent(
    "NADH latest after",
  );
  await waitFor(() => expect(writer).toHaveBeenCalledTimes(2));
  expect(legacy.update).not.toHaveBeenCalled();
});

it("scopes arrow type navigation to enabled choices and leaves textarea arrows/newlines alone", async () => {
  const o = owners(),
    c = await capture(doc("NADH {{literal}} after"));
  render(
    <SourceCardComposer
      owners={o}
      capture={c.capture}
      stale={false}
      hidden={false}
      onReselect={vi.fn()}
      flush={async () => c.saved}
      onClose={vi.fn()}
      onAdded={vi.fn()}
    />,
  );
  const group = screen.getByRole("group", { name: "Card type" }),
    basic = within(group).getByRole("button", { name: "Basic" }),
    reversed = within(group).getByRole("button", { name: "Reversed" });
  act(() => basic.focus());
  fireEvent.keyDown(basic, { key: "ArrowRight" });
  expect(reversed).toHaveFocus();
  expect(reversed).toHaveAttribute("aria-pressed", "true");
  fireEvent.keyDown(reversed, { key: "ArrowRight" });
  expect(basic).toHaveFocus();
  expect(basic).toHaveAttribute("aria-pressed", "true");
  expect(
    within(group).getByRole("button", { name: "Fill in the blank" }),
  ).toBeDisabled();
  const front = screen.getByRole("textbox", { name: "Front" });
  act(() => front.focus());
  const arrow = new KeyboardEvent("keydown", {
      key: "ArrowRight",
      bubbles: true,
      cancelable: true,
    }),
    enter = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    });
  fireEvent(front, arrow);
  fireEvent(front, enter);
  expect(arrow.defaultPrevented).toBe(false);
  expect(enter.defaultPrevented).toBe(false);
  expect(basic).toHaveAttribute("aria-pressed", "true");
  expect(o.service.prepareCreate).not.toHaveBeenCalled();
});
it("uses a sheet for an actual narrow pane and follows visible keyboard viewport bounds", async () => {
  const o = owners(),
    c = await capture();
  const viewport = new EventTarget() as VisualViewport;
  Object.defineProperties(viewport, {
    offsetLeft: { value: 0, configurable: true },
    offsetTop: { value: 100, configurable: true },
    width: { value: 1000, configurable: true },
    height: { value: 400, configurable: true },
  });
  Object.defineProperty(window, "visualViewport", {
    value: viewport,
    configurable: true,
  });
  const original = HTMLElement.prototype.getBoundingClientRect;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      return this.classList.contains("editor-pane")
        ? new DOMRect(200, 0, 340, 768)
        : original.call(this);
    },
  );
  render(
    <section className="editor-pane">
      <SourceCardComposer
        owners={o}
        capture={c.capture}
        stale={false}
        hidden={false}
        onReselect={vi.fn()}
        flush={async () => c.saved}
        onClose={vi.fn()}
        onAdded={vi.fn()}
      />
    </section>,
  );
  const dialog = screen.getByRole("dialog", { name: "Make a card" });
  expect(dialog).toHaveClass("source-card-sheet");
  expect(dialog.style.left).toBe("208px");
  expect(dialog.style.width).toBe("324px");
  expect(dialog.style.maxHeight).toBe("384px");
  Object.defineProperty(viewport, "height", { value: 300, configurable: true });
  act(() => viewport.dispatchEvent(new Event("resize")));
  expect(dialog.style.maxHeight).toBe("284px");
  expect(dialog.style.bottom).toBe(`${innerHeight - 400}px`);
  vi.restoreAllMocks();
  Object.defineProperty(window, "visualViewport", {
    value: undefined,
    configurable: true,
  });
});

it("rejects atom-containing projection even with matching document digest and quote", async () => {
  const document: NoteDocument = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "NADH" }] },
        { type: "horizontalRule" },
        { type: "paragraph", content: [{ type: "text", text: "after" }] },
      ],
    },
    fingerprint = await fingerprintSourceDocument(document),
    unavailable = vi.fn();
  const target = {
    key: anchorId,
    noteId: initial.id,
    noteRevision: 1,
    documentDigest: fingerprint.digest,
    from: 1,
    to: 13,
    quote: "NADH\n\ufffc\nafter",
  };
  const view = render(
    <RichEditor
      document={document}
      onChange={vi.fn()}
      sourceControl={{
        noteId: initial.id,
        noteRevision: 1,
        annotations: [target],
        target,
        onCapture: vi.fn(),
        onTargetUnavailable: unavailable,
      }}
    />,
  );
  await waitFor(() => expect(unavailable).toHaveBeenCalled());
  expect(view.container.querySelector(".study-source-highlight")).toBeNull();
  expect(view.container.querySelector(".study-source-annotation")).toBeNull();
});

it("names the actual current destination only after a fenced owner read", async () => {
  const o = owners(),
    pending = deferred<CollectionsState>(),
    base = await o.collections.read();
  vi.mocked(o.collections.read).mockReturnValueOnce(pending.promise);
  render(
    <SourceCardNotice
      owners={o}
      result={o.result}
      onClose={vi.fn()}
      onOpen={vi.fn()}
    />,
  );
  expect(screen.getByText("Card added")).toBeInTheDocument();
  await act(async () =>
    pending.resolve({
      ...base,
      study: {
        ...base.study,
        entries: [
          {
            id: entryId,
            deckId,
            revision: 1,
            type: "basic",
            front: "Question",
            back: "Answer",
            tags: [],
            source: null,
          },
        ],
      },
    }),
  );
  await screen.findByText("Card added to Real chosen deck");
});
it("does not publish a delayed destination label after source revocation", async () => {
  const o = owners(),
    pending = deferred<CollectionsState>(),
    base = await o.collections.read(),
    close = vi.fn();
  vi.mocked(o.collections.read).mockReturnValueOnce(pending.promise);
  render(
    <SourceCardNotice
      owners={o}
      result={o.result}
      onClose={close}
      onOpen={vi.fn()}
    />,
  );
  act(() => o.invalidate());
  await act(async () =>
    pending.resolve({
      ...base,
      study: {
        ...base.study,
        entries: [
          {
            id: entryId,
            deckId,
            revision: 1,
            type: "basic",
            front: "Question",
            back: "Answer",
            tags: [],
            source: null,
          },
        ],
      },
    }),
  );
  expect(close).toHaveBeenCalled();
  expect(screen.queryByText(/Card added to/)).not.toBeInTheDocument();
});
