import { render, screen, act } from "@testing-library/react";
import { beforeEach, it, expect, vi } from "vitest";
import { Workspace } from "../../src/ui/Workspace";
import type { Note, NotesStore } from "../../src/domain/contracts";
beforeEach(() =>
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })),
);
it("does not paint provisional zero counts or empty tag navigation while initial notes are loading", async () => {
  let finish!: (notes: Note[]) => void;
  const store = {
    list: () => new Promise<Note[]>((resolve) => (finish = resolve)),
    subscribe: () => () => {},
  } as unknown as NotesStore;
  render(
    <Workspace
      store={store}
      session={{
        accountId: "synthetic",
        deviceId: "test",
        email: "fixture@example.invalid",
        deviceState: "trusted",
      }}
      onSignOut={async () => {}}
    />,
  );
  expect(
    screen.queryByRole("button", { name: /All notes/ }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("main", { name: "Loading notes" })).toHaveAttribute(
    "aria-busy",
    "true",
  );
  await act(async () =>
    finish([
      {
        id: "one",
        title: "Loaded note",
        document: { type: "doc", content: [] },
        tags: ["Work"],
        revision: 1,
        createdAt: "2026-01-01",
        updatedAt: "2026-01-01",
        trashedAt: null,
      },
    ]),
  );
  expect(screen.getByRole("button", { name: "All notes 1" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Work, 1 note" })).toBeVisible();
});
