import { useLayoutEffect } from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Workspace } from "../../src/ui/Workspace";
import { registerCloseGuard } from "../../src/desktop/closeGuard";
import {
  useRouteHeading,
  type HeadingPresentation,
  type HeadingRoute,
} from "../../src/ui/routeHeadingMotion";
import type { Note, NotesStore } from "../../src/domain/contracts";

vi.mock("../../src/ui/CollectionsHost", () => ({
  CollectionsHost: ({
    view,
    heading,
  }: {
    view: HeadingRoute;
    heading?: HeadingPresentation;
  }) => {
    const ref = useRouteHeading(heading, view, "target");
    useLayoutEffect(() => {
      heading?.controller.admit(view);
    }, [heading?.controller, view]);
    return <h1 ref={ref}>{view === "study" ? "Study" : view}</h1>;
  },
}));
const note: Note = {
  id: "synthetic-note",
  title: "Synthetic note",
  tags: ["Topic"],
  revision: 1,
  document: { type: "doc", content: [{ type: "paragraph" }] },
  createdAt: "2026-11-01T00:00:00Z",
  updatedAt: "2026-11-01T00:00:00Z",
  trashedAt: null,
};
beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function fixture() {
  const subscribers = new Set<() => void>();
  const unsupported = vi.fn(async () => {
    throw new Error("Unexpected write");
  });
  const store: NotesStore = {
    list: vi.fn(async () => [note]),
    get: async () => note,
    create: unsupported,
    update: unsupported,
    trash: unsupported,
    restore: unsupported,
    erase: unsupported,
    subscribe: (callback) => {
      subscribers.add(callback);
      return () => {
        subscribers.delete(callback);
      };
    },
    persistence: () => ({ status: "ready" }),
    close: vi.fn(),
  };
  const props = {
    store,
    session: {
      accountId: "synthetic-heading",
      deviceId: "synthetic-heading",
      email: "heading@example.test",
      deviceState: "trusted" as const,
    },
    onSignOut: async () => {},
  };
  return {
    ...render(<Workspace {...props} />),
    props,
    store,
    subscribers,
    unsupported,
  };
}
function nav() {
  return within(
    screen.getByRole("complementary", { name: "Notes navigation" }),
  );
}
it("pulses the same current heading only after a changed admitted filter, not same-row or data refresh", async () => {
  const { subscribers, unsupported } = fixture();
  const title = await screen.findByRole("heading", { name: "All notes" });
  expect(title).not.toHaveAttribute("data-route-heading-motion");
  fireEvent.click(nav().getByRole("button", { name: /^Trash/ }));
  expect(screen.getByRole("heading", { name: "Trash" })).toBe(title);
  expect(title).toHaveAttribute("data-route-heading-motion", "enter");
  const marker = title.getAttributeNode("data-route-heading-motion");
  fireEvent.click(nav().getByRole("button", { name: /^Trash/ }));
  expect(title.getAttributeNode("data-route-heading-motion")).toBe(marker);
  await act(async () => {
    subscribers.forEach((callback) => callback());
  });
  expect(title.getAttributeNode("data-route-heading-motion")).toBe(marker);
  fireEvent.click(nav().getByRole("button", { name: /Topic, 1 note/ }));
  expect(screen.getByRole("heading", { name: "# Topic" })).toBe(title);
  expect(title.getAttributeNode("data-route-heading-motion")).not.toBe(marker);
  expect(
    screen.queryByRole("heading", { name: "Trash" }),
  ).not.toBeInTheDocument();
  expect(unsupported).not.toHaveBeenCalled();
});
it("a refused route action leaves the actual heading and its pulse unchanged", async () => {
  fixture();
  const title = await screen.findByRole("heading", { name: "All notes" });
  const stop = registerCloseGuard(() => false);
  try {
    fireEvent.click(nav().getByRole("button", { name: "Study" }));
    expect(screen.getByRole("heading", { name: "All notes" })).toBe(title);
    expect(title).not.toHaveAttribute("data-route-heading-motion");
    expect(
      screen.queryByRole("heading", { name: "Study" }),
    ).not.toBeInTheDocument();
  } finally {
    stop();
  }
  fireEvent.click(nav().getByRole("button", { name: "Study" }));
  expect(await screen.findByRole("heading", { name: "Study" })).toHaveAttribute(
    "data-route-heading-motion",
    "enter",
  );
});
it("replacing the store retires the effect before a pending new read can admit anything", async () => {
  const { rerender, props, unsupported } = fixture();
  const title = await screen.findByRole("heading", { name: "All notes" });
  fireEvent.click(nav().getByRole("button", { name: /^Trash/ }));
  expect(title).toHaveAttribute("data-route-heading-motion");
  let finish!: (notes: Note[]) => void;
  const next = {
    ...props.store,
    list: () =>
      new Promise<Note[]>((resolve) => {
        finish = resolve;
      }),
  };
  rerender(<Workspace {...props} store={next} />);
  expect(title).not.toHaveAttribute("data-route-heading-motion");
  fireEvent.animationEnd(title, { animationName: "route-heading-in" });
  expect(title).not.toHaveAttribute("data-route-heading-motion");
  await act(async () => {
    finish([note]);
  });
  expect(title).not.toHaveAttribute("data-route-heading-motion");
  expect(unsupported).not.toHaveBeenCalled();
});
