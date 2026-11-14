import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";

const output = process.env.NOTES_UI_OUTPUT ?? "test-results/study-toast-pause";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({
  viewport: { width: 1160, height: 850 },
});
const page = await context.newPage(),
  errors = [];
let stage = "boot";
page.on("pageerror", (error) => errors.push(error.message));
try {
  const now = new Date();
  await page.clock.install({ time: now });
  await page.goto(
    `${process.env.NOTES_PREVIEW_URL ?? "http://127.0.0.1:5179"}/tests/integration/study-settings-browser.html`,
  );
  await expect(
    page.getByRole("heading", { name: "All notes", exact: true }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(async () =>
        (await import("/src/desktop/closeGuard.ts")).checkClose(),
      ),
    )
    .toBe("allowed");
  await page.getByRole("button", { name: "Study", exact: true }).click();
  await page.getByRole("button", { name: /^Study 4 cards$/ }).click();
  await page.getByRole("button", { name: "Show answer", exact: true }).click();
  // Bootstrap needs its actual queued work. Freeze after the real answer exists,
  // before creating the toast whose presentation lifetime is under test.
  const beforeGrade = await page.evaluate(() => Date.now());
  await page.clock.pauseAt(new Date(beforeGrade + 1000));
  await page.getByRole("button", { name: /^Good/ }).click();
  const toast = page.locator(".study-toast"),
    undo = toast.getByRole("button", { name: "Undo", exact: true });
  await expect(toast).toBeVisible();
  await page.clock.fastForward(1000);
  await toast.hover();
  await undo.focus();
  await page.mouse.move(1140, 5);
  await expect(undo).toBeFocused();
  stage = "focus-remains-after-pointer-leave";
  await page.clock.fastForward(6000);
  await expect(toast).toBeVisible();
  await expect(undo).toBeFocused();
  const held = await page.evaluate(() =>
    window.__studySettingsFixture.metadata(),
  );
  expect(held.events).toHaveLength(1);
  stage = "resume-remaining-time";
  await page.getByRole("button", { name: "End session", exact: true }).focus();
  await page.clock.fastForward(3999);
  await expect(toast).toBeVisible();
  await page.clock.fastForward(501);
  await expect(toast).toHaveCount(0);
  const after = await page.evaluate(() =>
    window.__studySettingsFixture.metadata(),
  );
  expect(after.events).toEqual(held.events);
  expect(after.cards).toEqual(held.cards);
  stage = "settings-cover-pause";
  await page.getByRole("button", { name: "Show answer", exact: true }).click();
  await page.getByRole("button", { name: /^Good/ }).click();
  await expect(toast).toBeVisible();
  await page.clock.fastForward(1000);
  await expect
    .poll(() =>
      page.evaluate(async () =>
        (await import("/src/desktop/closeGuard.ts")).checkClose(),
      ),
    )
    .toBe("allowed");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "Settings", exact: true });
  await expect(settings).toBeVisible();
  await page.clock.fastForward(6000);
  await expect(toast).toHaveCount(1);
  const covered = await page.evaluate(() =>
    window.__studySettingsFixture.metadata(),
  );
  expect(covered.events).toHaveLength(2);
  await settings.getByRole("button", { name: "Done", exact: true }).click();
  await expect(settings).toHaveCount(0);
  await page.clock.fastForward(3999);
  await expect(toast).toBeVisible();
  await page.clock.fastForward(501);
  await expect(toast).toHaveCount(0);
  const uncovered = await page.evaluate(() =>
    window.__studySettingsFixture.metadata(),
  );
  expect(uncovered.events).toEqual(covered.events);
  expect(uncovered.cards).toEqual(covered.cards);
  expect(errors).toEqual([]);
  stage = "passed";
  await writeFile(
    `${output}/result.json`,
    JSON.stringify(
      {
        qualified:
          "Disposable synthetic account; actual App/WASM/IndexedDB with browser-controlled presentation clock. No native input, account backend or real-time frame-rate claim.",
        stage,
        eventCount: uncovered.events.length,
        cardsAndEventsUnchangedByToastExpiry: true,
        settingsCoverPause: true,
        errors,
      },
      null,
      2,
    ),
  );
  console.log(
    "PASS: actual focused toast survives pointer leave and resumes only its remaining dwell; expiry does not change grades.",
  );
} catch (error) {
  await writeFile(
    `${output}/result.json`,
    JSON.stringify({ stage, error: String(error), errors }, null, 2),
  );
  throw error;
} finally {
  await context.close();
  await browser.close();
}
