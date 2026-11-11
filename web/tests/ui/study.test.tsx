import { onLock } from "../../src/account/session";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StudyView } from "../../src/ui/StudyView";
import type {
  CollectionsState,
  CollectionsStore,
  StudyEntry,
} from "../../src/collections/contracts";
import { CollectionsRevisionConflictError } from "../../src/collections/contracts";
import {
  emptyStudy,
  validateCollections,
} from "../../src/collections/validation";
import { createDeck, saveEntry } from "../../src/study/model";
import { checkClose } from "../../src/desktop/closeGuard";
import { Workspace } from "../../src/ui/Workspace";
import { openCollectionsStore } from "../../src/collections/store";
import type {
  AccountSession,
  Note,
  NotesStore,
} from "../../src/domain/contracts";

// Labelled component-boundary actors only; production still requires its genuine owner registry.
const boundaryActors = vi.hoisted(
  () =>
    new WeakMap<
      object,
      {
        closed: boolean;
        epochs: Set<(epoch: string) => void>;
        closes: Set<() => void>;
      }
    >(),
);
vi.mock("../../src/collections/store", () => {
  const access = (store: object) => {
    const actor = boundaryActors.get(store);
    if (!actor || actor.closed)
      throw new Error("locked: Test Collections boundary is closed.");
    return actor;
  };
  return {
    openCollectionsStore: vi.fn(),
    assertCollectionsAccess: (store: object) => {
      access(store);
    },
    onCollectionsClose: (store: object, listener: () => void) => {
      const actor = access(store);
      actor.closes.add(listener);
      return () => actor.closes.delete(listener);
    },
    onCollectionsEpochChange: (
      store: object,
      listener: (epoch: string) => void,
    ) => {
      const actor = access(store);
      actor.epochs.add(listener);
      return () => actor.epochs.delete(listener);
    },
  };
});
const fixtureStores = new Set<CollectionsStore>();
vi.mock("../../src/ui/RichEditor", () => ({
  RichEditor: () => <div>Editor test boundary</div>,
}));

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});
afterEach(() => {
  for (const store of fixtureStores) store.close();
  fixtureStores.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function memoryStore(populated = false, sourceNoteId: string | null = null) {
  const at = new Date(Date.now() - 60_000);
  let study = emptyStudy("UTC");
  if (populated) {
    study = createDeck(study, "Biology", at);
    const entry: StudyEntry = {
      id: crypto.randomUUID(),
      deckId: study.decks[0]!.id,
      type: "basic",
      front: "Where does glycolysis take place?",
      back: "In the cytoplasm",
      tags: [],
      source: sourceNoteId
        ? {
            noteId: sourceNoteId,
            noteRevision: 1,
            quote: "Glycolysis takes place in the cytoplasm.",
          }
        : null,
      revision: 1,
    };
    study = saveEntry(study, entry, at);
  }
  let state: CollectionsState = {
    version: 3,
    epoch: crypto.randomUUID(),
    revision: 0,
    study,
    journal: null,
    clips: { items: [], receipts: [] },
  };
  const listeners = new Set<() => void>();
  const actor = {
    closed: false,
    epochs: new Set<(epoch: string) => void>(),
    closes: new Set<() => void>(),
  };
  const assertOpen = () => {
    if (actor.closed)
      throw new Error("locked: Test Collections boundary is closed.");
  };
  let stopLock = () => {};
  let unknownResult = false;
  const update = vi.fn<CollectionsStore["update"]>(async (expected, change) => {
    assertOpen();
    if (expected.epoch !== state.epoch || expected.revision !== state.revision)
      throw new CollectionsRevisionConflictError(structuredClone(state));
    state = validateCollections({
      ...change(structuredClone(state)),
      revision: state.revision + 1,
    });
    if (unknownResult) {
      unknownResult = false;
      throw new Error("Commit response lost");
    }
    listeners.forEach((listener) => listener());
    return structuredClone(state);
  });
  const store: CollectionsStore = {
    read: vi.fn(async () => {
      assertOpen();
      return structuredClone(state);
    }),
    update,
    subscribe: (listener) => {
      assertOpen();
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    persistence: () => ({ status: "ready" }),
    close: vi.fn(() => {
      if (actor.closed) return;
      actor.closed = true;
      for (const callback of actor.closes) callback();
      actor.closes.clear();
      actor.epochs.clear();
      listeners.clear();
      stopLock();
    }),
  };
  boundaryActors.set(store, actor);
  fixtureStores.add(store);
  stopLock = onLock(() => store.close());
  return {
    store,
    update,
    state: () => structuredClone(state),
    loseNextCommitResponse: () => {
      unknownResult = true;
    },
    erase: () => {
      state = {
        ...state,
        epoch: crypto.randomUUID(),
        revision: state.revision + 1,
        study: emptyStudy("UTC"),
        journal: null,
      };
      assertOpen();
      actor.epochs.forEach((listener) => listener(state.epoch));
      listeners.forEach((listener) => listener());
    },
  };
}
async function finishMotion(phase: string, animationName: string) {
  const article = document.querySelector<HTMLElement>(
    `.study-flash[data-study-motion="${phase}"]`,
  );
  expect(article).not.toBeNull();
  const event = new Event("animationend", { bubbles: true });
  Object.defineProperty(event, "animationName", { value: animationName });
  await act(async () => {
    fireEvent(article!, event);
    // This consumer import graph can make React choose WebKit's jsdom event
    // alias. Both dispatch through the real guarded handler on the same node;
    // neither calls the controller or advances domain state directly.
    const prefixed = new Event("webkitAnimationEnd", { bubbles: true });
    Object.defineProperty(prefixed, "animationName", { value: animationName });
    fireEvent(article!, prefixed);
  });
}
async function finishReveal() {
  // Exiting content deliberately has no accessible name while aria-hidden.
  const outgoing = document.querySelector(
    'article.study-flash[aria-label="Card question"][data-study-motion="reveal-exit"]',
  );
  expect(outgoing).not.toBeNull();
  expect(outgoing).toHaveAttribute("data-study-motion", "reveal-exit");
  expect(outgoing).toHaveAttribute("inert");
  expect(outgoing).toHaveAttribute("aria-hidden", "true");
  await finishMotion("reveal-exit", "study-reveal-out");
  expect(screen.getByRole("article", { name: "Card answer" })).toHaveAttribute(
    "data-study-motion",
    "answer-enter",
  );
  await finishMotion("answer-enter", "study-answer-in");
}
async function revealAnswer() {
  fireEvent.click(screen.getByRole("button", { name: "Show answer" }));
  await finishReveal();
}
async function openDeck() {
  fireEvent.click(await screen.findByRole("button", { name: "Biology" }));
}
function closeState() {
  let state: ReturnType<typeof checkClose> = "allowed";
  act(() => {
    state = checkClose();
  });
  return state;
}

describe("local Study", () => {
  it("clears the held source editor when a remote erase replaces the collections epoch", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("min-width"),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    const id = crypto.randomUUID();
    const { store, erase } = memoryStore(true, id);
    vi.mocked(openCollectionsStore).mockResolvedValue(store);
    const note: Note = {
      id,
      title: "Erased source",
      document: { type: "doc", content: [] },
      tags: [],
      createdAt: "2026-11-11T00:00:00Z",
      updatedAt: "2026-11-11T00:00:00Z",
      trashedAt: null,
      revision: 1,
    };
    const notes: NotesStore = {
      list: vi.fn(async () => [note]),
      get: vi.fn(async () => note),
      create: vi.fn(),
      update: vi.fn(),
      trash: vi.fn(),
      restore: vi.fn(),
      erase: vi.fn(),
      subscribe: () => () => {},
      persistence: () => ({ status: "ready" }),
      close: vi.fn(),
    };
    const session: AccountSession = {
      accountId: crypto.randomUUID(),
      deviceId: crypto.randomUUID(),
      deviceState: "trusted",
      email: "study-fixture@example.test",
    };
    render(<Workspace store={notes} session={session} onSignOut={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Study" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Study 1 card" }),
    );
    await revealAnswer();
    fireEvent.click(screen.getByRole("button", { name: "Open in note" }));
    await screen.findByDisplayValue("Erased source");
    await act(async () => erase());
    expect(screen.queryByLabelText("Note title")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Back to card" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("No decks yet")).toBeVisible();
  });
  it("does not claim done for the day when Again is due soon, and refreshes the home queue", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-11T08:00:00Z"));
    const { store } = memoryStore(true);
    await act(async () => {
      render(<StudyView store={store} />);
    });
    fireEvent.click(screen.getByRole("button", { name: "Study 1 card" }));
    await revealAnswer();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Again/ }));
    });
    await finishMotion("confirmed-exit", "study-card-out");
    expect(
      screen.getByRole("heading", { name: "Session complete" }),
    ).toBeVisible();
    expect(
      screen.queryByText("That is everything due. Nothing is waiting for you."),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Done$/ }));
    expect(
      screen.queryByRole("button", { name: "Study 1 card" }),
    ).not.toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_010);
    });
    expect(screen.getByRole("button", { name: "Study 1 card" })).toBeVisible();
  });

  it("fences a late old-epoch grade response after erase", async () => {
    const { store, update, state, erase } = memoryStore(true);
    let finish!: (state: CollectionsState) => void;
    let oldResult!: CollectionsState;
    update.mockImplementationOnce((_expected, change) => {
      oldResult = validateCollections({ ...change(state()), revision: 1 });
      return new Promise((resolve) => {
        finish = resolve;
      });
    });
    render(<StudyView store={store} />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Study 1 card" }),
    );
    await revealAnswer();
    fireEvent.click(screen.getByRole("button", { name: /^Good/ }));
    await act(async () => erase());
    await screen.findByText("No decks yet");
    await act(async () => finish(oldResult));
    expect(screen.queryByLabelText("Card answer")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Undo" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("No decks yet")).toBeVisible();
    expect(closeState()).toBe("allowed");
  });
  it("preserves the revealed review and store through the guarded source-note round trip", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("min-width"),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    const id = crypto.randomUUID();
    const { store } = memoryStore(true, id);
    vi.mocked(openCollectionsStore).mockResolvedValue(store);
    const note: Note = {
      id,
      title: "Biology source",
      document: { type: "doc", content: [{ type: "paragraph" }] },
      tags: [],
      createdAt: "2026-11-11T00:00:00Z",
      updatedAt: "2026-11-11T00:00:00Z",
      trashedAt: null,
      revision: 1,
    };
    const notes: NotesStore = {
      list: vi.fn(async () => [note]),
      get: vi.fn(async () => note),
      create: vi.fn(),
      update: vi.fn(),
      trash: vi.fn(),
      restore: vi.fn(),
      erase: vi.fn(),
      subscribe: () => () => {},
      persistence: () => ({ status: "ready" }),
      close: vi.fn(),
    };
    const session: AccountSession = {
      accountId: crypto.randomUUID(),
      deviceId: crypto.randomUUID(),
      deviceState: "trusted",
      email: "study-fixture@example.test",
    };
    render(<Workspace store={notes} session={session} onSignOut={vi.fn()} />);
    await screen.findByRole("button", { name: "Study" });
    expect(openCollectionsStore).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Study" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Study 1 card" }),
    );
    await revealAnswer();
    fireEvent.click(screen.getByRole("button", { name: "Open in note" }));
    await screen.findByDisplayValue("Biology source");
    expect(screen.getByLabelText("Card answer")).not.toBeVisible();
    expect(store.close).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Note title"), {
      target: { value: "Unsaved source" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Back to card" }));
    expect(screen.getByDisplayValue("Unsaved source")).toBeVisible();
    // Returning to the review must not discard the source note's dirty draft.
    expect(
      screen.getByText(
        "Your latest changes are only in this window. Save or copy your text before leaving.",
      ),
    ).toBeVisible();
  });

  it("restores the same answer after opening and returning from a clean source note", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("min-width"),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    const id = crypto.randomUUID();
    const { store } = memoryStore(true, id);
    vi.mocked(openCollectionsStore).mockResolvedValue(store);
    const note: Note = {
      id,
      title: "Source",
      document: { type: "doc", content: [] },
      tags: [],
      createdAt: "2026-11-11T00:00:00Z",
      updatedAt: "2026-11-11T00:00:00Z",
      trashedAt: null,
      revision: 1,
    };
    const notes: NotesStore = {
      list: vi.fn(async () => [note]),
      get: vi.fn(async () => note),
      create: vi.fn(),
      update: vi.fn(),
      trash: vi.fn(),
      restore: vi.fn(),
      erase: vi.fn(),
      subscribe: () => () => {},
      persistence: () => ({ status: "ready" }),
      close: vi.fn(),
    };
    const session: AccountSession = {
      accountId: crypto.randomUUID(),
      deviceId: crypto.randomUUID(),
      deviceState: "trusted",
      email: "study-fixture@example.test",
    };
    render(<Workspace store={notes} session={session} onSignOut={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Study" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Study 1 card" }),
    );
    await revealAnswer();
    fireEvent.click(screen.getByRole("button", { name: "Open in note" }));
    await screen.findByDisplayValue("Source");
    fireEvent.click(screen.getByRole("button", { name: "Back to card" }));
    expect(screen.getByLabelText("Card answer")).toBeVisible();
    expect(screen.getByText("1 of 1")).toBeVisible();
    expect(openCollectionsStore).toHaveBeenCalledTimes(1);
    expect(store.close).not.toHaveBeenCalled();
  });

  it("uses the revealed preview instant after time passes and focus refreshes", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-11T08:00:00Z"));
    const { store, state } = memoryStore(true);
    render(<StudyView store={store} />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Study 1 card" }),
    );
    await revealAnswer();
    const expectedDue = screen
      .getByRole("button", { name: /^Good/ })
      .querySelector("time")!.dateTime;
    vi.setSystemTime(new Date("2026-11-11T09:00:00Z"));
    fireEvent.focus(window);
    fireEvent.click(screen.getByRole("button", { name: /^Good/ }));
    await screen.findByRole("heading", { name: "Done for today" });
    expect(state().study.events[0]!.at).toBe("2026-11-11T08:00:00.000Z");
    expect(state().study.cards[0]!.schedule.due).toBe(expectedDue);
  });

  it("does not intercept Space on the focused End session button", async () => {
    const { store } = memoryStore(true);
    render(<StudyView store={store} />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Study 1 card" }),
    );
    const end = screen.getByRole("button", { name: "End session" });
    end.focus();
    expect(fireEvent.keyDown(end, { key: " " })).toBe(true);
    expect(screen.queryByLabelText("Card answer")).not.toBeInTheDocument();
    fireEvent.click(end);
    expect(screen.queryByLabelText("Card question")).not.toBeInTheDocument();
  });
  it("reconciles a committed grade after a lost response without grading twice", async () => {
    const { store, update, state, loseNextCommitResponse } = memoryStore(true);
    render(<StudyView store={store} />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Study 1 card" }),
    );
    await revealAnswer();
    loseNextCommitResponse();
    fireEvent.click(screen.getByRole("button", { name: /^Good/ }));
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(state().study.events).toHaveLength(1);
    fireEvent.click(await screen.findByRole("button", { name: "Reload" }));
    await screen.findByRole("heading", { name: "Done for today" });
    expect(update).toHaveBeenCalledTimes(1);
    expect(state().study.events).toHaveLength(1);
    expect(state().study.cards[0]!.schedule.repetitions).toBe(1);
  });

  it("clears erased drafts and their close guard when a replacement epoch arrives", async () => {
    const { store, erase } = memoryStore(true);
    render(<StudyView store={store} />);
    await openDeck();
    fireEvent.click(screen.getByRole("button", { name: "Add card" }));
    fireEvent.change(screen.getByLabelText("Front"), {
      target: { value: "Private erased draft" },
    });
    expect(closeState()).toBe("draft");
    act(() => {
      erase();
      // Assert inside the observer turn, before any async read can settle.
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(
        screen.queryByDisplayValue("Private erased draft"),
      ).not.toBeInTheDocument();
      expect(checkClose()).toBe("allowed");
    });
    await screen.findByText("No decks yet");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(
      screen.queryByDisplayValue("Private erased draft"),
    ).not.toBeInTheDocument();
    expect(closeState()).toBe("allowed");
  });
  it("creates actual decks and reversed cards, retaining a failed draft and close guard", async () => {
    const { store, update, state } = memoryStore();
    render(<StudyView store={store} />);
    await screen.findByText("No decks yet");
    fireEvent.click(screen.getAllByRole("button", { name: "New deck" })[0]!);
    const deckDialog = screen.getByRole("dialog", { name: "New deck" });
    fireEvent.change(within(deckDialog).getByLabelText("Name"), {
      target: { value: "My deck" },
    });
    expect(closeState()).toBe("draft");
    fireEvent.click(
      within(deckDialog).getByRole("button", { name: "Create deck" }),
    );
    await screen.findByRole("heading", { name: "My deck" });
    expect(state().study.decks).toHaveLength(1);
    expect(closeState()).toBe("allowed");
    fireEvent.click(screen.getAllByRole("button", { name: "Add card" })[0]!);
    const dialog = screen.getByRole("dialog", { name: "Add card" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Reversed" }));
    fireEvent.change(within(dialog).getByLabelText("Front"), {
      target: { value: "Glycolysis" },
    });
    fireEvent.change(within(dialog).getByLabelText("Back"), {
      target: { value: "Breaks glucose into pyruvate" },
    });
    update.mockRejectedValueOnce(new Error("Storage full"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Add card" }));
    await within(dialog).findByText(
      "Couldn’t save this card. Your draft is still here. Try again.",
    );
    expect(within(dialog).getByLabelText("Front")).toHaveValue("Glycolysis");
    expect(state().study.cards).toHaveLength(0);
    expect(closeState()).toBe("draft");
    fireEvent.click(within(dialog).getByRole("button", { name: "Add card" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(state().study.cards).toHaveLength(2);
    expect(screen.getByText("2 cards · 2 due")).toBeVisible();
    expect(closeState()).toBe("allowed");
  });

  it("reveals, grades once, persists its schedule, and undoes the actual review", async () => {
    const { store, update, state } = memoryStore(true);
    render(<StudyView store={store} />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Study 1 card" }),
    );
    expect(screen.queryByText("In the cytoplasm")).not.toBeInTheDocument();
    const view = screen.getByRole("region", { name: "Study" });
    fireEvent.keyDown(view, { key: "1" });
    expect(update).not.toHaveBeenCalled();
    fireEvent.keyDown(view, { key: " " });
    await finishReveal();
    expect(screen.getByText("In the cytoplasm")).toBeVisible();
    fireEvent.keyDown(view, { key: "3" });
    fireEvent.keyDown(view, { key: "3", repeat: true });
    await screen.findByRole("heading", { name: "Done for today" });
    expect(update).toHaveBeenCalledTimes(1);
    expect(state().study.events).toHaveLength(1);
    expect(state().study.cards[0]!.schedule.state).toBe("review");
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await screen.findByLabelText("Card answer");
    expect(state().study.events[0]!.undoneAt).not.toBeNull();
    expect(state().study.cards[0]!.schedule.state).toBe("new");
    expect(screen.getByText("1 of 1")).toBeVisible();
  });

  it("keeps a revealed answer and queue position when grading fails", async () => {
    const { store, update, state } = memoryStore(true);
    render(<StudyView store={store} />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Study 1 card" }),
    );
    await revealAnswer();
    update.mockRejectedValueOnce(new Error("Write failed"));
    fireEvent.click(screen.getByRole("button", { name: /^Good/ }));
    await screen.findByText(
      "Couldn’t confirm this review. Reload to check whether it was saved.",
    );
    expect(screen.getByLabelText("Card answer")).toBeVisible();
    expect(screen.getByText("1 of 1")).toBeVisible();
    expect(state().study.events).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Reload" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^Good/ })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: /^Good/ }));
    await screen.findByRole("heading", { name: "Done for today" });
    expect(state().study.events).toHaveLength(1);
  });

  it("requires an explicit reload after CAS conflict without replaying the draft", async () => {
    const { store, update, state } = memoryStore(true);
    render(<StudyView store={store} />);
    await openDeck();
    fireEvent.click(screen.getByRole("button", { name: "Add card" }));
    const dialog = screen.getByRole("dialog", { name: "Add card" });
    fireEvent.change(within(dialog).getByLabelText("Front"), {
      target: { value: "My question" },
    });
    fireEvent.change(within(dialog).getByLabelText("Back"), {
      target: { value: "My answer" },
    });
    update.mockRejectedValueOnce(new CollectionsRevisionConflictError(state()));
    fireEvent.click(within(dialog).getByRole("button", { name: "Add card" }));
    await within(dialog).findByText(
      "Study changed in another window. Your draft is still here. Reload before trying again.",
    );
    expect(within(dialog).getByLabelText("Front")).toHaveValue("My question");
    fireEvent.click(within(dialog).getByRole("button", { name: "Reload" }));
    await waitFor(() =>
      expect(
        within(dialog).queryByRole("button", { name: "Reload" }),
      ).not.toBeInTheDocument(),
    );
    expect(update).toHaveBeenCalledTimes(1);
    expect(state().study.entries).toHaveLength(1);
    fireEvent.click(within(dialog).getByRole("button", { name: "Add card" }));
    await waitFor(() => expect(state().study.entries).toHaveLength(2));
  });

  it("validates cloze blanks and derives actual question and answer cards", async () => {
    const { store, state } = memoryStore(true);
    render(<StudyView store={store} />);
    await openDeck();
    fireEvent.click(screen.getByRole("button", { name: "Add card" }));
    const dialog = screen.getByRole("dialog", { name: "Add card" });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Fill in the blank" }),
    );
    fireEvent.change(within(dialog).getByLabelText("Text"), {
      target: { value: "The capital is {{capital}}." },
    });
    fireEvent.change(within(dialog).getByLabelText("Answer 1"), {
      target: { value: "Paris" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add card" }));
    expect(within(dialog).getByRole("alert")).toHaveTextContent(
      "Give each blank a unique ID",
    );
    fireEvent.change(within(dialog).getByLabelText("Blank ID 1"), {
      target: { value: "capital" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add card" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(state().study.cards).toHaveLength(2);
    expect(
      screen.getByRole("button", { name: "The capital is [...]." }),
    ).toBeVisible();
  });

  it("loads progress from actual reviews and persists hiding the streak", async () => {
    const { store, state } = memoryStore(true);
    render(<StudyView store={store} />);
    fireEvent.click(await screen.findByRole("button", { name: "Progress" }));
    expect(screen.getByText("Streak 0 days")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Hide streak" }));
    await screen.findByRole("button", { name: "Show streak" });
    expect(state().study.preferences.showStreak).toBe(false);
    expect(screen.queryByText("Streak 0 days")).not.toBeInTheDocument();
  });
});
