import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { Workspace } from "../../src/ui/Workspace";
import type { NotesStore } from "../../src/domain/contracts";

beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
});

it.each([
  { name: "oversized file", files: [{ name: "large.md", size: 2_000_001 }], message: "Choose Markdown files up to 2 MB each." },
  { name: "oversized batch", files: Array.from({ length: 6 }, (_, i) => ({ name: `${i}.md`, size: 2_000_000 })), message: "Import batches up to 10 MB." },
  { name: "too many files", files: Array.from({ length: 101 }, (_, i) => ({ name: `${i}.md`, size: 1 })), message: "Import at most 100 files at once." },
])("rejects $name before reading content", async ({ files, message }) => {
  const read = vi.fn().mockResolvedValue("synthetic");
  const store = { list: vi.fn().mockResolvedValue([]), subscribe: () => () => {}, create: vi.fn() } as unknown as NotesStore;
  const { container } = render(<Workspace store={store} session={{ accountId: "test", deviceId: "test", email: "fixture@example.test", deviceState: "trusted" }} onSignOut={async () => {}} />);
  await screen.findByRole("button", { name: /All notes/ });
  fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: files.map(file => ({ ...file, text: read })) } });
  await waitFor(() => expect(screen.getByText(message)).toBeVisible());
  expect(read).not.toHaveBeenCalled();
  expect(store.create).not.toHaveBeenCalled();
});
