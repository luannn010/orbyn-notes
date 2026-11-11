import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Workspace } from "../../src/ui/Workspace";
import type { Note, NotesStore } from "../../src/domain/contracts";
import type { NotesLibrary } from "../../src/library/contracts";
import type {
  CollectionsStore,
  CollectionsState,
} from "../../src/collections/contracts";
import type {
  StudySourceService,
  SourceResolution,
} from "../../src/study/sourceContracts";
import { emptyStudy } from "../../src/collections/validation";
const model = vi.hoisted(() => ({
  owners: null as {
    collections: CollectionsStore;
    service: StudySourceService;
    error: string;
    retry: () => void;
  } | null,
}));
vi.mock("../../src/ui/studySourceOwners", () => ({
  useStudySourceOwners: () => model.owners,
}));
vi.mock("../../src/ui/CollectionsHost", () => ({
  CollectionsHost: ({
    onOpenSource,
  }: {
    onOpenSource?: (request: { entryId: string }) => void;
  }) => (
    <section aria-label="Study route boundary">
      <button
        onClick={() =>
          onOpenSource?.({ entryId: "33333333-3333-4333-8333-333333333333" })
        }
      >
        Open saved source
      </button>
    </section>
  ),
}));
vi.mock("../../src/ui/NoteEditor", () => ({
  NoteEditor: (
    props: Parameters<typeof import("../../src/ui/NoteEditor").NoteEditor>[0],
  ) => (
    <section>
      <h2>Source reader</h2>
      <button
        disabled={!props.source?.target}
        onClick={() => props.source?.onTargetUnavailable?.()}
      >
        Report stale projection
      </button>
      <button onClick={() => props.onExport(props.note)}>
        Export this note
      </button>
    </section>
  ),
}));
const epoch = "11111111-1111-4111-8111-111111111111",
  entryId = "33333333-3333-4333-8333-333333333333";
const note: Note = {
  id: "source-note",
  revision: 1,
  title: "Source",
  tags: [],
  document: {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: "NADH" }] }],
  },
  createdAt: "2026-11-11T00:00:00.000Z",
  updatedAt: "2026-11-11T00:00:00.000Z",
  trashedAt: null,
};
const attached: SourceResolution = {
  status: "attached",
  entryId,
  anchorId: "44444444-4444-4444-8444-444444444444",
  anchorRevision: 1,
  noteId: note.id,
  noteRevision: 1,
  documentDigest: "a".repeat(64),
  from: 1,
  to: 5,
  quote: "NADH",
};
// Explicit routing/projection boundary doubles; encrypted passage authority is covered by the real browser fixture.
function fixture() {
  const collection: CollectionsState = {
    version: 3,
    epoch,
    revision: 1,
    study: {
      ...emptyStudy(),
      entries: [
        {
          id: entryId,
          revision: 1,
          deckId: "22222222-2222-4222-8222-222222222222",
          type: "basic",
          front: "Question",
          back: "NADH",
          tags: [],
          source: {
            version: 2,
            noteId: note.id,
            noteRevision: 1,
            quote: "NADH",
            libraryEpoch: epoch,
            anchorId: attached.status === "attached" ? attached.anchorId : "",
          },
        },
      ],
    },
    journal: null,
    clips: { items: [], receipts: [] },
  };
  const collections: CollectionsStore = {
    read: vi.fn(async () => collection),
    update: vi.fn(),
    subscribe: () => () => {},
    persistence: () => ({ status: "ready" }),
    close: vi.fn(),
  };
  const service: StudySourceService = {
    prepareCreate: vi.fn(),
    prepareUndo: vi.fn(),
    commit: vi.fn(),
    resolve: vi.fn(async () => attached),
    annotations: vi.fn(async () => []),
    subscribe: () => () => {},
    persistence: () => ({ status: "ready" }),
    onInvalidate: () => () => {},
    close: vi.fn(),
  };
  const library: NotesLibrary = {
    read: vi.fn(async () => ({
      mode: "ready" as const,
      snapshot: {
        token: { epoch, revision: 1 },
        notes: [note],
        tags: [],
        metadata: [],
        preferences: { sort: "edited" as const },
      },
    })),
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
  const store: NotesStore = {
    list: vi.fn(async () => [note]),
    get: vi.fn(async () => note),
    create: vi.fn(),
    update: vi.fn(),
    trash: vi.fn(),
    restore: vi.fn(),
    erase: vi.fn(),
    subscribe: () => () => {},
    persistence: () => ({ status: "ready" }),
    close: vi.fn(),
  };
  model.owners = { collections, service, error: "", retry: vi.fn() };
  const view = render(
    <Workspace
      store={store}
      library={library}
      session={{
        accountId: epoch,
        deviceId: epoch,
        email: "source-routing-boundary@example.test",
        deviceState: "trusted",
      }}
      onSignOut={vi.fn()}
    />,
  );
  return { view, service };
}
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
  vi.stubGlobal("matchMedia", () => ({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  URL.createObjectURL = vi.fn(() => "blob:unrelated-export");
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => vi.unstubAllGlobals());
async function readerWithExport() {
  fireEvent.click(await screen.findByRole("button", { name: "Study" }));
  fireEvent.click(await screen.findByText("Open saved source"));
  await screen.findByRole("heading", { name: "Source reader" });
  fireEvent.click(screen.getByText("Export this note"));
  fireEvent.click(
    within(screen.getByRole("dialog", { name: "Export Markdown" })).getByRole(
      "button",
      { name: "Export" },
    ),
  );
}
it("clears stale projection feedback on a fresh source jump without deleting an unrelated export notice", async () => {
  const f = fixture();
  await readerWithExport();
  fireEvent.click(screen.getByText("Report stale projection"));
  await screen.findByText(/This saved passage target changed/);
  expect(f.view.container.querySelector(".notice")).toHaveTextContent(
    "Export prepared",
  );
  fireEvent.click(screen.getByRole("button", { name: "Back to card" }));
  fireEvent.click(screen.getByText("Open saved source"));
  await screen.findByRole("heading", { name: "Source reader" });
  expect(
    screen.queryByText(/This saved passage target changed/),
  ).not.toBeInTheDocument();
  expect(f.view.container.querySelector(".notice")).toHaveTextContent(
    "Export prepared",
  );
  expect(f.service.resolve).toHaveBeenCalledTimes(2);
});
it("shows one stale fallback warning and preserves the unrelated notice when ordinary Open note succeeds", async () => {
  const f = fixture();
  await readerWithExport();
  fireEvent.click(screen.getByText("Report stale projection"));
  await screen.findByText(/This saved passage target changed/);
  fireEvent.click(screen.getByRole("button", { name: "Back to card" }));
  vi.mocked(f.service.resolve).mockResolvedValue({
    status: "unavailable",
    reason: "stale",
  });
  fireEvent.click(screen.getByText("Open saved source"));
  await screen.findByText("The source passage changed.");
  fireEvent.click(
    screen.getByRole("button", { name: "Open note without passage" }),
  );
  await screen.findByRole("heading", { name: "Source reader" });
  expect(screen.getAllByText("The source passage changed.")).toHaveLength(1);
  expect(
    screen.queryByText(/This saved passage target changed/),
  ).not.toBeInTheDocument();
  expect(f.view.container.querySelector(".notice")).toHaveTextContent(
    "Export prepared",
  );
  await waitFor(() => expect(f.service.resolve).toHaveBeenCalledTimes(3));
});
