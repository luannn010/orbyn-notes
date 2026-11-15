import { StrictMode } from "react";
import userEvent from "@testing-library/user-event";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  JournalVault,
  JournalVaultStatus,
} from "../../src/collections/journalVault";
import type { JournalData } from "../../src/collections/journal";
import {
  emptyJournal,
  journalToday,
  saveHabit,
  setHabitCompletion,
  validateJournalData,
} from "../../src/collections/journal";
import type { NoteDocument } from "../../src/domain/contracts";
import { plainText } from "../../src/ui/model";
vi.mock("../../src/desktop/window", () => ({ isDesktop: () => true }));
const native = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock("../../src/desktop/files", () => ({ saveDesktopFile: native.save }));
import { JournalView } from "../../src/ui/JournalView";
import { checkClose } from "../../src/desktop/closeGuard";
import type { HabitFormDraft } from "../../src/collections/journalViewDraft";
import {
  validateHabitFormDraft,
  validateHabitFormInput,
} from "../../src/collections/journalViewDraft";

vi.mock("../../src/ui/RichEditor", () => ({
  RichEditor: ({
    document,
    onChange,
    readOnly,
    ariaLabel,
  }: {
    document: NoteDocument;
    onChange: (document: NoteDocument) => void;
    readOnly: boolean;
    ariaLabel: string;
  }) => (
    <textarea
      aria-label={ariaLabel}
      readOnly={readOnly}
      value={plainText(document).trim()}
      onChange={(event) =>
        onChange({
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: event.target.value }],
            },
          ],
        })
      }
    />
  ),
}));
const passphrase = "Synthetic Journal phrase only";
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

// UI boundary double only; the real encrypted vault has separate domain/browser qualification.
function testVault(initial: "new" | "locked" | "unlocked" = "unlocked") {
  let data = emptyJournal();
  let saved = structuredClone(data);
  let generation = 0;
  let failure = false;
  let gate: Promise<void> | null = null;
  let habitDraft: HabitFormDraft | null = null;
  let meta: JournalVaultStatus = {
    phase: initial === "unlocked" ? "unlocked" : "locked",
    hasJournal: initial !== "new",
    dirty: false,
    habitDraftDirty: false,
    linkDraftDirty: false,
    saving: false,
    pendingRecovery: false,
    conflict: false,
    error: null,
  };
  const listeners = new Set<() => void>();
  function publish(patch: Partial<JournalVaultStatus>) {
    meta = { ...meta, ...patch, habitDraftDirty: !!habitDraft?.dirty };
    listeners.forEach((listener) => listener());
  }
  const vault: JournalVault = {
    status: () => ({ ...meta }),
    readLinkDraft: vi.fn(() => null),
    setLinkDraft: vi.fn(() => {
      throw new Error("Link drafts use the real-vault integration tests");
    }),
    discardLinkDraft: vi.fn(),
    beginLinkApply: vi.fn(() => {
      throw new Error("Link drafts use the real-vault integration tests");
    }),
    completeLinkDraft: vi.fn(),
    read: vi.fn(() => {
      if (meta.phase !== "unlocked") throw new Error("Journal is locked");
      return structuredClone(data);
    }),
    readHabitDraft: vi.fn(() => {
      if (meta.phase !== "unlocked") throw new Error("Journal is locked");
      return structuredClone(habitDraft);
    }),
    setHabitDraft: vi.fn((input) => {
      if (meta.phase !== "unlocked" || meta.conflict)
        throw new Error("Unavailable");
      const checked = validateHabitFormInput(input);
      const same =
        habitDraft?.mode === checked.mode && habitDraft.id === checked.id;
      const originalName = same
        ? habitDraft!.originalName
        : checked.id
          ? data.habits.find((habit) => habit.id === checked.id)!.name
          : "";
      habitDraft = validateHabitFormDraft({
        ...checked,
        version: 1,
        originalName,
        dirty: checked.name !== originalName,
      });
      publish({});
    }),
    saveHabitDraft: vi.fn(async () => {
      if (!habitDraft || meta.phase !== "unlocked")
        throw new Error("Unavailable");
      const input = structuredClone(habitDraft);
      const existing = input.id
        ? data.habits.find((habit) => habit.id === input.id)
        : undefined;
      if (!existing || existing.name !== input.name.trim()) {
        const next = saveHabit(
          data,
          input.name,
          new Date(),
          input.id ?? undefined,
        );
        const id =
          input.id ??
          next.habits.find(
            (habit) => !data.habits.some((before) => before.id === habit.id),
          )!.id;
        habitDraft = {
          version: 1,
          mode: "edit",
          id,
          name: input.name,
          originalName: input.name,
          dirty: false,
        };
        await vault.update(() => next);
      } else if (meta.dirty) await vault.retry();
      habitDraft = null;
      publish({});
    }),
    discardHabitDraft: vi.fn(() => {
      habitDraft = null;
      publish({ pendingRecovery: false });
    }),
    create: vi.fn(async () => {
      publish({ phase: "unlocking", saving: true });
      await Promise.resolve();
      publish({ phase: "unlocked", hasJournal: true, saving: false });
    }),
    unlock: vi.fn(async (value) => {
      publish({ phase: "unlocking", error: null });
      await Promise.resolve();
      if (value !== passphrase) {
        publish({
          phase: "locked",
          error:
            "journal_unlock_failed: Couldn’t unlock Journal. Check your passphrase and try again.",
        });
        throw new Error("Wrong synthetic passphrase");
      }
      publish({ phase: "unlocked", pendingRecovery: false, error: null });
    }),
    update: vi.fn(async (change) => {
      if (meta.phase !== "unlocked" || meta.conflict)
        throw new Error("Journal is locked or conflicted");
      data = validateJournalData(change(structuredClone(data)));
      const token = generation;
      publish({ dirty: true, saving: true, error: null });
      if (gate) await gate;
      if (token !== generation) throw new Error("Stale update");
      if (failure) {
        failure = false;
        publish({
          saving: false,
          error:
            "journal_save_failed: Your Journal draft is still in this window. Try again.",
        });
        throw new Error("Synthetic disk full");
      }
      saved = structuredClone(data);
      publish({ dirty: false, saving: false, error: null });
    }),
    retry: vi.fn(async () => {
      if (meta.phase !== "unlocked" || meta.conflict)
        throw new Error("Unavailable");
      saved = structuredClone(data);
      publish({
        dirty: false,
        saving: false,
        error: null,
        pendingRecovery: false,
      });
    }),
    lock: vi.fn(async () => {
      generation++;
      publish({
        phase: "locked",
        saving: false,
        pendingRecovery: meta.dirty || !!habitDraft?.dirty,
        error: null,
      });
    }),
    discardAndReload: vi.fn(async () => {
      generation++;
      data = structuredClone(saved);
      habitDraft = null;
      publish({
        phase: "locked",
        dirty: false,
        saving: false,
        pendingRecovery: false,
        conflict: false,
        error: null,
      });
    }),
    setAway: vi.fn(),
    canClose: () =>
      !meta.dirty &&
      !meta.habitDraftDirty &&
      !meta.saving &&
      !meta.pendingRecovery &&
      meta.phase !== "unlocking" &&
      meta.phase !== "sealing",
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    close: vi.fn(() => {
      generation++;
      habitDraft = null;
      publish({ phase: "closed", dirty: false, saving: false });
      listeners.clear();
    }),
  };
  return {
    vault,
    failNext: () => {
      failure = true;
    },
    holdWrites: (promise: Promise<void>) => {
      gate = promise;
    },
    data: () => structuredClone(data),
    conflict: () =>
      publish({
        conflict: true,
        dirty: true,
        error:
          "journal_conflict: Journal changed in another window. Your draft is still here.",
      }),
  };
}
function closeState() {
  let state: ReturnType<typeof checkClose> = "allowed";
  act(() => {
    state = checkClose();
  });
  return state;
}
async function journalMenu(item: string) {
  fireEvent.click(screen.getByRole("button", { name: "Journal menu" }));
  fireEvent.click(screen.getByRole("menuitem", { name: item }));
}


async function openExport() {
  const f = testVault();
  render(<JournalView vault={f.vault} />);
  fireEvent.change(screen.getByRole("textbox", { name: "Journal entry" }), { target: { value: "Synthetic entry" } });
  await waitFor(() => expect(f.vault.status().dirty).toBe(false));
  await journalMenu("Export Journal");
  const dialog = screen.getByRole("dialog", { name: "Export Journal" });
  fireEvent.click(within(dialog).getByRole("button", { name: "Export Journal" }));
  await waitFor(() => expect(native.save).toHaveBeenCalledOnce());
  return { f, dialog };
}
beforeEach(() => { native.save.mockReset(); });
it("keeps the Journal export open when save is cancelled", async () => {
  native.save.mockResolvedValue(false);
  const { dialog } = await openExport();
  await waitFor(() => expect(within(dialog).getByRole("button", { name: "Export Journal" })).toBeEnabled());
  expect(within(dialog).queryByText("Saved")).not.toBeInTheDocument();
});
it("blocks the Journal write after vault lock", async () => {
  let release!: () => void;
  const write = vi.fn();
  native.save.mockImplementation(async (_name, _blob, beforeWrite) => {
    await new Promise<void>((resolve) => { release = resolve; });
    await beforeWrite();
    write();
    return true;
  });
  const { f } = await openExport();
  await act(async () => { await f.vault.lock(); });
  await act(async () => { release(); });
  expect(write).not.toHaveBeenCalled();
});
