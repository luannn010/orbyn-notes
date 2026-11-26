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

  const narrow = await browser.newPage({
    viewport: { width: 600, height: 1500 },
    isMobile: true,
    hasTouch: true,
  });
  await narrow.goto(`${base}/tests/integration/slash-viewport-browser.html`);
  await narrow.evaluate(() => {
    document.documentElement.dataset.motion = "reduced";
    document.body.style.paddingTop = "250px";
  });
  const narrowEditor = narrow.getByRole("textbox", { name: "Note content" });
  await narrowEditor.click();
  await narrow.keyboard.type("/");
  const narrowMenu = narrow.getByRole("listbox", { name: "Insert block" });
  const narrowCdp = await narrow.context().newCDPSession(narrow);
  await narrowCdp.send("Emulation.setPageScaleFactor", { pageScaleFactor: 5 });
  await expect
    .poll(async () => narrowMenu.evaluate((el) => el.offsetWidth))
    .toBe(104);
  const wrapped = await narrowMenu.evaluate((el) => {
    const rect = el.getBoundingClientRect(),
      viewport = window.visualViewport;
    return {
      top: rect.top,
      bottom: rect.bottom,
      viewportBottom: viewport.offsetTop + viewport.height,
      rowHeights: [...el.querySelectorAll("button")].map(
        (row) => row.offsetHeight,
      ),
    };
  });
  console.log("wrapped", JSON.stringify(wrapped));
  expect(Math.max(...wrapped.rowHeights)).toBeGreaterThan(30);
  expect(wrapped.bottom).toBeLessThanOrEqual(wrapped.viewportBottom - 7);
  await expect(narrowEditor).toBeFocused();
  await narrow.close();

  const widthOnly = await browser.newPage({
    viewport: { width: 600, height: 240 },
  });
  await widthOnly.goto(`${base}/tests/integration/slash-viewport-browser.html`);
  await widthOnly.evaluate(() => {
    document.documentElement.dataset.motion = "reduced";
    document.querySelector("#root").style.width = "600px";
  });
  const widthEditor = widthOnly.getByRole("textbox", { name: "Note content" });
  await widthEditor.click();
  await widthOnly.keyboard.type("/");
  await widthOnly.keyboard.press("ArrowUp");
  const widthMenu = widthOnly.getByRole("listbox", { name: "Insert block" });
  const beforeMax = await widthMenu.evaluate((el) => el.style.maxHeight);
  await widthOnly.setViewportSize({ width: 80, height: 240 });
  await expect
    .poll(async () => widthMenu.evaluate((el) => el.offsetWidth))
    .toBe(64);
  const selected = await widthMenu.evaluate((el) => {
    const menu = el.getBoundingClientRect(),
      row = el.querySelector('[aria-selected="true"]'),
      rect = row.getBoundingClientRect();
    const hit = document.elementFromPoint(
      (rect.left + rect.right) / 2,
      (rect.top + rect.bottom) / 2,
    );
    return {
      menuBottom: menu.bottom,
      rowBottom: rect.bottom,
      maxHeight: el.style.maxHeight,
      hitSelected: hit === row || row.contains(hit),
      scrollTop: el.scrollTop,
    };
  });
  console.log("width-only", JSON.stringify(selected));
  expect(selected.maxHeight).toBe(beforeMax);
  expect(selected.rowBottom).toBeLessThanOrEqual(selected.menuBottom);
  expect(selected.hitSelected).toBe(true);
  await expect(widthEditor).toBeFocused();
  await widthOnly.close();
} finally {
  await browser.close();
}
