import { StrictMode } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useStudyToastLifetime } from "../../src/ui/useStudyToastLifetime";

// Presentation clock only. These tests do not qualify review persistence or native input.
let hidden = false;
beforeEach(() => {
  vi.useFakeTimers();
  hidden = false;
  vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
function Probe({
  id,
  covered = false,
  expire,
}: {
  id: string | null;
  covered?: boolean;
  expire: (id: string) => void;
}) {
  const interactions = useStudyToastLifetime(id, expire, covered);
  return (
    <div data-testid="toast" {...interactions}>
      <button>Undo</button>
      <button>Other toast action</button>
    </div>
  );
}
function advance(ms: number) {
  act(() => vi.advanceTimersByTime(ms));
}
function visibility(value: boolean) {
  hidden = value;
  fireEvent(document, new Event("visibilitychange"));
}

it("expires once after exactly five seconds of unpaused presentation time", () => {
  const expire = vi.fn();
  const view = render(<Probe id="first" expire={expire} />);
  advance(4999);
  expect(expire).not.toHaveBeenCalled();
  advance(1);
  expect(expire).toHaveBeenCalledExactlyOnceWith("first");
  view.rerender(<Probe id="first" expire={expire} />);
  advance(10000);
  expect(expire).toHaveBeenCalledTimes(1);
});

it("pointer leave cannot resume expiry while keyboard focus remains in the toast", () => {
  const expire = vi.fn();
  render(<Probe id="first" expire={expire} />);
  advance(1000);
  const toast = screen.getByTestId("toast"),
    undo = screen.getByRole("button", { name: "Undo" });
  fireEvent.mouseEnter(toast);
  fireEvent.focus(undo);
  fireEvent.mouseLeave(toast);
  advance(9000);
  expect(expire).not.toHaveBeenCalled();
  fireEvent.blur(undo, { relatedTarget: document.body });
  advance(3999);
  expect(expire).not.toHaveBeenCalled();
  advance(1);
  expect(expire).toHaveBeenCalledExactlyOnceWith("first");
});

it("focus movement between descendants stays paused, and blur cannot override hover", () => {
  const expire = vi.fn();
  render(<Probe id="first" expire={expire} />);
  const toast = screen.getByTestId("toast"),
    undo = screen.getByRole("button", { name: "Undo" }),
    other = screen.getByRole("button", { name: "Other toast action" });
  fireEvent.focus(undo);
  fireEvent.blur(undo, { relatedTarget: other });
  fireEvent.focus(other, { relatedTarget: undo });
  advance(7000);
  expect(expire).not.toHaveBeenCalled();
  fireEvent.mouseEnter(toast);
  fireEvent.blur(other, { relatedTarget: document.body });
  advance(7000);
  expect(expire).not.toHaveBeenCalled();
  fireEvent.mouseLeave(toast);
  advance(5000);
  expect(expire).toHaveBeenCalledExactlyOnceWith("first");
});

it("covered and document-hidden pauses overlap without resetting the remaining time", () => {
  const expire = vi.fn();
  const view = render(<Probe id="first" expire={expire} />);
  advance(2000);
  view.rerender(<Probe id="first" covered expire={expire} />);
  visibility(true);
  advance(9000);
  view.rerender(<Probe id="first" expire={expire} />);
  advance(9000);
  expect(expire).not.toHaveBeenCalled();
  visibility(false);
  advance(2999);
  expect(expire).not.toHaveBeenCalled();
  advance(1);
  expect(expire).toHaveBeenCalledExactlyOnceWith("first");
});

it("a new confirmed event replaces the old deadline but retains actual pause reasons", () => {
  const expire = vi.fn();
  const view = render(<Probe id="first" expire={expire} />);
  advance(4000);
  fireEvent.focus(screen.getByRole("button", { name: "Undo" }));
  view.rerender(<Probe id="second" expire={expire} />);
  advance(9000);
  expect(expire).not.toHaveBeenCalled();
  fireEvent.blur(screen.getByRole("button", { name: "Undo" }), {
    relatedTarget: document.body,
  });
  advance(4999);
  expect(expire).not.toHaveBeenCalled();
  advance(1);
  expect(expire).toHaveBeenCalledExactlyOnceWith("second");
});

it("null event and unmount retire pending callbacks, including after a prior pause", () => {
  const expire = vi.fn();
  const view = render(<Probe id="first" expire={expire} />);
  fireEvent.mouseEnter(screen.getByTestId("toast"));
  view.rerender(<Probe id={null} expire={expire} />);
  advance(9000);
  expect(expire).not.toHaveBeenCalled();
  view.rerender(<Probe id="second" expire={expire} />);
  advance(4999);
  expect(expire).not.toHaveBeenCalled();
  view.unmount();
  advance(9000);
  expect(expire).not.toHaveBeenCalled();
});

it("uses monotonic elapsed time when the wall clock changes", () => {
  const expire = vi.fn();
  render(<Probe id="first" expire={expire} />);
  advance(2000);
  vi.setSystemTime(Date.now() + 86_400_000);
  fireEvent.mouseEnter(screen.getByTestId("toast"));
  advance(7000);
  fireEvent.mouseLeave(screen.getByTestId("toast"));
  advance(2999);
  expect(expire).not.toHaveBeenCalled();
  advance(1);
  expect(expire).toHaveBeenCalledExactlyOnceWith("first");
});

it("StrictMode setup/cleanup does not duplicate or cancel the current event deadline", () => {
  const expire = vi.fn();
  render(
    <StrictMode>
      <Probe id="first" expire={expire} />
    </StrictMode>,
  );
  advance(5000);
  expect(expire).toHaveBeenCalledExactlyOnceWith("first");
});
