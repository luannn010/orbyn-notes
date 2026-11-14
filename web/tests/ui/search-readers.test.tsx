import { onLock, lock } from "../../src/account/session";
import { StrictMode } from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ClipsView } from "../../src/ui/ClipsView";
import { StudyView } from "../../src/ui/StudyView";
import { CardSearchPreview } from "../../src/ui/CardSearchPreview";
import type { Clip, ClipSnapshot, ClipsStore } from "../../src/clips/contracts";
import type {
  CollectionsState,
  CollectionsStore,
  StudyEntry,
} from "../../src/collections/contracts";
import { emptyStudy } from "../../src/collections/validation";
import { createDeck, saveEntry } from "../../src/study/model";
import type {
  ClipSearchOpenRequest,
  CardSearchOpenRequest,
} from "../../src/ui/searchNavigation";
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
const accountId = "11111111-1111-4111-8111-111111111111",
  epoch = "22222222-2222-4222-8222-222222222222";
afterEach(() => {
  for (const store of fixtureStores) store.close();
  fixtureStores.clear();
});
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});
// Explicit reader-boundary fixtures; no fake data adapters are used in production.
function clips() {
  const item = (
    id: string,
    title: string,
    archivedAt: string | null,
  ): Clip => ({
    id,
    title,
    revision: 1,
    originalUrl: "https://example.test/" + id,
    canonicalUrl: "https://example.test/" + id,
    text: "Saved " + title,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    readAt: null,
    readLater: false,
    archivedAt,
  });
  const value: ClipSnapshot = {
    epoch,
    revision: 1,
    clips: {
      items: [
        item("a", "Current A", null),
        item("b", "Archived B", "2026-01-02T00:00:00Z"),
      ],
      receipts: [],
    },
  };
  const store: ClipsStore = {
    read: vi.fn(async () => structuredClone(value)),
    prepare: vi.fn(),
    commit: vi.fn(),
    subscribe: () => () => {},
    onInvalidate: () => () => {},
    persistence: () => ({ status: "ready" }),
    close: vi.fn(),
  };
  return { store, value };
}
const clipRequest = (id: string, requestId = id): ClipSearchOpenRequest => ({
  requestId,
  target: { kind: "clip", accountId, collectionsEpoch: epoch, clipId: id },
});
it("opens an exact archived Clip internally without fetch/read/unarchive mutations", async () => {
  const f = clips(),
    ack = vi.fn();
  render(
    <ClipsView
      store={f.store}
      accountId={accountId}
      openClip={clipRequest("b")}
      onSearchReaderResult={ack}
    />,
  );
  await screen.findByRole("heading", { name: "Archived B" });
  expect(ack).toHaveBeenCalledWith("b", "opened");
  expect(f.store.prepare).not.toHaveBeenCalled();
  expect(f.store.commit).not.toHaveBeenCalled();
  expect(f.value.clips.items[1]!.archivedAt).not.toBeNull();
  expect(f.value.clips.items[1]!.readAt).toBeNull();
});
it("rejects wrong-scope Clip requests without opening another item", async () => {
  const f = clips(),
    ack = vi.fn();
  render(
    <ClipsView
      store={f.store}
      accountId={accountId}
      openClip={{
        ...clipRequest("b"),
        target: { ...clipRequest("b").target, accountId: "other" },
      }}
      onSearchReaderResult={ack}
    />,
  );
  await waitFor(() => expect(ack).toHaveBeenCalledWith("b", "unavailable"));
  expect(
    screen.queryByRole("heading", { name: "Archived B" }),
  ).not.toBeInTheDocument();
  expect(f.store.commit).not.toHaveBeenCalled();
});
it("restores the actual held Clip reader on explicit search clear", async () => {
  const f = clips();
  const v = render(<ClipsView store={f.store} accountId={accountId} />);
  await screen.findByRole("button", { name: /Current A/ });
  fireEvent.click(screen.getByRole("button", { name: /Current A/ }));
  await screen.findByRole("heading", { name: "Current A" });
  v.rerender(
    <ClipsView store={f.store} accountId={accountId} holdSearchOrigin />,
  );
  v.rerender(
    <ClipsView
      store={f.store}
      accountId={accountId}
      holdSearchOrigin
      openClip={clipRequest("b")}
    />,
  );
  await screen.findByRole("heading", { name: "Archived B" });
  v.rerender(
    <ClipsView store={f.store} accountId={accountId} restoreSearchOrigin={1} />,
  );
  await screen.findByRole("heading", { name: "Current A" });
});
function study() {
  const at = new Date("2026-01-01T12:00:00Z");
  let state = createDeck(emptyStudy("UTC"), "Actual deck", at);
  const entry: StudyEntry = {
    id: crypto.randomUUID(),
    deckId: state.decks[0]!.id,
    type: "reversed",
    front: "Actual front",
    back: "Actual reverse question",
    tags: [],
    source: null,
    revision: 1,
  };
  state = saveEntry(state, entry, at);
  const value: CollectionsState = {
    version: 3,
    epoch,
    revision: 1,
    study: state,
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
  const store: CollectionsStore = {
    read: vi.fn(async () => {
      assertOpen();
      return structuredClone(value);
    }),
    update: vi.fn(),
    subscribe: (l) => {
      assertOpen();
      listeners.add(l);
      return () => {
        listeners.delete(l);
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
  const card = state.cards.find((c) => c.key === "reversed:reverse")!;
  const request: CardSearchOpenRequest = {
    requestId: "reverse",
    target: {
      kind: "card",
      accountId,
      collectionsEpoch: epoch,
      entryId: entry.id,
      cardId: card.id,
      key: card.key,
    },
  };
  return { store, value, request };
}
it("opens the exact Reversed direction as read-only and never grades or edits", async () => {
  const f = study(),
    ack = vi.fn();
  render(
    <StudyView
      store={f.store}
      accountId={accountId}
      openCard={f.request}
      onSearchReaderResult={ack}
    />,
  );
  const dialog = await screen.findByRole("dialog", { name: "Card" });
  await within(dialog).findByText("Actual reverse question");
  expect(dialog).toHaveTextContent("Reversed · reverse · Read-only");
  fireEvent.click(within(dialog).getByRole("button", { name: "Show answer" }));
  await within(dialog).findByText("Actual front");
  expect(ack).toHaveBeenCalledWith("reverse", "opened");
  expect(f.store.update).not.toHaveBeenCalled();
  expect(
    within(dialog).queryByRole("button", {
      name: /Again|Hard|Good|Easy|Save card/,
    }),
  ).not.toBeInTheDocument();
});
it("rejects a real card ID paired with the wrong direction instead of falling through to the first card", async () => {
  const f = study(),
    ack = vi.fn();
  render(
    <StudyView
      store={f.store}
      accountId={accountId}
      openCard={{
        ...f.request,
        target: { ...f.request.target, key: "reversed:forward" },
      }}
      onSearchReaderResult={ack}
    />,
  );
  await waitFor(() =>
    expect(ack).toHaveBeenCalledWith("reverse", "unavailable"),
  );
  expect(
    screen.queryByRole("dialog", { name: "Card" }),
  ).not.toBeInTheDocument();
  expect(f.store.update).not.toHaveBeenCalled();
});
it("pages all large card text within16k DOM chunks and retains independent question/answer positions", async () => {
  const input = {
    type: "basic" as const,
    key: "basic:forward" as const,
    front: "Q".repeat(40000),
    back: "A".repeat(33000),
  };
  const v = render(
    <CardSearchPreview
      input={input}
      deckTitle="Actual deck"
      isCurrent={() => true}
      scopeVersion={1}
      onClose={vi.fn()}
      onBack={vi.fn()}
    />,
  );
  const dialog = await screen.findByRole("dialog", { name: "Card" });
  await waitFor(() =>
    expect(dialog.querySelector("pre")?.textContent?.length).toBe(16384),
  );
  fireEvent.click(within(dialog).getByRole("button", { name: "Next" }));
  await waitFor(() => expect(dialog).toHaveTextContent("16385–32768"));
  fireEvent.click(within(dialog).getByRole("button", { name: "Show answer" }));
  await waitFor(() =>
    expect(dialog.querySelector("pre")?.textContent?.startsWith("A")).toBe(
      true,
    ),
  );
  fireEvent.click(within(dialog).getByRole("button", { name: "Hide answer" }));
  expect(dialog).toHaveTextContent("16385–32768");
  v.rerender(
    <CardSearchPreview
      input={input}
      deckTitle="Actual deck"
      isCurrent={() => false}
      scopeVersion={2}
      onClose={vi.fn()}
      onBack={vi.fn()}
    />,
  );
  expect(dialog.querySelector("pre")).toBeNull();
  expect(dialog).toHaveTextContent(
    "This card changed or is no longer available.",
  );
  await act(async () => {});
});

it("admits replacement card-content work after StrictMode effect cleanup without a stuck loading latch", async () => {
  render(
    <StrictMode>
      <CardSearchPreview
        input={{
          type: "basic",
          key: "basic:forward",
          front: "Strict question",
          back: "Strict answer",
        }}
        deckTitle="Actual deck"
        isCurrent={() => true}
        scopeVersion={1}
        onClose={vi.fn()}
        onBack={vi.fn()}
      />
    </StrictMode>,
  );
  const dialog = await screen.findByRole("dialog", { name: "Card" });
  await within(dialog).findByText("Strict question");
  expect(
    within(dialog).queryByText("Loading card content…"),
  ).not.toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole("button", { name: "Show answer" }));
  await within(dialog).findByText("Strict answer");
});

it("suppresses a late Clip reader acknowledgment after a newer exact selection", async () => {
  const f = clips(),
    ack = vi.fn();
  const v = render(
    <ClipsView
      store={f.store}
      accountId={accountId}
      onSearchReaderResult={ack}
    />,
  );
  await screen.findByRole("heading", { name: "Clips" });
  let resolve!: (value: ClipSnapshot) => void;
  const pending = new Promise<ClipSnapshot>((yes) => {
    resolve = yes;
  });
  vi.mocked(f.store.read).mockReturnValueOnce(pending);
  v.rerender(
    <ClipsView
      store={f.store}
      accountId={accountId}
      openClip={clipRequest("a", "held-A")}
      onSearchReaderResult={ack}
    />,
  );
  await waitFor(() => expect(f.store.read).toHaveBeenCalledTimes(2));
  v.rerender(
    <ClipsView
      store={f.store}
      accountId={accountId}
      openClip={clipRequest("b", "new-B")}
      onSearchReaderResult={ack}
    />,
  );
  await screen.findByRole("heading", { name: "Archived B" });
  await act(async () => resolve(structuredClone(f.value)));
  expect(ack).toHaveBeenCalledWith("new-B", "opened");
  expect(ack).not.toHaveBeenCalledWith("held-A", "opened");
  expect(screen.getByRole("heading", { name: "Archived B" })).toBeVisible();
});

it.each(["owner-close", "account-lock"] as const)(
  "removes an open exact-direction preview in the same %s observer turn",
  async (reason) => {
    const f = study();
    render(
      <StudyView store={f.store} accountId={accountId} openCard={f.request} />,
    );
    const dialog = await screen.findByRole("dialog", { name: "Card" });
    await within(dialog).findByText("Actual reverse question");
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Show answer" }),
    );
    await within(dialog).findByText("Actual front");
    act(() => {
      if (reason === "owner-close") f.store.close();
      else lock(false);
      // Same callback, not waitFor/eventual React teardown.
      expect(
        screen.queryByRole("dialog", { name: "Card" }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByText("Actual reverse question"),
      ).not.toBeInTheDocument();
      expect(screen.queryByText("Actual front")).not.toBeInTheDocument();
    });
    await act(async () => {});
    expect(screen.getByText("Study is no longer available.")).toBeVisible();
    expect(f.store.update).not.toHaveBeenCalled();
  },
);
