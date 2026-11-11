import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
const browser = await chromium.launch({
  channel: process.env.PLAYWRIGHT_CHANNEL ?? "chrome",
  headless: true,
});
try {
  const page = await browser.newPage({
    viewport: { width: 1160, height: 760 },
  });
  await page.goto(
    `${process.env.NOTES_PREVIEW_URL ?? "http://127.0.0.1:5179"}/tests/ui/preview.html`,
  );
  await page.getByRole("button", { name: /^A quiet place to think/ }).click();
  const editor = page.getByRole("textbox", {
    name: "Note content",
    exact: true,
  });
  const saved = () =>
    expect(page.locator('.editor-chrome [role="status"]')).toHaveText(
      "Saved in this browser",
    );
  const type = async (value) => {
    await editor.focus();
    await page.keyboard.press("Control+A");
    await page.keyboard.type(value);
  };
  const settings = page.getByRole("dialog", { name: "Settings", exact: true });
  const open = async () => {
    await saved();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await settings.getByRole("button", { name: "Editor", exact: true }).click();
  };
  const done = () =>
    settings.getByRole("button", { name: "Done", exact: true }).click();
  await type("## ");
  await expect(editor.locator("h2")).toHaveCount(1);
  await open();
  await settings
    .getByRole("group", { name: "Text size" })
    .getByRole("button", { name: "Large" })
    .click();
  await settings
    .getByRole("group", { name: "Line width" })
    .getByRole("button", { name: "Wide" })
    .click();
  await settings.getByRole("checkbox", { name: /Turn Markdown/ }).uncheck();
  await settings.getByRole("checkbox", { name: "Check spelling" }).uncheck();
  await expect(page.locator(".tiptap")).toHaveCSS("font-size", "16px");
  await expect(page.locator(".editor-page")).toHaveCSS("max-width", "800px");
  await expect(page.locator(".tiptap")).toHaveAttribute("spellcheck", "false");
  await done();
  await page.getByRole("button", { name: "Heading", exact: true }).click();
  await type("## ");
  await expect(editor.locator("h2")).toHaveCount(0);
  await expect(editor).toHaveText("## ");
  await open();
  await settings.getByRole("checkbox", { name: /Turn Markdown/ }).check();
  await done();
  await type("## ");
  await expect(editor.locator("h2")).toHaveCount(1);
  await open();
  await settings.getByRole("checkbox", { name: /Turn Markdown/ }).uncheck();
  await done();
  await page.reload();
  await page.getByRole("button", { name: /^A quiet place to think/ }).click();
  await expect(page.locator(".tiptap")).toHaveCSS("font-size", "16px");
  await expect(page.locator(".tiptap")).toHaveAttribute("spellcheck", "false");
  await type("## ");
  await expect(editor.locator("h2")).toHaveCount(0);
  await expect(editor).toHaveText("## ");
  await saved();
  await open();
  await settings.getByRole("checkbox", { name: /Turn Markdown/ }).check();
  await done();
  // Changing a preference must not recreate the editor/history and lose Undo.
  await editor.focus();
  await page.keyboard.press("Control+z");
  await expect(editor).not.toHaveText("## ");
  const output =
    process.env.NOTES_UI_OUTPUT ?? "test-results/editor-preferences";
  await mkdir(output, { recursive: true });
  await writeFile(
    join(output, "result.json"),
    JSON.stringify(
      {
        fixture:
          "Synthetic in-memory Notes content; real editor and device preference storage; not account/encryption qualification",
        checks: [
          "Markdown on converts h2",
          "off keeps literal typing",
          "on restores conversion",
          "live font/width/spelling",
          "preferences survive reload",
          "Undo history survives preference change",
        ],
        passed: true,
      },
      null,
      2,
    ),
  );
  console.log(
    "Editor browser checks passed: Markdown toggle, live preferences, reload and retained Undo.",
  );
} finally {
  await browser.close();
}
