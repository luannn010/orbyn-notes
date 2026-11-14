import { beforeEach, expect, it, vi } from "vitest";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { openExternalUrl } from "../../src/desktop/external";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), isTauri: vi.fn() }));
beforeEach(() => {
  vi.mocked(isTauri).mockReturnValue(true);
  vi.mocked(invoke).mockReset();
});
it("hands off exactly one explicit valid URL using the restricted native command", async () => {
  vi.mocked(invoke).mockResolvedValue(undefined);
  const url = "https://example.test/source?q=one#passage";
  await openExternalUrl(url);
  expect(invoke).toHaveBeenCalledExactlyOnceWith("open_external_url", { url });
});
it.each([
  "javascript:alert(1)",
  "file:///C:/Windows/win.ini",
  "mailto:synthetic@example.test",
  "//example.test",
  "https:example.test",
  "https:///example.test",
  "https://@example.test",
  "https://user:synthetic@example.test/",
  "https://example.test/a b",
  "https://example.test/\n",
  "https://example.test/\0",
  String.raw`https://example.test\other`,
  "https://example.test/" + "a".repeat(8192),
])(
  "rejects an unsafe destination before invoking native APIs: %s",
  async (url) => {
    await expect(openExternalUrl(url)).rejects.toThrow("Copy its URL");
    expect(invoke).not.toHaveBeenCalled();
  },
);
it("reports bridge failure without leaking the URI or platform error", async () => {
  vi.mocked(invoke).mockRejectedValue(
    new Error("Synthetic internal path and URI"),
  );
  await expect(openExternalUrl("https://example.test/")).rejects.toThrow(
    "Copy its URL",
  );
});
it("does not simulate native opening in a browser", async () => {
  vi.mocked(isTauri).mockReturnValue(false);
  await expect(openExternalUrl("https://example.test/")).rejects.toThrow(
    "Copy its URL",
  );
  expect(invoke).not.toHaveBeenCalled();
});
