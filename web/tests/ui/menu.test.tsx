import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Menu } from "../../src/ui/Menu";

describe("action menu", () => {
  it.each([140, 150])("keeps the inert closing surface for its rendered %ims exit", (duration) => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const computed = vi.spyOn(window, "getComputedStyle").mockImplementation(() => {
      const style = document.createElement("div").style;
      style.animationDuration = `${duration}ms`; style.animationDelay = "0s";
      return style;
    });
    try {
      const { container } = render(<Menu label="Timed actions" actions={[{ label: "Run", onSelect: vi.fn() }]} />);
      fireEvent.click(screen.getByRole("button", { name: "Timed actions" }));
      fireEvent.keyDown(screen.getByRole("menuitem", { name: "Run" }), { key: "Escape" });
      expect(container.querySelector(".action-menu-closing")).toHaveAttribute("inert");
      act(() => vi.advanceTimersByTime(duration - 1));
      expect(container.querySelector(".action-menu-closing")).not.toBeNull();
      act(() => vi.advanceTimersByTime(1));
      expect(container.querySelector(".action-menu")).toBeNull();
    } finally { computed.mockRestore(); vi.useRealTimers(); }
  });
  it("navigates enabled items and dismisses with Escape or outside pointer", async () => {
    render(<><Menu label="Note menu" actions={[
      { label: "Rename", onSelect: vi.fn() },
      { label: "Disabled", disabled: true, onSelect: vi.fn() },
      { label: "Trash", onSelect: vi.fn() },
    ]} /><button>Outside</button></>);
    const trigger = screen.getByRole("button", { name: "Note menu" });
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    const rename = screen.getByRole("menuitem", { name: "Rename" });
    const trash = screen.getByRole("menuitem", { name: "Trash" });
    await waitFor(() => expect(rename).toHaveFocus());
    fireEvent.keyDown(rename, { key: "ArrowUp" });
    expect(trash).toHaveFocus();
    fireEvent.keyDown(trash, { key: "ArrowDown" });
    expect(rename).toHaveFocus();
    fireEvent.keyDown(rename, { key: "End" });
    expect(trash).toHaveFocus();
    fireEvent.keyDown(trash, { key: "Home" });
    expect(rename).toHaveFocus();
    fireEvent.keyDown(rename, { key: "Escape" });
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(trigger);
    fireEvent.pointerDown(screen.getByText("Outside"));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
  it("removes the menu before invoking an action", () => {
    const selected = vi.fn(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
    render(<Menu label="Actions" actions={[{ label: "Run", onSelect: selected }]} />);
    fireEvent.click(screen.getByRole("button", { name: "Actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Run" }));
    expect(selected).toHaveBeenCalledOnce();
  });
});
