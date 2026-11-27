import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Workspace } from "../../src/ui/Workspace";
import type { Note, NotesStore } from "../../src/domain/contracts";

vi.mock("../../src/ui/CollectionsHost", () => ({
  CollectionsHost: ({ view }: { view: string }) => (
    <section aria-label={`${view} workspace`}>
      <h1>{view}</h1>
    </section>
  ),
}));
vi.mock("../../src/ui/RichEditor", () => ({
  RichEditor: () => <div aria-label="Note content">Writing surface</div>,
}));

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("matchMedia", () => ({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function setup(create?: NotesStore["create"]) {
  const notes: Note[] = [];
  const unexpected = vi.fn(async () => {
    throw Error("Unexpected write");
  });
  const store: NotesStore = {
    list: async () => notes,
    get: async (id) => notes.find((note) => note.id === id) ?? null,
    create: create ?? unexpected,
    update: unexpected,
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
        accountId: "navigation",
        deviceId: "device",
        email: "navigation@example.test",
        deviceState: "trusted",
      }}
      onSignOut={async () => {}}
    />,
  );
  await screen.findByRole("heading", { name: "All notes" });
  return { store, unexpected };
}

function start(method: "button" | "shortcut") {
  if (method === "shortcut")
    fireEvent.keyDown(window, { key: "n", ctrlKey: true });
  else
    fireEvent.click(
      screen.getAllByRole("button", { name: "New note", exact: true })[0]!,
    );
  expect(screen.getByRole("textbox", { name: "Note title" })).toBeVisible();
}

it.each(["button", "shortcut"] as const)(
  "leaves a blank new note opened by %s for Journal and Study",
  async (method) => {
    const { unexpected } = await setup();
    start(method);
    fireEvent.click(
      screen.getByRole("button", { name: "Journal", exact: true }),
    );
    expect(
      await screen.findByRole("region", { name: "journal workspace" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("textbox", { name: "Note title" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Study", exact: true }));
    expect(
      await screen.findByRole("region", { name: "study workspace" }),
    ).toBeVisible();
    expect(screen.queryByText("From a Study card.")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Back to card" }),
    ).not.toBeInTheDocument();
    expect(unexpected).not.toHaveBeenCalled();
  },
);

it.each(["Study", "Clips", "All notes"])(
  "leaves a blank new note for %s",
  async (destination) => {
    const { unexpected } = await setup();
    start("shortcut");
    fireEvent.click(
      screen.getByRole("button", {
        name: destination === "All notes" ? /^All notes/ : destination,
        exact: true,
      }),
    );
    expect(
      screen.queryByRole("textbox", { name: "Note title" }),
    ).not.toBeInTheDocument();
    if (destination === "All notes")
      expect(screen.getByRole("heading", { name: "All notes" })).toBeVisible();
    else
      expect(
        await screen.findByRole("region", {
          name: `${destination.toLowerCase()} workspace`,
        }),
      ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Back to card" }),
    ).not.toBeInTheDocument();
    expect(unexpected).not.toHaveBeenCalled();
  },
);

it("keeps an in-flight note visible when navigation is blocked, then allows navigation after saving", async () => {
  let complete!: (note: Note) => void;
  const create = vi.fn<NotesStore["create"]>(
    () =>
      new Promise<Note>((resolve) => {
        complete = resolve;
      }),
  );
  await setup(create);
  start("button");
  fireEvent.change(screen.getByRole("textbox", { name: "Note title" }), {
    target: { value: "Keep this draft" },
  });
  await waitFor(() => expect(create).toHaveBeenCalledOnce());
  fireEvent.click(screen.getByRole("button", { name: "Journal", exact: true }));
  expect(screen.getByRole("textbox", { name: "Note title" })).toHaveValue(
    "Keep this draft",
  );
  expect(
    screen.queryByRole("region", { name: "journal workspace" }),
  ).not.toBeInTheDocument();
  const [input, id] = create.mock.calls[0]!;
  expect(id).toBeDefined();
  complete({
    ...input,
    id: id!,
    revision: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    trashedAt: null,
  });
  await waitFor(() =>
    expect(
      screen
        .getAllByRole("status")
        .some((status) => /Saved/.test(status.textContent ?? "")),
    ).toBe(true),
  );
  fireEvent.click(screen.getByRole("button", { name: "Journal", exact: true }));
  expect(
    await screen.findByRole("region", { name: "journal workspace" }),
  ).toBeVisible();
});
