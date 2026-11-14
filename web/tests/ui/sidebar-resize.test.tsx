import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SidebarResize } from "../../src/ui/SidebarResize";

function fixture(disabled = false) {
  const changed = vi.fn();
  function Controlled({ disabled }: { disabled: boolean }) {
    const [value, setValue] = useState(224);
    return (
      <SidebarResize
        value={value}
        disabled={disabled}
        onChange={(next) => {
          changed(next);
          setValue(next);
        }}
      />
    );
  }
  const view = render(<Controlled disabled={disabled} />);
  return { changed, view, Controlled };
}
function pointer(target: Element, type: string, x: number, id = 1, button = 0) {
  const event = new MouseEvent(type, { bubbles: true, clientX: x, button });
  Object.defineProperties(event, {
    pointerId: { value: id },
    isPrimary: { value: true },
  });
  fireEvent(target, event);
}
function capture(rail: HTMLElement) {
  const captured = new Set<number>();
  Object.assign(rail, {
    setPointerCapture: vi.fn((id: number) => captured.add(id)),
    releasePointerCapture: vi.fn((id: number) => captured.delete(id)),
    hasPointerCapture: (id: number) => captured.has(id),
  });
}
describe("sidebar resize", () => {
  it("exposes the vertical keyboard separator and its current bounded width", () => {
    fixture();
    const rail = screen.getByRole("separator", { name: "Resize sidebar" });
    expect(rail).toHaveAttribute("aria-orientation", "vertical");
    expect(rail).toHaveAttribute("aria-controls", "notes-sidebar");
    expect(rail).toHaveAttribute("aria-valuemin", "180");
    expect(rail).toHaveAttribute("aria-valuemax", "420");
    expect(rail).toHaveAttribute("aria-valuenow", "224");
    expect(rail).toHaveAttribute("tabindex", "0");
  });
  it("steps by sixteen, clamps both ends, and resets with Enter", () => {
    fixture();
    const rail = screen.getByRole("separator");
    fireEvent.keyDown(rail, { key: "ArrowRight" });
    expect(rail).toHaveAttribute("aria-valuenow", "240");
    for (let i = 0; i < 30; i++) fireEvent.keyDown(rail, { key: "ArrowRight" });
    expect(rail).toHaveAttribute("aria-valuenow", "420");
    for (let i = 0; i < 30; i++) fireEvent.keyDown(rail, { key: "ArrowLeft" });
    expect(rail).toHaveAttribute("aria-valuenow", "180");
    fireEvent.keyDown(rail, { key: "Enter" });
    expect(rail).toHaveAttribute("aria-valuenow", "224");
  });
  it("leaves unrelated keyboard commands alone", () => {
    const { changed } = fixture();
    const event = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "ArrowDown",
    });
    fireEvent(screen.getByRole("separator"), event);
    expect(changed).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });
  it("updates continuously for its captured pointer and resets on double click", () => {
    fixture();
    const rail = screen.getByRole("separator");
    capture(rail);
    pointer(rail, "pointerdown", 224);
    pointer(rail, "pointermove", 300);
    expect(rail).toHaveAttribute("aria-valuenow", "300");
    pointer(rail, "pointermove", 1000);
    expect(rail).toHaveAttribute("aria-valuenow", "420");
    pointer(rail, "pointerup", 1000);
    pointer(rail, "pointermove", 180);
    expect(rail).toHaveAttribute("aria-valuenow", "420");
    fireEvent.doubleClick(rail);
    expect(rail).toHaveAttribute("aria-valuenow", "224");
  });
  it("ignores secondary buttons and other pointer identities", () => {
    const { changed } = fixture();
    const rail = screen.getByRole("separator");
    capture(rail);
    pointer(rail, "pointerdown", 224, 1, 2);
    pointer(rail, "pointermove", 300);
    expect(changed).not.toHaveBeenCalled();
    pointer(rail, "pointerdown", 224, 1);
    pointer(rail, "pointermove", 350, 2);
    pointer(rail, "pointerup", 350, 2);
    expect(changed).not.toHaveBeenCalled();
    pointer(rail, "pointermove", 280, 1);
    expect(rail).toHaveAttribute("aria-valuenow", "280");
  });
  it.each(["pointercancel", "lostpointercapture"])(
    "retires a gesture on %s",
    (type) => {
      fixture();
      const rail = screen.getByRole("separator");
      capture(rail);
      pointer(rail, "pointerdown", 224);
      pointer(rail, "pointermove", 280);
      pointer(rail, type, 280);
      pointer(rail, "pointermove", 350);
      expect(rail).toHaveAttribute("aria-valuenow", "280");
    },
  );
  it("removes the rail and retires a captured gesture when disabled", () => {
    const { view, Controlled, changed } = fixture();
    const rail = screen.getByRole("separator");
    capture(rail);
    pointer(rail, "pointerdown", 224);
    view.rerender(<Controlled disabled />);
    expect(screen.queryByRole("separator")).not.toBeInTheDocument();
    pointer(rail, "pointermove", 300);
    expect(changed).not.toHaveBeenCalled();
    expect(rail.releasePointerCapture).toHaveBeenCalledWith(1);
  });
  it("releases capture on unmount and admits no late pointer update", () => {
    const { view, changed } = fixture();
    const rail = screen.getByRole("separator");
    capture(rail);
    pointer(rail, "pointerdown", 224);
    view.unmount();
    expect(rail.releasePointerCapture).toHaveBeenCalledWith(1);
    pointer(rail, "pointermove", 300);
    expect(changed).not.toHaveBeenCalled();
  });
  it("retires capture when the window loses focus", () => {
    const { changed } = fixture();
    const rail = screen.getByRole("separator");
    capture(rail);
    pointer(rail, "pointerdown", 224);
    fireEvent.blur(window);
    pointer(rail, "pointermove", 300);
    expect(changed).not.toHaveBeenCalled();
    expect(rail.releasePointerCapture).toHaveBeenCalledWith(1);
  });
});
