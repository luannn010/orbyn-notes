import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
const browser = await chromium.launch({
  channel: process.env.PLAYWRIGHT_CHANNEL ?? "chrome",
  headless: true,
});
const output = process.env.NOTES_UI_OUTPUT ?? "test-results/link-browser";
const results = [];
try {
  await mkdir(output, { recursive: true });
  for (const [theme, width] of [
    ["light", 1160],
    ["dark", 1160],
    ["dim", 1160],
    ["dim", 390],
  ]) {
    const page = await browser.newPage({
      viewport: { width, height: 844 },
      reducedMotion: "reduce",
    });
    const dialogs = [],
      errors = [];
    page.on("dialog", async (dialog) => {
      dialogs.push(dialog.type());
      await dialog.dismiss();
    });
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript((theme) => {
      localStorage.setItem("notes.theme", theme);
      localStorage.setItem("notes.motion", "reduced");
    }, theme);
    await page.goto(
      `${process.env.NOTES_PREVIEW_URL ?? "http://127.0.0.1:5179"}/tests/ui/preview.html`,
    );
    await page.getByRole("button", { name: /^A quiet place to think/ }).click();
    const editor = page.getByRole("textbox", {
      name: "Note content",
      exact: true,
    });
    await editor.focus();
    await page.keyboard.press("Control+A");
    await page.keyboard.type("Link this text");
    await editor.evaluate((element) => {
      const range = document.createRange();
      range.selectNodeContents(element.querySelector("p").firstChild);
      const selection = getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      document.dispatchEvent(new Event("selectionchange"));
    });
    await page.getByRole("button", { name: "Link", exact: true }).click();
    const popup = page.getByRole("dialog", { name: "Web link", exact: true });
    await expect(popup.getByLabel("URL", { exact: true })).toBeFocused();
    await popup.getByLabel("URL", { exact: true }).fill("javascript:bad");
    await popup.getByRole("button", { name: "Apply link" }).click();
    await expect(
      popup.getByText("Enter a valid web or email link."),
    ).toBeVisible();
    await expect(editor.locator("a")).toHaveCount(0);
    const rect = await popup.boundingBox();
    if (
      !rect ||
      rect.x < 0 ||
      rect.y < 0 ||
      rect.x + rect.width > width ||
      rect.y + rect.height > 844
    )
      throw new Error("Link form outside viewport");
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: join(output, `link-${theme}-${width}.png`) });
    await popup
      .getByLabel("URL", { exact: true })
      .fill("https://example.test/path");
    await popup.getByLabel("URL", { exact: true }).press("Enter");
    await expect(popup).toHaveCount(0);
    await expect(editor.locator("a")).toHaveText("Link this text");
    await expect(editor.locator("a")).toHaveAttribute(
      "href",
      "https://example.test/path",
    );
    await page.getByRole("button", { name: "Link", exact: true }).click();
    await popup.getByRole("button", { name: "Remove link" }).click();
    await expect(editor.locator("a")).toHaveCount(0);
    await expect(editor).toHaveText("Link this text");
    if (dialogs.length || errors.length)
      throw new Error(JSON.stringify({ dialogs, errors }));
    results.push({
      theme,
      width,
      viewportContained: true,
      applyPreservesText: true,
      removePreservesText: true,
      nativeDialogs: dialogs.length,
      errors,
    });
    await page.close();
  }
  await writeFile(
    join(output, "result.json"),
    JSON.stringify(
      {
        fixture:
          "Synthetic in-memory Notes; real Tiptap link controls, no account/encryption claim",
        results,
      },
      null,
      2,
    ),
  );
  console.log(
    "Link browser checks passed: three themes, narrow viewport, safe apply/remove and no native dialogs.",
  );
} finally {
  await browser.close();
}
