import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { openNoteTags } from "./note-tag-controls.mjs";

const base = process.env.NOTES_PREVIEW_URL ?? "http://127.0.0.1:5188";
const output = process.env.NOTES_UI_OUTPUT ?? "test-results/note-metadata";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1160, height: 800 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const samples = [];
try {
  await page.goto(`${base}/tests/integration/library-browser.html`);
  await page
    .locator("#main")
    .getByRole("button", { name: "New note", exact: true })
    .first()
    .click();
  await page
    .getByLabel("Note title", { exact: true })
    .fill("A long note title that wraps while writing stays first");
  await page
    .getByLabel("Note content", { exact: true })
    .fill("Synthetic encrypted writing retained through tag controls.");
  await expect(
    page.getByText("Saved in this browser", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "New tag", exact: true }),
  ).toBeHidden();
  const trigger = page.getByRole("button", {
    name: "Manage note tags",
    exact: true,
  });
  await trigger.focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("textbox", { name: "New tag", exact: true }),
  ).toBeFocused();
  for (const tag of [
    "Averylongunbrokentagthatstillhasitscompleteaccessibletext",
    "café",
  ]) {
    await page.getByLabel("New tag", { exact: true }).fill(tag);
    await page.getByRole("button", { name: "Add tag", exact: true }).click();
    await expect(
      page.getByText("Saved in this browser", { exact: true }),
    ).toBeVisible();
  }
  const openBody = (
    await page.getByLabel("Note content", { exact: true }).boundingBox()
  ).y;
  await page
    .getByRole("button", { name: "Done editing tags", exact: true })
    .click();
  await expect(trigger).toBeFocused();
  expect(
    (await page.getByLabel("Note content", { exact: true }).boundingBox()).y,
  ).toBeLessThan(openBody - 100);
  for (const theme of ["light", "dark", "dim"]) {
    await page.evaluate((theme) => {
      document.documentElement.dataset.theme = theme;
    }, theme);
    for (const width of [1160, 760, 390]) {
      await page.setViewportSize({ width, height: 800 });
      const sample = await page
        .locator(".note-metadata")
        .evaluate((element) => {
          const css = getComputedStyle(element),
            time = element.querySelector("time");
          return {
            fontSize: css.fontSize,
            gap: css.gap,
            dateTime: time.dateTime,
            edited: time.textContent,
            expected: `Edited ${new Date(time.dateTime).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}`,
            overflow: document.documentElement.scrollWidth > innerWidth,
          };
        });
      expect(sample.fontSize).toBe("12px");
      expect(sample.gap).toBe("8px");
      expect(sample.edited.trim()).toBe(sample.expected);
      expect(sample.overflow).toBe(false);
      samples.push({ theme, width, ...sample });
      await page.screenshot({ path: `${output}/${theme}-${width}.png` });
    }
  }
  await openNoteTags(page);
  await page
    .getByLabel("New tag", { exact: true })
    .fill("Retained unpublished tag");
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await expect(
    page.getByRole("textbox", { name: "New tag", exact: true }),
  ).toBeHidden();
  await page
    .getByRole("button", { name: "← Back to notes", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "New tag", exact: true }),
  ).toHaveValue("Retained unpublished tag");
  await expect(
    page.getByText("Add or clear the new tag before leaving.", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Clear tag input", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Done editing tags", exact: true })
    .click();
  await page
    .getByRole("button", { name: "← Back to notes", exact: true })
    .click();
  await page
    .getByRole("button", { name: /^A long note title that wraps/ })
    .click();
  await expect(page.locator(".note-metadata-tags")).toContainText("café");
  await expect(page.getByLabel("Note content", { exact: true })).toContainText(
    "Synthetic encrypted writing retained through tag controls.",
  );
  expect(errors).toEqual([]);
  await writeFile(
    `${output}/measurements.json`,
    JSON.stringify({ samples, errors, passed: true }, null, 2),
  );
} finally {
  await browser.close();
}
