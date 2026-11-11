import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { SearchView, type SearchViewProps } from "../../src/ui/SearchView";
import type {
  SearchCursor,
  SearchHandle,
  SearchState,
  SearchHit,
} from "../../src/search/results";

// Explicit boundary fixtures; these are not a production search service or encrypted feature proof.
const handle = Object.freeze({}) as SearchHandle;
const cursor = Object.freeze({}) as SearchCursor;
const hit: SearchHit = {
  locator: {
    kind: "note",
    accountId: "private-account",
    libraryEpoch: "private-epoch",
    noteId: "private-note",
  },
  entityRevision: 1,
  primary: {
    text: "<script>Lisbon 😀</script>",
    matches: [{ from: 8, to: 14 }],
    before: false,
    after: false,
  },
  secondary: [
    {
      text: "Actual original match",
      matches: [{ from: 16, to: 21 }],
      before: true,
      after: true,
    },
  ],
};
function ready(
  overrides: Partial<Extract<SearchState, { status: "ready" }>> = {},
): Extract<SearchState, { status: "ready" }> {
  return {
    status: "ready",
    raw: "lisbon",
    handle,
    versions: {
      accountId: "account",
      library: { epoch: "library", revision: 1 },
      collections: { epoch: "collections", revision: 1 },
    },
    counts: { all: 1, notes: 1, clips: 0, cards: 0 },
    groups: [
      { kind: "note", items: [hit], offset: 0, previous: null, next: null },
      { kind: "clip", items: [], offset: 0, previous: null, next: null },
      { kind: "card", items: [], offset: 0, previous: null, next: null },
    ],
    page: null,
    ...overrides,
  };
}
function props(state: SearchState = ready()): SearchViewProps {
  return {
    state,
    query: "lisbon",
    tab: "all",
    onQueryChange: vi.fn(),
    onSubmit: vi.fn(),
    onTabChange: vi.fn(),
    onClear: vi.fn(),
    onOpen: vi.fn(),
    onPage: vi.fn(),
    onContinue: vi.fn(),
    onCancelPage: vi.fn(),
    onCancel: vi.fn(),
  };
}
it("renders exact grouped counts and escaped original marks; only exact locator is sent to navigation", () => {
  const p = props();
  const view = render(<SearchView {...p} />);
  expect(screen.getByText("1 result for “lisbon”")).toBeVisible();
  const group = screen.getByRole("region", { name: "Notes results" });
  expect(group.querySelector("mark")).toHaveTextContent("Lisbon");
  expect(view.container.querySelector("script")).toBeNull();
  expect(view.container.innerHTML).not.toContain("private-account");
  expect(view.container.innerHTML).not.toContain("private-note");
  fireEvent.click(within(group).getByRole("button"));
  expect(p.onOpen).toHaveBeenCalledWith(hit.locator);
  expect(
    screen.getByText("Notes, clips and cards. Journal stays private."),
  ).toBeVisible();
  expect(
    within(
      screen.getByRole("group", { name: "Search categories" }),
    ).getAllByRole("button"),
  ).toHaveLength(4);
});
it("never presents pending, budget pause, changed or error as a zero-result certificate", () => {
  const p = props({ status: "pending", raw: "lisbon", progress: null });
  const v = render(<SearchView {...p} />);
  expect(
    screen.getByText("Searching local notes, clips and cards…"),
  ).toBeVisible();
  expect(
    screen.queryByText(/0 results|No results for/),
  ).not.toBeInTheDocument();
  v.rerender(
    <SearchView
      {...p}
      state={{ status: "paused-limit", raw: "lisbon", handle, progress: null }}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  expect(p.onContinue).toHaveBeenCalledWith(handle);
  expect(
    screen.queryByText(/0 results|No results for/),
  ).not.toBeInTheDocument();
  v.rerender(
    <SearchView {...p} state={{ status: "changed", raw: "lisbon" }} />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Search again" }));
  expect(p.onSubmit).toHaveBeenCalledWith("lisbon");
  v.rerender(
    <SearchView
      {...p}
      state={{ status: "error", raw: "lisbon", code: "source-unavailable" }}
    />,
  );
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Couldn’t search your local data.",
  );
  expect(
    screen.queryByText(/0 results|No results for/),
  ).not.toBeInTheDocument();
});
it("shows the exact empty frame only for a complete zero result with one clear action", () => {
  const p = props(
    ready({ counts: { all: 0, notes: 0, clips: 0, cards: 0 }, groups: [] }),
  );
  render(<SearchView {...p} />);
  expect(
    screen.getByRole("heading", { name: "No results for “lisbon”" }),
  ).toBeVisible();
  expect(
    screen.getByText("Nothing in your notes, clips or cards. Try fewer words."),
  ).toBeVisible();
  expect(screen.getByRole("button", { name: "All 0" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
  expect(p.onClear).toHaveBeenCalledOnce();
});
it("preserves raw input and suppresses submit during IME composition; Escape clears then returns explicitly", () => {
  const p = props({ status: "error", raw: "lisbon", code: "query-too-long" });
  const v = render(<SearchView {...p} />);
  const input = screen.getByRole("textbox", {
    name: "Search notes, clips and cards",
  });
  fireEvent.compositionStart(input);
  fireEvent.change(input, { target: { value: "unfinished 漢" } });
  fireEvent.submit(input.closest("form")!);
  expect(p.onQueryChange).toHaveBeenCalledWith("unfinished 漢");
  expect(p.onSubmit).not.toHaveBeenCalled();
  fireEvent.compositionEnd(input);
  fireEvent.submit(input.closest("form")!);
  expect(p.onSubmit).toHaveBeenCalledWith("lisbon");
  fireEvent.keyDown(input, { key: "Escape" });
  expect(p.onCancel).toHaveBeenCalledOnce();
  expect(p.onQueryChange).toHaveBeenLastCalledWith("");
  expect(p.onClear).not.toHaveBeenCalled();
  v.rerender(<SearchView {...p} query="" />);
  fireEvent.keyDown(input, { key: "Escape" });
  expect(p.onClear).toHaveBeenCalledOnce();
});
it("retains exact totals and previous complete rows through page pending/pause/error and uses opaque cursors", () => {
  const state = ready({
    counts: { all: 120, notes: 120, clips: 0, cards: 0 },
    groups: [
      {
        kind: "note",
        items: [hit],
        offset: 50,
        previous: cursor,
        next: cursor,
      },
    ],
  });
  const p = props(state),
    v = render(<SearchView {...p} />);
  fireEvent.click(screen.getByRole("button", { name: "Next Notes results" }));
  expect(p.onPage).toHaveBeenCalledWith(cursor);
  expect(screen.getByText("Notes 51–51 of 120")).toBeVisible();
  for (const status of ["pending", "paused", "error"] as const) {
    v.rerender(
      <SearchView
        {...p}
        state={{
          ...state,
          page:
            status === "pending"
              ? { status, kind: "note" }
              : { status, kind: "note", handle },
        }}
      />,
    );
    expect(screen.getByText("120 results for “lisbon”")).toBeVisible();
    expect(
      screen.getByRole("button", { name: /<script>Lisbon/ }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Next Notes results" }),
    ).toBeDisabled();
    if (status !== "pending")
      fireEvent.click(
        screen.getByRole("button", {
          name: status === "paused" ? "Continue" : "Retry",
        }),
      );
  }
  expect(p.onContinue).toHaveBeenCalledTimes(2);
  fireEvent.click(screen.getByRole("button", { name: "Cancel page" }));
  expect(p.onCancelPage).toHaveBeenCalledOnce();
});
it("renders actual clip/card provenance and filters only the selected result group without changing totals", () => {
  const clip: SearchHit = {
    ...hit,
    locator: {
      kind: "clip",
      accountId: "account",
      collectionsEpoch: "epoch",
      clipId: "clip",
    },
    archived: true,
    clipContent: "link-only",
  };
  const card: SearchHit = {
    ...hit,
    locator: {
      kind: "card",
      accountId: "account",
      collectionsEpoch: "epoch",
      entryId: "entry",
      cardId: "reversed-back",
      key: "reversed:reverse",
    },
    deckTitle: "Actual deck",
  };
  const p = props(
    ready({
      counts: { all: 4, notes: 1, clips: 1, cards: 2 },
      groups: [
        { kind: "clip", items: [clip], offset: 0, previous: null, next: null },
        { kind: "card", items: [card], offset: 0, previous: null, next: null },
      ],
    }),
  );
  const v = render(<SearchView {...p} tab="clip" />);
  expect(screen.getByText("Archived · Link only")).toBeVisible();
  expect(
    screen.queryByRole("region", { name: "Cards results" }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Cards 2" }));
  expect(p.onTabChange).toHaveBeenCalledWith("card");
  v.rerender(<SearchView {...p} tab="card" />);
  fireEvent.click(
    within(screen.getByRole("region", { name: "Cards results" })).getByRole(
      "button",
    ),
  );
  expect(p.onOpen).toHaveBeenCalledWith(card.locator);
  expect(screen.getByText("Deck: Actual deck")).toBeVisible();
});
it("keeps blocked/unavailable navigation truthful without automatic retry and disables duplicate opening", () => {
  const p = props(),
    v = render(<SearchView {...p} navigationState="blocked" />);
  expect(screen.getByRole("status")).toHaveTextContent(
    "Finish or discard your unsaved changes",
  );
  expect(p.onOpen).not.toHaveBeenCalled();
  v.rerender(<SearchView {...p} navigationState="unavailable" />);
  expect(screen.getByRole("status")).toHaveTextContent(
    "This item is no longer available.",
  );
  expect(p.onOpen).not.toHaveBeenCalled();
  v.rerender(<SearchView {...p} navigationState="opening" />);
  expect(
    within(screen.getByRole("region", { name: "Notes results" })).getByRole(
      "button",
    ),
  ).toBeDisabled();
});
it("scopes category arrow/Home/End focus and selection while leaving input arrows alone", () => {
  const p = props();
  render(<SearchView {...p} />);
  const input = screen.getByRole("textbox", {
    name: "Search notes, clips and cards",
  });
  fireEvent.keyDown(input, { key: "ArrowRight" });
  expect(p.onTabChange).not.toHaveBeenCalled();
  const all = screen.getByRole("button", { name: "All 1" });
  all.focus();
  fireEvent.keyDown(all, { key: "ArrowRight" });
  expect(screen.getByRole("button", { name: "Notes 1" })).toHaveFocus();
  expect(p.onTabChange).toHaveBeenLastCalledWith("note");
  fireEvent.keyDown(document.activeElement!, { key: "End" });
  expect(screen.getByRole("button", { name: "Cards 0" })).toHaveFocus();
  expect(p.onTabChange).toHaveBeenLastCalledWith("card");
  fireEvent.keyDown(document.activeElement!, { key: "Home" });
  expect(all).toHaveFocus();
});
it("renders blank-query guidance without fake zero counts and clips malformed highlight ranges safely", () => {
  const p = props({ status: "idle", raw: "" });
  const v = render(<SearchView {...p} query="" />);
  expect(
    screen.getByRole("heading", {
      name: "Search your notes, clips and cards.",
    }),
  ).toBeVisible();
  expect(
    screen.queryByText(/0 results|No results for/),
  ).not.toBeInTheDocument();
  v.rerender(
    <SearchView
      {...p}
      state={ready({
        groups: [
          {
            kind: "note",
            items: [
              {
                ...hit,
                primary: {
                  text: "A😀B",
                  matches: [
                    { from: 2, to: 3 },
                    { from: 999, to: 2000 },
                  ],
                  before: false,
                  after: false,
                },
              },
            ],
            offset: 0,
            previous: null,
            next: null,
          },
        ],
      })}
    />,
  );
  const group = screen.getByRole("region", { name: "Notes results" });
  expect(group.querySelector("mark")).toHaveTextContent("😀");
  expect(within(group).getByRole("button")).toHaveTextContent("A😀B");
});

it("keeps paging focus on the stable current-group range, never stealing focus after the user moves", () => {
  const state = ready({
    counts: { all: 120, notes: 120, clips: 0, cards: 0 },
    groups: [
      { kind: "note", items: [hit], offset: 0, previous: null, next: cursor },
    ],
  });
  const p = props(state),
    v = render(<SearchView {...p} />);
  const next = screen.getByRole("button", { name: "Next Notes results" });
  next.focus();
  fireEvent.click(next);
  const range = screen.getByText("Notes 1–1 of 120");
  expect(range).toHaveFocus();
  v.rerender(
    <SearchView
      {...p}
      state={{ ...state, page: { status: "pending", kind: "note" } }}
    />,
  );
  expect(range).toHaveFocus();
  v.rerender(
    <SearchView
      {...p}
      state={{
        ...state,
        groups: [
          {
            kind: "note",
            items: [hit],
            offset: 50,
            previous: cursor,
            next: null,
          },
        ],
      }}
    />,
  );
  expect(screen.getByText("Notes 51–51 of 120")).toHaveFocus();
  const input = screen.getByRole("textbox", {
    name: "Search notes, clips and cards",
  });
  input.focus();
  v.rerender(
    <SearchView
      {...p}
      state={{ ...state, page: { status: "error", kind: "note", handle } }}
    />,
  );
  expect(input).toHaveFocus();
});
