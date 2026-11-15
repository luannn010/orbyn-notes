import { chromium, expect } from "@playwright/test";
const browser = await chromium.launch({
  channel: process.env.NOTES_BROWSER_CHANNEL ?? "msedge",
  headless: true,
});
const base = process.env.NOTES_PREVIEW_URL ?? "http://127.0.0.1:5179";
try {
  const page = await browser.newPage({
    viewport: { width: 1160, height: 800 },
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${base}/tests/ui/preview.html`);
  await page.getByRole("button", { name: /^A quiet place to think/ }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "Settings", exact: true });
  await settings.getByRole("button", { name: "Editor", exact: true }).click();
  for (const [size, pixels] of [
    ["Small", "12px"],
    ["Large", "16px"],
    ["Medium", "14px"],
  ]) {
    await settings
      .getByRole("group", { name: "Text size" })
      .getByRole("button", { name: size, exact: true })
      .click();
    await expect(page.locator(".tiptap")).toHaveCSS("font-size", pixels);
  }
  for (const [width, pixels] of [
    ["Wide", "800px"],
    ["Narrow", "640px"],
  ]) {
    await settings
      .getByRole("group", { name: "Line width" })
      .getByRole("button", { name: width, exact: true })
      .click();
    await expect(page.locator(".editor-page")).toHaveCSS("max-width", pixels);
  }
  await settings
    .getByRole("group", { name: "Text size" })
    .getByRole("button", { name: "Large", exact: true })
    .click();
  await settings
    .getByRole("group", { name: "Line width" })
    .getByRole("button", { name: "Wide", exact: true })
    .click();
  await settings.getByRole("button", { name: "Done", exact: true }).click();
  await page.evaluate(() => document.fonts.ready);
  expect(
    await page.evaluate(() => document.fonts.check('400 14px "Geist"')),
  ).toBe(true);
  for (const theme of ["light", "dark", "dim"]) {
    await page.evaluate((theme) => {
      document.documentElement.dataset.theme = theme;
    }, theme);
    for (const width of [1160, 850, 600]) {
      await page.setViewportSize({ width, height: 800 });
      const pane = page.locator(".editor-pane");
      const dimensions = await pane.evaluate((el) => ({
        client: el.clientWidth,
        scroll: el.scrollWidth,
      }));
      expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.client + 1);
      await expect(
        page.getByRole("button", { name: "Markdown", exact: true }),
      ).toBeInViewport();
      await expect(page.locator(".tiptap")).toHaveCSS("font-size", "16px");
    }
  }
  await page.setViewportSize({ width: 1160, height: 800 });
  await page.getByRole("button", { name: "Markdown", exact: true }).click();
  const source = page.getByRole("textbox", { name: "Markdown source" });
  await source.fill("![unsupported](private.png)");
  await page.getByRole("button", { name: "Journal", exact: true }).click();
  await expect(source).toHaveValue("![unsupported](private.png)");
  await expect(page.locator(".note-title")).toHaveValue(
    "A quiet place to think",
  );
  await page.getByRole("button", { name: "Discard Markdown draft" }).click();
  await page.getByRole("button", { name: "Manage note tags" }).click();
  const tags = page.getByRole("textbox", { name: "Tags, separated by commas" });
  await tags.fill("New, Relevant");
  await tags.press("Enter");
  await expect(
    page.getByRole("button", { name: "Current note tags" }),
  ).toHaveText("New, Relevant");
  await expect(page.locator(".note-header-status")).toHaveText(/Saved/);
  await page.getByRole("button", { name: /Back to notes/ }).click();
  await page
    .getByRole("button", { name: "New note", exact: true })
    .first()
    .click();
  await expect(page.locator(".new-note-page")).toHaveCSS("max-width", "800px");
  await expect(page.locator(".tiptap")).toHaveCSS("font-size", "16px");
  await page
    .getByRole("textbox", { name: "Note title" })
    .fill("Browser new note");
  await page.getByRole("button", { name: "Markdown", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Markdown source" })
    .fill("![unsupported](private.png)");
  await page.getByRole("button", { name: /Back to notes/ }).click();
  await expect(
    page.getByRole("textbox", { name: "Markdown source" }),
  ).toHaveValue("![unsupported](private.png)");
  await page.getByRole("button", { name: "Discard Markdown draft" }).click();
  expect(errors).toEqual([]);
  console.log(
    "PASS: Settings actual font/width, loaded Geist, 9 theme/pane cases, Notes/NewNote invalid-source navigation, compact tags",
  );
} finally {
  await browser.close();
}
