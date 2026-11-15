import { chromium, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const output = process.env.NOTES_UI_OUTPUT ?? "test-results/note-list-rows";
const base = process.env.NOTES_PREVIEW_URL ?? "http://127.0.0.1:5188";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1160, height: 800 } });
try {
  await page.goto(`${base}/tests/integration/library-browser.html`);
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(async () => (await document.fonts.load('400 13px Geist')).length)).toBeGreaterThan(0);
  await expect(page.getByRole("heading", { name: "All notes", exact: true })).toBeVisible();
  await page.locator("#main").getByRole("button", { name: "New note", exact: true }).first().click();
  const title = "A long note title that must remain available to assistive technology and never overlap the date";
  await page.getByLabel("Note title", { exact: true }).fill(title);
  await page.getByLabel("Note content", { exact: true }).fill("A long preview that should truncate gracefully while the complete note remains accessible.");
  const manageTags = page.getByRole("button", { name: "Manage note tags", exact: true });
  if (await manageTags.isVisible()) await manageTags.click();
  await page.getByLabel("Tags, separated by commas", { exact: true }).fill("A very long descriptive tag name");
  await page.getByRole("textbox", { name: "Tags, separated by commas", exact: true }).press("Enter");
  await expect(page.getByText(/^Saved (?:in this browser|on this device)$/, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /Back to notes/ }).click();
  await page.getByRole("button", { name: "Manage tags", exact: true }).click();
  await page.getByRole("button", { name: "Tag menu for A very long descriptive tag name" }).click();
  await page.getByRole("menuitem", { name: "Change color" }).click();
  const colorDialog = page.getByRole("dialog", { name: "Change color" });
  await colorDialog.getByRole("button", { name: "Blue", exact: true }).click();
  await colorDialog.getByRole("button", { name: "Save color", exact: true }).click();
  await expect(colorDialog).toHaveCount(0);
  await page.getByRole("button", { name: /^All notes/ }).click();
  const row = page.locator(".note-collection:not(.grid) .note-row").first();
  const open = row.locator(".note-open");
  await expect(open).toHaveAccessibleName(new RegExp(title));
  const tagColor = await row.locator(".note-list-tag-dot").evaluate((element) => element.style.background);
  expect(tagColor).not.toBe("");
  await expect(open).toHaveAccessibleName(/A very long descriptive tag name/);
  const pin = row.getByRole("button", { name: new RegExp(`^Pin ${title}`) });
  await pin.click();
  await expect(row.getByRole("button", { name: new RegExp(`^Unpin ${title}`) })).toHaveAttribute("aria-pressed", "true");
  await expect(row.locator(".note-list-lead svg")).toHaveAttribute("data-icon", "pin");
  for (const theme of ["light", "dark", "dim"]) {
    await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
    for (const width of [null, 300]) {
      await page.locator(".note-collection:not(.grid)").evaluate((element, width) => { element.style.width = width ? `${width}px` : ""; }, width);
      const metrics = await open.evaluate((element) => {
        const title = element.querySelector("h2").getBoundingClientRect();
        const metadata = element.querySelector(".metadata").getBoundingClientRect();
        const style = getComputedStyle(element);
        return { titleBottom: title.bottom, metaTop: metadata.top, display: style.display, columns: style.gridTemplateColumns, padding: style.padding, titleRight: title.right, metaLeft: metadata.left, rowWidth: element.getBoundingClientRect().width, scrollWidth: element.scrollWidth, clientWidth: element.clientWidth };
      });
      expect(metrics.display).toBe("grid");
      expect(metrics.padding).toBe("9px 12px");
      if (width === 300) expect(metrics.titleBottom).toBeLessThanOrEqual(metrics.metaTop);
      else expect(metrics.titleRight).toBeLessThanOrEqual(metrics.metaLeft);
      expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth);
      await page.screenshot({ path: `${output}/${theme}-${width ?? "wide"}.png` });
    }
  }
  await page.locator(".note-collection:not(.grid)").evaluate((element) => { element.style.width = ""; });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(row.getByRole("button", { name: new RegExp(`^Unpin ${title}`) })).toBeInViewport();
  await page.setViewportSize({ width: 1160, height: 800 });
  await page.getByRole("button", { name: "Grid view", exact: true }).click();
  await expect(page.locator(".grid .note-row")).toBeVisible();
  await expect(page.locator(".grid .note-list-lead")).toBeHidden();
  await page.getByRole("button", { name: "List view", exact: true }).click();
  await open.click();
  await expect(page.getByLabel("Note title", { exact: true })).toHaveValue(title);
  await page.getByRole("button", { name: "Note menu", exact: true }).click();
  await page.getByRole("menuitem", { name: "Move to Trash", exact: true }).click();
  await page.getByRole("button", { name: /^Trash/ }).click();
  const trashed = page.locator(".note-row").first();
  await expect(trashed.getByRole("button", { name: "Restore", exact: true })).toBeVisible();
  expect(await trashed.evaluate((element) => getComputedStyle(element).borderTopWidth)).toBe("1px");
  console.log("Compact list rows: themes, 300px, pin, grid, open and trash passed");
} finally {
  await browser.close();
}
