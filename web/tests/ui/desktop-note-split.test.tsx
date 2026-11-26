import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Note, NotesStore } from "../../src/domain/contracts";
import { Workspace } from "../../src/ui/Workspace";

const bridge = vi.hoisted(() => ({
  current: {
    toolbar: null,
    navigationRef: { current: null },
    setLayout: vi.fn(),
    setNavigation: vi.fn(),
    setChrome: vi.fn(),
  } as object | null,
}));
vi.mock("../../src/desktop/DesktopShell", () => ({
  useDesktop: () => bridge.current,
}));
vi.mock("../../src/ui/RichEditor", () => ({
  RichEditor: () => <div aria-label="Note content">Writing surface</div>,
}));

let resize: () => void;
let availableWidth = 1000;
beforeEach(() => {
  localStorage.clear();
  bridge.current = {
    toolbar: null,
    navigationRef: { current: null },
    setLayout: vi.fn(),
    setNavigation: vi.fn(),
    setChrome: vi.fn(),
  };
  availableWidth = 1000;
  vi.stubGlobal("matchMedia", () => ({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    () => new DOMRect(0, 0, availableWidth, 700),
  );
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        resize = callback;
      }
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function fixture(update?: NotesStore["update"], tags: string[][] = []) {
  const notes: Note[] = ["First", "Second"].map((title, i) => ({
    id: `note-${i}`,
    title,
    document: { type: "doc", content: [{ type: "paragraph" }] },
    tags: tags[i] ?? [],
    revision: 1,
    createdAt: "2026-11-15T00:00:00Z",
    updatedAt: "2026-11-15T00:00:00Z",
    trashedAt: null,
  }));
  const unexpected = vi.fn(async () => {
    throw Error("Unexpected write");
  });
  const store: NotesStore = {
    list: async () => notes,
    get: async (id) => notes.find((note) => note.id === id) ?? null,
    create: unexpected,
    update: update ?? unexpected,
    trash: unexpected,
    restore: unexpected,
    erase: unexpected,
    subscribe: () => () => {},
    persistence: () => ({ status: "ready" }),
    close: vi.fn(),
  };
  render(
    <Workspace
      store={store}
      session={{
        accountId: "split",
        deviceId: "device",
        email: "split@example.test",
        deviceState: "trusted",
      }}
      onSignOut={async () => {}}
    />,
  );
  return { unexpected };
}

function openTagEditor() {
  const trigger = screen.queryByRole("button", { name: "Manage note tags" });
  if (trigger?.getAttribute("aria-expanded") === "false")
    fireEvent.click(trigger);
}

it("keeps the desktop list available with an active note and guards switching away from an unfinished tag", async () => {
  const { unexpected } = fixture();
  fireEvent.click(await screen.findByRole("button", { name: /^First/ }));
  await screen.findByLabelText("Note title");
  const list = screen.getByRole("region", { name: "Notes list" });
  const first = within(list).getByRole("button", { name: /^First/ });
  expect(first).toHaveAttribute("aria-current", "page");
  openTagEditor();
  fireEvent.change(
    screen.getByRole("textbox", { name: "Tags, separated by commas" }),
    {
      target: { value: "unfinished" },
    },
  );
  fireEvent.click(first);
  expect(
    screen.queryByText(
      "Finish or discard your unsaved changes before leaving.",
    ),
  ).not.toBeInTheDocument();
  fireEvent.click(within(list).getByRole("button", { name: /^Second/ }));
  expect(screen.getByLabelText("Note title")).toHaveValue("First");
  expect(
    screen.getByRole("textbox", { name: "Tags, separated by commas" }),
  ).toHaveValue("unfinished");
  expect(
    screen.getByText("Finish or discard your unsaved changes before leaving."),
  ).toBeVisible();
  fireEvent.change(
    screen.getByRole("textbox", { name: "Tags, separated by commas" }),
    {
      target: { value: "" },
    },
  );
  fireEvent.click(within(list).getByRole("button", { name: /^Second/ }));
  expect(await screen.findByLabelText("Note title")).toHaveValue("Second");
  expect(within(list).getByRole("button", { name: /^Second/ })).toHaveAttribute(
    "aria-current",
    "page",
  );
  expect(unexpected).not.toHaveBeenCalled();
});

it("falls back to one pane without remounting the editor or losing its tag draft, and restores the list on expansion", async () => {
  fixture();
  fireEvent.click(await screen.findByRole("button", { name: /^First/ }));
  const title = await screen.findByLabelText("Note title");
  openTagEditor();
  fireEvent.change(
    screen.getByRole("textbox", { name: "Tags, separated by commas" }),
    {
      target: { value: '"retained' },
    },
  );
  within(screen.getByRole("region", { name: "Notes list" }))
    .getByRole("button", { name: /^First/ })
    .focus();
  availableWidth = 780;
  act(resize);
  expect(
    screen.queryByRole("region", { name: "Notes list" }),
  ).not.toBeInTheDocument();
  expect(screen.getByLabelText("Note title")).toBe(title);
  expect(title).toHaveFocus();
  expect(
    screen.getByRole("textbox", { name: "Tags, separated by commas" }),
  ).toHaveValue('"retained');
  availableWidth = 781;
  act(resize);
  expect(screen.getByRole("region", { name: "Notes list" })).toBeVisible();
  expect(screen.getByLabelText("Note title")).toBe(title);
});

it("retains the existing single-pane web behavior", async () => {
  bridge.current = null;
  fixture();
  fireEvent.click(await screen.findByRole("button", { name: /^First/ }));
  await screen.findByLabelText("Note title");
  expect(
    screen.queryByRole("region", { name: "Notes list" }),
  ).not.toBeInTheDocument();
});

it("keeps the visible failed-save draft when another list row is requested", async () => {
  const update = vi.fn(async () => {
    throw Error("Synthetic quota failure");
  });
  fixture(update);
  fireEvent.click(await screen.findByRole("button", { name: /^First/ }));
  fireEvent.change(await screen.findByLabelText("Note title"), {
    target: { value: "Uncommitted title" },
  });
  await screen.findByText("Synthetic quota failure");
  fireEvent.click(
    within(screen.getByRole("region", { name: "Notes list" })).getByRole(
      "button",
      { name: /^Second/ },
    ),
  );
  expect(screen.getByLabelText("Note title")).toHaveValue("Uncommitted title");
  expect(screen.getByText("Synthetic quota failure")).toBeVisible();
});

it("waits for a pending commit before admitting a list selection", async () => {
  let finish!: (value: Note) => void;
  const update = vi.fn(
    () =>
      new Promise<Note>((resolve) => {
        finish = resolve;
      }),
  );
  fixture(update);
  fireEvent.click(await screen.findByRole("button", { name: /^First/ }));
  fireEvent.change(await screen.findByLabelText("Note title"), {
    target: { value: "Committed title" },
  });
  await waitFor(() => expect(update).toHaveBeenCalledOnce());
  const second = within(
    screen.getByRole("region", { name: "Notes list" }),
  ).getByRole("button", { name: /^Second/ });
  fireEvent.click(second);
  expect(screen.getByLabelText("Note title")).toHaveValue("Committed title");
  expect(
    screen.getByText("Finish or discard your unsaved changes before leaving."),
  ).toBeVisible();
  await act(async () =>
    finish({
      id: "note-0",
      title: "Committed title",
      document: { type: "doc", content: [{ type: "paragraph" }] },
      tags: [],
      revision: 2,
      createdAt: "2026-11-15T00:00:00Z",
      updatedAt: "2026-11-15T00:01:00Z",
      trashedAt: null,
    }),
  );
  fireEvent.click(second);
  expect(await screen.findByLabelText("Note title")).toHaveValue("Second");
});

it("uses a single creation pane and restores the library when an untouched draft is left", async () => {
  const { unexpected } = fixture();
  await screen.findByRole("button", { name: /^First/ });
  fireEvent.keyDown(window, { key: "n", ctrlKey: true });
  expect(await screen.findByRole("region", { name: "New note" })).toBeVisible();
  expect(
    screen.queryByRole("region", { name: "Notes list" }),
  ).not.toBeInTheDocument();
  expect(screen.getByLabelText("Note title")).toHaveFocus();
  fireEvent.click(screen.getByRole("button", { name: "Back to notes" }));
  expect(
    await screen.findByRole("region", { name: "Notes list" }),
  ).toBeVisible();
  expect(unexpected).not.toHaveBeenCalled();
});

it("filters by the exact tag from the desktop picker and the note metadata", async () => {
  const { unexpected } = fixture(undefined, [
    ["work, play", "Ideas"],
    ["Ideas"],
  ]);
  fireEvent.click(await screen.findByRole("button", { name: /^First/ }));
  await screen.findByLabelText("Note title");
  const list = screen.getByRole("region", { name: "Notes list" });
  fireEvent.click(
    within(list).getByRole("button", { name: "Show notes tagged work, play" }),
  );
  expect(
    await within(list).findByRole("heading", { name: "# work, play" }),
  ).toHaveFocus();
  expect(
    within(list).queryByRole("button", { name: /^Second/ }),
  ).not.toBeInTheDocument();
  fireEvent.click(within(list).getByRole("button", { name: /^First/ }));
  const noteTags = await screen.findByRole("group", {
    name: "Current note tags",
  });
  expect(
    within(noteTags).getByRole("button", {
      name: "Show notes tagged work, play",
    }),
  ).toHaveAttribute("aria-current", "true");
  fireEvent.click(
    within(noteTags).getByRole("button", { name: "Show notes tagged Ideas" }),
  );
  expect(
    await within(list).findByRole("heading", { name: "# Ideas" }),
  ).toHaveFocus();
  expect(within(list).getByRole("button", { name: /^Second/ })).toBeVisible();
  expect(unexpected).not.toHaveBeenCalled();
});
