import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { RichEditor } from "../../src/ui/RichEditor";

const menuHeight = 240;
const gap = 8;
let originalScrollHeight: PropertyDescriptor | undefined;

function caretRect(top: number) {
  return new DOMRect(20, top, 80, 16);
}

function visualViewport(bounds: {
  offsetLeft?: number;
  offsetTop?: number;
  width?: number;
  height?: number;
}) {
  const viewport = new EventTarget() as VisualViewport;
  Object.defineProperties(viewport, {
    offsetLeft: { value: bounds.offsetLeft ?? 0, configurable: true },
    offsetTop: { value: bounds.offsetTop ?? 0, configurable: true },
    width: { value: bounds.width ?? 390, configurable: true },
    height: { value: bounds.height ?? 480, configurable: true },
  });
  Object.defineProperty(window, "visualViewport", {
    value: viewport,
    configurable: true,
  });
  return viewport;
}

beforeEach(() => {
  window.scrollBy = vi.fn();
  Object.defineProperty(Range.prototype, "getClientRects", {
    configurable: true,
    value: () => [],
  });
  Object.defineProperty(Range.prototype, "getBoundingClientRect", {
    configurable: true,
    value: () => caretRect(440),
  });
  originalScrollHeight = Object.getOwnPropertyDescriptor(
    Element.prototype,
    "scrollHeight",
  );
  Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
    configurable: true,
    get(this: HTMLElement) {
      return this.classList.contains("slash-menu") ? menuHeight : 0;
    },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(window, "visualViewport", {
    value: undefined,
    configurable: true,
  });
  delete (HTMLElement.prototype as { scrollHeight?: unknown }).scrollHeight;
  if (originalScrollHeight)
    Object.defineProperty(
      Element.prototype,
      "scrollHeight",
      originalScrollHeight,
    );
});

async function openAt(top: number) {
  const rect = caretRect(top);
  const original = HTMLElement.prototype.getBoundingClientRect;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      return this.closest(".ProseMirror") ? rect : original.call(this);
    },
  );
  const change = vi.fn();
  render(
    <RichEditor
      document={{ type: "doc", content: [{ type: "paragraph" }] }}
      onChange={change}
    />,
  );
  const editor = await screen.findByRole("textbox", { name: "Note content" });
  const user = userEvent.setup({ skipClick: true });
  await act(async () => editor.focus());
  await user.type(editor, "/");
  return { editor, menu: screen.getByRole("listbox") };
}

function box(menu: HTMLElement) {
  return {
    left: parseFloat(menu.style.left),
    top: parseFloat(menu.style.top),
    maxHeight: parseFloat(menu.style.maxHeight),
  };
}

it("keeps the menu inside a keyboard-reduced visual viewport at the bottom edge", async () => {
  visualViewport({ width: 390, height: 480 });
  const { menu } = await openAt(440);
  const { left, top } = box(menu);
  expect(left).toBeGreaterThanOrEqual(gap);
  expect(left + Math.min(260, 390 - gap * 2)).toBeLessThanOrEqual(390 - gap);
  expect(top).toBeGreaterThanOrEqual(gap);
  expect(top + menuHeight).toBeLessThanOrEqual(480 - gap);
  expect(top).toBeLessThan(440);
});

it("respects a visual viewport offset by the on-screen keyboard", async () => {
  visualViewport({ offsetTop: 200, width: 390, height: 360 });
  const { menu } = await openAt(400);
  const { top } = box(menu);
  expect(top).toBeGreaterThanOrEqual(200 + gap);
  expect(top + menuHeight).toBeLessThanOrEqual(560 - gap);
});

it("repositions when the visual viewport shrinks", async () => {
  const viewport = visualViewport({ width: 390, height: 700 });
  const { menu } = await openAt(660);
  expect(box(menu).top + menuHeight).toBeLessThanOrEqual(700 - gap);
  Object.defineProperty(viewport, "height", {
    value: 480,
    configurable: true,
  });
  await act(async () => {
    viewport.dispatchEvent(new Event("resize"));
  });
  expect(box(menu).top + menuHeight).toBeLessThanOrEqual(480 - gap);
});

it("clamps the menu to a viewport shorter than the menu", async () => {
  visualViewport({ width: 390, height: 200 });
  const { menu } = await openAt(150);
  const { top, maxHeight } = box(menu);
  expect(top).toBeGreaterThanOrEqual(gap);
  expect(top + Math.min(menuHeight, maxHeight)).toBeLessThanOrEqual(200 - gap);
});
