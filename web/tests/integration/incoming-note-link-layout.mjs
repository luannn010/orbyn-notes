import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
const output =
  process.env.NOTES_UI_OUTPUT ?? "test-results/incoming-note-link-layout";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true }),
  context = await browser.newContext();
const results = [];
const errors = [];
await context.route(
  "**/tests/integration/note-link-entry-browser.html**",
  async (route) => {
    const response = await route.fetch();
    const body = (await response.text()).replace(
      "font:12px sans-serif",
      "position:fixed;left:4px;bottom:4px;z-index:40;max-width:200px;pointer-events:none;font:10px sans-serif",
    );
    await route.fulfill({ response, body });
  },
);
await context.addInitScript(() => {
  window.__entryLayoutShifts = [];
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries())
      window.__entryLayoutShifts.push({
        value: entry.value,
        hadRecentInput: entry.hadRecentInput,
        sources: entry.sources.map((source) => ({
          node: source.node?.className || source.node?.nodeName,
          previous: source.previousRect.toJSON(),
          current: source.currentRect.toJSON(),
        })),
      });
  }).observe({ type: "layout-shift", buffered: true });
});
async function settled(page) {
  await page.locator(".app").evaluate(async (element) => {
    await document.fonts.ready;
    await Promise.all(
      element
        .getAnimations({ subtree: true })
        .filter((a) => a.effect?.getTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => {})),
    );
    await new Promise((resolve) =>
      requestAnimationFrame(() =>
        requestAnimationFrame(() => setTimeout(resolve, 0)),
      ),
    );
  });
}
async function box(page) {
  return page.locator(".app").evaluate((element) => {
    const r = element.getBoundingClientRect();
    return {
      x: r.x,
      y: r.y,
      width: r.width,
      height: r.height,
      bottom: r.bottom,
      innerWidth,
      innerHeight,
      scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight,
    };
  });
}
try {
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1160, height: 850 });
  const base = `${process.env.NOTES_PREVIEW_URL ?? "http://127.0.0.1:5179"}/tests/integration/note-link-entry-browser.html`;
  await page.goto(base);
  await page.getByRole("button", { name: "New note", exact: true }).click();
  await page.getByLabel("Note title").fill("Layout target");
  await page
    .getByLabel("Note content", { exact: true })
    .fill("Synthetic layout proof.");
  await expect(
    page.getByText("Saved in this browser", { exact: true }),
  ).toBeVisible();
  const reference = await page.evaluate(async () => {
    const value = await window.__noteEntryFixture.metadata();
    return window.__noteEntryFixture.reference(
      value.notes.find((note) => note.title === "Layout target").id,
    );
  });
  const hash = "#note/v1/" + reference.split("/v1/")[1];
  for (const viewport of [
    { width: 1160, height: 850 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await page.evaluate((value) => {
      location.hash = value;
    }, hash);
    await expect(page.getByLabel("Note title")).toHaveValue("Layout target");
    await settled(page);
    const before = await box(page);
    await page.evaluate(() => {
      window.__entryLayoutShifts = [];
      location.hash = "#note/v9/invalid";
    });
    const notice = page.getByRole("alert", { name: "Incoming note link" });
    await expect(notice).toBeVisible();
    await settled(page);
    const during = await box(page);
    const n = await notice.boundingBox();
    if (JSON.stringify(before) !== JSON.stringify(during))
      throw Error("Notice changed workspace geometry");
    if (
      during.y < 0 ||
      during.bottom > viewport.height + 1 ||
      during.scrollWidth > viewport.width ||
      during.scrollHeight > viewport.height + 1
    )
      throw Error("Workspace exceeded viewport");
    const header = await page.locator(".editor-chrome").boundingBox();
    if (n && header && n.y < header.y + header.height)
      throw Error("Notice overlapped essential editor header");
    await page.screenshot({ path: `${output}/invalid-${viewport.width}.png` });
    const shifts = await page.evaluate(() => window.__entryLayoutShifts);
    const cls = shifts
      .filter((entry) => !entry.hadRecentInput)
      .reduce((sum, entry) => sum + entry.value, 0);
    if (cls !== 0 || shifts.length)
      throw Error(`Notice layout shifts ${JSON.stringify(shifts)}`);
    await notice.getByRole("button", { name: "Dismiss" }).click();
    await expect(notice).toHaveCount(0);
    await settled(page);
    if (JSON.stringify(await box(page)) !== JSON.stringify(before))
      throw Error("Dismiss changed workspace geometry");
    await page.evaluate((value) => {
      location.hash = value;
    }, hash);
    await expect(page.getByLabel("Note title")).toHaveValue("Layout target");
    await page.reload();
    await expect(page.getByLabel("Note title")).toHaveValue("Layout target");
    await settled(page);
    const reload = await box(page),
      reloadShifts = await page.evaluate(() => window.__entryLayoutShifts);
    const reloadCls = reloadShifts
      .filter((entry) => !entry.hadRecentInput)
      .reduce((sum, entry) => sum + entry.value, 0);
    results.push({
      viewport,
      before,
      during,
      notice: n,
      noticeCls: cls,
      reload,
      reloadCls,
      allReloadShifts: reloadShifts,
    });
    if (reloadCls !== 0) {
      await writeFile(
        output + "/reload-shifts.json",
        JSON.stringify(results, null, 2),
      );
      throw Error(`Reload opening→hidden CLS ${reloadCls}`);
    }
  }
  if (errors.length) throw Error(errors.join("\n"));
  await writeFile(
    output + "/result.json",
    JSON.stringify(
      {
        qualified:
          "Actual App in StrictMode; synthetic session real WASM/IndexedDB. Fixture-only provenance label taken out of flow; product CSS/DOM unmodified by test. No native/physical keyboard claim.",
        checks: results,
        pageErrors: errors,
      },
      null,
      2,
    ),
  );
  console.log("Incoming notice layout passed");
} catch (error) {
  await writeFile(output + "/failure.txt", String(error));
  throw error;
} finally {
  await browser.close();
}
