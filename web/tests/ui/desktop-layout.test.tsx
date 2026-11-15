import { useLayoutEffect, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DesktopShell, useDesktop } from "../../src/desktop/DesktopShell";
import { connectWindow, isDesktop } from "../../src/desktop/window";

vi.mock("../../src/desktop/window", () => ({
  isDesktop: vi.fn(),
  connectWindow: vi.fn(),
}));
afterEach(() => vi.unstubAllGlobals());
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(isDesktop).mockReturnValue(true);
  vi.mocked(connectWindow).mockResolvedValue({
    minimize: vi.fn(async () => {}),
    toggleMaximize: vi.fn(async () => {}),
    isMaximized: async () => false,
    close: vi.fn(async () => {}),
    startDragging: vi.fn(async () => {}),
    showSystemMenu: vi.fn(async () => {}),
    finishClose: vi.fn(async () => {}),
    dispose: vi.fn(),
  });
});
it("shows branding and disabled navigation on account entry", async () => {
  render(
    <DesktopShell>
      <main>Account entry</main>
    </DesktopShell>,
  );
  await screen.findByText("Account entry");
  const toolbar = screen.getByRole("banner", { name: "Window toolbar" });
  expect(toolbar).toHaveTextContent("Orbyn Notes");
  expect(screen.getByRole("button", { name: /sidebar/ })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Back" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Minimize window" })).toBeEnabled();
  expect(document.querySelector(".desktop-shell")).toHaveAttribute(
    "data-layout",
    "single-pane",
  );
});
it("updates content-free layout without remounting its child or editor portal", async () => {
  let mounts = 0,
    unmounts = 0;
  let update!: (value: number) => void;
  let hide!: () => void;
  function Content() {
    const desktop = useDesktop();
    const [width, setWidth] = useState(224),
      [visible, setVisible] = useState(true);
    update = setWidth;
    hide = () => setVisible(false);
    useEffect(() => {
      mounts++;
      return () => {
        unmounts++;
      };
    }, []);
    useLayoutEffect(() => {
      desktop?.setLayout({ sidebarWidth: width, sidebarVisible: visible });
      return () => desktop?.setLayout(null);
    }, [desktop?.setLayout, width, visible]);
    return (
      <main>
        <input aria-label="Retained draft" defaultValue="Still writing" />
        {desktop?.toolbar &&
          createPortal(<button>Portaled action</button>, desktop.toolbar)}
      </main>
    );
  }
  const view = render(
    <DesktopShell>
      <Content />
    </DesktopShell>,
  );
  const action = await screen.findByRole("button", { name: "Portaled action" });
  const input = screen.getByRole("textbox", { name: "Retained draft" });
  fireEvent.change(input, { target: { value: "Retained unsaved draft" } });
  const toolbarNode = action.parentElement;
  expect(document.querySelector(".desktop-shell")).toHaveAttribute(
    "data-layout",
    "workspace",
  );
  act(() => update(420));
  act(hide);
  expect(screen.getByRole("button", { name: "Portaled action" })).toBe(action);
  expect(action.parentElement).toBe(toolbarNode);
  expect(screen.getByRole("textbox")).toBe(input);
  expect(input).toHaveValue("Retained unsaved draft");
  expect(mounts).toBe(1);
  expect(unmounts).toBe(0);
  view.unmount();
  expect(unmounts).toBe(1);
});
it("returns to single-pane geometry when Workspace leaves without recreating the bridge", async () => {
  function WorkspaceLayout() {
    const desktop = useDesktop();
    useLayoutEffect(() => {
      desktop?.setLayout({ sidebarWidth: 300, sidebarVisible: true });
      return () => desktop?.setLayout(null);
    }, [desktop?.setLayout]);
    return <main>Library</main>;
  }
  const view = render(
    <DesktopShell>
      <WorkspaceLayout />
    </DesktopShell>,
  );
  await screen.findByText("Library");
  expect(document.querySelector(".desktop-shell")).toHaveAttribute(
    "data-layout",
    "workspace",
  );
  view.rerender(
    <DesktopShell>
      <main>Account entry</main>
    </DesktopShell>,
  );
  expect(document.querySelector(".desktop-shell")).toHaveAttribute(
    "data-layout",
    "single-pane",
  );
  expect(connectWindow).toHaveBeenCalledOnce();
});
it("reveals an already focused toolbar action on resize without scrolling fixed menu items or stealing focus", async () => {
  let notify = () => {};
  const disconnect = vi.fn();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        notify = callback;
      }
      observe = vi.fn();
      disconnect = disconnect;
    },
  );
  function Content() {
    const desktop = useDesktop();
    return (
      <main>
        <input aria-label="Outside toolbar" />
        {desktop?.toolbar &&
          createPortal(
            <>
              <button>Portaled action</button>
              <div role="menu">
                <button>Fixed menu action</button>
              </div>
            </>,
            desktop.toolbar,
          )}
      </main>
    );
  }
  const view = render(
    <DesktopShell>
      <Content />
    </DesktopShell>,
  );
  const action = await screen.findByRole("button", { name: "Portaled action" });
  const toolbar = action.parentElement!;
  Object.defineProperties(toolbar, {
    clientWidth: { value: 180 },
    scrollWidth: { value: 600 },
    clientLeft: { value: 0 },
  });
  vi.spyOn(toolbar, "getBoundingClientRect").mockReturnValue(
    new DOMRect(70, 0, 180, 44),
  );
  vi.spyOn(action, "getBoundingClientRect").mockReturnValue(
    new DOMRect(70, 0, 40, 32),
  );
  action.focus();
  expect(toolbar.scrollLeft).toBe(0);
  vi.mocked(action.getBoundingClientRect).mockReturnValue(
    new DOMRect(400, 0, 40, 32),
  );
  act(notify);
  expect(toolbar.scrollLeft).toBe(190);
  expect(action).toHaveFocus();
  toolbar.scrollLeft = 0;
  screen.getByRole("button", { name: "Fixed menu action" }).focus();
  act(notify);
  expect(toolbar.scrollLeft).toBe(0);
  screen.getByRole("textbox", { name: "Outside toolbar" }).focus();
  act(notify);
  expect(screen.getByRole("textbox")).toHaveFocus();
  expect(toolbar.scrollLeft).toBe(0);
  view.unmount();
  expect(disconnect).toHaveBeenCalledOnce();
});

it("routes titlebar actions and closes the menu with Escape", async () => {
  const back = vi.fn(), newNote = vi.fn(), openSettings = vi.fn();
  function Content() {
    const desktop = useDesktop();
    useLayoutEffect(() => {
      desktop?.setChrome({ title: "Library", canBack: true, canForward: false, back, forward: vi.fn(), newNote, openSettings });
      return () => desktop?.setChrome(null);
    }, [desktop?.setChrome]);
    return <main>Workspace content</main>;
  }
  render(<DesktopShell><Content /></DesktopShell>);
  await screen.findByText("Workspace content");
  expect(document.querySelector(".desktop-shell")).toHaveAttribute("data-current-view", "Library");
  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  expect(back).toHaveBeenCalledOnce();
  const trigger = screen.getByRole("button", { name: "App menu" });
  fireEvent.click(trigger);
  fireEvent.click(screen.getByRole("menuitem", { name: "New note" }));
  expect(newNote).toHaveBeenCalledOnce();
  fireEvent.click(trigger);
  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
});

it("hides a retained editor toolbar while Settings is current", async () => {
  function Content() {
    const desktop = useDesktop();
    useLayoutEffect(() => {
      desktop?.setChrome({ title: "Settings", settingsOpen: true, canBack: false, canForward: false, back: vi.fn(), forward: vi.fn(), newNote: vi.fn(), openSettings: vi.fn() });
      return () => desktop?.setChrome(null);
    }, [desktop?.setChrome]);
    return <main>{desktop?.toolbar && createPortal(<button>Retained editor action</button>, desktop.toolbar)}</main>;
  }
  render(<DesktopShell><Content /></DesktopShell>);
  const action = await screen.findByText("Retained editor action");
  expect(action.parentElement).toHaveAttribute("hidden");
  expect(action).not.toBeVisible();
});

it("keeps editor actions visible for a note named Settings", async () => {
  function Content() {
    const desktop = useDesktop();
    useLayoutEffect(() => {
      desktop?.setChrome({ title: "Settings", settingsOpen: false, canBack: false, canForward: false,
        back: vi.fn(), forward: vi.fn(), newNote: vi.fn(), openSettings: vi.fn() });
      return () => desktop?.setChrome(null);
    }, [desktop?.setChrome]);
    return <main>{desktop?.toolbar && createPortal(<button>Note editing action</button>, desktop.toolbar)}</main>;
  }
  render(<DesktopShell><Content /></DesktopShell>);
  const action = await screen.findByText("Note editing action");
  expect(action.parentElement).not.toHaveAttribute("hidden");
  expect(action).toBeVisible();
  expect(document.querySelector(".desktop-shell")).toHaveAttribute("data-settings-open", "false");
});
