import { chromium, expect } from "@playwright/test";

const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? "chrome", headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await page.goto(`${process.env.NOTES_PREVIEW_URL ?? "http://127.0.0.1:5191"}/tests/integration/sample-settings-editor.html`);
  await page.getByRole("button", { name: /Lisbon trip, May/ }).click();
  const editor = page.getByRole("textbox", { name: "Sample note content" });
  const pageArea = page.locator(".sample-editor.editor-page");
  await expect(editor).toHaveCSS("font-size", "14px");
  await expect(pageArea).toHaveCSS("max-width", "760px");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "Settings" });
  await settings.getByRole("button", { name: "Editor", exact: true }).click();
  await settings.getByRole("group", { name: "Text size" }).getByRole("button", { name: "Large" }).click();
  await settings.getByRole("group", { name: "Line width" }).getByRole("button", { name: "Wide" }).click();
  await settings.getByRole("button", { name: "Done" }).click();
  await expect(editor).toHaveCSS("font-size", "16px");
  await expect(pageArea).toHaveCSS("max-width", "920px");
  expect(await pageArea.evaluate((element) => element.getBoundingClientRect().width)).toBeGreaterThan(760);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await settings.getByRole("button", { name: "Editor", exact: true }).click();
  await settings.getByRole("group", { name: "Text size" }).getByRole("button", { name: "Small" }).click();
  await settings.getByRole("group", { name: "Line width" }).getByRole("button", { name: "Narrow" }).click();
  await settings.getByRole("button", { name: "Done" }).click();
  await expect(editor).toHaveCSS("font-size", "12px");
  await expect(pageArea).toHaveCSS("max-width", "760px");
  await page.getByRole("button", { name: "Exit sample" }).click();
  await expect(page.getByText("Sample closed")).toBeVisible();
  expect(await page.evaluate(() => [document.documentElement.style.getPropertyValue("--notes-editor-size"), document.documentElement.style.getPropertyValue("--notes-editor-width")])).toEqual(["19px", "720px"]);
  console.log("Sample editor rendered preferences and restored root styles passed.");
} finally {
  await browser.close();
}
