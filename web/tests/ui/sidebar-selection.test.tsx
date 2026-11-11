import { act, render, screen } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SidebarSelection,
  useSidebarSelection,
  type SidebarSelectionController,
  type SidebarSelectionKey,
} from "../../src/ui/SidebarSelection";

let controller: SidebarSelectionController;
let observerCallbacks: ResizeObserverCallback[];
let observers: {
  observe: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
}[];

function Harness({
  active = "one",
  visible = true,
  layout = 0,
  privacy = 0,
  first = true,
  tick = 0,
}: {
  active?: SidebarSelectionKey | null;
  visible?: boolean;
  layout?: number;
  privacy?: number;
  first?: boolean;
  tick?: number;
}) {
  controller = useSidebarSelection();
  return (
    <aside ref={controller.rootRef} data-testid="root" data-tick={tick}>
      <SidebarSelection
        controller={controller}
        activeKey={active}
        visible={visible}
        layoutVersion={layout}
        privacyRevision={privacy}
      />
      {first && (
        <button
          ref={controller.rowRef("one")}
          data-x="8"
          data-y="20"
          data-width="200"
          data-height="29"
        >
          One
        </button>
      )}
      <button
        ref={controller.rowRef("two")}
        data-x="8"
        data-y="50"
        data-width="200"
        data-height="29"
      >
        Two
      </button>
    </aside>
  );
}

beforeEach(() => {
  observerCallbacks = [];
  observers = [];
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe = vi.fn();
      disconnect = vi.fn();
      constructor(callback: ResizeObserverCallback) {
        observerCallbacks.push(callback);
        observers.push(this);
      }
    },
  );
  for (const [property, key] of [
    ["offsetLeft", "x"],
    ["offsetTop", "y"],
    ["offsetWidth", "width"],
    ["offsetHeight", "height"],
  ] as const) {
    vi.spyOn(HTMLElement.prototype, property, "get").mockImplementation(
      function (this: HTMLElement) {
        return Number(this.dataset[key] ?? 0);
      },
    );
  }
  vi.spyOn(HTMLElement.prototype, "offsetParent", "get").mockImplementation(
    function (this: HTMLElement) {
      return this.matches("button") ? this.parentElement : null;
    },
  );
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(224);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(800);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function layer() {
  return screen
    .getByTestId("root")
    .querySelector<HTMLElement>(".sidebar-selection-highlight")!;
}
function expectAt(y: number, animate: boolean) {
  expect(layer()).not.toHaveAttribute("hidden");
  expect(layer()).toHaveAttribute("aria-hidden", "true");
  expect(layer()).toHaveAttribute("data-animate", String(animate));
  expect(layer().style.transform).toBe(`translate(8px, ${y}px)`);
  expect(layer().style.width).toBe("200px");
  expect(layer().style.height).toBe("29px");
  expect(screen.getByTestId("root")).toHaveAttribute(
    "data-sidebar-selection-ready",
    "true",
  );
}

describe("sidebar selection presentation", () => {
  it("uses untransformed offset geometry and immediately places the first admitted row", () => {
    const rect = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(() => {
        throw new Error("scaled rect must not be used");
      });
    render(<Harness />);
    expectAt(20, false);
    expect(rect).not.toHaveBeenCalled();
  });
  it("animates only an admitted selection change with stable geometry", () => {
    const { rerender } = render(<Harness />);
    rerender(<Harness tick={1} />);
    expectAt(20, false);
    rerender(<Harness active="two" />);
    expectAt(50, true);
    rerender(<Harness active="one" />);
    expectAt(20, true);
  });
  it("settles without animation on layout version, moved geometry, resize and scroll", () => {
    const { rerender } = render(<Harness />);
    rerender(<Harness tick={1} />);
    rerender(<Harness active="two" layout={1} />);
    expectAt(50, false);
    const button = screen.getByRole("button", { name: "Two" });
    button.dataset.y = "75";
    act(() => observerCallbacks.at(-1)!([], {} as ResizeObserver));
    expectAt(75, false);
    button.dataset.y = "90";
    act(() => screen.getByTestId("root").dispatchEvent(new Event("scroll")));
    expectAt(90, false);
  });
  it("hides for invisible, absent, removed and invalid geometry; reappears without travel", () => {
    const { rerender } = render(<Harness />);
    rerender(<Harness visible={false} />);
    expect(layer()).toHaveAttribute("hidden");
    expect(screen.getByTestId("root")).not.toHaveAttribute(
      "data-sidebar-selection-ready",
    );
    rerender(<Harness visible />);
    expectAt(20, false);
    rerender(<Harness active={null} />);
    expect(layer()).toHaveAttribute("hidden");
    rerender(<Harness active="one" first={false} />);
    expect(layer()).toHaveAttribute("hidden");
    rerender(<Harness active="two" first={false} />);
    expectAt(50, false);
    screen.getByRole("button", { name: "Two" }).dataset.width = "0";
    rerender(<Harness active="two" first={false} tick={1} />);
    expect(layer()).toHaveAttribute("hidden");
  });
  it("synchronously invalidates, retires old refs and observer callbacks, then admits fresh rows", () => {
    const { rerender } = render(<Harness />);
    rerender(<Harness tick={1} />);
    const oldRootRef = controller.rootRef,
      oldRowRef = controller.rowRef("one"),
      oldObserver = observerCallbacks.at(-1)!;
    const root = screen.getByTestId("root"),
      oldRow = screen.getByRole<HTMLButtonElement>("button", { name: "One" });
    expectAt(20, false);
    act(() => controller.invalidate());
    expect(layer()).toHaveAttribute("hidden");
    expect(root).not.toHaveAttribute("data-sidebar-selection-ready");
    act(() => {
      oldRootRef(root);
      oldRowRef(oldRow);
      oldObserver([], {} as ResizeObserver);
    });
    rerender(<Harness active="two" tick={1} />);
    expect(layer()).toHaveAttribute("hidden");
    act(() => controller.admit());
    rerender(<Harness active="two" tick={2} />);
    expectAt(50, false);
    act(() => {
      oldRootRef(root);
      oldRowRef(oldRow);
      oldObserver([], {} as ResizeObserver);
    });
    expectAt(50, false);
  });
  it("requires fresh admission after Strict Mode cleanup and ignores queued stale measurements", () => {
    const { rerender } = render(
      <StrictMode>
        <Harness />
      </StrictMode>,
    );
    // Strict Mode invokes effect cleanup once during its development replay.
    // The owner must explicitly admit the current authority after its read.
    act(() => controller.admit());
    rerender(
      <StrictMode>
        <Harness tick={1} />
      </StrictMode>,
    );
    expectAt(20, false);
    const stale = observerCallbacks.at(-1)!;
    act(() => controller.invalidate());
    expect(layer()).toHaveAttribute("hidden");
    act(() => stale([], {} as ResizeObserver));
    rerender(
      <StrictMode>
        <Harness active="two" tick={2} />
      </StrictMode>,
    );
    act(() => stale([], {} as ResizeObserver));
    expect(layer()).toHaveAttribute("hidden");
    expect(screen.getByTestId("root")).not.toHaveAttribute(
      "data-sidebar-selection-ready",
    );
    act(() => controller.admit());
    rerender(
      <StrictMode>
        <Harness active="two" tick={3} />
      </StrictMode>,
    );
    expectAt(50, false);
    act(() => stale([], {} as ResizeObserver));
    expectAt(50, false);
  });
  it("disconnects its observer and removes the scroll listener on unmount", () => {
    const remove = vi.spyOn(window, "removeEventListener");
    const { unmount, rerender } = render(<Harness />);
    rerender(<Harness tick={1} />);
    expect(observers.at(-1)!.observe).toHaveBeenCalledTimes(2);
    const current = observers.at(-1)!;
    unmount();
    expect(current.disconnect).toHaveBeenCalled();
    expect(remove).toHaveBeenCalledWith("scroll", expect.any(Function), true);
  });
});
