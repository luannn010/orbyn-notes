import { chromium, expect } from "@playwright/test";
const base = process.env.NOTES_PREVIEW_URL ?? "http://127.0.0.1:5193";
const browser = await chromium.launch({
  channel: process.env.NOTES_BROWSER_CHANNEL ?? "chrome",
  headless: true,
});
const page = await browser.newPage({
  viewport: { width: 1000, height: 800 },
  isMobile: true,
  hasTouch: true,
});
try {
  await page.goto(`${base}/tests/integration/slash-viewport-browser.html`);
  await page.evaluate(() => {
    document.documentElement.dataset.motion = "reduced";
  });
  const editor = page.getByRole("textbox", { name: "Note content" });
  await editor.click();
  await page.keyboard.type("/");
  const menu = page.getByRole("listbox", { name: "Insert block" });
  await expect(menu).toBeVisible();
  for (let i = 0; i < 5; i++) await page.keyboard.press("ArrowDown");
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setPageScaleFactor", { pageScaleFactor: 4 });
  await expect
    .poll(async () => page.evaluate(() => window.visualViewport.width))
    .toBeLessThan(260);
  await expect
    .poll(async () => menu.evaluate((el) => parseFloat(el.style.maxHeight)))
    .toBeLessThanOrEqual(184);
  const metrics = await menu.evaluate((el) => {
    const rect = el.getBoundingClientRect(),
      selected = el
        .querySelector('[aria-selected="true"]')
        .getBoundingClientRect(),
      viewport = window.visualViewport;
    return {
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      width: rect.width,
      selectedTop: selected.top,
      selectedBottom: selected.bottom,
      viewportLeft: viewport.offsetLeft,
      viewportRight: viewport.offsetLeft + viewport.width,
      viewportWidth: viewport.width,
      scrollTop: el.scrollTop,
      clientHeight: el.clientHeight,
    };
  });
  console.log(JSON.stringify(metrics));
  expect(metrics.left).toBeGreaterThanOrEqual(metrics.viewportLeft + 7);
  expect(metrics.right).toBeLessThanOrEqual(metrics.viewportRight - 7);
  expect(metrics.selectedTop).toBeGreaterThanOrEqual(metrics.top);
  expect(metrics.selectedBottom).toBeLessThanOrEqual(metrics.bottom);
  await expect(editor).toBeFocused();
} finally {
  await browser.close();
}
