import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SampleWorkspace from "../../src/demo/SampleWorkspace";
import { storageCopy } from "../../src/ui/storageCopy";

const account = vi.hoisted(() => ({
  current: vi.fn(),
  create: vi.fn(),
  openStore: vi.fn(),
  signIn: vi.fn(),
}));
vi.mock("../../src/account", () => ({
  createAccountService: () => {
    account.create();
    return { current: account.current, signIn: account.signIn };
  },
  subscribeLock: () => () => {},
}));
vi.mock("../../src/data", () => ({ openNotesStore: account.openStore }));
vi.mock("../../src/desktop/DesktopShell", () => ({
  useDesktop: () => null,
  DesktopShell: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));
vi.mock("../../src/desktop/window", () => ({ isDesktop: () => false }));
vi.mock("../../src/links/useIncomingNoteLink", () => ({
  useIncomingNoteLink: () => ({ state: null, revoke: vi.fn() }),
}));
vi.mock("../../src/ui/RichEditor", () => ({
  RichEditor: () => <div>Writing surface</div>,
}));

beforeEach(() => {
  vi.clearAllMocks();
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

describe("offline storage copy", () => {
  it("uses the plural subject with the offline message in a browser", () => {
    expect(storageCopy(false).offline).toBe(
      "You’re offline. Notes still save in this browser. This beta does not sync.",
    );
  });

  it("uses the plural subject with the offline message on this device", () => {
    expect(storageCopy(true).offline).toBe(
      "You’re offline. Notes still save in this app on this device. This beta does not sync.",
    );
  });

  it("never writes the third-person singular after Notes", () => {
    for (const desktop of [false, true]) {
      for (const value of Object.values(storageCopy(desktop))) {
        expect(value).not.toMatch(/\bNotes still saves\b/);
      }
    }
  });
});

describe("sample workspace counts", () => {
  it("pluralises a tag that holds a single note", () => {
    render(<SampleWorkspace onExit={vi.fn()} />);
    const tags = screen.getByRole("navigation", { name: "Note tags" });
    expect(
      within(tags).getByRole("button", { name: "home, 1 note" }),
    ).toBeVisible();
    expect(
      within(tags).getByRole("button", { name: "launch, 1 note" }),
    ).toBeVisible();
    expect(
      within(tags).queryByRole("button", { name: "home, 1 notes" }),
    ).not.toBeInTheDocument();
  });

  it("keeps plural counts plural", () => {
    render(<SampleWorkspace onExit={vi.fn()} />);
    const tags = screen.getByRole("navigation", { name: "Note tags" });
    expect(
      within(tags).getByRole("button", { name: "trip, 2 notes" }),
    ).toBeVisible();
    expect(
      within(tags).getByRole("button", { name: "study, 2 notes" }),
    ).toBeVisible();
    const modules = screen.getByRole("navigation", { name: "Collections" });
    expect(
      within(modules).getByRole("button", { name: "All notes, 5 notes" }),
    ).toBeVisible();
    expect(
      within(modules).getByRole("button", { name: "Clips, 3 clips" }),
    ).toBeVisible();
  });
});
