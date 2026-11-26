import { chromium } from "@playwright/test";
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
    console.log(width, JSON.stringify(metrics));
    if (width <= 899) {
      for (const [name, rect] of Object.entries({
        card: metrics.card,
        cardMenu: metrics.cardMenu,
        menuItem: metrics.menuItem,
        end: metrics.end,
        ...Object.fromEntries(metrics.quick.map((r, i) => [`quick${i}`, r])),
      }))
        if (rect.width < 44 || rect.height < 44)
          failures.push(`${width} ${name}: ${rect.width}x${rect.height}`);
      if (!metrics.quick.length)
        failures.push(`${width} missing quick buttons`);
      if (metrics.studyOverflow > 1 || metrics.editorOverflow > 1)
        failures.push(`${width} overflow`);
    } else {
      if (
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
