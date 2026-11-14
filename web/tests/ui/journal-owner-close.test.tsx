import { act, fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type {
  JournalVault,
  JournalVaultStatus,
} from "../../src/collections/journalVault";
import { JournalView } from "../../src/ui/JournalView";

// UI lifecycle adapter only. No keys, encryption or real owner authority is mocked as qualified.
function lifecycle(hasJournal = false) {
  let metadata: JournalVaultStatus = {
    phase: "locked",
    hasJournal,
    dirty: false,
    habitDraftDirty: false,
    linkDraftDirty: false,
    saving: false,
    pendingRecovery: false,
    conflict: false,
    error: null,
  };
  const listeners = new Set<() => void>(),
    notifiers: (() => void)[] = [];
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  function transition(
    phase: JournalVaultStatus["phase"],
    inspect?: () => void,
  ) {
    metadata = { ...metadata, phase };
    for (const notify of [...listeners]) {
      notify();
      // This executes inside the owner's notifier turn, before React act exits.
      inspect?.();
    }
  }
  const vault: JournalVault = {
    status: vi.fn(() => ({ ...metadata })),
    read: vi.fn(() => {
      throw Error("This boundary adapter never unlocks plaintext");
    }),
    readHabitDraft: vi.fn(() => null),
    setHabitDraft: vi.fn(),
    saveHabitDraft: vi.fn(async () => {}),
    discardHabitDraft: vi.fn(),
    readLinkDraft: vi.fn(() => null),
    setLinkDraft: vi.fn(),
    discardLinkDraft: vi.fn(),
    beginLinkApply: vi.fn(() => "unused"),
    completeLinkDraft: vi.fn(),
    create: vi.fn(() => {
      transition("unlocking");
      return pending;
    }),
    unlock: vi.fn(() => {
      transition("unlocking");
      return pending;
    }),
    update: vi.fn(async () => {}),
    retry: vi.fn(async () => {}),
    lock: vi.fn(async () => {}),
    discardAndReload: vi.fn(async () => {}),
    setAway: vi.fn(),
    canClose: vi.fn(() => true),
    subscribe: vi.fn((notify) => {
      listeners.add(notify);
      notifiers.push(notify);
      return () => {
        listeners.delete(notify);
      };
    }),
    close: vi.fn(() => transition("closed")),
  };
  return { vault, transition, notifiers, release };
}
const secret = "Synthetic lifecycle passphrase";
function populate(hasJournal: boolean) {
  fireEvent.change(screen.getByLabelText("Passphrase", { exact: true }), {
    target: { value: secret },
  });
  if (!hasJournal)
    fireEvent.change(
      screen.getByLabelText("Confirm passphrase", { exact: true }),
      { target: { value: secret } },
    );
}
const passwords = () => [
  ...document.querySelectorAll<HTMLInputElement>('input[type="password"]'),
];

for (const terminal of ["closed", "revoked"] as const) {
  for (const hasJournal of [false, true]) {
    it(`removes populated ${hasJournal ? "locked" : "enrollment"} credentials within the ${terminal} notifier turn`, () => {
      const owner = lifecycle(hasJournal);
      render(<JournalView vault={owner.vault} />);
      populate(hasJournal);
      expect(passwords().every((input) => input.value === secret)).toBe(true);
      let samples = 0;
      act(() =>
        owner.transition(terminal, () => {
          samples++;
          expect(passwords()).toHaveLength(0);
          expect(
            screen.getByRole("heading", { name: "Journal access changed" }),
          ).toBeVisible();
        }),
      );
      expect(samples).toBe(1);
      expect(owner.vault.read).not.toHaveBeenCalled();
    });

    it(`removes ${hasJournal ? "unlock" : "create"}-in-progress fields synchronously on ${terminal} and ignores late completion`, async () => {
      const owner = lifecycle(hasJournal);
      render(<JournalView vault={owner.vault} />);
      populate(hasJournal);
      fireEvent.click(
        screen.getByRole("button", {
          name: hasJournal ? "Unlock Journal" : "Lock Journal",
        }),
      );
      expect(owner.vault.status().phase).toBe("unlocking");
      expect(passwords()).toHaveLength(hasJournal ? 1 : 2);
      try {
        act(() =>
          owner.transition(terminal, () => {
            expect(passwords()).toHaveLength(0);
            expect(
              screen.getByRole("heading", { name: "Journal access changed" }),
            ).toBeVisible();
          }),
        );
      } finally {
        await act(async () => owner.release());
      }
      expect(passwords()).toHaveLength(0);
      expect(
        screen.getByRole("heading", { name: "Journal access changed" }),
      ).toBeVisible();
      expect(owner.vault.read).not.toHaveBeenCalled();
    });
  }
}

it("ignores a captured old-owner notifier after replacement without reading its closed status", () => {
  const previous = lifecycle(),
    next = lifecycle(true);
  const view = render(<JournalView vault={previous.vault} />);
  populate(false);
  const late = previous.notifiers[0]!;
  view.rerender(<JournalView vault={next.vault} />);
  populate(true);
  vi.mocked(previous.vault.status).mockImplementation(() => {
    throw Error("Old owner must not be read");
  });
  expect(() => act(late)).not.toThrow();
  expect(screen.getByLabelText("Passphrase", { exact: true })).toHaveValue(
    secret,
  );
  expect(
    screen.queryByRole("heading", { name: "Journal access changed" }),
  ).not.toBeInTheDocument();
});

it("ignores a captured notifier after unmount without calling the dead owner", () => {
  const owner = lifecycle();
  const view = render(<JournalView vault={owner.vault} />);
  populate(false);
  const late = owner.notifiers[0]!;
  view.unmount();
  vi.mocked(owner.vault.status).mockImplementation(() => {
    throw Error("Unmounted owner must not be read");
  });
  expect(() => act(late)).not.toThrow();
  expect(passwords()).toHaveLength(0);
});
