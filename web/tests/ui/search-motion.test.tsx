import { StrictMode } from "react";
import { act, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SearchSurface } from "../../src/ui/SearchSurface";
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
it("keeps only current live children through an inert170ms ordinary exit, without deferring navigation", () => {
  vi.useFakeTimers();
  vi.spyOn(window, "getComputedStyle").mockReturnValue({
    animationDuration: "0.17s",
    animationDelay: "0s",
  } as CSSStyleDeclaration);
  const v = render(
    <SearchSurface active privacyVersion={0}>
      <p>Current actual query</p>
    </SearchSurface>,
  );
  expect(screen.getByText("Current actual query")).toBeVisible();
  v.rerender(
    <SearchSurface active={false} privacyVersion={0}>
      <p>Actual changed query</p>
    </SearchSurface>,
  );
  const node = screen.getByText("Actual changed query").parentElement!;
  expect(node).toHaveAttribute("inert");
  expect(node).toHaveAttribute("aria-hidden", "true");
  expect(node).toHaveAttribute("data-phase", "closing");
  expect(screen.queryByText("Current actual query")).not.toBeInTheDocument();
  act(() => vi.advanceTimersByTime(169));
  expect(screen.getByText("Actual changed query")).toBeInTheDocument();
  act(() => vi.advanceTimersByTime(1));
  expect(screen.queryByText("Actual changed query")).not.toBeInTheDocument();
});
it("uses the actual rendered150ms reduced exit and cancels it immediately on privacy revocation", () => {
  vi.useFakeTimers();
  vi.spyOn(window, "getComputedStyle").mockReturnValue({
    animationDuration: "0.15s",
    animationDelay: "0s",
  } as CSSStyleDeclaration);
  const v = render(
    <SearchSurface active privacyVersion={0}>
      Protected query
    </SearchSurface>,
  );
  v.rerender(
    <SearchSurface active={false} privacyVersion={0}>
      Protected query
    </SearchSurface>,
  );
  act(() => vi.advanceTimersByTime(149));
  expect(screen.getByText("Protected query")).toBeInTheDocument();
  act(() => vi.advanceTimersByTime(1));
  expect(screen.queryByText("Protected query")).not.toBeInTheDocument();
  v.rerender(
    <SearchSurface active privacyVersion={0}>
      New query
    </SearchSurface>,
  );
  v.rerender(
    <SearchSurface active={false} privacyVersion={0}>
      New query
    </SearchSurface>,
  );
  v.rerender(
    <SearchSurface active={false} privacyVersion={1}>
      New query
    </SearchSurface>,
  );
  expect(screen.queryByText("New query")).not.toBeInTheDocument();
  expect(vi.getTimerCount()).toBe(0);
});
it("fences a prior exit timer when the user reenters, including StrictMode effect replay", () => {
  vi.useFakeTimers();
  const v = render(
    <StrictMode>
      <SearchSurface active privacyVersion={0}>
        Actual query
      </SearchSurface>
    </StrictMode>,
  );
  v.rerender(
    <StrictMode>
      <SearchSurface active={false} privacyVersion={0}>
        Actual query
      </SearchSurface>
    </StrictMode>,
  );
  act(() => vi.advanceTimersByTime(50));
  v.rerender(
    <StrictMode>
      <SearchSurface active privacyVersion={0}>
        Actual query
      </SearchSurface>
    </StrictMode>,
  );
  act(() => vi.advanceTimersByTime(500));
  expect(
    screen.getByText("Actual query").closest(".workspace-search"),
  ).toHaveAttribute("data-phase", "open");
  expect(
    screen.getByText("Actual query").closest(".workspace-search"),
  ).not.toHaveAttribute("inert");
});
