import { render, screen, fireEvent } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { SearchSurface } from "../../src/ui/SearchSurface";

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
});

it("opens a modal and removes private results immediately on close or revoked authority", () => {
  const onClose = vi.fn();
  const view = render(<SearchSurface active privacyVersion={0} onClose={onClose}>Private result</SearchSurface>);
  expect(screen.getByRole("dialog", { name: "Search" })).toHaveAttribute("open");
  fireEvent(screen.getByRole("dialog", { name: "Search" }), new Event("cancel", { cancelable: true }));
  expect(onClose).toHaveBeenCalledOnce();
  view.rerender(<SearchSurface active={false} privacyVersion={0} onClose={onClose}>Private result</SearchSurface>);
  expect(screen.queryByText("Private result")).not.toBeInTheDocument();
  view.rerender(<SearchSurface active privacyVersion={0} onClose={onClose}>Private result</SearchSurface>);
  view.rerender(<SearchSurface active privacyVersion={1} onClose={onClose}>Private result</SearchSurface>);
  expect(screen.queryByText("Private result")).not.toBeInTheDocument();
});
