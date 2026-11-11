import { describe, expect, it, vi } from "vitest";
import {
  createSetupPreference,
  SETUP_PREFERENCE_KEY,
} from "../../src/setup/preference";

describe("optional setup profile preference", () => {
  it("accepts only the bounded versioned dismissal hint", () => {
    let raw: string | null = null;
    const preference = createSetupPreference(() => ({
      getItem: () => raw,
      setItem: vi.fn(),
    }));
    for (const value of [
      null,
      "bad-json",
      '{"version":2,"dismissed":true}',
      '{"version":1,"dismissed":false}',
      '{"version":1,"dismissed":true,"accountId":"private"}',
      " ".repeat(300),
    ]) {
      raw = value;
      expect(preference.isDismissed()).toBe(false);
    }
    raw = '{"version":1,"dismissed":true}';
    expect(preference.isDismissed()).toBe(true);
    raw = null;
    expect(preference.isDismissed()).toBe(true);
  });
  it("keeps Notes usable and dismissal latched when accessing storage is denied", () => {
    const preference = createSetupPreference(() => {
      throw new DOMException("Denied", "SecurityError");
    });
    expect(preference.isDismissed()).toBe(false);
    expect(preference.dismiss()).toEqual({ persisted: false });
    expect(preference.isDismissed()).toBe(true);
  });
  it("latches and notifies even when the write fails", () => {
    const storage = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(() => {
        throw new Error("Quota");
      }),
    };
    const preference = createSetupPreference(() => storage);
    const seen: boolean[] = [];
    preference.subscribe(() => seen.push(preference.isDismissed()));
    expect(preference.dismiss()).toEqual({ persisted: false });
    expect(seen).toEqual([true]);
    expect(preference.isDismissed()).toBe(true);
    expect(storage.getItem).not.toHaveBeenCalled();
  });
  it("writes only a small profile hint with no account or content fields", () => {
    const storage = { getItem: vi.fn(() => null), setItem: vi.fn() };
    const preference = createSetupPreference(() => storage);
    expect(preference.dismiss()).toEqual({ persisted: true });
    expect(storage.setItem).toHaveBeenCalledExactlyOnceWith(
      SETUP_PREFERENCE_KEY,
      '{"version":1,"dismissed":true}',
    );
  });
  it("observes only the hint or storage-clear events and releases its event listener", () => {
    const events = new EventTarget();
    const remove = vi.spyOn(events, "removeEventListener");
    const preference = createSetupPreference(
      () => ({ getItem: () => null, setItem: vi.fn() }),
      events,
    );
    const listener = vi.fn();
    const stop = preference.subscribe(listener);
    events.dispatchEvent(new StorageEvent("storage", { key: "notes.theme" }));
    expect(listener).not.toHaveBeenCalled();
    events.dispatchEvent(
      new StorageEvent("storage", { key: SETUP_PREFERENCE_KEY }),
    );
    events.dispatchEvent(new StorageEvent("storage", { key: null }));
    expect(listener).toHaveBeenCalledTimes(2);
    stop();
    expect(remove).toHaveBeenCalledOnce();
    events.dispatchEvent(
      new StorageEvent("storage", { key: SETUP_PREFERENCE_KEY }),
    );
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
