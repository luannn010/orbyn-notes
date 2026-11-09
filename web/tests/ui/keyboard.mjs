import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const output =
  process.env.NOTES_UI_OUTPUT ??
  fileURLToPath(new URL("../../test-results/ui-keyboard/", import.meta.url));
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
});
const context = await browser.newContext({
  viewport: { width: 1160, height: 700 },
  colorScheme: "dark",
  reducedMotion: "reduce",
});
const page = await context.newPage();
const steps = [];
await page.addInitScript(() => {
  window.__keyboardEvents = [];
  document.addEventListener(
    "keydown",
    (event) =>
      window.__keyboardEvents.push({
        key: event.key,
        tag: event.target?.tagName,
        label: event.target?.getAttribute("aria-label"),
        text: event.target?.textContent?.slice(0, 60),
      }),
    true,
  );
});
async function tabTo(locator) {
  for (let i = 0; i < 35; i++) {
    await page.keyboard.press("Tab");
    if (await locator.evaluate((el) => document.activeElement === el)) return;
  }
  throw new Error(
    "Keyboard could not reach " + (await locator.getAttribute("aria-label")),
  );
}
async function activate(locator, label) {
  await tabTo(locator);
  await expect(locator).toBeFocused();
  await locator.press("Enter");
  steps.push(label);
}
try {
  await page.goto("http://127.0.0.1:5177/tests/ui/preview.html");
  await expect(page.locator(".note-row")).toHaveCount(2);
  await tabTo(page.getByLabel("Search notes", { exact: true }));
  await page.keyboard.type("quiet");
  await expect(page.locator(".note-row")).toHaveCount(1);
  steps.push("Tab to Search and type");
  await activate(page.locator(".note-open"), "Open note with Enter");
  await expect(page.locator(".editor-pane")).toBeVisible();
  expect(
    await page
      .locator(".editor-pane")
      .evaluate((el) => getComputedStyle(el).animationName),
  ).toBe("none");
  expect(
    await page.evaluate(() => document.documentElement.dataset.theme),
  ).toBe("dark");
  await tabTo(page.getByLabel("Note title", { exact: true }));
  await page.keyboard.press("Control+A");
  await page.keyboard.type("Keyboard journey");
  await expect(
    page.getByText("Saved in this browser", { exact: true }),
  ).toBeVisible();
  steps.push("Edit title with keyboard and await persistence");
  await activate(
    page.getByRole("button", { name: "Note menu", exact: true }),
    "Open note menu",
  );
  await activate(
    page.getByRole("button", { name: "Move to Trash", exact: true }),
    "Move to Trash",
  );
  await expect(page.locator(".notice")).toContainText("Note moved to Trash");
  await activate(
    page.getByRole("button", { name: "Undo", exact: true }),
    "Undo Trash",
  );
  await expect(page.locator(".notice")).toContainText("Note restored");
  await tabTo(page.getByLabel("Search notes", { exact: true }));
  await page.keyboard.press("Control+A");
  await page.keyboard.press("Backspace");
  await expect(page.locator(".note-row")).toHaveCount(2);
  await activate(
    page.getByRole("button", { name: "Settings", exact: true }),
    "Open Settings",
  );
  const settings = page.getByRole("dialog", { name: "Settings", exact: true });
  await expect(settings).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(settings).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: "Settings", exact: true }),
  ).toBeFocused();
  steps.push("Escape closes native dialog and restores Settings focus");
  await activate(
    page.getByRole("button", { name: "Settings", exact: true }),
    "Reopen Settings",
  );
  await activate(
    settings.getByRole("button", { name: "Export all notes", exact: true }),
    "Open export warning",
  );
  const exportDialog = page.getByRole("dialog", {
    name: "Export Markdown",
    exact: true,
  });
  await expect(exportDialog).toBeVisible();
  await activate(
    exportDialog.getByRole("button", { name: "Export", exact: true }),
    "Prepare ZIP with keyboard",
  );
  await page.keyboard.press("Escape");
  await expect(page.locator(".notice")).toContainText("Export prepared");
  await page.screenshot({ path: `${output}/keyboard-final.png` });
  await writeFile(
    `${output}/results.json`,
    JSON.stringify(
      {
        fixture: true,
        steps,
        systemDark: true,
        systemReducedMotion: true,
        passed: true,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ passed: true, steps }, null, 2));
} catch (error) {
  await page.screenshot({ path: `${output}/failure.png` });
  await writeFile(
    `${output}/results.json`,
    JSON.stringify(
      {
        fixture: true,
        steps,
        passed: false,
        error: String(error),
        keyEvents: await page.evaluate(() => window.__keyboardEvents),
      },
      null,
      2,
    ),
  );
  throw error;
} finally {
  await browser.close();
}
