import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { StudyView } from "../../src/ui/StudyView";
import {
  useStudyMotion,
  useStudyColdLoading,
  useStudyToastExit,
} from "../../src/ui/useStudyMotion";
import type { StudyMotionLocator } from "../../src/ui/useStudyMotion";
import type {
  CollectionsState,
  CollectionsStore,
} from "../../src/collections/contracts";
import { emptyStudy } from "../../src/collections/validation";
import { createDeck, saveEntry } from "../../src/study/model";
import { checkClose } from "../../src/desktop/closeGuard";
const owners = vi.hoisted(
  () =>
    new WeakMap<
      object,
      { closed: boolean; close: Set<() => void>; epoch: Set<() => void> }
    >(),
);
const scope = vi.hoisted(() => ({ version: 0, locks: new Set<() => void>() }));
vi.mock("../../src/account/session", () => ({
  lockVersion: () => scope.version,
  onLock: (fn: () => void) => {
    scope.locks.add(fn);
    return () => scope.locks.delete(fn);
  },
}));
vi.mock("../../src/collections/store", () => ({
  assertCollectionsAccess: (store: object) => {
    if (owners.get(store)?.closed) throw Error("closed");
  },
  onCollectionsClose: (store: object, fn: () => void) => {
    owners.get(store)!.close.add(fn);
    return () => owners.get(store)!.close.delete(fn);
  },
  onCollectionsEpochChange: (store: object, fn: () => void) => {
    owners.get(store)!.epoch.add(fn);
    return () => owners.get(store)!.epoch.delete(fn);
  },
}));
afterEach(() => {
  vi.useRealTimers();
  scope.locks.clear();
  scope.version = 0;
});
const loc: StudyMotionLocator = {
  epoch: "epoch",
  sessionId: "session",
  cardId: "card",
  entryId: "entry",
  cardRevision: 1,
  entryRevision: 1,
  side: "question",
};
function animation(element: Element, name: string) {
  // React/JSDOM may select the prefixed DOM event during feature detection.
  for (const type of ["animationend", "webkitAnimationEnd"]) {
    const event = new Event(type, { bubbles: true });
    Object.defineProperty(event, "animationName", { value: name });
    fireEvent(element, event);
  }
}
// Explicit boundary adapter: real encrypted browser evidence uses the genuine fixture instead.
function fixture(count = 2) {
  const at = new Date(Date.now() - 60000);
  let study = createDeck(emptyStudy("UTC"), "Motion deck", at);
  for (let i = 0; i < count; i++)
    study = saveEntry(
      study,
      {
        id: crypto.randomUUID(),
        deckId: study.decks[0]!.id,
        type: "basic",
        front: `Question ${i + 1}`,
        back: `Answer ${i + 1}`,
        tags: [],
        source: null,
        revision: 1,
      },
      at,
    );
  let state: CollectionsState = {
    version: 3,
    epoch: crypto.randomUUID(),
    revision: 0,
    study,
    journal: null,
    clips: { items: [], receipts: [] },
  };
  const listeners = new Set<() => void>(),
    owner = {
      closed: false,
      close: new Set<() => void>(),
      epoch: new Set<() => void>(),
    };
  const store: CollectionsStore = {
    read: vi.fn(async () => structuredClone(state)),
    update: vi.fn(async (_token, change) => {
      state = {
        ...change(structuredClone(state)),
        revision: state.revision + 1,
      };
      listeners.forEach((fn) => fn());
      return structuredClone(state);
    }),
    subscribe: (fn) => {
      if (owner.closed) throw Error("closed owner");
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    persistence: () => ({ status: "ready" }),
    close: () => {
      owner.closed = true;
      owner.close.forEach((fn) => fn());
    },
  };
  owners.set(store, owner);
  const view = render(<StudyView store={store} />);
  return {
    store,
    view,
    value: () => state,
    edit: () => {
      const entry = state.study.entries.find(
        (item) =>
          item.type === "basic" &&
          item.front === document.querySelector(".study-question")?.textContent,
      );
      if (!entry || entry.type !== "basic")
        throw Error("No actual shown basic entry");
      state = {
        ...state,
        revision: state.revision + 1,
        study: saveEntry(
          state.study,
          {
            ...entry,
            revision: entry.revision + 1,
            front: "Edited same card",
          },
          new Date(),
        ),
      };
      listeners.forEach((fn) => fn());
    },
    erase: (notify = true) => {
      state = {
        ...state,
        epoch: crypto.randomUUID(),
        study: emptyStudy("UTC"),
      };
      owner.epoch.forEach((fn) => fn());
      if (notify) listeners.forEach((fn) => fn());
    },
  };
}
async function start(count = 2) {
  const f = fixture(count);
  fireEvent.click(
    await screen.findByRole("button", {
      name: `Study ${count} card${count === 1 ? "" : "s"}`,
    }),
  );
  return f;
}
async function reveal() {
  fireEvent.click(screen.getByRole("button", { name: "Show answer" }));
  const old = screen.getByRole("article", { hidden: true });
  expect(old).toHaveAttribute("data-study-motion", "reveal-exit");
  animation(old, "study-reveal-out");
  const answer = await screen.findByRole("article", { name: "Card answer" });
  animation(answer, "study-answer-in");
}
it("rejects grade clicks and numeric keys until actual answer entrance completes, with no queued grade", async () => {
  const f = await start();
  fireEvent.click(screen.getByRole("button", { name: "Show answer" }));
  animation(screen.getByRole("article", { hidden: true }), "study-reveal-out");
  const answer = await screen.findByRole("article", { name: "Card answer" });
  const good = screen.getByRole("button", { name: /^Good/ });
  const preview = good.querySelector("time")!.getAttribute("datetime");
  expect(good).toBeDisabled();
  fireEvent.click(good);
  fireEvent.keyDown(answer, { key: "1" });
  animation(answer, "study-next-in");
  expect(good).toBeDisabled();
  expect(f.store.update).not.toHaveBeenCalled();
  animation(answer, "study-answer-in");
  expect(good).toBeEnabled();
  await act(async () => {});
  expect(f.store.update).not.toHaveBeenCalled();
  fireEvent.click(good);
  await waitFor(() => expect(f.store.update).toHaveBeenCalledTimes(1));
  expect(f.value().study.events).toHaveLength(1);
  expect(f.value().study.events[0]!.after.schedule.due).toBe(preview);
});
it("keeps reveal and confirmed phases distinct, filters bubbled/wrong events and retires duplicate completions", () => {
  vi.useFakeTimers();
  const { result } = renderHook(() => useStudyMotion(false));
  act(() => result.current.begin("reveal-exit", loc));
  expect(result.current.phase).toBe("reveal-exit");
  act(() => vi.advanceTimersByTime(138));
  expect(result.current.phase).toBe("reveal-exit");
  act(() => vi.advanceTimersByTime(1));
  expect(result.current.phase).toBe("answer-enter");
  act(() => vi.advanceTimersByTime(184));
  expect(result.current.phase).toBe("stable");
  act(() =>
    result.current.begin("confirmed-exit", { ...loc, side: "answer" }, "event"),
  );
  act(() => vi.advanceTimersByTime(174));
  expect(result.current.phase).toBe("next-enter");
  act(() => vi.advanceTimersByTime(234));
  expect(result.current.phase).toBe("stable");
  act(() => result.current.begin("confirmed-exit", loc, "event"));
  expect(result.current.phase).toBe("stable");
});
it("covered and explicit invalidation retire every pending presentation deadline", () => {
  vi.useFakeTimers();
  const { result, rerender } = renderHook(
    ({ covered }) => useStudyMotion(covered),
    { initialProps: { covered: false } },
  );
  act(() => result.current.begin("reveal-exit", loc));
  rerender({ covered: true });
  expect(result.current.locator).toBeNull();
  act(() => vi.advanceTimersByTime(1000));
  expect(result.current.phase).toBe("stable");
  rerender({ covered: false });
  act(() => result.current.begin("confirmed-exit", loc, "new"));
  act(() => result.current.invalidate());
  act(() => vi.advanceTimersByTime(1000));
  expect(result.current.locator).toBeNull();
});
it("cold loading gates at400ms, cancels fast results, fades only an actually shown loader", () => {
  vi.useFakeTimers();
  const { result, rerender } = renderHook(
    ({ ready, error }) => useStudyColdLoading(ready, error),
    { initialProps: { ready: false, error: false } },
  );
  act(() => vi.advanceTimersByTime(399));
  expect(result.current.loader).toBe(false);
  rerender({ ready: true, error: false });
  expect(result.current.entering).toBe(false);
  rerender({ ready: false, error: false });
  act(() => vi.advanceTimersByTime(400));
  expect(result.current.loader).toBe(true);
  rerender({ ready: true, error: false });
  expect(result.current.entering).toBe(true);
  act(() => vi.advanceTimersByTime(184));
  expect(result.current.entering).toBe(false);
  rerender({ ready: false, error: false });
  rerender({ ready: false, error: true });
  act(() => vi.advanceTimersByTime(1000));
  expect(result.current.loader).toBe(false);
});
it("toast expiry adds only an exit and cannot remove a replacement event", () => {
  vi.useFakeTimers();
  const remove = vi.fn();
  const { result, rerender } = renderHook(
    ({ id }) => useStudyToastExit(id, remove),
    { initialProps: { id: "a" } },
  );
  act(() => result.current.expire("a"));
  expect(result.current.exiting).toBe(true);
  act(() => vi.advanceTimersByTime(173));
  expect(remove).not.toHaveBeenCalled();
  rerender({ id: "b" });
  act(() => vi.advanceTimersByTime(1000));
  expect(remove).not.toHaveBeenCalled();
  act(() => result.current.expire("b"));
  act(() => vi.advanceTimersByTime(174));
  expect(remove).toHaveBeenCalledExactlyOnceWith("b");
});
it("retires the old cold-loader gate when a replacement owner is still pending", () => {
  vi.useFakeTimers();
  const { result, rerender } = renderHook(
    ({ scope }) => useStudyColdLoading(false, false, scope),
    { initialProps: { scope: 1 } },
  );
  act(() => vi.advanceTimersByTime(399));
  rerender({ scope: 2 });
  act(() => vi.advanceTimersByTime(1));
  expect(result.current.loader).toBe(false);
  act(() => vi.advanceTimersByTime(399));
  expect(result.current.loader).toBe(true);
});
it("captures real answerAt once, begins departure only after actual confirmation, and Undo interrupts", async () => {
  const f = await start();
  await reveal();
  const times = [...document.querySelectorAll(".study-grades time")].map((el) =>
    el.getAttribute("datetime"),
  );
  const answer = screen.getByRole("article", { name: "Card answer" });
  animation(answer, "study-answer-in");
  expect(
    [...document.querySelectorAll(".study-grades time")].map((el) =>
      el.getAttribute("datetime"),
    ),
  ).toEqual(times);
  fireEvent.click(screen.getByRole("button", { name: /^Good/ }));
  await waitFor(() =>
    expect(
      document.querySelector('[data-study-motion="confirmed-exit"]'),
    ).not.toBeNull(),
  );
  expect(f.value().study.events).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  await screen.findByRole("article", { name: "Card answer" });
  expect(f.value().study.events[0]!.undoneAt).not.toBeNull();
  expect(
    document.querySelector('[data-study-motion="confirmed-exit"]'),
  ).toBeNull();
});
it("does not animate success for an unconfirmed failed grade", async () => {
  const f = await start();
  await reveal();
  vi.mocked(f.store.update).mockRejectedValueOnce(Error("unknown"));
  fireEvent.click(screen.getByRole("button", { name: /^Good/ }));
  await screen.findByText(
    "Couldn’t confirm this review. Reload to check whether it was saved.",
  );
  expect(
    document.querySelector('[data-study-motion="confirmed-exit"]'),
  ).toBeNull();
  expect(f.value().study.events).toHaveLength(0);
});
it("same-ID compatible body edit interrupts an outgoing locator immediately", async () => {
  const f = await start();
  fireEvent.click(screen.getByRole("button", { name: "Show answer" }));
  act(f.edit);
  await waitFor(() =>
    expect(
      document.querySelector('[data-study-motion="reveal-exit"]'),
    ).toBeNull(),
  );
  expect(screen.queryByText("Question 1")).not.toBeInTheDocument();
});
it("direct close and account lock synchronously remove private answer and prevent late phase revival", async () => {
  const f = await start();
  await reveal();
  act(() => f.store.close());
  expect(screen.queryByText(/Answer [12]/)).not.toBeInTheDocument();
  expect(screen.getByText("Study is no longer available.")).toBeVisible();
  f.view.unmount();
  await start();
  await reveal();
  act(() => {
    scope.version++;
    scope.locks.forEach((fn) => fn());
  });
  expect(screen.queryByText(/Answer [12]/)).not.toBeInTheDocument();
});
it("epoch replacement clears the answer before the genuine separate next-epoch read", async () => {
  const f = await start();
  await reveal();
  act(() => f.erase(false));
  expect(screen.queryByText(/Answer [12]/)).not.toBeInTheDocument();
  await screen.findByRole("heading", {
    name: "Make your first card from a note",
  });
});
it("renders a closed owner truthfully without subscribing/reading it and uses only actual reopen callback", async () => {
  const f = fixture();
  await screen.findByRole("button", { name: "Study 2 cards" });
  f.view.unmount();
  f.store.close();
  const count = vi.mocked(f.store.read).mock.calls.length,
    reopen = vi.fn();
  render(<StudyView store={f.store} onReopen={reopen} />);
  expect(screen.getByText("Study is no longer available.")).toBeVisible();
  expect(f.store.read).toHaveBeenCalledTimes(count);
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(reopen).toHaveBeenCalledOnce();
  expect(f.store.read).toHaveBeenCalledTimes(count);
});
it("ignores child and wrong animation events and focuses only the actual revealed answer", async () => {
  await start();
  const button = screen.getByRole("button", { name: "Show answer" });
  button.focus();
  fireEvent.click(button);
  const question = screen.getByRole("article", { hidden: true });
  animation(question.querySelector(".study-question")!, "study-reveal-out");
  animation(question, "study-card-out");
  expect(question).toHaveAttribute("data-study-motion", "reveal-exit");
  animation(question, "study-reveal-out");
  const answer = await screen.findByRole("article", { name: "Card answer" });
  expect(answer).toHaveFocus();
  expect(answer).toHaveAttribute("data-study-motion", "answer-enter");
});
it("keeps actual operation tracking pending after synchronous private close and ignores its late result", async () => {
  const f = await start();
  await reveal();
  let resolve!: (value: CollectionsState) => void;
  vi.mocked(f.store.update).mockReturnValueOnce(
    new Promise<CollectionsState>((yes) => {
      resolve = yes;
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: /^Good/ }));
  expect(checkClose()).toBe("draft");
  act(() => f.store.close());
  expect(screen.queryByText(/Answer [12]/)).not.toBeInTheDocument();
  expect(checkClose()).toBe("working");
  await act(async () => resolve(f.value()));
  expect(screen.getByText("Study is no longer available.")).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "Undo" }),
  ).not.toBeInTheDocument();
});
