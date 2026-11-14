import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import type { Note, NotesStore } from "../../src/domain/contracts";
import type {
  NotesLibrary,
  NotesLibraryStore,
  LibrarySnapshot,
} from "../../src/library/contracts";
import type {
  NoteLinkService,
  OwnerAdmission,
} from "../../src/links/contracts";
import { createSetupPreference } from "../../src/setup/preference";
import { registerCloseGuard, checkClose } from "../../src/desktop/closeGuard";
import { Workspace } from "../../src/ui/Workspace";
import { FirstRunSetup } from "../../src/ui/FirstRunSetup";
const model = vi.hoisted(() => ({
  boot: true,
  service: null as NoteLinkService | null,
  mounts: 0,
  unmounts: 0,
}));
vi.mock("../../src/ui/noteLinkOwner", () => ({
  useNoteLinkOwner: () => ({
    service: model.service,
    bootSettled: model.boot,
    error: "",
    retry: vi.fn(),
  }),
}));
vi.mock("../../src/ui/studySourceOwners", () => ({
  useStudySourceOwners: () => ({
    service: null,
    collections: null,
    bootSettled: model.boot,
    error: "",
    retry: vi.fn(),
  }),
}));
vi.mock("../../src/ui/CollectionsHost", async () => {
  const React = await import("react");
  return {
    CollectionsHost: ({ view }: { view: string }) => {
      const [value, setValue] = React.useState(0);
      React.useEffect(() => {
        model.mounts++;
        return () => {
          model.unmounts++;
        };
      }, []);
      return (
        <section aria-label={`${view} actor`}>
          <output>{value}</output>
          <button onClick={() => setValue(value + 1)}>Advance actor</button>
        </section>
      );
    },
  };
});
type NoteInput = Parameters<NotesStore["create"]>[0];
const epoch = "22222222-2222-4222-8222-222222222222",
  accountId = "11111111-1111-4111-8111-111111111111";
function fixture({
  populated = false,
  incoming = false,
  readOnly = false,
  dismissed = false,
} = {}) {
  const notes: Note[] = populated
    ? [
        {
          id: "existing",
          revision: 1,
          title: "Existing note",
          document: { type: "doc", content: [{ type: "paragraph" }] },
          tags: [],
          createdAt: "2026-11-11T00:00:00Z",
          updatedAt: "2026-11-11T00:00:00Z",
          trashedAt: null,
        },
      ]
    : [];
  const snapshot = (): LibrarySnapshot => ({
      token: { epoch, revision: notes.length },
      notes: [...notes],
      tags: [],
      metadata: [],
      preferences: { sort: "edited" },
    }),
    listeners = new Set<() => void>(),
    linkListeners = new Set<() => void>();
  let admission: OwnerAdmission = readOnly
    ? {
        mode: "index-recovery",
        token: snapshot().token,
        reason: "index-invalid",
      }
    : { mode: "current", token: snapshot().token, graph: "pending" };
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
  const append = (input: NoteInput): Note => {
    const note: Note = {
      ...input,
      id: `import-${notes.length}`,
      revision: 1,
      createdAt: "2026-11-11T00:00:00Z",
      updatedAt: "2026-11-11T00:00:00Z",
      trashedAt: null,
    };
    notes.push(note);
    listeners.forEach((fn) => fn());
    return note;
  };
  const store: NotesStore = {
    list: vi.fn(async () => [...notes]),
    get: vi.fn(async (id) => notes.find((note) => note.id === id) ?? null),
    create: vi.fn(async (input) => append(input)),
    update: vi.fn(),
    trash: vi.fn(),
    restore: vi.fn(),
    erase: vi.fn(),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    persistence: () => ({ status: "ready" }),
    close: vi.fn(),
  };
  const owner: NotesLibraryStore = { ...store, library };
  const service: NoteLinkService = {
    admission: vi.fn(async () => admission),
    currentToken: vi.fn(),
    search: vi.fn(),
    reference: vi.fn(),
    resolve: vi.fn(),
    outgoing: vi.fn(),
    backlinks: vi.fn(),
    linkedNoteIds: vi.fn(async () => ({
      status: "ready" as const,
      token: snapshot().token,
      items: [],
    })),
    verifyGraph: vi.fn(),
    cancelVerification: vi.fn(),
    prepareRepair: vi.fn(),
    commitRepair: vi.fn(),
    prepareExport: vi.fn(),
    exportFiles: vi.fn(),
    assertFreshExport: vi.fn(),
    subscribe: (listener) => {
      linkListeners.add(listener);
      return () => {
        linkListeners.delete(listener);
      };
    },
    onInvalidate: () => () => {},
    close: vi.fn(),
  };
  model.service = service;
  const preference = createSetupPreference(() => null);
  if (dismissed) preference.dismiss();
  const props = {
    store,
    library,
    sourceOwner: owner,
    session: {
      accountId,
      deviceId: "33333333-3333-4333-8333-333333333333",
      email: "setup-boundary@example.test",
      deviceState: "trusted" as const,
    },
    onSignOut: vi.fn(async () => {}),
    incomingNoteIntentActive: incoming,
    setupPreference: preference,
  };
  const view = render(<Workspace {...props} />);
  return {
    view,
    props,
    store,
    notes,
    append,
    preference,
    notify: () => listeners.forEach((fn) => fn()),
    writable: () => {
      admission = {
        mode: "current",
        token: snapshot().token,
        graph: "pending",
      };
      linkListeners.forEach((fn) => fn());
    },
  };
}
beforeEach(() => {
  model.boot = true;
  model.service = null;
  model.mounts = 0;
  model.unmounts = 0;
  vi.stubGlobal("matchMedia", () => ({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
  window.scrollBy = vi.fn();
});
afterEach(() => vi.unstubAllGlobals());
function file(name: string, text: string) {
  const value = new File([text], name, { type: "text/markdown" });
  Object.defineProperty(value, "text", { value: vi.fn(async () => text) });
  return value;
}
async function setup() {
  return screen.findByRole("dialog", { name: "Set up Orbyn Notes" });
}
async function skipAll() {
  let dialog = await setup();
  fireEvent.click(within(dialog).getByRole("button", { name: "Skip" }));
  fireEvent.click(within(dialog).getByRole("button", { name: "Skip" }));
  await waitFor(() =>
    expect(
      screen.queryByRole("dialog", { name: "Set up Orbyn Notes" }),
    ).not.toBeInTheDocument(),
  );
}
it("opens optional setup once for a genuinely scoped empty writable library and reaches exact empty-library actions after skip", async () => {
  const f = fixture();
  const dialog = await setup();
  expect(dialog).toHaveTextContent("Every step is optional.");
  expect(dialog).toHaveTextContent("Apple Notes import isn’t available");
  expect(
    within(dialog).queryByRole("button", { name: /Apple|Sync|Plus/ }),
  ).not.toBeInTheDocument();
  await skipAll();
  expect(f.preference.isDismissed()).toBe(true);
  expect(screen.getByRole("heading", { name: "No notes yet" })).toBeVisible();
  expect(
    screen.getByText(
      "Write your first note, or bring in what you already have.",
    ),
  ).toBeVisible();
  expect(screen.getByText("Notes are encrypted on this device.")).toBeVisible();
  expect(screen.getByRole("button", { name: "Import notes" })).toBeVisible();
  expect(
    screen.getByText(
      "Setup closed. This browser couldn’t save the preference.",
    ),
  ).toBeVisible();
});
it("consumes the automatic attempt when an incoming intent refuses it, without takeover when the intent finishes", async () => {
  const f = fixture({ incoming: true });
  await screen.findByRole("heading", { name: "No notes yet" });
  await act(async () => {});
  expect(
    screen.queryByRole("dialog", { name: "Set up Orbyn Notes" }),
  ).not.toBeInTheDocument();
  f.view.rerender(<Workspace {...f.props} incomingNoteIntentActive={false} />);
  act(f.notify);
  await act(async () => {});
  expect(
    screen.queryByRole("dialog", { name: "Set up Orbyn Notes" }),
  ).not.toBeInTheDocument();
});
it("does not open after read-only recovery or after a dirty guard later clears", async () => {
  const f = fixture({ readOnly: true });
  await screen.findByText(
    "Note links need repair. Your notes are still available.",
  );
  await act(async () => {});
  act(f.writable);
  await act(async () => {});
  expect(
    screen.queryByRole("dialog", { name: "Set up Orbyn Notes" }),
  ).not.toBeInTheDocument();
  f.view.unmount();
  const stop = registerCloseGuard(() => false);
  const other = fixture();
  try {
    await screen.findByRole("heading", { name: "No notes yet" });
    await act(async () => {});
  } finally {
    stop();
  }
  act(other.notify);
  await act(async () => {});
  expect(
    screen.queryByRole("dialog", { name: "Set up Orbyn Notes" }),
  ).not.toBeInTheDocument();
});
it("keeps a clean Study actor mounted through explicit Settings setup, even when the profile hint was already dismissed", async () => {
  const f = fixture({ populated: true, dismissed: true });
  await screen.findByRole("heading", { name: "All notes" });
  fireEvent.click(screen.getByRole("button", { name: "Study" }));
  const actor = await screen.findByRole("region", { name: "study actor" });
  fireEvent.click(within(actor).getByRole("button", { name: "Advance actor" }));
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  fireEvent.click(
    within(screen.getByRole("dialog", { name: "Settings" })).getByRole(
      "button",
      { name: "Set up Notes" },
    ),
  );
  const dialog = await setup();
  fireEvent.click(within(dialog).getByRole("button", { name: "Close setup" }));
  await waitFor(() =>
    expect(
      screen.queryByRole("dialog", { name: "Set up Orbyn Notes" }),
    ).not.toBeInTheDocument(),
  );
  expect(
    within(screen.getByRole("region", { name: "study actor" })).getByRole(
      "status",
    ),
  ).toHaveTextContent("1");
  expect(model.mounts).toBe(1);
  expect(model.unmounts).toBe(0);
  expect(f.preference.isDismissed()).toBe(true);
});
it("cancels the actual file-selection operation without completing setup or leaving a held close guard", async () => {
  const f = fixture();
  fireEvent.click(
    within(await setup()).getByRole("button", { name: "Import notes" }),
  );
  expect(checkClose()).toBe("draft");
  act(() => {
    f.view.container
      .querySelector("input[type=file]")!
      .dispatchEvent(new Event("cancel"));
  });
  await waitFor(() => expect(checkClose()).toBe("allowed"));
  expect(
    within(await setup()).getByRole("button", { name: "Import notes" }),
  ).toBeEnabled();
  expect(f.store.create).not.toHaveBeenCalled();
  expect(f.preference.isDismissed()).toBe(false);
});
it("preserves partial imports and retries only remaining Markdown while reporting real completion", async () => {
  const f = fixture();
  fireEvent.click(
    within(await setup()).getByRole("button", { name: "Import notes" }),
  );
  fireEvent.change(f.view.container.querySelector("input[type=file]")!, {
    target: { files: [file("one.md", "# One"), file("two.md", "# Two")] },
  });
  const review = await screen.findByRole("dialog", { name: "Import Markdown" });
  vi.mocked(f.store.create)
    .mockImplementationOnce(async (input) => f.append(input))
    .mockRejectedValueOnce(Error("Storage is full."));
  fireEvent.click(
    within(review).getByRole("button", { name: "Import remaining" }),
  );
  await within(review).findByText(/Imported 1 of 2 notes/);
  expect(f.notes).toHaveLength(1);
  expect(checkClose()).toBe("draft");
  fireEvent.click(
    within(review).getByRole("button", { name: "Import remaining" }),
  );
  await waitFor(() =>
    expect(
      screen.queryByRole("dialog", { name: "Import Markdown" }),
    ).not.toBeInTheDocument(),
  );
  expect(f.notes).toHaveLength(2);
  expect(f.store.create).toHaveBeenCalledTimes(3);
  expect(within(await setup()).getByText("2 notes imported.")).toBeVisible();
  expect(within(await setup()).getByText("Step 3 of 3")).toBeVisible();
  expect(f.preference.isDismissed()).toBe(false);
});
it("uses truthful native storage copy without a working sync or Apple Notes action", () => {
  render(
    <FirstRunSetup
      email="synthetic@example.test"
      environment="desktop"
      importState="idle"
      onChooseMarkdown={vi.fn()}
      onComplete={vi.fn()}
      onClose={vi.fn()}
    />,
  );
  const dialog = screen.getByRole("dialog", { name: "Set up Orbyn Notes" });
  expect(dialog).toHaveTextContent("in this app on this device");
  expect(dialog).not.toHaveTextContent("browser profile");
  expect(dialog).not.toHaveTextContent("Plus");
  expect(
    within(dialog).queryByRole("button", { name: /Sync|Apple/ }),
  ).not.toBeInTheDocument();
});
it("closes clean setup for an incoming intent without completing the profile hint or reopening afterward", async () => {
  const f = fixture();
  await setup();
  f.view.rerender(<Workspace {...f.props} incomingNoteIntentActive />);
  await waitFor(() =>
    expect(
      screen.queryByRole("dialog", { name: "Set up Orbyn Notes" }),
    ).not.toBeInTheDocument(),
  );
  expect(f.preference.isDismissed()).toBe(false);
  f.view.rerender(<Workspace {...f.props} incomingNoteIntentActive={false} />);
  act(f.notify);
  await act(async () => {});
  expect(
    screen.queryByRole("dialog", { name: "Set up Orbyn Notes" }),
  ).not.toBeInTheDocument();
});
it("disposes the Journal actor while setup is visible and creates a new protected owner on return", async () => {
  fixture({ populated: true, dismissed: true });
  await screen.findByRole("heading", { name: "All notes" });
  fireEvent.click(screen.getByRole("button", { name: "Journal" }));
  const actor = await screen.findByRole("region", { name: "journal actor" });
  fireEvent.click(within(actor).getByRole("button", { name: "Advance actor" }));
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  fireEvent.click(
    within(screen.getByRole("dialog", { name: "Settings" })).getByRole(
      "button",
      { name: "Set up Notes" },
    ),
  );
  const dialog = await setup();
  expect(
    screen.queryByRole("region", { name: "journal actor" }),
  ).not.toBeInTheDocument();
  expect(model.unmounts).toBe(1);
  fireEvent.click(within(dialog).getByRole("button", { name: "Close setup" }));
  const returned = await screen.findByRole("region", { name: "journal actor" });
  expect(within(returned).getByRole("status")).toHaveTextContent("0");
  expect(model.mounts).toBe(2);
});
it("keeps invalid Markdown selection on the import step with no writes, completion or held guard", async () => {
  const f = fixture();
  fireEvent.click(
    within(await setup()).getByRole("button", { name: "Import notes" }),
  );
  fireEvent.change(f.view.container.querySelector("input[type=file]")!, {
    target: { files: [file("wrong.txt", "not Markdown")] },
  });
  const dialog = await setup();
  await within(dialog).findByRole("alert");
  expect(dialog).toHaveTextContent("Choose Markdown files up to 2 MB each.");
  expect(dialog).toHaveTextContent("Step 2 of 3");
  expect(f.store.create).not.toHaveBeenCalled();
  expect(f.preference.isDismissed()).toBe(false);
  expect(checkClose()).toBe("allowed");
  expect(
    within(dialog).getByRole("button", { name: "Import notes" }),
  ).toBeEnabled();
});
