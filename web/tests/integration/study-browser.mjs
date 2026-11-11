import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

// Run with the local Vite server. Auth is a synthetic session; encryption/storage
// are the actual production adapters. This does not qualify account-server entry.
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? "chrome", headless: true });
const output = process.env.NOTES_UI_OUTPUT ?? "test-results/study-browser";
try {
  const page = await browser.newPage({ viewport: { width: 1160, height: 760 } });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(`${process.env.NOTES_PREVIEW_URL ?? "http://127.0.0.1:5179"}/tests/integration/collections-browser.html`);
  await expect(page.getByText("No decks yet", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "New deck", exact: true }).first().click();
  await page.getByRole("dialog", { name: "New deck" }).getByLabel("Name").fill("Encrypted browser study");
  await page.getByRole("button", { name: "Create deck", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Encrypted browser study" })).toBeVisible();
  await page.getByRole("button", { name: "Add card", exact: true }).first().click();
  const dialog = page.getByRole("dialog", { name: "Add card" });
  await dialog.getByLabel("Front", { exact: true }).fill("Synthetic question");
  await dialog.getByLabel("Back", { exact: true }).fill("Synthetic answer");
  await dialog.getByRole("button", { name: "Add card", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const before = await page.evaluate(() => window.__collectionsFixture.read());
  if (before.study.cards.length !== 1) throw new Error("Card not committed");
  await page.reload();
  await expect(page.getByRole("button", { name: "Encrypted browser study", exact: true })).toBeVisible();
  await page.getByRole("button", { name: /^Study 1 card$/ }).click();
  await page.getByRole("button", { name: "Show answer", exact: true }).click();
  await page.getByRole("button", { name: /^Good/ }).click();
  await expect(page.getByRole("heading", { name: "Done for today" })).toBeVisible();
  const after = await page.evaluate(() => window.__collectionsFixture.read());
  if (after.study.events.length !== 1 || after.study.cards[0].schedule.state !== "review") throw new Error("Grade not persisted");
  await page.reload();
  await expect(page.getByRole("button", { name: "Encrypted browser study", exact: true })).toBeVisible();
  const persisted = await page.evaluate(() => window.__collectionsFixture.read());
  if (persisted.study.events.length !== 1) throw new Error("Review lost on reopen");
  await page.evaluate(() => window.__collectionsFixture.erase());
  await expect(page.getByText("No decks yet", { exact: true })).toBeVisible();
  if (errors.length) throw new Error(errors.join("\n"));
  await mkdir(output, { recursive: true });
  await writeFile(join(output, "result.json"), JSON.stringify({ harness: "Synthetic account session; real WASM + IndexedDB; no account-server qualification", passed: ["create deck", "create card", "reopen persisted card", "grade changes schedule", "reopen review event", "erase invalidates view"], errors }, null, 2));
  console.log("Encrypted Study browser journey passed: create, reopen, grade, reopen, erase.");
} finally { await browser.close(); }
