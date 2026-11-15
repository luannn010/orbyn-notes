import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AccountService, Note, NotesStore } from "../../src/domain/contracts";
import { AccountView, PendingDevice } from "../../src/ui/AccountView";
import { NoteEditor } from "../../src/ui/NoteEditor";
import { SettingsView } from "../../src/ui/SettingsView";

const runtime = vi.hoisted(() => ({ desktop: false }));
vi.mock("../../src/desktop/window", () => ({ isDesktop: () => runtime.desktop }));
vi.mock("../../src/desktop/DesktopShell", () => ({
  useDesktop: () => runtime.desktop ? { toolbar: null } : null,
}));
vi.mock("../../src/ui/RichEditor", () => ({ RichEditor: () => <div>Writing surface</div> }));

beforeEach(() => {
  runtime.desktop = false;
  localStorage.clear();
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it.each([false, true])("uses runtime storage guidance in Data and export without erasing (desktop=%s)", async (desktop) => {
  runtime.desktop = desktop;
  const erase = vi.fn();
  render(<SettingsView email="fixture@example.invalid"
    preferences={{ theme: "dark", motion: "reduced", setTheme: vi.fn(), setMotion: vi.fn() }}
    onDone={vi.fn()} onSignOut={vi.fn()} onExport={vi.fn()} onErase={erase} />);
  fireEvent.click(screen.getByRole("button", { name: "Data and export" }));
  expect(await screen.findByText(desktop
    ? "Local only. Clearing this app’s data removes your notes. Export a copy first."
    : "Local only. Clearing browser data removes your notes. Export a copy first.")).toBeVisible();
  expect(screen.getByRole("button", { name: desktop ? "Erase this app’s data" : "Erase this browser" })).toBeVisible();
  expect(erase).not.toHaveBeenCalled();
});

it.each([false, true])("describes the actual storage at account entry and approval (desktop=%s)", (desktop) => {
  runtime.desktop = desktop;
  const service = {} as AccountService; // Entry and approval render without account requests.
  const entry = render(<AccountView service={service} onSession={vi.fn()} />);
  expect(screen.getByText(desktop ? "Encrypted notes in this app on this device." : "Encrypted notes in this browser.")).toBeVisible();
  expect(screen.getByText(desktop
    ? "This beta does not sync. Clearing this app’s data removes your notes. Export a copy to keep them."
    : "This beta does not sync. Clearing browser data removes your notes. Export a copy to keep them.")).toBeVisible();
  entry.unmount();
  render(<PendingDevice service={service} onSession={vi.fn()} onSignOut={vi.fn()} />);
  expect(screen.getByRole("heading", { name: desktop
    ? "This app needs approval before Notes can open."
    : "This browser needs approval before Notes can open." })).toBeVisible();
});

it.each([false, true])("shows the runtime save location only after a successful commit (desktop=%s)", async (desktop) => {
  runtime.desktop = desktop;
  const note: Note = {
    id: "storage-copy", title: "Initial", document: { type: "doc", content: [{ type: "paragraph" }] },
    tags: [], revision: 1, createdAt: "2026-11-15", updatedAt: "2026-11-15", trashedAt: null,
  };
  let complete!: (note: Note) => void;
  const update = vi.fn(() => new Promise<Note>((resolve) => { complete = resolve; }));
  const store = { update } as unknown as NotesStore;
  render(<NoteEditor note={note} store={store} onSaved={vi.fn()} onBack={vi.fn()} onTrash={vi.fn()} onExport={vi.fn()} />);
  const saved = desktop ? "Saved on this device" : "Saved in this browser";
  expect(screen.getByText(saved)).toBeVisible();
  fireEvent.change(screen.getByLabelText("Note title"), { target: { value: "Changed" } });
  expect(screen.queryByText(saved)).not.toBeInTheDocument();
  await waitFor(() => expect(update).toHaveBeenCalledOnce());
  expect(screen.getByRole("status")).toHaveTextContent(/Unsaved changes|Saving…/);
  expect(screen.queryByText(saved)).not.toBeInTheDocument();
  await act(async () => complete({ ...note, title: "Changed", revision: 2 }));
  expect(await screen.findByText(saved)).toBeVisible();
});
