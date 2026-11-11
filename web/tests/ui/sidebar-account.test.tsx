import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Workspace } from "../../src/ui/Workspace";
import { checkClose, registerCloseGuard } from "../../src/desktop/closeGuard";
import type { Note, NotesStore } from "../../src/domain/contracts";

vi.mock("../../src/ui/RichEditor", () => ({
  RichEditor: () => <div>Mock rich editor boundary</div>,
}));
vi.mock("../../src/ui/CollectionsHost", () => ({
  CollectionsHost: ({ view }: { view: string }) => (
    <section aria-label={`${view} mock module`}>Mock module</section>
  ),
}));
beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const original: Note = {
  id: "old",
  title: "Existing note",
  document: { type: "doc", content: [{ type: "paragraph" }] },
  tags: [],
  revision: 1,
  createdAt: "2026-11-01T00:00:00Z",
  updatedAt: "2026-11-01T00:00:00Z",
  trashedAt: null,
};
const created: Note = { ...original, id: "created", title: "" };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function fixture(
  create: NotesStore["create"] = async () => created,
  email = "alexandra.long.email@example.test",
) {
  const api: NotesStore = {
    list: async () => [original],
    get: async (id) => (id === created.id ? created : original),
    create,
    update: vi.fn(),
    trash: vi.fn(),
    restore: vi.fn(),
    erase: vi.fn(),
    subscribe: () => () => {},
    persistence: () => ({ status: "ready" }),
    close: vi.fn(),
  };
  const props = {
    store: api,
    session: {
      accountId: "synthetic",
      deviceId: "synthetic",
      email,
      deviceState: "trusted" as const,
    },
    onSignOut: async () => {},
  };
  return { view: render(<Workspace {...props} />), api, props };
}
async function headerAction() {
  await screen.findByRole("button", { name: /Existing note/ });
  return within(
    screen.getByRole("complementary", { name: "Notes navigation" }),
  ).getByRole("button", { name: "New note" });
}
it("shows the real account email and decorative initial without inventing a profile menu", async () => {
  fixture();
  await headerAction();
  const sidebar = screen.getByRole("complementary", {
    name: "Notes navigation",
  });
  expect(
    within(sidebar).getByTitle("alexandra.long.email@example.test"),
  ).toHaveTextContent("alexandra.long.email@example.test");
  expect(within(sidebar).getByText("A", { exact: true })).toHaveAttribute(
    "aria-hidden",
    "true",
  );
  expect(
    within(sidebar).queryByRole("button", { name: /profile|account menu/i }),
  ).not.toBeInTheDocument();
  expect(within(sidebar).getByText(/Beta.*Local only/)).toBeVisible();
});
it("keeps a combining grapheme intact in the decorative initial", async () => {
  fixture(undefined, "e\u0301lie@example.test");
  await headerAction();
  expect(
    within(screen.getByRole("complementary")).getByText("E\u0301", {
      exact: true,
    }),
  ).toHaveAttribute("aria-hidden", "true");
});
it("opens a real new note from Study only after successful creation", async () => {
  const operation = deferred<Note>(),
    create = vi.fn(() => operation.promise);
  fixture(create);
  const action = await headerAction();
  fireEvent.click(screen.getByRole("button", { name: "Study" }));
  await screen.findByLabelText("study mock module");
  fireEvent.click(action);
  fireEvent.click(action);
  expect(create).toHaveBeenCalledTimes(1);
  expect(create).toHaveBeenCalledWith({
    title: "",
    document: { type: "doc", content: [{ type: "paragraph" }] },
    tags: [],
  });
  expect(checkClose()).toBe("working");
  await act(async () => operation.resolve(created));
  expect(await screen.findByLabelText("Note title")).toHaveValue("");
  expect(screen.queryByText("From a Study card.")).not.toBeInTheDocument();
  expect(checkClose()).toBe("allowed");
});
it("does not invoke creation or leave the current route while a draft guard refuses navigation", async () => {
  const create = vi.fn(async () => created);
  fixture(create);
  const action = await headerAction();
  const remove = registerCloseGuard(() => false);
  try {
    fireEvent.click(action);
    expect(create).not.toHaveBeenCalled();
    expect(
      screen.getByText(
        "Finish or discard your unsaved changes before leaving.",
      ),
    ).toBeVisible();
  } finally {
    remove();
  }
});
it("retains the current module on failure without automatic retry", async () => {
  const create = vi.fn(async () => {
    throw new Error("Storage quota denied");
  });
  fixture(create);
  const action = await headerAction();
  fireEvent.click(screen.getByRole("button", { name: "Clips" }));
  await screen.findByLabelText("clips mock module");
  fireEvent.click(action);
  await screen.findByText("Couldn’t create note. Storage quota denied");
  expect(screen.getByLabelText("clips mock module")).toBeVisible();
  expect(create).toHaveBeenCalledTimes(1);
  expect(checkClose()).toBe("allowed");
});
it("does not discard a new draft guard that appears while the write is pending", async () => {
  const operation = deferred<Note>();
  fixture(() => operation.promise);
  const action = await headerAction();
  fireEvent.click(screen.getByRole("button", { name: "Study" }));
  await screen.findByLabelText("study mock module");
  fireEvent.click(action);
  const remove = registerCloseGuard(() => false);
  try {
    await act(async () => operation.resolve(created));
    expect(screen.getByLabelText("study mock module")).toBeVisible();
    expect(screen.queryByLabelText("Note title")).not.toBeInTheDocument();
  } finally {
    remove();
  }
});
it("does not focus a replacement account input after a held create resolves past unmount", async () => {
  const operation = deferred<Note>();
  const { view } = fixture(() => operation.promise);
  const action = await headerAction();
  vi.useFakeTimers();
  fireEvent.click(action);
  view.unmount();
  render(<input id="note-title" aria-label="Replacement account input" />);
  await act(async () => {
    operation.resolve(created);
    await operation.promise;
  });
  act(() => vi.runOnlyPendingTimers());
  expect(screen.getByLabelText("Replacement account input")).not.toHaveFocus();
  expect(checkClose()).toBe("allowed");
});
it("retires an old account/store completion before a replacement workspace can use its result", async () => {
  const operation = deferred<Note>();
  const { view, api, props } = fixture(() => operation.promise);
  fireEvent.click(await headerAction());
  const nextCreate = vi.fn(async () => ({
    ...created,
    id: "second-account-note",
  }));
  view.rerender(
    <Workspace
      {...props}
      store={{ ...api, create: nextCreate }}
      session={{
        ...props.session,
        accountId: "second-account",
        email: "second@example.test",
      }}
    />,
  );
  await act(async () =>
    operation.resolve({ ...created, title: "First account private result" }),
  );
  expect(screen.queryByLabelText("Note title")).not.toBeInTheDocument();
  expect(
    screen.queryByText("First account private result"),
  ).not.toBeInTheDocument();
  const action = within(screen.getByRole("complementary")).getByRole("button", {
    name: "New note",
  });
  expect(screen.getByTitle("second@example.test")).toBeVisible();
  fireEvent.click(action);
  expect(await screen.findByLabelText("Note title")).toHaveValue("");
  expect(nextCreate).toHaveBeenCalledOnce();
});
