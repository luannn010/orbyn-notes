import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
const base = new URL(process.env.NOTES_PREVIEW_URL ?? "http://127.0.0.1:5179");
if (!["localhost", "127.0.0.1", "[::1]"].includes(base.hostname))
  throw new Error("Source-opening proof requires a loopback preview.");
const source = new URL("/tests/integration/source-proof.html", base).href;
const output =
  process.env.NOTES_UI_OUTPUT ?? "test-results/source-opening-browser";
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  await mkdir(output, { recursive: true });
  const context = await browser.newContext();
  const requests = [],
    errors = [];
  context.on("request", (request) => {
    if (request.url() === source) requests.push(request.url());
  });
  await context.addInitScript(() => localStorage.setItem("notes.editor.v1", JSON.stringify({textSize:"large",lineWidth:"wide",markdown:true,spellcheck:true})));
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(new URL("/tests/integration/clips-browser.html", base).href);
  await page.getByRole("button", { name: "Clips", exact: true }).click();
  await page
    .getByRole("button", { name: "Save a link", exact: true })
    .first()
    .click();
  const dialog = page.getByRole("dialog", { name: "Save a link", exact: true });
  await dialog.getByLabel("Clip URL").fill(source);
  await dialog.getByLabel("Title (optional)").fill("Controlled saved source");
  await dialog.getByLabel("Selected text (optional)").fill("Controlled pasted text for reader preferences.");
  await dialog.getByRole("button", { name: "Save link", exact: true }).click();
  const notice = page.getByRole("status").filter({ hasText: "Text clip saved" });
  await expect(notice).toBeVisible();
  await notice.getByRole("button", { name: "Open clip", exact: true }).click();
  expect(requests).toHaveLength(0);
  await expect(page.locator(".clip-text")).toHaveCSS("font-size", "16px");
  await expect(page.locator(".clip-reader-content")).toHaveCSS("max-width", "880px");
  const original = page.getByRole("link", {
    name: "Open original",
    exact: true,
  });
  await expect(original).toHaveAttribute("rel", "noopener noreferrer");
  const pending = page.waitForEvent("popup");
  await original.click();
  const popup = await pending;
  await expect(
    popup.getByRole("heading", { name: "Controlled clip source", exact: true }),
  ).toBeVisible();
  expect(popup.url()).toBe(source);
  expect(await popup.evaluate(() => window.opener === null)).toBe(true);
  expect(requests).toHaveLength(1);
  await expect(
    page.getByRole("button", { name: "Mark read", exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
  await popup.close();
  await writeFile(
    join(output, "result.json"),
    JSON.stringify(
      {
        qualified:
          "Actual browser source opening from a real-WASM/IndexedDB Clip under a synthetic account session. No native OS handoff or account-server qualification.",
        noFetchOnSave: true,
        oneExplicitLoopbackHandoff: true,
        openerNull: true,
        stillUnread: true,
        pageErrors: errors,
      },
      null,
      2,
    ),
  );
  console.log(
    "Controlled browser source opening passed; no prefetch, opener null, clip remains unread.",
  );
} finally {
  await browser.close();
}
