import {
  fireEvent,
  render,
  screen,
  within,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NoteDocument } from "../../src/domain/contracts";
import { useEditorPreferences } from "../../src/ui/editorPreferences";

const account = vi.hoisted(() => ({
  current: vi.fn(),
  create: vi.fn(),
  openStore: vi.fn(),
  signIn: vi.fn(),
}));
vi.mock("../../src/account", () => ({
  createAccountService: () => {
    account.create();
    return { close: () => {}, current: account.current, signIn: account.signIn };
  },
  subscribeLock: () => () => {},
}));
vi.mock("../../src/data", () => ({ openNotesStore: account.openStore }));
const native = vi.hoisted(() => ({ current: null as null | { setNavigation: ReturnType<typeof vi.fn>; setLayout: ReturnType<typeof vi.fn> } }));
vi.mock("../../src/desktop/DesktopShell", () => ({
  useDesktop: () => native.current,
  DesktopShell: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));
vi.mock("../../src/desktop/window", () => ({ isDesktop: () => false }));
vi.mock("../../src/links/useIncomingNoteLink", () => ({
  useIncomingNoteLink: () => ({ state: null, revoke: vi.fn() }),
}));
// Exercise the demo's state ownership independently of ProseMirror's browser geometry.
vi.mock("../../src/ui/RichEditor", () => ({
  RichEditor: ({
    document,
    onChange,
    ariaLabel,
  }: {
    document: NoteDocument;
    onChange: (document: NoteDocument) => void;
    ariaLabel: string;
  }) => {
    const { preferences } = useEditorPreferences();
    return (
    <textarea
      aria-label={ariaLabel}
      spellCheck={preferences.spellcheck}
      value={document.content
        .map((node) => node.content?.map((item) => item.text).join("") ?? "")
        .join("\n")}
      onChange={(event) =>
        onChange({
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: event.target.value }],
            },
          ],
        })
      }
    />
    );
  },
}));
import SampleWorkspace from "../../src/demo/SampleWorkspace";
import { App } from "../../src/App";

beforeEach(() => {
  vi.clearAllMocks();
  native.current = null;
  account.current.mockResolvedValue(null);
  vi.stubEnv("VITE_ENGINE_URL", "http://account.invalid");
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});

describe("sample workspace", () => {
  it("opens desktop Settings with search, sample availability, and the native sidebar toggle", () => {
    const setNavigation = vi.fn();
    const setLayout = vi.fn();
    native.current = { setNavigation, setLayout };
    render(<SampleWorkspace onExit={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    const nav = screen.getByRole("navigation", { name: "Settings sections" });
    for (const label of ["General", "Editor", "Sync Planned", "Study", "Journal", "Connected apps Planned", "Data and export"]) {
      expect(within(nav).getByRole("button", { name: label })).toBeVisible();
    }
    fireEvent.click(within(screen.getByRole("group", { name: "Motion" })).getByRole("button", { name: "Reduced" }));
    fireEvent.click(within(nav).getByRole("button", { name: "Study" }));
    expect(screen.getByText("Study settings unavailable")).toBeVisible();
    fireEvent.click(within(nav).getByRole("button", { name: "Journal" }));
    expect(screen.getByText("Sample Journal")).toBeVisible();
    fireEvent.click(within(nav).getByRole("button", { name: "Data and export" }));
    expect(screen.getByText("Data and export unavailable")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Export all notes" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "Find a setting" }), { target: { value: "editor" } });
    expect(within(nav).getByRole("button", { name: "Editor" })).toBeVisible();
    expect(within(nav).queryByRole("button", { name: "General" })).not.toBeInTheDocument();
    const navigation = setNavigation.mock.calls.at(-1)?.[0];
    fireEvent.click(Object.assign(document.createElement("button"), { onclick: navigation.toggle }));
    expect(screen.getByRole("region", { name: "Settings screen" }).firstElementChild).toHaveAttribute("data-settings-expanded", "false");
    fireEvent.click(screen.getByRole("button", { name: "Back to workspace" }));
    expect(screen.queryByRole("region", { name: "Settings screen" })).not.toBeInTheDocument();
    fireEvent.click(Object.assign(document.createElement("button"), { onclick: setNavigation.mock.calls.at(-1)?.[0].toggle }));
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("region", { name: "Settings screen" })).not.toBeInTheDocument();
  });
  it("registers and clears native navigation and toggles its sidebar", () => {
    const setNavigation = vi.fn();
    const setLayout = vi.fn();
    native.current = { setNavigation, setLayout };
    const { unmount } = render(<SampleWorkspace onExit={vi.fn()} />);
    expect(setLayout).toHaveBeenLastCalledWith({ sidebarWidth: 224, sidebarVisible: true });
    const navigation = setNavigation.mock.calls.at(-1)?.[0];
    fireEvent.click(screen.getByRole("button", { name: /All notes, 5 notes/ }));
    // The native titlebar invokes this registered callback.
    fireEvent.click(Object.assign(document.createElement("button"), { onclick: navigation.toggle }));
    expect(setLayout).toHaveBeenLastCalledWith({ sidebarWidth: 224, sidebarVisible: false });
    expect(screen.queryByRole("complementary", { name: "Sample navigation" })).not.toBeInTheDocument();
    unmount();
    expect(setNavigation).toHaveBeenLastCalledWith(null);
    expect(setLayout).toHaveBeenLastCalledWith(null);
  });

  it("keeps note edits through module navigation and filters tags with actual counts", () => {
    render(<SampleWorkspace onExit={vi.fn()} />);
    const tags = screen.getByRole("navigation", { name: "Note tags" });
    fireEvent.click(
      within(tags).getByRole("button", { name: "trip, 2 notes" }),
    );
    expect(screen.getByRole("heading", { name: "trip" })).toBeVisible();
    expect(
      screen.queryByText("Spring launch checklist"),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Lisbon trip, May/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "Note title" }), {
      target: { value: "Our Lisbon plan" },
    });
    fireEvent.change(
      screen.getByRole("textbox", { name: "Sample note content" }),
      { target: { value: "Meet Maya at the river." } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Journal" }));
    fireEvent.click(screen.getByRole("button", { name: /All notes, 5/ }));
    fireEvent.click(screen.getByRole("button", { name: /Our Lisbon plan/ }));
    expect(
      screen.getByRole("textbox", { name: "Sample note content" }),
    ).toHaveValue("Meet Maya at the river.");
    expect(account.create).not.toHaveBeenCalled();
    expect(account.openStore).not.toHaveBeenCalled();
  });

  it("retains journal text and habit changes when returning from another module", () => {
    render(<SampleWorkspace onExit={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Journal" }));
    fireEvent.change(
      screen.getByRole("textbox", { name: "Sample journal entry" }),
      { target: { value: "A new sample entry." } },
    );
    fireEvent.click(screen.getByRole("checkbox", { name: "Drink water" }));
    expect(screen.getByText("3 of 3 complete")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Study" }));
    fireEvent.click(screen.getByRole("button", { name: "Journal" }));
    expect(
      screen.getByRole("textbox", { name: "Sample journal entry" }),
    ).toHaveValue("A new sample entry.");
    expect(screen.getByRole("checkbox", { name: "Drink water" })).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Previous day" }));
    expect(
      screen.getByRole("textbox", { name: "Sample journal entry" }),
    ).not.toHaveValue("A new sample entry.");
  });

  it("reveals practice answers and finishes at the real deck length", () => {
    render(<SampleWorkspace onExit={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Study" }));
    fireEvent.click(screen.getByRole("button", { name: /Portuguese basics/ }));
    expect(screen.queryByText("Bom dia.")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show answer" }));
    expect(screen.getByText("Bom dia.")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Next card" }));
    expect(screen.getByText("Card 2 of 2")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Show answer" }));
    fireEvent.click(screen.getByRole("button", { name: "Next card" }));
    expect(
      screen.getByRole("heading", { name: "Practice complete" }),
    ).toBeVisible();
    expect(
      screen.getByText("Sample practice does not schedule reviews."),
    ).toBeVisible();
  });

  it("reads and filters sample clips without fetching an article", () => {
    const fetcher = vi.fn(() => {
      throw new Error("No sample network access");
    });
    vi.stubGlobal("fetch", fetcher);
    render(<SampleWorkspace onExit={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Clips, 3/ }));
    const filters = screen.getByLabelText("Clip filters");
    fireEvent.click(
      within(filters).getByRole("button", { name: /Unread\s*2/ }),
    );
    expect(
      screen.queryByRole("button", { name: /A launch checklist/ }),
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: /A slower way to explore Lisbon/ }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Mark as read" }));
    fireEvent.click(screen.getByRole("button", { name: "Back to clips" }));
    expect(
      screen.queryByRole("button", { name: /A slower way to explore Lisbon/ }),
    ).not.toBeInTheDocument();
    expect(
      within(screen.getByLabelText("Clip filters")).getByRole("button", {
        name: /Unread\s*1/,
      }),
    ).toBeVisible();
    expect(fetcher).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("restores appearance on exit without writing shared preferences", () => {
    document.documentElement.dataset.theme = "dim";
    delete document.documentElement.dataset.motion;
    const write = vi.spyOn(Storage.prototype, "setItem");
    const { unmount } = render(<SampleWorkspace onExit={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(within(screen.getByRole("group", { name: "Appearance" })).getByRole("button", { name: "Light" }));
    fireEvent.click(within(screen.getByRole("group", { name: "Motion" })).getByRole("button", { name: "Reduced" }));
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(document.documentElement.dataset.motion).toBe("reduced");
    expect(write).not.toHaveBeenCalled();
    unmount();
    expect(document.documentElement.dataset.theme).toBe("dim");
    expect(document.documentElement.dataset.motion).toBeUndefined();
    write.mockRestore();
  });

  it("keeps sample note and editor choices in memory through Settings", () => {
    const root = document.documentElement;
    root.style.setProperty("--notes-editor-size", "19px");
    root.style.setProperty("--notes-editor-width", "720px");
    const write = vi.spyOn(Storage.prototype, "setItem");
    const { unmount } = render(<SampleWorkspace onExit={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Lisbon trip, May/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "Note title" }), { target: { value: "Draft title" } });
    const opener = screen.getByRole("button", { name: "Settings" });
    opener.focus();
    fireEvent.click(opener);
    expect(screen.queryByRole("button", { name: "Sign out" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Editor" }));
    fireEvent.click(within(screen.getByRole("group", { name: "Text size" })).getByRole("button", { name: "Large" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Check spelling" }));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(opener).toHaveFocus();
    expect(screen.getByRole("textbox", { name: "Note title" })).toHaveValue("Draft title");
    expect(screen.getByRole("textbox", { name: "Sample note content" })).toHaveAttribute("spellcheck", "false");
    expect(root.style.getPropertyValue("--notes-editor-size")).toBe("16px");
    expect(write).not.toHaveBeenCalled();
    unmount();
    expect(root.style.getPropertyValue("--notes-editor-size")).toBe("19px");
    expect(root.style.getPropertyValue("--notes-editor-width")).toBe("720px");
    root.style.removeProperty("--notes-editor-size");
    root.style.removeProperty("--notes-editor-width");
    write.mockRestore();
  });

  it("opens during account failure, makes no further account calls, and resets after exit", async () => {
    account.current.mockRejectedValue(new Error("Account unavailable"));
    render(<App />);
    await screen.findByRole("heading", { name: "Notes can’t open yet" });
    fireEvent.click(
      screen.getByRole("button", { name: "Use without an account" }),
    );
    await screen.findByRole("main");
    fireEvent.click(
      await screen.findByRole("button", { name: /Lisbon trip, May/ }),
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Note title" }), {
      target: { value: "Disposable title" },
    });
    expect(account.create).toHaveBeenCalledTimes(1);
    expect(account.openStore).not.toHaveBeenCalled();
    expect(account.signIn).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Exit sample" }));
    await screen.findByRole("heading", { name: "Notes can’t open yet" });
    fireEvent.click(
      screen.getByRole("button", { name: "Use without an account" }),
    );
    expect(
      await screen.findByRole("button", { name: /Lisbon trip, May/ }),
    ).toBeVisible();
    expect(screen.queryByText("Disposable title")).not.toBeInTheDocument();
  });

  it("offers the same sample entry from account entry and sign-in", async () => {
    render(<App />);
    await screen.findByRole("heading", { name: "Orbyn Notes" });
    expect(
      screen.getByRole("button", { name: "Use without an account" }),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Use without an account" }),
    );
    await screen.findByRole("heading", { name: "All notes" });
    expect(
      screen.queryByRole("textbox", { name: "Email" }),
    ).not.toBeInTheDocument();
    expect(account.signIn).not.toHaveBeenCalled();
    await waitFor(() => expect(account.openStore).not.toHaveBeenCalled());
  });
});
