import { chromium, expect } from "@playwright/test";
const base = process.env.NOTES_PREVIEW_URL ?? "http://127.0.0.1:5188";
const browser = await chromium.launch({
  channel: process.env.NOTES_BROWSER_CHANNEL ?? "chrome",
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1160, height: 800 } });
try {
  await page.goto(`${base}/tests/integration/editor-controls-browser.html`);
  await expect(
    page.getByRole("textbox", { name: "Note content" }),
  ).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  for (const theme of ["light", "dark", "dim"]) {
    await page.getByRole("combobox", { name: "Theme" }).selectOption(theme);
    for (const width of ["980", "620", "380"]) {
      await page
        .getByRole("combobox", { name: "Editor pane width" })
        .selectOption(width);
      const pane = page.getByRole("region", { name: "Editor component" });
      const metrics = await pane.evaluate((element) => ({
        client: element.clientWidth,
        scroll: element.scrollWidth,
      }));
      expect(metrics.scroll).toBeLessThanOrEqual(metrics.client + 1);
      await expect(
        pane.getByRole("button", { name: "Rich", exact: true }),
      ).toBeInViewport();
      await expect(
        pane.getByRole("button", { name: "Markdown", exact: true }),
      ).toBeInViewport();
      if (width !== "980") {
        await pane.getByRole("button", { name: "More formatting" }).click();
        const menu = page.getByRole("menu", { name: "More formatting" });
        await expect(menu).toBeVisible();
        await page.keyboard.press("Escape");
      }
    }
  }
  await page.getByRole("button", { name: "Markdown", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Markdown source" })
    .fill("## A converted heading");
  await expect(page.getByRole("status")).toHaveText("No unsaved source draft");
  await page.getByRole("button", { name: "Rich", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Note content" }).getByRole("heading"),
  ).toHaveText("A converted heading");
  console.log(
    "Editor component: nine theme/pane cases and Markdown transaction passed.",
  );
} finally {
  await browser.close();
}
