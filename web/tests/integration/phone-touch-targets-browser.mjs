import { chromium, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
const output = process.env.NOTES_UI_OUTPUT ?? "test-results/phone-touch-targets";
await mkdir(output, { recursive: true });
const base = process.env.NOTES_PREVIEW_URL ?? "http://127.0.0.1:5194";
const browser = await chromium.launch({
  channel: process.env.NOTES_BROWSER_CHANNEL ?? "chrome",
  headless: true,
});
const failures = [];
try {
  for (const width of [390, 899, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 850 } });
    await page.goto(`${base}/tests/integration/study-motion-component.html`);
    await page.getByRole("button", { name: "Motion continuity" }).click();
    const card = page.locator(".study-text-button").first();
    const cardMenu = page.getByRole("button", { name: "Card menu" }).first();
    const metrics = {};
    const capture = (state) => page.screenshot({ path: `${output}/${width}-${state}.png` });
    const horizontalFit = (locator) => locator.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return r.left >= 0 && r.right <= document.documentElement.clientWidth;
    });
    const size = (locator) =>
      locator.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return { width: r.width, height: r.height };
      });
    metrics.card = await size(card);
    metrics.cardMenu = await size(cardMenu);
    await cardMenu.click();
    const menuItem = page.getByRole("menuitem").first();
    await menuItem.evaluate(async (el) =>
      Promise.all(
        el
          .closest(".action-menu")
          .getAnimations()
          .map((animation) => animation.finished),
      ),
    );
    metrics.menuItem = await size(menuItem);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Study 4 cards" }).click();
    metrics.end = await size(page.getByRole("button", { name: "End session" }));
    metrics.studyOverflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    await page.getByRole("button", { name: "End session" }).click();
    await page.getByRole("button", { name: "Add card", exact: true }).first().click();
    const cardDialog = page.getByRole("dialog", { name: "Add card", exact: true });
    await cardDialog.getByRole("button", { name: "Fill in the blank", exact: true }).click();
    await cardDialog.getByLabel("Blank ID 1", { exact: true }).fill("kept");
    await cardDialog.getByRole("button", { name: "Add blank", exact: true }).click();
    const removeBlank = cardDialog.getByRole("button", { name: "Remove blank 2", exact: true });
    metrics.removeBlank = await size(removeBlank);
    expect(await horizontalFit(cardDialog)).toBe(true);
    await capture("cloze-blank");
    await removeBlank.click();
    await expect(cardDialog.getByLabel("Blank ID 1", { exact: true })).toHaveValue("kept");
    await expect(removeBlank).toHaveCount(0);
    metrics.blankOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    await cardDialog.getByRole("button", { name: "Cancel", exact: true }).click();

    await page.goto(`${base}/tests/integration/phone-editor-targets.html`);
    await page.evaluate(() => document.fonts.ready);
    const selectionEditor = page.getByRole("textbox", { name: "Note content", exact: true });
    await selectionEditor.click();
    await selectionEditor.press("Home");
    await selectionEditor.press("Shift+End");
    const makeCard = page.getByRole("button", { name: "Make a card", exact: true });
    await expect(makeCard).toBeVisible();
    metrics.makeCard = await size(makeCard);
    expect(await horizontalFit(page.getByRole("toolbar", { name: "Selection tools", exact: true }))).toBe(true);
    await capture("selection-tools");
    const selectedText = await page.evaluate(() => window.getSelection()?.toString());
    await makeCard.click();
    await expect(page.getByRole("status")).toHaveText("Current selection captured");
    expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(selectedText);
    expect(selectedText?.length).toBeGreaterThan(0);
    await page.getByRole("button", { name: "Link", exact: true }).click();
    const linkDialog = page.getByRole("dialog", { name: "Web link", exact: true });
    await expect(linkDialog).toBeVisible();
    await expect(linkDialog.getByLabel("URL", { exact: true })).toBeFocused();
    expect(await horizontalFit(linkDialog)).toBe(true);
    await capture("web-link");
    metrics.link = await linkDialog.locator("button").evaluateAll((buttons) => buttons.map((el) => {
      const r = el.getBoundingClientRect(); return { width: r.width, height: r.height };
    }));
    await linkDialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(selectionEditor).toBeFocused();
    await page.goto(`${base}/tests/integration/editor-controls-browser.html`);
    await page
      .getByRole("combobox", { name: "Editor pane width" })
      .selectOption("380");
    await page
      .getByRole("textbox", { name: "Note content" })
      .click({ button: "right" });
    const quick = page.locator(".editor-format-quick button");
    metrics.quick = await quick.evaluateAll((elements) =>
      elements.map((el) => {
        const r = el.getBoundingClientRect();
        return { width: r.width, height: r.height };
      }),
    );
    metrics.editorOverflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Markdown", exact: true }).click();
    await page.getByRole("textbox", { name: "Markdown source", exact: true }).fill("![unsupported image](https://example.test/image.png)");
    const recovery = page.locator(".editor-format-notice button");
    await expect(recovery).toHaveCount(2);
    metrics.recovery = await recovery.evaluateAll((buttons) => buttons.map((el) => {
      const r = el.getBoundingClientRect(); return { width: r.width, height: r.height };
    }));
    await capture("markdown-recovery");
    metrics.recoveryOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    await page.getByRole("button", { name: "Discard Markdown draft", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Note content", exact: true })).toContainText("A synthetic editor note");
    await page.goto(`${base}/tests/integration/slash-viewport-browser.html`);
    await page.evaluate(() => {
      document.documentElement.dataset.motion = "reduced";
    });
    const slashEditor = page.getByRole("textbox", { name: "Note content" });
    await slashEditor.click();
    await page.keyboard.type("/");
    const slashMenu = page.getByRole("listbox", { name: "Insert block" });
    await slashMenu.evaluate(async (el) =>
      Promise.all(el.getAnimations().map((animation) => animation.finished)),
    );
    await page.keyboard.press("ArrowUp");
    metrics.slash = await slashMenu.evaluate((el) => {
      const menu = el.getBoundingClientRect();
      const selected = el
        .querySelector('[aria-selected="true"]')
        .getBoundingClientRect();
      return {
        options: [...el.querySelectorAll('[role="option"]')].map((option) => {
          const rect = option.getBoundingClientRect();
          return { width: rect.width, height: rect.height };
        }),
        selectedVisible:
          selected.top >= menu.top && selected.bottom <= menu.bottom,
        focused:
          document.activeElement?.getAttribute("aria-label") === "Note content",
      };
    });
    console.log(width, JSON.stringify(metrics));
    if (width <= 899) {
      for (const [name, rect] of Object.entries({
        card: metrics.card,
        cardMenu: metrics.cardMenu,
        menuItem: metrics.menuItem,
        end: metrics.end,
        makeCard: metrics.makeCard,
        removeBlank: metrics.removeBlank,
        ...Object.fromEntries(metrics.link.map((r, i) => [`link${i}`, r])),
        ...Object.fromEntries(metrics.recovery.map((r, i) => [`recovery${i}`, r])),
        ...Object.fromEntries(metrics.quick.map((r, i) => [`quick${i}`, r])),
      }))
        if (rect.width < 44 || rect.height < 44)
          failures.push(`${width} ${name}: ${rect.width}x${rect.height}`);
      for (const option of metrics.slash.options)
        if (option.width < 44 || option.height < 44)
          failures.push(
            `${width} slash option: ${option.width}x${option.height}`,
          );
      if (
        !metrics.slash.options.length ||
        !metrics.slash.selectedVisible ||
        !metrics.slash.focused
      )
        failures.push(`${width} slash selection or focus`);
      if (!metrics.quick.length)
        failures.push(`${width} missing quick buttons`);
      if (metrics.studyOverflow > 1 || metrics.editorOverflow > 1 || metrics.blankOverflow > 1 || metrics.recoveryOverflow > 1)
        failures.push(`${width} overflow`);
    } else {
      if (
        metrics.slash.options.some((option) => option.height !== 30) ||
        !metrics.slash.selectedVisible ||
        !metrics.slash.focused ||
        metrics.makeCard.height !== 33 ||
        metrics.link.some((r) => r.height !== 32) ||
        metrics.recovery.some((r) => r.height !== 32) ||
        Math.abs(metrics.removeBlank.width - 30.28125) > 0.1 ||
        metrics.removeBlank.height !== 32 ||
        metrics.card.height !== 30 ||
        metrics.end.width !== 28 ||
        metrics.end.height !== 28 ||
        metrics.quick.some((r) => r.width !== 30 || r.height !== 30)
      )
        failures.push("desktop geometry changed");
    }
    await page.close();
  }
  if (failures.length) throw new Error(failures.join("\n"));
} finally {
  await browser.close();
}
