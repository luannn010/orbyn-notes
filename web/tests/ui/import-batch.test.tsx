import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import type { Note, NotesStore } from "../../src/domain/contracts";
import { Workspace } from "../../src/ui/Workspace";
import {
  prepareMarkdownImport,
  runMarkdownImport,
  markdownImportChunks,
  MarkdownImportFailure,
} from "../../src/ui/markdownImport";

const linkScope = vi.hoisted(() => ({
  invalidate: null as ((reason: "epoch" | "closed") => void) | null,
}));
vi.mock("../../src/ui/noteLinkOwner", () => ({
  useNoteLinkOwner: (
    _owner: unknown,
    invalidate: (reason: "epoch" | "closed") => void,
  ) => {
    linkScope.invalidate = invalidate;
    return { service: null, error: "", bootSettled: false, retry: vi.fn() };
  },
}));

beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});

const input = (title: string) => ({
  title,
  tags: [],
  document: {
    type: "doc" as const,
    content: [{ type: "paragraph", content: [{ type: "text", text: "body" }] }],
  },
});
const noteFor = (entry: {
  input: ReturnType<typeof input>;
  creationId: string;
}): Note => ({
  ...entry.input,
  id: entry.creationId,
  revision: 1,
  createdAt: "2026-11-26T00:00:00Z",
  updatedAt: "2026-11-26T00:00:00Z",
  trashedAt: null,
});

it("uses bounded bulk chunks with the original epoch and stable ordered IDs", async () => {
  const plan = prepareMarkdownImport(
    Array.from({ length: 23 }, (_, i) => input(`note-${i}`)),
    "original-epoch",
  );
  const createBatch = vi.fn(async (entries, _options) => entries.map(noteFor));
  const create = vi.fn();
  const progress = vi.fn();
  const result = await runMarkdownImport(
    { createBatch, create } as unknown as NotesStore,
    plan,
    new AbortController().signal,
    progress,
  );
  expect(create).not.toHaveBeenCalled();
  expect(createBatch.mock.calls.map(([entries]) => entries.length)).toEqual([
    10, 10, 3,
  ]);
  expect(
    createBatch.mock.calls.flatMap(([entries]) =>
      entries.map((entry: { creationId: string }) => entry.creationId),
    ),
  ).toEqual(plan.entries.map((entry) => entry.creationId));
  for (const call of createBatch.mock.calls)
    expect(call[1]).toMatchObject({ expectedEpoch: "original-epoch" });
  expect(progress.mock.calls.map(([saved]) => saved)).toEqual([10, 20, 23]);
  expect(result).toEqual({ saved: 23, stopped: false });
});

it("validates the entire plan before any writer can start and clones its inputs", () => {
  const first = input("first");
  expect(() =>
    prepareMarkdownImport([
      first,
      { ...input("bad"), tags: [5 as unknown as string] },
    ]),
  ).toThrow();
  const plan = prepareMarkdownImport([first]);
  first.title = "changed";
  first.document.content[0]!.content![0]!.text = "changed";
  expect(plan.entries[0]!.input).toEqual(input("first"));
});

it("retains the same IDs and epoch when retrying an uncertain result", async () => {
  const plan = prepareMarkdownImport(
    Array.from({ length: 12 }, (_, i) => input(`note-${i}`)),
    "old-epoch",
  );
  const createBatch = vi
    .fn(async (entries, _options) => entries.map(noteFor))
    .mockImplementationOnce(async (entries) => entries.map(noteFor))
    .mockRejectedValueOnce(new Error("observer failed after commit"));
  const store = { createBatch } as unknown as NotesStore;
  let failure!: MarkdownImportFailure;
  try {
    await runMarkdownImport(
      store,
      plan,
      new AbortController().signal,
      () => {},
    );
  } catch (error) {
    failure = error as MarkdownImportFailure;
  }
  expect(failure).toBeInstanceOf(MarkdownImportFailure);
  expect(failure.saved).toBe(10);
  expect(failure.message).toContain("may already be saved");
  const remaining = { ...plan, entries: plan.entries.slice(failure.saved) };
  await runMarkdownImport(
    store,
    remaining,
    new AbortController().signal,
    () => {},
  );
  expect(createBatch.mock.calls[2]![0]).toEqual(remaining.entries);
  expect(createBatch.mock.calls[2]![0]).toEqual(createBatch.mock.calls[1]![0]);
  expect(createBatch.mock.calls[2]![1]).toMatchObject({
    expectedEpoch: "old-epoch",
  });
});

it("stops future chunks after a late successful chunk and supports pre-start cancellation", async () => {
  const plan = prepareMarkdownImport(
    Array.from({ length: 12 }, (_, i) => input(`note-${i}`)),
    "epoch",
  );
  const controller = new AbortController();
  const createBatch = vi.fn(async (entries) => {
    controller.abort();
    return entries.map(noteFor);
  });
  expect(
    await runMarkdownImport(
      { createBatch } as unknown as NotesStore,
      plan,
      controller.signal,
      () => {},
    ),
  ).toEqual({ saved: 10, stopped: true });
  expect(createBatch).toHaveBeenCalledTimes(1);
  expect(
    await runMarkdownImport(
      { createBatch } as unknown as NotesStore,
      plan,
      controller.signal,
      () => {},
    ),
  ).toEqual({ saved: 0, stopped: true });
  expect(createBatch).toHaveBeenCalledTimes(1);
});

it("splits dense documents below the existing combined scanner node budget", () => {
  const dense = {
    ...input("dense"),
    document: {
      type: "doc" as const,
      content: Array.from({ length: 40_000 }, () => ({ type: "paragraph" })),
    },
  };
  const plan = prepareMarkdownImport([dense, dense, dense, dense]);
  expect(
    markdownImportChunks(plan.entries).map((chunk) => chunk.length),
  ).toEqual([1, 1, 1, 1]);
});

it("refuses a bulk writer without a captured ready epoch", async () => {
  const createBatch = vi.fn();
  await expect(
    runMarkdownImport(
      { createBatch } as unknown as NotesStore,
      prepareMarkdownImport([input("note")]),
      new AbortController().signal,
      () => {},
    ),
  ).rejects.toBeInstanceOf(MarkdownImportFailure);
  expect(createBatch).not.toHaveBeenCalled();
});

it("keeps Cancel reachable while a sequential import is pending and counts its late success", async () => {
  let finish!: (note: Note) => void;
  const notes: Note[] = [];
  const create = vi.fn(
    (_input: Parameters<NotesStore["create"]>[0], _id?: string) =>
      new Promise<Note>((resolve) => {
        finish = resolve;
      }),
  );
  const store = {
    list: vi.fn(async () => [...notes]),
    subscribe: () => () => {},
    create,
  } as unknown as NotesStore;
  const { container } = render(
    <Workspace
      store={store}
      session={{
        accountId: "test",
        deviceId: "test",
        email: "fixture@example.test",
        deviceState: "trusted",
      }}
      onSignOut={async () => {}}
    />,
  );
  await screen.findByRole("button", { name: /All notes/ });
  fireEvent.change(container.querySelector('input[type="file"]')!, {
    target: {
      files: ["first", "second"].map((name) => ({
        name: `${name}.md`,
        size: 10,
        text: async () => `# ${name}\nbody`,
      })),
    },
  });
  const dialog = await screen.findByRole("dialog", { name: "Import Markdown" });
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Import remaining" }),
  );
  await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
  const cancel = within(dialog).getByRole("button", { name: "Cancel" });
  expect(cancel).toBeEnabled();
  fireEvent.click(cancel);
  expect(screen.getByRole("dialog", { name: "Import Markdown" })).toBeVisible();
  const input = create.mock.calls[0]![0] as unknown as Pick<
    Note,
    "title" | "document" | "tags"
  >;
  const note: Note = {
    ...input,
    id: "first",
    revision: 1,
    createdAt: "2026-11-26T00:00:00Z",
    updatedAt: "2026-11-26T00:00:00Z",
    trashedAt: null,
  };
  await act(async () => {
    notes.push(note);
    finish(note);
  });
  await waitFor(() =>
    expect(
      screen.queryByRole("dialog", { name: "Import Markdown" }),
    ).not.toBeInTheDocument(),
  );
  expect(create).toHaveBeenCalledTimes(1);
  expect(
    screen.getByText("Import stopped. Imported 1 of 2 notes."),
  ).toBeVisible();
});

it("resets Cancel after a stopping import loses its scope", async () => {
  let finish!: (note: Note) => void;
  const create = vi.fn(
    () =>
      new Promise<Note>((resolve) => {
        finish = resolve;
      }),
  );
  const store = {
    list: vi.fn(async () => []),
    subscribe: () => () => {},
    create,
  } as unknown as NotesStore;
  const { container } = render(
    <Workspace
      store={store}
      session={{
        accountId: "test",
        deviceId: "test",
        email: "fixture@example.test",
        deviceState: "trusted",
      }}
      onSignOut={async () => {}}
    />,
  );
  await screen.findByRole("button", { name: /All notes/ });
  const picker = container.querySelector('input[type="file"]')!;
  const selectFile = (name: string) =>
    fireEvent.change(picker, {
      target: {
        files: [{
          name: `${name}.md`,
          size: 10,
          text: async () => `# ${name}\nbody`,
        }],
      },
    });
  selectFile("first");
  const dialog = await screen.findByRole("dialog", { name: "Import Markdown" });
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Import remaining" }),
  );
  await waitFor(() => expect(create).toHaveBeenCalledOnce());
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  expect(
    within(dialog).getByRole("button", { name: "Stopping…" }),
  ).toBeDisabled();

  act(() => linkScope.invalidate!("epoch"));
  await act(async () => {
    finish(noteFor({ input: input("first"), creationId: "late-result" }));
  });
  expect(
    screen.queryByRole("dialog", { name: "Import Markdown" }),
  ).not.toBeInTheDocument();
  selectFile("second");
  const next = await screen.findByRole("dialog", { name: "Import Markdown" });
  expect(within(next).getByRole("button", { name: "Cancel" })).toBeEnabled();
  expect(create).toHaveBeenCalledOnce();
});
