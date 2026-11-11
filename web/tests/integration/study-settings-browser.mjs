import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
const output =
  process.env.NOTES_UI_OUTPUT ?? "test-results/study-settings-browser";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({
  viewport: { width: 1160, height: 850 },
});
const page = await context.newPage(),
  errors = [];
page.on("pageerror", (e) => errors.push(e.message));
async function open(expected = "10") {
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Settings", exact: true });
  await dialog.getByRole("button", { name: "Study", exact: true }).click();
  await expect(
    dialog.getByRole("textbox", { name: "New cards per day", exact: true }),
  ).toHaveValue(expected);
  return dialog;
}
try {
  await page.goto(
    `${process.env.NOTES_PREVIEW_URL ?? "http://127.0.0.1:5179"}/tests/integration/study-settings-browser.html`,
  );
  await expect(
    page.getByRole("heading", { name: "All notes", exact: true }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const { checkClose } = await import("/src/desktop/closeGuard.ts");
        return checkClose();
      }),
    )
    .toBe("allowed");
  const before = await page.evaluate(() =>
    window.__studySettingsFixture.metadata(),
  );
  let dialog = await open();
  await dialog
    .getByRole("textbox", { name: "New cards per day", exact: true })
    .fill("2");
  await dialog
    .getByRole("textbox", { name: "Reviews per day", exact: true })
    .fill("20000");
  await dialog
    .getByRole("combobox", { name: "Day starts at", exact: true })
    .selectOption("23");
  await dialog
    .getByRole("switch", {
      name: "Show next review on answer buttons",
      exact: true,
    })
    .uncheck();
  await dialog
    .getByRole("switch", { name: "Show streak", exact: true })
    .uncheck();
  await dialog
    .getByRole("button", { name: "Save changes", exact: true })
    .click();
  await expect(
    dialog.getByText("Saved on this device.", { exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("textbox", { name: "New cards per day", exact: true }),
  ).toBeEnabled();
  const saved = await page.evaluate(() =>
    window.__studySettingsFixture.metadata(),
  );
  expect(saved.preferences).toMatchObject({
    newPerDay: 2,
    reviewsPerDay: 20000,
    dayStartHour: 23,
    showNextReview: false,
    showStreak: false,
  });
  expect(saved.cards).toEqual(before.cards);
  expect(saved.events).toEqual(before.events);
  expect(saved.preferences.algorithm).toBe(before.preferences.algorithm);
  expect(saved.preferences.timezone).toBe(before.preferences.timezone);
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "All notes", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "Settings", exact: true });
  await dialog.getByRole("button", { name: "Study", exact: true }).click();
  await expect(
    dialog.getByRole("textbox", { name: "New cards per day", exact: true }),
  ).toHaveValue("2");
  const limit = () =>
    dialog.getByRole("textbox", { name: "New cards per day", exact: true });
  await limit().fill("1.5");
  await dialog
    .getByRole("button", { name: "Save changes", exact: true })
    .click();
  await expect(limit()).toHaveValue("1.5");
  await expect(limit()).toHaveAttribute("aria-invalid", "true");
  expect(
    (await page.evaluate(() => window.__studySettingsFixture.metadata()))
      .preferences.newPerDay,
  ).toBe(2);
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  let confirm = page.getByRole("dialog", {
    name: "Unsaved Study changes",
    exact: true,
  });
  await expect(
    confirm.getByRole("button", { name: "Save and continue" }),
  ).toBeDisabled();
  await confirm.getByRole("button", { name: "Keep editing" }).click();
  await page.keyboard.press("Escape");
  confirm = page.getByRole("dialog", {
    name: "Unsaved Study changes",
    exact: true,
  });
  await confirm.getByRole("button", { name: "Keep editing" }).click();
  await dialog.getByRole("button", { name: "Editor", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Unsaved Study changes", exact: true })
    .getByRole("button", { name: "Discard and continue" })
    .click();
  await expect(
    dialog.getByRole("heading", { name: "Editor", exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByText(
      "Planned · Opening backlinks by default isn’t available yet. Use Links and backlinks in a note.",
      { exact: true },
    ),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Study", exact: true }).click();
  await expect(limit()).toHaveValue("2");
  await limit().fill("3");
  await page.evaluate(() =>
    window.__studySettingsFixture.setPreferences({
      reviewsPerDay: 77,
      showStreak: true,
    }),
  );
  await expect(
    dialog.getByRole("button", { name: "Reload latest (keep edits)" }),
  ).toBeVisible();
  await dialog
    .getByRole("button", { name: "Reload latest (keep edits)" })
    .click();
  await expect(limit()).toHaveValue("3");
  await expect(
    dialog.getByRole("textbox", { name: "Reviews per day", exact: true }),
  ).toHaveValue("77");
  await expect(
    dialog.getByRole("switch", { name: "Show streak", exact: true }),
  ).toBeChecked();
  await dialog
    .getByRole("button", { name: "Save changes", exact: true })
    .click();
  await expect(
    dialog.getByText("Saved on this device.", { exact: true }),
  ).toBeVisible();
  const conflictSaved = await page.evaluate(() =>
    window.__studySettingsFixture.metadata(),
  );
  expect(conflictSaved.preferences).toMatchObject({
    newPerDay: 3,
    reviewsPerDay: 77,
    showStreak: true,
  });
  expect(conflictSaved.cards).toEqual(before.cards);
  expect(conflictSaved.events).toEqual(before.events);
  await dialog
    .getByRole("combobox", { name: "Day starts at", exact: true })
    .selectOption("2");
  await dialog
    .getByRole("switch", { name: "Show streak", exact: true })
    .uncheck();
  await dialog
    .getByRole("switch", {
      name: "Show next review on answer buttons",
      exact: true,
    })
    .check();
  await page.evaluate(() =>
    window.__studySettingsFixture.setPreferences({ dayStartHour: 3 }),
  );
  const actualConflict = await page.evaluate(() =>
    window.__studySettingsFixture.metadata(),
  );
  await dialog
    .getByRole("button", { name: "Reload latest (keep edits)" })
    .click();
  await expect(
    dialog.getByText("Latest settings loaded. Your edits are still here.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("combobox", { name: "Day starts at", exact: true }),
  ).toHaveValue("2");
  await expect(
    dialog.getByText("Saved value: 03:00", { exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByText("Saved value: On", { exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByText("Saved value: Off", { exact: true }),
  ).toBeVisible();
  expect(
    (await page.evaluate(() => window.__studySettingsFixture.metadata()))
      .revision,
  ).toBe(actualConflict.revision);
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Discard Study changes?", exact: true })
    .getByRole("button", { name: "Discard changes", exact: true })
    .click();
  await expect(
    dialog.getByRole("combobox", { name: "Day starts at", exact: true }),
  ).toHaveValue("3");
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  await page.getByRole("button", { name: "Study", exact: true }).click();
  await page
    .getByRole("button", { name: "Study 3 cards", exact: true })
    .click();
  await page.getByRole("button", { name: "Show answer", exact: true }).click();
  await expect(
    page.getByRole("article", { name: "Card answer" }),
  ).toBeVisible();
  const answer = await page
    .getByRole("article", { name: "Card answer" })
    .innerText();
  expect(await page.locator(".study-grades time").count()).toBe(0);
  dialog = await open("3");
  await limit().fill("0");
  await dialog
    .getByRole("combobox", { name: "Day starts at", exact: true })
    .selectOption("0");
  await dialog
    .getByRole("switch", {
      name: "Show next review on answer buttons",
      exact: true,
    })
    .check();
  expect(await page.locator(".study-grades time").count()).toBe(0);
  await dialog
    .getByRole("button", { name: "Save changes", exact: true })
    .click();
  await expect(
    dialog.getByText("Saved on this device.", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".study-grades time")).toHaveCount(4);
  expect(
    await page
      .getByRole("article", { name: "Card answer", includeHidden: true })
      .innerText(),
  ).toBe(answer);
  expect(
    await page
      .getByRole("progressbar", {
        name: "Review progress",
        includeHidden: true,
      })
      .getAttribute("aria-valuemax"),
  ).toBe("3");
  expect(
    (await page.evaluate(() => window.__studySettingsFixture.metadata()))
      .events,
  ).toEqual(before.events);
  for (const theme of ["light", "dark", "dim"]) {
    await page.evaluate(
      (value) => (document.documentElement.dataset.theme = value),
      theme,
    );
    await dialog.evaluate(async (element) => {
      await Promise.all(
        element
          .getAnimations({ subtree: true })
          .map((animation) => animation.finished.catch(() => {})),
      );
    });
    const computed = await limit().evaluate((element) => {
      const css = getComputedStyle(element);
      return { width: css.width, height: css.height, radius: css.borderRadius };
    });
    expect(computed).toEqual({ width: "100px", height: "32px", radius: "8px" });
    expect(
      await dialog
        .locator(".settings-heading h3")
        .evaluate((element) => getComputedStyle(element).fontSize),
    ).toBe("22px");
    expect(
      await dialog
        .getByRole("switch", { name: "Show streak", exact: true })
        .evaluate((element) => ({
          width: getComputedStyle(element).width,
          height: getComputedStyle(element).height,
        })),
    ).toEqual({ width: "30px", height: "18px" });
    await page.screenshot({ path: output + `/study-settings-${theme}.png` });
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 390, height: 844 });
  await dialog.evaluate(async (element) => {
    await Promise.all(
      element
        .getAnimations({ subtree: true })
        .map((animation) => animation.finished.catch(() => {})),
    );
  });
  await expect(limit()).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await dialog
    .getByRole("button", { name: "Save changes", exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({
    path: output + "/study-settings-narrow-dim-reduced.png",
  });
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  await expect(
    page.getByRole("article", { name: "Card answer" }),
  ).toBeVisible();
  expect(
    await page.getByRole("article", { name: "Card answer" }).innerText(),
  ).toBe(answer);
  await page.getByRole("button", { name: /^Good/ }).click();
  await expect
    .poll(
      async () =>
        (await page.evaluate(() => window.__studySettingsFixture.metadata()))
          .events.length,
    )
    .toBe(1);
  await expect(
    page.getByRole("button", { name: "Undo", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(
    page.getByRole("article", { name: "Card answer" }),
  ).toBeVisible();
  await page.setViewportSize({ width: 1160, height: 850 });
  dialog = await open("0");
  await limit().fill("10000");
  await dialog
    .getByRole("button", { name: "Save changes", exact: true })
    .click();
  await expect(
    dialog.getByText("Saved on this device.", { exact: true }),
  ).toBeVisible();
  expect(
    (await page.evaluate(() => window.__studySettingsFixture.metadata()))
      .preferences.newPerDay,
  ).toBe(10000);
  await limit().fill("123");
  await page.evaluate(() => window.__studySettingsFixture.erase());
  await expect(
    page.getByRole("textbox", { name: "New cards per day", exact: true }),
  ).toHaveCount(0);
  expect(errors).toEqual([]);
  await writeFile(
    output + "/result.json",
    JSON.stringify(
      {
        checks: [
          "actual owner before Study visit",
          "five prefs commit/reopen encrypted",
          "cards/events/timezone/algorithm unchanged",
          "raw invalid input and Done/Escape/section guards",
          "real independent CAS conflict keeps dirty keys",
          "conflict hour and boolean saved-value disclosure without auto write",
          "held revealed review survives caps/day/visibility save and real grade Undo",
          "all three themes, narrow/reduced layout, full producer bounds, epoch clears draft",
        ],
        pageErrors: errors,
      },
      null,
      2,
    ),
  );
  console.log("Study settings encrypted browser journey passed");
} catch (e) {
  await page.screenshot({ path: output + "/failure.png", fullPage: true });
  await writeFile(
    output + "/failure.txt",
    String(e) +
      "\nURL " +
      page.url() +
      "\n" +
      (await page.locator("body").innerText()),
  );
  throw e;
} finally {
  await browser.close();
}
