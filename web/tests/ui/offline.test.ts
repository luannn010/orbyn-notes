// @vitest-environment node
import { runInNewContext } from "node:vm";
import { describe, it, expect, vi } from "vitest";
import { serviceWorkerSource } from "../../src/ui/offline";
function worker() {
  const handlers: Record<string, (event: any) => void> = {};
  const cache = {
    addAll: vi.fn().mockResolvedValue(undefined),
    match: vi.fn().mockResolvedValue("cached-shell"),
  };
  const storage = {
    open: vi.fn().mockResolvedValue(cache),
    keys: vi
      .fn()
      .mockResolvedValue([
        "notes-scope-old",
        "notes-scope-new",
        "unrelated-cache",
      ]),
    delete: vi.fn().mockResolvedValue(true),
  };
  const fetch = vi.fn();
  runInNewContext(
    serviceWorkerSource(
      "notes-scope-new",
      ["/index.html", "/assets/editor.js", "/assets/crypto.wasm"],
      "/",
    ),
    {
      URL,
      self: {
        location: { origin: "https://notes.example" },
        addEventListener: (name: string, handler: (event: any) => void) =>
          (handlers[name] = handler),
      },
      caches: storage,
      fetch,
    },
  );
  return { handlers, cache, storage, fetch };
}
describe("offline shell cache boundary", () => {
  it("installs every immutable shell asset before completing", async () => {
    const { handlers, cache } = worker();
    let completion: Promise<void> | undefined;
    handlers.install!({ waitUntil: (p: Promise<void>) => (completion = p) });
    await completion;
    expect(cache.addAll).toHaveBeenCalledWith([
      "/index.html",
      "/assets/editor.js",
      "/assets/crypto.wasm",
    ]);
  });
  it("never intercepts account, session, note, export, cross-origin, POST or query requests", () => {
    const { handlers, storage } = worker();
    for (const [url, method, mode] of [
      ["https://notes.example/v1/sessions/current", "GET", "cors"],
      ["https://notes.example/notes/private", "GET", "navigate"],
      ["https://notes.example/export.md", "GET", "cors"],
      ["https://api.example/assets/editor.js", "GET", "cors"],
      ["https://notes.example/assets/editor.js", "POST", "cors"],
      ["https://notes.example/?token=secret", "GET", "navigate"],
    ]) {
      const respondWith = vi.fn();
      handlers.fetch!({ request: { url, method, mode }, respondWith });
      expect(respondWith).not.toHaveBeenCalled();
    }
    expect(storage.open).not.toHaveBeenCalled();
  });
  it("serves only the root shell and known static assets from its cache", async () => {
    const { handlers, cache } = worker();
    let response: Promise<string> | undefined;
    handlers.fetch!({
      request: {
        url: "https://notes.example/",
        method: "GET",
        mode: "navigate",
      },
      respondWith: (p: Promise<string>) => (response = p),
    });
    expect(await response).toBe("cached-shell");
    expect(cache.match).toHaveBeenCalledWith("/index.html");
  });
  it("only removes previous versions of its own scope when activated", async () => {
    const { handlers, storage } = worker();
    let completion: Promise<void> | undefined;
    handlers.activate!({ waitUntil: (p: Promise<void>) => (completion = p) });
    await completion;
    expect(storage.delete).toHaveBeenCalledExactlyOnceWith("notes-scope-old");
  });
});
