import { useState } from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { webcrypto } from "node:crypto";
import type { Note, NoteDocument } from "../../src/domain/contracts";
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
import type { EditorSourceCapture } from "../../src/ui/RichEditor";
import {
  SourceCardComposer,
  SourceCardNotice,
} from "../../src/ui/SourceCardComposer";
import { emptyStudy } from "../../src/collections/validation";
import {
  captureSourceSelection,
  fingerprintSourceDocument,
} from "../../src/study/sourceCodec";
beforeEach(() => {
  vi.stubGlobal("crypto", webcrypto);
  // Vitest does not load CSS. Supply only the two normal exit names/durations
  // for DOM completion filtering; genuine browser tests qualify actual CSS.
  const style = document.createElement("style");
  style.dataset.sourceMotionFixture = "true";
  style.textContent =
    ".source-card-popover.source-closing{animation-name:source-pop-out;animation-duration:.14s}.source-card-notice.source-closing{animation-name:source-toast-out;animation-duration:.14s}";
  document.head.append(style);
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});
afterEach(() => {
  document
    .querySelectorAll("style[data-source-motion-fixture]")
    .forEach((node) => node.remove());
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
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
function end(element: Element, name: string) {
  const event = new Event("animationend", { bubbles: true });
  Object.defineProperty(event, "animationName", { value: name });
  fireEvent(element, event);
}
async function fixture() {
  const o = owners(),
    c = await capture(),
    closed = vi.fn(),
    route = vi.fn(),
    added = vi.fn();
  function Harness() {
    const [open, setOpen] = useState(true);
    return (
      <>
        <button onClick={route}>Underlying route</button>
        {open && (
          <SourceCardComposer
            owners={o}
            capture={c.capture}
            stale={false}
            hidden={false}
            flush={async () => c.saved}
            onReselect={vi.fn()}
            onAdded={added}
            onClose={(restore) => {
              closed(restore);
              setOpen(false);
            }}
          />
        )}
      </>
    );
  }
  const view = render(<Harness />);
  await waitFor(() =>
    expect(screen.getByRole("combobox", { name: "Deck" })).toHaveValue(deckId),
  );
  return { o, c, closed, route, added, view };
}
it("consumes clean outside navigation, exits once and makes its outgoing controls inert", async () => {
  const f = await fixture();
  fireEvent.click(screen.getByRole("button", { name: "Underlying route" }));
  const dialog = screen.getByRole("dialog", { hidden: true });
  expect(dialog).toHaveClass("source-closing");
  expect(dialog).toHaveAttribute("inert");
  expect(dialog).toHaveAttribute("aria-hidden", "true");
  expect(f.route).not.toHaveBeenCalled();
  expect(f.closed).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Underlying route" }));
  expect(f.route).not.toHaveBeenCalled();
  expect(
    screen.queryByText("Finish or cancel this card draft before leaving."),
  ).not.toBeInTheDocument();
  end(dialog, "source-pop-in");
  end(dialog.querySelector("h2")!, "source-pop-out");
  expect(f.closed).not.toHaveBeenCalled();
  end(dialog, "source-pop-out");
  expect(f.closed).toHaveBeenCalledExactlyOnceWith(false);
  expect(
    screen.queryByRole("dialog", { hidden: true }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Underlying route" }));
  expect(f.route).toHaveBeenCalledOnce();
});
it("keeps live dirty fields and confirmation actionable instead of starting an exit", async () => {
  const f = await fixture();
  fireEvent.change(screen.getByRole("textbox", { name: "Front" }), {
    target: { value: "My actual draft" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Underlying route" }));
  expect(f.route).not.toHaveBeenCalled();
  expect(screen.getByRole("dialog", { name: "Make a card" })).not.toHaveClass(
    "source-closing",
  );
  expect(screen.getByRole("textbox", { name: "Front" })).toHaveValue(
    "My actual draft",
  );
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  const confirm = screen.getByRole("dialog", { name: "Discard card draft?" });
  expect(confirm).not.toHaveAttribute("inert");
  fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
  expect(screen.getByRole("textbox", { name: "Front" })).toHaveValue(
    "My actual draft",
  );
  expect(f.o.service.commit).not.toHaveBeenCalled();
});
it("source revoke closes immediately during an exit and retires its old completion", async () => {
  const f = await fixture();
  fireEvent.click(screen.getByRole("button", { name: "Underlying route" }));
  const old = screen.getByRole("dialog", { hidden: true });
  act(() => f.o.invalidate());
  expect(f.closed).toHaveBeenCalledExactlyOnceWith(false);
  expect(
    screen.queryByRole("dialog", { hidden: true }),
  ).not.toBeInTheDocument();
  end(old, "source-pop-out");
  expect(f.closed).toHaveBeenCalledTimes(1);
});
it("opening Front autofocus happens only after visible position has committed", async () => {
  const focus = HTMLElement.prototype.focus,
    calls: string[] = [];
  vi.spyOn(HTMLElement.prototype, "focus").mockImplementation(function (
    this: HTMLElement,
    options,
  ) {
    if (this.getAttribute("placeholder") === "Write the question")
      calls.push(
        getComputedStyle(this.closest(".source-card-popover")!).visibility,
      );
    focus.call(this, options);
  });
  await fixture();
  expect(calls).toContain("visible");
  expect(calls).not.toContain("hidden");
  expect(screen.getByRole("textbox", { name: "Front" })).toHaveFocus();
});
it("notice outgoing semantics filter entry/child completion and preserve one close", async () => {
  const o = owners(),
    closed = vi.fn();
  render(
    <SourceCardNotice
      owners={o}
      result={o.result}
      onClose={closed}
      onOpen={vi.fn()}
    />,
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Dismiss card notification" }),
  );
  const notice = document.querySelector(".source-card-notice")!;
  expect(notice).toHaveAttribute("inert");
  expect(notice).toHaveAttribute("aria-hidden", "true");
  end(notice, "source-toast-in");
  end(notice.querySelector("span")!, "source-toast-out");
  expect(closed).not.toHaveBeenCalled();
  end(notice, "source-toast-out");
  end(notice, "source-toast-out");
  expect(closed).toHaveBeenCalledOnce();
});
it("missing exit events use one bounded fallback, without replaying the outside route", async () => {
  const f = await fixture();
  vi.useFakeTimers();
  fireEvent.click(screen.getByRole("button", { name: "Underlying route" }));
  act(() => vi.advanceTimersByTime(173));
  expect(f.closed).not.toHaveBeenCalled();
  act(() => vi.advanceTimersByTime(1));
  expect(f.closed).toHaveBeenCalledExactlyOnceWith(false);
  act(() => vi.advanceTimersByTime(1000));
  expect(f.closed).toHaveBeenCalledTimes(1);
  expect(f.route).not.toHaveBeenCalled();
});
it("an unknown source result keeps the submitted draft and refuses outside dismissal", async () => {
  const f = await fixture();
  vi.mocked(f.o.service.commit).mockRejectedValueOnce(
    Error("Unknown saved result"),
  );
  fireEvent.change(screen.getByRole("textbox", { name: "Front" }), {
    target: { value: "Retained question" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Add card" }));
  await screen.findByText("Unknown saved result");
  fireEvent.click(screen.getByRole("button", { name: "Underlying route" }));
  expect(f.route).not.toHaveBeenCalled();
  expect(f.closed).not.toHaveBeenCalled();
  expect(screen.getByRole("textbox", { name: "Front" })).toHaveValue(
    "Retained question",
  );
  expect(
    screen.getByRole("dialog", { name: "Make a card" }),
  ).not.toHaveAttribute("inert");
  expect(f.o.service.commit).toHaveBeenCalledTimes(1);
});
