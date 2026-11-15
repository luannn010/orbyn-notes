import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { Workspace } from "../../src/ui/Workspace";
import type { Note, NotesStore } from "../../src/domain/contracts";
const control = vi.hoisted(() => ({
  handler: null as
    | null
    | ((value: {
        token: string;
        accountId: string;
        deviceId: string;
        noteId: string;
      }) => void),
  reply: vi.fn(async () => {}),
  blockStudy: false,
  late: null as null | (() => void),
}));
vi.mock("../../src/desktop/capture", () => ({
  openQuickNote: vi.fn(),
  listenHandoff: async (handler: typeof control.handler) => {
    control.handler = handler;
    return () => {};
  },
  replyHandoff: control.reply,
}));
vi.mock("../../src/desktop/window", () => ({ isDesktop: () => true }));
const bridge = vi.hoisted(() => ({
  toolbar: null,
  setChrome: vi.fn(),
  setLayout: vi.fn(),
  setNavigation: vi.fn(),
  navigationRef: { current: null },
  sidebarExpanded: true,
  sidebarPinned: true,
}));
vi.mock("../../src/desktop/DesktopShell", () => ({ useDesktop: () => bridge }));
vi.mock("../../src/ui/RichEditor", () => ({
  RichEditor: () => <div>Writing surface</div>,
}));
vi.mock("../../src/ui/StudySettingsPanel", () => ({
  StudySettingsPanel: ({
    onGuardReady,
  }: {
    onGuardReady: (value: unknown) => void;
  }) => {
    const React = require("react");
    React.useEffect(() => {
      onGuardReady({
        requestLeave: (action: () => void) => {
          if (control.blockStudy) control.late = action;
          else action();
        },
      });
      return () => onGuardReady(null);
    }, [onGuardReady]);
    return <p>Study draft fixture</p>;
  },
}));
const session = {
  accountId: "main-account",
  deviceId: "main-device",
  email: "capture@example.test",
  deviceState: "trusted" as const,
};
const fetched: Note = {
  id: "22222222-2222-4222-8222-222222222222",
  title: "Quick capture fetched outside list",
  document: { type: "doc", content: [{ type: "paragraph" }] },
  tags: [],
  revision: 1,
  createdAt: "2026-11-15",
  updatedAt: "2026-11-15",
  trashedAt: null,
};
beforeEach(() => {
  localStorage.clear();
  control.handler = null;
  control.reply.mockClear();
  control.blockStudy = false;
  control.late = null;
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
});
async function setup() {
  const store = {
    list: async () => [],
    get: async () => fetched,
    subscribe: () => () => {},
    persistence: () => ({ status: "ready" }),
    close: vi.fn(),
  } as unknown as NotesStore;
  render(
    <Workspace store={store} session={session} onSignOut={async () => {}} />,
  );
  await screen.findByRole("button", { name: "Settings" });
  await waitFor(() => expect(control.handler).not.toBeNull());
}
async function handoff() {
  await act(async () => {
    control.handler?.({
      token: "fresh",
      accountId: session.accountId,
      deviceId: session.deviceId,
      noteId: fetched.id,
    });
  });
}
it("opens fetched capture even when the main library snapshot is stale and Settings is covering it", async () => {
  await setup();
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  expect(screen.getByRole("heading", { name: "General" })).toBeVisible();
  await handoff();
  expect(await screen.findByLabelText("Note title")).toHaveValue(fetched.title);
  expect(
    screen.queryByRole("heading", { name: "General" }),
  ).not.toBeInTheDocument();
  expect(control.reply).toHaveBeenCalledWith("fresh", true);
});
it("declines a dirty Study Settings handoff and fences a late confirmation", async () => {
  await setup();
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  fireEvent.click(screen.getAllByRole("button", { name: "Study" }).at(-1)!);
  await screen.findByText("Study draft fixture");
  control.blockStudy = true;
  await handoff();
  expect(control.reply).toHaveBeenCalledWith("fresh", false);
  expect(screen.queryByLabelText("Note title")).not.toBeInTheDocument();
  await act(async () => control.late?.());
  expect(screen.queryByLabelText("Note title")).not.toBeInTheDocument();
  expect(screen.getByText("Study draft fixture")).toBeVisible();
});
it("rejects another workspace identity without fetching or switching", async () => {
  await setup();
  await act(async () =>
    control.handler?.({
      token: "other",
      accountId: "other-account",
      deviceId: session.deviceId,
      noteId: fetched.id,
    }),
  );
  expect(control.reply).toHaveBeenCalledWith("other", false);
  expect(screen.queryByLabelText("Note title")).not.toBeInTheDocument();
});
