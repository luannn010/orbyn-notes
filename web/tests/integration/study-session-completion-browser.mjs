import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

// Run with the local Vite server: node tests/integration/study-session-completion-browser.mjs
// NOTES_PREVIEW_URL selects its origin; NOTES_UI_OUTPUT selects diagnostics.
// Disposable browser profile and synthetic account; real WASM and IndexedDB.
const output =
  process.env.NOTES_UI_OUTPUT ?? "test-results/study-session-completion";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  channel: process.env.PLAYWRIGHT_CHANNEL ?? "chrome",
  headless: true,
});
const context = await browser.newContext({
  viewport: { width: 1160, height: 760 },
});
const page = await context.newPage();
const errors = [];
let stage = "start";
page.on("pageerror", (error) => errors.push(error.message));
const read = () =>
  page.evaluate(async () => (await window.__collectionsFixture.read()).study);
const progress = page.getByRole("progressbar", { name: "Review progress" });
const card = page.locator('.study-flash[data-study-motion="stable"]');
async function question(position, front) {
  await expect(progress).toHaveAttribute("aria-valuenow", String(position));
  await expect(card).toHaveAttribute("aria-label", "Card question");
  await expect(card).toContainText(front);
}
async function answer(front, back) {
  await expect(card).toContainText(front);
  await card.getByRole("button", { name: "Show answer" }).click();
  await expect(card).toHaveAttribute("aria-label", "Card answer");
  await expect(card).toContainText(front);
  await expect(card).toContainText(back);
  await expect(page.getByRole("button", { name: /^Good/ })).toBeEnabled();
}
try {
  await page.goto(
    `${process.env.NOTES_PREVIEW_URL ?? "http://127.0.0.1:5179"}/tests/integration/collections-browser.html`,
  );
  await expect(page.getByText("No decks yet", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "New deck", exact: true })
    .first()
    .click();
  const deck = page.getByRole("dialog", { name: "New deck" });
  await deck.getByLabel("Name").fill("Completion regression");
  await deck.getByRole("button", { name: "Create deck" }).click();
  for (let i = 1; i <= 2; i++) {
    await page
      .getByRole("button", { name: "Add card", exact: true })
      .first()
      .click();
    const dialog = page.getByRole("dialog", { name: "Add card" });
    await dialog.getByLabel("Front", { exact: true }).fill(`Question ${i}`);
    await dialog.getByLabel("Back", { exact: true }).fill(`Answer ${i}`);
    await dialog.getByRole("button", { name: "Add card", exact: true }).click();
    await expect(dialog).toHaveCount(0);
  }
  const initial = await read();
  expect(initial.cards).toHaveLength(2);
  expect(initial.events).toHaveLength(0);
  await page.getByRole("button", { name: /^Study 2 cards$/ }).click();
  await expect(progress).toHaveAttribute("aria-valuenow", "0");
  await expect(card).toHaveAttribute("aria-label", "Card question");
  const front = await card.locator(".study-question").innerText();
  const entry = initial.entries.find((item) => item.front === front);
  expect(entry).toBeTruthy();
  const first = initial.cards.find((item) => item.entryId === entry.id);
  const other = initial.entries.find((item) => item.id !== entry.id);
  expect(first).toBeTruthy();
  expect(other).toBeTruthy();
  stage = "reveal and commit first grade";
  await answer(front, entry.back);
  await page.getByRole("button", { name: /^Good/ }).click();
  await expect.poll(async () => (await read()).events.length).toBe(1);
  const graded = await read();
  const event = graded.events[0];
  expect(event).toMatchObject({
    cardId: first.id,
    grade: "good",
    undoneAt: null,
  });
  expect(event.sessionId).toBeTruthy();
  expect(graded.cards.find((item) => item.id === first.id).schedule).toEqual(
    event.after.schedule,
  );
  expect(event.before.schedule).toEqual(first.schedule);
  await question(1, other.front);
  stage = "undo committed grade";
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect
    .poll(async () => (await read()).events[0]?.undoneAt)
    .not.toBeNull();
  await expect(progress).toHaveAttribute("aria-valuenow", "0");
  await expect(card).toHaveAttribute("aria-label", "Card answer");
  await expect(card).toContainText(front);
  await expect(card).toContainText(entry.back);
  const undone = await read();
  expect(undone.cards.find((item) => item.id === first.id).schedule).toEqual(
    first.schedule,
  );
  stage = "review both cards";
  await expect(page.getByRole("button", { name: /^Good/ })).toBeEnabled();
  await page.getByRole("button", { name: /^Good/ }).click();
  await expect
    .poll(
      async () => (await read()).events.filter((item) => !item.undoneAt).length,
    )
    .toBe(1);
  await question(1, other.front);
  await answer(other.front, other.back);
  await page.getByRole("button", { name: /^Good/ }).click();
  await expect(
    page.getByRole("heading", { name: "Done for today", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("2 cards reviewed", { exact: true }),
  ).toBeVisible();
  const completed = await read();
  const active = completed.events.filter((item) => !item.undoneAt);
  expect(active).toHaveLength(2);
  expect(new Set(active.map((item) => item.cardId))).toEqual(
    new Set(initial.cards.map((item) => item.id)),
  );
  expect(
    active.every(
      (item) => item.sessionId === event.sessionId && item.grade === "good",
    ),
  ).toBe(true);
  for (const item of active)
    expect(completed.cards.find((c) => c.id === item.cardId).schedule).toEqual(
      item.after.schedule,
    );
  stage = "persisted progress";
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Progress", exact: true }),
  ).toBeVisible();
  const reopened = await read();
  expect(reopened.events).toEqual(completed.events);
  expect(reopened.cards).toEqual(completed.cards);
  await page.getByRole("button", { name: "Progress", exact: true }).click();
  const stat = (label) =>
    page.locator(".study-stat").filter({ hasText: label }).locator("b");
  await expect(stat("Reviews, last 30 days")).toHaveText(String(active.length));
  await expect(stat("Cards")).toHaveText(String(reopened.cards.length));
  await expect(stat("Remembered, last 30 days")).toHaveText("100%");
  expect(errors).toEqual([]);
  stage = "passed";
  await writeFile(
    join(output, "result.json"),
    JSON.stringify(
      {
        stage,
        activeReviews: active.length,
        cards: reopened.cards.length,
        errors,
      },
      null,
      2,
    ),
  );
  console.log("PASS: committed grade, undo, completion and persisted Progress");
} catch (error) {
  const state = await read().catch(() => null);
  await page
    .screenshot({ path: join(output, "failure.png"), fullPage: true })
    .catch(() => {});
  await writeFile(
    join(output, "result.json"),
    JSON.stringify({ stage, error: String(error), errors, state }, null, 2),
  );
  throw error;
} finally {
  await context.close();
  await browser.close();
}
