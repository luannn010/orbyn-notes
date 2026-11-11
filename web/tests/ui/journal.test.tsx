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

describe("protected Journal UI", () => {
  function useNovemberClock() {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-20T12:00:00Z"));
  }
  function offsetDay(day: string, offset: number) {
    const date = new Date(`${day}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() + offset);
    return date.toISOString().slice(0, 10);
  }
  function history(
    count: number,
    first: string,
    done: (habit: number) => string[],
  ) {
    let data = emptyJournal();
    for (let i = 0; i < count; i++) {
      data = saveHabit(
        data,
        count === 1 ? "Reading" : `Habit ${i + 1}`,
        new Date(`${first}T12:00:00Z`),
      );
      const habit = data.habits.at(-1)!;
      habit.createdOn = first;
      for (const day of done(i))
        data = setHabitCompletion(data, day, habit.id, true, new Date());
    }
    return data;
  }
  it("keeps selected-day streaks, keyboard toggles and failed-save drafts truthful", async () => {
    useNovemberClock();
    const today = journalToday(),
      yesterday = offsetDay(today, -1);
    const fixture = testVault();
    await fixture.vault.update(() =>
      history(1, offsetDay(today, -5), () =>
        Array.from({ length: 5 }, (_, i) => offsetDay(today, i - 5)),
      ),
    );
    render(<JournalView vault={fixture.vault} />);
    const user = userEvent.setup(),
      button = screen.getByRole("button", { name: "Reading" });
    const through = new Date(`${yesterday}T12:00:00`).toLocaleDateString(
      undefined,
      { weekday: "long", day: "numeric", month: "long", year: "numeric" },
    );
    expect(button).toHaveAccessibleDescription(
      `5 consecutive days through ${through}.`,
    );
    expect(button).toHaveAttribute("aria-pressed", "false");
    await user.click(button);
    expect(button).toHaveAttribute("aria-pressed", "true");
    expect(button).toHaveAccessibleDescription(/6 consecutive days/);
    await user.keyboard(" ");
    expect(button).toHaveAttribute("aria-pressed", "false");
    expect(button).toHaveAccessibleDescription(
      `5 consecutive days through ${through}.`,
    );
    await user.keyboard("{Enter}");
    expect(button).toHaveAccessibleDescription(/6 consecutive days/);
    fixture.failNext();
    await user.click(button);
    expect(fixture.vault.status().dirty).toBe(true);
    expect(button).toHaveAttribute("aria-pressed", "false");
    expect(button).toHaveAccessibleDescription(/5 consecutive days/);
    expect(
      screen.getByText(/Your Journal draft is still in this window/),
    ).toBeVisible();
    await user.click(
      screen.getByRole("button", { name: "Try again" }),
    );
    expect(fixture.vault.retry).toHaveBeenCalledTimes(1);
    expect(fixture.vault.status().dirty).toBe(false);
    expect(button).toHaveAccessibleDescription(/5 consecutive days/);
    expect(fixture.vault.update).toHaveBeenCalledTimes(5);
  });
  it("shades actual calendar counts and retains the numeric overflow legend", async () => {
    useNovemberClock();
    const month = journalToday().slice(0, 7),
      fixture = testVault();
    await fixture.vault.update(() =>
      history(5, `${month}-01`, (i) =>
        Array.from(
          { length: 5 - i },
          (_, offset) => `${month}-${String(i + offset + 1).padStart(2, "0")}`,
        ),
      ),
    );
    const { container } = render(<JournalView vault={fixture.vault} />);
    const calendar = container.querySelector(".journal-calendar-days")!;
    for (const [day, level, count] of [
      [1, 1, 1],
      [2, 1, 2],
      [3, 2, 3],
      [4, 3, 4],
      [5, 3, 5],
      [6, 0, 0],
    ]) {
      const button = Array.from(calendar.querySelectorAll("button")).find(
        (item) => item.textContent?.trim() === String(day),
      )!;
      expect(button).toHaveAttribute("data-level", String(level));
      expect(button).toHaveAccessibleName(new RegExp(`${count} of 5 habits`));
    }
    const legend = screen.getByRole("group", { name: "Habits done legend" });
    expect(within(legend).getByText("4+")).toBeInTheDocument();
    expect(legend).toHaveTextContent("4 or more");
    expect(legend).not.toHaveTextContent(/some|most|all/);
  });
  it("does not infer overflow or darkest color from a large eligible denominator", async () => {
    useNovemberClock();
    const today = journalToday(),
      fixture = testVault();
    await fixture.vault.update(() =>
      history(100, `${today.slice(0, 7)}-01`, (i) => (i < 3 ? [today] : [])),
    );
    const { container } = render(<JournalView vault={fixture.vault} />);
    const selected = container.querySelector(
      '.journal-calendar-days button[aria-current="date"]',
    )!;
    expect(selected).toHaveAttribute("data-level", "2");
    expect(selected).toHaveAccessibleName(/3 of 100 habits/);
    const legend = screen.getByRole("group", { name: "Habits done legend" });
    expect(legend).toHaveTextContent("0, 1 to 2, 3, 4");
    expect(within(legend).queryByText("4+")).not.toBeInTheDocument();
  });
  it("removes the current and outgoing streak presentation in the same close turn", async () => {
    useNovemberClock();
    const today = journalToday(),
      fixture = testVault();
    await fixture.vault.update(() =>
      history(1, offsetDay(today, -1), () => [offsetDay(today, -1)]),
    );
    const { container } = render(
      <StrictMode>
        <JournalView vault={fixture.vault} />
      </StrictMode>,
    );
    const button = screen.getByRole("button", { name: "Reading" });
    const description = button.getAttribute("aria-describedby")!;
    fireEvent.click(button);
    expect(container.querySelectorAll(".journal-habit-count")).toHaveLength(2);
    let concealed = false;
    act(() => {
      fixture.vault.close();
      concealed =
        !container.querySelector(".journal-habit-count") &&
        !document.getElementById(description);
    });
    expect(concealed).toBe(true);
    expect(
      screen.queryByRole("button", { name: "Reading" }),
    ).not.toBeInTheDocument();
    expect(fixture.vault.update).toHaveBeenCalledTimes(2);
  });
  it("exports a never-checked habit even when there are no dated entries", async () => {
    const OriginalURL = URL;
    const create = vi.fn(() => "blob:habit-only");
    vi.stubGlobal(
      "URL",
      class extends OriginalURL {
        static createObjectURL = create;
        static revokeObjectURL = vi.fn();
      },
    );
    const fixture = testVault();
    render(<JournalView vault={fixture.vault} />);
    fireEvent.click(screen.getByRole("button", { name: "Add a habit" }));
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Never checked" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save habit" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(fixture.data().entries).toHaveLength(0);
    expect(fixture.data().completions).toHaveLength(0);
    await journalMenu("Export Journal");
    const dialog = screen.getByRole("dialog", { name: "Export Journal" });
    expect(
      within(dialog).getByText(
        "Includes a complete JSON backup and readable Markdown. Journal import and automatic restore are not available yet.",
      ),
    ).toBeVisible();
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Export Journal" }),
    );
    expect(create).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole("link", { name: "Download Journal" }),
    ).toHaveAttribute("href", "blob:habit-only");
  });
  it.each(["new", "edit"] as const)(
    "restores an unsubmitted %s habit form only after correct unlock",
    async (kind) => {
      const fixture = testVault();
      render(<JournalView vault={fixture.vault} />);
      if (kind === "edit") {
        fireEvent.click(screen.getByRole("button", { name: "Add a habit" }));
        fireEvent.change(screen.getByLabelText("Name"), {
          target: { value: "Original habit" },
        });
        fireEvent.click(screen.getByRole("button", { name: "Save habit" }));
        await waitFor(() =>
          expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
        );
        await journalMenu("Journal settings");
        fireEvent.click(screen.getByRole("button", { name: "Edit" }));
      } else
        fireEvent.click(screen.getByRole("button", { name: "Add a habit" }));
      fireEvent.change(screen.getByLabelText("Name"), {
        target: { value: "Protected unsubmitted habit name" },
      });
      expect(closeState()).toBe("draft");
      act(() => {
        void fixture.vault.lock();
      });
      expect(
        screen.queryByDisplayValue("Protected unsubmitted habit name"),
      ).not.toBeInTheDocument();
      fireEvent.change(screen.getByLabelText("Passphrase"), {
        target: { value: "Wrong synthetic phrase" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Unlock Journal" }));
      await screen.findByText(
        "Couldn’t unlock Journal. Check your passphrase and try again.",
      );
      expect(
        screen.queryByDisplayValue("Protected unsubmitted habit name"),
      ).not.toBeInTheDocument();
      fireEvent.change(screen.getByLabelText("Passphrase"), {
        target: { value: passphrase },
      });
      fireEvent.click(screen.getByRole("button", { name: "Unlock Journal" }));
      await screen.findByDisplayValue("Protected unsubmitted habit name");
      expect(closeState()).toBe("draft");
      expect(fixture.data().habits).toHaveLength(kind === "new" ? 0 : 1);
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
      fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
      expect(closeState()).toBe("allowed");
      if (kind === "edit")
        expect(fixture.data().habits[0]!.name).toBe("Original habit");
    },
  );
  it("restores the selected historical date and month after a failed-save lock", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 10, 11, 12));
    const fixture = testVault();
    render(<JournalView vault={fixture.vault} />);
    fireEvent.click(screen.getByRole("button", { name: "Past entries" }));
    fireEvent.click(screen.getByRole("button", { name: "Previous month" }));
    fireEvent.click(
      document.querySelector<HTMLButtonElement>(
        ".journal-calendar-days button:not(:disabled)",
      )!,
    );
    fixture.failNext();
    fireEvent.change(screen.getByRole("textbox", { name: "Journal entry" }), {
      target: { value: "Historical private draft" },
    });
    await screen.findByText(
      "Your Journal draft is still in this window. Try again.",
    );
    expect(fixture.data().entries[0]!.date).toBe("2026-10-01");
    act(() => {
      void fixture.vault.lock();
    });
    expect(screen.queryByText("October 2026")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Passphrase"), {
      target: { value: passphrase },
    });
    fireEvent.click(screen.getByRole("button", { name: "Unlock Journal" }));
    await screen.findByDisplayValue("Historical private draft");
    expect(screen.getByRole("heading", { name: "October 2026" })).toBeVisible();
    fireEvent.change(screen.getByRole("textbox", { name: "Journal entry" }), {
      target: { value: "Updated historical draft" },
    });
    expect(fixture.data().entries).toHaveLength(1);
    expect(fixture.data().entries[0]!.date).toBe("2026-10-01");
  });
  it("enrolls with manual confirmation and never reads plaintext before unlock", async () => {
    const { vault } = testVault("new");
    render(
      <StrictMode>
        <JournalView vault={vault} />
      </StrictMode>,
    );
    expect(vault.read).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Passphrase", { exact: true }), {
      target: { value: passphrase },
    });
    fireEvent.change(screen.getByLabelText("Confirm passphrase"), {
      target: { value: "Different synthetic phrase" },
    });
    expect(closeState()).toBe("draft");
    fireEvent.click(screen.getByRole("button", { name: "Lock Journal" }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "The passphrases don’t match",
    );
    expect(vault.create).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Passphrase", { exact: true })).toHaveValue(
      "",
    );
    fireEvent.change(screen.getByLabelText("Passphrase", { exact: true }), {
      target: { value: passphrase },
    });
    fireEvent.change(screen.getByLabelText("Confirm passphrase"), {
      target: { value: passphrase },
    });
    fireEvent.click(screen.getByRole("button", { name: "Lock Journal" }));
    await screen.findByRole("textbox", { name: "Journal entry" });
    expect(vault.create).toHaveBeenCalledWith(passphrase);
    expect(screen.queryByDisplayValue(passphrase)).not.toBeInTheDocument();
  });

  it("clears a wrong passphrase and leaves the Journal hidden", async () => {
    const { vault } = testVault("locked");
    render(<JournalView vault={vault} />);
    fireEvent.change(screen.getByLabelText("Passphrase"), {
      target: { value: "Wrong synthetic phrase" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Unlock Journal" }));
    await screen.findByText(
      "Couldn’t unlock Journal. Check your passphrase and try again.",
    );
    expect(screen.getByLabelText("Passphrase")).toHaveValue("");
    expect(vault.read).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("textbox", { name: "Journal entry" }),
    ).not.toBeInTheDocument();
  });

  it("hands edits to the vault synchronously, hides them on lock, and saves recovered drafts", async () => {
    const fixture = testVault();
    let release!: () => void;
    fixture.holdWrites(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    render(<JournalView vault={fixture.vault} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Journal entry" }), {
      target: { value: "Private synthetic entry" },
    });
    expect(plainText(fixture.vault.read().entries[0]!.document)).toContain(
      "Private synthetic entry",
    );
    expect(closeState()).toBe("draft");
    act(() => {
      void fixture.vault.lock();
      expect(
        screen.queryByRole("textbox", { name: "Journal entry" }),
      ).not.toBeInTheDocument();
    });
    expect(() => fixture.vault.read()).toThrow();
    expect(
      screen.queryByText("Private synthetic entry"),
    ).not.toBeInTheDocument();
    await act(async () => release());
    fireEvent.change(screen.getByLabelText("Passphrase"), {
      target: { value: passphrase },
    });
    fireEvent.click(screen.getByRole("button", { name: "Unlock Journal" }));
    await screen.findByDisplayValue("Private synthetic entry");
    fireEvent.click(screen.getByRole("button", { name: "Save Journal" }));
    await waitFor(() => expect(fixture.vault.canClose()).toBe(true));
  });

  it("keeps a failed habit intent and retries without adding a duplicate", async () => {
    const fixture = testVault();
    render(<JournalView vault={fixture.vault} />);
    fireEvent.click(screen.getByRole("button", { name: "Add a habit" }));
    const dialog = screen.getByRole("dialog", { name: "Add a habit" });
    fireEvent.change(within(dialog).getByLabelText("Name"), {
      target: { value: "Read 20 minutes" },
    });
    fixture.failNext();
    fireEvent.click(within(dialog).getByRole("button", { name: "Save habit" }));
    await within(dialog).findByText(
      "Your Journal draft is still in this window. Try again.",
    );
    expect(within(dialog).getByLabelText("Name")).toHaveValue(
      "Read 20 minutes",
    );
    expect(fixture.data().habits).toHaveLength(1);
    fireEvent.click(within(dialog).getByRole("button", { name: "Save habit" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(fixture.data().habits).toHaveLength(1);
    expect(fixture.vault.saveHabitDraft).toHaveBeenCalledTimes(2);
  });

  it("preserves writing when the prompt changes and derives month written counts", async () => {
    const fixture = testVault();
    render(<JournalView vault={fixture.vault} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Journal entry" }), {
      target: { value: "Today’s synthetic text" },
    });
    fireEvent.click(screen.getByRole("button", { name: "New prompt" }));
    await screen.findByText("What felt important today?");
    expect(screen.getByRole("textbox", { name: "Journal entry" })).toHaveValue(
      "Today’s synthetic text",
    );
    expect(fixture.data().entries[0]!.date).toBe(journalToday());
    fireEvent.click(screen.getByRole("button", { name: "Past entries" }));
    expect(screen.getByText("1 day written · Private")).toBeVisible();
    fireEvent.click(
      screen.getByRole("button", { name: /Today’s synthetic text/ }),
    );
    expect(screen.getByRole("textbox", { name: "Journal entry" })).toHaveValue(
      "Today’s synthetic text",
    );
  });

  it("keeps conflicts read-only and requires confirmation before discarding", async () => {
    const fixture = testVault();
    render(<JournalView vault={fixture.vault} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Journal entry" }), {
      target: { value: "Draft to preserve" },
    });
    act(() => fixture.conflict());
    expect(
      screen.getByRole("textbox", { name: "Journal entry" }),
    ).toHaveAttribute("readonly");
    fireEvent.click(screen.getByRole("button", { name: "Use saved Journal" }));
    expect(fixture.vault.discardAndReload).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog", {
      name: "Discard your Journal draft?",
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("textbox", { name: "Journal entry" })).toHaveValue(
      "Draft to preserve",
    );
    fireEvent.click(screen.getByRole("button", { name: "Use saved Journal" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Discard draft and reload" }),
    );
    await screen.findByRole("heading", { name: "Journal is locked" });
    expect(fixture.vault.discardAndReload).toHaveBeenCalledTimes(1);
  });

  it("exports only after a plaintext confirmation and revokes the download on lock", async () => {
    const OriginalURL = URL;
    const revoke = vi.fn();
    vi.stubGlobal(
      "URL",
      class extends OriginalURL {
        static createObjectURL = vi.fn(() => "blob:synthetic-journal");
        static revokeObjectURL = revoke;
      },
    );
    const fixture = testVault();
    render(<JournalView vault={fixture.vault} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Journal entry" }), {
      target: { value: "Export synthetic entry" },
    });
    await waitFor(() => expect(fixture.vault.status().dirty).toBe(false));
    const before = vi.mocked(fixture.vault.read).mock.calls.length;
    await journalMenu("Export Journal");
    const dialog = screen.getByRole("dialog", { name: "Export Journal" });
    expect(
      within(dialog).getByText(
        "The file is not encrypted. Keep it somewhere safe.",
      ),
    ).toBeVisible();
    expect(vi.mocked(fixture.vault.read).mock.calls.length).toBe(before);
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Export Journal" }),
    );
    expect(
      screen.getByRole("link", { name: "Download Journal" }),
    ).toHaveAttribute("href", "blob:synthetic-journal");
    act(() => {
      void fixture.vault.lock();
    });
    expect(
      screen.queryByRole("link", { name: "Download Journal" }),
    ).not.toBeInTheDocument();
    expect(revoke).toHaveBeenCalledWith("blob:synthetic-journal");
  });
});
