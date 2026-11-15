import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { openNoteTags } from "./note-tag-controls.mjs";
const base = process.env.NOTES_PREVIEW_URL ?? "http://127.0.0.1:5188";
const output = process.env.NOTES_UI_OUTPUT ?? "test-results/note-metadata";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  channel: process.env.NOTES_BROWSER_CHANNEL ?? "msedge",
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1160, height: 800 } });
const errors = [],
  samples = [];
page.on("pageerror", (error) => errors.push(error.message));
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
    page.getByText("Saved on this device", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Back to notes/ }).click();
  await page
    .getByRole("button", { name: /^A long note title that wraps/ })
    .click();
  const trigger = page.getByRole("button", {
    name: "Manage note tags",
    exact: true,
  });
  const input = page.getByRole("textbox", {
    name: "Tags, separated by commas",
    exact: true,
  });
  await trigger.focus();
  await page.keyboard.press("Enter");
  await expect(input).toBeFocused();
  await input.fill(
    "Averylongunbrokentagthatstillhasitscompleteaccessibletext, café",
  );
  await input.press("Enter");
  await expect(input).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Current note tags" }),
  ).toHaveText(
    "Averylongunbrokentagthatstillhasitscompleteaccessibletext, café",
  );
  await expect(
    page.getByText("Saved in this browser", { exact: true }),
  ).toBeVisible();
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
      expect(sample.gap).toBe("6px");
      expect(sample.edited.trim()).toBe(sample.expected);
      expect(sample.overflow).toBe(false);
      samples.push({ theme, width, ...sample });
      await page.screenshot({ path: `${output}/${theme}-${width}.png` });
    }
  }
  await openNoteTags(page);
  await input.fill('"Retained unpublished tag');
  await page.getByRole("button", { name: /Back to notes/ }).click();
  await expect(input).toHaveValue('"Retained unpublished tag');
  await input.press("Escape");
  await expect(trigger).toBeFocused();
  await expect(input).toHaveCount(0);
  await page.getByRole("button", { name: /Back to notes/ }).click();
  await page
    .getByRole("button", { name: /^A long note title that wraps/ })
    .click();
  await expect(
    page.getByRole("button", { name: "Current note tags" }),
  ).toContainText("café");
  await expect(page.getByLabel("Note content", { exact: true })).toContainText(
    "Synthetic encrypted writing retained through tag controls.",
  );
  expect(errors).toEqual([]);
  await writeFile(
    `${output}/measurements.json`,
    JSON.stringify({ samples, errors, passed: true }, null, 2),
  );
  console.log(
    "Compact metadata: nine theme/viewport cases, encrypted save, cancel and invalid pending navigation passed.",
  );
} finally {
  await browser.close();
}
