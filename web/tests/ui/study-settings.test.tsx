import { StrictMode } from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { StudySettingsPanel } from "../../src/ui/StudySettingsPanel";
import { SettingsView } from "../../src/ui/SettingsView";
import type { SettingsLeaveGuard } from "../../src/ui/studySettingsTypes";
import type {
  CollectionsState,
  CollectionsStore,
} from "../../src/collections/contracts";
import { CollectionsRevisionConflictError } from "../../src/collections/contracts";
import { emptyStudy } from "../../src/collections/validation";
import { checkClose, registerCloseGuard } from "../../src/desktop/closeGuard";
const lifetime = vi.hoisted(() => ({
  version: 0,
  locks: new Set<() => void>(),
  owners: new WeakMap<
    object,
    {
      closed: boolean;
      close: Set<() => void>;
      epoch: Set<(epoch: string) => void>;
    }
  >(),
}));
vi.mock("../../src/account/session", () => ({
  lockVersion: () => lifetime.version,
  onLock: (fn: () => void) => {
    lifetime.locks.add(fn);
    return () => lifetime.locks.delete(fn);
  },
  requireSession: () => {},
}));
vi.mock("../../src/collections/store", () => ({
  assertCollectionsAccess: (store: object) => {
    if (lifetime.owners.get(store)?.closed) throw Error("closed");
  },
  onCollectionsClose: (store: object, fn: () => void) => {
    const owner = lifetime.owners.get(store)!;
    owner.close.add(fn);
    return () => owner.close.delete(fn);
  },
  onCollectionsEpochChange: (store: object, fn: (epoch: string) => void) => {
    const owner = lifetime.owners.get(store)!;
    owner.epoch.add(fn);
    return () => owner.epoch.delete(fn);
  },
}));
beforeEach(() => {
  lifetime.version = 0;
  lifetime.locks.clear();
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});
afterEach(() => vi.unstubAllGlobals());
// Explicit UI-boundary adapter only. Genuine encrypted writer tests belong to the separate data owner.
function fixture() {
  let value: CollectionsState = {
    version: 3,
    epoch: crypto.randomUUID(),
    revision: 0,
    study: emptyStudy("UTC"),
    journal: null,
    clips: { items: [], receipts: [] },
  };
  const subscribers = new Set<() => void>(),
    owner = {
      closed: false,
      close: new Set<() => void>(),
      epoch: new Set<(epoch: string) => void>(),
    };
  let lose = false;
  const store: CollectionsStore = {
    read: vi.fn(async () => structuredClone(value)),
    update: vi.fn(async (expected, change) => {
      if (
        expected.epoch !== value.epoch ||
        expected.revision !== value.revision
      )
        throw new CollectionsRevisionConflictError(structuredClone(value));
      value = {
        ...change(structuredClone(value)),
        revision: value.revision + 1,
      };
      subscribers.forEach((fn) => fn());
      if (lose) {
        lose = false;
        throw Error("Response unknown");
      }
      return structuredClone(value);
    }),
    subscribe: (fn) => {
      subscribers.add(fn);
      return () => {
        subscribers.delete(fn);
      };
    },
    persistence: () => ({ status: "ready" }),
    close: () => {
      owner.closed = true;
      owner.close.forEach((fn) => fn());
      subscribers.clear();
    },
  };
  lifetime.owners.set(store, owner);
  let guard: SettingsLeaveGuard | null = null;
  const props = {
    owner: {
      status: "ready" as const,
      store,
      identity: {
        accountId: "account",
        deviceId: "device",
        email: "synthetic-settings@example.test",
      },
      retry: vi.fn(),
    },
    onGuardReady: (next: SettingsLeaveGuard | null) => {
      guard = next;
    },
  };
  const view = render(<StudySettingsPanel {...props} />);
  return {
    store,
    props,
    view,
    value: () => structuredClone(value),
    guard: () => guard,
    lose: () => {
      lose = true;
    },
    external: (patch: Partial<CollectionsState["study"]["preferences"]>) => {
      value = {
        ...value,
        revision: value.revision + 1,
        study: {
          ...value.study,
          preferences: { ...value.study.preferences, ...patch },
        },
      };
      subscribers.forEach((fn) => fn());
    },
    erase: () => {
      value = { ...value, epoch: crypto.randomUUID(), revision: 0 };
      owner.epoch.forEach((fn) => fn(value.epoch));
      subscribers.forEach((fn) => fn());
    },
  };
}
const field = (name = "New cards per day") =>
  screen.getByRole("textbox", { name });
async function loaded() {
  await waitFor(() => expect(field()).toHaveValue("10"));
  await waitFor(() => expect(field()).toBeEnabled());
}
function held<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
it("loads actual values, supports full bounds and writes only five intended prefs", async () => {
  const f = fixture();
  await loaded();
  const before = f.value();
  fireEvent.change(field(), { target: { value: "0" } });
  fireEvent.change(field("Reviews per day"), { target: { value: "20000" } });
  fireEvent.change(screen.getByRole("combobox", { name: "Day starts at" }), {
    target: { value: "23" },
  });
  fireEvent.click(screen.getByRole("switch", { name: "Show streak" }));
  fireEvent.click(
    screen.getByRole("switch", { name: "Show next review on answer buttons" }),
  );
  expect(checkClose()).toBe("draft");
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await screen.findByText("Saved on this device.");
  await waitFor(() => expect(field()).toBeEnabled());
  expect(f.value().study.preferences).toMatchObject({
    newPerDay: 0,
    reviewsPerDay: 20000,
    dayStartHour: 23,
    showStreak: false,
    showNextReview: false,
    algorithm: before.study.preferences.algorithm,
    timezone: "UTC",
  });
  expect(f.value().study.cards).toEqual(before.study.cards);
  expect(f.value().study.events).toEqual(before.study.events);
  expect(f.value().clips).toEqual(before.clips);
  expect(checkClose()).toBe("allowed");
});
it("retains empty/fraction/overflow raw strings with errors and never clamps or writes them", async () => {
  const f = fixture();
  await loaded();
  for (const raw of ["", "1.5", "10001", "999999999999999999999"]) {
    fireEvent.change(field(), { target: { value: raw } });
    fireEvent.blur(field());
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(field()).toHaveValue(raw);
    expect(field()).toHaveAttribute("aria-invalid", "true");
    expect(f.store.update).not.toHaveBeenCalled();
  }
  fireEvent.change(field(), { target: { value: "10000" } });
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await screen.findByText("Saved on this device.");
  expect(f.value().study.preferences.newPerDay).toBe(10000);
});
it("keeps partial input through a failure and retries explicitly against read-confirmed state", async () => {
  const f = fixture();
  await loaded();
  fireEvent.change(field(), { target: { value: "12" } });
  vi.mocked(f.store.update).mockRejectedValueOnce(Error("Quota"));
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await screen.findByText(
    "Couldn’t save your changes. Your edits are still here.",
  );
  expect(field()).toHaveValue("12");
  expect(f.value().study.preferences.newPerDay).toBe(10);
  expect(f.store.update).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  await screen.findByText("Saved on this device.");
  expect(f.store.update).toHaveBeenCalledTimes(2);
  expect(f.value().study.preferences.newPerDay).toBe(12);
});
it("reloads a conflict with dirty keys kept and untouched booleans/current shared state preserved", async () => {
  const f = fixture();
  await loaded();
  fireEvent.change(field(), { target: { value: "3" } });
  act(() => f.external({ showStreak: false, reviewsPerDay: 77 }));
  await screen.findByText(
    "Saved data changed. Reload the latest settings to keep your edits.",
  );
  expect(field()).toHaveValue("3");
  fireEvent.click(
    screen.getByRole("button", { name: "Reload latest (keep edits)" }),
  );
  await screen.findByText("Latest settings loaded. Your edits are still here.");
  expect(field()).toHaveValue("3");
  expect(field("Reviews per day")).toHaveValue("77");
  expect(screen.getByRole("switch", { name: "Show streak" })).not.toBeChecked();
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await screen.findByText("Saved on this device.");
  expect(f.value().study.preferences).toMatchObject({
    newPerDay: 3,
    reviewsPerDay: 77,
    showStreak: false,
  });
});
it("discloses actual saved hour and switch values after conflict reload without writing", async () => {
  const f = fixture();
  await loaded();
  const day = screen.getByRole("combobox", { name: "Day starts at" });
  fireEvent.change(day, { target: { value: "2" } });
  fireEvent.click(screen.getByRole("switch", { name: "Show streak" }));
  fireEvent.click(
    screen.getByRole("switch", { name: "Show next review on answer buttons" }),
  );
  expect(screen.getByText("Saved value: 04:00")).toBeVisible();
  act(() =>
    f.external({ dayStartHour: 3, showStreak: true, showNextReview: true }),
  );
  await screen.findByRole("button", { name: "Reload latest (keep edits)" });
  fireEvent.click(
    screen.getByRole("button", { name: "Reload latest (keep edits)" }),
  );
  await screen.findByText("Latest settings loaded. Your edits are still here.");
  expect(day).toHaveValue("2");
  expect(screen.getByText("Saved value: 03:00")).toBeVisible();
  expect(screen.queryByText("Saved value: 04:00")).not.toBeInTheDocument();
  expect(screen.getAllByText("Saved value: On")).toHaveLength(2);
  expect(screen.getByRole("switch", { name: "Show streak" })).not.toBeChecked();
  expect(
    screen.getByRole("switch", { name: "Show next review on answer buttons" }),
  ).not.toBeChecked();
  expect(f.store.update).not.toHaveBeenCalled();
  expect(f.value().study.preferences.dayStartHour).toBe(3);
});
it("confirms an unknown committed result by read without another write", async () => {
  const f = fixture();
  await loaded();
  fireEvent.change(field(), { target: { value: "11" } });
  f.lose();
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await screen.findByText("Saved on this device.");
  expect(f.store.update).toHaveBeenCalledTimes(1);
  expect(f.value().study.preferences.newPerDay).toBe(11);
  await waitFor(() => expect(field()).toBeEnabled());
  expect(checkClose()).toBe("allowed");
});
it("does not mark newer edits saved when checking an older unknown attempt", async () => {
  const f = fixture();
  await loaded();
  fireEvent.change(field(), { target: { value: "11" } });
  f.lose();
  vi.mocked(f.store.read).mockRejectedValueOnce(Error("Read unavailable"));
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await screen.findByText(
    "Couldn’t confirm the save. Your edits are still here.",
  );
  await waitFor(() => expect(field()).toBeEnabled());
  fireEvent.change(field(), { target: { value: "13" } });
  fireEvent.click(screen.getByRole("button", { name: "Check saved settings" }));
  await screen.findByText(
    "Your edits are still here. Review them, then try again.",
  );
  expect(field()).toHaveValue("13");
  expect(f.value().study.preferences.newPerDay).toBe(11);
  expect(screen.queryByText("Saved on this device.")).not.toBeInTheDocument();
  expect(f.store.update).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  await screen.findByText("Saved on this device.");
  expect(f.value().study.preferences.newPerDay).toBe(13);
});
it("guards same-event close, explicit local leave and confirmed discard with real reload", async () => {
  const f = fixture();
  await loaded();
  fireEvent.change(field(), { target: { value: "9" } });
  expect(checkClose()).toBe("draft");
  const next = vi.fn();
  act(() => f.guard()!.requestLeave(next));
  const confirm = screen.getByRole("dialog", { name: "Unsaved Study changes" });
  fireEvent.click(
    within(confirm).getByRole("button", { name: "Keep editing" }),
  );
  expect(next).not.toHaveBeenCalled();
  act(() => f.guard()!.requestLeave(next));
  fireEvent.click(screen.getByRole("button", { name: "Discard and continue" }));
  await waitFor(() => expect(next).toHaveBeenCalledOnce());
  expect(field()).toHaveValue("10");
  expect(f.store.update).not.toHaveBeenCalled();
});
it("Save and continue runs only after the actual write/own guard settles", async () => {
  const f = fixture();
  await loaded();
  fireEvent.change(field(), { target: { value: "8" } });
  const next = vi.fn();
  act(() => f.guard()!.requestLeave(next));
  fireEvent.click(screen.getByRole("button", { name: "Save and continue" }));
  await waitFor(() => expect(next).toHaveBeenCalledOnce());
  expect(f.value().study.preferences.newPerDay).toBe(8);
});
it("clears direct close/erase and suppresses held save completion", async () => {
  const f = fixture();
  await loaded();
  fireEvent.change(field(), { target: { value: "9" } });
  const pending = held<CollectionsState>();
  vi.mocked(f.store.update).mockReturnValueOnce(pending.promise);
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  expect(field()).toBeDisabled();
  act(() => f.store.close());
  expect(
    screen.queryByRole("textbox", { name: "New cards per day" }),
  ).not.toBeInTheDocument();
  await act(async () => pending.resolve(f.value()));
  expect(screen.queryByText("Saved on this device.")).not.toBeInTheDocument();
  expect(
    screen.getByText(/Study settings are no longer available/),
  ).toBeVisible();
  f.view.unmount();
  const g = fixture();
  await loaded();
  fireEvent.change(field(), { target: { value: "7" } });
  act(g.erase);
  expect(
    screen.queryByRole("textbox", { name: "New cards per day" }),
  ).not.toBeInTheDocument();
});
it("does not leak an older owner draft into replacement/StrictMode reload", async () => {
  const f = fixture();
  await loaded();
  fireEvent.change(field(), { target: { value: "123" } });
  f.view.unmount();
  const g = fixture();
  g.view.unmount();
  const v = render(
    <StrictMode>
      <StudySettingsPanel {...g.props} />
    </StrictMode>,
  );
  await loaded();
  expect(field()).toHaveValue("10");
  expect(screen.queryByText("123")).not.toBeInTheDocument();
  v.unmount();
});
it("drains a second notification after an already captured background read", async () => {
  const f = fixture();
  await loaded();
  const pending = held<CollectionsState>();
  vi.mocked(f.store.read).mockReturnValueOnce(pending.promise);
  act(() => f.external({ newPerDay: 11 }));
  const captured = f.value();
  act(() => f.external({ newPerDay: 17 }));
  await act(async () => pending.resolve(captured));
  await waitFor(() => expect(field()).toHaveValue("17"));
  expect(f.store.read).toHaveBeenCalledTimes(3);
  expect(f.store.update).not.toHaveBeenCalled();
});
it("does not focus a replacement owner's form from an older invalid-save frame", async () => {
  const f = fixture();
  await loaded();
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.push(callback);
    return frames.length;
  });
  fireEvent.change(field(), { target: { value: "" } });
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  const older = [...frames];
  expect(older.length).toBeGreaterThan(0);
  const g = fixture();
  g.view.unmount();
  f.view.rerender(<StudySettingsPanel {...g.props} />);
  await loaded();
  const toggle = screen.getByRole("switch", { name: "Show streak" });
  toggle.focus();
  act(() => older.forEach((callback) => callback(1)));
  expect(toggle).toHaveFocus();
  expect(field()).toHaveValue("10");
});
it("routes subsection and Done through the registered guard without duplicate continuation", async () => {
  const f = fixture();
  f.view.unmount();
  const done = vi.fn();
  render(
    <SettingsView
      email={f.props.owner.identity.email}
      preferences={{
        theme: "light",
        setTheme: vi.fn(),
        motion: "system",
        setMotion: vi.fn(),
      }}
      onSignOut={vi.fn()}
      onExport={vi.fn()}
      onErase={vi.fn()}
      onDone={done}
      studyOwner={f.props.owner}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Study" }));
  await loaded();
  fireEvent.change(field(), { target: { value: "3" } });
  fireEvent.click(screen.getByRole("button", { name: "Editor" }));
  fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
  expect(screen.getByRole("heading", { name: "Study" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Editor" }));
  fireEvent.click(screen.getByRole("button", { name: "Discard and continue" }));
  await screen.findByRole("heading", { name: "Editor" });
  expect(f.store.update).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Study" }));
  await loaded();
  fireEvent.change(field(), { target: { value: "7" } });
  fireEvent.click(screen.getByRole("button", { name: "Done" }));
  fireEvent.click(screen.getByRole("button", { name: "Save and continue" }));
  await waitFor(() => expect(done).toHaveBeenCalledOnce());
  expect(f.value().study.preferences.newPerDay).toBe(7);
});
it("rechecks other global guards after save and never resumes a blocked continuation", async () => {
  const f = fixture();
  await loaded();
  fireEvent.change(field(), { target: { value: "5" } });
  const next = vi.fn(),
    stop = registerCloseGuard(() => false);
  try {
    act(() => f.guard()!.requestLeave(next));
    fireEvent.click(screen.getByRole("button", { name: "Save and continue" }));
    await screen.findByText("Finish pending work before leaving Settings.");
    expect(f.value().study.preferences.newPerDay).toBe(5);
    expect(next).not.toHaveBeenCalled();
    stop();
    await act(async () => {});
    expect(next).not.toHaveBeenCalled();
  } finally {
    stop();
  }
});
it("guards beforeunload immediately and removes the private form on account lock", async () => {
  fixture();
  await loaded();
  fireEvent.change(field(), { target: { value: "4" } });
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  act(() => {
    lifetime.version++;
    lifetime.locks.forEach((listener) => listener());
  });
  expect(
    screen.queryByRole("textbox", { name: "New cards per day" }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByText(/Study settings are no longer available/),
  ).toBeVisible();
});
